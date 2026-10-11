import type { Document, Element } from "domhandler";
import { getAttributeValue, textContent } from "domutils";
import { parseDocument } from "htmlparser2";
import { dietLabels } from "./diet";
import {
  DRAFT_VERSION,
  type Confidence,
  type DraftFields,
  type DraftInput,
  type DraftValue,
  type Evidence,
  type RecipeDraft,
} from "./importDraft";
import type { DirectionStep, IngredientLine, RecipeTime } from "./recipe";
import { asShown, cardElement, cardNotes, cardYield, type CardLine } from "./recipeCard";
import { cleanLine, looksLikeHeading, type ListKind } from "./recipeLines";
import {
  elements,
  hasType,
  isObject,
  jsonLd,
  list,
  schemaRecipes,
  type SchemaObject,
  type SchemaRecipe,
} from "./schemaRecipe";
import { absoluteUrl, recipePhotos } from "./webPhotos";
import { cleanText, cleanTitle, readDuration, readNutrition, readYield } from "./webText";

/**
 * Reading recipes from a web page's structured data (phase E3): the importer for pages that
 * publish Schema.org recipe data, as most big recipe sites do. It reads the page as saved or as
 * the Chrome extension sends it (E6) and never fetches anything itself.
 *
 * Each recipe on the page becomes a draft (shared/importDraft.ts) for the review screen (E4):
 * the recipe's text cleaned up, the section headings the page shows put back, diet labels as
 * categories under "Diet", and up to three photos with the cover first. A page with no recipe
 * data gives no drafts; the AI reads those (E8).
 */

export const WEB_IMPORTER = "web-structured";

const PAGE = 0;

function evidence(detail: string, kind: Evidence["kind"] = "structured_data"): Evidence[] {
  return [{ kind, input: PAGE, detail }];
}

function value<T>(
  v: T,
  confidence: Confidence,
  detail: string,
  kind?: Evidence["kind"],
): DraftValue<T> {
  return { value: v, confidence, from: evidence(detail, kind) };
}

/** A `<meta>` value from the page's head: "og:site_name", "og:url". */
function meta(doc: Document, name: string): string | null {
  for (const el of elements(doc)) {
    if (el.name !== "meta") continue;
    const key = getAttributeValue(el, "property") ?? getAttributeValue(el, "name");
    if (key?.toLowerCase() === name) {
      const content = cleanText(getAttributeValue(el, "content"), true);
      if (content) return content;
    }
  }
  return null;
}

function canonicalUrl(doc: Document, pageUrl: string | null): string | null {
  for (const el of elements(doc)) {
    if (
      el.name === "link" &&
      /(?:^|\s)canonical(?:\s|$)/i.test(getAttributeValue(el, "rel") ?? "")
    ) {
      const url = absoluteUrl(getAttributeValue(el, "href") ?? "", pageUrl);
      if (url) return url;
    }
  }
  const og = meta(doc, "og:url");
  return (og && absoluteUrl(og, pageUrl)) ?? pageUrl;
}

