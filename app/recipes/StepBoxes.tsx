import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import editor from "./editor.module.css";
import { MarginMark } from "./marginMarks";
import {
  dropBlankStep,
  firstChange,
  followKeys,
  isBlankStep,
  joinWithNext,
  joinWithPrevious,
  moveStep,
  ordered,
  pasteInto,
  replaceRange,
  selectedText,
  splitStep,
  stepLabels,
  stepsFromText,
  textFromSteps,
  typedInto,
  type StepEdit,
  type StepPoint,
  type StepRange,
} from "./steps";

// Directions as separate step boxes in the editor on a laptop (U27, owner's choices 2026-11-21,
// the mockup "C3"): each step its own box that grows with its words, 5px from the next, inside
// the one white Directions area, with its circled number (or a heading's H) in the margin. Typing
// feels like one box: Enter starts or splits a step, Backspace and Delete at a step's edge join
// steps, the arrows move between steps as between lines, pasting several lines makes a step per
// line, Alt+↑ / Alt+↓ move a step, and words can be selected across steps (steps.ts has the pure
// rules). The steps are the lines of the Directions text, so the recipe is saved exactly as
// before: each step is a direction line keeping its ID (shared/recipeLines.ts).

/** For the box around the steps: put the cursor in a step (its end, or where it was). */
export interface StepBoxesHandle {
  focus: (step: number, offset?: number | "end") => void;
}

/** What the margin beside a step shows. */
export interface StepMark {
  heading: boolean;
  linked: boolean;
  number: number | null;
}

/** A selection that runs across steps: where it started, and where it's been taken to. */
interface Across {
  anchor: StepPoint;
  focus: StepPoint;
  /** The Directions text it was made in: it ends when the text changes. */
  text: string;
}

const newKey = () => crypto.randomUUID();

