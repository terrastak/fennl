import { stepTimes, type StepTime } from "../../shared/cook";
import type { ShownLine } from "../../shared/scale";

// A method step cut at its times (U11), so the recipe page can draw each time as a timer link
// (./TimeLink.tsx) between the step's words; null when the step gives no time.

/** A step cut at its times: the words around them, as shown (scaled or converted), and the times. */
export type StepPart = { line: ShownLine } | { time: StepTime };

export function stepParts(text: string, show: (words: string) => ShownLine): StepPart[] | null {
  const times = stepTimes(text);
  if (times.length === 0) return null;
  const parts: StepPart[] = [];
  let at = 0;
  for (const time of times) {
    if (time.start > at) parts.push({ line: show(text.slice(at, time.start)) });
    parts.push({ time });
    at = time.end;
  }
  if (at < text.length) parts.push({ line: show(text.slice(at)) });
  return parts;
}
