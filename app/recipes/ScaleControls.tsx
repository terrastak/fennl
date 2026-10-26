import { useId, useRef, useState, type FormEvent } from "react";
import type { Recipe } from "../../shared/recipe";
import { namesAPan } from "../../shared/pans";
import { servingsFacts } from "../../shared/recipeText";
import {
  SCALE_RULES,
  amountText,
  factorName,
  scaledServings,
  type ShownLine,
  type UnitSystem,
} from "../../shared/scale";
import { PanControls } from "./PanControls";
import { SHOWN_IN, lineText, type Scaling } from "./scaling";
import styles from "./recipes.module.css";

// The recipe page's scale and units controls, and its lines as shown (phase F1): every number
// Fennl changed is highlighted, never by colour alone, and a line can be tapped to show the
// original and the working. Owner's choices 2026-10-25: the ingredients say how many it serves or
// makes, with quick choices (half, as written, double, triple) and "Adjust", which holds the rest:
// how many, any amount, another pan (only when the recipe names one) and units.

const PRESETS = [0.5, 1, 2, 3];

const UNIT_NAMES: Record<UnitSystem, string> = {
  written: "As written",
  us: "US",
  metric: "Metric",
};

/** How many the recipe serves or makes, as written and as shown now. */
function servingsSaid(recipe: Recipe, scaling: Scaling) {
  const written = recipe.servings;
  const count = written.count;
  const facts = servingsFacts(written);
  // "Makes 14 cookies" on a recipe for 14: the count is what it makes.
  const makesCount = count !== null && facts.length === 1 && facts[0]?.label === "Makes";
  const servings = count === null ? 0 : count * scaling.factor;
  const shownCount = Number.isInteger(servings * 4)
    ? amountText(servings, null)
    : String(Math.round(servings));
  // "cookies" after the number, while it reads right ("1 cookies" doesn't).
  const words = makesCount ? (/^\d+\s+(.+)$/u.exec(facts[0]?.value ?? "")?.[1] ?? null) : null;
  // Scaled for another pan, words naming the recipe's pan ("one 9-inch cake") give way.
  const panYield = scaling.pans !== null && written.yield !== null && namesAPan(written.yield);
  const others =
    makesCount || panYield
      ? []
      : servingsFacts(scaledServings(written, scaling.factor)).filter(
          (fact) => count === null || fact.label !== "Serves",
        );
  return {
    count,
    servings,
    label: makesCount ? "Makes" : "Serves",
    shownCount,
    words: words && shownCount !== "1" ? words : null,
    others,
  };
}

/** Text Fennl changed, highlighted like a scaled amount. */
const changedText = (text: string) => (
  <ShownText line={{ pieces: [{ text, changed: true }], changed: true }} />
);

/**
 * How many it serves or makes, at the top of the ingredients and said only here ("Makes 14
 * cookies", "Serves 4 · Makes about 12 pancakes", "Makes 1 loaf"), with "Adjust" and quick
 * choices for the amount: half, as written, double, triple (owner's choices 2026-10-25). Without
 * `adjustable` (Trash), just the words.
 */
