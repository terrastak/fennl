import { useId, useState } from "react";
import { readIngredient, type IngredientAmount } from "../../shared/ingredients";
import styles from "./ingredientTrial.module.css";

// The ingredient check page (phase E2, /ingredient-trial): type ingredient lines and see how
// Fennl reads each one (amount, unit, ingredient, note, and every other amount on the line).
// It's all worked out on this device; nothing is sent anywhere.

const EXAMPLE = [
  "1 ½ cups (190 g) flour, sifted",
  "2–3 large eggs",
  "1 (14-ounce) can black beans, drained and rinsed",
  "Two 28-ounce cans whole plum tomatoes, crushed",
  "1 pound 4 ounces (about 5 cups) bread flour, plus extra for dusting",
  "A pinch of salt",
  "1 T sugar",
  "1 t vanilla",
  "1/2 vanilla bean or 1 teaspoon vanilla extract",
  "Kosher salt and freshly ground black pepper",
].join("\n");

const FRACTIONS: [number, string][] = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
];

/** 1.5 as "1 ½", 0.333 as "⅓", 1.125 as "1 ⅛"; anything else as a decimal. */
function number(value: number): string {
  const whole = Math.floor(value);
  const part = value - whole;
  if (part < 0.001) return String(whole);
  const fraction = FRACTIONS.find(([f]) => Math.abs(f - part) < 0.01);
  if (!fraction) return String(Math.round(value * 1000) / 1000);
  return whole ? `${whole} ${fraction[1]}` : fraction[1];
}

function amount(a: { low: number; high: number | null; unit: string | null }): string {
  const n = a.high === null ? number(a.low) : `${number(a.low)}–${number(a.high)}`;
  return a.unit ? `${n} ${a.unit}` : n;
}

const ROLE: Record<IngredientAmount["role"], string> = {
  main: "Amount",
  alternate: "Also written as",
  size: "Size of each",
  other: "Also on the line",
};

/** The line with each amount marked where it's written. */
function Marked({ line, amounts }: { line: string; amounts: IngredientAmount[] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  amounts.forEach((a, k) => {
    if (a.start > at) parts.push(line.slice(at, a.start));
    parts.push(
      <mark key={k} className={a.role === "main" ? styles.main : styles.other}>
        {line.slice(a.start, a.end)}
      </mark>,
    );
    at = a.end;
  });
  if (at < line.length) parts.push(line.slice(at));
  return <>{parts}</>;
}

export function IngredientTrial() {
  const [text, setText] = useState(EXAMPLE);
  const inputId = useId();
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Ingredient check</h1>
      <p className={styles.lead}>
        Type or paste ingredient lines, one per line, and see how Fennl reads each one: the amount,
        the unit, the ingredient and any note. Highlighted parts are the numbers Fennl found, so
        scaling a recipe later changes exactly those. Your text stays on this device.
      </p>

      <section className={styles.card} aria-labelledby={`${inputId}-label`}>
        <h2 id={`${inputId}-label`}>Ingredient lines</h2>
        <label htmlFor={inputId} className="visually-hidden">
          Ingredient lines, one per line
        </label>
        <textarea
          id={inputId}
          className={styles.input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={10}
          spellCheck={false}
        />
        <p className={styles.row}>
          <button type="button" className={styles.secondary} onClick={() => setText("")}>
            Clear
          </button>
          <button type="button" className={styles.secondary} onClick={() => setText(EXAMPLE)}>
            Show the examples
          </button>
        </p>
      </section>

      <section className={styles.card} aria-labelledby={`${inputId}-results`}>
        <h2 id={`${inputId}-results`}>How Fennl reads them</h2>
        {lines.length === 0 ? (
          <p className={styles.lead}>Nothing to read yet.</p>
        ) : (
          <ol className={styles.results} aria-label="Lines read">
            {lines.map((line, k) => {
              const r = readIngredient(line);
              const others = r.amounts.filter((a) => a.role !== "main");
              return (
                <li key={`${k}-${line}`} className={styles.result}>
                  <p className={styles.line}>
                    <Marked line={line} amounts={r.amounts} />
                  </p>
                  <dl className={styles.details}>
                    <div>
                      <dt>Amount</dt>
                      <dd>
                        {r.quantity
                          ? amount({ ...r.quantity, unit: r.unit })
                          : r.unit
                            ? `a ${r.unit} (no number to scale)`
                            : "None"}
                      </dd>
                    </div>
                    <div>
                      <dt>Ingredient</dt>
                      <dd>{r.item ?? "None"}</dd>
                    </div>
                    {r.note ? (
                      <div>
                        <dt>Note</dt>
                        <dd>{r.note}</dd>
                      </div>
                    ) : null}
                    {others.map((a, j) => (
                      <div key={j}>
                        <dt>{ROLE[a.role]}</dt>
                        <dd>
                          {amount(a)}
                          {a.approximate ? " (about)" : ""}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
