/**
 * A PDF page's own text as lines (phase E12), from the pieces pdf.js gives
 * (page.getTextContent().items): each piece's text, where it sits, and whether a line ends after
 * it. Kept free of pdf.js itself, so it runs anywhere and is tested on its own.
 */

/** A piece of a page's text as pdf.js gives it (TextItem); marked-content items have no str. */
export interface PdfTextPiece {
  str?: string;
  hasEOL?: boolean;
  /** [a, b, c, d, x, y]: where the piece sits on the page. */
  transform?: number[];
  height?: number;
}

/**
 * The page's text, a line for each line printed, with runs of spaces made one. A new line also
 * starts where a piece sits lower than the one before by more than half its height, for PDFs that
 * don't mark line ends.
 */
export function pageText(pieces: PdfTextPiece[]): string {
  let text = "";
  let lastY: number | null = null;
  for (const piece of pieces) {
    if (typeof piece.str !== "string") continue;
    const y = piece.transform?.[5] ?? null;
    const height = piece.height || 10;
    if (lastY !== null && y !== null && lastY - y > height / 2 && !text.endsWith("\n")) {
      text += "\n";
    }
    text += piece.str;
    if (piece.hasEOL) text += "\n";
    if (y !== null) lastY = y;
  }
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((line, i, lines) => line || (i > 0 && lines[i - 1]))
    .join("\n")
    .trim();
}
