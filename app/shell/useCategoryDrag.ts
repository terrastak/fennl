import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { checkDrop, dropAt, type Drop, type RowBox } from "../categories/drop";
import type { CategoryNode, CategoryTree, PlaceCheck } from "../categories/tree";

// Dragging a category in the left panel to put it in order (U17, owner's choices 2026-11-04):
// between two rows moves it there, onto one puts it inside, never into itself or its own
// subcategories (the drop does nothing, and the cursor says so; U18 took away the hint, the
// message and the Undo after a drag). Only with a mouse: on a phone, or with the keyboard, the Categories page has
// Move, Move up and Move down. The rows carry `data-cat-key` so a drop can be worked out from
// where they are on screen (drop.ts).

/** How far the mouse moves, pressed, before a click becomes a drag. */
const THRESHOLD = 5;
/** How close to the panel's top or bottom edge the list scrolls, once the mouse waits there. */
const SCROLL_EDGE = 24;
const SCROLL_WAIT = 300;

export interface DragState {
  node: CategoryNode;
  x: number;
  y: number;
  /** Where across the row it was picked up, so it moves sideways with the mouse from there. */
  grabX: number;
  drop: Drop | null;
  check: PlaceCheck | null;
  /** The rows' left edge and width, for the insertion line. */
  left: number;
  span: number;
}

/**
 * What scrolls the panel's rows: the panel itself, or on a short screen the whole left panel
 * (Library.module.css lets it scroll as one column there).
 */
export function scrollParent(element: HTMLElement): HTMLElement {
  for (let el: HTMLElement | null = element; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  return element;
}

/** The part of the panel on screen: inside what scrolls it. */
function visibleBox(panel: HTMLElement) {
  const own = panel.getBoundingClientRect();
  const box = scrollParent(panel);
  const outer = box === panel ? own : box.getBoundingClientRect();
  return {
    box,
    left: own.left,
    right: own.right,
    top: Math.max(own.top, outer.top),
    bottom: Math.min(own.bottom, outer.bottom),
  };
}

/** Stops the click that ends a drag from opening what it was dropped on. */
export function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}

export function useCategoryDrag({
  tree,
  enabled,
  scroller,
  onDrop,
}: {
  tree: CategoryTree | null;
  enabled: boolean;
  /** The scrolling panel the rows are in. */
  scroller: RefObject<HTMLElement | null>;
  onDrop: (node: CategoryNode, drop: Drop) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const latest = useRef({ tree, onDrop });
  useEffect(() => {
    latest.current = { tree, onDrop };
  });
  const end = useRef<(() => void) | null>(null);
  // Leaving the page (or the panel going away) mid-drag ends it.
  useEffect(() => () => end.current?.(), []);

  const rows = (): RowBox[] => {
    const panel = scroller.current;
    const current = latest.current.tree;
    if (!panel || !current) return [];
    const boxes: RowBox[] = [];
    for (const element of panel.querySelectorAll<HTMLElement>("[data-cat-key]")) {
      const node = current.byKey.get(element.dataset.catKey ?? "");
      const rect = element.getBoundingClientRect();
      if (node && rect.height > 0) boxes.push({ node, top: rect.top, bottom: rect.bottom });
    }
    return boxes;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, node: CategoryNode) => {
    if (!enabled || event.pointerType !== "mouse" || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    end.current?.();
    const row = event.currentTarget.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let state: DragState | null = null;
    let cancelled = false;
    let pointer = { x: startX, y: startY };
    let frame = 0;
    /** When the mouse reached an edge of the panel (0: it isn't at one). */
    let atEdgeSince = 0;
    let armed = false;

    const place = () => {
      if (!state || cancelled) return;
      const panel = scroller.current ? visibleBox(scroller.current) : null;
      const inPanel =
        !!panel &&
        pointer.x >= panel.left &&
        pointer.x <= panel.right &&
        pointer.y >= panel.top &&
        pointer.y <= panel.bottom;
      // The level the lifted row is at: its own, one further in for each step (the width of an
      // indent) it's moved right, one out for each step left. At the end of a list of
      // subcategories this chooses between "last inside it" and "next, a level out".
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const level = state.node.depth + Math.round((pointer.x - startX) / rem);
      const drop = inPanel ? dropAt(rows(), pointer.y, level) : null;
      const current = latest.current.tree;
      const fresh = current?.byKey.get(state.node.key) ?? state.node;
      const check = drop && current ? checkDrop(current, fresh, drop) : null;
      state = { ...state, node: fresh, x: pointer.x, y: pointer.y, drop, check };
      document.documentElement.dataset.categoryDrag = check === "refused" ? "refused" : "on";
      setDrag(state);
    };

    // Held near the panel's top or bottom edge, the list scrolls on its own.
    const scroll = (time: number) => {
      if (cancelled) return;
      const panel = scroller.current;
      if (state && panel) {
        const rect = visibleBox(panel);
        const inside = pointer.x >= rect.left && pointer.x <= rect.right;
        const edge =
          pointer.y < rect.top + SCROLL_EDGE ? -1 : pointer.y > rect.bottom - SCROLL_EDGE ? 1 : 0;
        // A row picked up at an edge doesn't scroll the list until the mouse has left the edge.
        if (edge === 0) armed = true;
        if (!inside || edge === 0 || !armed) atEdgeSince = 0;
        else if (atEdgeSince === 0) atEdgeSince = time;
        if (atEdgeSince !== 0 && time - atEdgeSince >= SCROLL_WAIT) {
          const step = edge * 6;
          const before = rect.box.scrollTop;
          rect.box.scrollTop += step;
          if (rect.box.scrollTop !== before) place();
        }
      }
      frame = requestAnimationFrame(scroll);
    };

    const move = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (cancelled) return;
      if (!state) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
        state = {
          node,
          x: e.clientX,
          y: e.clientY,
          grabX: startX - row.left,
          drop: null,
          check: null,
          left: row.left,
          span: row.width,
        };
        frame = requestAnimationFrame(scroll);
      }
      e.preventDefault();
      place();
    };

    const up = () => {
      const finished = state;
      cleanup();
      if (!finished) return;
      swallowNextClick();
      if (!cancelled && finished.drop && finished.check === "ok") {
        latest.current.onDrop(finished.node, finished.drop);
      }
    };

    // Escape puts it back: nothing moves, the list stops scrolling, and the release that
    // follows still doesn't open the category under the mouse.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !state || cancelled) return;
      e.preventDefault();
      cancelled = true;
      cancelAnimationFrame(frame);
      setDrag(null);
      delete document.documentElement.dataset.categoryDrag;
    };

    const cleanup = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cleanup);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cleanup);
      delete document.documentElement.dataset.categoryDrag;
      setDrag(null);
      end.current = null;
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cleanup);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cleanup);
    end.current = cleanup;
  };

  return { drag, onPointerDown };
}
