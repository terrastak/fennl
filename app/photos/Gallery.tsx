import { useEffect, useRef, useState } from "react";
import type { RecipePhoto } from "../../shared/recipe";
import { PhotoImage } from "./PhotoImage";
import styles from "./gallery.module.css";

// A recipe's photos on its page (phase D2): the cover large at the top, the others as small
// copies under it. Any of them opens full screen, where a photographed cookbook page can be read:
// pinch to zoom on a phone, or "Actual size" to scroll around it.

export function Gallery({
  photos,
  title,
  addedBy,
}: {
  /** Gallery photos in order; the first is the cover. */
  photos: RecipePhoto[];
  title: string;
  /** "Added by Sarah", for a photo someone else in the household added; null for none. */
  addedBy: (photo: RecipePhoto) => string | null;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const cover = photos[0];
  if (!cover) return null;
  const rest = photos.slice(1);
  return (
    <section className={styles.gallery} aria-label="Photos">
      <button
        type="button"
        className={styles.coverButton}
        onClick={() => setOpen(0)}
        aria-label={`Open the photo of ${title} full screen`}
      >
        <PhotoImage
          hash={cover.imageHash}
          size="full"
          width={cover.width}
          height={cover.height}
          alt={`${title}`}
          className={styles.cover}
        />
      </button>
      {rest.length > 0 ? (
        <ul className={styles.strip}>
          {rest.map((photo, i) => (
            <li key={photo.id}>
              <button
                type="button"
                className={styles.thumbButton}
                onClick={() => setOpen(i + 1)}
                aria-label={`Open photo ${i + 2} of ${photos.length} full screen`}
              >
                <PhotoImage
                  hash={photo.imageHash}
                  size="thumb"
                  width={photo.width}
                  height={photo.height}
                  alt=""
                  className={styles.thumb}
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open !== null ? (
        <Viewer
          photos={photos}
          index={open}
          title={title}
          addedBy={addedBy}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}

function Viewer({
  photos,
  index,
  title,
  addedBy,
  onIndex,
  onClose,
}: {
  photos: RecipePhoto[];
  index: number;
  title: string;
  addedBy: (photo: RecipePhoto) => string | null;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // "Actual size" is for one photo: moving to another goes back to fitting the screen.
  const [actualFor, setActualFor] = useState<number | null>(null);
  const actual = actualFor === index;
  const photo = photos[index];

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  if (!photo) return null;
  const by = addedBy(photo);
  const go = (to: number) => onIndex((to + photos.length) % photos.length);
  return (
    <dialog
      ref={dialog}
      className={styles.viewer}
      aria-label={`Photo ${index + 1} of ${photos.length}: ${title}`}
      onClose={onClose}
      onKeyDown={(event) => {
        if (photos.length < 2) return;
        if (event.key === "ArrowRight") go(index + 1);
        if (event.key === "ArrowLeft") go(index - 1);
      }}
    >
      <div className={styles.viewerBar}>
        <p className={styles.viewerText}>
          {photos.length > 1 ? `${index + 1} of ${photos.length}` : null}
          {by ? `${photos.length > 1 ? " · " : ""}Added by ${by}` : null}
        </p>
        <div className={styles.viewerButtons}>
          <button
            type="button"
            className={styles.viewerButton}
            onClick={() => setActualFor(actual ? null : index)}
          >
            {actual ? "Fit to screen" : "Actual size"}
          </button>
          <button
            type="button"
            className={styles.viewerButton}
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
      </div>
      <div className={`${styles.stage} ${actual ? styles.actual : ""}`}>
        <PhotoImage
          key={photo.id}
          hash={photo.imageHash}
          size="full"
          width={photo.width}
          height={photo.height}
          alt={`${title}, photo ${index + 1} of ${photos.length}`}
          className={actual ? styles.actualImage : styles.fitImage}
          fit="contain"
        />
      </div>
      {photos.length > 1 ? (
        <div className={styles.viewerNav}>
          <button type="button" className={styles.viewerButton} onClick={() => go(index - 1)}>
            ← Previous
          </button>
          <button type="button" className={styles.viewerButton} onClick={() => go(index + 1)}>
            Next →
          </button>
        </div>
      ) : null}
    </dialog>
  );
}
