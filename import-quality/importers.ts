import { readPaprikaRecipe } from "../shared/paprika";
import { bytesSource, paprikaEntries, readPaprikaEntry } from "../shared/paprikaFile";
import { readPastedText } from "../shared/pastedText";
import type { RecipeDraft } from "../shared/importDraft";
import { readWebRecipes } from "../shared/webRecipe";
import type { Importer } from "./scorecard";

/** Pages with Schema.org recipe data (phase E3): reads the saved copy of the page. */
const webStructured: Importer = {
  name: "web (structured data)",
  kinds: ["web"],
  exact: true,
  run: (files, sample) => {
    const page = files[0];
    if (!page) return Promise.resolve([]);
    return Promise.resolve(
      readWebRecipes(new TextDecoder().decode(page.bytes), sample.url ?? null),
    );
  },
};

/** Clearly laid out pasted text (phase E15): read by Fennl's own rules, without the AI. */
const pastedText: Importer = {
  name: "pasted text (laid out)",
  kinds: ["text"],
  exact: true,
  accepts: (sample) => Promise.resolve(sample.by !== "ai"),
  run: (files) => {
    const file = files[0];
    if (!file) return Promise.resolve([]);
    const read = readPastedText(new TextDecoder().decode(file.bytes));
    return Promise.resolve(read.kind === "recipe" ? [read.draft] : []);
  },
};

/** Paprika 3 export files (phase E13): read as the app reads them, one recipe at a time. */
const paprikaFile: Importer = {
  name: "Paprika file",
  kinds: ["paprika"],
  exact: true,
  run: async (files) => {
    const drafts: RecipeDraft[] = [];
    for (const file of files) {
      const source = bytesSource(file.bytes);
      for (const entry of (await paprikaEntries(source)).recipes) {
        const read = readPaprikaRecipe(await readPaprikaEntry(source, entry), entry.name);
        if (!("problem" in read)) drafts.push(read.draft);
      }
    }
    return drafts;
  },
};

/**
 * Every importer the scorecard runs on each pull request. Each phase that builds one adds it
 * here: structured web data (E3), clearly laid out pasted text (E15) and Paprika files (E13). Importers that call the AI (pages
 * without recipe data, E8; cards, pages, screenshots and PDFs, E10 to E12) cost money each time,
 * so they're measured by the AI model comparison instead (aiCompare.ts), started by hand.
 */
export const IMPORTERS: readonly Importer[] = [webStructured, pastedText, paprikaFile];
