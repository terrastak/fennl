import { useState } from "react";
import type { ImportJobDetail } from "../../shared/importJobs";
import recipes from "../recipes/recipes.module.css";
import styles from "./import.module.css";
import { snapshotDocument } from "./review";

// The page a draft came from, beside it on the review screen (phase E4): the copy of the page's
// recipe card the server kept (no scripts, ads or site furniture; shared/pageSnapshot.ts), and a
// link to the page itself. The copy is shown in a frame that can't run anything or load anything
// from the web. On a phone it folds away under a button.

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

export function SourcePane({ job }: { job: ImportJobDetail }) {
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
