import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  RECIPE_RULES,
  SOURCE_KINDS,
  type RecipeSource,
  type SourceKind,
} from "../../shared/recipe";
import { lineAt, lineEnd, moveLine, webAddress } from "./editing";
import { described, problemsFor } from "./fieldProblems";
import editor from "./editor.module.css";
import type { EditorSession, EditorState } from "./editorSession";
import styles from "./recipes.module.css";
import { highlightWords } from "./highlight";

// The recipe editor's fields (phase C6), shared with the import review screen (phase E4), which
// edits a draft with the same boxes before it becomes a recipe.

const SOURCE_KIND_NAMES: Record<SourceKind, string> = {
  website: "Website",
  cookbook: "Cookbook",
  person: "Person",
  other: "Somewhere else",
};

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOVE_KEYS = MAC ? "⌥↑ / ⌥↓" : "Alt+↑ / Alt+↓";

export function Field({
  id,
  label,
  hint,
  problems = [],
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  problems?: string[];
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={`${editor.field} ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {problems.length > 0 ? (
        <p id={`${id}-problem`} className={editor.problem}>
          {problems.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

/** Ingredients or directions: a text box, the heading button, and a preview of the lines. */
export function LinesBox({
  session,
  state,
  list,
  label,
  hint,
  tools,
  marks,
  words,
}: {
  session: EditorSession;
  state: EditorState;
  list: "ingredients" | "directions";
  label: string;
  hint: string;
  /**
   * More buttons beside Heading (the review screen's), for the line the cursor is on. `run`
   * changes the text and says where the cursor goes next, or null to leave it.
   */
  tools?: { label: string; run: (line: number) => number | null }[];
  /** Lines to point out, by line ID: why ("Check this line"). */
  marks?: ReadonlyMap<string, string>;
  /** Words to highlight in lines, by line ID (the ones an AI import wasn't sure of, E10). */
  words?: ReadonlyMap<string, readonly string[]>;
}) {
  const id = `edit-${list}`;
  const box = useRef<HTMLTextAreaElement>(null);
  const cursorTo = useRef<number | null>(null);
  const [cursorLine, setCursorLine] = useState<number | null>(null);
  const [moved, setMoved] = useState("");
  const lines = state.draft[list];
  const current = cursorLine === null ? undefined : lines[cursorLine];
  const problems = problemsFor(state.issues, list);

  // Put the cursor back after the text changed under it (a line moved, the heading button).
  useLayoutEffect(() => {
    if (cursorTo.current === null || !box.current) return;
    box.current.setSelectionRange(cursorTo.current, cursorTo.current);
    cursorTo.current = null;
  });

  const track = () => {
    const el = box.current;
    if (el) setCursorLine(lineAt(el.value, el.selectionStart, list));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const up = event.key === "ArrowUp";
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!up && event.key !== "ArrowDown") return;
    event.preventDefault();
    const el = event.currentTarget;
    const result = moveLine(el.value, el.selectionStart, up ? -1 : 1);
    if (!result) return;
    cursorTo.current = result.cursor;
    session.setBox(list, result.text);
    setCursorLine(lineAt(result.text, result.cursor, list));
    setMoved(up ? "Moved up" : "Moved down");
  };

  const toggleHeading = () => {
    if (cursorLine === null) return;
    session.toggleHeading(list, cursorLine);
    // Back to the end of the same line, ready to carry on typing.
    cursorTo.current = lineEnd(session.getSnapshot().boxes[list], cursorLine, list);
    box.current?.focus();
  };

  const runTool = (run: (line: number) => number | null) => {
    if (cursorLine === null) return;
    const at = run(cursorLine);
    if (at === null) return;
    cursorTo.current = at;
    setCursorLine(lineAt(session.getSnapshot().boxes[list], at, list));
    box.current?.focus();
  };

  // Step numbers skip headings, as on the recipe page.
  const numbers = lines.reduce<number[]>(
    (all, line) => [...all, (all.at(-1) ?? 0) + (line.heading ? 0 : 1)],
    [],
  );
  return (
    <section className={editor.lines} aria-labelledby={`${id}-label`}>
      <div className={editor.linesHead}>
        <label id={`${id}-label`} htmlFor={id} className={editor.linesLabel}>
          {label}
        </label>
        <div className={editor.lineTools}>
          <button
            type="button"
            className={editor.small}
            aria-pressed={current?.heading ?? false}
            disabled={current === undefined}
            // Keep the cursor's place: the box isn't left, so it isn't tidied first.
            onMouseDown={(event) => event.preventDefault()}
            onClick={toggleHeading}
          >
            Heading
          </button>
          {tools?.map((tool) => (
            <button
              key={tool.label}
              type="button"
              className={editor.small}
              disabled={current === undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runTool(tool.run)}
            >
              {tool.label}
            </button>
          ))}
        </div>
      </div>
      <div className={editor.linesBody}>
        <div className={editor.field}>
          <textarea
            ref={box}
            {...described(id, true, problems)}
            className={`${styles.input} ${editor.textarea}`}
            value={state.boxes[list]}
            rows={8}
            spellCheck
            onChange={(e) => {
              session.setBox(list, e.target.value);
              setCursorLine(lineAt(e.target.value, e.target.selectionStart, list));
            }}
            onSelect={track}
            onKeyDown={onKeyDown}
            onBlur={() => session.tidyBox(list)}
          />
          <p id={`${id}-hint`} className={styles.hint}>
            {hint} {MOVE_KEYS} moves the line you&rsquo;re on. Heading makes it a section heading
            (&ldquo;For the crust&rdquo;).
          </p>
          {problems.length > 0 ? (
            <p id={`${id}-problem`} className={editor.problem}>
              {problems.join(" ")}
            </p>
          ) : null}
          <p className="visually-hidden" aria-live="polite">
            {moved}
          </p>
        </div>
        <div className={editor.preview} role="group" aria-label={`${label}, as Fennl reads them`}>
          <p className={editor.previewTitle} aria-hidden="true">
            How Fennl reads it
          </p>
          {lines.length === 0 ? (
            <p className={styles.hint}>Nothing yet.</p>
          ) : (
            <ul className={editor.previewList}>
              {lines.map((line, i) => {
                return (
                  <li
                    key={line.id}
                    className={`${line.heading ? editor.previewHeading : ""} ${
                      i === cursorLine ? editor.previewCurrent : ""
                    }`}
                  >
                    {line.heading ? (
                      <span className="visually-hidden">Heading: </span>
                    ) : list === "directions" ? (
                      <span className={editor.stepNumber}>{numbers[i]}.</span>
                    ) : null}
                    {highlightWords(line.text, words?.get(line.id) ?? []).map((piece, k) =>
                      piece.marked ? (
                        <mark key={k} className={editor.unsure}>
                          {piece.text}
                          <span className="visually-hidden"> (not sure)</span>
                        </mark>
                      ) : (
                        piece.text
                      ),
                    )}
                    {marks?.has(line.id) ? (
                      <span className={editor.mark}> {marks.get(line.id)}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export function TimeBox({
  session,
  state,
  which,
  label,
}: {
  session: EditorSession;
  state: EditorState;
  which: "prep" | "cook" | "total";
  label: string;
}) {
  const id = `edit-${which}`;
  const problems = problemsFor(state.issues, `times.${which}`);
  return (
    <Field id={id} label={label} problems={problems}>
      <input
        {...described(id, false, problems)}
        className={styles.input}
        value={state.boxes[which]}
        placeholder="1 hr 30 min"
        onChange={(e) => session.setBox(which, e.target.value)}
        onBlur={() => session.tidyBox(which)}
      />
    </Field>
  );
}

export function SourceFields({ session, state }: { session: EditorSession; state: EditorState }) {
  const source = state.draft.source;
  const set = (patch: Partial<RecipeSource>) => session.set({ source: { ...source, ...patch } });
  const text = (value: string) => (value.trim() ? value : null);
  const urlProblems = problemsFor(state.issues, "source.url");

  const nameLabel: Record<SourceKind, string> = {
    website: "Site name",
    cookbook: "Book title",
    person: "Whose recipe",
    other: "Where",
  };
  const kind = source.kind;
  return (
    <fieldset className={editor.group}>
      <legend>Where it&rsquo;s from</legend>
      <div className={editor.row}>
        <Field id="edit-source-kind" label="Source">
          <select
            id="edit-source-kind"
            className={styles.select}
            value={kind ?? ""}
            onChange={(e) => set({ kind: (e.target.value || null) as SourceKind | null })}
          >
            <option value="">Not set</option>
            {SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {SOURCE_KIND_NAMES[k]}
              </option>
            ))}
          </select>
        </Field>
        {kind ? (
          <Field
            id="edit-source-name"
            label={nameLabel[kind]}
            hint={kind === "person" ? "Shown handwritten above the title." : undefined}
          >
            <input
              {...described("edit-source-name", kind === "person", [])}
              className={styles.input}
              value={source.name ?? ""}
              maxLength={RECIPE_RULES.shortTextLength}
              onChange={(e) => set({ name: text(e.target.value) })}
            />
          </Field>
        ) : null}
        {kind === "website" || kind === "cookbook" ? (
          <Field id="edit-source-author" label="Author">
            <input
              id="edit-source-author"
              className={styles.input}
              value={source.author ?? ""}
              maxLength={RECIPE_RULES.shortTextLength}
              onChange={(e) => set({ author: text(e.target.value) })}
            />
          </Field>
        ) : null}
        {kind === "cookbook" ? (
          <Field id="edit-source-page" label="Page" className={editor.narrow}>
            <input
              id="edit-source-page"
              className={styles.input}
              value={source.page ?? ""}
              maxLength={RECIPE_RULES.shortTextLength}
              onChange={(e) => set({ page: text(e.target.value) })}
            />
          </Field>
        ) : null}
        {kind === "website" || kind === "other" ? (
          <Field id="edit-source-url" label="Web address" problems={urlProblems}>
            <input
              {...described("edit-source-url", false, urlProblems)}
              className={styles.input}
              type="url"
              inputMode="url"
              value={source.url ?? ""}
              placeholder="https://"
              maxLength={RECIPE_RULES.urlLength}
              onChange={(e) => set({ url: e.target.value || null })}
              onBlur={() => set({ url: webAddress(source.url ?? "") })}
            />
          </Field>
        ) : null}
      </div>
    </fieldset>
  );
}
