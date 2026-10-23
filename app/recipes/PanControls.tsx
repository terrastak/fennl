import { useId, useMemo, useState, type FormEvent } from "react";
import {
  COMMON_PANS,
  MUFFIN_CUPS,
  PAN_SHAPES,
  panFactor,
  panName,
  recipePan,
  samePan,
  type Pan,
  type PanShape,
  type PanSource,
  type PanUnit,
} from "../../shared/pans";
import type { Recipe } from "../../shared/recipe";
import { LogoMark } from "../shell/Logo";
import type { Scaling } from "./scaling";
import styles from "./recipes.module.css";

// Scaling for another pan on the recipe page (phase F2, owner's choices 2026-10-23): the recipe's
// pan as read from the recipe (correctable), the person's pan from the common sizes or any size,
// and Fennl's bake-time suggestion in a bubble under the step that gives the time.

const FROM: Record<PanSource, string> = {
  method: "from the method",
  notes: "from the notes",
  makes: "from Makes",
  ingredients: "from the ingredients",
};

const SHAPE_NAMES: Record<PanShape, string> = {
  round: "Round",
  square: "Square",
  rectangle: "Rectangle",
  loaf: "Loaf",
  tube: "Tube",
  bundt: "Bundt",
  muffin: "Muffin tin",
};

