import { useId, useState, type FormEvent } from "react";
import type { Recipe } from "../../shared/recipe";
import {
  SCALE_RULES,
  amountText,
  factorName,
  type ShownLine,
  type UnitSystem,
} from "../../shared/scale";
import { SHOWN_IN, lineText, type Scaling } from "./scaling";
import styles from "./recipes.module.css";

// The recipe page's scale and units controls, and its lines as shown (phase F1): every number
// Fennl changed is highlighted, never by colour alone, and a line can be tapped to show the
// original and the working.

const PRESETS = [0.5, 1, 2, 3];

const UNIT_NAMES: Record<UnitSystem, string> = {
  written: "As written",
  us: "US",
  metric: "Metric",
};

export function ScaleBar({ recipe, scaling }: { recipe: Recipe; scaling: Scaling }) {
  const { factor, units, saveFailed, unitsFailed } = scaling;
  const onFactor = scaling.setFactor;
  const onUnits = scaling.setUnits;
  const id = useId();
  const [custom, setCustom] = useState("");
  const [customWrong, setCustomWrong] = useState(false);
  const count = recipe.servings.count;
  const servings = count ? count * factor : null;

  const setServings = (next: number) => {
    if (!count || next <= 0) return;
    const f = next / count;
    if (f >= SCALE_RULES.minFactor && f <= SCALE_RULES.maxFactor) onFactor(f);
  };

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
    <section className={styles.scaleBar} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="visually-hidden">
        Scale and units
      </h2>
      <div className={styles.scaleGroup} role="group" aria-labelledby={`${id}-scale`}>
        <span id={`${id}-scale`} className={styles.scaleLabel}>
          Scale
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
            {`${amountText(factor, null, true)}×`}
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

      {count && servings ? (
        <div className={styles.scaleGroup} role="group" aria-labelledby={`${id}-servings`}>
          <span id={`${id}-servings`} className={styles.scaleLabel}>
            Makes
          </span>
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
            {amountText(servings, null)}
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
      ) : null}

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

      {saveFailed ? (
        <p className={styles.scaleProblem} role="status">
          This scale couldn&rsquo;t be saved for your household, so it shows on this device only for
          now.
        </p>
      ) : null}
      {unitsFailed ? (
        <p className={styles.scaleProblem} role="status">
          Your choice of units couldn&rsquo;t be saved to your account, so it&rsquo;s kept on this
          device only for now.
        </p>
      ) : null}
    </section>
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
