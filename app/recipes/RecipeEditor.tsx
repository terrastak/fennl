import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { DIFFICULTIES, RECIPE_RULES, type Difficulty, type RecipePhoto } from "../../shared/recipe";
import { partsText, type DraftPart } from "../../shared/drafts";
import { addBlockedBy, type AddLimit } from "../../shared/limits";
import { RecipeCategories } from "../categories/RecipeCategories";
import { PhotoEditor } from "../photos/PhotoEditor";
import { NOTHING_LOST, TOO_LARGE_TEXT, addBlockedText } from "../limits/limitText";
import { reportRefused } from "../limits/reportRefused";
import { useUsage } from "../limits/useLimits";
import { navigate } from "../navigation";
import { WarmNote } from "../ui/WarmNote";
import { Link } from "../router";
import type { LocalDraft } from "../sync/dbProtocol";
import { canEdit } from "../sync/status";
import { activeSyncClient, saveChanges, useDraft, useRecipe, useSyncStatus } from "../sync/useSync";
import editor from "./editor.module.css";
import {
  Field,
  LinesBox,
  LinesHint,
  ServesOrMakesBox,
  SourceFields,
  TimeBox,
} from "./editorFields";
import { NutritionFields } from "./NutritionFields";
import { LaptopIcon } from "./LaptopIcon";
import { LAPTOP_ICONS } from "./laptopIcons";
import { noteTrashed } from "./trashNotice";
import { usePointer } from "./usePointer";
import { described, problemsFor } from "./fieldProblems";
import { EditorSession, type DraftWrite, type SavedState } from "./editorSession";
import { EditorQuestion } from "./drafts/EditorQuestion";
import { draftStatus } from "./drafts/draftStatus";
import { applyDraft, partnerChanges, savedState, type PartnerChange } from "./drafts/finish";
import styles from "./recipes.module.css";

// The recipe editor (phase C6): /recipes/<id>/edit, or /recipes/<new id>/edit?new for a new
// recipe. Since U27 part 3 (owner's choices 2026-11-21 and 22) everything typed or changed here
// (words, photos, categories) is kept as the person's draft about a second after typing stops,
// in their account; the recipe box changes only at Done, and Discard changes throws the draft
// away (editorSession.ts has the rules, drafts/finish.ts what Done does). Leaving keeps the
// draft. Ingredients and directions are one text box each (CLAUDE.md, "Data model rules"), with a
// preview of how each line was read, a heading button and a link button (a line can link to
// another recipe). Alt+↑ / Alt+↓ reorders a line.

/**
 * Keeps the editor's draft on this device and in the account (null: removes it). `version` is
 * the version of the draft the editor shows (0: none yet), updated as it writes; a newer one
 * from another device is never removed (the editor then shows that one).
 */
async function keepDraft(
  recipeId: string,
  ownerUserId: string,
  isNew: boolean,
  write: DraftWrite | null,
  version: { current: number },
): Promise<void> {
  const client = activeSyncClient();
  if (!client) throw new Error("Not connected yet.");
  if (write === null) {
    if (await client.discardDraft(recipeId, version.current)) version.current = 0;
  } else {
    version.current = await client.saveDraft({ recipeId, ownerUserId, isNew, ...write });
  }
}

/** A question waiting under a bar button: Discard's, or Done's when a partner changed a part. */
type Asking =
  | { kind: "discard" }
  | {
      kind: "partner";
      partners: PartnerChange[];
      /** null: closed without an answer; `focusBack` false when the focus went elsewhere. */
      answer: (choice: "mine" | "theirs" | null, focusBack?: boolean) => void;
    };

