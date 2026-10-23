import { useId, useState } from "react";
import type { IngredientLine } from "../../shared/recipe";
import { wouldLoop } from "../../shared/subRecipes";
import { Link } from "../router";
import { useRecipeLinks, useRecipeList } from "../sync/useSync";
import editor from "./editor.module.css";

// Linking an ingredient to another recipe in the household, in the editor's preview (phase F3):
// "1 cup BBQ sauce" → the BBQ sauce recipe. A recipe that already uses this one (directly or
// through its own links) is never offered, so links can't go round in a circle.

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);

/** How well a recipe's title matches an ingredient line: how many of its words the line has. */
function likeness(title: string, line: string): number {
  const said = new Set(words(line));
  return words(title).filter(
    (w) => said.has(w) || said.has(`${w}s`) || said.has(w.replace(/s$/u, "")),
  ).length;
}

/** A linked line in the preview: the recipe it links to, and Unlink. */
export function LinkedName({ recipeId, onUnlink }: { recipeId: string; onUnlink: () => void }) {
  const recipes = useRecipeList();
  const linked = recipes?.find((r) => r.id === recipeId);
  return (
    <span className={editor.link}>
      {linked ? (
        <>
          {" → "}
          <Link href={`/recipes/${linked.id}`}>{linked.title}</Link>
        </>
      ) : recipes ? (
        <span className={editor.mark}> The linked recipe is in Trash or gone.</span>
      ) : null}{" "}
      <button type="button" className={editor.linkButton} onClick={onUnlink}>
        Unlink
      </button>
    </span>
  );
}

/** Finding a recipe to link a line to. */
export function LinkPicker({
  line,
  recipeId,
  onLink,
  onClose,
}: {
  line: IngredientLine;
  recipeId: string;
  onLink: (recipeId: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const recipes = useRecipeList();
  const links = useRecipeLinks();
  const [query, setQuery] = useState("");

  const linksOf = (rid: string) => links?.[rid] ?? [];
  const q = query.trim().toLowerCase();
  const candidates = (recipes ?? [])
    .filter((r) => r.id !== recipeId && (!links || !wouldLoop(recipeId, r.id, linksOf)))
    .map((r) => ({ recipe: r, score: likeness(r.title, line.text) }))
    .filter(({ recipe, score }) => (q ? recipe.title.toLowerCase().includes(q) : score > 0))
    .sort((a, b) => b.score - a.score || a.recipe.title.localeCompare(b.recipe.title))
    .slice(0, 6);

  return (
    <div className={editor.linkPicker} role="group" aria-label={`Link a recipe to “${line.text}”`}>
      <label htmlFor={`${id}-find`}>Find a recipe to link to &ldquo;{line.text}&rdquo;</label>
      <input
        id={`${id}-find`}
        type="search"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      />
      {candidates.length > 0 ? (
        <ul aria-label="Recipes to link">
          {candidates.map(({ recipe }) => (
            <li key={recipe.id}>
              <button type="button" className={editor.linkButton} onClick={() => onLink(recipe.id)}>
                {recipe.title}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p role="status">{q ? "No recipe by that name." : "Type part of a recipe's name."}</p>
      )}
      <button type="button" className={editor.linkButton} onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
