import { useEffect, useState, type DragEvent } from "react";
import type { DraftPhoto } from "../../shared/drafts";
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
import { PhotoSheet } from "./PhotoSheet";
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

/** The recipe editor's draft gallery (U27 part 3), changed by the editor, applied at Done. */
export interface DraftGallery {
  photos: DraftPhoto[];
  /** The person moved a photo or chose the cover in this draft: the order is theirs. */
  arranged: boolean;
  /** The gallery as the person changed it; `arranged`: they moved a photo or chose the cover. */
  onSet: (photos: DraftPhoto[], arranged: boolean) => void;
  /** A photo just uploaded, added at the end. */
  onAdd: (photo: DraftPhoto) => void;
}

/** A draft's photo as the editor shows it (its place in the draft is its order). */
function shownPhoto(
  photo: DraftPhoto,
  index: number,
  recipeId: string,
  saved: Map<string, RecipePhoto>,
  arranged: boolean,
): RecipePhoto {
  const stored = saved.get(photo.id);
  return {
    id: photo.id,
    recipeId,
    imageHash: photo.imageHash,
    role: "photo",
    width: photo.width,
    height: photo.height,
    sortOrder: index,
    addedByUserId: stored?.addedByUserId ?? "",
    takenAt: photo.takenAt,
    arrangedBy: arranged ? "person" : (stored?.arrangedBy ?? null),
    updatedAt: stored?.updatedAt ?? "",
    deletedAt: null,
    serverSeq: stored?.serverSeq ?? 0,
  };
}

const asDraftPhoto = (photo: RecipePhoto): DraftPhoto => ({
  id: photo.id,
  imageHash: photo.imageHash,
  width: photo.width,
  height: photo.height,
  takenAt: photo.takenAt ?? null,
});

