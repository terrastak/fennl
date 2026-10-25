import { useId, useRef, useState, type FormEvent } from "react";
import type { Recipe } from "../../shared/recipe";
import {
  SCALE_RULES,
  amountText,
  factorName,
  type ShownLine,
  type UnitSystem,
} from "../../shared/scale";
import { PanControls } from "./PanControls";
import { SHOWN_IN, lineText, type Scaling } from "./scaling";
import styles from "./recipes.module.css";

// The recipe page's scale and units controls, and its lines as shown (phase F1): every number
// Fennl changed is highlighted, never by colour alone, and a line can be tapped to show the
// original and the working. Owner's choice 2026-10-24: the ingredients show only "Serves − 4 +";
// the rest (half, double, any amount, another pan, units) is under "Adjust".

const PRESETS = [0.5, 1, 2, 3];

const UNIT_NAMES: Record<UnitSystem, string> = {
  written: "As written",
  us: "US",
  metric: "Metric",
};

/** "Serves − 4 +" on the ingredients, for a recipe that says how many it serves. */
export function ServesStepper({ recipe, scaling }: { recipe: Recipe; scaling: Scaling }) {
  const id = useId();
  const count = recipe.servings.count;
  if (!count) return null;
  const servings = count * scaling.factor;
  const setServings = (next: number) => {
    if (next <= 0) return;
    const f = next / count;
    if (f >= SCALE_RULES.minFactor && f <= SCALE_RULES.maxFactor) scaling.setFactor(f);
  };
  return (
    <div className={styles.serves} role="group" aria-labelledby={`${id}-serves`}>
      <span id={`${id}-serves`} className={styles.servesLabel}>
        Serves
      </span>
      <div className={styles.servesButtons}>
        <button
          type="button"
          className={styles.scaleStep}
          aria-label="One fewer"
          disabled={servings - 1 < count * SCALE_RULES.minFactor || servings <= 1}
          onClick={() => setServings(Math.ceil(servings) - 1)}
        >
          −
        </button>
        <output className={styles.scaleCount} aria-live="polite">
          {Number.isInteger(servings * 4) ? amountText(servings, null) : Math.round(servings)}
        </output>
        <button
          type="button"
          className={styles.scaleStep}
          aria-label="One more"
          disabled={servings + 1 > count * SCALE_RULES.maxFactor}
          onClick={() => setServings(Math.floor(servings) + 1)}
        >
          +
        </button>
      </div>
    </div>
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

/** "Adjust", and the panel it opens: amount, another pan and units. */
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
      <div className={styles.scaleGroup} role="group" aria-labelledby={`${id}-scale`}>
        <span id={`${id}-scale`} className={styles.scaleLabel}>
          Amount
        </span>
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={styles.scaleChoice}
            aria-pressed={factor === preset}
            onClick={() => onFactor(preset)}
          >
            {preset === 1 ? "As written" : `${amountText(preset, null, true)}×`}
          </button>
        ))}
        {!PRESETS.includes(factor) ? (
          <span className={styles.scaleChoice} aria-current="true">
            {factorName(factor)}
          </span>
        ) : null}
        <form className={styles.scaleCustom} onSubmit={submitCustom}>
          <label htmlFor={`${id}-custom`}>Other</label>
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
