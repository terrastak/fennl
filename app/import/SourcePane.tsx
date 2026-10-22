import { useState } from "react";
import type { ImportJobDetail } from "../../shared/importJobs";
import { usePhotoUrl } from "../photos/usePhoto";
import recipes from "../recipes/recipes.module.css";
import styles from "./import.module.css";
import { originalHashes } from "./originals";
import { snapshotDocument } from "./review";

// The page a draft came from, beside it on the review screen (phase E4): the copy of the page's
// recipe card the server kept (no scripts, ads or site furniture; shared/pageSnapshot.ts), and a
// link to the page itself. The copy is shown in a frame that can't run anything or load anything
// from the web. For a recipe read from photos (phase E9), the photos themselves. On a phone it
// folds away under a button.

/** The app's own colors and fonts, for the copy (a frame can't see the page's CSS). */
function frameStyle(): string {
  const root = getComputedStyle(document.documentElement);
  const token = (name: string) => root.getPropertyValue(name).trim();
  return `body{margin:16px;font-family:${token("--font-ui")};font-size:15px;line-height:1.5;
color:${token("--color-text")};background:${token("--color-surface")};overflow-wrap:anywhere}
h1,h2,h3,h4{font-family:${token("--font-display")};line-height:1.2;margin:1em 0 .4em}
p{margin:.3em 0}ul,ol{padding-left:1.4em}li{margin:.2em 0}a{color:${token("--color-accent")}}
img,svg,video,iframe,button,form{display:none}`;
}

function siteName(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function PagePhoto({
  hash,
  n,
  noun,
}: {
  hash: string;
  n: number;
  noun: "Photo" | "Screenshot" | "Page";
}) {
  const url = usePhotoUrl(hash, "full");
  if (url === "failed") {
    return (
      <p className={recipes.hint}>
        {noun} {n} couldn&rsquo;t be shown just now.
      </p>
    );
  }
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className={styles.pagePhoto}>
      <img src={url} alt={`${noun} ${n}`} />
      <span className="visually-hidden"> (opens full size in a new tab)</span>
    </a>
  ) : (
    <p role="status" className={recipes.hint}>
      Loading {noun.toLowerCase()} {n}…
    </p>
  );
}

/**
 * The photos (or screenshots, E11, or a PDF's pages, E12) a recipe was read from, beside the
 * draft.
 */
function PhotosPane({ hashes, kind }: { hashes: string[]; kind: "Photo" | "Screenshot" | "Page" }) {
  const [open, setOpen] = useState(false);
  const one = hashes.length === 1;
  const noun = `${kind.toLowerCase()}${one ? "" : "s"}`;
  return (
    <section className={styles.source} data-open={open} aria-labelledby="source-title">
      <div className={styles.sourceHead}>
        <h2 id="source-title" className={styles.sectionTitle}>
          The {noun}
        </h2>
        <button
          type="button"
          className={`${recipes.secondary} ${styles.sourceToggle}`}
          aria-expanded={open}
          aria-controls="source-body"
          onClick={() => setOpen(!open)}
        >
          {open ? `Hide the ${noun}` : `Show the ${noun}`}
        </button>
      </div>
      <div id="source-body" className={styles.sourceBody}>
        <ol className={styles.pagePhotos}>
          {hashes.map((hash, i) => (
            <li key={`${hash}-${i}`}>
              <PagePhoto hash={hash} n={i + 1} noun={kind} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function SourcePane({ job }: { job: ImportJobDetail }) {
  const hashes = originalHashes(job.draft);
  if (job.pastedText !== null) return <TextPane text={job.pastedText} from={job.pastedFrom} />;
  return hashes.length > 0 ? (
    <PhotosPane
      hashes={hashes}
      kind={
        job.draft.source === "screenshot"
          ? "Screenshot"
          : job.draft.source === "pdf"
            ? "Page"
            : "Photo"
      }
    />
  ) : (
    <PageSource job={job} />
  );
}

/**
 * The text a recipe was read from (phase E15), or the document's (`from`, its file name; E18),
 * kept only until the draft is saved or removed.
 */
function TextPane({ text, from }: { text: string; from: string | null }) {
  const [open, setOpen] = useState(false);
  const what = from ? "the document" : "the pasted text";
  return (
    <section className={styles.source} data-open={open} aria-labelledby="source-title">
      <div className={styles.sourceHead}>
        <h2 id="source-title" className={styles.sectionTitle}>
          {from ? "The document" : "The pasted text"}
        </h2>
        <button
          type="button"
          className={`${recipes.secondary} ${styles.sourceToggle}`}
          aria-expanded={open}
          aria-controls="source-body"
          onClick={() => setOpen(!open)}
        >
          {open ? `Hide ${what}` : `Show ${what}`}
        </button>
      </div>
      <div id="source-body" className={styles.sourceBody}>
        <p className={recipes.hint}>
          {from ? `The text of ${from}. ` : ""}Fennl keeps this text only until you save the recipe
          or discard it.
        </p>
        <pre
          className={styles.pasted}
          tabIndex={0}
          aria-label={from ? `The text of ${from}` : "The text you pasted"}
        >
          {text}
        </pre>
      </div>
    </section>
  );
}

function PageSource({ job }: { job: ImportJobDetail }) {
  const [open, setOpen] = useState(false);
  const site = siteName(job.page.url);
  return (
    <section className={styles.source} data-open={open} aria-labelledby="source-title">
      <div className={styles.sourceHead}>
        <h2 id="source-title" className={styles.sectionTitle}>
          The original page
        </h2>
        <button
          type="button"
          className={`${recipes.secondary} ${styles.sourceToggle}`}
          aria-expanded={open}
          aria-controls="source-body"
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide the original page" : "Show the original page"}
        </button>
      </div>
      <div id="source-body" className={styles.sourceBody}>
        {job.page.url ? (
          <p>
            <a href={job.page.url} target="_blank" rel="noopener noreferrer">
              Open {site ?? "the page"}
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </p>
        ) : null}
        {job.snapshot ? (
          <iframe
            className={styles.frame}
            title={`Recipe card from ${site ?? "the original page"}`}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={snapshotDocument(job.snapshot, frameStyle())}
          />
        ) : (
          <p className={recipes.hint}>
            Fennl didn&rsquo;t keep a copy of this page&rsquo;s recipe card
            {job.page.url ? ", but the link above opens the page." : "."}
          </p>
        )}
      </div>
    </section>
  );
}
