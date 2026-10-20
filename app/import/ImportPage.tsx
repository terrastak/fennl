import { useEffect, useRef, useState } from "react";
import { IMPORT_RULES, type ImportJobSummary } from "../../shared/importJobs";
import { PASTED_TEXT_CHARS } from "../../shared/pastedText";
import { navigate } from "../navigation";
import { PageHeader } from "../pages/PageHeader";
import pages from "../pages/pages.module.css";
import recipes from "../recipes/recipes.module.css";
import { Link } from "../router";
import { PhotoImport } from "../scan/PhotoImport";
import {
  importJobs,
  importPastedText,
  importProblemText,
  importWebPage,
  pastedProblemText,
} from "./api";
import styles from "./import.module.css";

// The Import page (phase E4): a saved web page read into drafts, photos of a recipe's pages read
// by the AI (E9, app/scan/), and the drafts waiting for review. The Chrome extension (E6) sends
// pages to the same place.

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

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
  const messageRef = useRef<HTMLParagraphElement>(null);

  const load = () => void importJobs().then((list) => setJobs(list ?? []));
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

  const imported = (found: ImportJobSummary[]) => {
    const [only] = found;
    if (found.length === 1 && only) {
      navigate(`/import/${only.id}`);
      return;
    }
    setMessage({
      text: `Found ${found.length} recipes in those photos. Review each one below.`,
      problem: false,
    });
    load();
  };

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

      {jobs && jobs.length > 0 ? (
        <section className={styles.section} aria-labelledby="import-waiting-title">
          <h2 id="import-waiting-title">Waiting for review</h2>
          <ul className={styles.jobs}>
            {jobs.map((job) => (
              <li key={job.id}>
                <Link href={`/import/${job.id}`}>{job.title}</Link>
                <span className={recipes.hint}>
                  {[site(job.url), new Date(job.createdAt).toLocaleDateString()]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
          <p className={recipes.hint}>
            Drafts you don&rsquo;t save are removed after {IMPORT_RULES.keepDays} days.
          </p>
        </section>
      ) : null}

      <section className={pages.card} aria-labelledby="import-soon-title">
        <span className={pages.soon}>Coming soon</span>
        <h2 id="import-soon-title">What you&rsquo;ll also be able to import</h2>
        <ul className={pages.list}>
          <li>Recipes from websites in one click, with the Fennl extension for Chrome</li>
          <li>Screenshots and PDFs</li>
          <li>Your whole Paprika library, photos included</li>
        </ul>
      </section>
    </>
  );
}
