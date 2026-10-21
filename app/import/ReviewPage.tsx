import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { DuplicateMatch } from "../../shared/duplicates";
import { stillUncertain } from "../../shared/aiAnswer";
import { draftContent } from "../../shared/importDraft";
import type { ImportJobDetail, ReadAgainError } from "../../shared/importJobs";
import { addBlockedBy } from "../../shared/limits";
import { RECIPE_RULES, recipeBytes, recipeIssues } from "../../shared/recipe";
import type { SyncChange } from "../../shared/sync";
import { CategoryCombobox } from "../categories/CategoryCombobox";
import categoryStyles from "../categories/categories.module.css";
import { fileRecipeUnder, pathKey } from "../categories/tree";
import { NOTHING_LOST, TOO_LARGE_TEXT, addBlockedText } from "../limits/limitText";
import { useUsage } from "../limits/useLimits";
import { navigate } from "../navigation";
import { addPhotos, problemText } from "../photos/addPhotos";
import { currentPhotoCache } from "../photos/usePhoto";
import { Link } from "../router";
import { lineEnd } from "../recipes/editing";
import editor from "../recipes/editor.module.css";
import { Field, LinesBox, SourceFields, TimeBox } from "../recipes/editorFields";
import { described, problemsFor } from "../recipes/fieldProblems";
import { EditorSession } from "../recipes/editorSession";
import recipes from "../recipes/recipes.module.css";
import type { RecipeDetail } from "../sync/dbProtocol";
import { canEdit } from "../sync/status";
import { activeSyncClient, saveChanges, useCategoryTree, useSyncStatus } from "../sync/useSync";
import { discardImportJob, importJob, inputUrl, markImportSaved, readAgain } from "./api";
import { keepOriginals, originalHashes } from "./originals";
import styles from "./import.module.css";
import {
  createChange,
  fieldUpdates,
  fieldsToCheck,
  lineMarks,
  lineWords,
  mergeReadAgain,
  moveLineTo,
  pathNames,
  tidiedBoxes,
  updateChange,
} from "./review";
import { SourcePane } from "./SourcePane";

// The import review screen (phase E4): /import/<draft ID>. Nothing an import reads is saved
// until the person has seen it here (CLAUDE.md, "Import sources"): the page it came from beside
// the draft, what the importer wasn't sure of, quick fixes, the photos to keep, and whether it
// duplicates a recipe already in the library. Saving creates the recipe through sync, with
// where it came from.

/** The time a save is made (outside the components, which mustn't read the clock as they draw). */
const clock = () => Date.now();

/** Edits here are kept on this screen until Save: the session's "saves" only mark undo steps. */
const keepHere = () => Promise.resolve();

type Choice = { kind: "new" } | { kind: "update"; recipeId: string } | { kind: "skip" };

interface Duplicate {
  match: DuplicateMatch;
  detail: RecipeDetail;
}

const READ_AGAIN_PROBLEMS: Partial<Record<ReadAgainError | "offline", string>> = {
  monthly_limit:
    "This month’s AI imports are used up, so Fennl can’t read it again now. You can still correct it by hand.",
  paused: "Reading with AI is paused for now. Try again later, or correct it by hand.",
  inputs_gone: "The photos aren’t kept any more, so Fennl can’t read them again.",
  import_not_included: "Reading again is part of Premium.",
  offline: "Reading again needs a connection.",
};

