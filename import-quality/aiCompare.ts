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
import { documentKind, documentText } from "../shared/documentText";
import type { DraftInput, RecipeDraft } from "../shared/importDraft";
import { pageForAi } from "../shared/pageText";
import {
  PDF_FIND_SCHEMA,
  PDF_LABELS,
  PDF_RULES,
  pdfRecipes,
  type PdfRecipe,
} from "../shared/pdfImport";
import type { ImportSource } from "../shared/recipe";
import { AnthropicProvider } from "../worker/ai/anthropic";
import { FakeProvider } from "../worker/ai/fake";
import { DEFAULT_MODELS, MAX_OUTPUT_TOKENS, effortFor } from "../worker/ai/models";
import {
  FIND_INSTRUCTION,
  FIND_OUTPUT_TOKENS,
  FIND_SYSTEM,
  instructionFor,
  SYSTEM_PROMPT,
} from "../worker/ai/prompt";
import type { AiPart, AiProvider, ImageType } from "../worker/ai/provider";
import { MIN_PAGE_TEXT, pageAiPart } from "../worker/import/aiPage";
import { openPdf, type OpenedPdf } from "./pdfPages";
import {
  cookingScore,
  expectedFor,
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
// - the stronger model alone (Claude Opus);
// - the cheaper model with a second look by the stronger one when its answer looks wrong (what
//   Fennl does, decided 2026-10-12), with the mistakes that setup let through.
//
// A PDF is read as the app reads it (phase E12): opened here with the same pdf.js, its recipes
// found in one quick read of every page (its text, or a picture of a scanned page), then each
// recipe read on its own from pictures of its pages and their text. Each recipe gets its own
// second look.
//
//   ANTHROPIC_API_KEY=... npm run ai:compare
//   AI_COMPARE_FAKE=1 npm run ai:compare     (the stand-in AI: checks the script, costs nothing)
//
// AI_COMPARE_WAYS=fennl reads only Fennl's own way (about a fifth of the cost), for measuring
// changes to Fennl's instructions; the default compares all three. Re-scoring a run's saved
// answers after a correct answer changes is free: npm run ai:rescore -- ai-answers.json.
//
// AI_COMPARE_SETS picks what it reads: "photos" (the default: the photos, cookbook pages,
// screenshots and PDFs), "web" (the web pages with their recipe data left out, read from the
// page's text as Fennl does for a page without data, phase E8), "text" (pasted text, phase E15,
// and documents, E18), or "all".
//
// It calls the real API, so it costs money: about $6 for the photos (cards, pages, screenshots
// and PDFs, private samples included; estimated 2026-10-21) with all three ways, about $1.50 with
// only Fennl's own, and about another dollar for the web pages. Run it from GitHub (Actions › AI model comparison › Run workflow;
// .github/workflows/ai-compare.yml), where the key is a repository secret. Writes
// import-quality/ai-report.md.

/** Which ways of reading a run compares: all three, or only Fennl's own (AI_COMPARE_WAYS). */
type Ways = "all" | "fennl";

const SETS = {
  photos: { label: "photos", kinds: ["card", "cookbook", "screenshot", "pdf"] },
  web: { label: "web pages without recipe data", kinds: ["web"] },
  text: { label: "pasted text and documents", kinds: ["text", "document"] },
} as const satisfies Record<string, { label: string; kinds: readonly SampleKind[] }>;

type SetName = keyof typeof SETS;

const SOURCE: Partial<Record<SampleKind, ImportSource>> = {
  card: "photo",
  cookbook: "photo",
  screenshot: "screenshot",
  pdf: "pdf",
  web: "website",
  text: "text",
  document: "text",
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
  // A document (phase E18): its text, taken out as the app does, read as pasted text is.
  if (sample.kind === "document" && first) {
    const kind = documentKind(first.name);
    if (!kind || kind === "doc" || kind === "pages" || kind === "odt") {
      throw new Error(`${first.name}: not a document Fennl reads`);
    }
    return {
      parts: [
        {
          kind: "text",
          label: `The text of a document, ${first.name}`,
          text: documentText(kind, first.bytes).text,
        },
      ],
      inputs: [{ kind: "text", name: first.name, url: null, imageHash: null }],
    };
  }
  const parts = files.map((file, i): AiPart => {
    const label = `Input ${i + 1} (${file.name})`;
    const ext = extname(file.name).toLowerCase();
    const mediaType = IMAGE_TYPES[ext];
    if (!mediaType) throw new Error(`${file.name}: not a photo`);
    return { kind: "image", mediaType, bytes: file.bytes, label };
  });
  const inputs = files.map((file): DraftInput => ({
    kind: "image",
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

interface Record_ {
  set: SetName;
  way: Way;
  /** A PDF's recipe, read on its own. */
  recipe?: string;
}

/** One read by the AI, recorded and costed, as drafts (as Fennl keeps them), or null. */
async function ask(
  provider: AiProvider,
  model: string,
  level: number,
  sample: Sample,
  request: { source: ImportSource; parts: AiPart[]; inputs: DraftInput[]; instruction: string },
  spent: Tally,
  record: Record_,
): Promise<RecipeDraft[] | null> {
  const { source, parts, inputs, instruction } = request;
  const result = await provider.read({
    model,
    system: SYSTEM_PROMPT,
    parts,
    instruction,
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
  const what = record.recipe ? `${sample.id} › ${record.recipe}` : sample.id;
  if (!result.ok) {
    console.warn(`${what} (${model}): ${result.problem} ${result.detail ?? ""}`);
    return null;
  }
  if (!isAiAnswer(result.output)) {
    console.warn(`${what} (${model}): answer of the wrong shape`);
    return null;
  }
  // As Fennl keeps them (worker/ai/read.ts): a part that breaks the rules is left out.
  return answerToDrafts(result.output, { source, inputs, photos: [], model }).flatMap((d) => {
    const kept = withoutBadParts(d, null);
    return kept ? [kept] : [];
  });
}

async function read(
  provider: AiProvider,
  model: string,
  level: number,
  sample: Sample,
  files: InputFile[],
  spent: Tally,
  record: Record_,
): Promise<RecipeDraft[] | null> {
  const source = SOURCE[sample.kind] ?? "photo";
  const { parts, inputs } = toParts(files, sample);
  return ask(
    provider,
    model,
    level,
    sample,
    { source, parts, inputs, instruction: instructionFor(source) },
    spent,
    record,
  );
}

// The sizes the app draws a PDF's pages at (app/pdf/PdfImport.tsx). A recipe's pages are then
// made WebP about 90 like any page photo (spec.md D2).
const FIND_PICTURE_EDGE = 1200;
const PAGE_PICTURE_EDGE = 2400;

/** The recipes found in a PDF, as the app asks for them (worker/ai/find.ts). */
async function findInPdf(
  provider: AiProvider,
  model: string,
  sample: Sample,
  pdf: OpenedPdf,
  spent: Tally,
  set: SetName,
): Promise<PdfRecipe[]> {
  const parts: AiPart[] = [];
  for (const { page, text, kind } of pdf.pages) {
    parts.push(
      kind === "text"
        ? {
            kind: "text",
            text: text.slice(0, PDF_RULES.pageTextChars),
            label: PDF_LABELS.findText(page),
          }
        : {
            kind: "image",
            mediaType: "image/jpeg",
            bytes: await pdf.picture(page, FIND_PICTURE_EDGE, "jpeg", 70),
            label: PDF_LABELS.findPicture(page),
          },
    );
  }
  const result = await provider.read({
    model,
    system: FIND_SYSTEM,
    parts,
    instruction: FIND_INSTRUCTION,
    schema: PDF_FIND_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
    maxOutputTokens: FIND_OUTPUT_TOKENS,
  });
  spent.calls += 1;
  const cost = provider.costMicroUsd(model, result.tokens);
  spent.microUsd += cost;
  answers.push({
    set,
    way: "find",
    sample: sample.id,
    model,
    source: "pdf",
    inputs: [],
    ok: result.ok,
    problem: result.ok ? null : `${result.problem} ${result.detail ?? ""}`.trim(),
    output: result.ok ? result.output : null,
    costMicroUsd: cost,
  });
  const found = result.ok ? pdfRecipes(result.output, pdf.pages.length) : null;
  if (!found) console.warn(`${sample.id} (${model}): no recipes found`);
  return found ?? [];
}

/** One of a PDF's recipes, read from its pages as the app sends them (worker/import/photoImport.ts). */
async function readPdfRecipe(
  provider: AiProvider,
  model: string,
  level: number,
  sample: Sample,
  file: InputFile,
  pdf: OpenedPdf,
  recipe: PdfRecipe,
  spent: Tally,
  record: Record_,
): Promise<RecipeDraft[] | null> {
  const pages = pdf.pages.slice(recipe.firstPage - 1, recipe.lastPage);
  const parts: AiPart[] = [];
  for (const { page } of pages) {
    parts.push({
      kind: "image",
      mediaType: "image/webp",
      bytes: await pdf.picture(page, PAGE_PICTURE_EDGE, "webp", 90),
      label: PDF_LABELS.readPicture(page),
    });
  }
  for (const { page, text, kind } of pages) {
    if (kind === "text" && text) {
      parts.push({ kind: "text", text, label: PDF_LABELS.readText(page) });
    }
  }
  const inputs = pages.map(({ page }): DraftInput => ({
    kind: "image",
    name: `${file.name}, page ${page}`,
    url: null,
    imageHash: null,
  }));
  const drafts = await ask(
    provider,
    model,
    level,
    sample,
    { source: "pdf", parts, inputs, instruction: instructionFor("pdf", recipe.title) },
    spent,
    { ...record, recipe: recipe.title },
  );
  // One draft for each recipe read, as Fennl keeps it (createAiImport's limit).
  return drafts?.slice(0, 1) ?? null;
}

/** A PDF opened as the app opens it, closed when done. */
async function withPdf<T>(
  files: InputFile[],
  use: (file: InputFile, pdf: OpenedPdf) => Promise<T>,
) {
  const file = files[0];
  if (!file) throw new Error("A PDF sample needs its PDF");
  const pdf = await openPdf(file.bytes);
  try {
    return await use(file, pdf);
  } finally {
    await pdf.close();
  }
}

function importers(provider: AiProvider, cheap: string, strong: string, set: SetName, ways: Ways) {
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
      if (sample.kind === "pdf") {
        return withPdf(files, async (file, pdf) => {
          const drafts: RecipeDraft[] = [];
          for (const recipe of await findInPdf(provider, model, sample, pdf, t, set)) {
            const read = await readPdfRecipe(provider, model, level, sample, file, pdf, recipe, t, {
              set,
              way: "alone",
            });
            drafts.push(...(read ?? []));
          }
          return drafts;
        });
      }
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
      if (sample.kind === "pdf") return switchPdf(files, sample, t);
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
  /** A PDF: found by the cheaper model, then each recipe read with its own second look. */
  async function switchPdf(files: InputFile[], sample: Sample, t: Tally) {
    const expected = (await loadExpected(sample.id)) ?? [];
    return withPdf(files, async (file, pdf) => {
      const drafts: RecipeDraft[] = [];
      let looked = false;
      for (const recipe of await findInPdf(provider, cheap, sample, pdf, t, set)) {
        const title = recipe.title;
        const first = await readPdfRecipe(provider, cheap, 0, sample, file, pdf, recipe, t, {
          set,
          way: "first",
        });
        const findings = first
          ? secondLookFindings(first, SECOND_LOOK_DEFAULTS)
          : [{ reason: "no_answer" as const, detail: "no usable answer" }];
        const theirs = expectedFor(expected, title);
        const look: LookRecord = {
          set,
          sample: `${sample.id} › ${title}`,
          findings,
          first: cookingScore(scoreDrafts(theirs, first ?? [])),
          second: null,
        };
        looks.push(look);
        if (findings.length === 0) {
          drafts.push(...(first ?? []));
          continue;
        }
        looked = true;
        const second = await readPdfRecipe(provider, strong, 1, sample, file, pdf, recipe, t, {
          set,
          way: "second_look",
        });
        look.second = cookingScore(scoreDrafts(theirs, second ?? []));
        drafts.push(...(second && second.length > 0 ? second : (first ?? [])));
      }
      t.looked.set(sample.id, looked);
      if (looked) t.secondLooks += 1;
      return drafts;
    });
  }

  const cheapAlone = alone(cheap, 0, spent.cheap);
  const strongAlone = alone(strong, 1, spent.strong);
  return {
    spent,
    names: { cheap: cheapAlone.name, strong: strongAlone.name, switching: switching.name },
    list: ways === "fennl" ? [switching] : [cheapAlone, strongAlone, switching],
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
  // AI_COMPARE_WAYS=fennl reads only the way Fennl reads (the cheaper model, with the stronger
  // one's second look when needed): a fraction of the cost, for measuring Fennl's own changes.
  const ways: Ways = process.env.AI_COMPARE_WAYS === "fennl" ? "fennl" : "all";
  const groups = sets.map((set) => importers(provider, cheap, strong, set, ways));
  const card = await runScorecard(groups.flatMap((g) => g.list));
  const by = (name: string) =>
    new Map(card.results.filter((r) => r.importer === name).map((r) => [r.sample.id, r]));

  const costRows: string[] = [];
  const missedLines: string[] = [];
  for (const { spent, names } of groups) {
    const { cheap: cheapName, strong: strongName, switching: switchName } = names;
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
    const rows = (
      [
        [cheapName, spent.cheap],
        [strongName, spent.strong],
        [switchName, spent.switching],
      ] as const
    ).filter(([, t]) => t.samples > 0);
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
    ...(ways === "all"
      ? [
          "## Missed by the switch",
          "",
          "Samples where the cheaper model's answer looked right, so no second look was asked for, but the stronger model scored at least 5 points higher.",
          "",
          ...(missedLines.length ? missedLines : ["None."]),
          "",
        ]
      : [
          "Only Fennl's own way of reading was run (AI_COMPARE_WAYS=fennl): the cheaper model, with the stronger one's second look when needed.",
          "",
        ]),
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
