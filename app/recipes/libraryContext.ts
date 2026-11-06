import { createContext, useContext } from "react";
import type { CategoryTree } from "../categories/tree";
import type { RecipeSummary } from "../sync/dbProtocol";
import type { SearchResults } from "../sync/search";
import type { RecipeFilters } from "./filters";
import type { LibraryCounts } from "./library";
import type { QuickSearches } from "./quickSearches";
import type { useSavedSearches } from "./savedSearches";

// The recipe box shared by the left panel and the recipe list (U17); LibraryProvider.tsx fills it.

export interface Library {
  /** Whether the recipe list is the page showing. Elsewhere nothing is searched or picked. */
  onList: boolean;
  query: string;
  filters: RecipeFilters;
  recipes: RecipeSummary[] | null;
  tree: CategoryTree | null;
  /** What the search found, or null with nothing typed (or before the first answer). */
  search: SearchResults | null;
  /** Which recipes have each ingredient word the filters ask about. */
  ingredients: Record<string, string[]> | null;
  /** How many recipes each row of the left panel would show; null until it's known. */
  counts: LibraryCounts | null;
  saved: ReturnType<typeof useSavedSearches>;
  /** The person's quick searches (U18): the left panel's lines, and the phone's in Filters. */
  quick: QuickSearches;
  /**
   * The saved search chosen last (U20): its name stays the heading, with "Update", once the
   * list has been changed. Cleared by a category, All recipes or the heading's ✕.
   */
  chosenSearch: string;
  setChosenSearch: (id: string) => void;
  /** The recipe list's address for a search and its filters. */
  hrefFor: (query: string, filters: RecipeFilters) => string;
  /** Shows a search on the recipe list. `replace` for typing, so Back skips each letter. */
  show: (query: string, filters: RecipeFilters, options?: { replace?: boolean }) => void;
}

export const LibraryContext = createContext<Library | null>(null);

/** Today as a day ("2026-10-20") in this person's own calendar, as "made it" days are. */
export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function useLibrary(): Library {
  const library = useContext(LibraryContext);
  if (!library) throw new Error("useLibrary needs a LibraryProvider (the app's frame).");
  return library;
}
