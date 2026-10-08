import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  DIFFICULTIES,
  RECIPE_RULES,
  SOURCE_KINDS,
  type Difficulty,
  type RecipeIssue,
  type RecipeSource,
  type SourceKind,
} from "../../shared/recipe";
import type { RecipeChange } from "../../shared/sync";
import { RecipeCategories } from "../categories/RecipeCategories";
import { navigate } from "../navigation";
import { Link } from "../router";
import { canEdit } from "../sync/status";
import { activeSyncClient, useRecipe, useSyncStatus } from "../sync/useSync";
import { issueMessage, lineAt, lineEnd, moveLine, webAddress } from "./editing";
import editor from "./editor.module.css";
import { EditorSession, type EditorState, type SaveState } from "./editorSession";
import styles from "./recipes.module.css";

// The recipe editor (phase C6): /recipes/<id>/edit, or /recipes/<new id>/edit?new for a new
// recipe. It saves as you type, through the sync engine (editorSession.ts has the rules).
// Ingredients and directions are one text box each (CLAUDE.md, "Data model rules"), with a
// preview of how each line was read and a heading button. Alt+↑ / Alt+↓ moves a line.

async function saveChange(change: RecipeChange): Promise<void> {
  const client = activeSyncClient();
  if (!client) throw new Error("Not connected yet.");
  await client.save(change);
}

const SAVE_TEXT: Record<SaveState, string> = {
  saved: "All changes saved",
  saving: "Saving…",
  needs_title: "Give it a title to save it",
  problems: "Fix the marked fields to save them",
  paused: "Waiting for a connection to save",
  failed: "Couldn’t save just now; trying again",
};

const SOURCE_KIND_NAMES: Record<SourceKind, string> = {
  website: "Website",
  cookbook: "Cookbook",
  person: "Person",
  other: "Somewhere else",
};

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOVE_KEYS = MAC ? "⌥↑ / ⌥↓" : "Alt+↑ / Alt+↓";

/** Problems for one field (its path, or anything under it). */
function problemsFor(issues: RecipeIssue[], path: string): string[] {
  const matching = issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));
  return [...new Set(matching.map(issueMessage))];
}

/** The attributes that tie a field to its hint and problems. */
function described(id: string, hint: boolean, problems: string[]) {
  const ids = [hint ? `${id}-hint` : "", problems.length > 0 ? `${id}-problem` : ""];
  const describedBy = ids.filter(Boolean).join(" ");
  return {
    id,
    "aria-invalid": problems.length > 0 ? true : undefined,
    "aria-describedby": describedBy || undefined,
  };
}

