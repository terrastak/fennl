import { useEffect, useState, type DragEvent } from "react";
import { photoLevel } from "../../shared/limits";
import { arrangedByFennl } from "../../shared/photoOrder";
import type { RecipePhoto } from "../../shared/recipe";
import type { PhotoChange } from "../../shared/sync";
import { photosNearText } from "../limits/limitText";
import { useUsage } from "../limits/useLimits";
import { Link } from "../router";
import { canEdit } from "../sync/status";
import { saveChanges, useSyncStatus } from "../sync/useSync";
import { addPhotos, problemText, type AddPhotoProblem } from "./addPhotos";
import { arrangeRecipePhotos } from "./arrange";
import { orderAt } from "./order";
import { PhotoImage } from "./PhotoImage";
import { currentPhotoCache } from "./usePhoto";
import { LaptopIcon } from "../recipes/LaptopIcon";
import { LAPTOP_ICONS } from "../recipes/laptopIcons";
import { DoneBar } from "../ui/DoneBar";
import { WarmNote } from "../ui/WarmNote";
import styles from "./photoEditor.module.css";

// The editor's photos (phase D2; spec.md D2): add, reorder, choose the cover, remove. The first
// photo is the cover, so "Make cover" moves it to the front. On phones and tablets there are two
// buttons, "Take photo" (straight to the camera) and "Choose photos"; computers get "Choose
// photos" and dropping files on the section (decided 2026-10-09, judged by touch, not brand).

const PICKABLE = "image/jpeg,image/png,image/webp,image/gif";

