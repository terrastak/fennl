import type { PageForAi } from "../../shared/pageText";
import type { AiPart } from "../ai/provider";

// How a web page without recipe data is given to the AI (phase E8): its title and address, then
// its article as text. Kept apart from the import itself (aiWeb.ts) so the model comparison
// (import-quality/aiCompare.ts) reads pages exactly as Fennl does.

/** A page's text needs at least this much to hold a recipe. */
export const MIN_PAGE_TEXT = 80;

export function pageAiPart(page: PageForAi, url: string | null): AiPart {
  const head = [page.title && `Title: ${page.title}`, url && `Address: ${url}`].filter(Boolean);
  return {
    kind: "text",
    label: "The web page",
    text: [...head, "", page.text].join("\n").trim(),
  };
}
