import { readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  AI_ANSWER_SCHEMA,
  SECOND_LOOK_DEFAULTS,
  answerToDrafts,
  isAiAnswer,
  secondLookFindings,
  withoutBadParts,
} from "../shared/aiAnswer";
import type { DraftInput, RecipeDraft } from "../shared/importDraft";
import { pageForAi } from "../shared/pageText";
import type { ImportSource } from "../shared/recipe";
import { AnthropicProvider } from "../worker/ai/anthropic";
import { FakeProvider } from "../worker/ai/fake";
import { DEFAULT_MODELS, MAX_OUTPUT_TOKENS, effortFor } from "../worker/ai/models";
import { instructionFor, SYSTEM_PROMPT } from "../worker/ai/prompt";
import type { AiPart, AiProvider, ImageType } from "../worker/ai/provider";
import { MIN_PAGE_TEXT, pageAiPart } from "../worker/import/aiPage";
import {
  cookingScore,
  secondLookSection,
  type LookRecord,
  type SavedAnswer,
  type Way,
} from "./secondLookReport";
import {
  loadExpected,
  reportMarkdown,
  runScorecard,
  scoreDrafts,
  type Importer,
  type InputFile,
  type Sample,
  type SampleKind,
  type SampleResult,
} from "./scorecard";

// The model comparison (phase E7, spec.md E7 step 7): runs the quality test set through the AI
// three ways, and prints accuracy and cost side by side:
//
// - the cheaper model alone (Claude Haiku to start);
// - the stronger model alone (Claude Sonnet);
// - the cheaper model with a second look by the stronger one when its answer looks wrong (what
//   Fennl does, decided 2026-10-12), with the mistakes that setup let through.
//
//   ANTHROPIC_API_KEY=... npm run ai:compare
//   AI_COMPARE_FAKE=1 npm run ai:compare     (the stand-in AI: checks the script, costs nothing)
//
// AI_COMPARE_SETS picks what it reads: "photos" (the default: the photos, cookbook pages,
// screenshots and PDFs), "web" (the web pages with their recipe data left out, read from the
// page's text as Fennl does for a page without data, phase E8), "text" (pasted text, phase E15),
// or "all".
//
// It calls the real API, so it costs money: about a dollar for the photos, and about another
// dollar for the web pages. Run it from GitHub (Actions › AI model comparison › Run workflow;
// .github/workflows/ai-compare.yml), where the key is a repository secret. Writes
// import-quality/ai-report.md.

const SETS = {
  photos: { label: "photos", kinds: ["card", "cookbook", "screenshot", "pdf"] },
  web: { label: "web pages without recipe data", kinds: ["web"] },
  text: { label: "pasted text", kinds: ["text"] },
} as const satisfies Record<string, { label: string; kinds: readonly SampleKind[] }>;

type SetName = keyof typeof SETS;

const SOURCE: Partial<Record<SampleKind, ImportSource>> = {
  card: "photo",
  cookbook: "photo",
  screenshot: "screenshot",
  pdf: "pdf",
  web: "website",
  text: "text",
};

/** A page without its recipe data, as Fennl gives it to the AI (worker/import/aiWeb.ts). */
function pageText(file: InputFile, url: string | null) {
  const page = pageForAi(new TextDecoder().decode(file.bytes), url);
  return { page, enough: page.text.length >= MIN_PAGE_TEXT };
}

const IMAGE_TYPES: Record<string, ImageType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function toParts(files: InputFile[], sample: Sample): { parts: AiPart[]; inputs: DraftInput[] } {
  const first = files[0];
  if (sample.kind === "web" && first) {
    const url = sample.url ?? null;
    const { page } = pageText(first, url);
    return {
      parts: [pageAiPart(page, url)],
      inputs: [{ kind: "page", name: page.title, url, imageHash: null }],
    };
  }
  if (sample.kind === "text" && first) {
    return {
      parts: [
        { kind: "text", label: "The pasted text", text: new TextDecoder().decode(first.bytes) },
      ],
      inputs: [{ kind: "text", name: "Pasted text", url: null, imageHash: null }],
    };
  }
  const parts = files.map((file, i): AiPart => {
    const label = `Input ${i + 1} (${file.name})`;
    const ext = extname(file.name).toLowerCase();
    if (ext === ".pdf") return { kind: "pdf", bytes: file.bytes, label };
    const mediaType = IMAGE_TYPES[ext];
    if (!mediaType) throw new Error(`${file.name}: not a photo or PDF`);
    return { kind: "image", mediaType, bytes: file.bytes, label };
  });
  const inputs = files.map((file): DraftInput => ({
    kind: extname(file.name).toLowerCase() === ".pdf" ? "pdf" : "image",
    name: file.name,
    url: null,
    imageHash: null,
  }));
  return { parts, inputs };
}

