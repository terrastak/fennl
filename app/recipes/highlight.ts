// Highlighting words in a line (phase E10): the review screen marks the words the AI couldn't read
// for certain, wherever they still are in the line as the person edits it.

export interface Piece {
  text: string;
  /** One of the words to highlight. */
  marked: boolean;
}

/** The line in pieces, the given words marked wherever they appear (longest first). */
export function highlightWords(text: string, words: readonly string[]): Piece[] {
  const wanted = [...new Set(words.filter((w) => w.trim()))].sort((a, b) => b.length - a.length);
  if (wanted.length === 0) return [{ text, marked: false }];
  const pieces: Piece[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const word = wanted.find((w) => text.startsWith(w, i));
    if (word) {
      if (plain) pieces.push({ text: plain, marked: false });
      plain = "";
      pieces.push({ text: word, marked: true });
      i += word.length;
    } else {
      plain += text[i];
      i += 1;
    }
  }
  if (plain) pieces.push({ text: plain, marked: false });
  return pieces;
}
