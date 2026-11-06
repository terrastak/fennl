import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { navigate, usePath, useSearchString } from "../navigation";
import { useCategoryTree, useIngredientMatches, useRecipeList, useSearch } from "../sync/useSync";
import {
  filtersFromParams,
  filtersToParams,
  ingredientWords,
  NO_FILTERS,
  parseSearch,
  searchKey,
  type RecipeFilters,
} from "./filters";
import { libraryCounts, showingEverything } from "./library";
import { LibraryContext, today, type Library } from "./libraryContext";
import { quickSearchWords } from "./quickSearchFilters";
import { useQuickSearches } from "./quickSearches";
import { useSavedSearches } from "./savedSearches";

// The recipe box, shared by the left panel and the recipe list (U17): the address says what is
// searched for and picked (filters.ts), and both read the recipes, categories and search from
// this one place, so the device's copy is read once for the two of them.

/**
 * The saved search chosen last (U20), and the lists reached from it since: the heading names it
 * only on those, so a category picked anywhere else (a recipe's category, the Categories page,
 * Back to a list from before) ends it. Kept across a reload of this tab.
 */
interface Choice {
  id: string;
  trail: string[];
}

const CHOSEN_KEY = "fennl:chosen-search";
const NO_CHOICE: Choice = { id: "", trail: [] };
const MAX_TRAIL = 50;

/** The list address the list itself is going to (a filter, the search box), set as it goes. */
const changingTo = { address: null as string | null };

function rememberedChoice(address: string, onList: boolean): Choice {
  try {
    const kept = JSON.parse(sessionStorage.getItem(CHOSEN_KEY) ?? "null") as Choice | null;
    if (!kept || typeof kept.id !== "string" || !Array.isArray(kept.trail)) return NO_CHOICE;
    // Opened at another list (a bookmark, an address typed): that isn't the saved search's.
    if (onList && !kept.trail.includes(address)) return NO_CHOICE;
    return { id: kept.id, trail: kept.trail.filter((a) => typeof a === "string") };
  } catch {
    return NO_CHOICE;
  }
}

function withAddress(choice: Choice, address: string): Choice {
  return choice.trail.includes(address)
    ? choice
    : { id: choice.id, trail: [...choice.trail, address].slice(-MAX_TRAIL) };
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const path = usePath();
  const address = useSearchString();
  const onList = path === "/";
  const listAddress = onList ? address : "";
  const query = useMemo(() => new URLSearchParams(listAddress).get("q") ?? "", [listAddress]);
  const filters = useMemo(
    () => (listAddress ? filtersFromParams(new URLSearchParams(listAddress)) : NO_FILTERS),
    [listAddress],
  );
  const recipes = useRecipeList();
  const tree = useCategoryTree();
  const search = useSearch(query);
  const words = ingredientWords(filters);
  const ingredients = useIngredientMatches(words);
  const saved = useSavedSearches();
  const quick = useQuickSearches(saved.searches);
  // The quick searches' ingredient words the filters don't ask about, asked for apart, so the
  // list itself never waits for them (only their lines' counts do).
  const quickWords = quickSearchWords(quick.items).filter(
    (word) => !words.some((w) => w.toLocaleLowerCase() === word.toLocaleLowerCase()),
  );
  const quickIngredients = useIngredientMatches(quickWords);
  // The saved search the heading names (U20): chosen from its line, or the one the list was
  // exactly last. Kept while the list changes through its own filters and search box (and on
  // coming back to a list reached that way); forgotten once it's deleted, when the list shows
  // everything again, or on any other list.
  const [choice, setChoice] = useState(() => rememberedChoice(listAddress, onList));
  const setChosenSearch = useCallback(
    (id: string) => setChoice(id ? { id, trail: [] } : NO_CHOICE),
    [],
  );
  const isChosenExactly = (id: string) => {
    const search = saved.searches?.find((s) => s.id === id);
    if (!search) return false;
    const parsed = parseSearch(search.query);
    return searchKey(parsed.q, parsed.filters) === searchKey(query, filters);
  };
  const [seenAddress, setSeenAddress] = useState(listAddress);
  const chosenGone =
    choice.id !== "" && saved.searches !== null && !saved.searches.some((s) => s.id === choice.id);
  if (choice.id !== "" && (chosenGone || (onList && showingEverything(query, filters)))) {
    setChoice(NO_CHOICE);
  } else if (onList && seenAddress !== listAddress) {
    setSeenAddress(listAddress);
    if (choice.id !== "") {
      const kept =
        changingTo.address === listAddress ||
        choice.trail.includes(listAddress) ||
        isChosenExactly(choice.id);
      setChoice(kept ? withAddress(choice, listAddress) : NO_CHOICE);
    }
  } else if (
    onList &&
    choice.id !== "" &&
    !choice.trail.includes(listAddress) &&
    isChosenExactly(choice.id)
  ) {
    // Chosen here (from its line, or just saved): this list is part of it.
    setChoice(withAddress(choice, listAddress));
  }
  const chosenSearch = choice.id;
  useEffect(() => {
    try {
      if (choice.id) sessionStorage.setItem(CHOSEN_KEY, JSON.stringify(choice));
      else sessionStorage.removeItem(CHOSEN_KEY);
    } catch {
      // Not kept; the heading names the search while the page stays open.
    }
  }, [choice]);

  const searching = query.trim() !== "";
  const counts = useMemo(() => {
    if (!recipes || (searching && !search)) return null;
    const matching = searching && search ? new Set(search.ids) : null;
    // The filters' words must be answered (null until they are, when there are any); the quick
    // searches' own are added as they arrive.
    const answers =
      words.length > 0 && !ingredients
        ? null
        : ingredients || quickIngredients
          ? { ...quickIngredients, ...ingredients }
          : null;
    return libraryCounts(recipes, filters, answers, today(), matching, quick.items);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `words` follows `filters`.
  }, [recipes, filters, ingredients, quickIngredients, search, searching, quick.items]);

  const value = useMemo<Library>(() => {
    const hrefFor = (q: string, next: RecipeFilters) => {
      const params = filtersToParams(q, next, (key) => tree?.byKey.get(key)?.path).toString();
      return params ? `/?${params}` : "/";
    };
    return {
      onList,
      query,
      filters,
      recipes,
      tree,
      search: searching ? search : null,
      ingredients,
      counts,
      saved,
      quick,
      chosenSearch,
      setChosenSearch,
      hrefFor,
      show: (q, next, options = {}) => {
        const href = hrefFor(q, next);
        changingTo.address = href.slice(1);
        navigate(href, { replace: onList && options.replace === true });
      },
    };
  }, [
    onList,
    query,
    filters,
    recipes,
    tree,
    search,
    searching,
    ingredients,
    counts,
    saved,
    quick,
    chosenSearch,
    setChosenSearch,
  ]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}
