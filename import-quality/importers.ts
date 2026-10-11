import { readWebRecipes } from "../shared/webRecipe";
import type { Importer } from "./scorecard";

/** Pages with Schema.org recipe data (phase E3): reads the saved copy of the page. */
const webStructured: Importer = {
  name: "web (structured data)",
  kinds: ["web"],
  run: (files, sample) => {
    const page = files[0];
    if (!page) return Promise.resolve([]);
    return Promise.resolve(
      readWebRecipes(new TextDecoder().decode(page.bytes), sample.url ?? null),
    );
  },
};

/**
 * Every importer the scorecard runs. Each phase that builds one adds it here: structured web
 * data (E3), the AI fallback for pages (E8), cards and printed pages (E10), screenshots (E11),
 * PDFs (E12) and Paprika files (E13).
 */
export const IMPORTERS: readonly Importer[] = [webStructured];
