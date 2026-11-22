import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  RECIPE_RULES,
  SOURCE_KINDS,
  type RecipeSource,
  type SourceKind,
} from "../../shared/recipe";
import { servesOrMakesReading } from "../../shared/servings";
import { lineAt, lineEnd, moveLine, typedLineAt, typedLines, webAddress } from "./editing";
import { described, problemsFor } from "./fieldProblems";
import editor from "./editor.module.css";
import type { EditorSession, EditorState } from "./editorSession";
import styles from "./recipes.module.css";
import { highlightWords } from "./highlight";
import { LinkPicker, LinkStrip, LinkedName } from "./LinkControl";
import { ExampleRows, MarginMark } from "./marginMarks";
import { StepBoxes, type StepBoxesHandle } from "./StepBoxes";
import { LaptopIcon } from "./LaptopIcon";
import { LAPTOP_ICONS } from "./laptopIcons";
import { usePointer } from "./usePointer";

// The recipe editor's fields (phase C6), shared with the import review screen (phase E4), which
// edits a draft with the same boxes before it becomes a recipe.

const SOURCE_KIND_NAMES: Record<SourceKind, string> = {
  website: "Website",
  cookbook: "Cookbook",
  person: "Person",
  other: "Somewhere else",
};

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * "Alt+↑ / Alt+↓" (⌥↑ / ⌥↓ on a Mac), each key in a <kbd>: drawn as small keys on a laptop
 * (U23), as plain words elsewhere.
 */
function MoveKeys({ keys }: { keys: boolean }) {
  const laptop = usePointer() && keys;
  const alt = MAC ? "⌥" : "Alt";
  const plus = MAC ? "" : "+";
  // Phones keep the plain words (a key in a box would shape the text differently there).
  if (!laptop) return <>{`${alt}${plus}↑ / ${alt}${plus}↓`}</>;
  return (
    <>
      <kbd className={editor.key}>{alt}</kbd>
      {plus}
      <kbd className={editor.key}>↑</kbd> / <kbd className={editor.key}>{alt}</kbd>
      {plus}
      <kbd className={editor.key}>↓</kbd>
    </>
  );
}

/**
 * The one hint under Ingredients and Directions in the editor on a laptop (U27, the owner's words
 * 2026-11-21), and at its end the button that shows how Fennl reads the lines.
 */
