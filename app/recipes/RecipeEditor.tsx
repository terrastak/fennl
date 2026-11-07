import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DIFFICULTIES, RECIPE_RULES, type Difficulty, type RecipePhoto } from "../../shared/recipe";
import { addBlockedBy, type AddLimit } from "../../shared/limits";
import type { RecipeChange } from "../../shared/sync";
import { RecipeCategories } from "../categories/RecipeCategories";
import { PhotoEditor } from "../photos/PhotoEditor";
import { NOTHING_LOST, TOO_LARGE_TEXT, addBlockedText } from "../limits/limitText";
import { useUsage } from "../limits/useLimits";
import { navigate } from "../navigation";
import { WarmNote } from "../ui/WarmNote";
import { Link } from "../router";
import { canEdit } from "../sync/status";
import { activeSyncClient, saveChanges, useRecipe, useSyncStatus } from "../sync/useSync";
import editor from "./editor.module.css";
import { Field, LinesBox, SourceFields, TimeBox } from "./editorFields";
import { NutritionFields } from "./NutritionFields";
import { LaptopIcon } from "./LaptopIcon";
import { LAPTOP_ICONS } from "./laptopIcons";
import { noteTrashed } from "./trashNotice";
import { described, problemsFor } from "./fieldProblems";
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
  too_large: "Too large to save",
};

/** The dot before the saving status on a laptop (U23): beside the words, never instead of them. */
const SAVE_DOT: Record<SaveState, "saved" | "waiting" | "problem"> = {
  saved: "saved",
  saving: "waiting",
  needs_title: "waiting",
  problems: "problem",
  paused: "waiting",
  failed: "problem",
  too_large: "problem",
};

