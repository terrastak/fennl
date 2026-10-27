import { bakeNote } from "../../shared/pans";
import { isCard, type PrintOptions } from "../../shared/print";
import {
  NUTRIENTS,
  type DirectionStep,
  type IngredientLine,
  type Nutrient,
} from "../../shared/recipe";
import { showIngredient, showStep, type ShownLine } from "../../shared/scale";
import { firstName, sourceLine, stars } from "../recipes/format";
import { noteDay } from "../recipes/notes";
import { PhotoImage } from "../photos/PhotoImage";
import type { PhotoSize } from "../photos/cache";
import type { PrintSet, PrintedRecipe } from "../sync/dbProtocol";
import { factsLine, printScale, scaleLine } from "./printing";
import { qrCode, recipeAddress } from "./qr";
import styles from "./print.module.css";

// The printed page (phase F6): recipes as they go on paper, in the layout chosen, with the app's
// menus and buttons nowhere. Always dark ink on white, whatever the screen's colours; amounts
// Fennl changed are in bold, since highlight colours often don't print.

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

/** Lines grouped under their headings (a list may start without one). */
function sections<T extends IngredientLine | DirectionStep>(lines: readonly T[]) {
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

/** A line's words, the amounts Fennl changed in bold. */
function Shown({ line }: { line: ShownLine }) {
  return (
    <>
      {line.pieces.map((piece, i) =>
        piece.changed ? <strong key={i}>{piece.text}</strong> : <span key={i}>{piece.text}</span>,
      )}
    </>
  );
}

function QrCode({ recipeId, title }: { recipeId: string; title: string }) {
  const address = recipeAddress(window.location.origin, recipeId);
  const { size, path } = qrCode(address);
  return (
    <figure className={styles.qr} data-address={address}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`QR code: opens ${title} in Fennl`}
        shapeRendering="crispEdges"
      >
        <rect width={size} height={size} className={styles.qrPaper} />
        <path d={path} className={styles.qrInk} />
      </svg>
      <figcaption>Scan to open in Fennl</figcaption>
    </figure>
  );
}

interface RecipeProps {
  item: PrintedRecipe;
  options: PrintOptions;
  units: Parameters<typeof printScale>[1];
  hideNutrition: boolean;
  name: (userId: string) => string;
  photoSize: PhotoSize;
  /** The recipe printed right after this one, to say "recipe follows" on a line linking to it. */
  next: PrintedRecipe | undefined;
  /** The title of the recipe this one is printed for, when it came in by a link. */
  usedIn: string | null;
}

