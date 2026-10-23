import { useEffect, useId, useRef, useState } from "react";
import {
  LAYOUT_NAMES,
  MAX_PRINT_RECIPES,
  PRINT_LAYOUTS,
  type PrintOptions,
} from "../../shared/print";
import { linkedIds } from "../../shared/subRecipes";
import { useHideNutrition } from "../recipes/nutritionSetting";
import { useUnits } from "../recipes/units";
import { Link } from "../router";
import { usePrintSet } from "../sync/useSync";
import { pageRule, photosReady } from "./booklet";
import { usePrintOptions } from "./printOptions";
import { Printout } from "./Printout";
import styles from "./printPage.module.css";

// The print page (phase F6). Printing one recipe should take two taps: Print on the recipe, then
// Print here, which is ready to press with the last choices used. The choices sit in a fold-out
// beside the preview for anyone who wants to change them, and are kept with the account.

const SWITCH_NAMES: { key: Exclude<keyof PrintOptions, "layout">; label: string }[] = [
  { key: "photo", label: "Cover photo" },
  { key: "notes", label: "The recipe's notes" },
  { key: "household", label: "Stars and signed notes" },
  { key: "nutrition", label: "Nutrition" },
  { key: "qr", label: "QR code to open it in Fennl" },
  { key: "linked", label: "Linked recipes, each on its own page" },
  { key: "contents", label: "Contents page" },
];

export function PrintPage({ ids, back }: { ids: string[]; back: string }) {
  const id = useId();
  const [options, choose] = usePrintOptions();
  const [units] = useUnits();
  const [hideNutrition] = useHideNutrition();
  const set = usePrintSet(ids.slice(0, MAX_PRINT_RECIPES), options.linked);
  const [saveFailed, setSaveFailed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const paper = useRef<HTMLDivElement>(null);
  const printButton = useRef<HTMLButtonElement>(null);
  const one = ids.length === 1;
  const first = set?.recipes[0]?.recipe;
  const chosen = set?.recipes.filter((r) => !r.linkedFrom).length ?? 0;
  const linked = (set?.recipes.length ?? 0) - chosen;
  const hasLinks = set?.recipes.some((r) => linkedIds(r.recipe.ingredients).length > 0) ?? false;

  // The title names the PDF a browser saves: the recipe's own name for one recipe.
  useEffect(() => {
    if (!set) return;
    document.title = one && first ? first.title || "Recipe" : "Recipes";
  }, [set, one, first]);

  // Print is ready to press as soon as there's something to print: printing a recipe is two
  // taps (owner's choice 2026-10-23).
  const ready = set !== undefined && set.recipes.length > 0;
  useEffect(() => {
    if (ready) printButton.current?.focus();
  }, [ready]);

  const change = (next: PrintOptions) => {
    setSaveFailed(false);
    void choose(next).then((saved) => setSaveFailed(!saved));
  };

  const print = async () => {
    setPreparing(true);
    await photosReady(paper.current);
    setPreparing(false);
    window.print();
  };

  const backLabel = back.startsWith("/recipes/") ? "Back to the recipe" : "Back to recipes";
  const summary = !set
    ? ""
    : one
      ? (first?.title ?? "")
      : `${chosen} ${chosen === 1 ? "recipe" : "recipes"}`;
  const plusLinked =
    linked > 0 ? ` and ${linked} linked ${linked === 1 ? "recipe" : "recipes"}` : "";

  return (
    <main id="main" className={styles.page}>
      <style>{pageRule(options.layout)}</style>
      <div className={styles.toolbar}>
        <Link href={back} className={styles.back}>
          ← {backLabel}
        </Link>
        <h1 className={styles.heading}>
          Print{summary ? `: ${summary}` : ""}
          {plusLinked}
        </h1>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            ref={printButton}
            disabled={!ready || preparing}
            onClick={() => void print()}
          >
            Print
          </button>
          <p className={styles.hint} role="status">
            {preparing
              ? "Getting the photos ready…"
              : "To save a PDF, choose it as the printer in the print window."}
          </p>
        </div>
        {ids.length > MAX_PRINT_RECIPES ? (
          <p className={styles.note}>
            A printout holds up to {MAX_PRINT_RECIPES} recipes, so the first {MAX_PRINT_RECIPES} are
            here. Print the rest after these.
          </p>
        ) : null}

        <details className={styles.choices}>
          <summary>Change what&rsquo;s printed</summary>
          <fieldset className={styles.fieldset}>
            <legend>Layout</legend>
            {PRINT_LAYOUTS.map((layout) => (
              <label key={layout} className={styles.choice}>
                <input
                  type="radio"
                  name={`${id}-layout`}
                  checked={options.layout === layout}
                  onChange={() => change({ ...options, layout })}
                />
                {LAYOUT_NAMES[layout]}
              </label>
            ))}
            {options.layout.startsWith("card") ? (
              <p className={styles.hint}>
                Choose the card size as the paper in the print window if it isn&rsquo;t already.
              </p>
            ) : null}
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend>Include</legend>
            {SWITCH_NAMES.filter(
              ({ key }) =>
                (key !== "nutrition" || !hideNutrition) &&
                (key !== "linked" || hasLinks) &&
                (key !== "contents" || chosen > 1),
            ).map(({ key, label }) => (
              <label key={key} className={styles.choice}>
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(e) => change({ ...options, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
            {options.layout.startsWith("card") ? (
              <p className={styles.hint}>Recipe cards leave out the photo and the headnote.</p>
            ) : null}
          </fieldset>
          <p className={styles.hint} role="status">
            {saveFailed
              ? "Couldn’t save these choices to your account just now; they’re used here."
              : "Your choices are kept for next time, on every device."}
          </p>
        </details>
      </div>

      <div ref={paper} className={styles.preview}>
        {set === undefined ? (
          <p role="status" className="visually-hidden">
            Getting the printout ready…
          </p>
        ) : set.recipes.length === 0 ? (
          <p className={styles.note}>
            There&rsquo;s nothing to print: the recipes may be in Trash or not on this device yet.
          </p>
        ) : (
          <Printout
            set={set}
            options={options}
            units={units}
            hideNutrition={hideNutrition}
            photoSize={one ? "full" : "thumb"}
          />
        )}
      </div>
    </main>
  );
}
