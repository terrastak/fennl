import { navigate, queryParam } from "../navigation";

// Several recipes printed at once (phase F6): the recipe list hands the ones it shows, or the
// ones ticked, to the print page. They're kept for this tab only, so a reload of the print page
// still has them, and a long list never goes in the address.

const KEY = "fennl:print-list";

/** Opens the print page for these recipes, coming back to `back` afterwards. */
export function printRecipes(ids: readonly string[], back: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Not kept; the print page then says there's nothing to print.
  }
  navigate(`/print?back=${encodeURIComponent(back)}`);
}

/** The recipes handed to the print page, in order. */
export function recipesToPrint(): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Where the print page goes back to: only an address inside the app. */
export function printBack(fallback: string): string {
  const back = queryParam("back");
  return back?.startsWith("/") && !back.startsWith("//") ? back : fallback;
}

/** Photos not yet shown: printing waits for them, at most a few seconds. */
export async function photosReady(root: HTMLElement | null, waitMs = 8000): Promise<void> {
  const until = Date.now() + waitMs;
  while (root && Date.now() < until) {
    const loading =
      root.querySelector("[data-photo-loading]") !== null ||
      [...root.querySelectorAll("img")].some((img) => !img.complete);
    if (!loading) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The paper's size and margins for a layout, for the browser's print. */
export function pageRule(layout: string): string {
  const page =
    layout === "card4x6"
      ? "size: 6in 4in; margin: 0.25in;"
      : layout === "card3x5"
        ? "size: 5in 3in; margin: 0.2in;"
        : layout === "compact"
          ? "margin: 0.4in;"
          : "margin: 0.6in;";
  return `@page { ${page} }`;
}