function Field({
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
function LinesBox({
  session,
  state,
  list,
  label,
  hint,
}: {
  session: EditorSession;
  state: EditorState;
  list: "ingredients" | "directions";
  label: string;
  hint: string;
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
                    {line.text}
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

function TimeBox({
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

function SourceFields({ session, state }: { session: EditorSession; state: EditorState }) {
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

function Editor({
  id,
  initial,
  incoming,
  isNew,
}: {
  id: string;
  initial: EditorState["draft"] | null;
  /** The local copy as it changes (this device's saves, and changes from elsewhere). */
  incoming: EditorState["draft"] | null;
  isNew: boolean;
}) {
  const [session] = useState(() => new EditorSession({ id, initial, save: saveChange }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const editable = canEdit(useSyncStatus());
  const titleBox = useRef<HTMLInputElement>(null);

  useEffect(() => session.setEditable(editable), [session, editable]);
  useEffect(() => {
    if (incoming) session.receive(incoming);
  }, [session, incoming]);

  // Save what's waiting when leaving the editor, or when the page is hidden or closed.
  useEffect(() => {
    const save = () => void session.flush();
    const hidden = () => document.visibilityState === "hidden" && save();
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", hidden);
      save();
    };
  }, [session]);

  // A new recipe starts in its title (after the app's frame has moved focus to the heading).
  useEffect(() => {
    if (!isNew || initial) return;
    const frame = requestAnimationFrame(() => titleBox.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isNew, initial]);

  const title = state.draft.title.trim();
  useEffect(() => {
    document.title = `${title ? `Editing ${title}` : "New recipe"} · Fennl`;
  }, [title]);

  const done = async () => {
    await session.flush();
    const problem = document.querySelector<HTMLElement>("[aria-invalid='true']");
    if (problem) return problem.focus();
    navigate(session.getSnapshot().created ? `/recipes/${id}` : "/");
  };

  const set = session.set.bind(session);
  const titleProblems = state.created ? problemsFor(state.issues, "title") : [];
  const servingsProblems = problemsFor(state.issues, "servings");
  const draft = state.draft;

  return (
    <article className={editor.editor}>
      <h1 tabIndex={-1} className={editor.heading}>
        {initial ? "Edit recipe" : "New recipe"}
      </h1>
      <div className={editor.bar}>
        <p className={editor.status} data-editor-status aria-live="polite">
          {SAVE_TEXT[editable || state.save === "saved" ? state.save : "paused"]}
        </p>
        <div className={editor.barButtons}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void session.undo()}
            disabled={!editable || !state.canUndo}
          >
            Undo
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void session.redo()}
            disabled={!editable || !state.canRedo}
          >
            Redo
          </button>
          <button type="button" className={styles.primary} onClick={() => void done()}>
            Done
          </button>
        </div>
      </div>

      {!editable ? (
        <p className={editor.notice} role="status">
          Editing is paused until this device is back online. Nothing you&rsquo;ve typed is lost.
        </p>
      ) : null}

      <form onSubmit={(e) => e.preventDefault()}>
        <fieldset className={editor.fields} disabled={!editable}>
          <Field id="edit-title" label="Title" problems={titleProblems}>
            <input
              ref={titleBox}
              {...described("edit-title", false, titleProblems)}
              className={`${styles.input} ${editor.titleInput}`}
              value={draft.title}
              maxLength={RECIPE_RULES.titleLength}
              placeholder="Green chile stew"
              onChange={(e) => set({ title: e.target.value })}
            />
          </Field>

          <Field
            id="edit-description"
            label="About this recipe"
            hint="A line or two shown under the title."
            problems={problemsFor(state.issues, "description")}
          >
            <textarea
              {...described("edit-description", true, problemsFor(state.issues, "description"))}
              className={`${styles.input} ${editor.textarea} ${editor.short}`}
              value={draft.description}
              rows={2}
              maxLength={RECIPE_RULES.descriptionLength}
              onChange={(e) => set({ description: e.target.value })}
            />
          </Field>

          <LinesBox
            session={session}
            state={state}
            list="ingredients"
            label="Ingredients"
            hint="One per line, as you'd write them."
          />
          <LinesBox
            session={session}
            state={state}
            list="directions"
            label="Method"
            hint="One step per line; numbers are added for you."
          />

          <RecipeCategories recipeId={id} disabled={!editable} />

          <fieldset className={editor.group}>
            <legend>Time and servings</legend>
            <div className={editor.row}>
              <TimeBox session={session} state={state} which="prep" label="Prep time" />
              <TimeBox session={session} state={state} which="cook" label="Cook time" />
              <TimeBox session={session} state={state} which="total" label="Total time" />
            </div>
            <div className={editor.row}>
              <Field
                id="edit-servings"
                label="Serves"
                problems={servingsProblems}
                className={editor.narrow}
              >
                <input
                  {...described("edit-servings", false, servingsProblems)}
                  className={styles.input}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={RECIPE_RULES.maxServings}
                  value={state.boxes.servings}
                  onChange={(e) => session.setBox("servings", e.target.value)}
                  onBlur={() => session.tidyBox("servings")}
                />
              </Field>
              <Field id="edit-yield" label="Makes" hint="For example 2 loaves, or 24 cookies.">
                <input
                  {...described("edit-yield", true, [])}
                  className={styles.input}
                  value={draft.servings.yield ?? ""}
                  maxLength={RECIPE_RULES.shortTextLength}
                  onChange={(e) =>
                    set({ servings: { ...draft.servings, yield: e.target.value || null } })
                  }
                />
              </Field>
              <Field id="edit-difficulty" label="Difficulty" className={editor.narrow}>
                <select
                  id="edit-difficulty"
                  className={styles.select}
                  value={draft.difficulty ?? ""}
                  onChange={(e) =>
                    set({
                      difficulty: (e.target.value || null) as Difficulty | null,
                      difficultyText: null,
                    })
                  }
                >
                  <option value="">{draft.difficultyText ?? "Not set"}</option>
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {d[0]?.toUpperCase() + d.slice(1)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </fieldset>

          <SourceFields session={session} state={state} />

          <Field
            id="edit-notes"
            label="Notes"
            hint="Notes that go with the recipe. Your own signed note is on the recipe's page."
            problems={problemsFor(state.issues, "notes")}
          >
            <textarea
              {...described("edit-notes", true, problemsFor(state.issues, "notes"))}
              className={`${styles.input} ${editor.textarea}`}
              value={draft.notes}
              rows={4}
              maxLength={RECIPE_RULES.notesLength}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </Field>
        </fieldset>
      </form>

      <div className={editor.footer}>
        <button type="button" className={styles.primary} onClick={() => void done()}>
          Done
        </button>
      </div>
    </article>
  );
}

/** The editor's page: waits for the local copy, then edits the recipe (or starts a new one). */
export function RecipeEditor({ id, isNew }: { id: string; isNew: boolean }) {
  const detail = useRecipe(id);
  // What the editor starts from is fixed when it opens; later copies arrive through receive().
  const [start, setStart] = useState<{ initial: EditorState["draft"] | null } | null>(null);
  if (start === null && detail !== undefined && (detail || isNew)) {
    setStart({ initial: detail?.recipe ?? null });
  }

  if (start) {
    if (detail?.recipe.deletedAt) {
      return (
        <>
          <h1 tabIndex={-1} className={styles.recipeTitle}>
            This recipe is in Trash
          </h1>
          <p>It was moved to Trash, so it can&rsquo;t be edited.</p>
          <Link href="/">← All recipes</Link>
        </>
      );
    }
    return (
      <Editor
        key={id}
        id={id}
        initial={start.initial}
        incoming={detail?.recipe ?? null}
        isNew={isNew}
      />
    );
  }
  if (detail === undefined) {
    return (
      <p role="status" className="visually-hidden">
        Opening the recipe…
      </p>
    );
  }
  return (
    <>
      <Link href="/" className={styles.back}>
        ← All recipes
      </Link>
      <h1 tabIndex={-1} className={styles.recipeTitle}>
        This recipe isn&rsquo;t here
      </h1>
      <p>It may have been moved to Trash, or it hasn&rsquo;t reached this device yet.</p>
    </>
  );
}
