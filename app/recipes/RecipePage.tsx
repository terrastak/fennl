import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  NUTRIENTS,
  RECIPE_RULES,
  type DirectionStep,
  type IngredientLine,
  type Nutrient,
  type NutritionSource,
  type Recipe,
} from "../../shared/recipe";
import { bakeNote, namesAPan, panName } from "../../shared/pans";
import { scaledServings, showIngredient, showStep } from "../../shared/scale";
import type { OpinionChange, SyncChange } from "../../shared/sync";
import { NOTHING_LOST, restoreBlockedText } from "../limits/limitText";
import { useAddBlocked, useUsage } from "../limits/useLimits";
import { navigate } from "../navigation";
import { Link } from "../router";
import type { Member, RecipeDetail } from "../sync/dbProtocol";
import { Gallery, Originals } from "../photos/Gallery";
import { usePainting } from "../photos/painting";
import { canEdit } from "../sync/status";
import { activeSyncClient, useRecipe, useSyncStatus } from "../sync/useSync";
import { PrintCopy } from "../print/PrintCopy";
import { EarlierVersion } from "./EarlierVersion";
import { useHideNutrition } from "./nutritionSetting";
import { Suggestion } from "./PanControls";
import { SubRecipe } from "./SubRecipe";
import { Adjust, ScaleStatus, ScaledLine, ServesStepper, ShownText } from "./ScaleControls";
import { AS_WRITTEN, scaleNote, useScaling, type Scaling } from "./scaling";
import { noteTrashed } from "./trashNotice";
import {
  dayText,
  firstName,
  lastMade,
  localDay,
  namesText,
  servingsFacts,
  sourceCredit,
  stars,
  timeText,
  trashText,
} from "./format";
import styles from "./recipes.module.css";

// A recipe, laid out for reading (phase C5). Everyone's ratings, favorites and signed notes show
// only when someone has given one (CLAUDE.md, "Recipe ownership in households"), and "Last made"
// is shared by the household, with a "Made it" button. Your own rating, favorite and note are
// set in "Yours" (phase C6), and "Edit recipe" opens the editor.

async function save(change: SyncChange): Promise<boolean> {
  try {
    await activeSyncClient()?.save(change);
    return true;
  } catch {
    return false;
  }
}

const NUTRIENT_NAMES: Record<Nutrient, string> = {
  calories: "Calories",
  fat: "Fat",
  saturatedFat: "Saturated fat",
  carbohydrates: "Carbohydrates",
  fiber: "Fiber",
  sugar: "Sugar",
  protein: "Protein",
  sodium: "Sodium",
  cholesterol: "Cholesterol",
};

const NUTRITION_FROM: Record<NutritionSource, string> = {
  manual: "Entered by hand.",
  paprika: "From Paprika.",
  website: "From the recipe's website.",
  ai: "Read from the recipe by AI; check before relying on it.",
};

const WIDE = "(min-width: 900px)";

