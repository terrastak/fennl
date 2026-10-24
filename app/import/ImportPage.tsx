import { useEffect, useRef, useState } from "react";
import { IMPORT_RULES, type ImportJobSummary } from "../../shared/importJobs";
import { addBlockedBy } from "../../shared/limits";
import { PASTED_TEXT_CHARS } from "../../shared/pastedText";
import { addBlockedText } from "../limits/limitText";
import { navigate } from "../navigation";
import { PageHeader } from "../pages/PageHeader";
import recipes from "../recipes/recipes.module.css";
import { Link } from "../router";
import { PdfImport } from "../pdf/PdfImport";
import { DocumentImport } from "./DocumentImport";
import { PaprikaImport } from "./PaprikaImport";
import { currentPhotoCache } from "../photos/usePhoto";
import { PhotoImport } from "../scan/PhotoImport";
import { activeSyncClient, useCategoryTree, useSyncStatus } from "../sync/useSync";
import {
  importJobs,
  importPastedText,
  importProblemText,
  importWebPage,
  pastedProblemText,
} from "./api";
import styles from "./import.module.css";
import { saveMany, type LeftReason, type SaveManyResult } from "./saveMany";

// The Import page (phase E4): a saved web page read into drafts, photos of a recipe's pages read
// by the AI (E9, app/scan/), a PDF's recipes (E12, app/pdf/), a document's (E18), and the drafts
// waiting for review,
// opened one by one or several saved at once (E12). The Chrome extension (E6) sends pages to the
// same place.

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** The time a save is made (outside the component, which mustn't read the clock as it draws). */
const clock = () => Date.now();

const LEFT: Record<LeftReason, string> = {
  check: "has parts to check",
  duplicate: "may already be in your recipes",
  photos: "has photos to choose",
  gone: "was already saved or removed",
  not_saved: "couldn’t be saved just now",
};

const recipeCount = (n: number) => (n === 1 ? "1 recipe" : `${n} recipes`);

/** What "Save selected" did, in a sentence or two. */
function savedText(result: SaveManyResult): string {
  const parts: string[] = [];
  if (result.saved.length > 0) parts.push(`Saved ${recipeCount(result.saved.length)}.`);
  if (result.originalsMissed > 0) {
    parts.push(
      result.originalsMissed === 1
        ? "For one of them, the pages it was read from couldn’t be kept with it."
        : `For ${result.originalsMissed} of them, the pages they were read from couldn’t be kept with them.`,
    );
  }
  if (result.left.length > 0) {
    const list = result.left.map((l) => `${l.title} (${LEFT[l.reason]})`).join("; ");
    parts.push(
      `${result.left.length === 1 ? "One is" : `${result.left.length} are`} still waiting for you to review: ${list}.`,
    );
  }
  return parts.join(" ");
}

/** "cakes.example.com", for a draft's page. */
function site(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function ImportPage() {
  const [jobs, setJobs] = useState<ImportJobSummary[] | null>(null);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);
  const [pasted, setPasted] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const status = useSyncStatus();
  const tree = useCategoryTree();

  const load = () =>
    void importJobs().then((list) => {
      setJobs(list ?? []);
      setChosen((before) => new Set([...before].filter((id) => list?.some((j) => j.id === id))));
    });
  useEffect(load, []);
  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setMessage(null);
    const result = await importWebPage(await file.text(), null);
    setReading(false);
    if ("problem" in result) {
      setMessage({ text: importProblemText(result.problem), problem: true });
      return;
    }
    const [only] = result.jobs;
    if (result.jobs.length === 1 && only) {
      navigate(`/import/${only.id}`);
      return;
    }
    setMessage({
      text: `Found ${result.jobs.length} recipes on that page. Review each one below.`,
      problem: false,
    });
    load();
  };

  const readPasted = async () => {
    setReading(true);
    setMessage(null);
    const result = await importPastedText(pasted);
    setReading(false);
    if ("problem" in result) {
      setMessage({ text: pastedProblemText(result.problem), problem: true });
      return;
    }
    const [only] = result.jobs;
    if (result.jobs.length === 1 && only) {
      navigate(`/import/${only.id}`);
      return;
    }
    setPasted("");
    setMessage({
      text: `Found ${result.jobs.length} recipes in that text. Review each one below.`,
      problem: false,
    });
    load();
  };

  /** `stay`: something else needs saying here, so a single draft isn't opened straight away. */
  const imported = (found: ImportJobSummary[], from = "those photos", stay = false) => {
    const [only] = found;
    if (found.length === 1 && only && !stay) {
      navigate(`/import/${only.id}`);
      return;
    }
    setMessage({
      text:
        found.length === 1
          ? `Found a recipe in ${from}. Review it below.`
          : `Found ${found.length} recipes in ${from}. Review each one below.`,
      problem: false,
    });
    load();
  };

  const choose = (id: string, on: boolean) =>
    setChosen((before) => {
      const next = new Set(before);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** "Save selected": the chosen drafts with nothing to check, saved as they are. */
  const saveChosen = async () => {
    const usage = status.usage;
    const blocked = usage ? addBlockedBy(usage) : null;
    if (usage && blocked) {
      setMessage({ text: addBlockedText(blocked, usage), problem: true });
      return;
    }
    const me = activeSyncClient()?.userId;
    if (!jobs || !tree || !me) return;
    setMessage(null);
    const result = await saveMany({
      jobs: jobs.filter((job) => chosen.has(job.id)),
      tree,
      me,
      premium: status.photos?.enabled ?? false,
      cache: currentPhotoCache(),
      now: clock,
      onProgress: (done, total) =>
        setSaving(done < total ? `Saving ${done + 1} of ${total}…` : "Saving…"),
    });
    setSaving(null);
    const saved = new Set(result.saved);
    setJobs((before) => before?.filter((job) => !saved.has(job.id)) ?? null);
    setChosen(new Set());
    setMessage({ text: savedText(result), problem: result.saved.length === 0 });
  };

  const busy = reading || saving !== null;

  return (
    <>
      <PageHeader title="Import recipes">
        <p>
          Bring recipes into Fennl without retyping them. You check every recipe before it&rsquo;s
          saved.
        </p>
      </PageHeader>

      <div>
        {reading ? (
          <p role="status" className={recipes.hint}>
            Reading. This can take up to a minute.
          </p>
        ) : null}
        {saving ? (
          <p role="status" className={recipes.hint}>
            {saving}
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
      </div>

      <section className={styles.section} aria-labelledby="import-page-title">
        <h2 id="import-page-title">From a web page</h2>
        <p>
          The Fennl extension for Chrome is on its way. Until then, save the recipe&rsquo;s page in
          your browser ({MAC ? "⌘S" : "Ctrl+S"}, or File › Save Page As), then choose the saved file
          here.
        </p>
        <label
          className={`${recipes.primary} ${reading ? styles.off : ""}`}
          aria-disabled={reading}
        >
          <input
            type="file"
            className="visually-hidden"
            accept=".html,.htm,text/html"
            disabled={reading}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void read(file);
            }}
          />
          Import a saved web page
        </label>
      </section>

      <section className={styles.section} aria-labelledby="import-paste-title">
        <h2 id="import-paste-title">Paste a recipe</h2>
        <p>
          Copy a recipe from an email, note, document or message and paste it here. Fennl reads it
          for you to check before anything is saved.
        </p>
        <label htmlFor="import-paste" className="visually-hidden">
          Recipe text
        </label>
        <textarea
          id="import-paste"
          className={styles.pasteBox}
          value={pasted}
          maxLength={PASTED_TEXT_CHARS}
          placeholder="Paste the recipe here"
          disabled={reading}
          onChange={(event) => setPasted(event.currentTarget.value)}
        />
        <div className={styles.pasteRow}>
          <button
            type="button"
            className={recipes.primary}
            disabled={reading || pasted.trim().length === 0}
            onClick={() => void readPasted()}
          >
            {reading ? "Reading…" : "Read this recipe"}
          </button>
        </div>
      </section>

      <PhotoImport onImported={imported} />

      <PdfImport onImported={(found) => imported(found, "that PDF")} />

      <DocumentImport onImported={imported} />

      <PaprikaImport />

      {jobs && jobs.length > 0 ? (
        <section className={styles.section} aria-labelledby="import-waiting-title">
          <h2 id="import-waiting-title">Waiting for review</h2>
          {jobs.length > 1 ? (
            <label className={styles.choose}>
              <input
                type="checkbox"
                checked={chosen.size === jobs.length}
                disabled={busy}
                onChange={(event) =>
                  setChosen(
                    event.currentTarget.checked ? new Set(jobs.map((job) => job.id)) : new Set(),
                  )
                }
              />
              Select all
            </label>
          ) : null}
          <ul className={styles.jobs}>
            {jobs.map((job) => (
              <li key={job.id}>
                <input
                  type="checkbox"
                  className={styles.chooseBox}
                  aria-label={`Select ${job.title}`}
                  checked={chosen.has(job.id)}
                  disabled={busy}
                  onChange={(event) => choose(job.id, event.currentTarget.checked)}
                />
                <Link href={`/import/${job.id}`}>{job.title}</Link>
                <span className={recipes.hint}>
                  {[site(job.url), new Date(job.createdAt).toLocaleDateString()]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
          {chosen.size > 0 ? (
            <>
              <button
                type="button"
                className={recipes.primary}
                disabled={busy || !tree}
                onClick={() => void saveChosen()}
              >
                Save {chosen.size} selected
              </button>
              <p className={recipes.hint}>
                Each is saved as Fennl read it. Any Fennl wasn&rsquo;t sure of, or that may already
                be in your recipes, stays here for you to open and check.
              </p>
            </>
          ) : null}
          <p className={recipes.hint}>
            Open a draft to check it and save it, or select several to save them at once. Drafts you
            don&rsquo;t save are removed after {IMPORT_RULES.keepDays} days.
          </p>
        </section>
      ) : null}
    </>
  );
}
