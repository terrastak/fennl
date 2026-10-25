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
// original and the working. Owner's choice 2026-10-24: the ingredients show only "Serves − 4 +";
// the rest (half, double, any amount, another pan, units) is under "Adjust", beside it (2026-10-25).

const PRESETS = [0.5, 1, 2, 3];

const UNIT_NAMES: Record<UnitSystem, string> = {
  written: "As written",
  us: "US",
  metric: "Metric",
};

/**
 * How many it serves or makes, at the top of the ingredients and said only here: "Makes − 14 +
 * cookies", "Serves − 4 +" with "Makes about 12 pancakes" beside it, or "Makes 1 loaf" when no
 * count is given; with "Adjust" in the same bar (owner's choices 2026-10-24 and 2026-10-25).
 * Without `adjustable` (Trash), the same words without buttons.
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
  const id = useId();
  const written = recipe.servings;
  const count = written.count;
  const facts = servingsFacts(written);
  // "Makes 14 cookies" on a recipe for 14: the count is what it makes.
  const makesCount = count !== null && facts.length === 1 && facts[0]?.label === "Makes";
  const label = makesCount ? "Makes" : "Serves";
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
  const scaled = scaling.factor !== 1;
  const setServings = (next: number) => {
    if (!count || next <= 0) return;
    const f = next / count;
    if (f >= SCALE_RULES.minFactor && f <= SCALE_RULES.maxFactor) scaling.setFactor(f);
  };
  if (count === null && others.length === 0 && !adjustable) return null;
  return (
    <div className={styles.serves}>
      <div className={styles.servesSaid}>
        {count !== null ? (
          <div className={styles.servesCount} role="group" aria-labelledby={`${id}-serves`}>
            <div className={styles.servesRow}>
              <span id={`${id}-serves`} className={styles.servesLabel}>
                {label}
              </span>
              {adjustable ? (
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
                    {shownCount}
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
              ) : (
                <span className={styles.scaleCount}>{shownCount}</span>
              )}
            </div>
            {words && shownCount !== "1" ? <span>{words}</span> : null}
          </div>
        ) : null}
        {others.map((fact) => (
          <p key={fact.label} className={styles.servesMade}>
            {fact.label}{" "}
            {scaled ? (
              <ShownText line={{ pieces: [{ text: fact.value, changed: true }], changed: true }} />
            ) : (
              fact.value
            )}
          </p>
        ))}
      </div>
      {adjustable ? <Adjust recipe={recipe} scaling={scaling} /> : null}
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
