// Building the extension's own pages (the panel, popup.ts, and the setup step, setup.ts).

/** An element with text (never HTML, so a name can't inject anything). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function button(text: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const b = el("button", text, primary ? "primary" : "secondary");
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}