function Recipe({
  item,
  options,
  units,
  hideNutrition,
  name,
  photoSize,
  next,
  usedIn,
}: RecipeProps) {
  const { recipe } = item;
  const scale = printScale(recipe, units);
  const said = scaleLine(scale);
  const facts = factsLine(recipe, scale);
  const card = isCard(options.layout);
  const note = scale.pans ? bakeNote(recipe, scale.pans, scale.factor) : null;
  const rated = item.opinions.filter((o) => o.rating !== null);
  const signed = item.notes.filter((n) => n.text.trim());
  const nutrition = recipe.nutrition;
  const nutrients = nutrition
    ? (Object.keys(NUTRIENTS) as Nutrient[]).filter((k) => nutrition.perServing[k] !== undefined)
    : [];
  const showNutrition =
    options.nutrition && !hideNutrition && nutrition && (nutrients.length > 0 || nutrition.text);
  const source = sourceLine(recipe.source);
  const groups = sections(recipe.directions);
  const starts = groups.map((_, i) =>
    groups.slice(0, i).reduce((count, group) => count + group.items.length, 1),
  );
  // A linked recipe printed later in this printout follows straight after: say so.
  const follows = (id: string) => next?.recipe.id === id && next.linkedFrom === recipe.id;

  return (
    <article className={styles.recipe} aria-labelledby={`print-${recipe.id}`}>
      <header className={styles.head}>
        <div className={styles.headText}>
          {usedIn ? <p className={styles.usedIn}>Used in {usedIn}</p> : null}
          {recipe.source.kind === "person" && recipe.source.name ? (
            <p className={styles.byPerson}>{recipe.source.name}</p>
          ) : null}
          <h2 id={`print-${recipe.id}`} className={styles.title}>
            {recipe.title || "Untitled"}
          </h2>
          {recipe.description.trim() && !card ? (
            <p className={styles.headnote}>{recipe.description}</p>
          ) : null}
          {facts.length > 0 ? <p className={styles.facts}>{facts.join(" · ")}</p> : null}
          {said ? <p className={styles.scaled}>{said}</p> : null}
          {options.household && rated.length > 0 ? (
            <p className={styles.stars}>
              {rated.map((o, i) => (
                <span key={o.userId}>
                  {i > 0 ? " · " : ""}
                  <span aria-hidden="true">{stars(o.rating ?? 0)}</span>
                  <span className="visually-hidden">{o.rating} out of 5 stars from</span>{" "}
                  {name(o.userId)}
                </span>
              ))}
            </p>
          ) : null}
        </div>
        {options.photo && !card && item.cover ? (
          <PhotoImage
            hash={item.cover.imageHash}
            size={photoSize}
            width={item.cover.width}
            height={item.cover.height}
            alt=""
            fit="cover"
            className={styles.photo}
          />
        ) : null}
        {options.qr ? <QrCode recipeId={recipe.id} title={recipe.title} /> : null}
      </header>

      <div className={styles.body}>
        <section className={styles.ingredients}>
          <h3 className={styles.part}>Ingredients</h3>
          {sections(recipe.ingredients).map((group) => (
            <div key={group.key} className={styles.group}>
              {group.heading ? <h4 className={styles.subheading}>{group.heading}</h4> : null}
              {group.items.length > 0 ? (
                <ul className={styles.list}>
                  {group.items.map((line) => {
                    const linked = line.linkedRecipeId;
                    const title = linked ? item.links[linked] : undefined;
                    return (
                      <li key={line.id}>
                        <Shown line={showIngredient(line.text, scale, scale.held.has(line.id))} />
                        {linked && title !== undefined ? (
                          <span className={styles.see}>
                            {" "}
                            {follows(linked) ? "(recipe follows)" : `(see ${title})`}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ))}
        </section>

        <section className={styles.method}>
          <h3 className={styles.part}>Method</h3>
          {groups.map((group, i) => (
            <div key={group.key} className={styles.group}>
              {group.heading ? <h4 className={styles.subheading}>{group.heading}</h4> : null}
              {group.items.length > 0 ? (
                <ol className={styles.steps} start={starts[i]}>
                  {group.items.map((step) => (
                    <li key={step.id}>
                      <Shown line={showStep(step.text, scale)} />
                      {note?.stepId === step.id ? (
                        <p className={styles.suggestion}>
                          <strong>Fennl&rsquo;s suggestion:</strong> {note.text}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ))}
        </section>
      </div>

      {options.notes && (recipe.notes.trim() || signed.length > 0) ? (
        <section className={styles.notes}>
          <h3 className={styles.part}>Notes</h3>
          {recipe.notes.trim() ? <p>{recipe.notes}</p> : null}
          {signed.map((n) => (
            <p key={n.id} className={styles.signed}>
              {n.text}{" "}
              <span className={styles.signature}>
                {name(n.userId)}, {noteDay(new Date(n.writtenAt))}
              </span>
            </p>
          ))}
        </section>
      ) : null}

      {showNutrition && nutrition ? (
        <section className={styles.nutrition}>
          <h3 className={styles.part}>Nutrition per serving</h3>
          {nutrients.length > 0 ? (
            <p>
              {nutrients
                .map((k) => `${NUTRIENT_NAMES[k]} ${nutrition.perServing[k]} ${NUTRIENTS[k]}`)
                .join(" · ")}
            </p>
          ) : null}
          {nutrition.text ? <p>{nutrition.text}</p> : null}
        </section>
      ) : null}

      {source || recipe.source.url || item.categories.length > 0 ? (
        <footer className={styles.foot}>
          {source || recipe.source.url ? (
            <p>Source: {[source, recipe.source.url].filter(Boolean).join(", ")}</p>
          ) : null}
          {item.categories.length > 0 ? (
            <p className={styles.categories}>{item.categories.join(" · ")}</p>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}

/** Recipes as printed, with a contents page at the front of a booklet when asked for. */
export function Printout({
  set,
  options,
  units,
  hideNutrition,
  photoSize,
}: {
  set: PrintSet;
  options: PrintOptions;
  units: RecipeProps["units"];
  hideNutrition: boolean;
  photoSize: PhotoSize;
}) {
  const names = new Map(set.members.map((m) => [m.userId, firstName(m.name)]));
  const name = (userId: string) => names.get(userId) ?? "Someone";
  const titles = new Map(set.recipes.map((r) => [r.recipe.id, r.recipe.title]));
  const contents = options.contents && set.recipes.length > 1;
  return (
    <div className={styles.paper} data-layout={options.layout}>
      {contents ? (
        <nav className={styles.contents} aria-labelledby="print-contents">
          <h2 id="print-contents" className={styles.title}>
            Contents
          </h2>
          <ol>
            {set.recipes.map((r) => (
              <li key={r.recipe.id}>
                {r.recipe.title || "Untitled"}
                {r.linkedFrom ? (
                  <span className={styles.see}> (used in {titles.get(r.linkedFrom)})</span>
                ) : null}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      {set.recipes.map((item, i) => (
        <Recipe
          key={item.recipe.id}
          item={item}
          options={options}
          units={units}
          hideNutrition={hideNutrition}
          name={name}
          photoSize={photoSize}
          next={set.recipes[i + 1]}
          usedIn={item.linkedFrom ? (titles.get(item.linkedFrom) ?? null) : null}
        />
      ))}
    </div>
  );
}
