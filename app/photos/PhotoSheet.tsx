import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { RecipePhoto } from "../../shared/recipe";
import { LaptopIcon } from "../recipes/LaptopIcon";
import { LAPTOP_ICONS } from "../recipes/laptopIcons";
import { swallowNextClick } from "../shell/useCategoryDrag";
import { PhotoImage } from "./PhotoImage";
import styles from "./photoEditor.module.css";

// All photos (U27, owner's choices 2026-11-21, the mockup "C3"): the recipe editor on a laptop
// shows the first two photos; this sheet shows every one, four across, each with its place, Cover
// on the first and the same small buttons as the editor's. A photo is dragged to a new place with
// the mouse (lifted, with a dashed gap where it will land), or moved with ← and → once focused;
// screen readers hear where it's going. Add photos is the last tile. No Done: each change is made
// at once; Close or Escape goes back to the editor, the focus where it was.

/** How far the mouse moves, pressed, before a click becomes a drag. */
const THRESHOLD = 5;

interface Drag {
  id: string;
  from: number;
  to: number;
  /** Where the mouse is, and where on the photo it was picked up. */
  x: number;
  y: number;
  grabX: number;
  grabY: number;
  width: number;
  /** Each place's middle on screen, measured as the drag starts (every place is the same size). */
  slots: { x: number; y: number }[];
}

interface Press {
  id: string;
  from: number;
  x: number;
  y: number;
}

/** The list with one photo taken from `from` and put at `to`. */
function moved<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  if (item !== undefined) copy.splice(to, 0, item);
  return copy;
}

