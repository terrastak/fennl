import type { PointerEvent as ReactPointerEvent } from "react";

/** Shows a name cut short in full when the mouse is over it (the page reads it whole anyway). */
export function titleIfCut(event: ReactPointerEvent<HTMLElement>, name: string) {
  const el = event.currentTarget;
  const cut = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
  if (cut) el.title = name;
  else el.removeAttribute("title");
}
