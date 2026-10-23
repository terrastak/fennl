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

  if (hidden) {
    return (
      <p className={styles.hint}>
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

  return (
    <details className={editor.nutrition} open={opened}>
      <summary>Nutrition per serving</summary>
      <p className={styles.hint}>
        Leave a box empty when you don&rsquo;t know it. {nutrition ? FROM[nutrition.source] : ""}
      </p>
      <div className={editor.nutritionGrid}>
        {(Object.keys(NUTRIENTS) as Nutrient[]).map((key) => {
          const id = `edit-nutrition-${key}`;
          const value =
            typing?.key === key ? typing.text : String(nutrition?.perServing[key] ?? "");
          return (
            <div key={key} className={editor.field}>
              <label htmlFor={id}>
                {NAMES[key]} ({NUTRIENTS[key]})
              </label>
              <input
                id={id}
                className={styles.input}
                inputMode="decimal"
                value={value}
                onChange={(e) => type(key, e.target.value)}
                onBlur={() => setTyping(null)}
              />
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
    </details>
  );
}
