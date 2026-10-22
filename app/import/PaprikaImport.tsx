import { useEffect, useRef, useState } from "react";
import type { Entitlements } from "../../shared/entitlements";
import { PaprikaFileError, blobSource, type ByteSource } from "../../shared/paprikaFile";
import { formatBytes } from "../pages/plan";
import { arrangeRecipePhotos } from "../photos/arrange";
import { currentPhotoCache } from "../photos/usePhoto";
import recipes from "../recipes/recipes.module.css";
import { Link } from "../router";
import { activeSyncClient, saveChanges, useCategoryTree, useSyncStatus } from "../sync/useSync";
import styles from "./import.module.css";
import {
  planPaprika,
  previewPaprika,
  runPaprikaImport,
  type PaprikaPreview,
  type PaprikaResult,
} from "./paprikaImport";

// "From Paprika" on the Import page (phase E13; spec.md E13). The person chooses the export
// file (in Paprika: File › Export, All Recipes); it's read on this device and previewed: how many
// recipes are new, which changed in Paprika since they were last imported (update them, keeping
// the version here, or leave them), photos, and anything that couldn't be read. Then it imports,
// with progress. Choosing the file again picks up where an interrupted import stopped.

const FILE_PROBLEMS: Record<"not_zip" | "not_paprika" | "too_many" | "damaged", string> = {
  not_zip:
    "This isn't a Paprika export. In Paprika, choose File › Export, then All Recipes, and choose the .paprikarecipes file it saves.",
  not_paprika:
    "This file has no Paprika recipes in it. In Paprika, choose File › Export, then All Recipes, and choose the .paprikarecipes file it saves.",
  too_many: "This file holds more recipes than Fennl can import at once (20,000).",
  damaged: "This file looks damaged. Export it from Paprika again and try that.",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sends everything waiting and waits until the server has it. False when it can't. */
async function settle(): Promise<boolean> {
  const client = activeSyncClient();
  if (!client) return false;
  for (let i = 0; i < 120; i++) {
    await client.syncNow();
    const status = client.getStatus();
    if (status.phase === "saved" && status.pending === 0) return true;
    if (["offline", "signed_out", "upgrade", "unavailable"].includes(status.phase)) return false;
    await wait(500);
  }
  return false;
}

function resultText(result: PaprikaResult): string {
  const parts: string[] = [];
  if (result.added > 0) parts.push(`Imported ${plural(result.added, "new recipe")}.`);
  if (result.updated > 0) {
    parts.push(
      `Updated ${plural(result.updated, "recipe")} from Paprika; each one's earlier version is kept, and its page says so.`,
    );
  }
  if (result.photosAdded > 0) parts.push(`Added ${plural(result.photosAdded, "photo")}.`);
  if (result.added === 0 && result.updated === 0 && result.photosAdded === 0) {
    parts.push("Nothing new was imported.");
  }
  if (result.photosLeft > 0) {
    parts.push(
      result.photoProblem === "quota_full"
        ? `Your photo storage is full, so ${plural(result.photosLeft, "photo")} weren't added. Make room, then choose the file again to add them.`
        : `${plural(result.photosLeft, "photo")} couldn't be added. Choose the file again to try them.`,
    );
  }
  if (result.stopped === "offline") {
    parts.push(
      "The import stopped because the connection went. What came in is saved; choose the file again to carry on.",
    );
  }
  if (result.stopped === "versions") {
    parts.push(
      "Recipes that changed in Paprika were left as they are, since Fennl couldn't keep their earlier versions. Choose the file again to try once more.",
    );
  }
  return parts.join(" ");
}

export function PaprikaImport() {
  const status = useSyncStatus();
  const tree = useCategoryTree();
  const [plan, setPlan] = useState<Entitlements | null>(null);
  const [file, setFile] = useState<{ source: ByteSource; name: string } | null>(null);
  const [preview, setPreview] = useState<PaprikaPreview | null>(null);
  const [update, setUpdate] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const previewRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/entitlements")
      .then((res) => (res.ok ? (res.json() as Promise<Entitlements>) : null))
      .then((value) => {
        if (live && value) setPlan(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  const allowed = plan?.import_structured_enabled ?? true;

  const choose = async (chosen: File | undefined) => {
    const client = activeSyncClient();
    if (!chosen || !client) return;
    setMessage(null);
    setPreview(null);
    const source = blobSource(chosen);
    setWorking("Opening the file…");
    try {
      const existing = await client.importedRecipes("paprika");
      const read = await previewPaprika(
        source,
        chosen.name,
        existing,
        status.usage?.maxRecipeBytes ?? null,
        (done, total) => setWorking(`Reading recipe ${Math.min(done + 1, total)} of ${total}…`),
      );
      setFile({ source, name: chosen.name });
      setPreview(read);
      setUpdate(true);
      requestAnimationFrame(() => previewRef.current?.focus());
    } catch (error) {
      setMessage({
        text:
          error instanceof PaprikaFileError
            ? (FILE_PROBLEMS[error.problem] ?? FILE_PROBLEMS.damaged)
            : "Fennl couldn't read that file. Try exporting it from Paprika again.",
        problem: true,
      });
    } finally {
      setWorking(null);
    }
  };

  const summary = preview ? planPaprika(preview, status.usage, status.photos) : null;
  const photosOn = status.photos?.enabled ?? false;
  const fillPhotos =
    preview && photosOn
      ? preview.items.filter(
          (item) =>
            item.missingPhotos.length > 0 &&
            (item.status === "unchanged" || (item.status === "changed" && !update)),
        )
      : [];
  const toDo = summary
    ? summary.add.length + (update ? summary.changed.length : 0) + fillPhotos.length
    : 0;

  const start = async () => {
    const me = activeSyncClient()?.userId;
    const client = activeSyncClient();
    if (!file || !summary || !tree || !me || !client) return;
    setMessage(null);
    setWorking("Starting…");
    const result = await runPaprikaImport(file.source, summary, update, fillPhotos, {
      me,
      tree,
      cache: currentPhotoCache(),
      photos: status.photos,
      save: saveChanges,
      settle,
      getRecipe: (id) => client.getRecipe(id),
      arrange: arrangeRecipePhotos,
      now: () => Date.now(),
      wait,
      onProgress: setWorking,
    }).catch((): PaprikaResult => ({
      added: 0,
      updated: 0,
      photosAdded: 0,
      photosLeft: 0,
      photoProblem: null,
      stopped: "offline",
    }));
    setWorking(null);
    setPreview(null);
    setFile(null);
    setMessage({ text: resultText(result), problem: result.stopped !== null });
  };

  const photoUsage = status.usage?.photos;
  const photoRoom =
    photoUsage && photoUsage.maxBytes !== null
      ? Math.max(0, photoUsage.maxBytes - photoUsage.bytes)
      : null;

  return (
    <section className={styles.section} aria-labelledby="import-paprika-title">
      <h2 id="import-paprika-title">From Paprika</h2>
      <p>
        Your whole Paprika library at once. In Paprika, choose <strong>File › Export</strong>, then{" "}
        <strong>All Recipes</strong>, and choose the <strong>.paprikarecipes</strong> file it saves.
        Fennl reads it on this device and shows what it found before anything is imported.
      </p>
      {allowed ? (
        <label
          className={`${recipes.primary} ${working ? styles.off : ""}`}
          aria-disabled={working !== null}
        >
          <input
            type="file"
            className="visually-hidden"
            accept=".paprikarecipes,application/zip"
            disabled={working !== null}
            onChange={(event) => {
              const chosen = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void choose(chosen);
            }}
          />
          Choose the Paprika file
        </label>
      ) : (
        <p className={recipes.hint}>
          Importing from Paprika is part of Premium. <Link href="/account">See your plan</Link>.
        </p>
      )}
      {working ? (
        <p role="status" className={recipes.hint}>
          {working}
        </p>
      ) : null}
      {message ? (
        <p
          ref={messageRef}
          tabIndex={-1}
          role={message.problem ? "alert" : "status"}
          className={message.problem ? styles.problem : styles.note}
        >
          {message.text}
        </p>
      ) : null}

      {preview && summary && !working ? (
        <div className={styles.paprikaPreview}>
          <h3 ref={previewRef} tabIndex={-1} className={styles.smallTitle}>
            {preview.fileName}: {plural(preview.items.length + preview.problems.length, "recipe")}
          </h3>
          <ul className={styles.plainList}>
            {summary.add.length > 0 ? (
              <li>{plural(summary.add.length, "new recipe")} to import.</li>
            ) : null}
            {summary.needRoom.length > 0 ? (
              <li>
                {plural(summary.needRoom.length, "more recipe")} won&rsquo;t fit in your plan
                {status.usage?.maxRecipes !== null && status.usage?.maxRecipes !== undefined
                  ? ` (${status.usage.maxRecipes} recipes)`
                  : ""}
                . Premium has room for them; choose the file again once you have it.
              </li>
            ) : null}
            {summary.unchanged > 0 ? (
              <li>{plural(summary.unchanged, "recipe")} already in Fennl, unchanged.</li>
            ) : null}
            {summary.inTrash > 0 ? (
              <li>{plural(summary.inTrash, "recipe")} in your Trash, left there.</li>
            ) : null}
            {photosOn ? (
              summary.photos > 0 ? (
                <li>
                  {plural(summary.photos, "photo")} (about {formatBytes(summary.photoBytes)}).
                  {photoRoom !== null && summary.photoBytes > photoRoom
                    ? ` Your photo storage has room for about ${formatBytes(photoRoom)}: photos are added until it's full, and the rest are listed so you can make room and choose the file again.`
                    : ""}
                </li>
              ) : null
            ) : (
              <li>
                Photos stay in Paprika: they&rsquo;re part of Premium. Every recipe&rsquo;s text
                comes in.
              </li>
            )}
          </ul>

          {summary.changed.length > 0 ? (
            <fieldset className={styles.paprikaChoice}>
              <legend>
                {plural(summary.changed.length, "recipe")} changed in Paprika since you imported{" "}
                {summary.changed.length === 1 ? "it" : "them"}
              </legend>
              <label className={styles.choose}>
                <input
                  type="radio"
                  name="paprika-changed"
                  checked={update}
                  onChange={() => setUpdate(true)}
                />
                Update {summary.changed.length === 1 ? "it" : "them"}. The version in Fennl now is
                kept: the recipe&rsquo;s page lets you compare and put it back.
              </label>
              <label className={styles.choose}>
                <input
                  type="radio"
                  name="paprika-changed"
                  checked={!update}
                  onChange={() => setUpdate(false)}
                />
                Leave {summary.changed.length === 1 ? "it" : "them"} as{" "}
                {summary.changed.length === 1 ? "it is" : "they are"}.
              </label>
            </fieldset>
          ) : null}

          {preview.problems.length > 0 ? (
            <details>
              <summary>{plural(preview.problems.length, "recipe")} couldn&rsquo;t be read</summary>
              <ul className={styles.plainList}>
                {preview.problems.map((p, i) => (
                  <li key={`${p.name}-${i}`}>
                    {p.name}: {p.text}.
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {preview.others > 0 ? (
            <p className={recipes.hint}>
              {plural(preview.others, "other file")} in the export{" "}
              {preview.others === 1 ? "isn't a recipe" : "aren't recipes"} and{" "}
              {preview.others === 1 ? "was" : "were"} left out.
            </p>
          ) : null}

          <div className={styles.pasteRow}>
            {toDo > 0 ? (
              <button type="button" className={recipes.primary} onClick={() => void start()}>
                {summary.add.length > 0
                  ? `Import ${plural(summary.add.length, "recipe")}`
                  : "Import"}
              </button>
            ) : (
              <p className={styles.note}>Everything in this file is already in Fennl.</p>
            )}
            <button
              type="button"
              className={recipes.secondary}
              onClick={() => {
                setPreview(null);
                setFile(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
