import { useEffect, useId, useRef, type ReactNode } from "react";
import { LaptopIcon } from "../LaptopIcon";
import { LAPTOP_ICONS } from "../laptopIcons";
import editor from "../editor.module.css";

// A small question under one of the editor's bar buttons (U27 part 3, the mockup's
// discard-question.png): Discard changes' in pale red, Done's partner question in the warm note
// colours. Its first button has the focus; Escape closes it (the caller puts the focus back),
// from the question or from the button it belongs to. Pressing elsewhere on the page, or moving
// the focus out with Tab, closes it too (onDismiss: the focus stays where it went).

export function EditorQuestion({
  tone,
  question,
  note,
  children,
  onEscape,
  onDismiss,
}: {
  tone: "danger" | "warm";
  /** In bold. */
  question: string;
  /** After the question, in plain words. */
  note?: string;
  /** The buttons. */
  children: ReactNode;
  onEscape: () => void;
  onDismiss: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  // The latest handlers, for the listeners added once.
  const handlers = useRef({ onEscape, onDismiss });
  useEffect(() => {
    handlers.current = { onEscape, onDismiss };
  });
  useEffect(() => {
    const own = box.current;
    // Where the question belongs: it and its button (a laptop), or the editor's bar (a phone).
    const owner = own?.parentElement;
    if (!own || !owner) return;
    const key = (event: KeyboardEvent) => {
      const at = document.activeElement;
      if (event.key !== "Escape" || !owner.contains(at) || own.contains(at)) return;
      event.preventDefault();
      handlers.current.onEscape();
    };
    const press = (event: PointerEvent) => {
      if (!owner.contains(event.target as Node)) handlers.current.onDismiss();
    };
    const leave = (event: FocusEvent) => {
      const to = event.relatedTarget as Node | null;
      if (to && !owner.contains(to)) handlers.current.onDismiss();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", press);
    owner.addEventListener("focusout", leave);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", press);
      owner.removeEventListener("focusout", leave);
    };
  }, []);
  return (
    <div
      ref={box}
      className={editor.ask}
      data-tone={tone}
      role="alertdialog"
      aria-labelledby={`${id}-q`}
      aria-describedby={note ? `${id}-n` : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }}
    >
      <p className={editor.askQuestion}>
        {tone === "danger" ? <LaptopIcon path={LAPTOP_ICONS.warning} /> : null}
        <span>
          <b id={`${id}-q`}>{question}</b>
          {note ? <span id={`${id}-n`}>{note}</span> : null}
        </span>
      </p>
      <div className={editor.askButtons}>{children}</div>
    </div>
  );
}