/** A pan chosen from the common sizes, a Bundt by what it holds, or any size. */
function PanChoice({
  label,
  pan,
  onChoose,
}: {
  label: string;
  pan: Pan | null;
  onChoose: (pan: Pan) => void;
}) {
  const id = useId();
  const listed = pan ? COMMON_PANS.findIndex((p) => samePan(p, pan)) : -1;
  const [mode, setMode] = useState<"list" | "bundt" | "other">("list");
  const [shape, setShape] = useState<PanShape>("round");
  const [unit, setUnit] = useState<PanUnit>("in");
  const [width, setWidth] = useState("");
  const [length, setLength] = useState("");
  const [cups, setCups] = useState("");
  const [count, setCount] = useState("12");
  const [wrong, setWrong] = useState(false);

  const value = mode !== "list" ? mode : listed >= 0 ? `common-${listed}` : pan ? "current" : "";

  const choose = (next: string) => {
    setWrong(false);
    if (next === "bundt" || next === "other") {
      setMode(next);
      return;
    }
    setMode("list");
    const index = Number(next.replace("common-", ""));
    const chosen = COMMON_PANS[index];
    if (chosen) onChoose(chosen);
  };

  const size = (text: string) => {
    const n = Number(text.replace(",", "."));
    return Number.isFinite(n) && n > 0 && n <= 500 ? n : null;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    let next: Pan | null = null;
    const base = { width: null, length: null, depth: null, unit, cups: null, count: 1 };
    if (mode === "bundt") {
      const c = size(cups);
      if (c) next = { ...base, shape: "bundt", unit: "in", cups: c };
    } else if (shape === "muffin") {
      const n = Number(count);
      if (Number.isInteger(n) && n >= 1 && n <= 200) {
        next = { ...base, shape, unit: "in", count: n, cups: MUFFIN_CUPS.standard };
      }
    } else if (shape === "bundt" || shape === "tube") {
      const c = size(cups);
      if (c) next = { ...base, shape, cups: c };
    } else {
      const w = size(width);
      const l = shape === "rectangle" || shape === "loaf" ? size(length) : null;
      if (w && (l || !(shape === "rectangle" || shape === "loaf"))) {
        next = { ...base, shape, width: Math.min(w, l ?? w), length: l ? Math.max(w, l) : null };
      }
    }
    if (!next) {
      setWrong(true);
      return;
    }
    setWrong(false);
    setMode("list");
    onChoose(next);
  };

  return (
    <div className={styles.panChoice}>
      <label htmlFor={`${id}-pan`} className={styles.scaleLabel}>
        {label}
      </label>
      <select
        id={`${id}-pan`}
        className={styles.scaleSelect}
        value={value}
        onChange={(event) => choose(event.target.value)}
      >
        {value === "" ? <option value="">Choose a pan…</option> : null}
        {pan && listed < 0 ? <option value="current">{panName(pan)}</option> : null}
        {COMMON_PANS.map((p, i) => (
          <option key={i} value={`common-${i}`}>
            {panName(p)}
          </option>
        ))}
        <option value="bundt">Bundt pan…</option>
        <option value="other">Another size…</option>
      </select>
      {mode !== "list" ? (
        <form className={styles.panForm} onSubmit={submit}>
          {mode === "other" ? (
            <label>
              Shape{" "}
              <select
                className={styles.scaleSelect}
                value={shape}
                onChange={(event) => setShape(event.target.value as PanShape)}
              >
                {PAN_SHAPES.map((s) => (
                  <option key={s} value={s}>
                    {SHAPE_NAMES[s]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {mode === "bundt" || (mode === "other" && (shape === "bundt" || shape === "tube")) ? (
            <label>
              It holds{" "}
              <input
                inputMode="decimal"
                size={3}
                value={cups}
                onChange={(event) => setCups(event.target.value)}
              />{" "}
              cups
            </label>
          ) : mode === "other" && shape === "muffin" ? (
            <label>
              Standard cups{" "}
              <input
                inputMode="numeric"
                size={3}
                value={count}
                onChange={(event) => setCount(event.target.value)}
              />
            </label>
          ) : mode === "other" ? (
            <>
              <label>
                {shape === "round" ? "Across" : shape === "square" ? "Side" : "Width"}{" "}
                <input
                  inputMode="decimal"
                  size={3}
                  value={width}
                  onChange={(event) => setWidth(event.target.value)}
                />
              </label>
              {shape === "rectangle" || shape === "loaf" ? (
                <label>
                  Length{" "}
                  <input
                    inputMode="decimal"
                    size={3}
                    value={length}
                    onChange={(event) => setLength(event.target.value)}
                  />
                </label>
              ) : null}
              <label>
                In{" "}
                <select
                  className={styles.scaleSelect}
                  value={unit}
                  onChange={(event) => setUnit(event.target.value as PanUnit)}
                >
                  <option value="in">inches</option>
                  <option value="cm">cm</option>
                </select>
              </label>
            </>
          ) : null}
          <button type="submit" className={styles.scaleChoice}>
            Use this pan
          </button>
          {wrong ? (
            <p className={styles.scaleProblem} role="alert">
              {mode === "bundt" || shape === "bundt" || shape === "tube"
                ? "Say how many cups it holds. Fill it with water a cup at a time to find out."
                : "Give the pan's size as a number."}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

/** The recipe's pan and the person's, in the scale bar. */
export function PanControls({ recipe, scaling }: { recipe: Recipe; scaling: Scaling }) {
  const read = useMemo(() => recipePan(recipe), [recipe]);
  const [corrected, setCorrected] = useState<Pan | null>(null);
  const [changing, setChanging] = useState(false);
  const [open, setOpen] = useState(false);
  const theirs = scaling.pans?.recipe ?? corrected ?? (read && !read.sizeMissing ? read.pan : null);
  const [yoursWaiting, setYoursWaiting] = useState<Pan | null>(null);
  const [cantCompare, setCantCompare] = useState(false);

  if (!read && !scaling.pans && !open) {
    return (
      <button type="button" className={styles.textButton} onClick={() => setOpen(true)}>
        Scale for a different pan
      </button>
    );
  }

  const chooseYours = (yours: Pan, from: Pan | null = theirs) => {
    if (!from) {
      setYoursWaiting(yours);
      return;
    }
    if (!panFactor(from, yours)) {
      setCantCompare(true);
      return;
    }
    setCantCompare(false);
    setYoursWaiting(null);
    scaling.setPans(from, yours);
  };

  const correct = (pan: Pan) => {
    setCorrected(pan);
    setChanging(false);
    const yours = scaling.pans?.yours ?? yoursWaiting;
    if (yours) chooseYours(yours, pan);
  };

  return (
    <div className={styles.scaleGroup} role="group" aria-label="Pan">
      <span className={styles.scaleLabel}>Pan</span>
      {theirs && !changing ? (
        <span className={styles.panRead}>
          Recipe&rsquo;s pan: <strong>{panName(theirs)}</strong>
          {!corrected && !scaling.pans && read ? `, ${FROM[read.from]}` : ""}{" "}
          <button type="button" className={styles.textButton} onClick={() => setChanging(true)}>
            Change
          </button>
        </span>
      ) : (
        <>
          {read?.sizeMissing && !changing ? (
            <span className={styles.panRead}>
              The recipe uses a {panName(read.pan)} but doesn&rsquo;t say its size.
            </span>
          ) : null}
          <PanChoice label="Recipe’s pan" pan={theirs} onChoose={correct} />
        </>
      )}
      <PanChoice
        label="Your pan"
        pan={scaling.pans?.yours ?? yoursWaiting}
        onChoose={(pan) => chooseYours(pan)}
      />
      {cantCompare ? (
        <p className={styles.scaleProblem} role="alert">
          Fennl can&rsquo;t compare these two without knowing how much each holds. Choose a Bundt
          pan by the cups it holds, or another size.
        </p>
      ) : null}
    </div>
  );
}

/** Fennl's bake-time suggestion, under the step that gives the time. */
export function Suggestion({ text }: { text: string }) {
  return (
    <p className={styles.suggestion} role="note">
      <LogoMark size={18} />
      <span>
        <strong className={styles.suggestionLabel}>Fennl&rsquo;s suggestion:</strong> {text}
      </span>
    </p>
  );
}