function Editor({
  id,
  initial,
  incoming,
  isNew,
  photos,
  ownerUserId,
}: {
  id: string;
  initial: EditorState["draft"] | null;
  /** The local copy as it changes (this device's saves, and changes from elsewhere). */
  incoming: EditorState["draft"] | null;
  isNew: boolean;
  /** The recipe's photos (phase D2), as they change. */
  photos: RecipePhoto[];
  /** Whose recipe it is: its photos are theirs too. */
  ownerUserId: string;
}) {
  const [session] = useState(() => new EditorSession({ id, initial, save: saveChange }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const status = useSyncStatus();
  const editable = canEdit(status);
  const maxBytes = status.usage?.maxRecipeBytes ?? null;
  const titleBox = useRef<HTMLInputElement>(null);
  const tooLargeNotice = useRef<HTMLParagraphElement>(null);
  const head = useRef<HTMLDivElement>(null);

  // On a laptop the bar's heading gets smaller once the page has scrolled (U23); the mark does
  // nothing elsewhere.
  useEffect(() => {
    const mark = () => head.current?.toggleAttribute("data-scrolled", window.scrollY > 8);
    mark();
    window.addEventListener("scroll", mark, { passive: true });
    return () => window.removeEventListener("scroll", mark);
  }, []);

  useEffect(() => session.setEditable(editable), [session, editable]);
  useEffect(() => session.setMaxBytes(maxBytes), [session, maxBytes]);
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

  /** Saves what's typed; false (and the focus on the problem) when some of it can't be saved. */
  const saveAll = async (): Promise<boolean> => {
    await session.flush();
    // Leaving would lose what can't be saved.
    if (session.getSnapshot().tooLarge) {
      tooLargeNotice.current?.focus();
      return false;
    }
    const problem = document.querySelector<HTMLElement>("[aria-invalid='true']");
    if (problem) {
      problem.focus();
      return false;
    }
    return true;
  };

  const done = async () => {
    if (!(await saveAll())) return;
    navigate(session.getSnapshot().created ? `/recipes/${id}` : "/");
  };

  // Move to Trash at the bottom (U23, owner's choice 2026-11-07): what's typed is saved first, with
  // Done's checks, so nothing typed is lost without a word (putting it back brings it all back);
  // then the recipe goes to Trash and the list says so, with Undo, as from the recipe's page (C9).
  const trash = async () => {
    if (!(await saveAll())) return;
    const changedAt = Date.now();
    const ok = await saveChanges([{ kind: "recipe", id, fields: {}, deleted: true, changedAt }]);
    if (!ok) return;
    noteTrashed(id, session.savedTitle(), changedAt);
    navigate("/");
  };

  const set = session.set.bind(session);
  const titleProblems = state.created ? problemsFor(state.issues, "title") : [];
  const servingsProblems = problemsFor(state.issues, "servings");
  const draft = state.draft;
  const saveState = editable || state.save === "saved" ? state.save : "paused";

  // On a laptop (U23) the heading, the saving status, Undo, Redo and Done are one bar that stays
  // at the top, and each section is a white box under a plain heading; the wrappers that make
  // the boxes (`head`, `box`, `groupBox`, `fieldBox`) add nothing on phones (display: contents).
  return (
    <article className={editor.editor}>
      <div className={editor.head} ref={head}>
        <h1 tabIndex={-1} className={editor.heading}>
          {initial ? "Edit recipe" : "New recipe"}
        </h1>
        <div className={editor.bar}>
          <p className={editor.status} data-editor-status aria-live="polite">
            <span className={editor.dot} data-dot={SAVE_DOT[saveState]} aria-hidden="true" />
            {SAVE_TEXT[saveState]}
          </p>
          <span className={editor.divider} aria-hidden="true" />
          <div className={editor.barButtons}>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void session.undo()}
              disabled={!editable || !state.canUndo}
            >
              <LaptopIcon path={LAPTOP_ICONS.undo} />
              Undo
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void session.redo()}
              disabled={!editable || !state.canRedo}
            >
              <LaptopIcon path={LAPTOP_ICONS.redo} />
              Redo
            </button>
            <button type="button" className={styles.primary} onClick={() => void done()}>
              <LaptopIcon path={LAPTOP_ICONS.check} />
              Done
            </button>
          </div>
        </div>
      </div>

      {!editable ? (
        <WarmNote className={editor.notice} role="status">
          Editing is paused until this device is back online. Nothing you&rsquo;ve typed is lost.
        </WarmNote>
      ) : null}
      {state.tooLarge ? (
        <WarmNote className={editor.notice} role="alert" tabIndex={-1} ref={tooLargeNotice}>
          {TOO_LARGE_TEXT}
        </WarmNote>
      ) : null}

      <form onSubmit={(e) => e.preventDefault()}>
        <fieldset className={editor.fields} disabled={!editable}>
          <div className={editor.box}>
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
          </div>

          <PhotoEditor
            recipeId={id}
            ownerUserId={ownerUserId}
            photos={photos}
            created={state.created}
          />

          <LinesBox
            session={session}
            state={state}
            list="ingredients"
            label="Ingredients"
            hint="One per line, as you'd write them."
            linkFrom={id}
            laptopLook
          />
          <LinesBox
            session={session}
            state={state}
            list="directions"
            label="Method"
            hint="One step per line; numbers are added for you."
            laptopLook
          />

          <RecipeCategories recipeId={id} disabled={!editable} inEditor />

          <fieldset className={editor.group}>
            <legend>Time and servings</legend>
            <div className={`${editor.groupBox} ${editor.timeBox}`}>
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
            </div>
          </fieldset>

          <SourceFields session={session} state={state} />

          <Field
            id="edit-notes"
            label="Notes"
            // "notes" since U7: there can be several (owner's choice 2026-11-07, every screen).
            hint="Notes that go with the recipe. Your own signed notes are on the recipe's page."
            problems={problemsFor(state.issues, "notes")}
            boxed
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

          <NutritionFields session={session} state={state} />
        </fieldset>
      </form>

      {/* No second Done: the bar with Done stays in view at the top. Move to Trash at the very
          bottom (U23, owner's choice 2026-11-07, every screen); not for a new recipe that has no
          title yet, so nothing was saved. */}
      {state.created ? (
        <div className={editor.trashFoot}>
          <button
            type="button"
            className={editor.trashButton}
            disabled={!editable}
            onClick={() => void trash()}
          >
            <LaptopIcon path={LAPTOP_ICONS.trash} />
            Move to Trash
          </button>
          <p className={editor.trashHint}>It stays in Trash for 30 days, so you can put it back.</p>
        </div>
      ) : null}
    </article>
  );
}

/** The editor's page: waits for the local copy, then edits the recipe (or starts a new one). */
export function RecipeEditor({ id, isNew }: { id: string; isNew: boolean }) {
  const detail = useRecipe(id);
  const usage = useUsage();
  // What the editor starts from is fixed when it opens; later copies arrive through receive().
  // So is whether a new recipe can be added (phase C11): saving it mustn't close the editor.
  const [start, setStart] = useState<{
    initial: EditorState["draft"] | null;
    blocked: AddLimit | null;
  } | null>(null);
  if (start === null && detail !== undefined && (detail || isNew)) {
    setStart({
      initial: detail?.recipe ?? null,
      blocked: !detail && usage ? addBlockedBy(usage) : null,
    });
  }

  if (start?.blocked && usage) {
    return (
      <>
        <Link href="/" className={styles.back}>
          ← All recipes
        </Link>
        <h1 tabIndex={-1} className={styles.recipeTitle}>
          No room for a new recipe
        </h1>
        <p>
          {addBlockedText(start.blocked, usage)} {NOTHING_LOST}
        </p>
        <p>
          <Link href="/account#usage">Usage and limits</Link> · <Link href="/trash">Trash</Link>
        </p>
      </>
    );
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
        photos={detail?.photos ?? []}
        ownerUserId={detail?.recipe.ownerUserId ?? activeSyncClient()?.userId ?? ""}
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
