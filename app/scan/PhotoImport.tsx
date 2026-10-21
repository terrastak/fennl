import { useEffect, useRef, useState } from "react";
import { IMPORT_RULES, type ImportJobSummary } from "../../shared/importJobs";
import type { AiImportUsage } from "../../shared/limits";
import { importPhotoPages, photoProblemText } from "../import/api";
import { AI_PAUSED_TEXT, aiResetText } from "../limits/limitText";
import { photoEncoder, problemText, UploadProblem, uploadPrepared } from "../photos/addPhotos";
import { preparePhoto } from "../photos/prepare";
import { currentPhotoCache } from "../photos/usePhoto";
import recipes from "../recipes/recipes.module.css";
import { activeSyncClient, useSyncStatus } from "../sync/useSync";
import { cameraAvailable } from "./camera";
import { CameraView } from "./CameraView";
import { CropDialog } from "./CropDialog";
import {
  allScreenshots,
  cropOnOriginal,
  isScreenshot,
  moved,
  turned,
  type ScanPage,
} from "./pages";
import { editedPreview, smallCopy } from "./preview";
import { looksBlurry } from "./sharpness";
import styles from "./scan.module.css";

// Importing a recipe from photos (phase E9; spec.md E9): photograph the pages with the live
// camera (page after page, then Done), the phone's own camera, or choose photos; put them in
// order, turn, crop or remove them; then Fennl prepares each page on this device (at most
// 3000 px, WebP about 90: spec.md D2), uploads it to the person's photos (counted like any photo)
// and the AI reads them into a draft for review. On phones and tablets (judged by touch) there's
// the live camera and the phone's own camera as well as choosing photos; computers choose photos.
// E11: screenshots are chosen the same way; when every page is one, the AI reads them as
// screenshots of a post, message or email (isScreenshot, app/scan/pages.ts).

const PICKABLE = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";

