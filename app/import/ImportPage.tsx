import { useEffect, useRef, useState } from "react";
import type { ImportJobSummary } from "../../shared/importJobs";
import { PASTED_TEXT_CHARS } from "../../shared/pastedText";
import { navigate } from "../navigation";
import { PageHeader } from "../pages/PageHeader";
import recipes from "../recipes/recipes.module.css";
import { PdfImport } from "../pdf/PdfImport";
import { DocumentImport } from "./DocumentImport";
import { PaprikaImport } from "./PaprikaImport";
import { PhotoImport } from "../scan/PhotoImport";
import { LaptopIcon } from "../recipes/LaptopIcon";
import { LAPTOP_ICONS } from "../recipes/laptopIcons";
import { usePointer } from "../recipes/usePointer";
import { SourceCard, SourceIcon, UploadIcon } from "./SourceRow";
import {
  finishLeavingDiscards,
  importJobs,
  importPastedText,
  importProblemText,
  importWebPage,
  pastedProblemText,
} from "./api";
import styles from "./import.module.css";
import { WaitingList } from "./WaitingList";

// The Import page (phase E4): a saved web page read into drafts, photos of a recipe's pages read
// by the AI (E9, app/scan/), a PDF's recipes (E12, app/pdf/), a document's (E18), and the drafts
// waiting for review,
// opened one by one or several saved at once (E12). The Chrome extension (E6) sends pages to the
// same place.
//
// U23 slice 6 (owner's choices 2026-11-07): Waiting for review comes first whenever drafts are
// waiting, then the sources; "Paste a recipe…" opens the box in place (Cancel or Escape closes it
// and forgets what was typed), on every screen. On a laptop the sources are one white box of rows
// (an icon, the name and its explanation, a quiet button), and what a source opens (the paste
// box, the photos' pages, the PDF's recipes, the Paprika preview) sits under its row.

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function ImportPage() {
  const [jobs, setJobs] = useState<ImportJobSummary[] | null>(null);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);
  const [pasted, setPasted] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const pasteBox = useRef<HTMLTextAreaElement>(null);
  const pasteButton = useRef<HTMLButtonElement>(null);
  const laptop = usePointer();

  const load = () =>
    void finishLeavingDiscards()
      .then(() => importJobs())
      .then((list) => {
        setJobs(list ?? []);
      });
  useEffect(load, []);
  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  /** Closes the paste box, forgetting what was typed, and gives focus back to its button. */
  const closePaste = () => {
    setPasteOpen(false);
    setPasted("");
    requestAnimationFrame(() => pasteButton.current?.focus());
  };

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
    setPasteOpen(false);
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

  return (
    <div className={styles.importPage}>
      <PageHeader title="Import recipes">
        <p>
          Bring recipes into Fennl without retyping them. You check every recipe before it&rsquo;s
          saved.
        </p>
      </PageHeader>

      <div className={styles.pageNotes}>
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

      {/* Drafts waiting come first (owner's choice 2026-11-07): coming back to finish them is
          what the page is mostly for, and the sources still start on the first screen. */}
      {jobs ? (
        <WaitingList
          jobs={jobs}
          update={(change) => setJobs((before) => (before ? change(before) : before))}
          reading={reading}
          paused={laptop && pasteOpen}
        />
      ) : null}

      <div className={styles.sources}>
        <section
          className={`${styles.section} ${styles.sourceRow}`}
          aria-labelledby="import-page-title"
        >
          <SourceCard>
            <SourceIcon path={LAPTOP_ICONS.globe} />
            <h2 id="import-page-title">From a web page</h2>
            <p>
              The Fennl extension for Chrome is on its way. Until then, save the recipe&rsquo;s page
              in your browser ({MAC ? "⌘S" : "Ctrl+S"}, or File › Save Page As), then choose the
              saved file here.
            </p>
            <label
              className={`${recipes.primary} ${styles.sourceButton} ${reading ? styles.off : ""}`}
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
              <UploadIcon />
              Import a saved web page
            </label>
          </SourceCard>
        </section>

        <section
          className={`${styles.section} ${styles.sourceRow}`}
          aria-labelledby="import-paste-title"
        >
          <SourceCard>
            <SourceIcon path={LAPTOP_ICONS.paste} />
            <h2 id="import-paste-title">Paste a recipe</h2>
            <p>
              Copy a recipe from an email, note, document or message and paste it here. Fennl reads
              it for you to check before anything is saved.
            </p>
            <button
              ref={pasteButton}
              type="button"
              className={`${recipes.primary} ${styles.sourceButton}`}
              aria-expanded={pasteOpen}
              aria-controls={pasteOpen ? "import-paste-form" : undefined}
              disabled={reading && !pasteOpen}
              onClick={() => {
                if (pasteOpen) {
                  closePaste();
                  return;
                }
                setPasteOpen(true);
                requestAnimationFrame(() => pasteBox.current?.focus());
              }}
            >
              <LaptopIcon path={LAPTOP_ICONS.paste} />
              Paste a recipe…
            </button>
          </SourceCard>
          {pasteOpen ? (
            <div id="import-paste-form" className={`${styles.pasteForm} ${styles.subform}`}>
              <label htmlFor="import-paste" className="visually-hidden">
                Recipe text
              </label>
              <textarea
                ref={pasteBox}
                id="import-paste"
                className={styles.pasteBox}
                value={pasted}
                maxLength={PASTED_TEXT_CHARS}
                placeholder="Paste the recipe here"
                disabled={reading}
                onChange={(event) => setPasted(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !reading) {
                    event.preventDefault();
                    closePaste();
                  }
                }}
              />
              <div className={styles.pasteRow}>
                <button
                  type="button"
                  className={`${recipes.primary} ${styles.ink}`}
                  disabled={reading || pasted.trim().length === 0}
                  onClick={() => void readPasted()}
                >
                  {reading ? "Reading…" : "Read this recipe"}
                </button>
                <button
                  type="button"
                  className={`${recipes.secondary} ${styles.plain}`}
                  disabled={reading}
                  onClick={closePaste}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <PhotoImport onImported={imported} />

        <PdfImport onImported={(found) => imported(found, "that PDF")} />

        <DocumentImport onImported={imported} />

        <PaprikaImport />
      </div>
    </div>
  );
}
