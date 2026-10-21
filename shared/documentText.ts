import { unzipSync } from "fflate";

/**
 * A recipe saved as a document (phase E18; spec.md E18): its text, taken out on the person's
 * device, then read exactly as pasted text (E15), and for a Word file the pictures in it, offered
 * as photos to keep. Owner's choices 2026-10-21: Word (.docx), Rich Text (.rtf), plain text
 * (.txt) and Markdown (.md); not LibreOffice (.odt) until people ask. Old Word files (.doc) and
 * Apple Pages files can't be read: people are told how to save them as .docx. No new dependency:
 * a Word file is a zip of XML (fflate), Rich Text is text with formatting codes.
 */

/** Not plan limits: what a document import handles well. */
export const DOCUMENT_RULES = {
  /** The largest file (a Word file can carry big photos). */
  bytes: 20 * 1024 * 1024,
  /** Files read in one go. */
  files: 10,
  /** Pictures offered from one document. */
  pictures: 10,
  /** A picture smaller than this on either side is a bullet, an icon or a logo, not a photo. */
  pictureSide: 200,
} as const;

export type DocumentKind = "docx" | "rtf" | "txt" | "md";

/** What a file is, by its name: a kind Fennl reads, one it can't ("doc", "pages", "odt"), or none. */
export function documentKind(fileName: string): DocumentKind | "doc" | "pages" | "odt" | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  switch (ext) {
    case "docx":
      return "docx";
    case "rtf":
      return "rtf";
    case "txt":
    case "text":
      return "txt";
    case "md":
    case "markdown":
      return "md";
    case "doc":
      return "doc";
    case "pages":
      return "pages";
    case "odt":
      return "odt";
    default:
      return null;
  }
}

/** A picture inside a document, in the order the document shows it. */
export interface DocumentPicture {
  name: string;
  bytes: Uint8Array;
}

export interface DocumentText {
  text: string;
  pictures: DocumentPicture[];
}

/** Tidies a document's text: line ends, no-break spaces, runs of blank lines. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/^[ \t]+(?=\S)/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A text file's text, in UTF-8 or UTF-16 when it says so, else Windows' usual encoding. */
export function plainText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return tidy(new TextDecoder("utf-16le").decode(bytes));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return tidy(new TextDecoder("utf-16be").decode(bytes));
  try {
    return tidy(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return tidy(new TextDecoder("windows-1252").decode(bytes));
  }
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const unescapeXml = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return XML_ENTITIES[name] ?? whole;
  });

/**
 * A Word file's text and pictures. Paragraphs are lines, tabs and line breaks are kept, a heading
 * starts with "## ", an item of a bulleted or numbered list (Word's own lists, whose numbers
 * aren't in the text) starts with "- ". Throws "not_a_document" for a file that isn't one.
 */
export function docxText(bytes: Uint8Array): DocumentText {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) =>
        f.name === "word/document.xml" ||
        f.name === "word/_rels/document.xml.rels" ||
        f.name.startsWith("word/media/"),
    });
  } catch (error) {
    throw new Error("not_a_document", { cause: error });
  }
  const main = files["word/document.xml"];
  if (!main) throw new Error("not_a_document");
  const xml = new TextDecoder().decode(main);
  const rels = new TextDecoder().decode(files["word/_rels/document.xml.rels"] ?? new Uint8Array());
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) targets.set(id, target.replace(/^\/?(word\/)?/, "word/"));
  }

  const lines: string[] = [];
  const pictures: DocumentPicture[] = [];
  const seen = new Set<string>();
  const body = xml.slice(xml.indexOf("<w:body"));
  for (const para of body.match(/<w:p\b[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g) ?? []) {
    const style = /<w:pStyle w:val="([^"]+)"/.exec(para)?.[1] ?? "";
    const listed = /<w:numPr>/.test(para);
    let text = "";
    for (const piece of para.matchAll(
      /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>|<a:blip\b[^>]*r:embed="([^"]+)"/g,
    )) {
      const [whole, chars, embed] = piece;
      if (chars !== undefined) text += unescapeXml(chars);
      else if (whole.startsWith("<w:tab")) text += "\t";
      else if (whole.startsWith("<w:br") || whole.startsWith("<w:cr")) text += "\n";
      else if (embed) {
        const path = targets.get(embed);
        const picture = path ? files[path] : undefined;
        if (path && picture && !seen.has(path)) {
          seen.add(path);
          pictures.push({ name: path.slice(path.lastIndexOf("/") + 1), bytes: picture });
        }
      }
    }
    if (/^(Heading|Title)/i.test(style) && text.trim()) text = `## ${text.trim()}`;
    else if (listed && text.trim()) text = `- ${text.trim()}`;
    lines.push(text);
  }
  return { text: tidy(lines.join("\n")), pictures };
}