function touchDevice(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

const editKey = (page: ScanPage) => `${page.turns}:${JSON.stringify(page.crop)}`;

export function PhotoImport({ onImported }: { onImported(jobs: ImportJobSummary[]): void }) {
  const status = useSyncStatus();
  const [ai, setAi] = useState<AiImportUsage | null>(null);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const made = useRef(new Map<string, { key: string; url: string }>());
  const [camera, setCamera] = useState(false);
  const [cropping, setCropping] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [touch] = useState(touchDevice);
  const [online, setOnline] = useState(() => navigator.onLine);
  const problemRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/ai/usage")
      .then((res) => (res.ok ? (res.json() as Promise<AiImportUsage>) : null))
      .then((usage) => {
        if (live && usage) setAi(usage);
      })
      .catch(() => undefined);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      live = false;
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  // Each page's preview, turned and cropped as arranged, redrawn only when that changes.
  useEffect(() => {
    let live = true;
    const ids = new Set(pages.map((p) => p.id));
    for (const [id, preview] of made.current) {
      if (!ids.has(id)) {
        URL.revokeObjectURL(preview.url);
        made.current.delete(id);
      }
    }
    void Promise.all(
      pages.map(async (page) => {
        const key = editKey(page);
        const had = made.current.get(page.id);
        if (had?.key === key) return;
        const url = await editedPreview(page.small, page).catch(() => null);
        if (!url) return;
        if (!live) {
          URL.revokeObjectURL(url);
          return;
        }
        if (had) URL.revokeObjectURL(had.url);
        made.current.set(page.id, { key, url });
      }),
    ).then(() => {
      if (live) {
        setPreviews(Object.fromEntries([...made.current].map(([id, p]) => [id, p.url])));
      }
    });
    return () => {
      live = false;
    };
  }, [pages]);

  useEffect(
    () => () => {
      for (const preview of made.current.values()) URL.revokeObjectURL(preview.url);
    },
    [],
  );

  const premiumPhotos = status.photos?.enabled ?? true;
  const notIncluded = ai ? !ai.enabled : !premiumPhotos;
  const unavailable = notIncluded
    ? "Reading recipes from photos is part of Premium."
    : ai?.paused
      ? AI_PAUSED_TEXT
      : ai?.usedUp
        ? aiResetText(ai)
        : null;
  const room = IMPORT_RULES.photoPages - pages.length;
  const canAdd = !unavailable && working === null && room > 0;

  /**
   * Adds pictures as pages (as many as there's room for). `taken`: by the camera, just now.
   * Returns the pages added.
   */
  const addPictures = async (files: Blob[], taken: boolean): Promise<ScanPage[]> => {
    setProblem(null);
    const wanted = files.slice(0, Math.max(0, room));
    const added: ScanPage[] = [];
    let unusable = 0;
    for (const file of wanted) {
      try {
        const { small, sharpness } = await smallCopy(file);
        added.push({
          id: crypto.randomUUID(),
          file,
          small,
          sharpness,
          screenshot: isScreenshot(file, taken),
          turns: 0,
          crop: null,
        });
      } catch {
        unusable += 1;
      }
    }
    setPages((current) => [...current, ...added].slice(0, IMPORT_RULES.photoPages));
    if (unusable > 0) {
      setProblem(
        unusable === 1
          ? "One file isn't a photo Fennl can use. Try a JPEG, PNG, WebP or GIF."
          : `${unusable} files aren't photos Fennl can use. Try JPEG, PNG, WebP or GIF.`,
      );
    } else if (files.length > wanted.length) {
      setProblem(
        `Up to ${IMPORT_RULES.photoPages} photos make one recipe; the rest were left out.`,
      );
    }
    return added;
  };

  const choose = (input: HTMLInputElement, taken: boolean) => {
    const files = input.files ? [...input.files] : [];
    input.value = "";
    void addPictures(files, taken).then((added) => {
      if (added.length > 0) {
        setAnnounce(added.length === 1 ? "Photo added." : `${added.length} photos added.`);
      }
    });
  };

  const update = (id: string, change: (page: ScanPage) => ScanPage) =>
    setPages((current) => current.map((p) => (p.id === id ? change(p) : p)));

  const remove = (index: number) => {
    setPages((current) => current.filter((_, i) => i !== index));
    setAnnounce(`Page ${index + 1} removed.`);
  };

  const move = (index: number, to: number) => {
    setPages((current) => moved(current, index, to));
    setAnnounce(`Page ${index + 1} is now page ${to + 1}.`);
  };

  const read = async () => {
    const cache = currentPhotoCache();
    const me = activeSyncClient()?.userId;
    if (!cache || !me || pages.length === 0) return;
    setProblem(null);
    const hashes: string[] = [];
    try {
      for (const [i, page] of pages.entries()) {
        const of = `${i + 1} of ${pages.length}`;
        setWorking(pages.length === 1 ? "Getting the photo ready…" : `Getting page ${of} ready…`);
        const prepared = await preparePhoto(
          page.file,
          "page",
          photoEncoder(),
          status.photos?.maxFileBytes ?? null,
          { turns: page.turns, crop: cropOnOriginal(page) },
        ).catch(() => {
          throw new UploadProblem("not_a_photo");
        });
        setWorking(pages.length === 1 ? "Uploading the photo…" : `Uploading page ${of}…`);
        hashes.push(await uploadPrepared(prepared, me, cache));
      }
    } catch (error) {
      setWorking(null);
      setProblem(
        error instanceof UploadProblem
          ? problemText(error.problem, null)
          : "The photos couldn't be uploaded. Please try again.",
      );
      return;
    }
    setWorking("Reading the recipe… This can take up to a minute.");
    const result = await importPhotoPages(hashes, allScreenshots(pages));
    setWorking(null);
    if ("problem" in result) {
      setProblem(photoProblemText(result.problem));
      return;
    }
    setPages([]);
    onImported(result.jobs);
  };

  const croppingPage = pages.find((p) => p.id === cropping);

  return (
    <section className={styles.section} aria-labelledby="import-photos-title">
      <h2 id="import-photos-title">From photos or screenshots</h2>
      <p>
        A handwritten card, a cookbook page or a printout: take a photo of each side or page. Or a
        recipe in a post, message or email: choose its screenshots. Put them in order, and Fennl
        reads them into a recipe for you to check. They&rsquo;re kept with the recipe.
      </p>

      {unavailable ? (
        <p className={recipes.hint}>{unavailable}</p>
      ) : !online ? (
        <p className={recipes.hint}>Importing photos needs a connection.</p>
      ) : (
        <div className={styles.addButtons}>
          {touch && cameraAvailable() ? (
            <button
              type="button"
              className={recipes.primary}
              disabled={!canAdd}
              onClick={() => {
                setProblem(null);
                setCamera(true);
              }}
            >
              Scan pages
            </button>
          ) : null}
          {touch ? (
            <label className={`${recipes.secondary} ${canAdd ? "" : styles.off}`}>
              <input
                type="file"
                className="visually-hidden"
                accept="image/*"
                capture="environment"
                disabled={!canAdd}
                onChange={(event) => choose(event.currentTarget, true)}
              />
              Take photo
            </label>
          ) : null}
          <label
            className={`${touch ? recipes.secondary : recipes.primary} ${canAdd ? "" : styles.off}`}
          >
            <input
              type="file"
              className="visually-hidden"
              accept={PICKABLE}
              multiple
              disabled={!canAdd}
              onChange={(event) => choose(event.currentTarget, false)}
            />
            Choose photos
          </label>
        </div>
      )}

      {pages.length > 0 ? (
        <>
          <h3 className={styles.pagesTitle} id="pages-title">
            {pages.length === 1 ? "1 page" : `${pages.length} pages`}, read in this order
          </h3>
          <ol className={styles.pages} aria-labelledby="pages-title">
            {pages.map((page, i) => {
              const n = i + 1;
              return (
                <li key={page.id} className={styles.page}>
                  <div className={styles.pagePicture}>
                    {previews[page.id] ? <img src={previews[page.id]} alt={`Page ${n}`} /> : null}
                  </div>
                  <div className={styles.pageText}>
                    <p className={styles.pageName}>Page {n}</p>
                    {looksBlurry(page.sharpness) ? (
                      <p className={styles.blurNote}>Looks blurry. A clearer photo reads better.</p>
                    ) : null}
                    <div className={styles.pageTools}>
                      <button
                        type="button"
                        className={styles.tool}
                        aria-label={`Move page ${n} up`}
                        disabled={i === 0 || working !== null}
                        onClick={() => move(i, i - 1)}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className={styles.tool}
                        aria-label={`Move page ${n} down`}
                        disabled={i === pages.length - 1 || working !== null}
                        onClick={() => move(i, i + 1)}
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        className={styles.tool}
                        aria-label={`Turn page ${n}`}
                        disabled={working !== null}
                        onClick={() => {
                          update(page.id, turned);
                          setAnnounce(`Page ${n} turned.`);
                        }}
                      >
                        Turn
                      </button>
                      <button
                        type="button"
                        className={styles.tool}
                        aria-label={`Crop page ${n}`}
                        disabled={working !== null}
                        onClick={() => setCropping(page.id)}
                      >
                        Crop
                      </button>
                      <button
                        type="button"
                        className={styles.tool}
                        aria-label={`Remove page ${n}`}
                        disabled={working !== null}
                        onClick={() => remove(i)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {room === 0 ? (
            <p className={recipes.hint}>
              That&rsquo;s {IMPORT_RULES.photoPages} photos, as many as one recipe takes.
            </p>
          ) : null}
          <div className={styles.addButtons}>
            <button
              type="button"
              className={recipes.primary}
              disabled={working !== null || !online || Boolean(unavailable)}
              onClick={() => void read()}
            >
              Read the recipe
            </button>
            <button
              type="button"
              className={recipes.secondary}
              disabled={working !== null}
              onClick={() => {
                setPages([]);
                setProblem(null);
                setAnnounce("Pages cleared.");
              }}
            >
              Start over
            </button>
          </div>
          <p className={recipes.hint}>
            Reading counts as one of this month&rsquo;s AI imports. The photos are stored in your
            account with the recipe.
          </p>
        </>
      ) : null}

      {working ? (
        <p role="status" className={recipes.hint}>
          {working}
        </p>
      ) : null}
      {problem ? (
        <p ref={problemRef} tabIndex={-1} role="alert" className={styles.problem}>
          {problem}
        </p>
      ) : null}
      <p role="status" className="visually-hidden">
        {announce}
      </p>

      {camera ? (
        <CameraView
          count={pages.length}
          max={IMPORT_RULES.photoPages}
          onTaken={async (picture) => {
            const [page] = await addPictures([picture], true);
            return page ? { id: page.id, sharpness: page.sharpness } : null;
          }}
          onRetake={(id) => setPages((current) => current.filter((p) => p.id !== id))}
          onDone={() => setCamera(false)}
          onFailed={(reason) => {
            setCamera(false);
            setProblem(
              reason === "NotAllowedError"
                ? "Fennl wasn't allowed to use the camera. You can allow it in your browser's settings, or use “Take photo” for your phone's own camera."
                : "The camera didn't start. Use “Take photo” for your phone's own camera instead.",
            );
          }}
        />
      ) : null}
      {croppingPage ? (
        <CropDialog
          small={croppingPage.small}
          edit={croppingPage}
          pageNumber={pages.indexOf(croppingPage) + 1}
          onCancel={() => setCropping(null)}
          onDone={(crop) => {
            update(croppingPage.id, (p) => ({ ...p, crop }));
            setCropping(null);
            setAnnounce(
              crop ? `Page ${pages.indexOf(croppingPage) + 1} cropped.` : "Showing the whole page.",
            );
          }}
        />
      ) : null}
    </section>
  );
}