export function PhotoEditor({
  recipeId,
  ownerUserId,
  photos,
  created,
  compact = false,
  draft,
}: {
  recipeId: string;
  ownerUserId: string;
  /** The recipe's photos not removed, in order. */
  photos: RecipePhoto[];
  /** The recipe exists (it has a title): photos can be added. */
  created: boolean;
  /**
   * The recipe editor on a laptop (U27): beside the title in the editor's narrow column, with no
   * white frame; the first two photos, the rest in the All photos sheet (PhotoSheet.tsx). Phones
   * look as before either way.
   */
  compact?: boolean;
  /**
   * The recipe editor (U27 part 3): photos added, removed, moved and made the cover go into the
   * draft; `photos` is then the saved recipe's.
   */
  draft?: DraftGallery;
}) {
  const status = useSyncStatus();
  const plan = status.photos;
  const editable = canEdit(status);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);
  const [problem, setProblem] = useState<AddPhotoProblem | null>(null);
  // "Photo removed." with Undo, then "Undone." once used: the bar stays after its first use, so
  // the focus has somewhere to go when the Remove button goes with its photo, and after Undo.
  const [removed, setRemoved] = useState<{
    photo: RecipePhoto | null;
    at: number;
    /** Where it was, to put it back there (in a draft). */
    index?: number;
  } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [touch] = useState(touchDevice);
  // The All photos sheet, open (U27, on a laptop).
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const saved = new Map(photos.map((p) => [p.id, p]));
  const gallery = draft
    ? draft.photos.map((p, i) => shownPhoto(p, i, recipeId, saved, draft.arranged))
    : photos.filter((p) => p.role === "photo");
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
      ...(draft ? { keep: draft.onAdd } : {}),
    });
    setAdding(null);
    setProblem(result.problem);
    // Fennl puts them in order, unless they were arranged by hand (phase D4); in the editor
    // that happens after Done, on the photos applied.
    if (result.added > 0 && !draft) void arrangeRecipePhotos(recipeId);
  };

  // On a laptop the editor shows the first two; the rest are in the All photos sheet (U27).
  const inEditor = compact ? gallery.slice(0, 2) : gallery;
  const hidden = gallery.length - inEditor.length;

  const others = (photo: RecipePhoto) =>
    gallery.filter((p) => p.id !== photo.id).map((p) => p.sortOrder);

  const moveTo = (photo: RecipePhoto, index: number) => {
    if (draft) {
      const list = draft.photos.filter((p) => p.id !== photo.id);
      list.splice(index, 0, asDraftPhoto(photo));
      draft.onSet(list, true);
      return;
    }
    void saveChanges([move(photo, orderAt(others(photo), index))]);
  };

  const remove = async (photo: RecipePhoto) => {
    if (draft) {
      const index = draft.photos.findIndex((p) => p.id === photo.id);
      draft.onSet(
        draft.photos.filter((p) => p.id !== photo.id),
        false,
      );
      setRemoved({ photo, at: Date.now(), index });
      return;
    }
    if (await saveChanges([removal(photo, true)])) setRemoved({ photo, at: Date.now() });
  };

  const undo = async () => {
    const photo = removed?.photo;
    if (photo && draft) {
      const list = draft.photos.filter((p) => p.id !== photo.id);
      list.splice(Math.min(removed.index ?? list.length, list.length), 0, asDraftPhoto(photo));
      draft.onSet(list, false);
      setRemoved({ photo: null, at: 0 });
      return;
    }
    if (photo && (await saveChanges([removal(photo, false)]))) setRemoved({ photo: null, at: 0 });
  };

  // One row of small controls under each photo on a laptop (U23): Make cover (or "The cover"),
  // then earlier, later and Remove as icons with tooltips.
  const controls = (photo: RecipePhoto, index: number) => (
    <div className={styles.photoButtons}>
      {index > 0 ? (
        <button
          type="button"
          className={`${styles.small} ${styles.words}`}
          data-act="cover"
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
          data-act="earlier"
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
          data-act="later"
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
  );

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

  const messages = (
    <>
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
    </>
  );

  return (
    <section
      className={`${styles.section} ${compact ? styles.compact : ""} ${
        dropping ? styles.dropping : ""
      }`}
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
        {premium && max !== null && !(compact && gallery.length === 0) ? (
          <p className={styles.count}>
            {gallery.length} of {max}
          </p>
        ) : null}
        {compact && gallery.length > 1 ? (
          <button type="button" className={styles.showAll} onClick={() => setSheet(true)}>
            <LaptopIcon path={LAPTOP_ICONS.grid} />
            {gallery.length > 2 ? `Show all ${gallery.length} photos` : "Show all photos"} / reorder
          </button>
        ) : null}
      </div>

      {/* The white box on a laptop (U23); adds nothing on phones. */}
      <div className={styles.box}>
        {!compact && arrangedByFennl(gallery) ? (
          <p className={`${styles.note} ${styles.arranged}`}>
            <LaptopIcon path={LAPTOP_ICONS.spark} />
            Arranged by Fennl. Moving a photo keeps your own order from then on.
          </p>
        ) : null}
        <div className={styles.strip}>
          {gallery.length > 0 ? (
            <ol className={styles.photos} aria-label="Photos, the first is the cover">
              {inEditor.map((photo, index) => (
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
                  {index === inEditor.length - 1 && hidden > 0 ? (
                    <span className={styles.more} aria-hidden="true">
                      +{hidden}
                    </span>
                  ) : null}
                  {controls(photo, index)}
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
              <p className={styles.note}>
                {compact
                  ? "Give the recipe a title first."
                  : "Give the recipe a title first, then add photos."}
              </p>
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

        {sheet && compact ? null : messages}
      </div>
      {sheet && compact ? (
        <PhotoSheet
          gallery={gallery}
          max={premium ? max : null}
          editable={editable}
          controls={controls}
          addTile={premium ? filePicker("Add photos", false, true, true) : null}
          messages={messages}
          onMove={moveTo}
          onClose={() => {
            setSheet(false);
            // "Photo removed." comes back to the editor without taking the focus from Show all.
            setRemoved((last) => (last ? { ...last, at: 0 } : last));
          }}
        />
      ) : null}
    </section>
  );
}
