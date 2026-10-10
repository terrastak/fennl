import type { Importer } from "./scorecard";

/**
 * Every importer the scorecard runs. Each phase that builds one adds it here: structured web
 * data (E3), the AI fallback for pages (E8), cards and printed pages (E10), screenshots (E11),
 * PDFs (E12) and Paprika files (E13).
 */
export const IMPORTERS: readonly Importer[] = [];
