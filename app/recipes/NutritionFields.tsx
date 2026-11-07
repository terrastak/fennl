import { useState } from "react";
import {
  NUTRIENTS,
  RECIPE_RULES,
  type Nutrient,
  type NutritionSource,
  type RecipeNutrition,
} from "../../shared/recipe";
import { Link } from "../router";
import editor from "./editor.module.css";
import type { EditorSession, EditorState } from "./editorSession";
import { useHideNutrition } from "./nutritionSetting";
import { LaptopIcon } from "./LaptopIcon";
import { LAPTOP_ICONS } from "./laptopIcons";
import { usePointer } from "./usePointer";
import styles from "./recipes.module.css";

// Nutrition per serving in the editor (phase F4): typed by hand, or corrected after an import.
// Changing a value records it as entered by hand; values never typed stay unknown, not zero.
// Closed until opened, unless the recipe has nutrition, so it's one stop for the keyboard.

const NAMES: Record<Nutrient, string> = {
  calories: "Calories",
  fat: "Fat",
  saturatedFat: "Saturated fat",
  carbohydrates: "Carbohydrates",
  fiber: "Fiber",
  sugar: "Sugar",
  protein: "Protein",
  sodium: "Sodium",
  cholesterol: "Cholesterol",
};

const FROM: Record<NutritionSource, string> = {
  manual: "Entered by hand.",
  paprika: "From Paprika. Changing a value marks it as entered by hand.",
  website: "From the recipe's website. Changing a value marks it as entered by hand.",
  ai: "Read from the recipe by AI. Changing a value marks it as entered by hand.",
};

/** Where the numbers came from, on the laptop's row (U23): "Not added" when there are none. */
const FROM_SHORT: Record<NutritionSource, string> = {
  manual: "Entered by hand",
  paprika: "From Paprika",
  website: "From the recipe’s website",
  ai: "Read from the recipe by AI",
};

/** Nutrition with one part changed, or null when nothing is left in it. */
function changed(
  nutrition: RecipeNutrition | null,
  patch: { key: Nutrient; value: number | null } | { text: string | null },
): RecipeNutrition | null {
  let perServing = { ...(nutrition?.perServing ?? {}) };
  let text = nutrition?.text ?? null;
  if ("key" in patch) {
    const key = patch.key;
    perServing = Object.fromEntries(
      Object.entries({ ...perServing, [key]: patch.value }).filter(([, v]) => v !== null),
    ) as RecipeNutrition["perServing"];
  } else {
    text = patch.text;
  }
  if (Object.keys(perServing).length === 0 && !text) return null;
  return { perServing, text, source: "manual" };
}

export function NutritionFields({
  session,
  state,
}: {
  session: EditorSession;
  state: EditorState;
}) {
  const [hidden] = useHideNutrition();
  const nutrition = state.draft.nutrition;
  // The box being typed in keeps its own text ("12." on the way to "12.5").
  const [typing, setTyping] = useState<{ key: Nutrient; text: string } | null>(null);
  const [opened] = useState(() => nutrition !== null);
  const laptop = usePointer();

  if (hidden) {
    return (
      <p className={`${styles.hint} ${editor.nutritionHidden}`}>
        Nutrition is hidden. <Link href="/settings#recipes">Show it again in Settings</Link>.
      </p>
    );
  }

  const type = (key: Nutrient, text: string) => {
    setTyping({ key, text });
    const trimmed = text.trim().replace(",", ".");
    if (trimmed === "") {
      session.set({ nutrition: changed(nutrition, { key, value: null }) });
      return;
    }
    const value = Number(trimmed);
    if (Number.isFinite(value) && value >= 0 && value <= 1e6) {
      session.set({ nutrition: changed(nutrition, { key, value }) });
    }
  };

  // On a laptop (U23) "Nutrition per serving" is a plain heading above a white box, and the
  // summary is a row in it: where the numbers came from, a line of help, and a button that says
  // what it does ("Add nutrition", "Show boxes", "Hide boxes"). Phones keep the plain summary.
  // Screen readers hear the summary's words too: where the numbers came from and the help line
  // stand in for the hint inside, which a laptop doesn't show.
  const help =
    nutrition && nutrition.source !== "manual"
      ? "Changing a value marks it as entered by hand. Leave a box empty when you don’t know it."
      : nutrition
        ? "Leave a box empty when you don’t know it."
        : "Optional. Leave a box empty when you don’t know it.";
  return (
    <div className={editor.nutritionSection}>
      {laptop ? (
        <p className={editor.nutritionHeading} aria-hidden="true">
          Nutrition per serving
        </p>
      ) : null}
      <details className={editor.nutrition} open={opened}>
        {laptop ? (
          <summary>
            {/* Spaces and stops for screen readers, as the grid shows the parts apart. */}
            <span className={editor.summaryTitle}>Nutrition per serving: </span>{" "}
            <span className={editor.summaryText}>
              <span className={editor.summaryFrom}>
                {nutrition ? FROM_SHORT[nutrition.source] : "Not added"}
                <span className={editor.summaryTitle}>.</span>
              </span>{" "}
              <span className={editor.summaryHelp}>{help}</span>
            </span>{" "}
            <span className={editor.summaryButton}>
              <span className={editor.whenClosed}>
                {nutrition ? "Show boxes" : "Add nutrition"}
              </span>
              <span className={editor.whenOpen}>Hide boxes</span>
              <LaptopIcon path={LAPTOP_ICONS.chevron} className={editor.chevron} />
            </span>
          </summary>
        ) : (
          <summary>Nutrition per serving</summary>
        )}
        <div className={editor.nutritionBody}>
          <p className={`${styles.hint} ${editor.nutritionHint}`}>
            Leave a box empty when you don&rsquo;t know it.{" "}
            {nutrition ? FROM[nutrition.source] : ""}
          </p>
          <div className={editor.nutritionGrid}>
            {(Object.keys(NUTRIENTS) as Nutrient[]).map((key) => {
              const id = `edit-nutrition-${key}`;
              const value =
                typing?.key === key ? typing.text : String(nutrition?.perServing[key] ?? "");
              return (
                <div key={key} className={editor.field}>
                  <label htmlFor={id}>
                    {NAMES[key]}
                    <span className={editor.unitInLabel}> ({NUTRIENTS[key]})</span>
                  </label>
                  {/* On a laptop the unit shows inside the box instead ("310 kcal"). */}
                  <span className={editor.unitBox}>
                    <input
                      id={id}
                      className={styles.input}
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => type(key, e.target.value)}
                      onBlur={() => setTyping(null)}
                    />
                    <span className={editor.unit} aria-hidden="true">
                      {NUTRIENTS[key]}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className={editor.field}>
            <label htmlFor="edit-nutrition-text">More about the nutrition</label>
            <textarea
              id="edit-nutrition-text"
              className={`${styles.input} ${editor.textarea}`}
              rows={2}
              maxLength={RECIPE_RULES.notesLength}
              value={nutrition?.text ?? ""}
              onChange={(e) =>
                session.set({ nutrition: changed(nutrition, { text: e.target.value || null }) })
              }
            />
          </div>
        </div>
      </details>
    </div>
  );
}
