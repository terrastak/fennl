import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RecipeDraft } from "../shared/importDraft";
import { reportMarkdown, runScorecard, SAMPLE_KINDS, type Importer } from "./scorecard";
import { savedDrafts, type SavedAnswer } from "./secondLookReport";

// Re-scores the answers a model comparison saved (ai-answers.json, kept with the "AI model
// comparison" workflow's run) against today's correct answers, without calling the AI: free.
// For when a correct answer is corrected after a run; only a change to Fennl's own instructions
// or rules needs a new, paid run (owner's request 2026-10-21).
//
//   npm run ai:rescore -- path/to/ai-answers.json
//
// Writes import-quality/ai-rescore.md. Private samples are scored too (their files aren't needed).

interface Saved {
  cheap: string;
  strong: string;
  answers: SavedAnswer[];
}

const key = (a: SavedAnswer) => `${a.set}|${a.sample}`;

/** Each way of reading in the run, and the drafts it ended with for each sample. */
function ways(saved: Saved): Map<string, Map<string, RecipeDraft[]>> {
  const out = new Map<string, Map<string, RecipeDraft[]>>();
  const add = (way: string, sample: string, drafts: RecipeDraft[]) => {
    const forWay = out.get(way) ?? new Map<string, RecipeDraft[]>();
    forWay.set(sample, [...(forWay.get(sample) ?? []), ...drafts]);
    out.set(way, forWay);
  };
  for (const a of saved.answers.filter((x) => x.way === "alone")) {
    add(`${a.model} alone (${a.set})`, a.sample, savedDrafts(a) ?? []);
  }
  // Fennl's way: the cheaper model's answer, or the second look's where there was one.
  for (const first of saved.answers.filter((x) => x.way === "first")) {
    const second = saved.answers.find(
      (x) => x.way === "second_look" && key(x) === key(first) && x.recipe === first.recipe,
    );
    const chosen = savedDrafts(second);
    add(
      `${saved.cheap}, then ${saved.strong} when needed (${first.set})`,
      first.sample,
      chosen && chosen.length > 0 ? chosen : (savedDrafts(first) ?? []),
    );
  }
  // A PDF where no recipe was found has only its "find" answer: nothing found counts too.
  for (const find of saved.answers.filter((x) => x.way === "find")) {
    for (const [way, bySample] of out) {
      if (
        way.startsWith(find.model) &&
        way.endsWith(`(${find.set})`) &&
        !bySample.has(find.sample)
      ) {
        bySample.set(find.sample, []);
      }
    }
  }
  return out;
}

async function main() {
  const path = process.argv[2] ?? join(import.meta.dirname, "ai-answers.json");
  const saved = JSON.parse(await readFile(path, "utf8")) as Saved;
  process.env.PRIVATE_SAMPLES = "1";
  const importers: Importer[] = [...ways(saved)].map(([name, bySample]) => ({
    name,
    kinds: SAMPLE_KINDS,
    needsFiles: false,
    accepts: (sample) => Promise.resolve(bySample.has(sample.id)),
    run: (_files, sample) => Promise.resolve(bySample.get(sample.id) ?? []),
  }));
  const card = await runScorecard(importers);
  const cost = saved.answers.reduce((sum, a) => sum + a.costMicroUsd, 0);
  const out = [
    reportMarkdown(card).replace("# Import quality", "# AI model comparison, re-scored"),
    `Re-scored from ${path} against today's correct answers, with no new AI calls. The run itself cost about $${(cost / 1_000_000).toFixed(2)}.`,
  ].join("\n");
  await writeFile(join(import.meta.dirname, "ai-rescore.md"), `${out}\n`);
  console.log(out);
}

await main();