export function ServingsBar({
  recipe,
  scaling,
  adjustable,
}: {
  recipe: Recipe;
  scaling: Scaling;
  adjustable: boolean;
}) {
  const said = servingsSaid(recipe, scaling);
  const scaled = scaling.factor !== 1;
  const lines = [
    ...(said.count !== null
      ? [
          {
            label: said.label,
            value: said.words ? `${said.shownCount} ${said.words}` : said.shownCount,
          },
        ]
      : []),
    ...said.others,
  ];
  if (lines.length === 0 && !adjustable) return null;
  return (
    <div className={styles.serves}>
      <div className={styles.servesTop}>
        <p className={styles.servesSaid}>
          {lines.map((line, i) => (
            <span key={line.label}>
              {i > 0 ? <span aria-hidden="true"> · </span> : null}
              <span className={styles.servesLabel}>{line.label}</span>{" "}
              {scaled ? changedText(line.value) : line.value}
            </span>
          ))}
        </p>
        {adjustable ? <Adjust recipe={recipe} scaling={scaling} /> : null}
      </div>
      {adjustable ? (
        <div className={styles.quickScale} role="group" aria-label="Amount">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={styles.quickChoice}
              aria-pressed={scaling.factor === preset && !scaling.pans}
              onClick={() => scaling.setFactor(preset)}
            >
              {preset === 1 ? "As written" : `${amountText(preset, null, true)}×`}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** "Makes − 14 + cookies" in the Adjust panel: any number, typed or a step at a time. */
function ServingsStepper({ recipe, scaling }: { recipe: Recipe; scaling: Scaling }) {
  const id = useId();
  const said = servingsSaid(recipe, scaling);
  const [typed, setTyped] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);
  const count = said.count;
  if (count === null) return null;
  const lowest = Math.max(1, Math.ceil(count * SCALE_RULES.minFactor));
  const highest = Math.floor(count * SCALE_RULES.maxFactor);
  const setServings = (next: number) => {
    if (!Number.isFinite(next) || next < lowest || next > highest) return false;
    scaling.setFactor(next / count);
    return true;
  };
  const commit = () => {
    if (typed === null) return;
    const ok = setServings(Number(typed.replace(",", ".")));
    setWrong(!ok);
    if (ok) setTyped(null);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    commit();
  };
  const step = (next: number) => {
    setTyped(null);
    setWrong(false);
    setServings(next);
  };
  return (
    <form className={styles.scaleGroup} onSubmit={submit}>
      <label htmlFor={`${id}-count`} className={styles.scaleLabel}>
        {said.label}
      </label>
      <div className={styles.servesButtons}>
        <button
          type="button"
          className={styles.scaleStep}
          aria-label="One fewer"
          disabled={said.servings - 1 < lowest}
          onClick={() => step(Math.ceil(said.servings) - 1)}
        >
          −
        </button>
        <input
          id={`${id}-count`}
          className={styles.servesInput}
          inputMode="numeric"
          size={3}
          value={typed ?? said.shownCount}
          aria-describedby={wrong ? `${id}-wrong` : undefined}
          aria-invalid={wrong || undefined}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={commit}
        />
        <button
          type="button"
          className={styles.scaleStep}
          aria-label="One more"
          disabled={said.servings + 1 > highest}
          onClick={() => step(Math.floor(said.servings) + 1)}
        >
          +
        </button>
      </div>
      {said.words ? <span>{said.words}</span> : null}
      {wrong ? (
        <p id={`${id}-wrong`} className={styles.scaleProblem}>
          Choose a number from {lowest} to {highest}.
        </p>
      ) : null}
    </form>
  );
}

/**
 * What's changed, with the way back to the recipe's own amounts (the units are the account's, so
 * they're changed under "Adjust"), and a choice that couldn't be saved.
 */
export function ScaleStatus({ note, scaling }: { note: string | null; scaling: Scaling }) {
  return (
    <>
      {note ? (
        <p className={styles.scaleNote}>
          {note}{" "}
          {scaling.factor !== 1 || scaling.pans ? (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => scaling.setFactor(1)}
            >
              Back to as written
            </button>
          ) : null}
        </p>
      ) : null}
      {scaling.saveFailed ? (
        <p className={styles.scaleProblem} role="status">
          This scale couldn&rsquo;t be saved for your household, so it shows on this device only for
          now.
        </p>
      ) : null}
      {scaling.unitsFailed ? (
        <p className={styles.scaleProblem} role="status">
          Your choice of units couldn&rsquo;t be saved to your account, so it&rsquo;s kept on this
          device only for now.
        </p>
      ) : null}
    </>
  );
}

/** "Adjust", and the panel it opens: how many, amount, another pan and units. */
export function Adjust({ recipe, scaling }: { recipe: Recipe; scaling: Scaling }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  return (
    <>
      <button
        type="button"
        className={styles.adjustButton}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="10" cy="17" r="2" />
        </svg>
        Adjust
      </button>
      <dialog ref={dialog} className={styles.adjust} aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className={styles.adjustTitle}>
          Adjust this recipe
        </h2>
        <ScaleBar recipe={recipe} scaling={scaling} />
        <p className={styles.adjustNote}>
          This only changes how the recipe is shown, never the recipe itself. Tap any line to see
          the original.
        </p>
        <div className={styles.adjustButtons}>
          <button type="button" className={styles.primary} onClick={() => dialog.current?.close()}>
            Done
          </button>
        </div>
      </dialog>
    </>
  );
}

function ScaleBar({ recipe, scaling }: { recipe: Recipe; scaling: Scaling }) {
  const { factor, units } = scaling;
  const onFactor = scaling.setFactor;
  const onUnits = scaling.setUnits;
  const id = useId();
  const [custom, setCustom] = useState("");
  const [customWrong, setCustomWrong] = useState(false);

  const submitCustom = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(custom.replace(",", "."));
    if (!Number.isFinite(value) || value < SCALE_RULES.minFactor || value > SCALE_RULES.maxFactor) {
      setCustomWrong(true);
      return;
    }
    setCustomWrong(false);
    setCustom("");
    onFactor(value);
  };

  return (
    <div className={styles.scaleBar}>
      <ServingsStepper recipe={recipe} scaling={scaling} />
      <div className={styles.scaleGroup} role="group" aria-labelledby={`${id}-scale`}>
        <span id={`${id}-scale`} className={styles.scaleLabel}>
          Amount
        </span>
        <span className={styles.scaleNow}>
          {factor === 1 && !scaling.pans ? "As written" : factorName(factor)}
        </span>
        <form className={styles.scaleCustom} onSubmit={submitCustom}>
          <label htmlFor={`${id}-custom`}>Scale by</label>
          <input
            id={`${id}-custom`}
            inputMode="decimal"
            size={4}
            value={custom}
            placeholder="1.5"
            aria-describedby={customWrong ? `${id}-custom-problem` : undefined}
            aria-invalid={customWrong || undefined}
            onChange={(event) => setCustom(event.target.value)}
          />
          <button type="submit" className={styles.scaleChoice}>
            Scale
          </button>
        </form>
      </div>
      {customWrong ? (
        <p id={`${id}-custom-problem`} className={styles.scaleProblem}>
          Choose a number from {amountText(SCALE_RULES.minFactor, null)} to {SCALE_RULES.maxFactor}.
        </p>
      ) : null}

      <PanControls recipe={recipe} scaling={scaling} />

      <div className={styles.scaleGroup}>
        <label htmlFor={`${id}-units`} className={styles.scaleLabel}>
          Units
        </label>
        <select
          id={`${id}-units`}
          className={styles.scaleSelect}
          value={units}
          onChange={(event) => onUnits(event.target.value as UnitSystem)}
        >
          {(Object.keys(UNIT_NAMES) as UnitSystem[]).map((value) => (
            <option key={value} value={value}>
              {UNIT_NAMES[value]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** A shown line: Fennl's changes highlighted, a bracket it left as written marked. */
export function ShownText({ line }: { line: ShownLine }) {
  return (
    <>
      {line.pieces.map((piece, i) =>
        piece.changed ? (
          <mark key={i} className={styles.changed}>
            {piece.text}
          </mark>
        ) : piece.unchanged ? (
          <span key={i} className={styles.asWritten} title="Left as written">
            {piece.text}
            <span className="visually-hidden"> (left as written)</span>
          </span>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </>
  );
}

/**
 * A line that can be tapped to show the original and the working, and, for an ingredient on a
 * scaled recipe, kept at its written amount.
 */
export function ScaledLine({
  text,
  line,
  scaling,
  lineId,
  canHold,
}: {
  text: string;
  line: ShownLine;
  scaling: Scaling;
  lineId: string;
  canHold: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const held = scaling.held.has(lineId);
  const marked = line.pieces.some((p) => p.unchanged);
  if (!line.changed && !marked && !held) return <ShownText line={line} />;

  const how = [
    scaling.factor === 1 ? "" : factorName(scaling.factor),
    SHOWN_IN[scaling.units],
  ].filter(Boolean);
  const named = how.join(", ");
  return (
    <>
      <button
        type="button"
        className={styles.lineButton}
        aria-expanded={open}
        aria-controls={`${id}-working`}
        onClick={() => setOpen(!open)}
      >
        <ShownText line={line} />
        {held ? <span className={styles.heldTag}> · kept as written</span> : null}
      </button>
      <div id={`${id}-working`} className={styles.working} hidden={!open}>
        <p>Original: {text}</p>
        {line.changed ? (
          <p>
            {named[0]?.toUpperCase()}
            {named.slice(1)}: {lineText(line)}
          </p>
        ) : null}
        {marked ? (
          <p>
            The amount in brackets is left as written: Fennl can&rsquo;t tell whether it&rsquo;s one
            package&rsquo;s size or the same amount in other units.
          </p>
        ) : null}
        {canHold && (scaling.factor !== 1 || held) ? (
          <button
            type="button"
            className={styles.textButton}
            onClick={() => scaling.hold(lineId, !held)}
          >
            {held ? "Scale this one again" : "Keep this amount as written"}
          </button>
        ) : null}
      </div>
    </>
  );
}
