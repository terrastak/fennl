import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { draftContent } from "../shared/importDraft";
import { detectImageType } from "../shared/images";
import { readPaprikaRecipe } from "../shared/paprika";
import { bytesSource, paprikaEntries, readPaprikaEntry } from "../shared/paprikaFile";
import { arrangedOrder, photoLabels } from "../shared/photoOrder";
import type { RecipePhoto } from "../shared/recipe";
import { arrangeRequest } from "../worker/ai/arrangeRequest";
import { AnthropicProvider } from "../worker/ai/anthropic";
import { FakeProvider } from "../worker/ai/fake";
import { DEFAULT_MODELS } from "../worker/ai/models";
import type { AiProvider, ImageType } from "../worker/ai/provider";

// Measuring how Fennl arranges a recipe's photos (phase D4; spec.md D4 step 8): the owner's
// recipes with several photos, read from their Paprika library in the private test-samples
// repository (test-pdfs/paprika/; some of its photos are personal), with the correct cover and
// the photos that can't be placed written in photo-order.json. Each recipe's photos are shown to
// the cheapest model in reverse order, so the cover is never first by chance. Costs a fraction of
// a cent; run by the AI model comparison workflow after the comparison itself.
//
//   npm run ai:photo-order          (needs ANTHROPIC_API_KEY and test-pdfs/paprika/)
//
// Writes import-quality/photo-order-report.md.

interface Sample {
  id: string;
  recipe: string;
  notes: string;
  /** Paprika's hash of the photo that should be the cover. */
  cover: string;
  /** Paprika's hashes of photos that aren't the dish or its making: "other", at the end. */
  other: string[];
}

const LIBRARY = join(import.meta.dirname, "../test-pdfs/paprika/all-recipes.paprikarecipes");

async function main() {
  const fake = process.env.AI_COMPARE_FAKE === "1";
  const key = process.env.ANTHROPIC_API_KEY;
  const out: string[] = ["# Photos arranged by Fennl", ""];
  const library = await readFile(LIBRARY).catch(() => null);
  if (!library) {
    out.push("Not measured: the private test samples (test-pdfs/paprika/) aren't here.");
    await writeFile(join(import.meta.dirname, "photo-order-report.md"), `${out.join("\n")}\n`);
    console.log(out.join("\n"));
    return;
  }
  if (!key && !fake) {
    console.error("Set ANTHROPIC_API_KEY to measure photo order (it calls the real API).");
    process.exit(2);
  }
  const model = process.env.AI_MODELS?.split(",")[0]?.trim() || DEFAULT_MODELS[0] || "";
  const provider: AiProvider = fake ? new FakeProvider() : new AnthropicProvider(key ?? "");
  const samples = JSON.parse(
    await readFile(join(import.meta.dirname, "photo-order.json"), "utf8"),
  ) as Sample[];
  const source = bytesSource(new Uint8Array(library));
  const entries = (await paprikaEntries(source)).recipes;

  out.push(`Model: ${model}. Each recipe's photos shown in reverse order.`, "");
  out.push(
    "| Recipe | Cover | Can't-place photos last | Labels | Cost |",
    "| --- | --- | --- | --- | --- |",
  );
  let right = 0;
  let spent = 0;
  for (const sample of samples) {
    let found = null;
    for (const entry of entries) {
      const read = readPaprikaRecipe(await readPaprikaEntry(source, entry), entry.name);
      if (!("problem" in read) && read.draft.fields.title?.value === sample.recipe) found = read;
    }
    if (!found) {
      out.push(`| ${sample.recipe} | not in the library | | | |`);
      continue;
    }
    const photos = [...found.photos].reverse().flatMap((p) => {
      const bytes = Uint8Array.from(Buffer.from(p.data ?? "", "base64"));
      const type = detectImageType(bytes);
      return type && type !== "image/avif"
        ? [{ hash: p.hash, bytes, mediaType: type as ImageType }]
        : [];
    });
    const steps = draftContent(found.draft)
      .directions.filter((l) => !l.heading)
      .map((l) => l.text);
    const result = await provider.read(
      arrangeRequest(model, { title: sample.recipe, steps, photos }),
    );
    const cost = provider.costMicroUsd(model, result.tokens);
    spent += cost;
    const labels = result.ok ? photoLabels(result.output, photos.length, steps.length) : null;
    if (!labels) {
      out.push(`| ${sample.recipe} | no usable answer | | | $${(cost / 1e6).toFixed(4)} |`);
      continue;
    }
    const gallery = photos.map((p, i): RecipePhoto => ({
      id: p.hash,
      recipeId: sample.id,
      imageHash: p.hash,
      role: "photo",
      width: 1,
      height: 1,
      sortOrder: i,
      addedByUserId: "",
      updatedAt: "",
      deletedAt: null,
      serverSeq: 0,
    }));
    const order = arrangedOrder(gallery, labels).map((p) => p.imageHash);
    const coverRight = order[0] === sample.cover;
    const tail = order.slice(order.length - sample.other.length);
    const lastRight = sample.other.every((hash) => tail.includes(hash));
    if (coverRight && lastRight) right += 1;
    const kinds = photos
      .map(
        (p, i) =>
          `${p.hash === sample.cover ? "cover" : sample.other.includes(p.hash) ? "x" : "?"}: ${labels.photos[i]?.kind ?? "-"}`,
      )
      .join(", ");
    out.push(
      `| ${sample.recipe} | ${coverRight ? "right" : "wrong"} | ${lastRight ? "yes" : "no"} | ${kinds} | $${(cost / 1e6).toFixed(4)} |`,
    );
  }
  out.push(
    "",
    `${right} of ${samples.length} arranged right, for about $${(spent / 1e6).toFixed(4)} in all.`,
  );
  await writeFile(join(import.meta.dirname, "photo-order-report.md"), `${out.join("\n")}\n`);
  console.log(out.join("\n"));
}

await main();