function Editor({
  id,
  saved,
  existing,
  incoming,
  photos,
  ownerUserId,
  onNewer,
}: {
  id: string;
  /** The recipe box's version when the editor opened, or null for a new recipe. */
  saved: SavedState | null;
  /** The person's draft of it, kept earlier. */
  existing: LocalDraft | null;
  /** The recipe box's version as it changes (another device, a partner). */
  incoming: SavedState | null;
  /** The saved recipe's photos (phase D2), as they change. */
  photos: RecipePhoto[];
  /** Whose recipe it is: its photos are theirs too. */
  ownerUserId: string;
  /** A newer version of the draft arrived from another device: show that one instead. */
  onNewer: (draft: LocalDraft) => void;
}) {
  const isNew = saved === null;
  // The version of the draft this editor shows (0: none), so Done and Discard act on it only.
  const [version] = useState(() => ({ current: existing?.version ?? 0 }));
  const [session] = useState(
    () =>
      new EditorSession({
        id,
        initial: null,
        draft: {
          saved,
          existing: existing ? { data: existing.data, startedAt: existing.startedAt } : null,
          keep: (write) => keepDraft(id, ownerUserId, isNew, write, version),
        },
      }),
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  // Always set in draft mode; the fallback only satisfies the type.
  const drafting = state.drafting ?? {
    isNew,
    parts: [],
    photos: [],
    arranged: false,
    categories: [],
    save: "unchanged" as const,
  };
  const status = useSyncStatus();
  const stored = useDraft(id);
  const usage = useUsage();
  const editable = canEdit(status);
  const maxBytes = status.usage?.maxRecipeBytes ?? null;
  const titleBox = useRef<HTMLInputElement>(null);
  const tooLargeNotice = useRef<HTMLParagraphElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const discardButton = useRef<HTMLButtonElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);
  const laptop = usePointer();
  // "How Fennl reads it" under the boxes, on a laptop (U27): off until asked for.
  const [reads, setReads] = useState(false);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [finishing, setFinishing] = useState(false);
  // A new recipe's missing title is marked once Done has been pressed.
  const [tried, setTried] = useState(false);
  // Done on a new recipe with no room under the plan (phase C11): the draft stays.
  const [blocked, setBlocked] = useState<AddLimit | null>(null);

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
    if (incoming) session.receiveSaved(incoming);
  }, [session, incoming]);

  // Keep what's waiting when leaving the editor, or when the page is hidden or closed.
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
    if (!isNew || existing) return;
    const frame = requestAnimationFrame(() => titleBox.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isNew, existing]);

  const title = state.draft.title.trim();
  useEffect(() => {
    document.title = `${title ? `Editing ${title}` : "New recipe"} · Fennl`;
  }, [title]);

  const noConnection = status.phase === "offline" || status.phase === "waiting";
  const drafted = draftStatus({
    save: drafting.save,
    parts: drafting.parts.length,
    isNew,
    editable,
    offlineEnabled: status.offlineEnabled,
    noConnection: status.offlineEnabled ? status.phase === "offline" : noConnection,
    // Until the device's copy is read, what the editor opened with.
    inAccount: (stored === undefined ? existing : stored)?.inAccount ?? null,
    refused: Boolean(stored?.problem),
  });
  // Over the plan's per-recipe size (phase C11): the draft is kept, but Done can't apply it.
  const words = state.tooLarge ? { text: "Too large to save", dot: "problem" as const } : drafted;
  const unchanged = drafting.parts.length === 0 && drafting.save === "unchanged";
  // Free with no connection: Done waits for it (the draft can't reach the account).
  const doneWaits = drafted.dot === "stopped";

  // Another device kept a newer version of this draft (the newest edit wins): once nothing here
  // is waiting to be kept, the editor shows that one.
  const idle = drafting.save === "kept" || drafting.save === "unchanged";
  useEffect(() => {
    if (!stored?.fromServer || stored.version === version.current) return;
    if (!idle || finishing || asking) return;
    onNewer(stored);
  }, [stored, idle, finishing, asking, onNewer, version]);

  const leave = () => navigate(isNew ? "/" : `/recipes/${id}`);

  /** Asks about a partner's changes to the same parts; null when the question is closed. */
  const askPartner = (partners: PartnerChange[]) =>
    new Promise<"mine" | "theirs" | null>((resolve) => {
      setAsking({
        kind: "partner",
        partners,
        answer: (choice, focusBack = true) => {
          setAsking(null);
          if (choice === null && focusBack) doneButton.current?.focus();
          resolve(choice);
        },
      });
    });

  // Done: the draft goes into the recipe box, with the editor's checks first. Nothing changed:
  // Done simply closes.
  const done = async () => {
    if (finishing) return;
    setAsking(null);
    await session.flush();
    const now = session.getSnapshot();
    if (!now.drafting || now.drafting.parts.length === 0) {
      session.close();
      leave();
      return;
    }
    if (now.tooLarge) {
      tooLargeNotice.current?.focus();
      return;
    }
    if (now.issues.length > 0) {
      flushSync(() => setTried(true));
      document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    const limit = isNew && usage ? addBlockedBy(usage) : null;
    setBlocked(limit);
    if (limit) {
      reportRefused(limit, "recipe");
      return;
    }
    const client = activeSyncClient();
    if (!client) return;
    setFinishing(true);
    try {
      // The recipe box as fresh as it can be, so a partner's change is known.
      if (status.phase !== "offline" && navigator.onLine) await client.syncNow().catch(() => {});
      const { data, startedAt } = session.draftNow();
      const partners = isNew ? [] : await partnerChanges(client, id, data, startedAt);
      const skip = new Set<DraftPart>();
      if (partners.length > 0) {
        const choice = await askPartner(partners);
        if (choice === null) return;
        if (choice === "theirs")
          for (const p of partners) p.parts.forEach((part) => skip.add(part));
      }
      const result = await applyDraft({
        client,
        recipeId: id,
        data,
        startedAt,
        skip,
        isNew,
        version: version.current,
      });
      // In Trash meanwhile: the page says so and nothing was sent. A newer draft from another
      // device: the editor shows it (above), and Done waits to be pressed again.
      if (result !== "applied") return;
      session.close();
      navigate(`/recipes/${id}`);
    } catch (error) {
      console.error("Couldn't apply the draft", error);
    } finally {
      setFinishing(false);
    }
  };

  // Discard changes, once asked: back to the saved recipe (the editor stays on it), or, for a
  // new recipe, back to the list.
  const discard = async () => {
    setAsking(null);
    await session.discard();
    if (isNew) {
      session.close();
      navigate("/");
      return;
    }
    setTried(false);
    setBlocked(null);
    headingRef.current?.focus();
  };

  // Move to Trash (in the bar on a laptop, at the bottom elsewhere): the saved recipe goes to
  // Trash, its draft with it (owner's choice 2026-11-21), and the list says so, with Undo, as
  // from the recipe's page (C9).
  const trash = async () => {
    const changedAt = Date.now();
    const ok = await saveChanges([{ kind: "recipe", id, fields: {}, deleted: true, changedAt }]);
    if (!ok) return;
    session.close();
    noteTrashed(id, session.savedTitle(), changedAt);
    navigate("/");
  };

  const set = session.set.bind(session);
  const titleProblems = !isNew || tried ? problemsFor(state.issues, "title") : [];
  const draft = state.draft;

  // The parts both looks share; only where they go differs.
  const heading = (
    <h1 tabIndex={-1} className={editor.heading} ref={headingRef}>
      {isNew ? "New recipe" : "Edit recipe"}
    </h1>
  );
  const saveStatus = (
    <p className={editor.status} data-editor-status data-state={words.dot} aria-live="polite">
      <span className={editor.dot} data-dot={words.dot} aria-hidden="true" />
      {/* "Draft saved · 3 changes": the dot between the words lighter, evenly spaced. */}
      {words.text.split(" · ").map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <span className={editor.statusSep} aria-hidden="true">
              {" · "}
            </span>
          ) : null}
          <span>{part}</span>
        </Fragment>
      ))}
    </p>
  );
  const undoButtons = (
    <>
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
    </>
  );
  // Not for a new recipe: there's nothing in the recipe box to move.
  const trashButton = isNew ? null : (
    <button
      type="button"
      className={editor.trashButton}
      disabled={!editable}
      onClick={() => void trash()}
    >
      <LaptopIcon path={LAPTOP_ICONS.trash} />
      Move to Trash
    </button>
  );
  const discardQuestion =
    asking?.kind === "discard" ? (
      <EditorQuestion
        tone="danger"
        question={isNew ? "Discard this new recipe?" : "Discard your changes?"}
        note={
          isNew ? "It won’t be added to your recipes." : "The recipe goes back to how it was saved."
        }
        onEscape={() => {
          setAsking(null);
          discardButton.current?.focus();
        }}
        onDismiss={() => setAsking(null)}
      >
        <button type="button" className={editor.softRed} autoFocus onClick={() => void discard()}>
          Discard
        </button>
        <button
          type="button"
          className={editor.plain}
          onClick={() => {
            setAsking(null);
            discardButton.current?.focus();
          }}
        >
          Cancel
        </button>
      </EditorQuestion>
    ) : null;
  const partnerQuestion =
    asking?.kind === "partner" ? (
      <EditorQuestion
        tone="warm"
        question={asking.partners
          .map(
            (p) =>
              `${p.name} also changed ${partsText(p.parts, "sentence")} while you were editing.`,
          )
          .join(" ")}
        onEscape={() => asking.answer(null)}
        onDismiss={() => asking.answer(null, false)}
      >
        <button
          type="button"
          className={editor.ink}
          autoFocus
          onClick={() => asking.answer("mine")}
        >
          Use mine
        </button>
        <button type="button" className={editor.plain} onClick={() => asking.answer("theirs")}>
          {asking.partners.length === 1 ? `Keep ${asking.partners[0]?.name}’s` : "Keep theirs"}
        </button>
      </EditorQuestion>
    ) : null;
  const discardButtonEl = (
    <button
      ref={discardButton}
      type="button"
      className={styles.secondary}
      aria-expanded={asking?.kind === "discard"}
      disabled={unchanged || finishing}
      onClick={() => setAsking(asking?.kind === "discard" ? null : { kind: "discard" })}
    >
      <LaptopIcon path={LAPTOP_ICONS.discard} />
      Discard changes
    </button>
  );
  const notices = (
    <>
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
      {blocked && usage ? (
        <WarmNote className={editor.notice} role="alert">
          {addBlockedText(blocked, usage)} {NOTHING_LOST}{" "}
          <Link href="/account#usage">Usage and limits</Link>
        </WarmNote>
      ) : null}
    </>
  );
  const titleField = (
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
  );
  const aboutField = (
    <Field
      id="edit-description"
      label="About this recipe"
      hint="A line or two shown under the title."
      problems={problemsFor(state.issues, "description")}
      className={editor.aboutField}
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
  );
  const photoEditor = (
    <PhotoEditor
      recipeId={id}
      ownerUserId={ownerUserId}
      photos={photos}
      created
      compact={laptop}
      draft={{
        photos: drafting.photos,
        arranged: drafting.arranged,
        onSet: (list, arranged) => session.setPhotos(list, arranged),
        onAdd: (photo) => session.addPhoto(photo),
      }}
    />
  );
  const times = (
    <fieldset className={editor.group}>
      <legend>Time and servings</legend>
      <div className={`${editor.groupBox} ${editor.timeBox}`}>
        <div className={editor.row}>
          <TimeBox session={session} state={state} which="prep" label="Prep time" />
          <TimeBox session={session} state={state} which="cook" label="Cook time" />
          <TimeBox session={session} state={state} which="total" label="Total time" />
        </div>
        <div className={editor.row}>
          <ServesOrMakesBox session={session} state={state} className={editor.servesField} />
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
  );
  const categories = (
    <RecipeCategories
      recipeId={id}
      disabled={!editable}
      inEditor
      compact={laptop}
      draft={{ paths: drafting.categories, onChange: (paths) => session.setCategories(paths) }}
    />
  );
  // No hint (U27, owner's choice 2026-11-21: fewer words).
  const notes = (
    <Field id="edit-notes" label="Notes" problems={problemsFor(state.issues, "notes")} boxed>
      <textarea
        {...described("edit-notes", false, problemsFor(state.issues, "notes"))}
        className={`${styles.input} ${editor.textarea}`}
        value={draft.notes}
        rows={4}
        maxLength={RECIPE_RULES.notesLength}
        onChange={(e) => set({ notes: e.target.value })}
      />
    </Field>
  );

  if (laptop) {
    // On a laptop (U27, owner's choices 2026-11-21, the mockup "C3"): a slim bar (the heading,
    // how saving is going beside it, then Move to Trash, Undo and Redo, and Done as the one ink
    // button), and the recipe in paired rows up to 1280px wide, centred in a big window: title,
    // about, time and servings beside the photos; Ingredients beside Directions, how Fennl reads
    // each line in the boxes' margins; categories and notes beside where it's from and
    // nutrition. No white frames: only the boxes you type in are white.
    return (
      <article className={`${editor.editor} ${editor.columns}`}>
        <div className={editor.head} ref={head}>
          {heading}
          {saveStatus}
          <div className={editor.barButtons}>
            {trashButton}
            {trashButton ? <span className={editor.divider} aria-hidden="true" /> : null}
            {undoButtons}
            <span className={editor.divider} aria-hidden="true" />
            <span className={editor.askWrap}>
              {discardButtonEl}
              {discardQuestion}
            </span>
            <span className={editor.askWrap}>
              <button
                ref={doneButton}
                type="button"
                className={editor.done}
                disabled={doneWaits || finishing}
                onClick={() => void done()}
              >
                Done
              </button>
              {partnerQuestion}
            </span>
          </div>
        </div>

        {notices}

        <form onSubmit={(e) => e.preventDefault()}>
          <fieldset className={editor.fields} disabled={!editable}>
            <div className={editor.topRow}>
              <div className={editor.basics}>
                {titleField}
                {aboutField}
                {times}
              </div>
              {photoEditor}
            </div>

            <div className={editor.linesRow} data-reads={reads ? "" : undefined}>
              <LinesBox
                session={session}
                state={state}
                list="ingredients"
                label="Ingredients"
                linkFrom={id}
                laptopLook
                margins
                reads={reads}
              />
              <LinesBox
                session={session}
                state={state}
                list="directions"
                label="Directions"
                linkFrom={id}
                laptopLook
                margins
                reads={reads}
                describedBy="edit-lines-hint"
                footer={<LinesHint id="edit-lines-hint" reads={reads} onReads={setReads} />}
              />
            </div>

            <div className={editor.bottomRow}>
              <div className={editor.stack}>
                {categories}
                {notes}
              </div>
              <div className={editor.stack}>
                <SourceFields session={session} state={state} />
                <NutritionFields session={session} state={state} />
              </div>
            </div>
          </fieldset>
        </form>
      </article>
    );
  }

  // Phones, touch screens and narrow windows: one column, the bar's buttons under the heading,
  // and Move to Trash at the bottom. On a laptop before U27 (U23) this was one bar and white
  // boxes; the wrappers that made them (`head`, `box`, `groupBox`, `fieldBox`) add nothing here
  // (display: contents).
  return (
    <article className={editor.editor}>
      <div className={editor.head} ref={head}>
        {heading}
        <div className={editor.bar}>
          {saveStatus}
          <span className={editor.divider} aria-hidden="true" />
          <div className={editor.barButtons}>{undoButtons}</div>
          <div className={`${editor.barButtons} ${editor.finishButtons}`}>
            {discardButtonEl}
            <button
              ref={doneButton}
              type="button"
              className={styles.primary}
              disabled={doneWaits || finishing}
              onClick={() => void done()}
            >
              Done
            </button>
          </div>
          {discardQuestion}
          {partnerQuestion}
        </div>
      </div>

      {notices}

      <form onSubmit={(e) => e.preventDefault()}>
        <fieldset className={editor.fields} disabled={!editable}>
          <div className={editor.box}>
            {titleField}
            {aboutField}
          </div>

          {photoEditor}

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
            label="Directions"
            hint="One step per line; step numbers are added for you."
            linkFrom={id}
            laptopLook
          />

          {categories}

          {times}

          <SourceFields session={session} state={state} />

          {notes}

          <NutritionFields session={session} state={state} />
        </fieldset>
      </form>

      {/* No second Done: the bar with Done stays in view at the top. Move to Trash at the very
          bottom (U23, owner's choice 2026-11-07). */}
      {trashButton ? <div className={editor.trashFoot}>{trashButton}</div> : null}
    </article>
  );
}