function Review({
  job,
  onReadAgain,
}: {
  job: ImportJobDetail;
  /** "Read again" brought a new reading (phase E7). */
  onReadAgain: (job: ImportJobDetail) => void;
}) {
  const initial = useMemo(() => draftContent(job.draft), [job]);
  const [session] = useState(
    () => new EditorSession({ id: job.id, initial, save: keepHere, delayMs: 500 }),
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const marks = useMemo(() => lineMarks(job.draft, initial), [job, initial]);
  const words = useMemo(() => lineWords(job.draft), [job]);
  const toCheck = useMemo(() => fieldsToCheck(job.draft), [job]);
  const status = useSyncStatus();
  const editable = canEdit(status);
  const usage = useUsage();
  const tree = useCategoryTree();
  const me = activeSyncClient()?.userId ?? "";

  const [recipeId] = useState(() => crypto.randomUUID());
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [choice, setChoice] = useState<Choice>({ kind: "new" });
  const [paths, setPaths] = useState<string[][]>(() =>
    (job.draft.categories?.value ?? []).map(pathNames).filter((names) => names.length > 0),
  );
  const photoInputs = job.draft.photos.filter((p) => p.role === "photo").map((p) => p.input);
  const [kept, setKept] = useState<number[]>(photoInputs);
  const [cover, setCover] = useState<number | null>(photoInputs[0] ?? null);
  const [saving, setSaving] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [savedWithProblem, setSavedWithProblem] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [announce, setAnnounce] = useState("");
  const [reading, setReading] = useState(false);
  const [readProblem, setReadProblem] = useState<string | null>(null);
  const problemRef = useRef<HTMLParagraphElement>(null);

  // "This looks like a recipe you already have": checked once, against the library here.
  useEffect(() => {
    const client = activeSyncClient();
    if (!client) return;
    let live = true;
    void client
      .findDuplicates({
        title: initial.title,
        urls: [job.page.url, job.draft.externalId, initial.source.url],
        ingredients: initial.ingredients.filter((l) => !l.heading).map((l) => l.text),
      })
      .then(async (matches) => {
        const found = await Promise.all(
          matches.map(async (match) => ({ match, detail: await client.getRecipe(match.id) })),
        );
        if (live) {
          setDuplicates(found.filter((d): d is Duplicate => d.detail !== null));
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [job, initial]);

  useEffect(() => session.setMaxBytes(status.usage?.maxRecipeBytes ?? null), [session, status]);
  useEffect(() => {
    if (problem || savedWithProblem) problemRef.current?.focus();
  }, [problem, savedWithProblem]);
  const title = state.draft.title.trim();
  useEffect(() => {
    document.title = `Review ${title || "import"} · Fennl`;
  }, [title]);

  const draft = state.draft;
  const premium = status.photos?.enabled ?? false;
  const existing =
    choice.kind === "update" ? duplicates.find((d) => d.match.id === choice.recipeId) : undefined;
  const updates = existing ? fieldUpdates(existing.detail.recipe, draft) : [];
  const blocked = choice.kind === "new" && usage ? addBlockedBy(usage) : null;
  const maxBytes = status.usage?.maxRecipeBytes ?? null;
  const tooLarge = maxBytes !== null && recipeBytes(draft) > maxBytes;
  const set = session.set.bind(session);

  const tidy = async () => {
    const boxes = tidiedBoxes(session.getSnapshot().draft);
    const now = session.getSnapshot().boxes;
    if (boxes.ingredients === now.ingredients && boxes.directions === now.directions) {
      setAnnounce("Nothing to tidy.");
      return;
    }
    session.setBox("ingredients", boxes.ingredients);
    session.setBox("directions", boxes.directions);
    await session.flush();
    setAnnounce("Fractions and temperatures tidied. Undo puts them back.");
  };

  /** "Read again": the new reading, keeping whatever the person changed here. */
  const readItAgain = async () => {
    setReading(true);
    setReadProblem(null);
    const result = await readAgain(job.id);
    setReading(false);
    if ("job" in result) {
      onReadAgain({
        ...result.job,
        draft: mergeReadAgain(job.draft, session.getSnapshot().draft, result.job.draft, paths),
      });
      return;
    }
    if (result.problem === "already_read_again" || result.problem === "none_stronger") {
      const fresh = await importJob(job.id);
      if (fresh) onReadAgain(fresh);
      return;
    }
    setReadProblem(
      READ_AGAIN_PROBLEMS[result.problem] ??
        "Fennl couldn’t read it again just now. Try again in a moment.",
    );
  };

  const lineTools = (from: "ingredients" | "directions") => [
    {
      label: from === "ingredients" ? "Move to method" : "Move to ingredients",
      run: (line: number) => {
        const moved = moveLineTo(session.getSnapshot().draft, from, line);
        if (!moved) return null;
        session.setBox("ingredients", moved.ingredients);
        session.setBox("directions", moved.directions);
        void session.flush();
        setAnnounce(from === "ingredients" ? "Moved to the method." : "Moved to ingredients.");
        return line > 0 ? lineEnd(moved[from], line - 1, from) : 0;
      },
    },
  ];

  /** Photos kept, cover first: fetched through the server and added like any photo. */
  const addKeptPhotos = async (id: string, owner: string, detail: RecipeDetail | null) => {
    const wanted =
      cover !== null && kept.includes(cover) ? [cover, ...kept.filter((i) => i !== cover)] : kept;
    const cache = currentPhotoCache();
    if (!premium || wanted.length === 0 || !cache) return null;
    setSaving("Adding photos…");
    const files: File[] = [];
    let missing = 0;
    for (const input of wanted) {
      const res = await fetch(inputUrl(job.id, input)).catch(() => null);
      if (!res?.ok) {
        missing += 1;
        continue;
      }
      const blob = await res.blob();
      files.push(new File([blob], `photo-${input}`, { type: blob.type }));
    }
    const gallery = (detail?.photos ?? []).filter((p) => p.role === "photo");
    const max = status.photos?.maxPerRecipe ?? null;
    const result = await addPhotos({
      files,
      recipeId: id,
      ownerUserId: owner,
      kind: "dish",
      existingOrders: gallery.map((p) => p.sortOrder),
      room: max === null ? null : Math.max(0, max - gallery.length),
      maxFileBytes: status.photos?.maxFileBytes ?? null,
      cache,
      onProgress: (done, total) =>
        setSaving(`Adding photos (${Math.min(done + 1, total)} of ${total})…`),
    });
    if (result.problem) return problemText(result.problem, max);
    if (missing > 0) {
      return `${missing === 1 ? "One photo" : `${missing} photos`} couldn't be fetched from the page's site.`;
    }
    return null;
  };

  const save = async () => {
    setProblem(null);
    await session.flush();
    const content = session.getSnapshot().draft;
    if (recipeIssues(content, null).length > 0) {
      document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      setProblem("Fix the marked fields first.");
      return;
    }
    if (choice.kind === "skip") {
      setSaving("Discarding…");
      const ok = await discardImportJob(job.id);
      setSaving(null);
      if (ok) navigate("/import");
      else setProblem("This draft couldn't be discarded just now. Please try again.");
      return;
    }
    if (!tree) return;
    const now = clock();
    const ctx = { me, now };
    let id: string;
    let owner: string;
    let detail: RecipeDetail | null = null;
    const changes: SyncChange[] = [];
    if (choice.kind === "update" && existing) {
      detail = existing.detail;
      id = detail.recipe.id;
      owner = detail.recipe.ownerUserId;
      const change = updateChange(id, detail.recipe, content, now);
      if (change) changes.push(change);
    } else {
      id = recipeId;
      owner = me;
      changes.push(createChange(id, job, content, now));
    }
    changes.push(...fileRecipeUnder(tree, id, paths, ctx).changes);
    setSaving("Saving…");
    if (changes.length > 0 && !(await saveChanges(changes))) {
      setSaving(null);
      setProblem(
        editable
          ? "The recipe couldn't be saved just now. Please try again."
          : "Saving needs a connection. Nothing here is lost; try again when you're back online.",
      );
      return;
    }
    if (choice.kind === "update") await markImportSaved(job.id, id);
    // The photos it was read from (phase E9), kept with it out of its gallery.
    const cache = currentPhotoCache();
    let originalsKept = true;
    if (cache && originalHashes(job.draft).length > 0) {
      setSaving("Keeping the photos…");
      originalsKept = await keepOriginals({
        draft: job.draft,
        recipeId: id,
        ownerUserId: owner,
        me,
        existing: detail?.photos ?? [],
        cache,
      });
    }
    const photoProblem = await addKeptPhotos(id, owner, detail);
    setSaving(null);
    const problems = [
      originalsKept ? null : "The photos it was read from couldn't be kept with it.",
      photoProblem,
    ].filter(Boolean);
    if (problems.length > 0) {
      setSavedWithProblem({ id, text: `The recipe is saved. ${problems.join(" ")}` });
      return;
    }
    navigate(`/recipes/${id}`);
  };

  if (savedWithProblem) {
    return (
      <>
        <h1 tabIndex={-1} className={editor.heading}>
          Recipe saved
        </h1>
        <p ref={problemRef} tabIndex={-1} role="alert" className={editor.notice}>
          {savedWithProblem.text}
        </p>
        <p>
          <Link href={`/recipes/${savedWithProblem.id}`} className={recipes.primary}>
            Open the recipe
          </Link>
        </p>
      </>
    );
  }

  const saveLabel =
    choice.kind === "skip"
      ? "Don’t import"
      : choice.kind === "update"
        ? "Update recipe"
        : "Save recipe";
  const canSave =
    editable && saving === null && !blocked && !tooLarge && (choice.kind !== "update" || existing);
  const kindOf = (d: Duplicate) =>
    d.match.reason === "same_page"
      ? "imported from this page"
      : "with a similar name and ingredients";

  return (
    <article className={styles.review}>
      <Link href="/import" className={recipes.back}>
        ← Import
      </Link>
      <h1 tabIndex={-1} className={editor.heading}>
        Review the import
      </h1>
      <p className={recipes.hint}>
        Check it against the page, fix anything that&rsquo;s off, then save. Nothing is added to
        your recipes until you do.
      </p>

      <div className={editor.bar}>
        <p className={editor.status} aria-live="polite">
          {saving ?? announce}
        </p>
        <div className={editor.barButtons}>
          <button
            type="button"
            className={recipes.secondary}
            onClick={() => void session.undo()}
            disabled={!state.canUndo || saving !== null}
          >
            Undo
          </button>
          <button
            type="button"
            className={recipes.secondary}
            onClick={() => void session.redo()}
            disabled={!state.canRedo || saving !== null}
          >
            Redo
          </button>
          <button
            type="button"
            className={recipes.primary}
            onClick={() => void save()}
            disabled={!canSave}
          >
            {saveLabel}
          </button>
        </div>
      </div>

      {problem ? (
        <p ref={problemRef} tabIndex={-1} role="alert" className={editor.notice}>
          {problem}
        </p>
      ) : null}
      {!editable ? (
        <p className={editor.notice} role="status">
          Saving is paused until this device is back online. You can keep checking the draft.
        </p>
      ) : null}
      {blocked && usage ? (
        <p className={editor.notice} role="status">
          {addBlockedText(blocked, usage)} {NOTHING_LOST}
        </p>
      ) : null}
      {tooLarge ? (
        <p className={editor.notice} role="status">
          {TOO_LARGE_TEXT}
        </p>
      ) : null}

      {duplicates.length > 0 ? (
        <section className={styles.duplicates} aria-labelledby="duplicates-title">
          <h2 id="duplicates-title" className={styles.sectionTitle}>
            This looks like a recipe you already have
          </h2>
          <ul className={styles.plainList}>
            {duplicates.map((d) => (
              <li key={d.match.id}>
                <a href={`/recipes/${d.match.id}`} target="_blank" rel="noopener">
                  {d.detail.recipe.title}
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>{" "}
                <span className={recipes.hint}>({kindOf(d)})</span>
              </li>
            ))}
          </ul>
          <fieldset className={styles.choices}>
            <legend>What should happen?</legend>
            <label>
              <input
                type="radio"
                name="duplicate-choice"
                checked={choice.kind === "new"}
                onChange={() => setChoice({ kind: "new" })}
              />{" "}
              Save it as a new recipe
            </label>
            {duplicates.map((d) => (
              <label key={d.match.id}>
                <input
                  type="radio"
                  name="duplicate-choice"
                  checked={choice.kind === "update" && choice.recipeId === d.match.id}
                  onChange={() => setChoice({ kind: "update", recipeId: d.match.id })}
                />{" "}
                Update &ldquo;{d.detail.recipe.title}&rdquo; with what&rsquo;s here
              </label>
            ))}
            <label>
              <input
                type="radio"
                name="duplicate-choice"
                checked={choice.kind === "skip"}
                onChange={() => setChoice({ kind: "skip" })}
              />{" "}
              Don&rsquo;t import it
            </label>
          </fieldset>
          {existing ? (
            updates.length > 0 ? (
              <div className={styles.updates}>
                <h3 className={styles.smallTitle}>What would change</h3>
                <ul className={styles.plainList}>
                  {updates.map((u) => (
                    <li key={u.field}>
                      <strong>{u.name}:</strong> {u.before} → {u.after}
                    </li>
                  ))}
                </ul>
                <p className={recipes.hint}>
                  Everything else stays as it is, including photos and everyone&rsquo;s ratings and
                  notes.
                </p>
              </div>
            ) : (
              <p className={recipes.hint}>
                The recipe already says the same; only new categories and photos would be added.
              </p>
            )
          ) : null}
        </section>
      ) : null}

      <div className={styles.layout}>
        <SourcePane job={job} />

        <div className={styles.draft}>
          {job.ai?.canReadAgain ? (
            <section className={styles.check} aria-labelledby="read-again-title">
              <h2 id="read-again-title" className={styles.smallTitle}>
                Not quite right?
              </h2>
              <p className={styles.note}>
                Fennl can read{" "}
                {job.draft.source === "website"
                  ? "the page"
                  : job.draft.source === "text"
                    ? "the text"
                    : "the photos"}{" "}
                again, more carefully, once. Anything you&rsquo;ve already changed here is kept. It
                counts as one of this month&rsquo;s AI imports.
              </p>
              <div>
                <button
                  type="button"
                  className={recipes.secondary}
                  onClick={() => void readItAgain()}
                  disabled={reading || saving !== null}
                >
                  {reading ? "Reading again…" : "Read again more carefully"}
                </button>
              </div>
              {reading ? (
                <p role="status" className={styles.note}>
                  Reading again. This can take up to a minute.
                </p>
              ) : null}
              {readProblem ? (
                <p role="alert" className={styles.problem}>
                  {readProblem}
                </p>
              ) : null}
            </section>
          ) : job.ai && stillUncertain(job.draft) ? (
            <section className={styles.check} aria-labelledby="best-effort-title">
              <h2 id="best-effort-title" className={styles.smallTitle}>
                Fennl has read this as carefully as it can
              </h2>
              <p className={styles.note}>
                The parts marked &ldquo;Check this&rdquo; may not be right. Check them against the
                photo and correct them by hand. If the photo is blurry or dark, a clearer one may
                read better.
              </p>
            </section>
          ) : null}

          {toCheck.length > 0 || words.size > 0 || job.draft.warnings.length > 0 ? (
            <section className={styles.check} aria-labelledby="check-title">
              <h2 id="check-title" className={styles.smallTitle}>
                Worth checking
              </h2>
              <ul className={styles.plainList}>
                {toCheck.map(({ field, note }) => (
                  <li key={field}>
                    {note}: {FIELD_LABEL[field] ?? field}
                  </li>
                ))}
                {marks.size > 0 ? (
                  <li>Lines marked &ldquo;Worth a look&rdquo; in the ingredients or method</li>
                ) : null}
                {words.size > 0 ? (
                  <li>
                    Highlighted words in &ldquo;How Fennl reads it&rdquo;: Fennl couldn&rsquo;t read
                    them for certain
                  </li>
                ) : null}
                {job.draft.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <button type="button" className={recipes.secondary} onClick={() => void tidy()}>
            Tidy fractions and temperatures
          </button>

          <form onSubmit={(e) => e.preventDefault()} className={editor.fields}>
            <Field id="edit-title" label="Title" problems={problemsFor(state.issues, "title")}>
              <input
                {...described("edit-title", false, problemsFor(state.issues, "title"))}
                className={`${recipes.input} ${editor.titleInput}`}
                value={draft.title}
                maxLength={RECIPE_RULES.titleLength}
                onChange={(e) => set({ title: e.target.value })}
              />
            </Field>
            <Field
              id="edit-description"
              label="About this recipe"
              problems={problemsFor(state.issues, "description")}
            >
              <textarea
                {...described("edit-description", false, problemsFor(state.issues, "description"))}
                className={`${recipes.input} ${editor.textarea} ${editor.short}`}
                value={draft.description}
                rows={3}
                maxLength={RECIPE_RULES.descriptionLength}
                onChange={(e) => set({ description: e.target.value })}
              />
            </Field>

            <LinesBox
              session={session}
              state={state}
              list="ingredients"
              label="Ingredients"
              hint="One per line. Enter splits a line; Backspace at the start of a line joins it to the one before."
              tools={lineTools("ingredients")}
              marks={marks}
              words={words}
            />
            <LinesBox
              session={session}
              state={state}
              list="directions"
              label="Method"
              hint="One step per line. Enter splits a step; Backspace at the start of a step joins it to the one before."
              tools={lineTools("directions")}
              marks={marks}
              words={words}
            />

            <PhotoChoices
              job={job}
              inputs={photoInputs}
              premium={premium}
              kept={kept}
              setKept={setKept}
              cover={choice.kind === "update" ? null : cover}
              setCover={setCover}
            />

            <section
              className={categoryStyles.recipeCategories}
              aria-labelledby="review-categories"
            >
              <h2 id="review-categories" className={categoryStyles.sectionTitle}>
                Categories
              </h2>
              {paths.length > 0 ? (
                <ul className={categoryStyles.chips} aria-label="Categories to file it under">
                  {paths.map((names) => {
                    const path = names.join(" › ");
                    return (
                      <li key={pathKey(names)} className={categoryStyles.chip}>
                        {path}
                        <button
                          type="button"
                          className={categoryStyles.chipRemove}
                          onClick={() => {
                            setPaths(paths.filter((p) => pathKey(p) !== pathKey(names)));
                            setAnnounce(`Won't be filed under ${path}.`);
                          }}
                        >
                          <span aria-hidden="true">×</span>
                          <span className="visually-hidden">Don&rsquo;t file under {path}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {tree ? (
                <CategoryCombobox
                  tree={tree}
                  label="Add a category"
                  exclude={paths.map(pathKey)}
                  onChoose={(names) => {
                    setPaths([...paths, names]);
                    setAnnounce(`Will be filed under ${names.join(" › ")}.`);
                  }}
                />
              ) : null}
            </section>

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
                  problems={problemsFor(state.issues, "servings")}
                  className={editor.narrow}
                >
                  <input
                    {...described("edit-servings", false, problemsFor(state.issues, "servings"))}
                    className={recipes.input}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={RECIPE_RULES.maxServings}
                    value={state.boxes.servings}
                    onChange={(e) => session.setBox("servings", e.target.value)}
                    onBlur={() => session.tidyBox("servings")}
                  />
                </Field>
                <Field id="edit-yield" label="Makes">
                  <input
                    id="edit-yield"
                    className={recipes.input}
                    value={draft.servings.yield ?? ""}
                    maxLength={RECIPE_RULES.shortTextLength}
                    onChange={(e) =>
                      set({ servings: { ...draft.servings, yield: e.target.value || null } })
                    }
                  />
                </Field>
              </div>
            </fieldset>

            <SourceFields session={session} state={state} />

            <Field id="edit-notes" label="Notes" problems={problemsFor(state.issues, "notes")}>
              <textarea
                {...described("edit-notes", false, problemsFor(state.issues, "notes"))}
                className={`${recipes.input} ${editor.textarea}`}
                value={draft.notes}
                rows={4}
                maxLength={RECIPE_RULES.notesLength}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </Field>
          </form>

          <div className={editor.footer}>
            <button
              type="button"
              className={recipes.primary}
              onClick={() => void save()}
              disabled={!canSave}
            >
              {saveLabel}
            </button>
            {choice.kind !== "skip" ? (
              <button
                type="button"
                className={recipes.secondary}
                disabled={saving !== null}
                onClick={() => {
                  void discardImportJob(job.id).then((ok) => {
                    if (ok) navigate("/import");
                    else setProblem("This draft couldn't be discarded just now. Please try again.");
                  });
                }}
              >
                Discard
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

const FIELD_LABEL: Record<string, string> = {
  title: "the title",
  description: "the description",
  ingredients: "the ingredients",
  directions: "the method",
  times: "the times",
  servings: "the servings",
  source: "where it's from",
  notes: "the notes",
  difficulty: "the difficulty",
  nutrition: "the nutrition",
};

/** The page's photos: which to keep, and which is the cover. Premium only. */
function PhotoChoices({
  job,
  inputs,
  premium,
  kept,
  setKept,
  cover,
  setCover,
}: {
  job: ImportJobDetail;
  inputs: number[];
  premium: boolean;
  kept: number[];
  setKept: (kept: number[]) => void;
  /** Null: no cover to choose (photos go after the recipe's own). */
  cover: number | null;
  setCover: (input: number) => void;
}) {
  const [failed, setFailed] = useState<number[]>([]);
  if (inputs.length === 0) return null;
  if (!premium) {
    return (
      <section aria-labelledby="review-photos" className={styles.photos}>
        <h2 id="review-photos" className={styles.sectionTitle}>
          Photos
        </h2>
        <p className={recipes.hint}>
          Photos come with Premium, so this recipe is imported without the page&rsquo;s{" "}
          {inputs.length === 1 ? "photo" : `${inputs.length} photos`}.
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="review-photos" className={styles.photos}>
      <h2 id="review-photos" className={styles.sectionTitle}>
        Photos
      </h2>
      <p className={recipes.hint}>
        From the page. Kept photos are stored in your account, so the recipe doesn&rsquo;t depend on
        the site.
      </p>
      <ul className={styles.photoList}>
        {inputs.map((input, i) => {
          const keep = kept.includes(input);
          return (
            <li key={input} className={styles.photo}>
              {failed.includes(input) ? (
                <p className={recipes.hint}>
                  Photo {i + 1} couldn&rsquo;t be fetched from the page&rsquo;s site.
                </p>
              ) : (
                <img
                  src={inputUrl(job.id, input)}
                  alt={`Photo ${i + 1} from the page`}
                  loading="lazy"
                  onError={() => {
                    setFailed((all) => [...all, input]);
                    setKept(kept.filter((k) => k !== input));
                  }}
                />
              )}
              <label>
                <input
                  type="checkbox"
                  checked={keep}
                  disabled={failed.includes(input)}
                  onChange={() =>
                    setKept(keep ? kept.filter((k) => k !== input) : [...kept, input])
                  }
                />{" "}
                Keep photo {i + 1}
              </label>
              {cover !== null && inputs.length > 1 ? (
                <label>
                  <input
                    type="radio"
                    name="review-cover"
                    checked={cover === input}
                    disabled={!keep}
                    onChange={() => setCover(input)}
                  />{" "}
                  Cover
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** /import/<id>: fetches the draft, then reviews it. */
export function ReviewPage({ id }: { id: string }) {
  const [job, setJob] = useState<ImportJobDetail | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);
  const fetchJob = useCallback(
    () =>
      void importJob(id).then((found) => {
        if (found === undefined) setOffline(true);
        else setJob(found);
      }),
    [id],
  );
  useEffect(fetchJob, [fetchJob]);
  const retry = () => {
    setOffline(false);
    fetchJob();
  };

  if (offline) {
    return (
      <>
        <h1 tabIndex={-1} className={editor.heading}>
          Review the import
        </h1>
        <p>This draft is kept in your account, so it needs a connection to open.</p>
        <button type="button" className={recipes.secondary} onClick={retry}>
          Try again
        </button>
      </>
    );
  }
  if (job === undefined) {
    return (
      <p role="status" className="visually-hidden">
        Opening the draft…
      </p>
    );
  }
  if (job === null || job.status === "saved") {
    return (
      <>
        <Link href="/import" className={recipes.back}>
          ← Import
        </Link>
        <h1 tabIndex={-1} className={editor.heading}>
          {job ? "Already saved" : "This draft isn’t here"}
        </h1>
        {job?.recipeId ? (
          <p>
            It&rsquo;s saved as <Link href={`/recipes/${job.recipeId}`}>{job.title}</Link>.
          </p>
        ) : (
          <p>It may have been saved or discarded already.</p>
        )}
      </>
    );
  }
  // A new reading ("Read again") starts the screen afresh, with the person's changes kept in it.
  return <Review key={`${job.id}:${job.ai?.readAgain ?? false}`} job={job} onReadAgain={setJob} />;
}
