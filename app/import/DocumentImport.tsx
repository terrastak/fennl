import { useRef, useState } from "react";
import {
  DOCUMENT_RULES,
  documentKind,
  documentText,
  type DocumentPicture,
} from "../../shared/documentText";
import type { ImportJobSummary } from "../../shared/importJobs";
import { PASTED_TEXT_CHARS } from "../../shared/pastedText";
import recipes from "../recipes/recipes.module.css";
import { useSyncStatus } from "../sync/useSync";
import { giveDraftPicture, importPastedText, pastedProblemText } from "./api";
import styles from "./import.module.css";

// Importing a recipe saved as a document (phase E18; spec.md E18): a Word, Rich Text, text or
// Markdown file is opened on this device and its text taken out (shared/documentText.ts), then
// read exactly as pasted text: clearly laid out, by Fennl's own rules, free; otherwise by the AI
// (Premium), one AI import. On Premium a Word file's pictures are offered on the review screen
// as photos to keep; tiny ones (bullets, icons, logos) aren't (owner's choices 2026-10-21).

const CANT_READ: Record<"doc" | "pages" | "odt", string> = {
  doc: "is an older Word file (.doc). Open it in Word and save it as a Word Document (.docx), then choose that.",
  pages:
    "is an Apple Pages file. In Pages, choose File › Export To › Word, then choose the .docx file.",
  odt: "is a LibreOffice file (.odt), which Fennl doesn't read yet. In LibreOffice, choose File › Save As and pick Word (.docx), then choose that.",
};

/** The pictures worth offering as photos: images the browser can show, not tiny ones. */
async function photosIn(pictures: DocumentPicture[]): Promise<Blob[]> {
  const kept: Blob[] = [];
  for (const picture of pictures) {
    if (kept.length >= DOCUMENT_RULES.pictures) break;
    const blob = new Blob([picture.bytes.slice()]);
    const size = await createImageBitmap(blob)
      .then((bitmap) => {
        const { width, height } = bitmap;
        bitmap.close();
        return { width, height };
      })
      .catch(() => null);
    if (size && Math.min(size.width, size.height) >= DOCUMENT_RULES.pictureSide) kept.push(blob);
  }
  return kept;
}

export function DocumentImport({
  onImported,
}: {
  /** `stay`: some files couldn't be read, so the page stays to say why. */
  onImported(jobs: ImportJobSummary[], from: string, stay: boolean): void;
}) {
  const status = useSyncStatus();
  const [working, setWorking] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const problemRef = useRef<HTMLUListElement>(null);

  const read = async (chosen: File[]) => {
    if (chosen.length === 0) return;
    setProblems([]);
    const files = chosen.slice(0, DOCUMENT_RULES.files);
    const found: ImportJobSummary[] = [];
    const missed: string[] =
      chosen.length > files.length
        ? [`Fennl reads up to ${DOCUMENT_RULES.files} files at a time; the rest weren't read.`]
        : [];
    const photosAllowed = status.photos?.enabled ?? false;
    for (const [i, file] of files.entries()) {
      setWorking(
        files.length > 1
          ? `Reading ${file.name} (${i + 1} of ${files.length})…`
          : `Reading ${file.name}…`,
      );
      const kind = documentKind(file.name);
      if (kind === "doc" || kind === "pages" || kind === "odt") {
        missed.push(`${file.name} ${CANT_READ[kind]}`);
        continue;
      }
      if (!kind) {
        missed.push(
          `${file.name} isn't a file Fennl reads. Choose a Word (.docx), Rich Text (.rtf), text (.txt) or Markdown (.md) file.`,
        );
        continue;
      }
      if (file.size > DOCUMENT_RULES.bytes) {
        missed.push(`${file.name} is larger than ${DOCUMENT_RULES.bytes / 1024 / 1024} MB.`);
        continue;
      }
      let text: string;
      let pictures: Blob[] = [];
      try {
        const doc = documentText(kind, new Uint8Array(await file.arrayBuffer()));
        text = doc.text;
        if (photosAllowed) pictures = await photosIn(doc.pictures);
      } catch {
        missed.push(`${file.name} couldn't be opened. It may be damaged; try saving it again.`);
        continue;
      }
      if (!text) {
        missed.push(`${file.name} has no text in it.`);
        continue;
      }
      if (text.length > PASTED_TEXT_CHARS) {
        missed.push(
          `${file.name} holds more than ${PASTED_TEXT_CHARS.toLocaleString()} characters. Save the recipe on its own and try that.`,
        );
        continue;
      }
      const result = await importPastedText(text, {
        fileName: file.name,
        pictures: pictures.length,
      });
      if ("problem" in result) {
        missed.push(`${file.name}: ${pastedProblemText(result.problem)}`);
        if (result.problem === "offline" || result.problem === "monthly_limit") break;
        continue;
      }
      // Each draft offers the pictures as photos to keep.
      for (const { job, inputs } of result.pictures ?? []) {
        for (const [n, input] of inputs.entries()) {
          const picture = pictures[n];
          if (picture) await giveDraftPicture(job, input, picture);
        }
      }
      found.push(...result.jobs);
    }
    setWorking(null);
    setProblems(missed);
    // Where nothing was found, the reasons are the news; otherwise the page's own note is.
    if (missed.length > 0 && found.length === 0) {
      requestAnimationFrame(() => problemRef.current?.focus());
    }
    if (found.length > 0) {
      onImported(
        found,
        files.length === 1 ? (files[0]?.name ?? "that file") : "those files",
        missed.length > 0,
      );
    }
  };

  return (
    <section className={styles.section} aria-labelledby="import-file-title">
      <h2 id="import-file-title">From a file</h2>
      <p>
        A recipe you typed up in Word, TextEdit or a notes app: choose the file (Word .docx, Rich
        Text .rtf, text .txt or Markdown .md), or several at once. Fennl reads the text on this
        device and you check the recipe before it&rsquo;s saved.
        {status.photos?.enabled
          ? " Photos in a Word file are offered to keep with the recipe."
          : ""}
      </p>
      <label
        className={`${recipes.primary} ${working ? styles.off : ""}`}
        aria-disabled={working !== null}
      >
        <input
          type="file"
          className="visually-hidden"
          multiple
          accept=".docx,.rtf,.txt,.text,.md,.markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,text/rtf,text/plain,text/markdown"
          disabled={working !== null}
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = "";
            void read(files);
          }}
        />
        Choose files
      </label>
      {working ? (
        <p role="status" className={recipes.hint}>
          {working}
        </p>
      ) : null}
      {problems.length > 0 ? (
        <ul
          ref={problemRef}
          tabIndex={-1}
          role="alert"
          className={`${styles.problem} ${styles.plainList}`}
        >
          {problems.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
