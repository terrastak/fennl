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
// subcategories. Only with a mouse: on a phone, or with the keyboard, the Categories page has
// Move, Move up and Move down. The rows carry `data-cat-key` so a drop can be worked out from
// where they are on screen (drop.ts).

/** How many drags show the hint ("Between two moves it there..."), counted on this device. */
const HINT_KEY = "fennl:category-drag-hint";
const HINT_TIMES = 3;
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
  hint: boolean;
}

function hintCount(): number {
  try {
    return Number(localStorage.getItem(HINT_KEY) ?? "0") || 0;
  } catch {
    return HINT_TIMES;
  }
}

function countHint(n: number) {
  try {
    localStorage.setItem(HINT_KEY, String(n));
  } catch {
    // Not kept; the hint shows again next time.
  }
}

/** Stops the click that ends a drag from opening the category it was dropped on. */
function swallowNextClick() {
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
      if (!state) return;
      const panel = scroller.current?.getBoundingClientRect();
      const inPanel =
        !!panel &&
        pointer.x >= panel.left &&
        pointer.x <= panel.right &&
        pointer.y >= panel.top &&
        pointer.y <= panel.bottom;
      const drop = inPanel ? dropAt(rows(), pointer.y) : null;
      const current = latest.current.tree;
      const fresh = current?.byKey.get(state.node.key) ?? state.node;
      const check = drop && current ? checkDrop(current, fresh, drop) : null;
      state = { ...state, node: fresh, x: pointer.x, y: pointer.y, drop, check };
      document.documentElement.dataset.categoryDrag = check === "refused" ? "refused" : "on";
      setDrag(state);
    };

    // Held near the panel's top or bottom edge, the list scrolls on its own.
    const scroll = (time: number) => {
      const panel = scroller.current;
      if (state && panel) {
        const rect = panel.getBoundingClientRect();
        const inside = pointer.x >= rect.left && pointer.x <= rect.right;
        const edge =
          pointer.y < rect.top + SCROLL_EDGE ? -1 : pointer.y > rect.bottom - SCROLL_EDGE ? 1 : 0;
        // A row picked up at an edge doesn't scroll the list until the mouse has left the edge.
        if (edge === 0) armed = true;
        if (!inside || edge === 0 || !armed) atEdgeSince = 0;
        else if (atEdgeSince === 0) atEdgeSince = time;
        if (atEdgeSince !== 0 && time - atEdgeSince >= SCROLL_WAIT) {
          const step = edge * 6;
          const before = panel.scrollTop;
          panel.scrollTop += step;
          if (panel.scrollTop !== before) place();
        }
      }
      frame = requestAnimationFrame(scroll);
    };

    const move = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (cancelled) return;
      if (!state) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
        const seen = hintCount();
        countHint(seen + 1);
        state = {
          node,
          x: e.clientX,
          y: e.clientY,
          grabX: startX - row.left,
          drop: null,
          check: null,
          left: row.left,
          span: row.width,
          hint: seen < HINT_TIMES,
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

    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !state) return;
      e.preventDefault();
      cancelled = true;
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