/** The site's name: what the page calls it, else its address without "www.". */
function siteName(doc: Document, recipe: SchemaObject, url: string | null): string | null {
  const og = meta(doc, "og:site_name");
  if (og) return og;
  for (const value of [...list(recipe.publisher), ...jsonLd(doc)]) {
    for (const item of list(value)) {
      const node = isObject(item) && Array.isArray(item["@graph"]) ? item["@graph"] : [item];
      for (const n of list(node)) {
        if ((hasType(n, "Organization") || hasType(n, "WebSite")) && isObject(n)) {
          const name = cleanText(n.name, true);
          if (name) return name;
        }
      }
    }
  }
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** "Claire Saffitz", or "Alvin Zhou and Claire King": the people (or kitchen) named as author. */
function authorNames(value: unknown): string | null {
  const names = list(value)
    .map((a) => cleanText(isObject(a) ? a.name : a, true).replace(/^by\s+/i, ""))
    .filter((name) => name && !/^https?:/.test(name));
  if (names.length === 0) return null;
  return names.length === 1
    ? (names[0] as string)
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Decorations some sites put round a section heading in the ingredient list: "--- Crust ---". */
const DECORATED = /^[-=*_#~•\s]{2,}(.+?)[-=*_#~•\s]{2,}$|^\*(.+)\*$/;

/** A line from the page's data, cleaned, and whether it's a section heading. */
function listLine(raw: unknown, kind: "ingredients" | "directions"): CardLine | null {
  const text = cleanLine(cleanText(raw, true), kind);
  if (!text) return null;
  const decorated = DECORATED.exec(text);
  if (decorated && !/\d/.test(text)) {
    return { text: (decorated[1] ?? decorated[2] ?? text).trim(), heading: true };
  }
  return { text, heading: looksLikeHeading(text) };
}

/** "Step 1", "1": names that say nothing a step's text doesn't. */
const STEP_NAME = /^(?:step\s*)?\d+[.:]?$/i;

/** A step's text, from a HowToStep or a plain string. */
function stepText(step: SchemaObject): string {
  const text = cleanText(step.text ?? step.description, true);
  if (text) return text;
  const parts = list(step.itemListElement)
    .map((p) => cleanText(isObject(p) ? (p.text ?? p.description) : p, true))
    .filter(Boolean);
  return parts.length ? parts.join(" ") : cleanText(step.name, true);
}

/**
 * The directions as lines: plain strings (one step each, or one long string with a step on
 * each line), HowToSteps, and HowToSections (a heading, then its steps).
 */
/** A publisher's note on where a recipe first appeared, added to its last step. */
const EDITORS_NOTE =
  /\s*Editor[’']s note:[^]*?(?:first|originally)\s+(?:printed|published|appeared)[^]*$/i;

/** "Do Ahead:" tips magazines add to a step: shown on the page as a line of their own. */
const DO_AHEAD = /\s+(?=Do Ahead:)/;

function directionLines(value: unknown): CardLine[] {
  const out: CardLine[] = [];
  const add = (raw: string) => {
    const text = cleanText(raw).replace(EDITORS_NOTE, "").replace(DO_AHEAD, "\n");
    for (const part of text.split("\n")) {
      // Steps run together, numbered: "1. Mix… 2. Bake…", or "…rest 10 minutes. 6. Toss…" in
      // step 5. Split only at the number the next step would have.
      let rest = part;
      for (;;) {
        const next = out.filter((l) => !l.heading).length + 2;
        const at = new RegExp(`\\s+(?=(?:step\\s*)?${next}[.)]\\s+\\p{Lu})`, "iu").exec(rest);
        const line = listLine(at ? rest.slice(0, at.index) : rest, "directions");
        if (line) out.push(line);
        if (!at) break;
        rest = rest.slice(at.index);
      }
    }
  };
  const visit = (item: unknown) => {
    if (typeof item === "string") return add(item);
    if (!isObject(item)) return;
    if (hasType(item, "HowToSection") || (hasType(item, "ItemList") && item.name)) {
      const name = cleanText(item.name, true);
      if (name) out.push({ text: name, heading: true });
      for (const child of list(item.itemListElement)) visit(child);
      return;
    }
    if (
      hasType(item, "ItemList") ||
      (!item.text && Array.isArray(item.itemListElement) && !hasType(item, "HowToStep"))
    ) {
      for (const child of list(item.itemListElement)) visit(child);
      return;
    }
    const text = stepText(item);
    if (!text) return;
    const name = cleanText(item.name, true);
    const titled =
      name &&
      !STEP_NAME.test(name) &&
      !text.toLowerCase().startsWith(
        name
          .toLowerCase()
          .replace(/[.…]+$/, "")
          .slice(0, 40),
      );
    add(titled ? `${name.replace(/[.:]$/, "")}: ${text}` : text);
  };
  for (const item of list(value)) visit(item);
  return out;
}

function ingredientLines(recipe: SchemaObject): CardLine[] {
  return list(recipe.recipeIngredient ?? recipe.ingredients)
    .flatMap((raw) => cleanText(raw).split("\n"))
    .map((raw) => listLine(raw, "ingredients"))
    .filter((line): line is CardLine => line !== null);
}

/** The list as the page shows it (section headings, fuller wording), and where it shows it. */
function shownOnPage(
  doc: Document,
  lines: CardLine[],
  kind: ListKind,
): { lines: CardLine[]; fromPage: boolean; box: Element | null } {
  const shown = asShown(doc, lines, kind);
  if (!shown) return { lines, fromPage: false, box: null };
  return { lines: shown.lines, fromPage: shown.headings || shown.texts, box: shown.box };
}

const newId = () => crypto.randomUUID();

/** Boilerplate some sites use as a description: "Make and share this … recipe from Food.com." */
const BOILERPLATE = /^make and share this .* recipe from [\w.]+\.?$/i;

function timeValue(
  time: RecipeTime | null,
  raw: unknown,
  detail: string,
): DraftValue<RecipeTime> | null {
  if (!time) return null;
  const iso = typeof raw === "string" && /^\s*P/i.test(raw);
  return value(time, iso ? "high" : "medium", detail);
}

function draftFor(
  found: SchemaRecipe,
  doc: Document,
  pageUrl: string | null,
  pageTitle: string | null,
): RecipeDraft | null {
  const recipe = found.data;
  const where = (property: string) =>
    found.from === "microdata" ? `microdata ${property}` : property;
  const url = canonicalUrl(doc, pageUrl);
  const site = siteName(doc, recipe, url);
  const title = cleanTitle(recipe.name ?? recipe.headline, site);
  if (!title) return null;

  const fields: DraftFields = {};
  fields.title = value(title, "high", where("name"));

  const description = cleanText(recipe.description);
  if (description && !BOILERPLATE.test(description)) {
    fields.description = value(description, "high", where("description"));
  }

  const ingredients = shownOnPage(doc, ingredientLines(recipe), "ingredients");
  const directions = shownOnPage(doc, directionLines(recipe.recipeInstructions), "directions");
  const lineConfidence = (lines: CardLine[], fromPage: boolean): Confidence[] =>
    lines.map((l) => (l.heading && fromPage ? "medium" : "high"));
  if (ingredients.lines.length) {
    fields.ingredients = {
      value: ingredients.lines.map((l): IngredientLine => ({
        id: newId(),
        text: l.text,
        heading: l.heading,
      })),
      confidence: "high",
      from: [
        ...evidence(where("recipeIngredient")),
        ...(ingredients.fromPage ? evidence("the recipe as shown on the page", "page_text") : []),
      ],
    };
  }
  if (directions.lines.length) {
    fields.directions = {
      value: directions.lines.map((l): DirectionStep => ({
        id: newId(),
        text: l.text,
        heading: l.heading,
      })),
      confidence: "high",
      from: [
        ...evidence(where("recipeInstructions")),
        ...(directions.fromPage ? evidence("the recipe as shown on the page", "page_text") : []),
      ],
    };
  }

  const none: RecipeTime = { minutes: null, text: null };
  const prep = timeValue(readDuration(recipe.prepTime), recipe.prepTime, where("prepTime"));
  const cook = timeValue(
    readDuration(recipe.cookTime ?? recipe.performTime),
    recipe.cookTime ?? recipe.performTime,
    where("cookTime"),
  );
  const total = timeValue(readDuration(recipe.totalTime), recipe.totalTime, where("totalTime"));
  if (prep || cook || total) {
    const times = [prep, cook, total].filter((t) => t !== null);
    fields.times = {
      value: { prep: prep?.value ?? none, cook: cook?.value ?? none, total: total?.value ?? none },
      confidence: times.every((t) => t.confidence === "high") ? "high" : "medium",
      from: times.flatMap((t) => t.from),
    };
  }

  const lists = [ingredients.box, directions.box].filter((el): el is Element => el !== null);
  const card = cardElement(lists);

  const servings = readYield(recipe.recipeYield ?? recipe.yield);
  if (servings.count !== null || servings.yield !== null) {
    fields.servings = value(servings, "high", where("recipeYield"));
  } else {
    // A yield the recipe card shows but the data leaves out ("Makes 4 servings").
    const shown = card ? cardYield(card, lists) : null;
    const read = shown ? readYield(shown) : null;
    if (read && (read.count !== null || read.yield !== null)) {
      fields.servings = value(read, "medium", "the recipe card's yield", "page_text");
    }
  }

  fields.source = value(
    { kind: "website" as const, name: site, url, author: authorNames(recipe.author), page: null },
    "high",
    where("author"),
  );

  const notes = cardNotes(doc, card, lists);
  if (notes) fields.notes = value(notes, "medium", "the recipe card's notes", "page_text");

  const nutrition = readNutrition(recipe.nutrition);
  if (nutrition) fields.nutrition = value(nutrition, "high", where("nutrition"));

  const diet = dietLabels(recipe);
  const photos = recipePhotos(recipe, doc, url);
  const inputs: DraftInput[] = [
    { kind: "page", name: pageTitle, url, imageHash: null },
    ...photos.map((photo): DraftInput => ({
      kind: "image",
      name: null,
      url: photo,
      imageHash: null,
    })),
  ];

  const warnings: string[] = [];
  if (!fields.ingredients) warnings.push("The page's recipe data has no ingredients.");
  if (!fields.directions) warnings.push("The page's recipe data has no directions.");

  return {
    version: DRAFT_VERSION,
    source: "website",
    externalId: url,
    externalHash: null,
    inputs,
    fields,
    lineConfidence: {
      ingredients: fields.ingredients
        ? lineConfidence(ingredients.lines, ingredients.fromPage)
        : null,
      directions: fields.directions ? lineConfidence(directions.lines, directions.fromPage) : null,
    },
    categories: diet.paths.length
      ? value(
          diet.paths,
          diet.stated ? "high" : "medium",
          where(diet.stated ? "suitableForDiet" : "keywords"),
        )
      : null,
    photos: photos.map((_, i) => ({ input: i + 1, role: "photo" })),
    warnings,
    producer: { importer: WEB_IMPORTER, model: null },
  };
}

/**
 * The recipes on a web page, as drafts: one for each recipe its structured data describes, none
 * when it has none. `pageUrl` is the page's address, for links and photos given relative to it.
 */
export function readWebRecipes(html: string, pageUrl: string | null): RecipeDraft[] {
  const doc = parseDocument(html);
  const titleEl = [...elements(doc)].find((el) => el.name === "title");
  const pageTitle = titleEl ? cleanText(textContent(titleEl), true) || null : null;
  return schemaRecipes(doc)
    .map((found) => draftFor(found, doc, pageUrl, pageTitle))
    .filter((draft): draft is RecipeDraft => draft !== null);
}