/** What each way of reading cost, and how often the cheaper model asked for a second look. */
interface Tally {
  calls: number;
  microUsd: number;
  secondLooks: number;
  samples: number;
  /** Per sample: whether the cheaper model's answer got a second look. */
  looked: Map<string, boolean>;
}

const tally = (): Tally => ({
  calls: 0,
  microUsd: 0,
  secondLooks: 0,
  samples: 0,
  looked: new Map(),
});

const answers: SavedAnswer[] = [];
const looks: LookRecord[] = [];

async function read(
  provider: AiProvider,
  model: string,
  level: number,
  sample: Sample,
  files: InputFile[],
  spent: Tally,
  record: { set: SetName; way: Way },
): Promise<RecipeDraft[] | null> {
  const source = SOURCE[sample.kind] ?? "photo";
  const { parts, inputs } = toParts(files, sample);
  const result = await provider.read({
    model,
    system: SYSTEM_PROMPT,
    parts,
    instruction: instructionFor(source),
    schema: AI_ANSWER_SCHEMA as unknown as Record<string, unknown>,
    effort: effortFor(level),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  spent.calls += 1;
  const cost = provider.costMicroUsd(model, result.tokens);
  spent.microUsd += cost;
  answers.push({
    ...record,
    sample: sample.id,
    model,
    source,
    inputs,
    ok: result.ok,
    problem: result.ok ? null : `${result.problem} ${result.detail ?? ""}`.trim(),
    output: result.ok ? result.output : null,
    costMicroUsd: cost,
  });
  if (!result.ok) {
    console.warn(`${sample.id} (${model}): ${result.problem} ${result.detail ?? ""}`);
    return null;
  }
  if (!isAiAnswer(result.output)) {
    console.warn(`${sample.id} (${model}): answer of the wrong shape`);
    return null;
  }
  // As Fennl keeps them (worker/ai/read.ts): a part that breaks the rules is left out.
  return answerToDrafts(result.output, { source, inputs, photos: [], model }).flatMap((d) => {
    const kept = withoutBadParts(d, null);
    return kept ? [kept] : [];
  });
}

function importers(provider: AiProvider, cheap: string, strong: string, set: SetName) {
  const { kinds, label } = SETS[set];
  const spent = { cheap: tally(), strong: tally(), switching: tally() };
  // A saved copy that keeps no text of the page (only its data) can't be read this way.
  const accepts =
    set === "web"
      ? async (sample: Sample) => {
          const path = sample.inputs[0];
          if (!path) return false;
          const bytes = new Uint8Array(await readFile(join(import.meta.dirname, "..", path)));
          return pageText({ path, name: path, bytes }, sample.url ?? null).enough;
        }
      : undefined;
  const alone = (model: string, level: number, t: Tally): Importer => ({
    name: `${model} alone (${label})`,
    kinds,
    ...(accepts ? { accepts } : {}),
    run: async (files, sample) => {
      t.samples += 1;
      return (await read(provider, model, level, sample, files, t, { set, way: "alone" })) ?? [];
    },
  });
  const switching: Importer = {
    name: `${cheap}, then ${strong} when needed (${label})`,
    kinds,
    ...(accepts ? { accepts } : {}),
    run: async (files, sample) => {
      const t = spent.switching;
      t.samples += 1;
      const first = await read(provider, cheap, 0, sample, files, t, { set, way: "first" });
      const findings = first
        ? secondLookFindings(first, SECOND_LOOK_DEFAULTS)
        : [{ reason: "no_answer" as const, detail: "no usable answer" }];
      const expected = (await loadExpected(sample.id)) ?? [];
      const look: LookRecord = {
        set,
        sample: sample.id,
        findings,
        first: cookingScore(scoreDrafts(expected, first ?? [])),
        second: null,
      };
      looks.push(look);
      t.looked.set(sample.id, findings.length > 0);
      if (findings.length === 0) return first ?? [];
      t.secondLooks += 1;
      const second = await read(provider, strong, 1, sample, files, t, {
        set,
        way: "second_look",
      });
      look.second = cookingScore(scoreDrafts(expected, second ?? []));
      return second && second.length > 0 ? second : (first ?? []);
    },
  };
  return {
    spent,
    list: [alone(cheap, 0, spent.cheap), alone(strong, 1, spent.strong), switching],
  };
}

const dollars = (micro: number) => `$${(micro / 1_000_000).toFixed(3)}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

async function main() {
  // AI_COMPARE_FAKE=1: Fennl's stand-in AI (worker/ai/fake.ts), to check the script itself for free.
  const fake = process.env.AI_COMPARE_FAKE === "1";
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key && !fake) {
    console.error("Set ANTHROPIC_API_KEY to run the model comparison (it calls the real API).");
    process.exit(2);
  }
  const [cheap, strong] = (process.env.AI_MODELS?.split(",").map((m) => m.trim()) ??
    DEFAULT_MODELS) as [string, string];
  const provider: AiProvider = fake ? new FakeProvider() : new AnthropicProvider(key ?? "");
  if (!provider.knows(cheap) || !provider.knows(strong)) {
    console.error(`Unknown model in ${cheap}, ${strong}`);
    process.exit(2);
  }
  const wanted = process.env.AI_COMPARE_SETS?.trim() || "photos";
  const sets: SetName[] =
    wanted === "all" ? ["photos", "web", "text"] : wanted in SETS ? [wanted as SetName] : [];
  if (!sets.length) {
    console.error(`AI_COMPARE_SETS must be photos, web, text or all, not ${wanted}`);
    process.exit(2);
  }
  const groups = sets.map((set) => importers(provider, cheap, strong, set));
  const card = await runScorecard(groups.flatMap((g) => g.list));
  const by = (name: string) =>
    new Map(card.results.filter((r) => r.importer === name).map((r) => [r.sample.id, r]));

  const costRows: string[] = [];
  const missedLines: string[] = [];
  for (const { spent, list } of groups) {
    const [cheapName, strongName, switchName] = list.map((i) => i.name) as [string, string, string];
    // Where the switch kept the cheaper model's answer, but the stronger model did clearly
    // better: the mistakes the second look didn't catch.
    const strongResults = by(strongName);
    const missed = [...by(switchName).values()].filter((r: SampleResult) => {
      const better = strongResults.get(r.sample.id);
      return (
        spent.switching.looked.get(r.sample.id) === false &&
        better &&
        better.overall - r.overall >= 0.05
      );
    });
    missedLines.push(
      ...missed.map(
        (r) =>
          `- ${r.sample.id}: ${pct(r.overall)} against ${pct(strongResults.get(r.sample.id)?.overall ?? 0)}`,
      ),
    );
    const rows = [
      [cheapName, spent.cheap],
      [strongName, spent.strong],
      [switchName, spent.switching],
    ] as const;
    costRows.push(
      ...rows.map(
        ([name, t]) =>
          `| ${name} | ${t.samples} | ${t.calls} | ${dollars(t.microUsd)} | ${dollars(t.microUsd / Math.max(1, t.samples))} | ${
            name === switchName
              ? `${t.secondLooks} (${pct(t.secondLooks / Math.max(1, t.samples))})`
              : "–"
          } |`,
      ),
    );
  }

  const out = [
    reportMarkdown(card).replace("# Import quality", "# AI model comparison"),
    ...(sets.includes("text")
      ? [
          "Pasted text is read as Fennl reads text its own rules can't follow (phase E15). The clearly laid out samples are read too, to show what the AI adds over Fennl's free reading.",
          "",
        ]
      : []),
    ...(sets.includes("web")
      ? [
          "Web pages are read from their text with the recipe data left out, as Fennl reads a page that has none. The saved copies keep only the recipe card, so this measures reading the recipe itself, not finding it on a long page; copies that keep no text of the page are left out.",
          "",
        ]
      : []),
    "## Cost",
    "",
    "| Way of reading | Samples | Calls | Estimated cost | Per sample | Second looks |",
    "| --- | --- | --- | --- | --- | --- |",
    ...costRows,
    "",
    "## Missed by the switch",
    "",
    "Samples where the cheaper model's answer looked right, so no second look was asked for, but the stronger model scored at least 5 points higher.",
    "",
    ...(missedLines.length ? missedLines : ["None."]),
    "",
    ...secondLookSection(looks),
    `Prices: Anthropic's (worker/ai/anthropic.ts). Run on ${new Date().toISOString().slice(0, 10)}. Every answer is saved in ai-answers.json, kept with the run.`,
  ].join("\n");
  await writeFile(join(import.meta.dirname, "ai-report.md"), `${out}\n`);
  await writeFile(
    join(import.meta.dirname, "ai-answers.json"),
    `${JSON.stringify({ cheap, strong, answers }, null, 1)}\n`,
  );
  console.log(out);
}

await main();
