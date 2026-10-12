import type { AnyNode, Document, Element } from "domhandler";
import { getAttributeValue, textContent } from "domutils";

/**
 * Finding the recipes a web page publishes as Schema.org data (phase E3): JSON-LD first, then
 * microdata. Most recipe sites publish one or the other for search engines, so the recipe can
 * be read exactly as the site wrote it, without guessing from the page's layout.
 *
 * Both come out the same shape: a plain object of Schema.org properties ("name",
 * "recipeIngredient", ...), with references between JSON-LD objects ("@id") filled in.
 */

export type SchemaObject = Record<string, unknown>;

export interface SchemaRecipe {
  data: SchemaObject;
  /** Where it was found, for the draft's record of where each field came from. */
  from: "json-ld" | "microdata";
}

export const isObject = (value: unknown): value is SchemaObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A value as a list, whether the page gave one value or several. */
export function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Whether an object has a Schema.org type ("Recipe", or "schema:Recipe", or a full address). */
export function hasType(value: unknown, type: string): boolean {
  if (!isObject(value)) return false;
  return list(value["@type"] ?? value.type).some(
    (t) => typeof t === "string" && t.replace(/^.*[/:#]/, "").toLowerCase() === type.toLowerCase(),
  );
}

/** Elements anywhere under a node, in document order. */
export function* elements(node: AnyNode): Generator<Element> {
  const children = "children" in node ? node.children : [];
  for (const child of children) {
    if (child.type === "tag" || child.type === "script" || child.type === "style") {
      yield child;
      yield* elements(child);
    }
  }
}

/**
 * JSON as pages write it in `<script type="application/ld+json">`: sometimes wrapped in an HTML
 * comment or CDATA, sometimes with raw line breaks inside strings or a trailing comma.
 */
function parseJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^(?:<!--|\/\*\s*<!\[CDATA\[\s*\*\/)/, "")
    .replace(/(?:-->|\/\*\s*\]\]>\s*\*\/)$/, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(trimmed.replace(/[\n\r\t]+/g, " ").replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return undefined;
    }
  }
}

/** Every object in a JSON-LD value, at any depth. */
function* objects(value: unknown): Generator<SchemaObject> {
  if (Array.isArray(value)) {
    for (const item of value) yield* objects(item);
  } else if (isObject(value)) {
    yield value;
    for (const [key, item] of Object.entries(value)) {
      if (key !== "@context") yield* objects(item);
    }
  }
}

/** Fills in references ({"@id": "#author"}) with the objects they point to, a few levels deep. */
function resolve(value: unknown, byId: Map<string, SchemaObject>, depth = 0): unknown {
  if (depth > 6) return value;
  if (Array.isArray(value)) return value.map((item) => resolve(item, byId, depth + 1));
  if (!isObject(value)) return value;
  const id = value["@id"];
  const keys = Object.keys(value);
  const target = typeof id === "string" && keys.every((k) => k === "@id") ? byId.get(id) : null;
  const source = target ?? value;
  const out: SchemaObject = {};
  for (const [key, item] of Object.entries(source)) out[key] = resolve(item, byId, depth + 1);
  return out;
}

/** The JSON-LD on a page: every script's data, for recipes and for the page's own details. */
export function jsonLd(doc: Document): unknown[] {
  const values: unknown[] = [];
  for (const el of elements(doc)) {
    if (el.name !== "script") continue;
    if (!/ld\+json/i.test(getAttributeValue(el, "type") ?? "")) continue;
    const value = parseJson(textContent(el));
    if (value !== undefined) values.push(value);
  }
  return values;
}

function jsonLdRecipes(values: unknown[]): SchemaObject[] {
  const byId = new Map<string, SchemaObject>();
  for (const value of values) {
    for (const obj of objects(value)) {
      const id = obj["@id"];
      if (typeof id === "string" && Object.keys(obj).length > 1 && !byId.has(id)) byId.set(id, obj);
    }
  }
  const recipes: SchemaObject[] = [];
  for (const value of values) {
    for (const obj of objects(value)) {
      if (hasType(obj, "Recipe")) recipes.push(resolve(obj, byId) as SchemaObject);
    }
  }
  return recipes;
}

/** A microdata property's value: a nested item, or the element's address, time or text. */
function itemValue(el: Element): unknown {
  if (getAttributeValue(el, "itemscope") !== undefined) return microdataItem(el);
  const content = getAttributeValue(el, "content");
  if (content !== undefined) return content;
  switch (el.name) {
    case "a":
    case "link":
    case "area":
      return getAttributeValue(el, "href") ?? "";
    case "img":
    case "source":
    case "video":
    case "audio":
    case "iframe":
    case "embed":
      return getAttributeValue(el, "src") ?? "";
    case "time":
      return getAttributeValue(el, "datetime") ?? textContent(el);
    case "data":
    case "meter":
      return getAttributeValue(el, "value") ?? textContent(el);
    default:
      return blockText(el);
  }
}

/** The properties of one microdata item (an element with `itemscope`). */
function microdataItem(scope: Element): SchemaObject {
  const item: SchemaObject = {};
  const type = getAttributeValue(scope, "itemtype");
  if (type) item["@type"] = type.split(/\s+/);
  const visit = (node: Element) => {
    for (const child of node.children) {
      if (child.type !== "tag") continue;
      const props = getAttributeValue(child, "itemprop");
      if (props) {
        const value = itemValue(child);
        for (const prop of props.split(/\s+/)) {
          const existing = item[prop];
          item[prop] = existing === undefined ? value : [...list(existing), value];
        }
      }
      // A nested item's own properties belong to it, not to this one.
      if (getAttributeValue(child, "itemscope") === undefined) visit(child);
    }
  };
  visit(scope);
  return item;
}

function microdataRecipes(doc: Document): SchemaObject[] {
  const recipes: SchemaObject[] = [];
  for (const el of elements(doc)) {
    if (getAttributeValue(el, "itemscope") === undefined) continue;
    const type = getAttributeValue(el, "itemtype") ?? "";
    if (/schema\.org\/Recipe\b/i.test(type)) recipes.push(microdataItem(el));
  }
  return recipes;
}

/** Elements whose end makes a line break when a page's text is read as lines. */
const BLOCK =
  /^(?:p|div|li|ul|ol|dl|dt|dd|h[1-6]|section|article|header|footer|aside|table|tr|blockquote|pre|figure|figcaption|br|hr)$/;

/** An element's text as it reads on the page: a line break after each block, spaces tidied. */
export function blockText(node: AnyNode): string {
  const parts: string[] = [];
  const walk = (n: AnyNode) => {
    if (n.type === "text") parts.push(n.data.replace(/\s+/g, " "));
    else if (n.type === "tag") {
      if (n.name === "br") parts.push("\n");
      for (const child of n.children) walk(child);
      if (BLOCK.test(n.name)) parts.push("\n");
    }
  };
  walk(node);
  return parts.join("");
}

/**
 * The recipes a page publishes: JSON-LD when it has any, else microdata. The same recipe given
 * twice (some pages repeat it) comes out once.
 */
export function schemaRecipes(doc: Document): SchemaRecipe[] {
  const fromJson = jsonLdRecipes(jsonLd(doc)).map((data) => ({ data, from: "json-ld" as const }));
  const found = fromJson.length
    ? fromJson
    : microdataRecipes(doc).map((data) => ({ data, from: "microdata" as const }));
  const seen = new Set<string>();
  return found.filter(({ data }) => {
    const key = JSON.stringify([data.name, list(data.recipeIngredient ?? data.ingredients).length]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
