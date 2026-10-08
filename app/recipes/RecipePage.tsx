import { useEffect, useRef } from "react";
import {
  NUTRIENTS,
  type DirectionStep,
  type IngredientLine,
  type Nutrient,
  type NutritionSource,
  type Recipe,
} from "../../shared/recipe";
import type { SyncChange } from "../../shared/sync";
import { navigate } from "../navigation";
import { Link } from "../router";
import type { Member, RecipeDetail } from "../sync/dbProtocol";
import { canEdit } from "../sync/status";
import { activeSyncClient, useRecipe, useSyncStatus } from "../sync/useSync";
import {
  dayText,
  firstName,
  lastMade,
  localDay,
  namesText,
  servingsText,
  sourceLine,
  stars,
  timeText,
} from "./format";
import styles from "./recipes.module.css";

// A recipe, laid out for reading (phase C5). Everyone's ratings, favorites and signed notes show
// only when someone has given one (CLAUDE.md, "Recipe ownership in households"), and "Last made"
// is shared by the household, with a "Made it" button.

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

function Facts({ recipe }: { recipe: Recipe }) {
  const facts = [
    ["Prep", timeText(recipe.times.prep)],
    ["Cook", timeText(recipe.times.cook)],
    ["Total", timeText(recipe.times.total)],
    ["Makes", servingsText(recipe.servings)],
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
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function People({ detail, name, shared }: Props) {
  const rated = detail.opinions.filter((o) => o.rating !== null);
  const favorites = detail.opinions.filter((o) => o.favorite).map((o) => name(o.userId));
  if (!shared && rated.length === 0 && favorites.length === 0) return null;
  return (
    <ul className={styles.people}>
      {shared ? <li>Added by {name(detail.recipe.ownerUserId)}</li> : null}
      {rated.map((o) => (
        <li key={o.userId}>
          <span className={styles.stars} aria-hidden="true">
            {stars(o.rating ?? 0)}
          </span>{" "}
          <span className="visually-hidden">{o.rating} out of 5 stars from </span>
          {name(o.userId)}
        </li>
      ))}
      {favorites.length > 0 ? (
        <li>
          <span aria-hidden="true">♥ </span>
          {shared ? `A favorite of ${namesText(favorites)}` : "A favorite"}
        </li>
      ) : null}
    </ul>
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
      <p role="status">
        {last ? `Last made ${when}${shared ? ` by ${name(last.userId)}` : ""}` : "Not made yet"}
      </p>
      {mine ? (
        <button type="button" className={styles.secondary} onClick={undo} disabled={!editable}>
          Undo &ldquo;made it&rdquo;
        </button>
      ) : (
        <button type="button" className={styles.primary} onClick={madeIt} disabled={!editable}>
          Made it today
        </button>
      )}
    </div>
  );
}

interface Props {
  detail: RecipeDetail;
  name: (userId: string) => string;
  shared: boolean;
}

function Ingredients({ recipe }: { recipe: Recipe }) {
  return (
    <section className={styles.panel} aria-labelledby="ingredients-title">
      <h2 id="ingredients-title">Ingredients</h2>
      {recipe.ingredients.length === 0 ? <p className={styles.hint}>None written yet.</p> : null}
      {sections(recipe.ingredients).map((group) => (
        <div key={group.key} className={styles.group}>
          {group.heading ? <h3 className={styles.subheading}>{group.heading}</h3> : null}
          {group.items.length > 0 ? (
            <ul className={styles.ingredients}>
              {group.items.map((line) => (
                <li key={line.id}>{line.text}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function Method({ recipe }: { recipe: Recipe }) {
  const groups = sections(recipe.directions);
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
                <li key={step.id}>{step.text}</li>
              ))}
            </ol>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function Notes({ detail, name }: Props) {
  const signed = detail.opinions.filter((o) => o.note.trim());
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

function Nutrition({ recipe }: { recipe: Recipe }) {
  const nutrition = recipe.nutrition;
  if (!nutrition) return null;
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

function Source({ recipe }: { recipe: Recipe }) {
  const line = sourceLine(recipe.source);
  const url = recipe.source.url;
  if (!line && !url) return null;
  return (
    <p className={styles.hint}>
      Source:{" "}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer noopener">
          {line ?? new URL(url).hostname}
        </a>
      ) : (
        line
      )}
    </p>
  );
}

export function RecipePage({ id }: { id: string }) {
  const detail = useRecipe(id);
  const status = useSyncStatus();
  const editable = canEdit(status);
  const heading = useRef<HTMLHeadingElement>(null);
  const title = detail?.recipe.title;

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
  if (detail === null || detail.recipe.deletedAt) {
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

  const { recipe, members } = detail;
  const names = new Map(members.map((m: Member) => [m.userId, firstName(m.name)]));
  const name = (userId: string) => names.get(userId) ?? "Someone";
  const shared = members.length > 1;
  const me = members[0]?.userId ?? "";

  const trash = async () => {
    if (await save({ kind: "recipe", id, fields: {}, deleted: true, changedAt: Date.now() })) {
      navigate("/");
    }
  };

  return (
    <article>
      <Link href="/" className={styles.back}>
        ← All recipes
      </Link>
      <header className={styles.recipeHeader}>
        {recipe.source.kind === "person" && recipe.source.name ? (
          <p className={styles.byPerson}>{recipe.source.name}</p>
        ) : null}
        <h1 ref={heading} tabIndex={-1} className={styles.recipeTitle}>
          {recipe.title}
        </h1>
        {recipe.description.trim() ? <p className={styles.headnote}>{recipe.description}</p> : null}
        <Facts recipe={recipe} />
        <People detail={detail} name={name} shared={shared} />
        {detail.categories.length > 0 ? (
          <ul className={styles.chips} aria-label="Categories">
            {detail.categories.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        ) : null}
        <MadeIt detail={detail} name={name} shared={shared} me={me} editable={editable} />
        {detail.waiting ? (
          <p className={styles.hint}>Changes here haven&rsquo;t synced yet.</p>
        ) : null}
      </header>

      <div className={styles.columns}>
        <Ingredients recipe={recipe} />
        <Method recipe={recipe} />
      </div>

      <Notes detail={detail} name={name} shared={shared} />
      <Nutrition recipe={recipe} />
      <div className={styles.section}>
        <Source recipe={recipe} />
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
