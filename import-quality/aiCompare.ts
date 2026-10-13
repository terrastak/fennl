import { writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  AI_ANSWER_SCHEMA,
  SECOND_LOOK_DEFAULTS,
  answerToDrafts,
  isAiAnswer,
  secondLookReasons,
} from "../shared/aiAnswer";
import type { DraftInput, RecipeDraft } from "../shared/importDraft";
import type { ImportSource } from "../shared/recipe";
import { AnthropicProvider } from "../worker/ai/anthropic";
import { DEFAULT_MODELS, MAX_OUTPUT_TOKENS, effortFor } from "../worker/ai/models";
import { instructionFor, SYSTEM_PROMPT } from "../worker/ai/prompt";
import type { AiPart, AiProvider, ImageType } from "../worker/ai/provider";
import {
  reportMarkdown,
  runScorecard,
  type Importer,
  type InputFile,
  type Sample,
  type SampleKind,
  type SampleResult,
} from "./scorecard";

// The model comparison (phase E7, spec.md E7 step 7): runs the quality test set's photos, pages,
// screenshots and PDFs through the AI three ways, and prints accuracy and cost side by side:
//
// - the cheaper model alone (Claude Haiku to start);
// - the stronger model alone (Claude Sonnet);
// - the cheaper model with a second look by the stronger one when its answer looks wrong (what
//   Fennl does, decided 2026-10-12), with the mistakes that setup let through.
//
//   ANTHROPIC_API_KEY=... npm run ai:compare
//
// It calls the real API, so it costs money: about a dollar for the current test set. Run it from
// GitHub (Actions › AI model comparison › Run workflow; .github/workflows/ai-compare.yml), where
// the key is a repository secret. Writes import-quality/ai-report.md.

const KINDS: readonly SampleKind[] = ["card", "cookbook", "screenshot", "pdf"];

const SOURCE: Partial<Record<SampleKind, ImportSource>> = {
  card: "photo",
  cookbook: "photo",
  screenshot: "screenshot",
  pdf: "pdf",
};

const IMAGE_TYPES: Record<string, ImageType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function toParts(files: InputFile[]): { parts: AiPart[]; inputs: DraftInput[] } {
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

async function read(
  provider: AiProvider,
  model: string,
  level: number,
  sample: Sample,
  files: InputFile[],
  spent: Tally,
): Promise<RecipeDraft[] | null> {
  const source = SOURCE[sample.kind] ?? "photo";
  const { parts, inputs } = toParts(files);
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
  spent.microUsd += provider.costMicroUsd(model, result.tokens);
  if (!result.ok) {
    console.warn(`${sample.id} (${model}): ${result.problem} ${result.detail ?? ""}`);
    return null;
  }
  if (!isAiAnswer(result.output)) {
    console.warn(`${sample.id} (${model}): answer of the wrong shape`);
    return null;
  }
  return answerToDrafts(result.output, { source, inputs, photos: [], model });
}

function importers(provider: AiProvider, cheap: string, strong: string) {
  const spent = { cheap: tally(), strong: tally(), switching: tally() };
  const alone = (name: string, model: string, level: number, t: Tally): Importer => ({
    name,
    kinds: KINDS,
    run: async (files, sample) => {
      t.samples += 1;
      return (await read(provider, model, level, sample, files, t)) ?? [];
    },
  });
  const switching: Importer = {
    name: `${cheap}, then ${strong} when needed`,
    kinds: KINDS,
    run: async (files, sample) => {
      const t = spent.switching;
      t.samples += 1;
      const first = await read(provider, cheap, 0, sample, files, t);
      const reasons = first ? secondLookReasons(first, SECOND_LOOK_DEFAULTS) : ["no_answer"];
      t.looked.set(sample.id, reasons.length > 0);
      if (reasons.length === 0 || (first && first.length === 0)) return first ?? [];
      t.secondLooks += 1;
      const second = await read(provider, strong, 1, sample, files, t);
      return second && second.length > 0 ? second : (first ?? []);
    },
  };
  return {
    spent,
    list: [
      alone(`${cheap} alone`, cheap, 0, spent.cheap),
      alone(`${strong} alone`, strong, 1, spent.strong),
      switching,
    ],
  };
}

const dollars = (micro: number) => `$${(micro / 1_000_000).toFixed(3)}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("Set ANTHROPIC_API_KEY to run the model comparison (it calls the real API).");
    process.exit(2);
  }
  const [cheap, strong] = (process.env.AI_MODELS?.split(",").map((m) => m.trim()) ??
    DEFAULT_MODELS) as [string, string];
  const provider = new AnthropicProvider(key);
  if (!provider.knows(cheap) || !provider.knows(strong)) {
    console.error(`Unknown model in ${cheap}, ${strong}`);
    process.exit(2);
  }
  const { spent, list } = importers(provider, cheap, strong);
  const card = await runScorecard(list);
  const [cheapName, strongName, switchName] = list.map((i) => i.name) as [string, string, string];

  // Where the switch kept the cheaper model's answer, but the stronger model did clearly better:
  // the mistakes the second look didn't catch.
  const by = (name: string) =>
    new Map(card.results.filter((r) => r.importer === name).map((r) => [r.sample.id, r]));
  const strongResults = by(strongName);
  const missed = [...by(switchName).values()].filter((r: SampleResult) => {
    const better = strongResults.get(r.sample.id);
    return (
      spent.switching.looked.get(r.sample.id) === false &&
      better &&
      better.overall - r.overall >= 0.05
    );
  });

  const rows = [
    [cheapName, spent.cheap],
    [strongName, spent.strong],
    [switchName, spent.switching],
  ] as const;
  const out = [
    reportMarkdown(card).replace("# Import quality", "# AI model comparison"),
    "## Cost",
    "",
    "| Way of reading | Samples | Calls | Estimated cost | Per sample | Second looks |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      ([name, t]) =>
        `| ${name} | ${t.samples} | ${t.calls} | ${dollars(t.microUsd)} | ${dollars(t.microUsd / Math.max(1, t.samples))} | ${
          name === switchName
            ? `${t.secondLooks} (${pct(t.secondLooks / Math.max(1, t.samples))})`
            : "–"
        } |`,
    ),
    "",
    "## Missed by the switch",
    "",
    "Samples where the cheaper model's answer looked right, so no second look was asked for, but the stronger model scored at least 5 points higher.",
    "",
    ...(missed.length
      ? missed.map(
          (r) =>
            `- ${r.sample.id}: ${pct(r.overall)} against ${pct(strongResults.get(r.sample.id)?.overall ?? 0)}`,
        )
      : ["None."]),
    "",
    `Prices: Anthropic's (worker/ai/anthropic.ts). Run on ${new Date().toISOString().slice(0, 10)}.`,
  ].join("\n");
  await writeFile(join(import.meta.dirname, "ai-report.md"), `${out}\n`);
  console.log(out);
}

await main();