export function PhotoSheet({
  gallery,
  max,
  editable,
  controls,
  addTile,
  messages,
  onMove,
  onClose,
}: {
  gallery: RecipePhoto[];
  max: number | null;
  editable: boolean;
  /** The small buttons under a photo: Make cover, earlier, later, Remove. */
  controls: (photo: RecipePhoto, index: number) => ReactNode;
  addTile: ReactNode;
  /** Adding, a problem, "Photo removed." with Undo: shown here while the sheet is open. */
  messages: ReactNode;
  onMove: (photo: RecipePhoto, index: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const grid = useRef<HTMLOListElement>(null);
  const [press, setPress] = useState<Press | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [said, setSaid] = useState("");
  // The photo (and which of its buttons) to give the focus back to once it has moved: moving an
  // element in the page takes the focus away from it.
  const refocus = useRef<{ id: string; act: string | null } | null>(null);
  // The drag as the window's listeners see it, kept with the state that draws it.
  const dragging = useRef<Drag | null>(null);
  const setDragging = (next: Drag | null) => {
    dragging.current = next;
    setDrag(next);
  };

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const order = gallery.map((p) => p.id).join(" ");
  useLayoutEffect(() => {
    const wanted = refocus.current;
    if (!wanted) return;
    const item = grid.current?.querySelector<HTMLElement>(`[data-photo-id="${wanted.id}"]`);
    if (!item) return;
    refocus.current = null;
    const button = wanted.act
      ? item.querySelector<HTMLButtonElement>(`[data-act="${wanted.act}"]:not(:disabled)`)
      : null;
    (button ?? item.querySelector<HTMLElement>("[data-tile]"))?.focus();
  }, [order]);

  // Pressed on a photo: past a few pixels it becomes a drag; let go, it lands.
  useEffect(() => {
    if (!press) return;
    const move = (event: PointerEvent) => {
      const current = dragging.current;
      if (!current) {
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < THRESHOLD) return;
        const items = [...(grid.current?.querySelectorAll<HTMLElement>("[data-tile]") ?? [])];
        const slots = items.map((el) => {
          const box = el.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        });
        const box = items[press.from]?.getBoundingClientRect();
        if (!box) return;
        setDragging({
          id: press.id,
          from: press.from,
          to: press.from,
          x: event.clientX,
          y: event.clientY,
          grabX: press.x - box.left,
          grabY: press.y - box.top,
          width: box.width,
          slots,
        });
        setSaid(`Moving photo ${press.from + 1}.`);
        return;
      }
      // The place whose middle is nearest the photo's middle.
      const midX = event.clientX - current.grabX + current.width / 2;
      const midY = event.clientY - current.grabY + (current.width * 2) / 3 / 2;
      let to = current.to;
      let best = Infinity;
      current.slots.forEach((slot, i) => {
        const distance = Math.hypot(slot.x - midX, slot.y - midY);
        if (distance < best) {
          best = distance;
          to = i;
        }
      });
      if (to !== current.to) setSaid(`Moving photo ${current.from + 1} to place ${to + 1}.`);
      setDragging({ ...current, x: event.clientX, y: event.clientY, to });
    };
    const up = () => {
      const current = dragging.current;
      setPress(null);
      setDragging(null);
      if (!current) return;
      swallowNextClick();
      const photo = gallery.find((p) => p.id === current.id);
      if (photo && current.to !== current.from) {
        onMove(photo, current.to);
        setSaid(`Moved photo ${current.from + 1} to place ${current.to + 1}.`);
      } else {
        setSaid("");
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [press, gallery, onMove]);

  const startPress = (event: ReactPointerEvent, photo: RecipePhoto, index: number) => {
    if (!editable || event.button !== 0 || event.pointerType === "touch") return;
    // A drag, not the browser's own dragging of the picture or selecting text.
    event.preventDefault();
    setPress({ id: photo.id, from: index, x: event.clientX, y: event.clientY });
  };

  const onTileKey = (event: KeyboardEvent, photo: RecipePhoto, index: number) => {
    if (!editable || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const to =
      event.key === "ArrowLeft" ? index - 1 : event.key === "ArrowRight" ? index + 1 : null;
    if (to === null) return;
    event.preventDefault();
    if (to < 0 || to >= gallery.length) return;
    refocus.current = { id: photo.id, act: null };
    onMove(photo, to);
    setSaid(`Moved photo ${index + 1} to place ${to + 1}.`);
  };

  // While dragging, the list as it will be once dropped: the dragged photo a dashed gap.
  const shown = drag ? moved(gallery, drag.from, drag.to) : gallery;
  const lifted = drag ? gallery[drag.from] : undefined;

  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      aria-labelledby="all-photos-heading"
      onClose={onClose}
      onCancel={(event) => {
        // Escape while dragging puts the photo back, and leaves the sheet open.
        if (dragging.current) {
          event.preventDefault();
          setPress(null);
          setDragging(null);
          setSaid("");
        }
      }}
      onClick={(event) => {
        // Moving a photo with its buttons: keep the focus on the button it moved with.
        const button = (event.target as HTMLElement).closest<HTMLElement>("[data-act]");
        const id = button?.closest<HTMLElement>("[data-photo-id]")?.dataset.photoId;
        const act = button?.dataset.act;
        if (id && (act === "earlier" || act === "later" || act === "cover")) {
          refocus.current = { id, act: act === "cover" ? "later" : act };
        }
      }}
    >
      <div className={styles.sheetHead}>
        <h2 id="all-photos-heading" className={styles.sheetTitle}>
          All photos
        </h2>
        {max !== null ? (
          <p className={styles.sheetCount}>
            {gallery.length} of {max}
          </p>
        ) : null}
        <button type="button" className={styles.sheetClose} onClick={() => dialog.current?.close()}>
          <LaptopIcon path={LAPTOP_ICONS.x} />
          Close
        </button>
      </div>
      <ol
        ref={grid}
        className={`${styles.sheetGrid} ${drag ? styles.sheetDragging : ""}`}
        aria-label="All photos"
      >
        {shown.map((photo, index) => {
          const gap = drag?.id === photo.id;
          return (
            <li
              key={photo.id}
              className={`${styles.sheetPhoto} ${gap ? styles.sheetGap : ""}`}
              data-photo-id={photo.id}
              data-hash={photo.imageHash}
            >
              <div
                className={styles.sheetTile}
                data-tile=""
                tabIndex={0}
                role="group"
                aria-label={`Photo ${index + 1} of ${gallery.length}${index === 0 ? ", the cover" : ""}`}
                aria-keyshortcuts={editable ? "ArrowLeft ArrowRight" : undefined}
                onPointerDown={(event) => startPress(event, photo, gallery.indexOf(photo))}
                onKeyDown={(event) => onTileKey(event, photo, index)}
                onDragStart={(event) => event.preventDefault()}
              >
                <PhotoImage
                  hash={photo.imageHash}
                  size="thumb"
                  width={photo.width}
                  height={photo.height}
                  // The group's name says it ("Photo 1 of 6, the cover").
                  alt=""
                  className={styles.sheetThumb}
                />
                {index === 0 ? (
                  <span className={styles.coverTag} aria-hidden="true">
                    <LaptopIcon path={LAPTOP_ICONS.star} fill />
                    Cover
                  </span>
                ) : null}
                <span className={styles.place} aria-hidden="true">
                  {index + 1}
                </span>
              </div>
              {controls(photo, index)}
            </li>
          );
        })}
        <li className={styles.sheetAdd}>{addTile}</li>
      </ol>
      {drag && lifted ? (
        <div
          className={styles.lifted}
          aria-hidden="true"
          style={{
            left: `${drag.x - drag.grabX}px`,
            top: `${drag.y - drag.grabY}px`,
            width: `${drag.width}px`,
          }}
        >
          <PhotoImage
            hash={lifted.imageHash}
            size="thumb"
            width={lifted.width}
            height={lifted.height}
            alt=""
            className={styles.sheetThumb}
          />
          <span className={`${styles.place} ${styles.placeLifted}`}>{drag.to + 1}</span>
        </div>
      ) : null}
      {messages}
      <p className="visually-hidden" role="status">
        {said}
      </p>
    </dialog>
  );
}
