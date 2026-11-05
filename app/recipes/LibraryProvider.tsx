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
  const ingredients = useIngredientMatches(ingredientWords(filters));
  const saved = useSavedSearches();
  const [chosenSearch, setChosenSearch] = useState("");

  const searching = query.trim() !== "";
  const counts = useMemo(() => {
    if (!recipes || (searching && !search)) return null;
    const matching = searching && search ? new Set(search.ids) : null;
    return libraryCounts(recipes, filters, ingredients, today(), matching);
  }, [recipes, filters, ingredients, search, searching]);

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
    chosenSearch,
  ]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}