export function LinesHint({
  id,
  reads,
  onReads,
}: {
  id: string;
  reads: boolean;
  onReads: (reads: boolean) => void;
}) {
  return (
    <div className={editor.sharedHint}>
      <p id={id}>
        One step per line; <kbd className={editor.key}>Enter</kbd> starts a new one.{" "}
        <MoveKeys keys /> reorders the line you&rsquo;re on.
      </p>
      <button
        type="button"
        className={editor.readsButton}
        aria-pressed={reads}
        onClick={() => onReads(!reads)}
      >
        <LaptopIcon path={LAPTOP_ICONS.eye} />
        How Fennl reads it
      </button>
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  problems = [],
  className,
  boxed = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  problems?: string[];
  className?: string | undefined;
  /**
   * A section of its own (the editor's Notes): on a laptop (U23) the label is the section's
   * heading and the box, its hint and any problem sit in a white box under it.
   */
  boxed?: boolean;
  children: ReactNode;
}) {
  const below = (
    <>
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
    </>
  );
  return (
    <div className={`${editor.field} ${boxed ? editor.boxedField : ""} ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      {boxed ? <div className={editor.fieldBox}>{below}</div> : below}
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
  linkFrom,
  laptopLook = false,
  margins = false,
  reads = false,
  footer,
  describedBy,
}: {
  session: EditorSession;
  state: EditorState;
  list: "ingredients" | "directions";
  label: string;
  /** Under the box (not with `margins`, where the editor has one hint under both boxes). */
  hint?: string;
  /**
   * More buttons beside Heading (the review screen's), for the line the cursor is on. `run`
   * changes the text and says where the cursor goes next, or null to leave it; `icon` is drawn
   * beside the words on a laptop.
   */
  tools?: { label: string; icon?: string; run: (line: number) => number | null }[];
  /** Lines to point out, by line ID: why ("Check this line"). */
  marks?: ReadonlyMap<string, string>;
  /** Words to highlight in lines, by line ID (the ones an AI import wasn't sure of, E10). */
  words?: ReadonlyMap<string, readonly string[]>;
  /**
   * The recipe being edited, so its lines can link to other recipes: ingredients (phase F3) and
   * steps (U27).
   */
  linkFrom?: string;
  /**
   * The laptop look (U23: the recipe editor, and the import review screen since slice 6) adds
   * icons to the buttons and draws the keys in the hint.
   */
  laptopLook?: boolean;
  /**
   * The recipe editor on a laptop (U27, owner's choices 2026-11-21): how Fennl reads each line is
   * shown in the box's margin (step numbers in thin circles, the H of a heading and its grey
   * band, the link mark, an accent edge on the line being typed), and the read-out under the box
   * only when `reads` is on.
   */
  margins?: boolean;
  /** With `margins`: the read-out ("How Fennl reads it") under the box. */
  reads?: boolean;
  /** With `margins`: what goes under the box (the editor's shared hint, under Directions). */
  footer?: ReactNode;
  /** With `margins`: the ID of words that describe the box (the shared hint). */
  describedBy?: string;
}) {
  const id = `edit-${list}`;
  const box = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const cursorTo = useRef<number | null>(null);
  const [cursorLine, setCursorLine] = useState<number | null>(null);
  // The line as typed the cursor is on (blank lines count), and whether the box has the cursor:
  // the margin's accent edge.
  const [cursorTyped, setCursorTyped] = useState(0);
  const [focused, setFocused] = useState(false);
  const [moved, setMoved] = useState("");
  // The line a recipe is being chosen for (phase F3), by ID.
  const [linking, setLinking] = useState<string | null>(null);
  // With margins, where the link panel opens: under the line being linked.
  const linkSpot = useRef<HTMLDivElement>(null);
  const lines = state.draft[list];
  const current = cursorLine === null ? undefined : lines[cursorLine];
  const problems = problemsFor(state.issues, list);
  const text = state.boxes[list];

  // Put the cursor back after the text changed under it (a line moved, the heading button).
  useLayoutEffect(() => {
    if (cursorTo.current === null || !box.current) return;
    box.current.setSelectionRange(cursorTo.current, cursorTo.current);
    cursorTo.current = null;
  });

  const typed = margins ? typedLines(text, list) : [];
  // Directions in the editor on a laptop: a box for each step (U27).
  const stepBoxes = margins && list === "directions";
  const steps = useRef<StepBoxesHandle>(null);
  /** Back to the box (the step the cursor was in), as it was. */
  const focusBox = (end = false) => {
    if (stepBoxes) steps.current?.focus(cursorTyped, end ? "end" : undefined);
    else box.current?.focus();
  };

  // With margins, the link panel opens under the line it's for.
  useLayoutEffect(() => {
    const spot = linkSpot.current;
    if (!spot || linking === null) return;
    const index = typedLines(state.boxes[list], list).findIndex(
      (t) => t.line !== null && state.draft[list][t.line]?.id === linking,
    );
    const row = mirror.current?.children[index];
    const top = section.current?.getBoundingClientRect().top;
    if (row && top !== undefined) {
      spot.style.top = `${row.getBoundingClientRect().bottom - top + 8}px`;
    }
  }, [linking, list, state.boxes, state.draft]);

  const track = () => {
    const el = box.current;
    if (!el) return;
    setCursorLine(lineAt(el.value, el.selectionStart, list));
    setCursorTyped(typedLineAt(el.value, el.selectionStart));
  };

  // With margins, the accent edge follows the cursor however it moves (a click, the keys, or a
  // change made by Fennl), which the box's own select event doesn't always say.
  useEffect(() => {
    if (!margins) return;
    const moved = () => {
      const el = box.current;
      if (el && document.activeElement === el) {
        setCursorLine(lineAt(el.value, el.selectionStart, list));
        setCursorTyped(typedLineAt(el.value, el.selectionStart));
      }
    };
    document.addEventListener("selectionchange", moved);
    return () => document.removeEventListener("selectionchange", moved);
  }, [margins, list]);

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
    setCursorTyped(typedLineAt(result.text, result.cursor));
    setMoved(up ? "Moved up" : "Moved down");
  };

  const toggleHeading = () => {
    if (cursorLine === null) return;
    session.toggleHeading(list, cursorLine);
    // Back to the end of the same line, ready to carry on typing.
    if (stepBoxes) {
      focusBox(true);
      return;
    }
    cursorTo.current = lineEnd(session.getSnapshot().boxes[list], cursorLine, list);
    box.current?.focus();
  };

  const runTool = (run: (line: number) => number | null) => {
    if (cursorLine === null) return;
    const at = run(cursorLine);
    if (at === null) return;
    cursorTo.current = at;
    const after = session.getSnapshot().boxes[list];
    setCursorLine(lineAt(after, at, list));
    setCursorTyped(typedLineAt(after, at));
    box.current?.focus();
  };

  // Step numbers skip headings, as on the recipe page.
  const numbers = lines.reduce<number[]>(
    (all, line) => [...all, (all.at(-1) ?? 0) + (line.heading ? 0 : 1)],
    [],
  );
  const linkedTo = (line: (typeof lines)[number] | undefined) =>
    line && !line.heading && "linkedRecipeId" in line ? (line.linkedRecipeId ?? null) : null;

  const preview = (
    <div className={editor.preview} role="group" aria-label={`${label}, as Fennl reads them`}>
      <p className={editor.previewTitle} aria-hidden="true">
        How Fennl reads it
      </p>
      {lines.length === 0 ? (
        <p className={styles.hint}>Nothing yet.</p>
      ) : (
        <ul className={editor.previewList}>
          {lines.map((line, i) => {
            const linked = linkFrom ? linkedTo(line) : null;
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
                  <span className={editor.stepNumber}>
                    {numbers[i]}
                    <span className={editor.stepDot}>.</span>
                  </span>
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
                {linked ? (
                  <LinkedName
                    recipeId={linked}
                    onUnlink={() => session.setLink(list, line.id, null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const picker =
    linkFrom && linking
      ? (() => {
          const line = state.draft[list].find((l) => l.id === linking);
          return line ? (
            <LinkPicker
              line={line}
              recipeId={linkFrom}
              onLink={(recipeId) => {
                session.setLink(list, line.id, recipeId);
                setLinking(null);
                focusBox();
              }}
              onClose={() => {
                setLinking(null);
                focusBox();
              }}
            />
          ) : null;
        })()
      : null;

  const textarea = (
    <textarea
      ref={box}
      {...described(id, !margins && Boolean(hint), problems)}
      {...(margins
        ? {
            "aria-describedby":
              [describedBy ?? "", problems.length > 0 ? `${id}-problem` : ""]
                .filter(Boolean)
                .join(" ") || undefined,
            // The shared hint under Directions says so on screen; here for screen readers.
            "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown",
          }
        : {})}
      className={`${styles.input} ${editor.textarea} ${margins ? editor.marginArea : ""}`}
      value={text}
      rows={margins ? 1 : 8}
      spellCheck
      onChange={(e) => {
        session.setBox(list, e.target.value);
        setCursorLine(lineAt(e.target.value, e.target.selectionStart, list));
        setCursorTyped(typedLineAt(e.target.value, e.target.selectionStart));
      }}
      onSelect={track}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        session.tidyBox(list);
      }}
      // The box is as tall as its words (the margin's copy sizes it), so it never scrolls.
      onScroll={margins ? (e) => (e.currentTarget.scrollTop = 0) : undefined}
    />
  );

  const problemText =
    problems.length > 0 ? (
      <p id={`${id}-problem`} className={editor.problem}>
        {problems.join(" ")}
      </p>
    ) : null;
  const movedText = (
    <p className="visually-hidden" aria-live="polite">
      {moved}
    </p>
  );

  // The line the cursor is on links to a recipe: say which, with Unlink (margins only: the
  // read-out under the box does this otherwise).
  const linkedHere = margins && linkFrom ? linkedTo(current) : null;

  return (
    <section
      ref={section}
      className={`${editor.lines} ${margins ? editor.marginLines : ""}`}
      aria-labelledby={`${id}-label`}
      data-list={list}
    >
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
            {laptopLook ? <LaptopIcon path={LAPTOP_ICONS.heading} /> : null}
            Heading
          </button>
          {linkFrom ? (
            <button
              type="button"
              className={editor.small}
              disabled={current === undefined || current.heading}
              onMouseDown={(event) => event.preventDefault()}
              aria-expanded={linking !== null}
              onClick={() => setLinking(current?.id ?? null)}
            >
              {laptopLook ? <LaptopIcon path={LAPTOP_ICONS.link} /> : null}
              Link a recipe
            </button>
          ) : null}
          {tools?.map((tool) => (
            <button
              key={tool.label}
              type="button"
              className={editor.small}
              disabled={current === undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runTool(tool.run)}
            >
              {laptopLook && tool.icon ? <LaptopIcon path={tool.icon} /> : null}
              {tool.label}
            </button>
          ))}
        </div>
      </div>
      {margins ? (
        <>
          {stepBoxes ? (
            <StepBoxes
              id={id}
              text={text}
              lines={lines}
              marks={typed.map((row) => {
                const line = row.line === null ? undefined : lines[row.line];
                if (!line) return null;
                return {
                  heading: line.heading,
                  linked: linkedTo(line) !== null,
                  number: row.line === null ? null : (numbers[row.line] ?? null),
                };
              })}
              invalid={typed.map((row, i) =>
                state.issues.some(
                  (issue) =>
                    (row.line !== null && issue.path.startsWith(`${list}.${row.line}.`)) ||
                    (i === 0 && issue.path === list),
                ),
              )}
              describedBy={
                [describedBy ?? "", problems.length > 0 ? `${id}-problem` : ""]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              example={<ExampleRows list={list} />}
              rowsRef={mirror}
              handle={steps}
              onChange={(changed, apart) =>
                apart
                  ? session.setBoxApart(list, changed, apart === true)
                  : session.setBox(list, changed)
              }
              onCursor={(step) => {
                setFocused(true);
                setCursorTyped(step);
                setCursorLine(
                  typedLines(session.getSnapshot().boxes[list], list)[step]?.line ?? null,
                );
              }}
              onLeave={() => {
                setFocused(false);
                session.tidyBox(list);
              }}
              onMoved={setMoved}
              onUndo={() => session.undo()}
              onRedo={() => session.redo()}
            />
          ) : (
            <div className={editor.marginBox}>
              {/* A copy of the box's words, unseen, lined up under them: it sizes the box and puts
                  each line's marks beside it. An empty box shows a faded example instead. */}
              <div ref={mirror} className={editor.mirror} aria-hidden="true" data-margin="">
                {text === "" ? (
                  <ExampleRows list={list} />
                ) : (
                  typed.map((row, i) => {
                    const line = row.line === null ? undefined : lines[row.line];
                    const heading = line?.heading ?? false;
                    const linked = linkedTo(line) !== null;
                    return (
                      <div
                        key={i}
                        className={editor.marginRow}
                        data-heading={heading ? "" : undefined}
                        data-linked={linked ? "" : undefined}
                        data-current={focused && i === cursorTyped ? "" : undefined}
                      >
                        <span className={editor.margin}>
                          {line ? (
                            <MarginMark
                              list={list}
                              heading={heading}
                              linked={linked}
                              number={row.line === null ? null : (numbers[row.line] ?? null)}
                            />
                          ) : null}
                        </span>
                        {/* A blank last line still takes its height. */}
                        {row.text || "​"}
                      </div>
                    );
                  })
                )}
              </div>
              {textarea}
            </div>
          )}
          {linkedHere && current ? (
            <LinkStrip
              recipeId={linkedHere}
              step={list === "directions"}
              onUnlink={() => session.setLink(list, current.id, null)}
            />
          ) : null}
          {footer}
          {problemText}
          {movedText}
          {picker ? (
            <div ref={linkSpot} className={editor.linkSpot}>
              {picker}
            </div>
          ) : null}
          {reads ? preview : null}
        </>
      ) : (
        <div className={editor.linesBody}>
          <div className={editor.field}>
            {textarea}
            {/* Fewer words (U27, owner's choice 2026-11-21): the Heading button says what it does. */}
            {hint ? (
              <p id={`${id}-hint`} className={styles.hint}>
                {hint} <MoveKeys keys={laptopLook} /> reorders the line you&rsquo;re on.
              </p>
            ) : null}
            {problemText}
            {movedText}
            {picker}
          </div>
          {preview}
        </div>
      )}
    </section>
  );
}

/** Words and spacing aside, the same: "Serves 4" and "serves 4". */
const sameReading = (a: string, b: string) =>
  a
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim() ===
  b
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * "Serves or makes" (U27, owner's choice 2026-11-21): one box for how many it serves and what it
 * makes ("4", "24 cookies", "Serves 8, makes about 24 pancakes"; shared/servings.ts). On a laptop
 * Fennl says quietly at the box's end how it reads it ("Serves 4", "Makes 24 cookies"), unless
 * that's what the box already says or there isn't room.
 */
export function ServesOrMakesBox({
  session,
  state,
  className,
}: {
  session: EditorSession;
  state: EditorState;
  className?: string | undefined;
}) {
  const id = "edit-servings";
  const problems = problemsFor(state.issues, "servings");
  const typed = state.boxes.servings;
  const read = servesOrMakesReading(state.draft.servings);
  const reading = typed.trim() && read && !sameReading(read, typed) ? read : null;
  const input = useRef<HTMLInputElement>(null);
  const said = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);
  // Whether it's on screen, so a screen reader hears it only where it's shown.
  const [shown, setShown] = useState(false);

  // Keep the typed words clear of the reading: the box makes room for it, and leaves it out
  // when it would take more than half the box. Phones don't show it (CSS), so it takes no room.
  useLayoutEffect(() => {
    const box = input.current;
    if (!box) return;
    const measure = () => {
      const width = said.current?.offsetWidth ?? 0;
      const room = width > 0 && width <= box.offsetWidth / 2;
      box.style.paddingRight = room ? `calc(${width}px + 1rem)` : "";
      setFits(width === 0 || room);
      setShown(room);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    return () => watch.disconnect();
  }, [reading]);

  const describedBy = [
    problems.length > 0 ? `${id}-problem` : "",
    reading && shown ? `${id}-reading` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Field id={id} label="Serves or makes" problems={problems} className={className}>
      <span className={editor.servesBox}>
        <input
          ref={input}
          id={id}
          aria-invalid={problems.length > 0 ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={styles.input}
          value={typed}
          placeholder="4, or 24 cookies"
          maxLength={RECIPE_RULES.shortTextLength}
          onChange={(e) => session.setBox("servings", e.target.value)}
          onBlur={() => session.tidyBox("servings")}
        />
        {reading ? (
          <span
            ref={said}
            id={`${id}-reading`}
            className={editor.reading}
            data-fits={fits ? undefined : "no"}
          >
            {reading}
          </span>
        ) : null}
      </span>
    </Field>
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
      <div className={editor.groupBox}>
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
      </div>
    </fieldset>
  );
}