/**
 * The editor's page: waits for the local copy and the person's draft, then edits the recipe (or
 * starts a new one, or carries on a new recipe's draft).
 */
export function RecipeEditor({ id, isNew }: { id: string; isNew: boolean }) {
  const detail = useRecipe(id);
  const stored = useDraft(id);
  const usage = useUsage();
  // What the editor starts from is fixed when it opens; later copies arrive through
  // receiveSaved(). So is whether a new recipe can be started (phase C11).
  const [start, setStart] = useState<{
    saved: SavedState | null;
    existing: LocalDraft | null;
    blocked: AddLimit | null;
  } | null>(null);
  if (
    start === null &&
    detail !== undefined &&
    stored !== undefined &&
    (detail || isNew || stored)
  ) {
    setStart({
      saved: detail ? savedState(detail) : null,
      existing: stored,
      blocked: !detail && !stored && usage ? addBlockedBy(usage) : null,
    });
  }
  // A newer version of the draft from another device: the editor opens again on it.
  const [generation, setGeneration] = useState(0);
  const onNewer = useCallback((draft: LocalDraft) => {
    setStart((now) => now && { ...now, existing: draft });
    setGeneration((n) => n + 1);
  }, []);
  const incoming = detail && !detail.recipe.deletedAt ? savedState(detail) : null;
  const [latest, setLatest] = useState<SavedState | null>(null);
  // The same version again isn't news (a new object each time the local copy is read).
  if (incoming && JSON.stringify(incoming) !== JSON.stringify(latest)) setLatest(incoming);

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
        key={`${id}:${generation}`}
        id={id}
        onNewer={onNewer}
        saved={start.saved}
        existing={start.existing}
        incoming={latest}
        photos={detail?.photos ?? []}
        ownerUserId={
          detail?.recipe.ownerUserId ??
          start.existing?.ownerUserId ??
          activeSyncClient()?.userId ??
          ""
        }
      />
    );
  }
  if (detail === undefined || stored === undefined) {
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
