import { useEffect, useRef, useState } from "react";
import type { ImportJobSummary } from "../../shared/importJobs";
import type { AiImportUsage } from "../../shared/limits";
import { PDF_RULES, editedRecipes, type PdfFindPage, type PdfRecipe } from "../../shared/pdfImport";
import {
  findPdfRecipes,
  importPdfRecipe,
  pdfFindProblemText,
  photoProblemText,
} from "../import/api";
import { AI_PAUSED_TEXT, aiResetText } from "../limits/limitText";
import { photoEncoder, problemText, UploadProblem, uploadPrepared } from "../photos/addPhotos";
import { preparePhoto } from "../photos/prepare";
import { currentPhotoCache } from "../photos/usePhoto";
import recipes from "../recipes/recipes.module.css";
import { activeSyncClient, useSyncStatus } from "../sync/useSync";
import { PdfFile, type PdfPageInfo } from "./pdfFile";
import styles from "./pdf.module.css";

// Importing recipes from a PDF (phase E12; spec.md E12): the PDF is opened on this device, its
// pages looked through (each page's own text, or a small picture of a scanned page) and the
// recipes found by one quick AI read (free). The person checks the list: which recipes to import,
// their titles, and the pages each is on. Then each is read from its pages, one at a time, into a
// draft waiting for review; each counts as one AI import (owner's choices 2026-10-21). The pages
// of each recipe are kept with it, like page photos (E9).

/** A recipe on the list the person checks. */
interface Row extends PdfRecipe {
  id: string;
  include: boolean;
}

/** The pictures of scanned pages sent to find the recipes: enough to read a title. */
const FIND_PICTURE_EDGE = 1200;
/** Each recipe's pages, kept with it and read: prepared as page photos after this (D2). */
const PAGE_PICTURE_EDGE = 2400;
/** The page shown beside each recipe on the list. */
const PREVIEW_EDGE = 240;

const toBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
};

const OPEN_PROBLEMS: Record<string, string> = {
  locked: "This PDF is locked with a password. Save a copy without the password and try that.",
  not_a_pdf: "This file isn't a PDF Fennl can open.",
};

