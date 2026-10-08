import { plain } from "../sync/search";

/** Text with the words that start with a searched-for word marked (phase C8). */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  const parts: (string | { word: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0];
    if (!terms.some((term) => plain(word).startsWith(term))) continue;
    const at = match.index;
    if (at > last) parts.push(text.slice(last, at));
    parts.push({ word });
    last = at + word.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((part, i) => (typeof part === "string" ? part : <mark key={i}>{part.word}</mark>))}
    </>
  );
}