function touchDevice(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

/** A photo moved by the person: the recipe's order is theirs from now on (phase D4). */
const move = (photo: RecipePhoto, sortOrder: number): PhotoChange => ({
  kind: "photo",
  id: photo.id,
  recipeId: photo.recipeId,
  fields: { sortOrder, arrangedBy: "person" },
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
  // "Photo removed." with Undo, then "Undone." once used: the bar stays after its first use, so
  // the focus has somewhere to go when the Remove button goes with its photo, and after Undo.
  const [removed, setRemoved] = useState<{ photo: RecipePhoto | null; at: number } | null>(null);
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
  // The household's photo storage (phase D3): a note from 80%, and no adding once it's full.
  const quota = useUsage()?.photos;
  const level = quota?.enabled ? photoLevel(quota) : "fine";
  const quotaFull = level === "full" || level === "over";
  const canAdd =
    premium && editable && created && online && adding === null && room !== 0 && !quotaFull;

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
    // Fennl puts them in order, unless they were arranged by hand (phase D4).
    if (result.added > 0) void arrangeRecipePhotos(recipeId);
  };

  const others = (photo: RecipePhoto) =>
    gallery.filter((p) => p.id !== photo.id).map((p) => p.sortOrder);

  const moveTo = (photo: RecipePhoto, index: number) =>
    void saveChanges([move(photo, orderAt(others(photo), index))]);

  const remove = async (photo: RecipePhoto) => {
    if (await saveChanges([removal(photo, true)])) setRemoved({ photo, at: Date.now() });
  };

  const undo = async () => {
    const photo = removed?.photo;
    if (photo && (await saveChanges([removal(photo, false)]))) setRemoved({ photo: null, at: 0 });
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDropping(false);
    if (!canAdd) return;
    void add([...event.dataTransfer.files].filter((f) => f.type.startsWith("image/")));
  };

  // On a laptop (U23) a computer's "Add photos" is a tile at the end of the photos ("or drop
  // them here", while dropping works), or a small button beside why it can't be used yet.
  const filePicker = (label: string, camera: boolean, primary: boolean, tile = false) => (
    <label
      className={`${primary ? styles.primary : styles.secondary} ${canAdd ? "" : styles.off} ${
        tile ? (gallery.length > 0 ? styles.tile : styles.tileSmall) : ""
      }`}
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
      {tile ? <LaptopIcon path={LAPTOP_ICONS.addPhoto} /> : null}
      {label}
      {tile && canAdd && gallery.length > 0 ? (
        <small className={styles.tileHint}> or drop them here</small>
      ) : null}
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

      {/* The white box on a laptop (U23); adds nothing on phones. */}
      <div className={styles.box}>
        {arrangedByFennl(gallery) ? (
          <p className={`${styles.note} ${styles.arranged}`}>
            <LaptopIcon path={LAPTOP_ICONS.spark} />
            Arranged by Fennl. Moving a photo keeps your own order from then on.
          </p>
        ) : null}
        <div className={styles.strip}>
          {gallery.length > 0 ? (
            <ol className={styles.photos} aria-label="Photos, the first is the cover">
              {gallery.map((photo, index) => (
                <li key={photo.id} className={styles.photo} data-hash={photo.imageHash}>
                  <PhotoImage
                    hash={photo.imageHash}
                    size="thumb"
                    width={photo.width}
                    height={photo.height}
                    alt={`Photo ${index + 1}${index === 0 ? ", the cover" : ""}`}
                    className={styles.thumb}
                  />
                  {index === 0 ? (
                    <span className={styles.coverTag}>
                      <LaptopIcon path={LAPTOP_ICONS.star} fill />
                      Cover
                    </span>
                  ) : null}
                  {/* One row of small controls under each photo on a laptop (U23): Make cover (or
                  "The cover"), then earlier, later and Remove as icons with tooltips. */}
                  <div className={styles.photoButtons}>
                    {index > 0 ? (
                      <button
                        type="button"
                        className={`${styles.small} ${styles.words}`}
                        disabled={!editable}
                        onClick={() => moveTo(photo, 0)}
                      >
                        Make cover
                      </button>
                    ) : (
                      <span className={styles.theCover} aria-hidden="true" />
                    )}
                    {index > 0 ? (
                      <button
                        type="button"
                        className={`${styles.small} ${styles.iconButton}`}
                        disabled={!editable}
                        aria-label={`Move photo ${index + 1} earlier`}
                        title="Move earlier"
                        onClick={() => moveTo(photo, index - 1)}
                      >
                        <span className={styles.glyph}>←</span>
                        <LaptopIcon path={LAPTOP_ICONS.left} />
                      </button>
                    ) : null}
                    {index < gallery.length - 1 ? (
                      <button
                        type="button"
                        className={`${styles.small} ${styles.iconButton}`}
                        disabled={!editable}
                        aria-label={`Move photo ${index + 1} later`}
                        title="Move later"
                        onClick={() => moveTo(photo, index + 1)}
                      >
                        <span className={styles.glyph}>→</span>
                        <LaptopIcon path={LAPTOP_ICONS.right} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={`${styles.small} ${styles.iconButton}`}
                      disabled={!editable}
                      aria-label={`Remove photo ${index + 1}`}
                      title="Remove"
                      onClick={() => void remove(photo)}
                    >
                      <span className={styles.glyph}>Remove</span>
                      <LaptopIcon path={LAPTOP_ICONS.trash} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}

          {premium ? (
            <div className={styles.buttons}>
              {touch ? filePicker("Take photo", true, true) : null}
              {filePicker(touch ? "Choose photos" : "Add photos", false, !touch, !touch)}
            </div>
          ) : null}
        </div>
        {plan && !premium ? (
          <p className={styles.note}>
            {gallery.length > 0
              ? "Adding photos is a Premium feature. These photos stay, and you can still reorder or remove them."
              : "Photos are a Premium feature."}
          </p>
        ) : premium ? (
          <>
            {!touch && canAdd ? (
              <p className={`${styles.note} ${styles.dropNote}`}>Or drop photos here.</p>
            ) : null}
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
            {quota && level !== "fine" ? (
              <WarmNote className={styles.note}>
                {photosNearText(quota, quotaFull)}{" "}
                <Link href="/account#usage">Usage and limits</Link>
              </WarmNote>
            ) : null}
          </>
        ) : null}

        {adding ? (
          <p role="status" className={styles.note}>
            Adding photo {Math.min(adding.done + 1, adding.total)} of {adding.total}…
          </p>
        ) : null}
        {problem ? (
          <WarmNote role="alert" className={styles.problem}>
            {problemText(problem, max)}
          </WarmNote>
        ) : null}
        {removed ? (
          <DoneBar
            message={removed.photo ? "Photo removed." : "Undone."}
            onUndo={removed.photo ? () => void undo() : null}
            focusKey={removed.at}
            className={styles.note}
            messageClassName={styles.inline}
            undoClassName={styles.link}
          />
        ) : null}
      </div>
    </section>
  );
}