export function PdfImport({ onImported }: { onImported(jobs: ImportJobSummary[]): void }) {
  const status = useSyncStatus();
  const [ai, setAi] = useState<AiImportUsage | null>(null);
  const [pdf, setPdf] = useState<PdfFile | null>(null);
  const [pages, setPages] = useState<PdfPageInfo[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const problemRef = useRef<HTMLParagraphElement>(null);
  const listRef = useRef<HTMLHeadingElement>(null);

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

  useEffect(() => {
    if (rows) listRef.current?.focus();
    // Only when the list first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows === null]);

  // A small picture of each recipe's first page, drawn once per page.
  useEffect(() => {
    if (!pdf || !rows) return;
    let live = true;
    const wanted = [...new Set(rows.map((r) => r.firstPage))].filter(
      (n) => n >= 1 && n <= pdf.pageCount && !previews[n],
    );
    void (async () => {
      for (const n of wanted) {
        const blob = await pdf.picture(n, PREVIEW_EDGE).catch(() => null);
        if (!live || !blob) return;
        const url = URL.createObjectURL(blob);
        setPreviews((current) => ({ ...current, [n]: url }));
      }
    })();
    return () => {
      live = false;
    };
  }, [pdf, rows, previews]);

  // Let go of the pictures and the PDF when the section goes.
  const latest = useRef({ pdf, previews });
  useEffect(() => {
    latest.current = { pdf, previews };
  }, [pdf, previews]);
  useEffect(
    () => () => {
      for (const url of Object.values(latest.current.previews)) URL.revokeObjectURL(url);
      latest.current.pdf?.close();
    },
    [],
  );

  const notIncluded = ai ? !ai.enabled : !(status.photos?.enabled ?? true);
  const unavailable = notIncluded
    ? "Reading recipes from PDFs is part of Premium."
    : ai?.paused
      ? AI_PAUSED_TEXT
      : ai?.usedUp
        ? aiResetText(ai)
        : null;

  const reset = () => {
    pdf?.close();
    for (const url of Object.values(previews)) URL.revokeObjectURL(url);
    setPdf(null);
    setPages([]);
    setRows(null);
    setPreviews({});
  };

  /** Opens the chosen PDF, looks through its pages, and finds the recipes. */
  const choose = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    reset();
    setProblem(null);
    if (file.size > PDF_RULES.bytes) {
      setProblem("This PDF is larger than 30 MB. Try a smaller one, or save fewer pages.");
      return;
    }
    setWorking("Opening the PDF…");
    let opened: PdfFile;
    try {
      opened = await PdfFile.open(file);
    } catch (error) {
      setWorking(null);
      setProblem(OPEN_PROBLEMS[(error as Error).message] ?? OPEN_PROBLEMS.not_a_pdf ?? null);
      return;
    }
    if (opened.pageCount > PDF_RULES.pages) {
      opened.close();
      setWorking(null);
      setProblem(
        `This PDF has ${opened.pageCount} pages; Fennl takes up to ${PDF_RULES.pages}. Save the pages with the recipes you want as a smaller PDF and try that.`,
      );
      return;
    }
    const infos: PdfPageInfo[] = [];
    const sent: PdfFindPage[] = [];
    let pictureBytes = 0;
    try {
      for (let n = 1; n <= opened.pageCount; n++) {
        setWorking(`Looking through page ${n} of ${opened.pageCount}…`);
        const info = await opened.info(n);
        infos.push(info);
        if (info.kind === "text") {
          sent.push({ page: n, text: info.text.slice(0, PDF_RULES.pageTextChars) });
        } else {
          const picture = await opened.picture(n, FIND_PICTURE_EDGE, "image/jpeg", 0.7);
          pictureBytes += picture.size;
          if (pictureBytes > PDF_RULES.findImageBytes) throw new Error("too_large");
          sent.push({ page: n, image: await toBase64(picture), mediaType: "image/jpeg" });
        }
      }
    } catch (error) {
      opened.close();
      setWorking(null);
      setProblem(
        (error as Error).message === "too_large"
          ? pdfFindProblemText("pages_too_large")
          : "Fennl couldn't look through this PDF. It may be damaged; try saving it again.",
      );
      return;
    }
    setWorking("Finding the recipes… This can take up to a minute.");
    const found = await findPdfRecipes(opened.pageCount, sent);
    setWorking(null);
    if ("problem" in found) {
      opened.close();
      setProblem(pdfFindProblemText(found.problem));
      return;
    }
    setPdf(opened);
    setPages(infos);
    setRows(found.recipes.map((r) => ({ ...r, id: crypto.randomUUID(), include: true })));
  };

  const update = (id: string, change: Partial<Row>) =>
    setRows((current) => current?.map((r) => (r.id === id ? { ...r, ...change } : r)) ?? null);

  const add = () => {
    if (!pdf) return;
    const last = pdf.pageCount;
    setRows((current) => [
      ...(current ?? []),
      { id: crypto.randomUUID(), title: "", firstPage: last, lastPage: last, include: true },
    ]);
  };

  const chosen = rows?.filter((r) => r.include) ?? [];
  const left = ai && ai.max !== null ? Math.max(0, ai.max - ai.used) : null;

  /** Reads each chosen recipe from its pages, one at a time. */
  const read = async () => {
    const cache = currentPhotoCache();
    const me = activeSyncClient()?.userId;
    if (!pdf || !cache || !me || chosen.length === 0) return;
    const checked = editedRecipes(chosen, pdf.pageCount);
    if (!checked) {
      setProblem(
        `Give each recipe a title, and its first and last page (from 1 to ${pdf.pageCount}, at most ${PDF_RULES.recipePages} pages a recipe).`,
      );
      return;
    }
    setProblem(null);
    const batchId = crypto.randomUUID();
    const uploaded = new Map<number, string>();
    const jobs: ImportJobSummary[] = [];
    const missed: string[] = [];
    let stopped: string | null = null;
    for (const [i, recipe] of checked.entries()) {
      const of = `recipe ${i + 1} of ${checked.length}: ${recipe.title}`;
      const numbers: number[] = [];
      for (let n = recipe.firstPage; n <= recipe.lastPage; n++) numbers.push(n);
      try {
        for (const n of numbers) {
          if (uploaded.has(n)) continue;
          setWorking(`Getting page ${n} ready for ${of}…`);
          const picture = await pdf.picture(n, PAGE_PICTURE_EDGE, "image/jpeg", 0.92);
          const prepared = await preparePhoto(
            picture,
            "page",
            photoEncoder(),
            status.photos?.maxFileBytes ?? null,
          ).catch(() => {
            throw new UploadProblem("not_a_photo");
          });
          uploaded.set(n, await uploadPrepared(prepared, me, cache));
        }
      } catch (error) {
        stopped =
          error instanceof UploadProblem
            ? problemText(error.problem, null)
            : "The pages couldn't be uploaded. Please try again.";
        break;
      }
      setWorking(`Reading ${of}…`);
      const result = await importPdfRecipe({
        title: recipe.title,
        pages: numbers.map((n) => uploaded.get(n) as string),
        pageNumbers: numbers,
        texts: numbers.map((n) => {
          const info = pages[n - 1];
          return info?.kind === "text" ? info.text : null;
        }),
        fileName: pdf.name,
        batchId,
      });
      if ("jobs" in result) {
        jobs.push(...result.jobs);
        continue;
      }
      // Nothing more can be read this month (or at all, just now): stop here.
      if (
        result.problem === "monthly_limit" ||
        result.problem === "paused" ||
        result.problem === "ai_import_not_included" ||
        result.problem === "offline"
      ) {
        stopped = photoProblemText(result.problem);
        break;
      }
      missed.push(recipe.title);
    }
    setWorking(null);
    const notes = [
      missed.length
        ? `Fennl couldn't read ${missed.length === 1 ? "one recipe" : `${missed.length} recipes`}: ${missed.join(", ")}.`
        : null,
      stopped
        ? `${stopped} ${jobs.length ? `The ${jobs.length === 1 ? "recipe" : `${jobs.length} recipes`} read so far ${jobs.length === 1 ? "is" : "are"} waiting for review.` : ""}`
        : null,
    ].filter(Boolean);
    if (notes.length) setProblem(notes.join(" "));
    if (jobs.length > 0) {
      reset();
      onImported(jobs);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="import-pdf-title">
      <h2 id="import-pdf-title">From a PDF</h2>
      <p>
        A cookbook, a printout or a file of family recipes, up to {PDF_RULES.pages} pages. Fennl
        finds the recipes in it; you check which pages each is on, then each one is read into a
        recipe for you to check. Each recipe&rsquo;s pages are kept with it.
      </p>

      {unavailable ? (
        <p className={recipes.hint}>{unavailable}</p>
      ) : !online ? (
        <p className={recipes.hint}>Importing a PDF needs a connection.</p>
      ) : rows === null ? (
        <label className={`${recipes.primary} ${working ? styles.off : ""}`}>
          <input
            type="file"
            className="visually-hidden"
            accept="application/pdf,.pdf"
            disabled={working !== null}
            onChange={(event) => void choose(event.currentTarget)}
          />
          Choose a PDF
        </label>
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

      {rows && pdf ? (
        <div className={styles.found}>
          <h3 ref={listRef} tabIndex={-1} className={styles.foundTitle}>
            {rows.length === 0
              ? `No recipes found in ${pdf.name}`
              : `${rows.length === 1 ? "1 recipe" : `${rows.length} recipes`} found in ${pdf.name}`}
          </h3>
          <p className={recipes.hint}>
            {rows.length === 0
              ? "If it does hold recipes, add each one by hand with its pages."
              : `Check each one's title and pages (the PDF has ${pdf.pageCount}). Untick any you don't want.`}{" "}
            Each recipe read counts as one of this month&rsquo;s AI imports
            {left !== null ? ` (${left} left)` : ""}.
          </p>
          <ol className={styles.recipes} aria-label="Recipes to import">
            {rows.map((row, i) => (
              <li key={row.id} className={styles.recipe}>
                <div className={styles.preview}>
                  {previews[row.firstPage] ? (
                    <img src={previews[row.firstPage]} alt={`Page ${row.firstPage}`} />
                  ) : null}
                </div>
                <div className={styles.fields}>
                  <label className={styles.include}>
                    <input
                      type="checkbox"
                      checked={row.include}
                      disabled={working !== null}
                      onChange={(e) => update(row.id, { include: e.currentTarget.checked })}
                    />
                    Import recipe {i + 1}
                  </label>
                  <label className={styles.field}>
                    Title
                    <input
                      type="text"
                      value={row.title}
                      disabled={working !== null}
                      onChange={(e) => update(row.id, { title: e.currentTarget.value })}
                    />
                  </label>
                  <div className={styles.pageFields}>
                    <label className={styles.field}>
                      First page
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={pdf.pageCount}
                        value={row.firstPage}
                        disabled={working !== null}
                        onChange={(e) =>
                          update(row.id, { firstPage: Number(e.currentTarget.value) || 1 })
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      Last page
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={pdf.pageCount}
                        value={row.lastPage}
                        disabled={working !== null}
                        onChange={(e) =>
                          update(row.id, { lastPage: Number(e.currentTarget.value) || 1 })
                        }
                      />
                    </label>
                  </div>
                  {pages[row.firstPage - 1]?.kind === "picture" ? (
                    <p className={styles.kindNote}>Read from a picture of the page (scanned).</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <div className={styles.buttons}>
            <button
              type="button"
              className={recipes.primary}
              disabled={working !== null || chosen.length === 0}
              onClick={() => void read()}
            >
              {chosen.length === 1 ? "Read 1 recipe" : `Read ${chosen.length} recipes`}
            </button>
            <button
              type="button"
              className={recipes.secondary}
              disabled={working !== null}
              onClick={add}
            >
              Add a recipe
            </button>
            <button
              type="button"
              className={recipes.secondary}
              disabled={working !== null}
              onClick={() => {
                reset();
                setProblem(null);
              }}
            >
              Choose a different PDF
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