/** Rich Text groups whose text isn't the document's own (fonts, colours, lists, pictures...). */
const RTF_SKIPPED = new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "info",
  "pict",
  "listtable",
  "listoverridetable",
  "expandedcolortbl",
  "generator",
  "header",
  "footer",
  "headerl",
  "headerr",
  "footerl",
  "footerr",
  "object",
  "themedata",
  "datastore",
  "latentstyles",
  "listtext",
  "pntext",
  "fldinst",
]);

const CP1252 = new TextDecoder("windows-1252");

/**
 * A Rich Text file's text (TextEdit's and Word's .rtf). Paragraphs and line breaks are lines,
 * tabs are kept; fonts, colours, list markers and pictures are left out.
 */
export function rtfText(rtf: string): string {
  if (!rtf.startsWith("{\\rtf")) throw new Error("not_a_document");
  let out = "";
  // Each group: whether its text is skipped, and how many characters follow a \u character.
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let pendingSkip = 0;
  let i = 0;
  const emit = (text: string) => {
    if (pendingSkip > 0) {
      const dropped = Math.min(pendingSkip, text.length);
      pendingSkip -= dropped;
      text = text.slice(dropped);
    }
    if (!skip) out += text;
  };
  while (i < rtf.length) {
    const ch = rtf[i] as string;
    if (ch === "{") {
      stack.push({ skip, uc });
      i += 1;
      // "{\*\word" is a group a reader that doesn't know it should skip.
      if (rtf.startsWith("\\*", i)) skip = true;
      continue;
    }
    if (ch === "}") {
      ({ skip, uc } = stack.pop() ?? { skip: false, uc: 1 });
      i += 1;
      continue;
    }
    if (ch === "\\") {
      const next = rtf[i + 1] ?? "";
      if (next === "'") {
        const code = parseInt(rtf.slice(i + 2, i + 4), 16);
        if (pendingSkip > 0) pendingSkip -= 1;
        else if (!skip && Number.isFinite(code)) out += CP1252.decode(new Uint8Array([code]));
        i += 4;
        continue;
      }
      if (next === "\n" || next === "\r") {
        emit("\n");
        i += 2;
        continue;
      }
      if (!/[a-z]/i.test(next)) {
        // A control symbol: \~ no-break space, \- optional hyphen, \_ hyphen, or a literal \ { }.
        const symbols: Record<string, string> = {
          "~": " ",
          "-": "",
          _: "-",
          "\\": "\\",
          "{": "{",
          "}": "}",
        };
        emit(symbols[next] ?? "");
        i += 2;
        continue;
      }
      const m = /^\\([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i, i + 40));
      if (!m) {
        i += 1;
        continue;
      }
      const [whole, word, arg] = m as unknown as [string, string, string | undefined];
      i += whole.length;
      if (RTF_SKIPPED.has(word)) skip = true;
      else if (word === "par" || word === "line" || word === "row") emit("\n");
      else if (word === "tab" || word === "cell") emit("\t");
      else if (word === "uc") uc = Number(arg ?? 1);
      else if (word === "u" && arg !== undefined) {
        const code = Number(arg);
        if (!skip) out += String.fromCharCode(code < 0 ? code + 65536 : code);
        pendingSkip = uc;
      } else if (word === "emdash") emit("—");
      else if (word === "endash") emit("–");
      else if (word === "bullet") emit("•");
      else if (word === "lquote") emit("‘");
      else if (word === "rquote") emit("’");
      else if (word === "ldblquote") emit("“");
      else if (word === "rdblquote") emit("”");
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    emit(ch);
    i += 1;
  }
  return tidy(out);
}

/** A document's text (and a Word file's pictures). Throws "not_a_document" when it can't be read. */
export function documentText(kind: DocumentKind, bytes: Uint8Array): DocumentText {
  if (kind === "docx") return docxText(bytes);
  if (kind === "rtf") return { text: rtfText(plainText(bytes)), pictures: [] };
  return { text: plainText(bytes), pictures: [] };
}
