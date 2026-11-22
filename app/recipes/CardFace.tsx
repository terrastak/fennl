import type { RecipeSummary } from "../sync/dbProtocol";
import type { SearchHit } from "../sync/search";
import { PhotoImage } from "../photos/PhotoImage";
import { minutesText } from "./format";
import { Highlight } from "./Highlight";
import listStyles from "./list.module.css";
import styles from "./recipes.module.css";

// What a recipe's card in the list shows (phase C5, U17 mockup): the cover photo or the first
// letter, the title, who added it, stars and time, and the categories. Shared by the recipe list
// and, since U24, Trash, so a recipe looks the same in both; since U27 part 3 also Drafts, with a
// tag on the cover ("Draft", "New recipe", "Changes not saved") and, for a new recipe with no title
// yet, "Untitled" and the start of what's typed.

/** What a card needs to know about a recipe. */
export type CardRecipe = Pick<
  RecipeSummary,
  | "id"
  | "title"
  | "cover"
  | "addedBy"
  | "myRating"
  | "totalMinutes"
  | "categories"
  | "waiting"
  | "favorite"
>;

export function CardFace({
  recipe,
  terms = [],
  hit,
  titleId,
  tag,
  untitledHint,
}: {
  recipe: CardRecipe;
  /** A small white tag with a pencil on the cover's corner (U27 part 3's drafts); its id is
   *  `<titleId>-tag`, to name a card by its tag and title. */
  tag?: string | undefined;
  /** For a recipe with no title yet: what's typed so far, after "Untitled · ". */
  untitledHint?: string | null | undefined;
  /** What's being searched for, to mark in the card (phase C8). */
  terms?: string[];
  /** Where the search found it, when not in the title. */
  hit?: SearchHit | undefined;
  titleId: string;
}) {
  // Stars and time on one line (the dot stays with the time, so a line never ends on one), the
  // categories under them (U17 mockup).
  const stars = recipe.myRating ?? 0;
  const time = recipe.totalMinutes !== null ? minutesText(recipe.totalMinutes) : "";
  const heart = recipe.favorite ? (
    <span className={listStyles.heart}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
      </svg>
      <span className="visually-hidden">Favorite</span>
    </span>
  ) : null;
  // The cover's small copy (phase D2); recipes without one keep their first letter.
  const cover = recipe.cover ? (
    <PhotoImage
      hash={recipe.cover.hash}
      size="thumb"
      width={recipe.cover.width}
      height={recipe.cover.height}
      alt=""
      className={styles.coverPhoto}
    />
  ) : (
    <span className={styles.cover} aria-hidden="true">
      {recipe.title.trim().charAt(0).toUpperCase()}
    </span>
  );
  return (
    <>
      {tag ? (
        <span className={styles.coverWrap}>
          {cover}
          <span id={`${titleId}-tag`} className={styles.coverTag}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
            </svg>
            <span className={styles.coverTagText}>{tag}</span>
            {/* Said after the tag, so a screen reader hears "Draft, Green Chile Stew". */}
            <span className="visually-hidden">,</span>
          </span>
        </span>
      ) : (
        cover
      )}
      <span className={styles.cardBody}>
        <span
          id={titleId}
          className={`${styles.cardTitle} ${recipe.title.trim() ? "" : styles.untitledTitle}`}
        >
          {recipe.title.trim() ? (
            <Highlight text={recipe.title} terms={terms} />
          ) : (
            <>
              <span className={styles.untitled}>Untitled</span>
              {untitledHint ? <span className={styles.untitledHint}> · {untitledHint}</span> : null}
            </>
          )}
        </span>
        {hit ? (
          <span className={styles.cardHit}>
            <span className={styles.cardHitField}>{hit.field}:</span>{" "}
            <Highlight text={hit.text} terms={terms} />
          </span>
        ) : null}
        {recipe.addedBy ? <span className={styles.cardBy}>{recipe.addedBy}</span> : null}
        {stars > 0 || time ? (
          <span className={listStyles.cardFacts}>
            {stars > 0 ? (
              <span className={listStyles.stars}>
                <span aria-hidden="true">{"★".repeat(stars)}</span>
                <span className="visually-hidden">
                  {stars} {stars === 1 ? "star" : "stars"}
                </span>
              </span>
            ) : null}
            {stars > 0 && time ? (
              <span className={listStyles.nowrap}>
                {" "}
                · <span className={listStyles.time}>{time}</span>
              </span>
            ) : time ? (
              <span className={listStyles.time}>{time}</span>
            ) : null}
          </span>
        ) : null}
        {recipe.categories.length > 0 ? (
          <span className={styles.cardMeta}>
            {recipe.categories.map((path, i) => (
              <span key={path}>
                {i > 0 ? " " : ""}
                {/* Kept whole on its line, its comma with it; one too long for the card ends in
                    "…", the whole path shown on hover (and read out in full). */}
                <span className={listStyles.nowrap}>
                  <span className={listStyles.path} title={path}>
                    {path}
                  </span>
                  {i < recipe.categories.length - 1 ? "," : ""}
                </span>
              </span>
            ))}
          </span>
        ) : null}
        {recipe.waiting ? <span className={styles.cardMeta}>Not synced yet</span> : null}
      </span>
      {heart}
    </>
  );
}