/** Whether the screen is wide enough for the sidebar layout (where the painting shows). */
function useWide(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/**
 * The painting of the cover behind the top of the page, on wide screens only (owner's choice
 * 2026-10-24: on a phone the photo itself fades into the page instead). It fades out gently, so
 * there's no edge where it ends.
 */
function Painting({ hash }: { hash: string }) {
  const wide = useWide();
  const url = usePainting(wide ? hash : null);
  if (!url) return null;
  return (
    <div className={styles.painting} aria-hidden="true">
      <img src={url} alt="" />
    </div>
  );
}

/** Lines grouped under their headings (a list may start without one). */
function sections<T extends IngredientLine | DirectionStep>(lines: T[]) {
  const groups: { heading: string | null; key: string; items: T[] }[] = [];
  for (const line of lines) {
    if (line.heading) groups.push({ heading: line.text, key: line.id, items: [] });
    else {
      const last = groups[groups.length - 1];
      if (last) last.items.push(line);
      else groups.push({ heading: null, key: "start", items: [line] });
    }
  }
  return groups;
}

function Facts({ recipe, scaling }: { recipe: Recipe; scaling: Scaling }) {
  const scaled = scaledServings(recipe.servings, scaling.factor);
  // Scaled for another pan: words naming the recipe's pan ("one 9-inch cake") give way to yours.
  const yourPan =
    scaling.pans && recipe.servings.yield && namesAPan(recipe.servings.yield)
      ? panName(scaling.pans.yours)
      : null;
  const servings = yourPan ? { ...scaled, yield: null } : scaled;
  const facts = [
    ["Prep", timeText(recipe.times.prep)],
    ["Cook", timeText(recipe.times.cook)],
    ["Total", timeText(recipe.times.total)],
    ...servingsFacts(servings).map(({ label, value }) => [label, value]),
    ["Pan", yourPan ? `Your ${yourPan}` : null],
    [
      "Difficulty",
      recipe.difficultyText ??
        (recipe.difficulty
          ? recipe.difficulty[0]?.toUpperCase() + recipe.difficulty.slice(1)
          : null),
    ],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]));
  if (facts.length === 0) return null;
  return (
    <dl className={styles.facts}>
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            {["Serves", "Makes", "Pan"].includes(label) && servings !== recipe.servings ? (
              <ShownText line={{ pieces: [{ text: value, changed: true }], changed: true }} />
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Where the recipe came from, linked to its own page when Fennl knows it (owner's choices 2026-10-25). */
function SourceLink({ recipe }: { recipe: Recipe }) {
  const credit = sourceCredit(recipe.source);
  if (!credit) return null;
  return credit.url ? (
    <a className={styles.source} href={credit.url} target="_blank" rel="noreferrer noopener">
      {credit.text}
      <span aria-hidden="true"> ↗</span>
      <span className="visually-hidden"> (the recipe&rsquo;s page)</span>
    </a>
  ) : (
    <span className={styles.source}>{credit.text}</span>
  );
}

/**
 * The line under the title (owner's choices 2026-10-25): your stars and heart, set right there,
 * the household's stars and favorites, who added it, and where it came from.
 */
function Meta({ detail, name, shared, me, editable }: Props & { me: string; editable: boolean }) {
  const recipeId = detail.recipe.id;
  const mine = detail.opinions.find((o) => o.userId === me);
  const stored = { rating: mine?.rating ?? null, favorite: mine?.favorite ?? false };
  // Shown straight away when changed here; the local copy catches up a moment later.
  const [shown, setShown] = useState(stored);
  const [last, setLast] = useState(stored);
  if (stored.rating !== last.rating || stored.favorite !== last.favorite) {
    setLast(stored);
    setShown(stored);
  }
  const rating = shown.rating;
  const choose = (fields: { rating?: number | null; favorite?: boolean }) => {
    setShown({ ...shown, ...fields });
    void saveOpinion(recipeId, fields);
  };
  const others = detail.opinions.filter((o) => o.userId !== me);
  const rated = others.filter((o) => o.rating !== null);
  const favorites = others.filter((o) => o.favorite).map((o) => name(o.userId));

  return (
    <div className={styles.meta}>
      <fieldset className={styles.rating} disabled={!editable}>
        <legend className="visually-hidden">Your rating</legend>
        <div className={styles.ratingStars}>
          {RATINGS.map((n) => (
            <label
              key={n}
              className={n <= (rating ?? 0) ? styles.starOn : styles.starOff}
              title={`${n} ${n === 1 ? "star" : "stars"}`}
            >
              <input
                type="radio"
                name="rating"
                className="visually-hidden"
                checked={rating === n}
                onChange={() => choose({ rating: n })}
                // The star already chosen, chosen again: no rating.
                onClick={() => {
                  if (rating === n) choose({ rating: null });
                }}
              />
              <span aria-hidden="true">★</span>
              <span className="visually-hidden">
                {n} {n === 1 ? "star" : "stars"}
              </span>
            </label>
          ))}
          <label className={styles.noRating}>
            <input
              type="radio"
              name="rating"
              className="visually-hidden"
              checked={rating === null}
              onChange={() => choose({ rating: null })}
            />
            No rating
          </label>
        </div>
      </fieldset>
      <label className={styles.heart} title="A favorite of mine">
        <input
          type="checkbox"
          className="visually-hidden"
          checked={shown.favorite}
          disabled={!editable}
          onChange={(e) => choose({ favorite: e.target.checked })}
        />
        <span aria-hidden="true">{shown.favorite ? "♥" : "♡"}</span>
        <span className="visually-hidden">A favorite of mine</span>
      </label>
      {rated.map((o) => (
        <span key={o.userId} className={styles.metaItem}>
          <span className={styles.stars} aria-hidden="true">
            {stars(o.rating ?? 0)}
          </span>
          <span className="visually-hidden">{o.rating} out of 5 stars from</span> {name(o.userId)}
        </span>
      ))}
      {favorites.length > 0 ? (
        <span className={styles.metaItem}>
          <span aria-hidden="true">♥ </span>
          {shared ? `A favorite of ${namesText(favorites)}` : "A favorite"}
        </span>
      ) : null}
      {shared ? (
        <span className={styles.metaItem}>Added by {name(detail.recipe.ownerUserId)}</span>
      ) : null}
      <SourceLink recipe={detail.recipe} />
    </div>
  );
}

/**
 * The recipe's introduction, a few lines of it with More for the rest (owner's choice
 * 2026-10-25); a short one takes only the room it needs.
 */
function Headnote({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const observer = new ResizeObserver(() => setLong(el.scrollHeight > el.clientHeight + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, open]);
  return (
    <>
      <p
        ref={ref}
        id="recipe-headnote"
        className={`${styles.headnote} ${open ? "" : styles.clamped}`}
      >
        {text}
      </p>
      {long ? (
        <button
          type="button"
          className={styles.more}
          aria-expanded={open}
          aria-controls="recipe-headnote"
          onClick={() => setOpen(!open)}
        >
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </>
  );
}

function MadeIt({ detail, name, shared, me, editable }: Props & { me: string; editable: boolean }) {
  const today = localDay();
  const last = lastMade(detail.made);
  const mine = detail.made.find((m) => m.userId === me && m.madeOn === today);
  const recipeId = detail.recipe.id;

  const madeIt = () =>
    void save({
      kind: "made",
      id: crypto.randomUUID(),
      recipeId,
      madeOn: today,
      changedAt: Date.now(),
    });
  const undo = () =>
    mine &&
    void save({
      kind: "made",
      id: mine.id,
      recipeId,
      madeOn: mine.madeOn,
      deleted: true,
      changedAt: Date.now(),
    });

  const when = last ? (last.madeOn === today ? "today" : dayText(last.madeOn)) : null;
  return (
    <div className={styles.made}>
      {mine ? (
        <button type="button" className={styles.secondary} onClick={undo} disabled={!editable}>
          Undo &ldquo;made it&rdquo;
        </button>
      ) : (
        <button type="button" className={styles.secondary} onClick={madeIt} disabled={!editable}>
          Made it today
        </button>
      )}
      <p role="status">
        {last ? `Last made ${when}${shared ? ` by ${name(last.userId)}` : ""}` : ""}
      </p>
    </div>
  );
}

interface Props {
  detail: RecipeDetail;
  name: (userId: string) => string;
  shared: boolean;
}

function Ingredients({
  recipe,
  scaling,
  linked,
  adjustable = false,
}: {
  recipe: Recipe;
  scaling: Scaling;
  linked: RecipeDetail["linked"];
  /** With "Serves − 4 +" and "Adjust" (not in Trash). */
  adjustable?: boolean;
}) {
  return (
    <section className={styles.panel} aria-labelledby="ingredients-title">
      <div className={styles.panelHead}>
        <h2 id="ingredients-title">Ingredients</h2>
        {adjustable ? <Adjust recipe={recipe} scaling={scaling} /> : null}
      </div>
      {adjustable ? (
        <>
          <ServesStepper recipe={recipe} scaling={scaling} />
          <ScaleStatus
            note={
              scaling.active
                ? scaleNote(
                    scaling.factor,
                    scaling.units,
                    scaling.pans ? panName(scaling.pans.yours) : null,
                  )
                : null
            }
            scaling={scaling}
          />
        </>
      ) : null}
      {recipe.ingredients.length === 0 ? <p className={styles.hint}>None written yet.</p> : null}
      {sections(recipe.ingredients).map((group) => (
        <div key={group.key} className={styles.group}>
          {group.heading ? <h3 className={styles.subheading}>{group.heading}</h3> : null}
          {group.items.length > 0 ? (
            <ul className={styles.ingredients}>
              {group.items.map((line) => (
                <li key={line.id}>
                  <ScaledLine
                    text={line.text}
                    line={showIngredient(line.text, scaling, scaling.held.has(line.id))}
                    scaling={scaling}
                    lineId={line.id}
                    canHold
                  />
                  {line.linkedRecipeId ? (
                    <SubRecipe
                      targetId={line.linkedRecipeId}
                      path={[recipe.id]}
                      linked={linked}
                      units={scaling.units}
                      parentScaled={scaling.factor !== 1}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function Method({ recipe, scaling }: { recipe: Recipe; scaling: Scaling }) {
  const groups = sections(recipe.directions);
  // Fennl's bake-time suggestion for another pan (phase F2), under the step that gives the time.
  const note = scaling.pans ? bakeNote(recipe, scaling.pans, scaling.factor) : null;
  // Numbering carries on across sections: each list starts after the steps before it.
  const starts = groups.map((_, i) =>
    groups.slice(0, i).reduce((count, group) => count + group.items.length, 1),
  );
  return (
    <section className={styles.method} aria-labelledby="method-title">
      <h2 id="method-title">Method</h2>
      {recipe.directions.length === 0 ? <p className={styles.hint}>None written yet.</p> : null}
      {groups.map((group, i) => (
        <div key={group.key} className={styles.group}>
          {group.heading ? <h3 className={styles.subheading}>{group.heading}</h3> : null}
          {group.items.length > 0 ? (
            <ol className={styles.steps} start={starts[i]}>
              {group.items.map((step) => (
                <li key={step.id}>
                  <ScaledLine
                    text={step.text}
                    line={showStep(step.text, scaling)}
                    scaling={scaling}
                    lineId={step.id}
                    canHold={false}
                  />
                  {note?.stepId === step.id ? <Suggestion text={note.text} /> : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ))}
    </section>
  );
}

/** The recipe's notes, then the household's signed notes (yours is in "Yours", below). */
function Notes({ detail, name, me }: Props & { me: string }) {
  const signed = detail.opinions.filter((o) => o.userId !== me && o.note.trim());
  if (!detail.recipe.notes.trim() && signed.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="notes-title">
      <h2 id="notes-title">Notes</h2>
      {detail.recipe.notes.trim() ? <p className={styles.notes}>{detail.recipe.notes}</p> : null}
      {signed.map((o) => (
        <figure key={o.userId} className={styles.signed}>
          <blockquote>
            <p>{o.note}</p>
          </blockquote>
          <figcaption className={styles.signature}>{name(o.userId)}</figcaption>
        </figure>
      ))}
    </section>
  );
}

const RATINGS = [1, 2, 3, 4, 5];

function saveOpinion(recipeId: string, fields: OpinionChange["fields"]): Promise<boolean> {
  return save({ kind: "opinion", recipeId, fields, changedAt: Date.now() });
}

/**
 * Your signed note (CLAUDE.md, "Recipe ownership in households"); your stars and heart are by the
 * title. With no note yet, just a way to add one (owner's choice 2026-10-25).
 */
function YourNote({
  detail,
  me,
  myName,
  shared,
  editable,
}: {
  detail: RecipeDetail;
  me: string;
  myName: string;
  shared: boolean;
  editable: boolean;
}) {
  const recipeId = detail.recipe.id;
  const note = detail.opinions.find((o) => o.userId === me)?.note ?? "";
  const [adding, setAdding] = useState(false);
  if (!note.trim() && !adding) {
    return (
      <div className={styles.section}>
        <button
          type="button"
          className={styles.more}
          disabled={!editable}
          onClick={() => setAdding(true)}
        >
          Add your note
        </button>
      </div>
    );
  }
  return (
    <section className={styles.section}>
      <OwnNote
        key={recipeId}
        note={note}
        signature={myName}
        shared={shared}
        editable={editable}
        autoFocus={adding}
        onSave={(fields) => saveOpinion(recipeId, { note: fields })}
      />
    </section>
  );
}

/** Your signed note, saved as you type. */
function OwnNote({
  note,
  signature,
  shared,
  editable,
  autoFocus = false,
  onSave,
}: {
  note: string;
  signature: string;
  shared: boolean;
  editable: boolean;
  autoFocus?: boolean;
  onSave: (note: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(note);
  // The note as last saved (or as it arrived from another device).
  const [saved, setSaved] = useState(note);
  const waiting = useRef<string | null>(null);
  const saveNote = useRef(onSave);
  useEffect(() => {
    saveNote.current = onSave;
  });
  // A change from elsewhere, while nothing is being typed here: show it.
  if (note !== saved && text === saved) {
    setSaved(note);
    setText(note);
  }

  useEffect(() => {
    if (text === saved || !editable) return;
    waiting.current = text;
    const timer = setTimeout(() => {
      waiting.current = null;
      void saveNote.current(text).then((ok) => {
        if (ok) setSaved(text);
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [text, saved, editable]);

  // Leaving the page with typing not yet saved: save it now.
  useEffect(
    () => () => {
      if (waiting.current !== null) void saveNote.current(waiting.current);
    },
    [],
  );

  return (
    <div className={styles.ownNote}>
      <label htmlFor="own-note">Your note</label>
      <textarea
        id="own-note"
        className={styles.input}
        rows={3}
        value={text}
        disabled={!editable}
        maxLength={RECIPE_RULES.notesLength}
        autoFocus={autoFocus}
        aria-describedby="own-note-hint"
        onChange={(e) => setText(e.target.value)}
      />
      <p id="own-note-hint" className={styles.hint}>
        {shared
          ? `Signed ${signature}, and shown to your household under the recipe's notes.`
          : `Signed ${signature}. Saved as you type.`}{" "}
        <span data-note-status aria-live="polite">
          {text === saved ? (text ? "Saved." : "") : "Saving…"}
        </span>
      </p>
    </div>
  );
}

function Nutrition({ recipe }: { recipe: Recipe }) {
  const [hidden] = useHideNutrition();
  const nutrition = recipe.nutrition;
  // Hidden in Settings (phase F4): kept, just out of sight.
  if (!nutrition || hidden) return null;
  const values = (Object.keys(NUTRIENTS) as Nutrient[]).filter(
    (key) => nutrition.perServing[key] !== undefined,
  );
  if (values.length === 0 && !nutrition.text) return null;
  return (
    <section className={styles.section} aria-labelledby="nutrition-title">
      <h2 id="nutrition-title">Nutrition per serving</h2>
      {values.length > 0 ? (
        <dl className={styles.nutrition}>
          {values.map((key) => (
            <div key={key}>
              <dt>{NUTRIENT_NAMES[key]}</dt>
              <dd>
                {nutrition.perServing[key]} {NUTRIENTS[key]}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {nutrition.text ? <p className={styles.notes}>{nutrition.text}</p> : null}
      <p className={styles.hint}>{NUTRITION_FROM[nutrition.source]}</p>
    </section>
  );
}

/**
 * A recipe in Trash (phase C9): what happens to it, putting it back, and the recipe itself to
 * read (phase C11: it may have to wait there for room under the plan's limit). Nothing here
 * changes it until it's back.
 */
function InTrash({ detail, editable }: { detail: RecipeDetail; editable: boolean }) {
  const [failed, setFailed] = useState(false);
  const { recipe, members } = detail;
  const names = new Map(members.map((m: Member) => [m.userId, firstName(m.name)]));
  const name = (userId: string) => names.get(userId) ?? "Someone";
  // Putting it back needs room under the plan's recipe limit (phase C11).
  const usage = useUsage();
  const blocked = useAddBlocked(true);
  const [noRoom, setNoRoom] = useState(false);
  const restore = async () =>
    blocked
      ? setNoRoom(true)
      : setFailed(
          !(await save({
            kind: "recipe",
            id: recipe.id,
            fields: {},
            deleted: false,
            changedAt: Date.now(),
          })),
        );
  return (
    <article>
      <Link href="/trash" className={styles.back}>
        ← Trash
      </Link>
      {recipe.source.kind === "person" && recipe.source.name ? (
        <p className={styles.byPerson}>{recipe.source.name}</p>
      ) : null}
      <h1 tabIndex={-1} className={styles.recipeTitle}>
        {recipe.title || "Untitled"}
      </h1>
      <p>This recipe is in Trash. {trashText(recipe.deletedAt ?? "")}, unless you put it back.</p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={!editable}
          onClick={() => void restore()}
        >
          Put back
        </button>
      </div>
      {failed ? (
        <p role="alert" className={styles.error}>
          Couldn&rsquo;t put it back just now. Please try again.
        </p>
      ) : null}
      <p role="status">
        {noRoom && blocked && usage ? `${restoreBlockedText(usage)} ${NOTHING_LOST}` : ""}
      </p>

      {recipe.description.trim() ? <p className={styles.headnote}>{recipe.description}</p> : null}
      <Facts recipe={recipe} scaling={AS_WRITTEN} />
      {detail.categories.length > 0 ? (
        <ul className={styles.chips} aria-label="Categories">
          {detail.categories.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      ) : null}
      <div className={styles.columns}>
        <Ingredients recipe={recipe} scaling={AS_WRITTEN} linked={detail.linked} />
        <Method recipe={recipe} scaling={AS_WRITTEN} />
      </div>
      {/* Everyone's signed notes, yours included: there's no "Yours" to edit here. */}
      <Notes detail={detail} name={name} shared={members.length > 1} me="" />
      <Nutrition recipe={recipe} />
      <div className={styles.section}>
        <Originals
          photos={detail.photos.filter((p) => p.role === "import_original")}
          title={recipe.title}
        />
        <p className={styles.hint}>
          <SourceLink recipe={recipe} />
        </p>
      </div>
    </article>
  );
}

export function RecipePage({ id }: { id: string }) {
  const detail = useRecipe(id);
  const status = useSyncStatus();
  const editable = canEdit(status);
  const heading = useRef<HTMLHeadingElement>(null);
  const title = detail?.recipe.title;
  const scaling = useScaling(detail?.recipe ?? null);

  useEffect(() => {
    if (!title) return;
    document.title = `${title} · Fennl`;
    // The page arrives after the switch to it: start keyboard and screen-reader users at the
    // recipe's title (unless they've already moved on).
    const active = document.activeElement;
    if (!active || active === document.body || active.id === "main") heading.current?.focus();
  }, [title]);

  if (detail === undefined) {
    return (
      <p role="status" className="visually-hidden">
        Opening the recipe…
      </p>
    );
  }
  if (detail === null || detail.recipe.expungedAt) {
    return (
      <>
        <Link href="/" className={styles.back}>
          ← All recipes
        </Link>
        <h1 tabIndex={-1} className={styles.recipeTitle}>
          This recipe isn&rsquo;t here
        </h1>
        <p>
          {detail
            ? "It was deleted for good after its time in Trash."
            : "It may have been deleted, or it hasn’t reached this device yet."}
        </p>
      </>
    );
  }
  if (detail.recipe.deletedAt) {
    return <InTrash detail={detail} editable={editable} />;
  }

  const { recipe, members } = detail;
  const names = new Map(members.map((m: Member) => [m.userId, firstName(m.name)]));
  const name = (userId: string) => names.get(userId) ?? "Someone";
  const shared = members.length > 1;
  const me = members[0]?.userId ?? "";

  const trash = async () => {
    const changedAt = Date.now();
    if (await save({ kind: "recipe", id, fields: {}, deleted: true, changedAt })) {
      // The list says so, with Undo (phase C9).
      noteTrashed(id, recipe.title, changedAt);
      navigate("/");
    }
  };

  const gallery = detail.photos.filter((p) => p.role === "photo");
  const cover = gallery[0] ?? null;

  return (
    <article className={cover ? styles.recipeWithPhoto : styles.recipe}>
      {cover ? <Painting hash={cover.imageHash} /> : null}
      <div className={styles.recipeTop}>
        <Link href="/" className={styles.back}>
          ← All recipes
        </Link>
        <div className={styles.topActions}>
          <Link href={`/recipes/${id}/edit`} className={styles.topAction}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 20h4L19 9l-4-4L4 16z" />
            </svg>
            Edit<span className="visually-hidden"> recipe</span>
          </Link>
          <Link href={`/recipes/${id}/print`} className={styles.topAction}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2" />
              <path d="M7 14h10v6H7z" />
            </svg>
            Print
          </Link>
        </div>
      </div>
      <div className={cover ? styles.hero : undefined}>
        {cover ? (
          <div className={styles.heroPhoto}>
            <Gallery
              photos={gallery}
              title={recipe.title}
              addedBy={(photo) =>
                shared && photo.addedByUserId !== me ? name(photo.addedByUserId) : null
              }
            />
          </div>
        ) : null}
        <header className={styles.recipeHeader}>
          {detail.categories.length > 0 ? (
            <ul className={styles.eyebrow} aria-label="Categories">
              {detail.categories.map((path) => (
                <li key={path}>
                  <Link href={`/?category=${encodeURIComponent(path)}`}>{path}</Link>
                </li>
              ))}
            </ul>
          ) : null}
          <h1 ref={heading} tabIndex={-1} className={styles.recipeTitle}>
            {recipe.title}
          </h1>
          {recipe.source.kind === "person" && recipe.source.name ? (
            <p className={styles.byPerson}>{recipe.source.name}</p>
          ) : null}
          <Meta detail={detail} name={name} shared={shared} me={me} editable={editable} />
          {recipe.description.trim() ? <Headnote text={recipe.description} /> : null}
          <Facts recipe={recipe} scaling={scaling} />
          <div className={styles.actions}>
            {recipe.directions.some((step) => !step.heading) ? (
              <Link href={`/recipes/${id}/cook`} className={styles.startCooking}>
                Start cooking
              </Link>
            ) : null}
            <MadeIt detail={detail} name={name} shared={shared} me={me} editable={editable} />
          </div>
          <PrintCopy id={id} />
          {detail.waiting ? (
            <p className={styles.hint}>Changes here haven&rsquo;t synced yet.</p>
          ) : null}
        </header>
      </div>

      <EarlierVersion detail={detail} me={me} editable={editable} />

      <div className={styles.columns}>
        <Ingredients recipe={recipe} scaling={scaling} linked={detail.linked} adjustable />
        <Method recipe={recipe} scaling={scaling} />
      </div>

      <Notes detail={detail} name={name} shared={shared} me={me} />
      <YourNote detail={detail} me={me} myName={name(me)} shared={shared} editable={editable} />
      <Nutrition recipe={recipe} />
      <div className={styles.section}>
        <Originals
          photos={detail.photos.filter((p) => p.role === "import_original")}
          title={recipe.title}
        />
      </div>

      <div className={styles.danger}>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => void trash()}
          disabled={!editable}
        >
          Move to Trash
        </button>
      </div>
    </article>
  );
}
