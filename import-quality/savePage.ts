import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { draftContent } from "../shared/importDraft";
import { readWebRecipes } from "../shared/webRecipe";
import { trimPage } from "../shared/pageSnapshot";

/**
 * Adds a web page to the quality test set (phase E3):
 *
 *   npm run import:save-page -- <sample-id> <page address> [saved .html file]
 *
 * Reads the page (from the saved file when given, e.g. one saved with "Save Page As" while
 * signed in to a site, else from its address), writes a trimmed copy to test_pages/ (see
 * shared/pageSnapshot.ts), checks the importer reads the copy just as it reads the whole page, and prints
 * what it reads as a first draft of the correct answer. Add the sample to samples.json and
 * write its correct answer in expected/ (README.md).
 */

const [id, url, file] = process.argv.slice(2);
if (!id || !url || !/^[a-z0-9-]+$/.test(id)) {
  console.error("Usage: npm run import:save-page -- <sample-id> <page address> [saved .html file]");
  process.exit(1);
}

const html = file ? await readFile(file, "utf8") : await (await fetch(url)).text();
const saved = new Date().toISOString().slice(0, 10);
const trimmed = trimPage(html, url, `Saved from ${url} on ${saved}.`);
const path = join("test_pages", `${id}.html`);
await writeFile(join(import.meta.dirname, "..", path), trimmed);

const reading = (page: string) =>
  readWebRecipes(page, url).map((draft) => {
    const content = draftContent(draft);
    return {
      ...content,
      ingredients: content.ingredients.map((l) => (l.heading ? `## ${l.text}` : l.text)),
      directions: content.directions.map((l) => (l.heading ? `## ${l.text}` : l.text)),
    };
  });
const whole = reading(html);
const copy = reading(trimmed);
console.log(`Wrote ${path} (${Math.round(trimmed.length / 1024)} KB).`);
if (JSON.stringify(whole) !== JSON.stringify(copy)) {
  console.warn(
    "The trimmed copy doesn't read the same as the whole page. Compare them before using it.",
  );
}
if (copy.length === 0) console.warn("No recipe data found on the page.");
console.log(JSON.stringify({ id, kind: "web", inputs: [path], url }, null, 2));
console.log(JSON.stringify(copy, null, 2));