/** Keeps a step's element by its key, while it's shown. */
function keep<T extends HTMLElement>(map: Map<string, T>, key: string, element: T | null) {
  if (element) map.set(key, element);
  else map.delete(key);
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

// --- Measuring where the cursor is, from the unseen copy of a step's words under its box --------

interface Caret {
  x: number;
  top: number;
  bottom: number;
}

function lineHeight(element: HTMLElement): number {
  return parseFloat(getComputedStyle(element).lineHeight) || 20;
}

/**
 * Where the cursor at `offset` would be drawn, from the copy's words (`length` of them). Where a
 * step's words wrap, one place is both the end of a line and the start of the next: `upstream`
 * says it's drawn at the end (after End), as the browser does.
 */
function caretAt(words: HTMLElement, length: number, offset: number, upstream = false): Caret {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(words, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  const base = words.getBoundingClientRect();
  if (length === 0 || nodes.length === 0) {
    return { x: base.left, top: base.top, bottom: base.top + lineHeight(words) };
  }
  const after = offset >= length || (upstream && offset > 0);
  const index = after ? offset - 1 : offset;
  let rest = index;
  for (const node of nodes) {
    if (rest < node.length) {
      const range = document.createRange();
      range.setStart(node, rest);
      range.setEnd(node, rest + 1);
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      return {
        x: after ? rect.right : rect.left,
        top: rect.top,
        bottom: rect.bottom,
      };
    }
    rest -= node.length;
  }
  return { x: base.right, top: base.top, bottom: base.bottom };
}

/** Whether the cursor at `offset` is on the step's first (or last) line as drawn. */
function onEdgeLine(
  words: HTMLElement,
  length: number,
  offset: number,
  edge: "first" | "last",
  upstream: boolean,
) {
  const half = lineHeight(words) / 2;
  const here = caretAt(words, length, offset, upstream).top;
  const end = caretAt(words, length, edge === "first" ? 0 : length).top;
  return edge === "first" ? here < end + half : here > end - half;
}

/**
 * The place in a step nearest a point: on its first or last line as drawn for ↑ / ↓ from the
 * step beside it, or under the mouse.
 */
function offsetNear(
  words: HTMLElement,
  length: number,
  x: number,
  where: "first" | "last" | { y: number },
): number {
  if (length === 0) return 0;
  const half = lineHeight(words) / 2;
  const lineTop =
    typeof where === "string" ? caretAt(words, length, where === "first" ? 0 : length).top : null;
  let best = 0;
  let bestScore = Infinity;
  for (let offset = 0; offset <= length; offset++) {
    const caret = caretAt(words, length, offset);
    let score: number;
    if (lineTop !== null) {
      if (Math.abs(caret.top - lineTop) > half) continue;
      score = Math.abs(caret.x - x);
    } else {
      const y = (where as { y: number }).y;
      const dy = y < caret.top ? caret.top - y : y > caret.bottom ? y - caret.bottom : 0;
      score = dy * 10_000 + Math.abs(caret.x - x);
    }
    if (score < bestScore) {
      best = offset;
      bestScore = score;
    }
  }
  return best;
}

export function StepBoxes({
  id,
  text,
  lines,
  marks,
  invalid,
  describedBy,
  example,
  rowsRef,
  handle,
  onChange,
  onCursor,
  onLeave,
  onMoved,
  onUndo,
  onRedo,
}: {
  /** The first step's ID, which Directions' label points to. */
  id: string;
  /** The Directions text: one step per line. */
  text: string;
  /** The recipe's direction lines, for the headings in what screen readers hear. */
  lines: readonly { heading: boolean }[];
  /** What each step's margin shows, by step. */
  marks: readonly (StepMark | null)[];
  /** Steps with a problem, by step. */
  invalid: readonly boolean[];
  describedBy?: string | undefined;
  /** The faded example shown while there's nothing in any step. */
  example: ReactNode;
  /** The steps' rows, in order (the link panel opens under the row it's for). */
  rowsRef: RefObject<HTMLDivElement | null>;
  handle: Ref<StepBoxesHandle>;
  /**
   * The Directions text changed. `apart`: a split, join, paste or move, an undo step of its own;
   * `"before"`: words typed over a selection across steps, apart from what was typed before them
   * but joined by the letters that follow.
   */
  onChange: (text: string, apart: boolean | "before") => void;
  /** The step the cursor is in. */
  onCursor: (step: number) => void;
  /** The cursor left the steps. */
  onLeave: () => void;
  /** Words for screen readers after Alt+↑ / Alt+↓ ("Moved up"). */
  onMoved: (words: string) => void;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
}) {
  const texts = stepsFromText(text);

  // Keys that stay with the steps as they change, so the box being typed in stays the same box.
  const [keyedState, setKeyed] = useState(() => ({
    texts,
    keys: followKeys([], [], texts, newKey),
  }));
  let keyed = keyedState;
  if (keyed.texts.length !== texts.length || keyed.texts.some((t, i) => t !== texts[i])) {
    keyed = { texts, keys: followKeys(keyed.texts, keyed.keys, texts, newKey) };
    setKeyed(keyed);
  }
  const keys = keyed.keys;
  // For the event handlers: the steps as shown.
  const shown = useRef(keyed);

  const boxes = useRef(new Map<string, HTMLTextAreaElement>());
  const copies = useRef(new Map<string, HTMLSpanElement>());
  const rows = useRef(new Map<string, HTMLDivElement>());
  // Where the cursor goes after the next change shows.
  const pending = useRef<{
    step: number;
    start?: number;
    end?: number;
    direction?: "forward" | "backward" | "none";
  } | null>(null);
  const cursorTo = useRef(onCursor);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  // The step Tab comes back to (one stop for all the steps, as for one box).
  const [homeKey, setHomeKey] = useState<string | null>(null);
  const [acrossState, setAcross] = useState<Across | null>(null);
  const across = acrossState && acrossState.text === text ? acrossState : null;
  const acrossRef = useRef<Across | null>(null);
  const drag = useRef<{ anchor: StepPoint; pointer: number } | null>(null);
  // Where End last left the cursor: drawn at the end of its line, where the words wrap there.
  const endAt = useRef<StepPoint | null>(null);
  const endWas = useRef<StepPoint | null>(null);
  // Undo or Redo pressed in the steps, until its words show: the steps before it, so the cursor
  // goes to the first step that changed.
  const afterUndo = useRef<{ before: readonly string[] } | null>(null);

  const group = useRef<HTMLDivElement | null>(null);
  const stepKeyOf = (element: Element) =>
    [...boxes.current.entries()].find(([, el]) => el === element)?.[0] ?? "";
  const box = (step: number) => boxes.current.get(shown.current.keys[step] ?? "");
  const words = (step: number) => copies.current.get(shown.current.keys[step] ?? "");
  const stepOf = (key: string) => shown.current.keys.indexOf(key);
  const nowTexts = () => shown.current.texts;

  /** Puts the cursor (or a selection) in a step now. */
  const focusAt = (
    step: number,
    start?: number,
    end = start,
    direction: "forward" | "backward" | "none" = "none",
  ) => {
    const el = box(step);
    if (!el) return;
    if (document.activeElement !== el) el.focus();
    if (start !== undefined) el.setSelectionRange(start, end ?? start, direction);
  };

  useLayoutEffect(() => {
    shown.current = keyed;
    acrossRef.current = across;
    cursorTo.current = onCursor;
    const back = afterUndo.current;
    if (back && textFromSteps(back.before) !== textFromSteps(keyed.texts)) {
      afterUndo.current = null;
      pending.current = null;
      const at = firstChange(back.before, keyed.texts);
      focusAt(at.step, at.offset);
    }
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    focusAt(next.step, next.start, next.end, next.direction);
  });

  useImperativeHandle(handle, () => ({
    focus: (step, offset) => {
      const length = nowTexts()[step]?.length ?? 0;
      focusAt(step, offset === "end" ? length : offset);
    },
  }));

  // The parent hears which step the cursor is in, by place (it moves when steps come and go).
  const focusedStep = focusedKey === null ? -1 : keys.indexOf(focusedKey);
  useEffect(() => {
    if (focusedStep >= 0) cursorTo.current(focusedStep);
  }, [focusedStep, text]);

  /** A change made here: the text, then the cursor where the change leaves it. */
  const apply = (edit: StepEdit, apart: boolean | "before" = true) => {
    setAcross(null);
    const next = textFromSteps(edit.texts);
    if (next === text) {
      focusAt(edit.cursor.step, edit.cursor.offset);
      return;
    }
    pending.current = { step: edit.cursor.step, start: edit.cursor.offset };
    onChange(next, apart);
  };

  // --- Selecting across steps -------------------------------------------------------------

  /** Where the moving end of a selection across steps is now (the browser keeps it in its step). */
  const liveFocus = (sel: Across): StepPoint => {
    const el = box(sel.focus.step);
    if (!el || document.activeElement !== el) return sel.focus;
    return {
      step: sel.focus.step,
      offset: sel.focus.step > sel.anchor.step ? el.selectionEnd : el.selectionStart,
    };
  };

  const liveRange = (sel: Across): StepRange => ordered(sel.anchor, liveFocus(sel));

  /**
   * Takes a selection from `anchor` to `focus`: within one step it's the browser's own; across
   * steps the step with the moving end has the browser's selection (from its edge) and the
   * others are drawn selected.
   */
  const extendTo = (anchor: StepPoint, focus: StepPoint) => {
    if (anchor.step === focus.step) {
      setAcross(null);
      const backward = focus.offset < anchor.offset;
      focusAt(
        focus.step,
        Math.min(anchor.offset, focus.offset),
        Math.max(anchor.offset, focus.offset),
        backward ? "backward" : "forward",
      );
      return;
    }
    setAcross({ anchor, focus, text });
    const length = nowTexts()[focus.step]?.length ?? 0;
    if (focus.step > anchor.step) focusAt(focus.step, 0, focus.offset, "forward");
    else focusAt(focus.step, focus.offset, length, "backward");
  };

  // The browser's selection in the step with the moving end has to stay against that step's
  // edge; a click or anything else that moves it away ends the selection across steps.
  useEffect(() => {
    if (!across) return;
    const changed = () => {
      const sel = acrossRef.current;
      if (!sel || drag.current) return;
      const el = box(sel.focus.step);
      if (!el || document.activeElement !== el) {
        if (document.activeElement && boxes.current.has(stepKeyOf(document.activeElement))) {
          setAcross(null);
        }
        return;
      }
      const forward = sel.focus.step > sel.anchor.step;
      const atEdge = forward ? el.selectionStart === 0 : el.selectionEnd === el.value.length;
      if (!atEdge) setAcross(null);
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  });

  // --- Moving between steps ----------------------------------------------------------------

  /** Where an arrow key takes the cursor past a step's edge, or null to leave it to the browser. */
  const crossing = (step: number, offset: number, key: string): StepPoint | null => {
    const all = nowTexts();
    const length = all[step]?.length ?? 0;
    const copy = words(step);
    if (key === "ArrowLeft") {
      return offset === 0 && step > 0
        ? { step: step - 1, offset: all[step - 1]?.length ?? 0 }
        : null;
    }
    if (key === "ArrowRight") {
      return offset === length && step < all.length - 1 ? { step: step + 1, offset: 0 } : null;
    }
    if (!copy) return null;
    const up = key === "ArrowUp";
    const to = step + (up ? -1 : 1);
    if (to < 0 || to >= all.length) return null;
    const upstream = endWas.current?.step === step && endWas.current.offset === offset;
    if (!onEdgeLine(copy, length, offset, up ? "first" : "last", upstream)) return null;
    const target = words(to);
    const targetLength = all[to]?.length ?? 0;
    const x = caretAt(copy, length, offset, upstream).x;
    return {
      step: to,
      offset: target ? offsetNear(target, targetLength, x, up ? "last" : "first") : 0,
    };
  };

  const lastPoint = (): StepPoint => {
    const all = nowTexts();
    return { step: all.length - 1, offset: all.at(-1)?.length ?? 0 };
  };

  // --- Keys ------------------------------------------------------------------------------------

  const undoOrRedo = (redo: boolean) => {
    setAcross(null);
    // The cursor goes to the first step whose words come back changed.
    const waiting = { before: nowTexts() };
    afterUndo.current = waiting;
    void (redo ? onRedo() : onUndo()).then(() => {
      // Nothing to undo: nothing waits for it.
      requestAnimationFrame(() => {
        if (afterUndo.current === waiting) afterUndo.current = null;
      });
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, key: string) => {
    // Keys that pick or confirm a word being composed (Japanese, Chinese, Korean input) are the
    // input method's: Enter confirms it, the arrows choose. Safari says so with 229.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const el = event.currentTarget;
    const step = stepOf(key);
    const all = nowTexts();
    const value = el.value;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const collapsed = start === end;
    const mod = event.ctrlKey || event.metaKey;
    const letter = event.key.length === 1 ? event.key.toLowerCase() : "";
    const arrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key);
    // Where End left the cursor counts for this key only.
    endWas.current = endAt.current;
    if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) endAt.current = null;
    const lineEnd =
      (event.key === "End" && !mod && !event.altKey) ||
      (MAC && event.metaKey && event.key === "ArrowRight");
    if (lineEnd) {
      setTimeout(() => {
        if (document.activeElement !== el) return;
        const offset = el.selectionDirection === "backward" ? el.selectionStart : el.selectionEnd;
        endAt.current = { step: stepOf(key), offset };
      }, 0);
    }

    // Undo and Redo step back through splits, joins, pastes and moves as through typing.
    if (mod && !event.altKey && (letter === "z" || (letter === "y" && !MAC && !event.shiftKey))) {
      event.preventDefault();
      undoOrRedo(letter === "y" || event.shiftKey);
      return;
    }
    // Everything, as in one box.
    if (mod && !event.altKey && !event.shiftKey && letter === "a" && all.length > 1) {
      event.preventDefault();
      extendTo({ step: 0, offset: 0 }, lastPoint());
      return;
    }
    // The start or end of all the steps: Ctrl+Home / Ctrl+End (⌘↑ / ⌘↓ on a Mac).
    const toTop =
      mod &&
      !event.altKey &&
      (event.key === "Home" || (MAC && event.metaKey && event.key === "ArrowUp"));
    const toEnd =
      mod &&
      !event.altKey &&
      (event.key === "End" || (MAC && event.metaKey && event.key === "ArrowDown"));

    const sel = across;
    if (sel) {
      const range = liveRange(sel);
      if (event.key === "Enter" && !mod && !event.altKey) {
        event.preventDefault();
        apply(replaceRange(all, range, "\n"));
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        apply(replaceRange(all, range, ""));
      } else if (toTop || toEnd) {
        event.preventDefault();
        const point = toTop ? { step: 0, offset: 0 } : lastPoint();
        if (event.shiftKey) extendTo(sel.anchor, point);
        else {
          setAcross(null);
          focusAt(point.step, point.offset);
        }
      } else if (arrow && event.shiftKey && !mod && !event.altKey) {
        const focus = liveFocus(sel);
        const target = crossing(focus.step, focus.offset, event.key);
        if (target) {
          event.preventDefault();
          extendTo(sel.anchor, target);
        }
      } else if (
        !event.shiftKey &&
        (arrow || ["Home", "End", "PageUp", "PageDown", "Escape"].includes(event.key))
      ) {
        // Leaves the selection at its start or end, as in one box.
        event.preventDefault();
        const back = ["ArrowLeft", "ArrowUp", "Home", "PageUp"].includes(event.key);
        const point = event.key === "Escape" ? liveFocus(sel) : back ? range.start : range.end;
        setAcross(null);
        focusAt(point.step, point.offset);
      }
      return;
    }

    // Alt+↑ / Alt+↓ move the step, its number following.
    if (
      event.altKey &&
      !mod &&
      !event.shiftKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      const up = event.key === "ArrowUp";
      const moved = moveStep(all, step, up ? -1 : 1);
      if (!moved) return;
      pending.current = { step: moved.step, start, end };
      onChange(textFromSteps(moved.texts), true);
      onMoved(up ? "Moved up" : "Moved down");
      return;
    }
    // Enter starts a new step, or splits this one at the cursor.
    if (event.key === "Enter" && !mod && !event.altKey) {
      event.preventDefault();
      // An empty step stays the one empty step (it goes when the cursor leaves it).
      if (collapsed && isBlankStep(value)) return;
      apply(splitStep(all, { step, offset: start }, end));
      return;
    }
    // Backspace at a step's start joins it to the step above; Delete at its end joins the next.
    if (event.key === "Backspace" && collapsed && start === 0 && step > 0) {
      event.preventDefault();
      const joined = joinWithPrevious(all, step);
      if (joined) apply(joined);
      return;
    }
    if (event.key === "Delete" && collapsed && start === value.length && step < all.length - 1) {
      event.preventDefault();
      const joined = joinWithNext(all, step);
      if (joined) apply(joined);
      return;
    }
    if (toTop || toEnd) {
      event.preventDefault();
      const point = toTop ? { step: 0, offset: 0 } : lastPoint();
      if (event.shiftKey) {
        extendTo({ step, offset: el.selectionDirection === "backward" ? end : start }, point);
      } else focusAt(point.step, point.offset);
      return;
    }
    // The arrows go on into the next step from a step's edge, as between lines of one box.
    if (arrow && !mod && !event.altKey) {
      if (!event.shiftKey) {
        if (!collapsed) return;
        const target = crossing(step, start, event.key);
        if (target) {
          event.preventDefault();
          focusAt(target.step, target.offset);
        }
        return;
      }
      const backward = el.selectionDirection === "backward";
      const anchor = backward ? end : start;
      const focus = backward ? start : end;
      const target = crossing(step, focus, event.key);
      if (target) {
        event.preventDefault();
        extendTo({ step, offset: anchor }, target);
      }
    }
  };

  // Typing, deleting and the Edit menu over a selection across steps (the keys above cover most
  // of it; this covers what the keyboard's own events don't, and undo from the menu).
  useEffect(() => {
    const area = group.current;
    if (!area) return;
    const input = (event: InputEvent) => {
      if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
        event.preventDefault();
        undoOrRedo(event.inputType === "historyRedo");
        return;
      }
      const sel = acrossRef.current;
      if (!sel || event.inputType === "insertFromPaste" || event.isComposing) return;
      const range = liveRange(sel);
      if (event.inputType.startsWith("delete")) {
        event.preventDefault();
        apply(replaceRange(nowTexts(), range, ""));
      } else if (event.inputType.startsWith("insert")) {
        event.preventDefault();
        const paragraph =
          event.inputType === "insertParagraph" || event.inputType === "insertLineBreak";
        const typed = paragraph ? "\n" : (event.data ?? "");
        // A letter over the selection: one undo step with the letters typed after it.
        apply(
          replaceRange(nowTexts(), range, typed),
          paragraph || typed.includes("\n") || "before",
        );
      }
    };
    const composing = () => {
      const sel = acrossRef.current;
      if (sel) apply(replaceRange(nowTexts(), liveRange(sel), ""));
    };
    area.addEventListener("beforeinput", input);
    area.addEventListener("compositionstart", composing);
    return () => {
      area.removeEventListener("beforeinput", input);
      area.removeEventListener("compositionstart", composing);
    };
  });

  const onCopy = (event: ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    const sel = across;
    if (!sel) return;
    event.preventDefault();
    const range = liveRange(sel);
    event.clipboardData.setData("text/plain", selectedText(nowTexts(), range));
    if (cut) apply(replaceRange(nowTexts(), range, ""));
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const step = stepOf(stepKeyOf(target));
    const sel = across;
    let range: StepRange;
    if (sel) range = liveRange(sel);
    else if (step >= 0 && target instanceof HTMLTextAreaElement) {
      range = {
        start: { step, offset: target.selectionStart },
        end: { step, offset: target.selectionEnd },
      };
    } else return;
    const edit = pasteInto(nowTexts(), range, event.clipboardData.getData("text/plain"));
    if (!edit) return;
    event.preventDefault();
    apply(edit);
  };

  // --- The mouse ---------------------------------------------------------------------------

  /** The step at a height on the screen (the gap above a step belongs to it). */
  const stepAtY = (y: number): number => {
    const all = shown.current.keys;
    for (let i = 0; i < all.length; i++) {
      const row = rows.current.get(all[i] ?? "");
      if (row && y < row.getBoundingClientRect().bottom) return i;
    }
    return all.length - 1;
  };

  const pointAt = (x: number, y: number): StepPoint => {
    // Above the first step is the start of all of them, below the last their end, as in one box.
    const all = shown.current.keys;
    const first = rows.current.get(all[0] ?? "");
    const last = rows.current.get(all.at(-1) ?? "");
    if (first && y < first.getBoundingClientRect().top) return { step: 0, offset: 0 };
    if (last && y > last.getBoundingClientRect().bottom) return lastPoint();
    const step = stepAtY(y);
    const copy = words(step);
    const length = nowTexts()[step]?.length ?? 0;
    return { step, offset: copy ? offsetNear(copy, length, x, { y }) : length };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    endAt.current = null;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const inBox = target instanceof HTMLTextAreaElement;
    if (inBox && target.disabled) return;
    if (!inBox && target.closest("textarea, button, a")) return;
    const point = pointAt(event.clientX, event.clientY);
    if (event.shiftKey) {
      // Shift+click takes the selection from where the cursor is to there.
      const current = across
        ? across.anchor
        : focusedKey !== null
          ? (() => {
              const el = boxes.current.get(focusedKey);
              const at = stepOf(focusedKey);
              if (!el || at < 0) return null;
              return {
                step: at,
                offset: el.selectionDirection === "backward" ? el.selectionEnd : el.selectionStart,
              };
            })()
          : null;
      if (current && current.step !== point.step) {
        event.preventDefault();
        extendTo(current, point);
      }
      return;
    }
    setAcross(null);
    if (!inBox) {
      // The margin and the gaps between steps: the cursor goes to the nearest place.
      event.preventDefault();
      focusAt(point.step, point.offset);
      return;
    }
    if (event.pointerType !== "mouse") return;
    drag.current = { anchor: point, pointer: event.pointerId };
    const move = (moved: PointerEvent) => {
      const current = drag.current;
      if (!current || moved.pointerId !== current.pointer) return;
      const at = pointAt(moved.clientX, moved.clientY);
      if (at.step === current.anchor.step) {
        if (acrossRef.current) setAcross(null);
        return;
      }
      setAcross({ anchor: current.anchor, focus: at, text: shown.current.texts.join("\n") });
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      drag.current = null;
      const sel = acrossRef.current;
      // The moving end's step takes the cursor, so Shift and the arrows carry on from it.
      if (sel) requestAnimationFrame(() => extendTo(sel.anchor, sel.focus));
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  };

  // --- Leaving -------------------------------------------------------------------------------

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const area = group.current;
    const to = event.relatedTarget as Node | null;
    if (area && to && area.contains(to)) {
      // From one step to another, by the keys or the mouse: an empty step left behind goes.
      if (acrossRef.current) return;
      const left = stepOf(stepKeyOf(event.target));
      const dropped = left >= 0 ? dropBlankStep(nowTexts(), left) : null;
      if (!dropped) return;
      // A mouse press that moved the cursor here counts from the steps without it.
      const pressed = drag.current;
      if (pressed && pressed.anchor.step > left) {
        drag.current = { ...pressed, anchor: { ...pressed.anchor, step: pressed.anchor.step - 1 } };
      }
      onChange(textFromSteps(dropped), false);
      return;
    }
    // Wait a moment: a step taken away while it had the cursor hands it on to another.
    setTimeout(() => {
      if (area && area.contains(document.activeElement)) return;
      setFocusedKey(null);
      setAcross(null);
      onLeave();
    }, 0);
  };

  // --- Drawing -------------------------------------------------------------------------------

  const labels = stepLabels(texts, lines);
  const selected = across ? ordered(across.anchor, across.focus) : null;
  const tabStep = (() => {
    const home = homeKey === null ? -1 : keys.indexOf(homeKey);
    return home >= 0 ? home : 0;
  })();

  /** A step's words, with the part selected across steps drawn selected (not the step with the
   * browser's own selection). */
  const copyWords = (step: number, said: string, key: string): ReactNode => {
    if (!selected || key === focusedKey) return said;
    if (step < selected.start.step || step > selected.end.step) return said;
    const from = step === selected.start.step ? selected.start.offset : 0;
    const to = step === selected.end.step ? selected.end.offset : said.length;
    if (said === "") return <mark className={editor.stepSelected}> </mark>;
    return (
      <>
        {said.slice(0, from)}
        <mark className={editor.stepSelected}>{said.slice(from, to)}</mark>
        {said.slice(to)}
      </>
    );
  };

  return (
    <div
      ref={(element) => {
        group.current = element;
        rowsRef.current = element;
      }}
      className={editor.steps}
      role="group"
      aria-label={labels.group}
      data-margin=""
      data-empty={text === "" ? "" : undefined}
      data-across={across ? "" : undefined}
      onPointerDown={onPointerDown}
      onBlur={onBlur}
      onCopy={(event) => onCopy(event, false)}
      onCut={(event) => onCopy(event, true)}
      onPaste={onPaste}
    >
      {texts.map((said, step) => {
        const key = keys[step] ?? String(step);
        const mark = marks[step] ?? null;
        return (
          <div
            key={key}
            ref={(element) => keep(rows.current, key, element)}
            className={`${editor.marginRow} ${editor.step}`}
            data-heading={mark?.heading ? "" : undefined}
            data-linked={mark?.linked ? "" : undefined}
            data-current={key === focusedKey ? "" : undefined}
          >
            <span className={editor.margin} aria-hidden="true">
              {mark ? (
                <MarginMark
                  list="directions"
                  heading={mark.heading}
                  linked={mark.linked}
                  number={mark.number}
                />
              ) : null}
            </span>
            <span className={editor.stepCopy} aria-hidden="true" data-step-words="">
              <span ref={(element) => keep(copies.current, key, element)}>
                {copyWords(step, said, key)}
              </span>
            </span>
            <textarea
              ref={(element) => keep(boxes.current, key, element)}
              id={step === 0 ? id : undefined}
              className={editor.stepText}
              aria-label={labels.steps[step]}
              aria-describedby={describedBy}
              aria-invalid={invalid[step] ? true : undefined}
              rows={1}
              value={said}
              spellCheck
              tabIndex={step === tabStep ? 0 : -1}
              onChange={(event) => {
                const value = event.target.value;
                const edit = typedInto(nowTexts(), stepOf(key), value, event.target.selectionEnd);
                if (value.includes("\n")) apply(edit);
                else onChange(textFromSteps(edit.texts), false);
              }}
              onKeyDown={(event) => onKeyDown(event, key)}
              onFocus={() => {
                setFocusedKey(key);
                setHomeKey(key);
              }}
              // As tall as its words (the copy under it sizes it), so it never scrolls.
              onScroll={(event) => (event.currentTarget.scrollTop = 0)}
            />
          </div>
        );
      })}
      {text === "" ? (
        <div className={editor.stepExample} aria-hidden="true">
          {example}
        </div>
      ) : null}
    </div>
  );
}
