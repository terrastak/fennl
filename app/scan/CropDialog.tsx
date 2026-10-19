import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { WHOLE_PAGE, dragCorner, fitBox, type Corner, type CropBox, type PageEdit } from "./pages";
import { editedPreview } from "./preview";
import styles from "./scan.module.css";

// Cropping a page before it's read (phase E9; spec.md E9, step 2): drag a corner of the frame, or
// move it with the arrow keys (Shift for bigger steps). The rest of the photo is left out of what
// the AI reads and of the photo kept with the recipe.

const CORNERS: { corner: Corner; label: string }[] = [
  { corner: "top-left", label: "Top left corner" },
  { corner: "top-right", label: "Top right corner" },
  { corner: "bottom-left", label: "Bottom left corner" },
  { corner: "bottom-right", label: "Bottom right corner" },
];

const percent = (n: number) => `${(n * 100).toFixed(2)}%`;

export function CropDialog({
  small,
  edit,
  pageNumber,
  onDone,
  onCancel,
}: {
  small: Blob;
  edit: PageEdit;
  pageNumber: number;
  onDone(crop: CropBox | null): void;
  onCancel(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [box, setBox] = useState<CropBox>(edit.crop ?? WHOLE_PAGE);
  const [dragging, setDragging] = useState<Corner | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    let made: string | null = null;
    let live = true;
    void editedPreview(small, { turns: edit.turns, crop: null }, 1200).then((u) => {
      made = u;
      if (live) setUrl(u);
      else URL.revokeObjectURL(u);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [small, edit.turns]);

  const pointAt = (event: PointerEvent) => {
    const rect = picture.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };

  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    const point = pointAt(event);
    if (point) setBox((b) => dragCorner(b, dragging, point.x, point.y));
  };

  const onKey = (corner: Corner) => (event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    setBox((b) => {
      const x = corner.endsWith("left") ? b.x : b.x + b.width;
      const y = corner.startsWith("top") ? b.y : b.y + b.height;
      return dragCorner(b, corner, x + move[0], y + move[1]);
    });
  };

  const cornerAt = (corner: Corner) => ({
    left: percent(corner.endsWith("left") ? box.x : box.x + box.width),
    top: percent(corner.startsWith("top") ? box.y : box.y + box.height),
  });

  return (
    <dialog
      ref={dialog}
      className={styles.cropDialog}
      aria-labelledby="crop-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <div className={styles.cropBar}>
        <h2 id="crop-title" className={styles.cropTitle}>
          Crop page {pageNumber}
        </h2>
        <p className={styles.cropHint}>
          Drag the corners to just the recipe, or choose a corner and use the arrow keys.
        </p>
      </div>
      <div className={styles.cropStage}>
        {url ? (
          <div
            className={styles.cropFrame}
            onPointerMove={onMove}
            onPointerUp={() => setDragging(null)}
            onPointerCancel={() => setDragging(null)}
          >
            <img ref={picture} src={url} alt={`Page ${pageNumber}`} draggable={false} />
            <div
              className={styles.cropBox}
              aria-hidden="true"
              style={{
                left: percent(box.x),
                top: percent(box.y),
                width: percent(box.width),
                height: percent(box.height),
              }}
            />
            {CORNERS.map(({ corner, label }) => (
              <button
                key={corner}
                type="button"
                className={styles.cropHandle}
                aria-label={label}
                style={cornerAt(corner)}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  setDragging(corner);
                }}
                onPointerMove={onMove}
                onPointerUp={() => setDragging(null)}
                onKeyDown={onKey(corner)}
              />
            ))}
          </div>
        ) : (
          <p role="status">Opening the page…</p>
        )}
      </div>
      <div className={styles.cropButtons}>
        <button type="button" className={styles.cameraButton} onClick={() => setBox(WHOLE_PAGE)}>
          Whole page
        </button>
        <button type="button" className={styles.cameraButton} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={styles.cameraDone} onClick={() => onDone(fitBox(box))}>
          Done
        </button>
      </div>
    </dialog>
  );
}
