import { useEffect, useState, type DragEvent } from "react";
import type { RecipePhoto } from "../../shared/recipe";
import type { PhotoChange } from "../../shared/sync";
import { canEdit } from "../sync/status";
import { saveChanges, useSyncStatus } from "../sync/useSync";
import { addPhotos, problemText, type AddPhotoProblem } from "./addPhotos";
import { orderAt } from "./order";
import { PhotoImage } from "./PhotoImage";
import { currentPhotoCache } from "./usePhoto";
import styles from "./photoEditor.module.css";

// The editor's photos (phase D2; spec.md D2): add, reorder, choose the cover, remove. The first
// photo is the cover, so "Make cover" moves it to the front. On phones and tablets there are two
// buttons, "Take photo" (straight to the camera) and "Choose photos"; computers get "Choose
// photos" and dropping files on the section (decided 2026-10-09, judged by touch, not brand).

const PICKABLE = "image/jpeg,image/png,image/webp,image/gif";

function touchDevice(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

const move = (photo: RecipePhoto, sortOrder: number): PhotoChange => ({
  kind: "photo",
  id: photo.id,
  recipeId: photo.recipeId,
  fields: { sortOrder },
  changedAt: Date.now(),
});

const removal = (photo: RecipePhoto, deleted: boolean): PhotoChange => ({
  kind: "photo",
  id: photo.id,
  recipeId: photo.recipeId,
  fields: {},
  deleted,
  changedAt: Date.now(),
});

export function PhotoEditor({
  recipeId,
  ownerUserId,
  photos,
  created,
}: {
  recipeId: string;
  ownerUserId: string;
  /** The recipe's photos not removed, in order. */
  photos: RecipePhoto[];
  /** The recipe exists (it has a title): photos can be added. */
  created: boolean;
}) {
  const status = useSyncStatus();
  const plan = status.photos;
  const editable = canEdit(status);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);
  const [problem, setProblem] = useState<AddPhotoProblem | null>(null);
  const [removed, setRemoved] = useState<RecipePhoto | null>(null);
  const [dropping, setDropping] = useState(false);
  const [touch] = useState(touchDevice);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const gallery = photos.filter((p) => p.role === "photo");
  const max = plan?.maxPerRecipe ?? null;
  const room = max === null ? null : Math.max(0, max - gallery.length);
  const premium = plan?.enabled ?? false;
  const canAdd = premium && editable && created && online && adding === null && room !== 0;

  const add = async (files: File[]) => {
    const cache = currentPhotoCache();
    if (!files.length || !cache) return;
    setProblem(null);
    setRemoved(null);
    setAdding({ done: 0, total: room === null ? files.length : Math.min(files.length, room) });
    const result = await addPhotos({
      files,
      recipeId,
      ownerUserId,
      kind: "dish",
      existingOrders: gallery.map((p) => p.sortOrder),
      room,
      maxFileBytes: plan?.maxFileBytes ?? null,
      cache,
      onProgress: (done, total) => setAdding({ done, total }),
    });
    setAdding(null);
    setProblem(result.problem);
  };

  const others = (photo: RecipePhoto) =>
    gallery.filter((p) => p.id !== photo.id).map((p) => p.sortOrder);

  const moveTo = (photo: RecipePhoto, index: number) =>
    void saveChanges([move(photo, orderAt(others(photo), index))]);

  const remove = async (photo: RecipePhoto) => {
    if (await saveChanges([removal(photo, true)])) setRemoved(photo);
  };

  const undo = async () => {
    if (removed && (await saveChanges([removal(removed, false)]))) setRemoved(null);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDropping(false);
    if (!canAdd) return;
    void add([...event.dataTransfer.files].filter((f) => f.type.startsWith("image/")));
  };

  const filePicker = (label: string, camera: boolean, primary: boolean) => (
    <label
      className={`${primary ? styles.primary : styles.secondary} ${canAdd ? "" : styles.off}`}
      aria-disabled={!canAdd}
    >
      <input
        type="file"
        className="visually-hidden"
        accept={camera ? "image/*" : PICKABLE}
        {...(camera ? { capture: "environment" as const } : { multiple: true })}
        disabled={!canAdd}
        onChange={(event) => {
          // Copied first: clearing the input empties the list, and it must be cleared so the
          // same photo can be picked again.
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          void add(files);
        }}
      />
      {label}
    </label>
  );

  return (
    <section
      className={`${styles.section} ${dropping ? styles.dropping : ""}`}
      aria-labelledby="photos-heading"
      onDragOver={(event) => {
        if (!canAdd || touch) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <div className={styles.top}>
        <h2 id="photos-heading" className={styles.heading}>
          Photos
        </h2>
        {premium && max !== null ? (
          <p className={styles.count}>
            {gallery.length} of {max}
          </p>
        ) : null}
      </div>

      {gallery.length > 0 ? (
        <ol className={styles.photos} aria-label="Photos, the first is the cover">
          {gallery.map((photo, index) => (
            <li key={photo.id} className={styles.photo}>
              <PhotoImage
                hash={photo.imageHash}
                size="thumb"
                width={photo.width}
                height={photo.height}
                alt={`Photo ${index + 1}${index === 0 ? ", the cover" : ""}`}
                className={styles.thumb}
              />
              {index === 0 ? <span className={styles.coverTag}>Cover</span> : null}
              <div className={styles.photoButtons}>
                {index > 0 ? (
                  <button
                    type="button"
                    className={styles.small}
                    disabled={!editable}
                    onClick={() => moveTo(photo, 0)}
                  >
                    Make cover
                  </button>
                ) : null}
                {index > 0 ? (
                  <button
                    type="button"
                    className={styles.small}
                    disabled={!editable}
                    aria-label={`Move photo ${index + 1} earlier`}
                    onClick={() => moveTo(photo, index - 1)}
                  >
                    ←
                  </button>
                ) : null}
                {index < gallery.length - 1 ? (
                  <button
                    type="button"
                    className={styles.small}
                    disabled={!editable}
                    aria-label={`Move photo ${index + 1} later`}
                    onClick={() => moveTo(photo, index + 1)}
                  >
                    →
                  </button>
                ) : null}
                <button
                  type="button"
                  className={styles.small}
                  disabled={!editable}
                  aria-label={`Remove photo ${index + 1}`}
                  onClick={() => void remove(photo)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {plan && !premium ? (
        <p className={styles.note}>
          {gallery.length > 0
            ? "Adding photos is a Premium feature. These photos stay, and you can still reorder or remove them."
            : "Photos are a Premium feature."}
        </p>
      ) : premium ? (
        <>
          <div className={styles.buttons}>
            {touch ? filePicker("Take photo", true, true) : null}
            {filePicker(touch ? "Choose photos" : "Add photos", false, !touch)}
          </div>
          {!touch && canAdd ? <p className={styles.note}>Or drop photos here.</p> : null}
          {!created ? (
            <p className={styles.note}>Give the recipe a title first, then add photos.</p>
          ) : !online ? (
            <p className={styles.note}>
              Adding photos needs a connection. Everything else here still saves.
            </p>
          ) : room === 0 ? (
            <p className={styles.note}>
              This recipe has {max} photos, the most it can have. Remove one to add another.
            </p>
          ) : null}
        </>
      ) : null}

      {adding ? (
        <p role="status" className={styles.note}>
          Adding photo {Math.min(adding.done + 1, adding.total)} of {adding.total}…
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className={styles.problem}>
          {problemText(problem, max)}
        </p>
      ) : null}
      {removed ? (
        <p role="status" className={styles.note}>
          Photo removed.{" "}
          <button type="button" className={styles.link} onClick={() => void undo()}>
            Undo
          </button>
        </p>
      ) : null}
    </section>
  );
}
