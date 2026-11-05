import { useMemo, useState, type ReactNode } from "react";
import { navigate, usePath, useSearchString } from "../navigation";
import { useCategoryTree, useIngredientMatches, useRecipeList, useSearch } from "../sync/useSync";
import {
  filtersFromParams,
  filtersToParams,
  ingredientWords,
  NO_FILTERS,
  type RecipeFilters,
} from "./filters";
import { libraryCounts } from "./library";
import { LibraryContext, today, type Library } from "./libraryContext";
import { quickSearchWords } from "./quickSearchFilters";
import { useQuickSearches } from "./quickSearches";
import { useSavedSearches } from "./savedSearches";

// The recipe box, shared by the left panel and the recipe list (U17): the address says what is
// searched for and picked (filters.ts), and both read the recipes, categories and search from
// this one place, so the device's copy is read once for the two of them.

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
  const [chosenSearch, setChosenSearch] = useState("");

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
      show: (q, next, options = {}) =>
        navigate(hrefFor(q, next), { replace: onList && options.replace === true }),
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
  ]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}
