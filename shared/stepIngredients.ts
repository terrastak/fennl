import {
  amountsWithin,
  readIngredient as readLine,
  unitNamed,
  type IngredientAmount,
} from "./ingredients";
import type { DirectionStep, IngredientLine } from "./recipe";

/**
 * The ingredients each step of the method uses (U16, owner's choices 2026-11-04), worked out
 * from the recipe as written: nothing is stored, and the recipe's words never change. Cook mode
 * shows them above each step and the recipe page under it.
 *
 * A wrong ingredient is worse than a missing one (the cook adds it to the bowl), so a step only
 * lists what it clearly names, and Fennl says when it isn't sure instead of guessing, but only
 * when there is real doubt: "pepper" is the black pepper, "the sugar" the plain sugar, and "a
 * little of the butter" is just a little. Amounts are worked out only when the arithmetic is
 * certain ("the remaining ¼ cup sugar"); otherwise the step says it uses some of the line.
 */

/** How a step uses a listed ingredient (or what it uses instead). */
export type StepUse =
  /** The whole line. */
  | { kind: "all"; lineId: string }
  /**
   * The step writes its own amount: `text.slice(start, end)` of the step is "3/4 cup" in "Beat
   * the butter with 3/4 cup of the sugar", so it's shown scaled exactly like the step.
   * `remaining` when the step says so ("the remaining 1/4 cup").
   */
  | {
      kind: "written";
      lineId: string;
      start: number;
      end: number;
      /** The step's words for the ingredient: "sugar". */
      name: string;
      remaining?: true;
    }
  /**
   * What's left of the line, worked out exactly ("the remaining sugar": ¼ cup). `fromSteps` when
   * that took away amounts the method writes, which may not scale like the line: a count ("2 of
   * the eggs") never does, and a held line doesn't while the method's measures do.
   */
  | {
      kind: "remaining";
      lineId: string;
      value: number;
      unit: string | null;
      fromSteps?: "counts" | "measures";
    }
  /** A share named in words and worked out exactly ("half the butter": 1 tbsp). */
  | { kind: "part"; lineId: string; value: number; unit: string | null; words: string }
  /** A small amount the step names in words, shown with them: "a little of the butter". */
  | { kind: "small"; lineId: string; words: string }
  /** Part of the line, and the recipe doesn't say how much. */
  | { kind: "some"; lineId: string }
  /** The step names something two or more lines fit equally ("the cheese"). */
  | { kind: "which"; lineIds: string[]; word: string; names: string[] }
  /** "The flour mixture", made in an earlier step: its ingredients aren't listed again. */
  | { kind: "mixture"; name: string; fromStepId: string; lineIds: string[] };

export interface StepIngredientOptions {
  /** A linked recipe's title by the line's id ("Coleslaw"), so "the slaw" finds the line. */
  linkedTitles?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

// The same lines are read again and again as the recipe is shown: read each once.
const readCache = new Map<string, ReturnType<typeof readLine>>();
function readIngredient(text: string): ReturnType<typeof readLine> {
  let read = readCache.get(text);
  if (!read) {
    if (readCache.size > 2000) readCache.clear();
    read = readLine(text);
    readCache.set(text, read);
  }
  return read;
}

/** A word as matched: lower case, no accents, singular. */
function root(word: string): string {
  let r = rootCache.get(word);
  if (r === undefined) {
    if (rootCache.size > 20000) rootCache.clear();
    r = rootOf(word);
    rootCache.set(word, r);
  }
  return r;
}

const rootCache = new Map<string, string>();

function rootOf(word: string): string {
  const w = word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/['’]s?$/u, "");
  const special = IRREGULAR[w];
  if (special) return special;
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(?:ches|shes|sses|xes|oes)$/u.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) {
    return w.slice(0, -1);
  }
  return w;
}

const IRREGULAR: Record<string, string> = {
  leaves: "leaf",
  halves: "half",
  loaves: "loaf",
  knives: "knife",
  molasses: "molasses",
  hummus: "hummus",
  couscous: "couscous",
  asparagus: "asparagus",
  chives: "chive",
  cloves: "clove",
  olives: "olive",
};

const set = (words: string) => new Set(words.split(/\s+/u).filter(Boolean).map(root));

/** Words in an ingredient that say how it's prepared or bought, not what it is. */
const PLAIN = set(`
  fresh freshly large small medium big extra virgin chopped diced minced sliced grated shredded
  softened melted warm warmed cold hot room temperature plus more divided optional finely roughly
  coarsely thinly peeled cut into piece cube inch taste about each good quality whole packed
  loosely lightly heaping level unsalted salted dried ground boneless skinless raw cooked canned
  frozen ripe firm sifted all purpose granulated kosher jumbo thawed lukewarm boiling chilled
  beaten halved quartered trimmed rinsed drained crumbled cubed toasted shelled pitted seeded
  deveined zested juiced crushed julienned mashed packaged prepared homemade store bought
  storebought organic natural pure regular plain lean very additional extra unpeeled
  `);

/** Measures, never an ingredient: "a tablespoon of water" is the water. */
const MEASURES = set(`
  cup tablespoon teaspoon tbsp tsp tbs ounce oz pound lb lbs gram kilogram kg ml milliliter liter
  litre quart pint gallon
  `);

/** Little words that join others and are never an ingredient. */
const STOP = set(`
  a an the of and or with for to in on into onto at by from over then until your this that these
  those it them some all each more any other another few couple well also as up out off about
  half quarter third one two three four five six seven eight nine ten twelve per ingredient
  `);

/** A name's words as matched, without joining or preparation words. */
const namedWords = (phrase: string) =>
  phrase
    .split(/[\s-]+/u)
    .map(root)
    .filter((w) => w && !STOP.has(w) && !PLAIN.has(w));

/** Words that, before a head word, still mean its ordinary kind ("granulated" sugar). */
const GENERIC: Record<string, Set<string>> = {
  sugar: set("white cane caster castor superfine table fine granulate"),
  flour: set("white unbleached ap"),
  salt: set("table fine coarse iodized sea"),
  pepper: set("black cracked coarse peppercorn"),
  butter: set("sweet cream"),
  milk: set("dairy cow low fat skim skimmed reduced semi 2 1"),
  egg: set("free range"),
  water: set("tap filtered cool ice"),
  cream: set("heavy whipping double"),
  rice: set("white"),
  yeast: set("active dry instant rapid rise"),
};

/** A recipe's own parts: "the sauce" is the one the recipe makes, not the soy sauce. */
const DISH_WORDS = set(
  "sauce dressing glaze filling frosting topping marinade gravy icing dough batter crust flake powder",
);

/** A bare "pepper" is the black pepper: never a bell pepper or a jalapeño (owner 2026-11-04). */
const ONLY_THE_ORDINARY = set("pepper");

/** Two-word names that are their own thing: "brown sugar" in a step is never "sugar". */
const COMPOUNDS = [
  "peanut butter",
  "almond butter",
  "cashew butter",
  "sunflower butter",
  "seed butter",
  "cocoa butter",
  "apple butter",
  "nut butter",
  "garlic butter",
  "butter bean",
  "coconut milk",
  "almond milk",
  "oat milk",
  "soy milk",
  "rice milk",
  "condensed milk",
  "evaporated milk",
  "coconut cream",
  "cream cheese",
  "goat cheese",
  "cottage cheese",
  "sour cream",
  "ice cream",
  "cream of tartar",
  "brown sugar",
  "powdered sugar",
  "icing sugar",
  "confectioner sugar",
  "coconut sugar",
  "cinnamon sugar",
  "maple sugar",
  "almond flour",
  "coconut flour",
  "cake flour",
  "bread flour",
  "rice flour",
  "corn flour",
  "chickpea flour",
  "whole wheat flour",
  "pastry flour",
  "self rising flour",
  "self raising flour",
  "egg white",
  "egg yolk",
  "egg wash",
  "egg noodle",
  "chicken stock",
  "vegetable stock",
  "beef stock",
  "chicken broth",
  "vegetable broth",
  "beef broth",
  "bone broth",
  "chocolate chip",
  "white chocolate",
  "milk chocolate",
  "cocoa powder",
  "baking powder",
  "baking soda",
  "garlic powder",
  "onion powder",
  "chili powder",
  "curry powder",
  "garlic salt",
  "onion salt",
  "celery salt",
  "seasoned salt",
  "celery seed",
  "tomato paste",
  "tomato sauce",
  "tomato soup",
  "tomato juice",
  "lemon juice",
  "lime juice",
  "orange juice",
  "apple juice",
  "lemon zest",
  "lime zest",
  "orange zest",
  "lemon pepper",
  "olive oil",
  "coconut oil",
  "sesame oil",
  "vegetable oil",
  "canola oil",
  "peanut oil",
  "chili oil",
  "garlic oil",
  "cider vinegar",
  "rice vinegar",
  "wine vinegar",
  "apple cider",
  "corn syrup",
  "maple syrup",
  "golden syrup",
  "soy sauce",
  "fish sauce",
  "hot sauce",
  "barbecue sauce",
  "bbq sauce",
  "pasta sauce",
  "pasta water",
  "cooking water",
  "corn starch",
  "potato starch",
  "sweet potato",
  "green bean",
  "black bean",
  "kidney bean",
  "pinto bean",
  "vanilla bean",
  "pie crust",
  "bread crumb",
  "cake mix",
  "pudding mix",
  "onion soup",
  "chicken soup",
  "mushroom soup",
  "puff pastry",
  "pie filling",
  "chicken bouillon",
  "beef bouillon",
  "pork rind",
  "bacon fat",
  "bacon grease",
  "half and half",
  "green onion",
  "spring onion",
  "red pepper flake",
  "pepper flake",
  "chili flake",
  "coconut water",
  "coconut flake",
  "rice wine",
  "white wine",
  "red wine",
  "graham cracker",
  "worcestershire sauce",
]
  .map((p) => namedWords(p))
  // "hot sauce" is just "sauce" once its describing word is set aside: not a name of its own.
  .filter((words) => words.length >= 2);

/** Names that mean the same thing. */
const SYNONYMS = [
  ["chickpea", "garbanzo bean", "garbanzo"],
  ["eggplant", "aubergine"],
  ["zucchini", "courgette"],
  ["arugula", "rocket", "rocket leaf"],
  ["scallion", "green onion", "spring onion"],
  ["cilantro", "coriander leaf"],
  ["powdered sugar", "confectioner sugar", "icing sugar"],
  ["caster sugar", "castor sugar", "superfine sugar"],
  ["baking soda", "bicarbonate of soda", "bicarbonate soda", "bicarb soda", "bicarb"],
  ["bell pepper", "capsicum", "sweet pepper"],
  ["ground beef", "minced beef", "beef mince"],
  ["vanilla", "vanilla extract", "vanilla essence"],
  ["slaw", "coleslaw"],
  ["shrimp", "prawn"],
  ["cornstarch", "corn starch", "cornflour"],
  ["broth", "stock"],
  ["chicken broth", "chicken stock"],
  ["beef broth", "beef stock"],
  ["vegetable broth", "vegetable stock"],
  ["bread crumb", "breadcrumb"],
].map((group) => group.map((p) => namedWords(p)).filter((words) => words.length > 0));

/** Words for several lines at once: "the nuts", "the herbs", "the cheese", "the pasta". */
const FAMILIES: Record<string, Set<string>> = {
  nut: set("nut almond cashew hazelnut pecan pistachio walnut peanut macadamia"),
  herb: set(
    "herb basil cilantro dill marjoram oregano parsley rosemary sage tarragon thyme mint chive chervil",
  ),
  cheese: set(`cheese cheddar feta gruyere mozzarella parmesan parmigiano pecorino provolone ricotta
    romano asiago gouda brie swiss fontina havarti mascarpone halloumi jack colby emmental`),
  chocolate: set("chocolate"),
  berry: set("berry blueberry raspberry strawberry blackberry cranberry"),
  spice: set("spice cinnamon nutmeg allspice cumin coriander paprika cardamom turmeric cayenne"),
  pasta: set(`pasta spaghetti macaroni penne linguine fettuccine fettuccini rigatoni fusilli orzo
    farfalle ziti lasagna lasagne tagliatelle pappardelle bucatini vermicelli rotini spaghettini
    capellini orecchiette campanelle cavatappi gemelli`),
};
const GROUP_WORDS = set("nut herb cheese chocolate berry spice pasta");
/** Group words for a line that doesn't say the word: "the cheese" might be the Parmesan. */
const WIDE_GROUPS = set("cheese pasta");
/** Group words that, said once, still mean every kind: "the pasta" is the fusilli and the penne. */
const MASS_GROUPS = set("pasta");

/** How a piece is cut ("beef cubes" is the beef cut into cubes). */
const FORMS: Record<string, string> = {
  chunk: "chunk",
  chunked: "chunk",
  cube: "cube",
  cubed: "cube",
  dice: "dice",
  diced: "dice",
  slice: "slice",
  sliced: "slice",
  strip: "strip",
  piece: "piece",
  round: "round",
  wedge: "wedge",
};

/** Words that name a piece of something, so the word before is what it is: "garlic cloves". */
const PIECE_WORDS = set(
  "clove stalk rib stick sprig leaf piece slice strip cube wedge fillet head bunch ear floret round sheet bar segment",
);

/** Things made from an ingredient: "the chicken" isn't the chicken broth. */
const MADE_FROM = set(`
  broth stock bouillon powder paste sauce juice zest peel rind extract essence syrup vinegar oil
  butter milk cream flour meal starch sugar salt seasoning flake seed water wine liqueur spread jam
  jelly soup chip crumb crust mix fat drippings dressing marinade glaze noodle pasta
  `);

/** Words that name their sauce on their own: "add the Worcestershire". */
const NAMES_ALONE = set("worcestershire hoisin sriracha tabasco teriyaki marinara pesto tahini");

/** Words that turn a name into something else when they follow it ("lemon juice", "pasta water"). */
const AFTER_A_NAME = new Set([
  ...MADE_FROM,
  ...set(`shell skin bone rind fat liquid juices grease bath wash crumble topping filling frosting
    icing batter dough streusel gravy pie cake bread pizza tart muffin cookie loaf salad soup
    sandwich rub blend mousse pudding ganache brownie truffle fudge cheesecake cupcake`),
]);

/** Kitchen things named after an ingredient: "butter knife", "pepper mill", "cake pan". */
const TOOLS = set(`
  knife grater slicer cutter pan dish plate tin mold mould pot bowl board sheet rack tray spoon
  press peeler masher thermometer brush scoop spatula stone paper mill grinder shaker machine
  processor maker cooker spreader server lifter tongs container jar bag wrap ramekin skillet
  `);

/** Words that, starting a clause, are an action: "Cream the butter", "Brown the beef". */
const ACTIONS = set(`
  cream brown season roast toast bread ice top core shell stone pit grill smoke stuff chop cube
  slice dice mince spread drizzle mash puree crumble press skin bone peel rub mix roll sprinkle
  wrap punch fillet squash split scoop stick crush flake puff dash splash pat knob dress cure dust
  coat glaze line fold beat whip pipe frost layer ladle steam poach cover
  `);

/** Describing words that never name an ingredient on their own ("brown" in "brown sugar"). */
const DESCRIBING = set(`
  red green yellow white black brown orange purple golden sweet hot dry light dark sour heavy
  double single self rising raising smoked sharp mild baby young aged wild sweetened unsweetened
  semisweet bittersweet roasted fried grilled powdered instant active quick rolled old fashioned
  low fat sodium reduced free gluten non real best thick thin baking cooking frying roasting pie
  cake loaf sheet pan dish bowl pot oven skillet flat italian mexican french greek english
  pizza burger sandwich taco soup salad cookie muffin biscuit tart slider
  american asian thai chinese japanese indian spanish new top bottom side long short wide fine
  rise rapid
  `);

const PRODUCT_PIECES = set("chip chunk morsel bar");
const OF_HEADS = set("juice zest rind peel");
const BEFORE_ACTION = set("then and to also gently lightly well or");
const MIXTURE = set("mixture mix");
const OBJECT_WORDS = set("the a an your it them together until well in with all each");

const stepCache = new Map<string, { list: Token[]; amounts: IngredientAmount[] }>();

/** A step's words and amounts, read once per text (the page works it out on every change). */
function stepWords(text: string): { list: Token[]; amounts: IngredientAmount[] } {
  let read = stepCache.get(text);
  if (!read) {
    if (stepCache.size > 2000) stepCache.clear();
    read = { list: tokens(text), amounts: amountsWithin(text) };
    stepCache.set(text, read);
  }
  return read;
}

const lineWordsCache = new Map<string, Set<string>>();

/** Every word of a line, as roots ("minced", "fresh" too). */
function lineWords(id: Identity): Set<string> {
  let words = lineWordsCache.get(id.line.text);
  if (!words) {
    if (lineWordsCache.size > 2000) lineWordsCache.clear();
    words = new Set(tokens(id.line.text).map((x) => x.root));
    lineWordsCache.set(id.line.text, words);
  }
  return words;
}

/** A word in a step, where it's written. */
interface Token {
  raw: string;
  root: string;
  start: number;
  end: number;
  /** Only spaces or a hyphen between it and the word before. */
  joined: boolean;
  /** A content word: not a joining word and not a preparation word. */
  content: boolean;
}

function tokens(text: string): Token[] {
  const found: Token[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)) {
    const raw = m[0];
    const r = root(raw);
    const prev = found.at(-1);
    const between = prev ? text.slice(prev.end, m.index) : "";
    found.push({
      raw,
      root: r,
      start: m.index,
      end: m.index + raw.length,
      joined: !!prev && /^[\s\-‐‑]+$/u.test(between),
      content:
        /\p{L}/u.test(raw) &&
        raw.length > 1 &&
        !STOP.has(r) &&
        !PLAIN.has(r) &&
        // "peanut butter cups": a product, after its name.
        (!MEASURES.has(r) || (!!prev?.content && /^\s+$/u.test(between))),
    });
  }
  return found;
}

const contentCache = new Map<string, string[]>();

/** A text's content words, as roots (a fresh array each time: callers may add to it). */
function contentRoots(text: string): string[] {
  let words = contentCache.get(text);
  if (!words) {
    if (contentCache.size > 5000) contentCache.clear();
    words = tokens(text)
      .filter((t) => t.content)
      .map((t) => t.root);
    contentCache.set(text, words);
  }
  return [...words];
}

const same = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((w, i) => w === b[i]);

const endsWith = (words: readonly string[], tail: readonly string[]) =>
  tail.length <= words.length && same(words.slice(words.length - tail.length), tail);

/** The last two words of every name of its own: "butter chip" for "peanut butter chip" too. */
const COMPOUND_ENDS = new Set(
  COMPOUNDS.flatMap((c) => c.slice(0, -1).map((_, i) => c.slice(i).join(" "))),
);

const isCompound = (pair: readonly string[]) => COMPOUND_ENDS.has(pair.join(" "));

/** Synonym groups by the last word of each of their names. */
const SYNONYMS_BY_LAST = new Map<string, string[][][]>();
for (const group of SYNONYMS) {
  for (const alias of group) {
    const last = alias.at(-1) ?? "";
    const list = SYNONYMS_BY_LAST.get(last) ?? [];
    if (!list.includes(group)) list.push(group);
    SYNONYMS_BY_LAST.set(last, list);
  }
}

// ---------------------------------------------------------------------------------------------
// Ingredient lines
// ---------------------------------------------------------------------------------------------

interface Phrase {
  words: string[];
  /** Longer and more exact phrases win: the whole name over a part of it. */
  score: number;
}

interface Identity {
  line: IngredientLine;
  /** Its section in the ingredient list (-1 before any heading). */
  section: number;
  /** Each way of naming it ("salt" and "pepper" in "Salt and pepper to taste"), as roots. */
  options: string[][];
  phrases: Phrase[];
  heads: Set<string>;
  /** Single-word other names ("rocket" for arugula, "slaw" for coleslaw). */
  aliases: Set<string>;
  /** Its other words ("pork" in "pork shoulder"). */
  others: Set<string>;
  all: Set<string>;
  forms: Set<string>;
  families: Set<string>;
  divided: boolean;
  /** For dusting, garnish or serving, or optional: the main line wins over it. */
  secondary: boolean;
  /** Heads whose name is a thing of its own ("onion" in "green onions"). */
  compoundHeads: Set<string>;
  /** For serving or garnish: only a step that serves uses it. */
  serving: boolean;
  /** Heads only of a stand-in ("… or 1 1/2 tablespoons water"): a line that is that thing wins. */
  insteadHeads: Set<string>;
  /** Its amount is a count ("2 eggs", "1 red bell pepper"), not a measure. */
  counted: boolean;
}

/** An ingredient line's name: "sugar" in "1 cup sugar, divided". */
export function ingredientName(text: string): string {
  const read = readIngredient(text);
  let item = read.item ?? text;
  // "4 boneless, skinless chicken breasts": the name is after the comma.
  if (contentRoots(item).length === 0 && read.note) {
    item = `${item} ${read.note.split(/[,;]/u)[0] ?? ""}`;
  }
  return (
    item
      .replace(/\s*\((?:[^)]*)\)\s*/gu, " ")
      .replace(/,?\s+such as\b.*$/iu, "")
      // "pineapple slices in 100% pineapple juice": the slices, not the juice.
      .replace(
        /\s+(?:packed\s+)?in\s+(?:(?:its|their)\s+own\s+|light\s+|heavy\s+|\d+%\s+)?[\p{L}\s-]{0,30}?\b(?:juices?|syrup|water|oil|brine|sauce|liquid)\b.*$/iu,
        "",
      )
      .replace(/^\s*(?:optional|garnish|to serve)\b[^:]*:\s*/iu, "")
      .replace(
        /\s+(?:divided|to taste|for\s|from\s|plus\s|as needed|optional|or more|if (?:needed|desired|you like))(?:\b|\s).*$/iu,
        "",
      )
      .replace(/^(?:of\s+)/iu, "")
      .replace(/\s+/gu, " ")
      .trim()
  );
}

/** The ways an ingredient's name can be written: "Salt and pepper" is salt, and pepper. */
function optionsOf(name: string): string[][] {
  if (/\bhalf[\s-]+(?:and|&|n)[\s-]+half\b/iu.test(name)) return [["half", "and", "half"]];
  const parts = name
    .split(/\s+(?:or|and|&|n)\s+|\s*[/&]\s*|\s+plus\s+/iu)
    // "… or 1 1/2 tablespoons water": each choice has its own amount.
    .map((part) => contentRoots(readIngredient(part).item ?? part))
    .filter((words) => words.length > 0);
  // "semisweet chocolate or peanut butter chips": chocolate chips too.
  const last = parts.at(-1);
  const tail = last?.at(-1);
  if (parts.length > 1 && tail && PRODUCT_PIECES.has(tail)) {
    for (const option of parts.slice(0, -1)) {
      if (option.at(-1) !== tail) option.push(tail);
    }
  }
  // "instant or rapid-rise yeast": the instant yeast.
  if (parts.length > 1 && tail) {
    for (const option of parts.slice(0, -1)) {
      if (option.every((w) => DESCRIBING.has(w) || GENERIC[tail]?.has(w))) option.push(tail);
    }
  }
  return parts;
}

/** The heads of a name's "or" choices after the first, that aren't the first's head too. */
function insteadHeads(name: string, options: string[][]): Set<string> {
  const firstHead = options[0]?.at(-1);
  const choices = name
    .split(/\s+or\s+/iu)
    .slice(1)
    .flatMap((choice) => choice.split(/\s+(?:and|&)\s+/iu));
  const heads = new Set<string>();
  for (const choice of choices) {
    const head = contentRoots(readIngredient(choice).item ?? choice).at(-1);
    if (head && head !== firstHead) heads.add(head);
  }
  return heads;
}

// A line's reading depends only on its words (and a linked recipe's title): kept between calls,
// since the page works it out again on every change.
const identityCache = new Map<string, Identity>();

function identify(line: IngredientLine, section: number, title: string | undefined): Identity {
  const key = `${line.text}\u0000${title ?? ""}\u0000${line.linkedRecipeId ? 1 : 0}`;
  let read = identityCache.get(key);
  if (!read) {
    if (identityCache.size > 2000) identityCache.clear();
    read = identifyLine(line, title);
    identityCache.set(key, read);
  }
  return { ...read, line, section };
}

function identifyLine(line: IngredientLine, title: string | undefined): Identity {
  const section = -1;
  const name = ingredientName(line.text);
  const read = readIngredient(line.text);
  const options = optionsOf(name);
  // "Kosher salt, freshly ground pepper": a list with no amount, so each is a name.
  if (!read.amounts.length && read.note) {
    for (const part of read.note.split(/[,;]/u)) {
      const words = optionsOf(ingredientName(`1 ${part.trim()}`)).flat();
      if (words.length && !/\b(?:to taste|for|as needed|optional)\b/iu.test(part))
        options.push(words);
    }
  }
  if (title) {
    const words = contentRoots(title);
    if (words.length) options.push(words);
  }
  const phrases: Phrase[] = [];
  const heads = new Set<string>();
  const aliases = new Set<string>();
  const all = new Set<string>();
  const families = new Set<string>();
  const addPhrase = (words: string[], score: number) => {
    if (words.length >= 2 && !phrases.some((p) => same(p.words, words))) {
      phrases.push({ words, score });
    }
  };
  const full = options.flat();
  if (options.length > 1) addPhrase(full, 600 + full.length);
  for (const option of options) {
    option.forEach((w) => all.add(w));
    const head = option.at(-1);
    if (!head) continue;
    heads.add(head);
    // "garlic cloves": garlic. "juice of 1 lemon": juice as well.
    const before = option.at(-2);
    // "garlic cloves", "bacon slices": the garlic, the bacon ("slices" alone could be anything).
    if (PIECE_WORDS.has(head) && before && !DESCRIBING.has(before)) {
      heads.add(before);
      heads.delete(head);
    }
    const ofAt = option.findIndex((w) => OF_HEADS.has(w));
    if (ofAt >= 0 && ofAt < option.length - 1) {
      heads.add(option[ofAt] as string);
      // "zest of 1 lemon" is the lemon zest.
      addPhrase([...option.slice(ofAt + 1), option[ofAt] as string], 500 + option.length);
    }
    // "hash browns": "golden brown" isn't them.
    if (DESCRIBING.has(head) && option.length > 1) heads.delete(head);
    addPhrase(option, 500 + option.length);
    // "bow ties" for "bow tie pasta".
    if (WIDE_GROUPS.has(head) && option.length >= 3) addPhrase(option.slice(0, -1), 450);
    // "the fusilli" for "fusilli pasta".
    const kind = option[0];
    if (MASS_GROUPS.has(head) && option.length === 2 && kind && !DESCRIBING.has(kind)) {
      aliases.add(kind);
    }
    // A tail of the name, ending at its head: "cheddar cheese" for "sharp cheddar cheese".
    for (let i = 1; i < option.length - 1; i++) addPhrase(option.slice(i), 400 + option.length - i);
    // "flaky salt" for "flaky sea salt": without the words that still mean the ordinary kind.
    const generic = GENERIC[head];
    const short = generic ? option.filter((w, k) => k === 0 || w === head || !generic.has(w)) : [];
    if (short.length >= 2 && short.length < option.length) addPhrase(short, 450 + short.length);
    for (const group of SYNONYMS_BY_LAST.get(head) ?? []) {
      if (!group.some((alias) => endsWith(option, alias))) continue;
      for (const alias of group) {
        if (alias.length >= 2) addPhrase(alias, 450 + alias.length);
        else if (alias[0]) aliases.add(alias[0]);
      }
    }
    for (const [family, words] of Object.entries(FAMILIES)) {
      if (words.has(head) || (before && family === "cheese" && words.has(before))) {
        families.add(family);
      }
    }
  }
  // A name's words are its own unless the name is a thing of its own ("coconut milk").
  const others = new Set<string>();
  for (const option of options) {
    const head = option.at(-1) ?? "";
    for (const w of option) if (NAMES_ALONE.has(w)) others.add(w);
    if (MADE_FROM.has(head)) continue;
    if (option.length >= 2 && isCompound(option.slice(-2))) continue;
    for (const w of option.slice(0, -1)) {
      if (!heads.has(w) && !DESCRIBING.has(w) && !ACTIONS.has(w) && w.length >= 3) others.add(w);
    }
  }
  const forms = new Set<string>();
  for (const w of tokens(line.text)) {
    const form = FORMS[w.raw.toLowerCase()] ?? FORMS[w.root];
    if (form) forms.add(form);
  }
  const main = read.amounts.find((a) => a.role === "main");
  const mainUnit = main?.unit ? unitNamed(main.unit) : undefined;
  return {
    line,
    section,
    options,
    phrases,
    heads,
    aliases,
    others,
    all,
    forms,
    families,
    divided: /\bdivided\b(?!\s+(?:at|into|in half|between))/iu.test(line.text),
    secondary:
      /^\s*(?:optional|garnish|to serve|for serving)\b/iu.test(line.text) ||
      (!main &&
        /\b(?:for|to)\s+(?:dust|grease|garnish|serv|decorat|fry|sprinkl|brush|roll|top|finish)|\boptional\b/iu.test(
          line.text,
        )),
    // "Parmesan, for serving" (but not "parsley, plus more for serving": that's mostly for now).
    insteadHeads: insteadHeads(name, options),
    serving:
      !/\bplus\b/iu.test(line.text) &&
      /\b(?:for|to)\s+(?:serv|garnish|decorat|top)|^\s*(?:optional\s*:?\s*)?garnish/iu.test(
        line.text,
      ),
    compoundHeads: new Set(
      options.filter((o) => o.length >= 2 && isCompound(o.slice(-2))).map((o) => o.at(-1) ?? ""),
    ),
    counted: !!main && (!mainUnit || mainUnit.kind === "count"),
  };
}

/** A line's words before its head, for telling two lines apart ("sharp cheddar", "Parmesan"). */
function nameBesides(text: string, words: readonly string[]): string {
  const word = words.at(-1) ?? "";
  const name = ingredientName(text);
  const option =
    name.split(/\s+(?:or|and|&)\s+|\s*\/\s*/iu).find((part) => contentRoots(part).includes(word)) ??
    name;
  const list = tokens(option);
  return list
    .filter(
      (t, k) =>
        // "whole wheat", not "wheat".
        (t.content || (t.root === "whole" && /^(?:wheat|grain)/iu.test(list[k + 1]?.raw ?? ""))) &&
        !words.includes(t.root) &&
        !PIECE_WORDS.has(t.root) &&
        !/\d/u.test(t.raw),
    )
    .map((t) => t.raw)
    .join(" ");
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

const SECTION_FILLER = set("for make making prepare preparing assemble assembling to serve");

const sectionWords = (heading: string) =>
  new Set(contentRoots(heading.replace(/:$/u, "")).filter((w) => !SECTION_FILLER.has(w)));

/**
 * The lines a method section can use: when both lists have matching headings ("For the crust"),
 * a method section only uses its own ingredient section (and lines before any heading).
 */
function scopes(identities: Identity[], ingredients: readonly IngredientLine[]) {
  const headings = ingredients.filter((l) => l.heading).map((l) => sectionWords(l.text));
  const bySection = new Map<number, Identity[]>();
  return (methodHeading: string | null): { pool: Identity[]; section: number | null } => {
    const everything = { pool: identities, section: null };
    if (!methodHeading || headings.length === 0) return everything;
    const words = sectionWords(methodHeading);
    const matches = headings
      .map((h, i) => ({ i, n: [...words].filter((w) => h.has(w)).length }))
      .filter((m) => m.n > 0);
    const section = matches[0]?.i;
    if (matches.length !== 1 || section === undefined) return everything;
    let scoped = bySection.get(section);
    if (!scoped) {
      scoped = identities.filter((id) => id.section === -1 || id.section === section);
      bySection.set(section, scoped);
    }
    return { pool: scoped, section };
  };
}

// ---------------------------------------------------------------------------------------------
// Finding mentions in a step
// ---------------------------------------------------------------------------------------------

/** An amount a step writes; `unscaled` when the step's words don't scale ("half a cup"). */
type StepAmount = IngredientAmount & { unscaled?: true };

type Share =
  | { kind: "plain" }
  /** "more salt", "the other cheeses": not the amount listed. */
  | { kind: "skip" }
  | {
      kind: "written";
      amount: StepAmount;
      exact: boolean;
      remaining: boolean;
      /** The step's words for it ("sugar"), once known. */
      name?: string;
    }
  /** Two amounts of it in one step ("Grate 2 tablespoons butter ... the remaining 8"). */
  | {
      kind: "several";
      amounts: { amount: StepAmount; exact: boolean; remaining: boolean; name?: string }[];
      /** And what's left: "Stir in 3 cups of the coconut … the remaining cup of coconut". */
      rest?: true;
    }
  /** "a little of the butter … the remaining butter" in one step: all of it, here. */
  | { kind: "whole" }
  | { kind: "part"; fraction: number; words: string }
  /** A number with no unit: "with 1 egg", "the remaining 1/4 chicken broth". */
  | { kind: "bare"; value: number; start: number; end: number; remaining: boolean }
  | { kind: "remaining" }
  | { kind: "reserved" }
  | { kind: "portion"; words: string }
  | { kind: "small"; words: string };

interface Mention {
  /** Where the step names it, and its first and last words. */
  start: number;
  end: number;
  first: number;
  last: number;
  /** One line, or the lines it might be. */
  ids: Identity[];
  which: boolean;
  word: string;
  share: Share;
  /** "the flour mixture": the step's words for it. */
  mixture?: string;
  /** "the melted chocolate", when it's made by melting it in an earlier step. */
  melted?: boolean;
  /** Lines that read alike (the cake's butter and the frosting's), until a section settles it. */
  tie?: boolean;
  /** "1 teaspoon of each of …": the amount goes with the names after it too. */
  eachOf?: boolean;
  /** "dust with flour": the measured line only if it isn't already in. */
  dusting?: boolean;
  /** "serve with butter": the measured line only if it isn't already in. */
  serving?: boolean;
  /** What the words around it say it's for, when it isn't simply a use. */
  aside?: ReturnType<typeof incidental>;
  /** "the sugars": every line it might be, until it's known which the step means. */
  every?: true;
  /** "the sugars" of three: not sure which, unless the step's part settles it. */
  unsureEvery?: true;
  /** "sparkling sugar … dredge in sugar": the line named just before, if this one is in already. */
  backRef?: Identity;
  /** Picked as the ordinary one among these lines from different sections. */
  across?: Identity[];
  /** Picked by the amount the step writes, not by name. */
  sized?: true;
}

/** A line made by a part of this recipe: "4 cups Marinara Sauce, recipe follows". */
const MADE_BELOW = /\brecipe\s+(?:follows|below)\b|\bsee\s+(?:recipe\s+)?below\b|\(below\)/iu;

/** A line a step greases a pan with: "Butter, for greasing", "Oil", not "1/2 cup butter". */
const forThePan = (id: Identity) => id.secondary || !/[\d½¼¾⅓⅔⅛]/u.test(id.line.text);

const LEAD_WORDS = new Set([...set("the your of this that"), ...PLAIN]);

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/** A share in words ("half the butter"), or as a number with "of" ("1/2 of the butter"). */
const FRACTION_WORDS: [RegExp, number, boolean][] = [
  [/\bhalf(?:\s+an?)?$/iu, 1 / 2, false],
  [/\b(?:a|one)\s+third$/iu, 1 / 3, false],
  [/\btwo\s+thirds$/iu, 2 / 3, false],
  [/\b(?:a|one)\s+quarter$/iu, 1 / 4, false],
  [/\bthree\s+quarters$/iu, 3 / 4, false],
  [/(?:\b1\/2|½)$/iu, 1 / 2, true],
  [/(?:\b1\/3|⅓)$/iu, 1 / 3, true],
  [/(?:\b2\/3|⅔)$/iu, 2 / 3, true],
  [/(?:\b1\/4|¼)$/iu, 1 / 4, true],
  [/(?:\b3\/4|¾)$/iu, 3 / 4, true],
];

const BARE =
  /(?:^|\s)(\d+\s+\d\/\d|\d+\/\d+|\d*[½¼¾⅓⅔⅛]|\d*\.\d+|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/iu;
const VULGAR_VALUES: Record<string, number> = {
  "½": 1 / 2,
  "¼": 1 / 4,
  "¾": 3 / 4,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 1 / 8,
};

function bareValue(written: string): number | null {
  const mixed = /^(\d+)\s+(\d)\/(\d)$/u.exec(written);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/u.exec(written);
  if (fraction) return Number(fraction[2]) ? Number(fraction[1]) / Number(fraction[2]) : null;
  const glyph = /^(\d*)([½¼¾⅓⅔⅛])$/u.exec(written);
  if (glyph) return Number(glyph[1] || 0) + (VULGAR_VALUES[glyph[2] ?? ""] ?? 0);
  const word = NUMBER_WORDS[written.toLowerCase()];
  if (word) return word;
  const n = Number(written);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "… on each tortilla", "… per biscuit": what one piece gets. */
const PER_PIECE =
  /^[^.;!?,]{0,40}?\b(?:per\s+[\p{L}]+|(?:on|onto|in|into|over|for|to|inside)\s+each(?:\s+[\p{L}]+)?)/iu;

const SMALL =
  /\b(an?\s+(?:(?:small|little|tiny|good|generous|big|large|light)\s+)?(?:little(?:\s+bit)?|bit|pinch|dash|splash|drizzle|knob|pat|handful|touch|sprinkle|sprinkling|squeeze|few\s+(?:drops|dashes|sprinkles|pinches|shakes|grinds|splashes)|dollop|smidgen|spoonful|dab|teaspoon|tablespoon|cup|splash)(?:\s+(?:more|extra))?(?:\s+of)?)\s*$/iu;

/** How much of a line the words before its mention say the step uses. */
function shareBefore(text: string, start: number, end: number, amounts: IngredientAmount[]): Share {
  // The joining and preparation words right before it: "of the remaining melted". Only the
  // words just before it matter.
  const from = Math.max(0, start - 60);
  const before = text.slice(from, start);
  let leadStart = start;
  let hasOf = false;
  let remaining = false;
  for (const m of [...before.matchAll(/[\p{L}]+/gu)].reverse()) {
    const at = from + m.index;
    const after = text.slice(at + m[0].length, leadStart);
    if (!/^[\s\-‐‑]*$/u.test(after)) break;
    // "½ inch oil" is the oil's depth.
    if (/^inch(?:es)?$/iu.test(m[0])) break;
    const r = root(m[0]);
    if (r === "remaining") remaining = true;
    else if (!LEAD_WORDS.has(r)) break;
    if (r === "of") hasOf = true;
    leadStart = at;
  }
  const lead = text.slice(leadStart, start);
  const tail = text.slice(from, leadStart).replace(/\s+$/u, "");
  const restOf = (ahead: string) =>
    remaining || /\b(?:remaining|remainder of|rest of)(?:\s+the)?\s*$/iu.test(ahead);

  // "3/4 cup of the sugar", "1 3/4 cups (245 grams) blueberries".
  const written = amounts.find(
    (a) =>
      a.end <= leadStart &&
      /^\s*(?:\([^)]*\)\s*)?$/u.test(text.slice(a.end, leadStart)) &&
      // "a 2-inch piece of ginger" is the piece's size, not how much.
      unitNamed(a.unit ?? "")?.kind !== "length",
  );
  if (written) {
    const ahead = text.slice(Math.max(0, written.start - 40), written.start);
    const about = /\b(?:about|approximately|approx\.?|around|roughly)\s*$/iu.exec(ahead);
    const exact =
      written.high === null &&
      !written.approximate &&
      !about &&
      !/(?:~|up to|to|or|-|–)\s*$/iu.test(ahead);
    const from = about ? written.start - (ahead.length - about.index) : written.start;
    // "sprinkle 1 teaspoon of flour at a time": as the step says it.
    if (/^\s*at a time\b/iu.test(text.slice(end))) {
      return {
        kind: "small",
        words: text.slice(from, end + text.slice(end).indexOf("time") + 4),
      };
    }
    // "all but 2 tablespoons of the flour": not 2 tablespoons.
    const allBut = /\ball\s+but\s*$/iu.exec(ahead);
    if (allBut) {
      return {
        kind: "small",
        words: text.slice(written.start - (ahead.length - allBut.index), end),
      };
    }
    // "1/4 cup of the cheese on each tortilla": one piece's share, not the step's.
    const each = PER_PIECE.exec(text.slice(end));
    if (each) return { kind: "small", words: text.slice(from, end + each[0].length) };
    return {
      kind: "written",
      amount: { ...written, start: from },
      exact,
      remaining: restOf(ahead),
    };
  }
  if (/\bspray\s+with$/iu.test(tail)) return { kind: "skip" };
  if (/\b(?:more|other|another)$/iu.test(tail) && !/\bother\s+half$/iu.test(tail)) {
    return { kind: "skip" };
  }
  if (/\b(?:additional|extra|more|excess)\s/iu.test(lead) || /\bexcess$/iu.test(tail)) {
    return { kind: "skip" };
  }
  if (/\bother\s+half$/iu.test(tail)) return { kind: "remaining" };
  // "half a cup of the milk": half a cup, as the step says it.
  const halfA = /\bhalf\s+an?\s+([\p{L}]+\.?)$/iu.exec(tail);
  const halfUnit = halfA?.[1] ? amountsWithin(`1 ${halfA[1]}`)[0]?.unit : undefined;
  const halfKind = halfUnit ? unitNamed(halfUnit)?.kind : undefined;
  if (halfA && halfUnit && (halfKind === "volume" || halfKind === "weight")) {
    const at = from + halfA.index;
    return {
      kind: "written",
      amount: {
        low: 0.5,
        high: null,
        unit: halfUnit,
        role: "other",
        approximate: false,
        start: at,
        end: at + halfA[0].length,
        unscaled: true,
      },
      exact: true,
      remaining: restOf(text.slice(Math.max(0, at - 40), at)),
    };
  }
  // "half the remaining sugar", "half of the rest of the cheese": part of what's left, which
  // the recipe doesn't say exactly.
  const ofRest =
    /\b(?:half|a\s+third|a\s+quarter|some|most|part|a\s+portion)\s+(?:of\s+)?(?:the\s+)?(?:(?:rest|remainder)(?:\s+of(?:\s+the)?)?|remaining)$/iu.exec(
      `${tail}${remaining ? " remaining" : ""}`,
    );
  if (ofRest) return { kind: "small", words: text.slice(from + ofRest.index, end) };
  const small = SMALL.exec(tail);
  if (small) return { kind: "small", words: text.slice(from + small.index, end) };
  // "half a lemon": half of one lemon, as the step says it (not half of the 2 listed).
  const halfOne = /\bhalf\s+an?$/iu.exec(tail);
  if (halfOne && !hasOf) {
    const at = from + halfOne.index;
    return { kind: "bare", value: 0.5, start: at, end: at + halfOne[0].length, remaining: false };
  }
  for (const [re, fraction, needsOf] of FRACTION_WORDS) {
    const m = re.exec(tail);
    if (m && (hasOf || !needsOf)) {
      return { kind: "part", fraction, words: text.slice(from + m.index, end) };
    }
  }
  // "with 1 egg", "2 of the eggs", "the remaining 1/4 chicken broth": a number, no unit.
  const bare = BARE.exec(tail);
  const value = bare?.[1] ? bareValue(bare[1]) : null;
  // Not the end of a range ("2 or 3 chicken breasts"), nor one at a time.
  const range = bare
    ? /[\d½¼¾⅓⅔]\s*(?:or|to|-|–)\s*$/iu.test(tail.slice(0, bare.index + 1))
    : false;
  if (bare?.[1] && value && !range && !/^\s*(?:at a time|each|per)\b/iu.test(text.slice(end))) {
    const numberStart = from + bare.index + bare[0].length - bare[1].length;
    return {
      kind: "bare",
      value,
      start: numberStart,
      end: numberStart + bare[1].length,
      remaining: restOf(text.slice(Math.max(0, numberStart - 40), numberStart)),
    };
  }
  if (
    remaining ||
    /\b(?:remainder|rest|leftover)$/iu.test(tail) ||
    // "the remaining whipped cream", "the remaining toasted pecans"
    /\b(?:remaining|leftover)\s+[\p{L}-]+ed$/iu.test(tail) ||
    // "Repeat with the remaining dough, sauce, sausage and mozzarella"
    /\bremaining\s+(?:[\p{L}-]+(?:\s+[\p{L}-]+)?\s*,\s*)+(?:and\s+|&\s+)?$/iu.test(
      text.slice(sentenceStart(text, start), start),
    ) ||
    // "the remaining cup of coconut"
    /\bremaining\s+(?:cup|tablespoon|teaspoon|tbsp|tsp|ounce|oz|pound|lb|stick|can|clove|bunch)s?$/iu.test(
      tail,
    )
  ) {
    return { kind: "remaining" };
  }
  if (/\breserved$/iu.test(tail) || /\breserved\b/iu.test(lead)) return { kind: "reserved" };
  const portion = hasOf ? /\b(?:some|a portion|most|a few|a couple)$/iu.exec(tail) : null;
  if (portion) return { kind: "portion", words: text.slice(from + portion.index, end) };
  return { kind: "plain" };
}

/** The step's word is an action here ("Cream the butter"), not the ingredient. */
function isAction(text: string, tokenList: Token[], i: number): boolean {
  const t = tokenList[i];
  if (!t) return false;
  if (GREASING_VERBS.has(t.raw.toLowerCase())) return greasesSomething(text, tokenList, i);
  if (!ACTIONS.has(t.root)) return false;
  const prev = tokenList[i - 1];
  const gap = text.slice(prev ? prev.end : 0, t.start);
  if (!prev || /[.!?;:(]/u.test(gap)) return true;
  // "…, cream the butter" is an action; "the peppercorns, cream, butter" is a list.
  if (/,/u.test(gap)) return OBJECT_WORDS.has(tokenList[i + 1]?.root ?? "");
  if (!BEFORE_ACTION.has(prev.root)) return false;
  // "… and cream the butter", but not "the oregano and cream."
  if (!FOOD_ACTIONS.has(t.root)) return true;
  const next = tokenList[i + 1];
  return !!next && !/[.,;:!?)]/u.test(text.slice(t.end, next.start));
}

/** Actions that are also things in a bowl: "and cream" ends a list as often as it starts a step. */
const FOOD_ACTIONS = set("cream ice glaze crumble puree mash dressing");

/** Ingredients that are also a verb for getting a pan ready: "Oil the pan", "Butter and flour". */
const GREASING_VERBS = new Set(["oil", "butter", "flour", "grease"]);

/** Things a pan is, or the surface something is greased or floured on. */
const SURFACES = set(`
  pan dish sheet grate grill rack ramekin mold mould tin skillet bowl counter surface board towel
  parchment foil paper loaf bundt springform muffin cake baking cooking cupcake liner tray
  casserole plate griddle waffle iron work bottom side inside cup well
  `);

const GREASE_ADVERBS = set(
  "then and to also gently lightly well or generously heavily liberally thoroughly evenly",
);

/** "Oil the pan", "Butter and flour a loaf pan", "Lightly flour 2 sheets": a verb, not the line. */
function greasesSomething(text: string, list: Token[], i: number): boolean {
  const t = list[i] as Token;
  const prev = list[i - 1];
  const gap = text.slice(prev ? prev.end : 0, t.start);
  const startsClause =
    !prev || /[.!?;:(]/u.test(gap) || (!/,/u.test(gap) && GREASE_ADVERBS.has(prev.root));
  if (!startsClause) return false;
  const objectAt = (k: number): boolean => {
    const next = list[k];
    if (!next || !/^[\s-]+$/u.test(text.slice((list[k - 1] as Token).end, next.start))) {
      return false;
    }
    if (set("the a an your it them both all each").has(next.root)) return true;
    if (/^\d/u.test(next.raw) || NUMBER_WORDS[next.raw.toLowerCase()]) {
      return !/^\s*(?:times?|minutes?)\b/iu.test(text.slice(next.end));
    }
    if (SURFACES.has(next.root)) return true;
    // "Butter and flour the pan", "Grease and line a tin".
    if (next.root === "and") {
      const verb = list[k + 1];
      if (
        verb &&
        (GREASING_VERBS.has(verb.raw.toLowerCase()) || /^(?:dust|line)$/iu.test(verb.raw))
      )
        return objectAt(k + 2);
    }
    return false;
  };
  return objectAt(i + 1);
}

/** Where a step greases or flours a pan or a counter ("Grease a pan with butter"). */
const GREASE_WORDS =
  /\b(?:grease[ds]?|greasing|oil(?:ed|ing)?|butter(?:ed|ing)?|flour(?:ed|ing)?|dust(?:ed|ing)?|spray(?:ed|ing)?|brush(?:ed|ing)?|film|coat(?:ed)?|wipe[ds]?)\b/iu;

/**
 * A mention that isn't a use of the measured line: greasing or flouring a pan or a counter
 * ("Grease a pan with butter", "a floured counter … dust with flour"), water to dip a knife in,
 * the pan the bacon was cooked in, "until the sugar bubbles", "while the pasta cooks".
 */
function incidental(
  text: string,
  start: number,
): "surface" | "depth" | "dust" | "serving" | "moved" | "skip" | null {
  const before = text.slice(sentenceStart(text, start), start);
  const near = before.slice(-60);
  // "until the sugar bubbles … and the pineapple turns translucent": a sign, not a use, up to
  // the next thing to do.
  const until = [...before.matchAll(/\buntil\b/giu)].at(-1);
  if (until && !UNTIL_ENDS.test(before.slice(until.index + until[0].length))) return "skip";
  // "when the oil is hot", "while the pasta cooks", "if any pineapple sticks": what it's about.
  if (
    /\b(?:when|once|while|if|as soon as|so that)\s+(?:the\s+|your\s+|all\s+the\s+|any\s+)?(?:[\p{L}-]+\s+){0,2}$/iu.test(
      near,
    )
  ) {
    return "skip";
  }
  // "the skillet used to cook the bacon", "the pan we browned the beef in".
  if (
    /\b(?:same|used|reserved)\b[^.;,]{0,40}\b(?:cook|cooked|fry|fried|brown|browned|sear|seared|toast|toasted|render|rendered|saute|sauteed|sautéed)(?:\s+(?:up|off))?\s+(?:the\s+)?$/iu.test(
      before,
    )
  ) {
    return "skip";
  }
  // "Drain the pineapple, reserving the juice": kept for later, not used here.
  if (/\breserv(?:e|ing)\s+(?:the\s+|its\s+|their\s+|all\s+the\s+)?$/iu.test(near)) return "skip";
  // "1 inch of oil", "filled with 1 inch water": a depth, not the measured amount.
  if (
    /(?:\d|½|¼|¾|⅓|⅔)\s*(?:-|to\s+\d+\s*)?(?:inch(?:es)?|in\.|″|")\s+(?:of\s+)?(?:the\s+)?(?:[\p{L}-]+\s+)?$/iu.test(
      near,
    )
  ) {
    return "depth";
  }
  // "serve with softened butter": more of it at the table, not the measured line.
  if (/\bserv(?:e|ed|ing)\b[^.;]{0,30}\b(?:with|alongside)\s+(?:[\p{L}-]+\s+){0,3}$/iu.test(near)) {
    return "serving";
  }
  // "Taste for salt", "check for seasoning": a check, not more of it.
  if (/\b(?:taste|check)\s+(?:it\s+)?for\s+(?:the\s+)?$/iu.test(near)) return "skip";
  // "garnish with confectioners' sugar, if desired": a little at the end, not the measured line.
  if (
    /\bgarnish\w*\s+(?:[\p{L}-]+\s+){0,4}?with\s+(?:(?:the|some|a\s+little)\s+)?(?:[\p{L}-]+\s+){0,2}$/iu.test(
      near,
    )
  ) {
    return "serving";
  }
  // "Remove the onion", "Return the chicken to the pan", "Season the pasta": what's in already.
  if (
    /\b(?:remov|return|transfer|discard|season)\w*\s+(?:the\s+|your\s+|all\s+the\s+)?(?:(?!(?:with|and|in|into|to|over)\b)[\p{L}-]+\s+){0,2}$/iu.test(
      near,
    )
  ) {
    return "moved";
  }
  // "any solid bits of sugar", "the excess flour", "wipe flour from the sheets".
  if (/\bany\s+(?:[\p{L}]+\s+)?(?:bits?|pieces?|clumps?|lumps?)\s+of\s+(?:the\s+)?$/iu.test(near))
    return "skip";
  if (
    /\b(?:wipe[ds]?|wiping|brush(?:ed)?\s+off|shake\s+off|tap\s+off)\s+(?:off\s+|away\s+)?(?:any\s+|the\s+|excess\s+)*$/iu.test(
      near,
    )
  )
    return "skip";
  // A knife dipped in warm water, a splash of water for steam.
  if (
    /^water/iu.test(text.slice(start)) &&
    /\b(?:dip(?:ped|ping)?|run|rinse[ds]?|splash|spritz|mist|spray)\b[^.;,]{0,30}$/iu.test(near)
  ) {
    return "skip";
  }
  // "Grease a pan with butter", "brush the cooking grate with oil", "dust the towel with flour".
  const withAt =
    /\bwith\s+(?:(?:the|a|some|more|extra|a\s+little|a\s+bit\s+of|a\s+thin\s+layer\s+of|a\s+light\s+coating\s+of)\s+)?(?:[\p{L}-]+\s+){0,2}$/iu.exec(
      before,
    );
  if (withAt) {
    const lead = before.slice(0, withAt.index);
    const verb = [...lead.matchAll(GREASE_WORDS_ALL)].at(-1);
    if (verb) {
      const between = lead.slice(verb.index + verb[0].length);
      const surface = contentRoots(between).some((w) => SURFACES.has(w));
      if (surface && between.length < 60) return "surface";
      // "Spray the inside of a bundt pan with nonstick spray or grease thoroughly with butter."
      const pan = contentRoots(lead).some((w) => SURFACES.has(w) && w !== "well");
      if (pan && /^(?:grease|butter|oil|spray)/iu.test(verb[0]) && !/[,]/u.test(between)) {
        return "surface";
      }
      if (/^dust/iu.test(verb[0]) && !/[,]/u.test(between)) return "dust";
    }
  }
  // "dust with flour", "coat the dough ball with flour", "sprinkle flour around the edges"
  if (DUSTING.some((re) => re.test(near))) return "dust";
  return null;
}

const GREASE_WORDS_ALL = new RegExp(GREASE_WORDS.source, "giu");

const DUST_LEADS = String.raw`(?:a\s+little\s+|some\s+|more\s+|extra\s+)?`;
const DUSTING = [
  new RegExp(
    String.raw`\bdust\w*\s+(?:[\p{L}]+\s+){0,4}?(?:with\s+)?${DUST_LEADS}(?:the\s+)?$`,
    "iu",
  ),
  new RegExp(
    String.raw`\b(?:sprinkl|coat)\w*\s+(?:[\p{L}]+\s+){0,4}?with\s+${DUST_LEADS}(?:the\s+)?$`,
    "iu",
  ),
  new RegExp(String.raw`\bsprinkl\w*\s+${DUST_LEADS}$`, "iu"),
];

/** Words that end an "until …" clause: the next thing to do. */
const UNTIL_ENDS =
  /[;()]|,\s*(?:then|and then)\b|\b(?:then|add|stir|mix|whisk|beat|fold|pour|combine|incorporat|sprinkl|season|serve|transfer|place|remove|toss|drizzl|spread|layer)\w*\b/iu;

/** Where the sentence holding `at` starts. */
function sentenceStart(text: string, at: number): number {
  for (let k = at - 2; k >= 0; k--) {
    if (/[.!?;]/u.test(text[k] ?? "") && /\s/u.test(text[k + 1] ?? "")) return k + 1;
  }
  return 0;
}

/** Frying, in a step: "heat the oil to 350°", "add the chicken to the hot oil". */
const FRYING = /\b(?:fry|fries|fried|frying|deep[\s-]*fr|hot oil|°|degrees)/iu;

/** A line for frying, in a step that fries (or right after one: "remove it from the oil"). */
function fitsPurpose(id: Identity, ctx: StepContext): boolean {
  if (!/\bfor\s+(?:deep[\s-]*)?fry/iu.test(id.line.text)) return false;
  return FRYING.test(ctx.text) || FRYING.test(ctx.previous ?? "");
}

interface StepContext {
  /** The step before, for "remove the chicken from the oil" after frying it. */
  previous: string | undefined;
  /** The ingredient section the step's own heading names, if any. */
  section: number | null;
  text: string;
  list: Token[];
  amounts: IngredientAmount[];
  pool: Identity[];
  index: PoolIndex;
  /** Each ingredient section's heading words, by section. */
  headings: Set<string>[];
}

/** A step that serves or garnishes, where lines "for serving" are used. */
const SERVING = /\b(?:serv|garnish|top|dollop|sprinkl|drizzl|decorat|pass|dust)/iu;

/** A method section's lines, looked up by their words. */
interface PoolIndex {
  /** Phrases by their first word. */
  phrases: Map<string, IndexedPhrase[]>;
  heads: Map<string, Identity[]>;
  aliases: Map<string, Identity[]>;
  families: Map<string, Identity[]>;
  others: Map<string, Identity[]>;
}

function indexPool(pool: Identity[]): PoolIndex {
  const by = (pick: (id: Identity) => Iterable<string>) => {
    const map = new Map<string, Identity[]>();
    for (const id of pool) {
      for (const w of pick(id)) {
        const list = map.get(w) ?? [];
        if (!list.includes(id)) list.push(id);
        map.set(w, list);
      }
    }
    return map;
  };
  return {
    phrases: byFirstWord(pool.flatMap((id) => id.phrases.map((p) => ({ ...p, id })))),
    heads: by((id) => id.heads),
    aliases: by((id) => id.aliases),
    families: by((id) => id.families),
    others: by((id) => id.others),
  };
}

interface IndexedPhrase extends Phrase {
  /** Null for a name of its own that no line has ("brown sugar" when only sugar is listed). */
  id: Identity | null;
}

function byFirstWord(phrases: IndexedPhrase[]): Map<string, IndexedPhrase[]> {
  const map = new Map<string, IndexedPhrase[]>();
  for (const p of phrases) {
    const first = p.words[0] ?? "";
    const list = map.get(first) ?? [];
    list.push(p);
    map.set(first, list);
  }
  return map;
}

const COMPOUNDS_BY_FIRST = byFirstWord(COMPOUNDS.map((words) => ({ words, score: 0, id: null })));

function findMentions(ctx: StepContext): Mention[] {
  const { text, list, pool } = ctx;
  const claimed = new Set<number>();
  /** Words of a name of its own that no line has ("cooking water"). */
  const ownName = new Set<number>();
  const mentions: Mention[] = [];
  const content = list.map((t, i) => ({ t, i })).filter(({ t }) => t.content);

  // Words in brackets are asides ("(or low sodium chicken stock)"): not what the step uses.
  const asides: [number, number][] = [];
  for (const m of text.matchAll(/\([^)]*\)/gu)) asides.push([m.index, m.index + m[0].length]);
  const serves = SERVING.test(text);
  const add = (
    from: number,
    to: number,
    found: Identity[],
    which = false,
    tie = false,
    extra: Partial<Mention> = {},
  ) => {
    const first = list[from] as Token;
    const last = list[to] as Token;
    for (let k = from; k <= to; k++) claimed.add(k);
    if (asides.some(([a, b]) => first.start > a && last.end < b)) return;
    const ids = serves ? found : found.filter((id) => !id.serving);
    if (ids.length === 0) return;
    mentions.push({
      start: first.start,
      end: last.end,
      first: from,
      last: to,
      ids,
      which,
      ...(tie ? { tie: true } : {}),
      word: text.slice(first.start, last.end),
      share: { kind: "plain" },
      ...extra,
    });
  };
  const sentenceOf = (at: number) => {
    const from = sentenceStart(text, at);
    const end = /[.!?;](?:\s|$)/u.exec(text.slice(at));
    return text.slice(from, end ? at + end.index : text.length);
  };
  /** What a choice adds to the mention. */
  const extraOf = (c: Choice): Partial<Mention> => ({
    ...(c.every ? { every: true as const } : {}),
    ...(c.across ? { across: c.across } : {}),
  });

  // A run of content words starting at content index c, with only preparation words or "of"
  // between them and no punctuation.
  const runAt = (c: number, length: number): number[] | null => {
    const picked: number[] = [];
    for (let k = 0; k < length; k++) {
      const entry = content[c + k];
      if (!entry) return null;
      const last = picked.at(-1);
      if (last !== undefined) {
        const prev = list[last] as Token;
        if (/[,;:.!?()/&]/u.test(text.slice(prev.end, entry.t.start))) return null;
        const skipped = list.slice(last + 1, entry.i);
        if (skipped.some((t) => !PLAIN.has(t.root) && t.root !== "of")) return null;
      }
      picked.push(entry.i);
    }
    return picked;
  };

  // Two lines that read alike, and the step says how much: the line with that amount ("Brush
  // with 1 tablespoon oil" when the oil is listed twice, 1 tablespoon and 2 teaspoons).
  const byAmount = (found: Identity[], start: number): Identity[] => {
    const s = shareBefore(text, start, start, ctx.amounts);
    if (s.kind !== "written" || !s.exact) return [];
    const compare = (id: Identity, test: (step: number, line: number) => boolean) =>
      totals(id.line.text).some((t) => {
        const v = inUnit(s.amount.low, s.amount.unit, t.unit);
        return v !== null && test(v, t.value);
      });
    const fits = found.filter((id) => compare(id, (v, line) => Math.abs(v - line) < 1e-3));
    // "2 tablespoons of the oil" with a bigger line too: part of that one, maybe, so not surely
    // the line of exactly that much.
    const share = /\bof\s+the\b/iu.test(text.slice(s.amount.end, start));
    if (share && found.some((id) => compare(id, (v, line) => line > v + 1e-3))) return [];
    return fits.length === 1 ? fits : [];
  };

  /**
   * Lines a name might be, narrowed by the step: in a section of its own ("To make the crema:"),
   * that section's lines ("onion" is its green onions, never the main onion); and by the words
   * written before it ("the minced garlic", "the fresh oregano", "the crushed tomatoes").
   */
  const narrowed = (found: Identity[], i: number): Identity[] => {
    let ids = found;
    const word = list[i]?.root ?? "";
    if (ctx.section !== null) {
      const own = pool.filter(
        (id) => id.section === ctx.section && (id.heads.has(word) || id.compoundHeads.has(word)),
      );
      if (own.length) ids = ids.filter((id) => id.section === ctx.section);
    }
    if (ids.length < 2) return ids;
    // "Add the chicken to the hot oil": the oil for frying, in a step that fries.
    const purposed = ids.filter((id) => id.secondary && fitsPurpose(id, ctx));
    if (purposed.length) return purposed;
    const quals: string[] = [];
    for (let k = i; k > 0 && quals.length < 3; k--) {
      const t = list[k] as Token;
      const p = list[k - 1] as Token;
      if (!t.joined || STOP.has(p.root) || MEASURES.has(p.root) || /\d/u.test(p.raw)) break;
      quals.push(p.root);
    }
    if (!quals.length) return ids;
    const words = lineWords;
    const opposite: Record<string, string> = { fresh: "dried", dried: "fresh", dry: "fresh" };
    const fits = ids.filter((id) => {
      const w = words(id);
      return quals.every((q) => !opposite[q] || !w.has(opposite[q] as string));
    });
    // The lines with the most of those words: "the remaining regular chocolate chips".
    const score = (id: Identity) => quals.filter((q) => words(id).has(q)).length;
    const best = Math.max(0, ...fits.map(score));
    const exact = best > 0 ? fits.filter((id) => score(id) === best) : [];
    return exact.length ? exact : fits.length ? fits : ids;
  };

  // 1. Whole phrases, longest first; names of their own ("brown sugar") claim their words.
  const candidates: { at: number; idx: number[]; score: number; id: Identity | null }[] = [];
  for (let c = 0; c < content.length; c++) {
    const first = content[c]?.t.root ?? "";
    const options = [
      ...(ctx.index.phrases.get(first) ?? []),
      ...(COMPOUNDS_BY_FIRST.get(first) ?? []),
    ];
    for (const p of options) {
      if (!p.words.every((w, k) => content[c + k]?.t.root === w)) continue;
      const idx = runAt(c, p.words.length);
      if (idx) candidates.push({ at: c, idx, score: p.score + p.words.length * 1000, id: p.id });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.at - b.at);
  const ties = new Map<string, Identity[]>();
  for (const c of candidates) {
    if (!c.id) continue;
    const key = `${c.score}:${c.idx.join(",")}`;
    const list = ties.get(key) ?? [];
    if (!list.includes(c.id)) list.push(c.id);
    ties.set(key, list);
  }
  for (let n = 0; n < candidates.length; n++) {
    const cand = candidates[n];
    if (!cand || cand.idx.some((k) => claimed.has(k))) continue;
    if (!cand.id) {
      cand.idx.forEach((k) => {
        claimed.add(k);
        ownName.add(k);
      });
      continue;
    }
    // Other lines with the same phrase at the same place and score: decided like a bare name.
    const tied = ties.get(`${cand.score}:${cand.idx.join(",")}`) ?? [cand.id];
    const from = cand.idx[0] as number;
    const to = cand.idx.at(-1) as number;
    // "an ice cream scoop": a tool; "each peanut butter cookie": something made with it.
    const after = list[to + 1];
    if (
      after?.joined &&
      after.content &&
      (TOOLS.has(after.root) || (AFTER_A_NAME.has(after.root) && !MIXTURE.has(after.root))) &&
      !tied.some((id) => id.all.has(after.root))
    ) {
      cand.idx.forEach((k) => claimed.add(k));
      continue;
    }
    if (tied.length === 1) add(from, to, tied);
    else {
      const last = list[to] as Token;
      const written = text.slice((list[from] as Token).start, last.end);
      const start = (list[from] as Token).start;
      // "the regular chocolate chips", not the mini ones.
      const tiedHere = tied.length > 1 ? narrowed(tied, from) : tied;
      const picked = choose(tiedHere, last.root, last.raw, written, false, sentenceOf(start));
      const sized =
        picked.ids.length === 0 || picked.which || picked.tie ? byAmount(tied, start) : [];
      if (sized.length) add(from, to, sized, false, false, { sized: true });
      else if (picked.ids.length) {
        add(from, to, picked.ids, picked.which, picked.tie, extraOf(picked));
      } else cand.idx.forEach((k) => claimed.add(k));
    }
  }

  // 2. A cut piece: "beef cubes", "cubed beef".
  for (let k = 0; k + 1 < list.length; k++) {
    const a = list[k] as Token;
    const b = list[k + 1] as Token;
    if (claimed.has(k) || claimed.has(k + 1) || !b.joined) continue;
    const pairs: [Token, string | undefined][] = [
      [a, FORMS[b.root] ?? FORMS[b.raw.toLowerCase()]],
      [b, FORMS[a.raw.toLowerCase()]],
    ];
    for (const [word, form] of pairs) {
      if (!form || !word.content) continue;
      const found = pool.filter((id) => id.all.has(word.root) && id.forms.has(form));
      if (found.length === 1) {
        add(k, k + 1, found);
        break;
      }
    }
  }

  // 3. "chocolate/peanut butter chips", "walnuts or pecans": the word goes with the name after it.
  for (const m of [...mentions]) {
    const before = list[m.first - 1];
    if (!before || claimed.has(m.first - 1) || m.ids.length !== 1) continue;
    const gap = text.slice(before.end, m.start);
    if (/^\s*(?:\/|or)\s*$/iu.test(gap) && m.ids[0]?.all.has(before.root)) {
      claimed.add(m.first - 1);
      m.first -= 1;
      m.start = before.start;
      m.word = text.slice(m.start, m.end);
    }
  }

  // 4. Single words.
  for (const { t, i } of content) {
    if (claimed.has(i) || isAction(text, list, i)) continue;
    const next = list[i + 1];
    const prev = list[i - 1];
    const nextJoined = next?.joined ? next : undefined;
    const prevJoined = t.joined ? prev : undefined;
    // "brown sugar" when only sugar is listed: not the sugar.
    if (prevJoined?.content && isCompound([prevJoined.root, t.root])) continue;
    // "butter knife", "potato cooking water", "lemon juice" when only lemons are listed.
    const blockedAfter = (id: Identity) => {
      if (!nextJoined || id.all.has(nextJoined.root)) return false;
      if (TOOLS.has(nextJoined.root) || ownName.has(i + 1)) return true;
      return (
        nextJoined.content &&
        !FORMS[nextJoined.root] &&
        !MIXTURE.has(nextJoined.root) &&
        AFTER_A_NAME.has(nextJoined.root)
      );
    };
    // Water to cook in isn't the water listed: "a pot of salted water".
    const justBefore = text.slice(Math.max(0, t.start - 30), t.start);
    if (
      t.root === "water" &&
      /\b(?:salted|pot of|pan of|saucepan of|boiling)\s+$/iu.test(justBefore)
    ) {
      continue;
    }
    // "The juices" are what comes out of the meat, not the lemon juice.
    if (/^juices$/iu.test(t.raw)) continue;

    const lookup = (map: Map<string, Identity[]>) =>
      (map.get(t.root) ?? []).filter((id) => !blockedAfter(id));
    let found = lookup(ctx.index.aliases);
    if (found.length === 0) found = lookup(ctx.index.heads);
    if (found.length === 0 && GROUP_WORDS.has(t.root)) {
      found = lookup(ctx.index.families);
    } else if (WIDE_GROUPS.has(t.root) && found.every((id) => !id.compoundHeads.has(t.root))) {
      // "the cheese" is the Parmesan too; "the pasta" the fusilli.
      for (const id of lookup(ctx.index.families)) if (!found.includes(id)) found.push(id);
    }
    const pieces = nextJoined && PIECE_WORDS.has(nextJoined.root) ? nextJoined : undefined;
    const plural = t.raw.toLowerCase().replace(/['’]s$/u, "") !== t.root || isPlural(pieces);
    const end = nextJoined && (FORMS[nextJoined.root] || pieces) && !claimed.has(i + 1) ? i + 1 : i;
    if (found.length === 0) {
      // A word of one line's name only, used as a name: "the pork", "the cheddar".
      const owners = ctx.index.others.get(t.root) ?? [];
      const owner = owners[0];
      const nextOk =
        !nextJoined ||
        !nextJoined.content ||
        !!owner?.all.has(nextJoined.root) ||
        !!FORMS[nextJoined.root] ||
        PIECE_WORDS.has(nextJoined.root) ||
        MIXTURE.has(nextJoined.root) ||
        // "Sprinkle the mozzarella evenly"
        /ly$/iu.test(nextJoined.raw);
      if (owner && owners.length === 1 && nextOk && !DESCRIBING.has(t.root)) {
        found = owners;
        // "flaky salt" for "Flaky sea salt": the whole name is that line.
        let k = i;
        while (
          list[k + 1]?.joined &&
          owner.all.has(list[k + 1]?.root ?? "") &&
          !claimed.has(k + 1)
        ) {
          k++;
        }
        if (k > i) {
          add(i, k, owners);
          continue;
        }
      }
    }
    if (found.length === 0) continue;
    found = narrowed(found, i);
    if (found.length === 0) continue;
    const picked = choose(
      found,
      t.root,
      t.raw,
      t.raw,
      plural || MASS_GROUPS.has(t.root),
      sentenceOf(t.start),
    );
    const sized =
      found.length > 1 && (picked.ids.length === 0 || picked.which || picked.tie || picked.every)
        ? byAmount(found, t.start)
        : [];
    // The lines this step has named already, by a fuller name ("granulated sugar and brown
    // sugar … into the sugars", "place sparkling sugar … dredge in sugar").
    const namedHere = [
      ...new Set(
        mentions
          .filter((m) => m.end <= t.start && !m.which && m.ids.length === 1)
          .map((m) => m.ids[0] as Identity),
      ),
    ];
    const extra = extraOf(picked);
    let ids = picked.ids;
    let which = picked.which;
    if (picked.every) {
      const here = ids.filter((id) => namedHere.includes(id));
      if (here.length) ids = here;
      // "the sugars" with granulated, brown and confectioners' sugar and none named: which?
      else if (ids.length > 2 && !GROUP_WORDS.has(t.root)) {
        which = true;
        extra.unsureEvery = true;
      }
    } else if (!plural && ids.length === 1 && !picked.which) {
      // Only a line named by this same word ("sparkling sugar … sugar", not "cayenne … pepper").
      const sameWord = new Set(
        mentions
          .filter(
            (m) =>
              m.end <= t.start &&
              m.ids.length === 1 &&
              root(m.word.split(/[\s-]+/u).at(-1) ?? "") === t.root,
          )
          .map((m) => m.ids[0] as Identity),
      );
      const back = [...sameWord].filter(
        (id) =>
          id !== ids[0] &&
          found.includes(id) &&
          id.options[0]?.at(-1) === t.root &&
          !id.insteadHeads.has(t.root) &&
          !id.compoundHeads.has(t.root),
      );
      if (back.length === 1) extra.backRef = back[0] as Identity;
    }
    if (sized.length) add(i, end, sized, false, false, { sized: true });
    else if (ids.length) add(i, end, ids, which, picked.tie, extra);
  }

  // "Stir in the chips and Craisins" with Craisins in the bars and in the topping: the ones in the
  // section the step's other ingredients come from, or none.
  // (A line picked by the amount the step writes counts only when nothing else does.)
  const settledBy = (sized: boolean) =>
    mentions.filter(
      (m) => !m.which && !m.tie && !m.across && m.ids.length === 1 && !!m.sized === sized,
    );
  const stepRoots = new Set(content.map(({ t }) => t.root));
  const headed = new Set<number>();
  ctx.headings.forEach((words, k) => {
    if (words.size && [...words].every((w) => stepRoots.has(w))) headed.add(k);
  });
  // Where most of the step's ingredients come from, when that's clear (three or more).
  const counts = new Map<number, number>();
  for (const m of settledBy(false)) {
    const k = (m.ids[0] as Identity).section;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const [major, most] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [-1, 0];
  const clear = most >= 3 && [...counts.values()].filter((n) => n === most).length === 1;
  // A line from another part of the recipe, alone among the step's ingredients (the icing's
  // orange juice in the cookie dough's step): the step's own part's line by that name, or none.
  if (clear && ctx.section === null) {
    for (const m of mentions) {
      const only = m.ids[0];
      if (m.ids.length !== 1 || !only || m.which || m.mixture) continue;
      if (only.section === major || headed.has(only.section)) continue;
      if ((counts.get(only.section) ?? 0) > 1) continue;
      const word = root(m.word.split(/[\s-]+/u).at(-1) ?? "");
      const own = pool.filter(
        (id) => id.section === major && (id.heads.has(word) || id.aliases.has(word)),
      );
      m.ids = own.length === 1 ? own : [];
      delete m.across;
      m.tie = false;
    }
  }
  const byName = settledBy(false);
  const sections = new Set(
    (byName.length ? byName : settledBy(true)).map((m) => m.ids[0]?.section),
  );
  // …and a section the step names ("Combine the brine, water and ice": the brine's water).
  const named = new Set([...sections, ...headed]);
  for (const m of mentions) {
    // The ordinary one of lines in different sections: only if the step's section is its own
    // (the brine's iced water, not the 1 cup of water for the aromatics).
    if (m.across) {
      const picked = m.ids[0];
      const fitting = clear ? new Set([major, ...headed]) : named;
      if (fitting.size === 0) {
        if (picked && picked.section !== -1) m.ids = [];
      } else if (!picked || !fitting.has(picked.section)) {
        const fits = m.across.filter((id) => fitting.has(id.section));
        m.ids = fits.length === 1 ? fits : [];
      }
      continue;
    }
    // "Not sure which: brown or powdered sugar", when the step's other ingredients are all the
    // bread's: the bread's brown sugar.
    if (m.which && new Set(m.ids.map((id) => id.section)).size > 1 && named.size) {
      const fits = m.ids.filter((id) => named.has(id.section));
      if (fits.length === 1) m.which = false;
      // "both sugars" of the cake's two, not the frosting's powdered sugar.
      if (m.unsureEvery && fits.length === 2) {
        m.which = false;
        m.every = true;
      }
      if (fits.length) m.ids = fits;
      continue;
    }
    // "4 cups Marinara Sauce, recipe follows", in the step making it from the sauce's own lines.
    const only = m.ids[0];
    if (m.ids.length === 1 && only && MADE_BELOW.test(only.line.text)) {
      const made = ctx.headings.findIndex(
        (words) => words.size > 0 && [...words].every((w) => lineWords(only).has(w)),
      );
      if (made >= 0 && sections.has(made)) m.ids = [];
      continue;
    }
    if (m.which || m.ids.length < 2) continue;
    if (new Set(m.ids.map((id) => id.section)).size < 2) {
      if (m.tie) m.ids = [];
      continue;
    }
    m.ids = m.ids.filter((id) => sections.has(id.section));
    // Two lines that read alike: only when the section settles it.
    if (m.tie && m.ids.length !== 1) m.ids = [];
    m.tie = false;
  }

  // Shares, mixtures and melted things, from the words around each mention.
  mentions.sort((a, b) => a.start - b.start);
  let previous: Mention | undefined;
  for (const m of mentions) {
    m.share = shareBefore(text, m.start, m.end, ctx.amounts);
    const listed = (p: Mention | undefined) =>
      !!p && /^(?:\s*(?:,|and|or|&)\s*)+$/iu.test(text.slice(p.end, m.start));
    // "more salt and pepper": the pepper is more too.
    if (m.share.kind === "plain" && previous?.share.kind === "skip" && listed(previous)) {
      m.share = { kind: "skip" };
    }
    // "the remaining sugar and flour": the flour's what's left too.
    if (
      m.share.kind === "plain" &&
      previous?.share.kind === "remaining" &&
      /^\s*(?:and|&)\s*$/iu.test(text.slice(previous.end, m.start))
    ) {
      m.share = { kind: "remaining" };
    }
    // "1 teaspoon of each of the thyme, chives and parsley": each of them.
    if (
      m.share.kind === "plain" &&
      (previous?.share.kind === "written" || previous?.share.kind === "part") &&
      previous.eachOf &&
      listed(previous)
    ) {
      m.share =
        previous.share.kind === "part"
          ? {
              ...previous.share,
              words: `${previous.share.words.slice(0, -previous.word.length)}${m.word}`,
            }
          : { ...previous.share };
      m.eachOf = true;
    } else if (m.share.kind === "written") {
      m.eachOf = /\beach\s+of\b/iu.test(text.slice(m.share.amount.end, m.start));
    } else if (m.share.kind === "part") {
      // "half of each of the sugar and flour"
      m.eachOf = /\beach\s+of\b/iu.test(m.share.words);
    }
    let aside = incidental(text, m.start);
    // "Dust the towel with rice flour or bread flour": the second one too.
    if (!aside && previous?.aside && previous.aside !== "skip" && listed(previous)) {
      aside = previous.aside;
    }
    m.aside = aside;
    if (aside === "skip") m.share = { kind: "skip" };
    else if ((aside === "surface" || aside === "depth") && m.share.kind === "plain") {
      // Greasing a pan: only a line that's for greasing, never the measured butter.
      const kept = m.ids.filter(forThePan);
      if (kept.length) {
        m.ids = kept;
        m.which = m.which && kept.length > 1;
      } else m.share = { kind: "skip" };
    } else if (aside === "dust") m.dusting = true;
    else if (aside === "serving") m.serving = true;
    // "cream the butter and 2 sugars": two kinds, not two of them.
    if (m.share.kind === "bare" && m.ids.length > 1) m.share = { kind: "plain" };
    // "a pinch of salt and sugar": the sugar is a pinch too.
    if (
      m.share.kind === "plain" &&
      previous?.share.kind === "small" &&
      previous.share.words.endsWith(previous.word) &&
      /^\s*(?:and|&)\s*$/iu.test(text.slice(previous.end, m.start))
    ) {
      const lead = previous.share.words.slice(
        0,
        previous.share.words.length - previous.word.length,
      );
      m.share = { kind: "small", words: `${lead}${m.word}` };
    }
    // "Season with salt and pepper to taste": as the step says it.
    const toTaste =
      /^(?:\s*,?\s*(?:and|&|or)\s+[\p{L}-]+(?:\s+[\p{L}-]+)?)?\s*,?\s+to taste\b/iu.exec(
        text.slice(m.end),
      );
    // Not what's seasoned: "Season the pasta, to taste, with pepper".
    if (m.share.kind === "plain" && toTaste && aside !== "moved") {
      m.share = { kind: "small", words: `${m.word} to taste` };
    }
    previous = m;
    const after = list[m.last + 1];
    if (after?.joined && (after.root === "mixture" || after.raw.toLowerCase() === "mix")) {
      m.mixture = text.slice(m.start, after.end);
    }
    // "the butter/chocolate mixture", "the egg and milk mixture".
    const pair = /^\s*(?:\/|and|&)\s*[\p{L}-]+\s+mixture\b/iu.exec(text.slice(m.end));
    if (pair) m.mixture = text.slice(m.start, m.end + pair[0].length);
    const before = list[m.first - 1];
    if (before && /^melted$/iu.test(before.raw) && /^\s+$/u.test(text.slice(before.end, m.start))) {
      m.melted = true;
    }
  }
  return mentions.sort((a, b) => a.start - b.start);
}

const isPlural = (t: Token | undefined) => !!t && t.raw.toLowerCase() !== t.root;

/** "4 garlic cloves, 2 smashed, 2 thinly sliced": each part's preparation word. */
function splitPrep(text: string): string[] {
  const parts = [...text.matchAll(/,\s*\d+\s+(?:[\p{L}]+ly\s+)?([\p{L}]+)/gu)];
  return parts.length >= 2 ? parts.map((p) => (p[1] ?? "").toLowerCase()) : [];
}

/** A name written in the plural ("the eggs"), by its last word. */
const pluralWord = (words: string) => {
  const last = (words.split(/[\s-]+/u).at(-1) ?? "").toLowerCase().replace(/['’]s$/u, "");
  return !!last && root(last) !== last;
};

/** What a line is set aside for ("sugar for rolling"), and the words of a step doing it. */
const PURPOSES: [RegExp, RegExp][] = [
  [/\b(?:for|to)\s+(?:the\s+)?roll/iu, /\broll/iu],
  [/\b(?:for|to)\s+(?:the\s+)?sprinkl/iu, /\bsprinkl/iu],
  [/\b(?:for|to)\s+(?:the\s+)?dust/iu, /\bdust/iu],
  [/\b(?:for|to)\s+(?:the\s+)?brush/iu, /\bbrush/iu],
  [/\b(?:for|to)\s+(?:the\s+)?(?:greas|coat)/iu, /\b(?:greas|coat)/iu],
  [/\b(?:for|to)\s+(?:deep[\s-]*)?fry/iu, FRYING],
  [
    /\b(?:for|to)\s+(?:the\s+)?(?:serv|garnish|top|decorat|finish)/iu,
    /\b(?:serv(?:e|ed|ing)\b|garnish|top\s+(?:with|each|it|them|the|off)\b|decorat|finish)/iu,
  ],
];

/** A line set aside for what the step's sentence is doing: "roll in sugar", "sugar for rolling". */
const forThisStep = (id: Identity, sentence: string) =>
  id.secondary && PURPOSES.some(([line, step]) => line.test(id.line.text) && step.test(sentence));

interface Choice {
  ids: Identity[];
  which: boolean;
  tie?: true;
  /** "The sugars": each of them (narrowed later to the ones the step means). */
  every?: true;
  /** One line picked as the ordinary one among lines from different sections: those lines. */
  across?: Identity[];
}

/**
 * Which of several lines a name means: the one line that fits; else the ordinary one (a line
 * that is just that name, or with words that still mean the ordinary kind: "granulated sugar");
 * else the plainest when it's plainer than every other ("sea salt" over "flaky sea salt"). When
 * none of those settles it, every line it might be, marked as unsure.
 */
function choose(
  found: Identity[],
  word: string,
  raw: string,
  written: string,
  pluralPiece = false,
  sentence = "",
): Choice {
  const plural = pluralPiece || raw.toLowerCase().replace(/['’]s$/u, "") !== word;
  const extras = (id: Identity) => {
    const option =
      id.options.find((o) => o.at(-1) === word) ??
      id.options.find((o) => o.includes(word)) ??
      id.options[0] ??
      [];
    return option.filter((w) => w !== word && !written.toLowerCase().includes(w));
  };
  const generic = GENERIC[word];
  const ordinary = (id: Identity) => extras(id).every((w) => generic?.has(w));
  // "yellow onion", "golden raisins": still the ordinary kind; "balsamic vinegar" isn't.
  const plainKind = (id: Identity) => extras(id).every((w) => generic?.has(w) || DESCRIBING.has(w));
  const prefer = (pool: Identity[], keep: (id: Identity) => boolean) => {
    const kept = pool.filter(keep);
    return kept.length > 0 ? kept : pool;
  };
  // "Shape into balls and roll in sugar": the sugar for rolling. Otherwise the main line wins
  // over the one for dusting or frying.
  const purposed = found.filter((id) => forThisStep(id, sentence));
  let pool = purposed.length ? purposed : prefer(found, (id) => !id.secondary);
  // A bare "onion" isn't the green onions, nor "vinegar" the red wine vinegar, unless what's
  // left is a kind of its own too ("balsamic vinegar"): then it's either.
  if (written.toLowerCase() === raw.toLowerCase()) {
    if (DISH_WORDS.has(word)) {
      const own = pool.filter((id) => !id.compoundHeads.has(word) || !!id.line.linkedRecipeId);
      if (own.length && own.length < pool.length && !own.every(plainKind)) {
        return { ids: [], which: false };
      }
      pool = own;
    }
    // "both sugars" are the brown sugar too.
    if (!plural) {
      const kept = pool.filter((id) => !id.compoundHeads.has(word));
      // ("the cheese" is still the Parmesan, not the cream cheese: a kind of cheese.)
      if (kept.length && (GROUP_WORDS.has(word) || kept.some(plainKind))) pool = kept;
    }
  }
  if (pool.length === 0) return { ids: [], which: false };
  pool = prefer(pool, (id) => !id.insteadHeads.has(word));
  if (ONLY_THE_ORDINARY.has(word)) {
    // "pepper" is black pepper; "peppers" are the ones you can count.
    pool = plural ? pool.filter((id) => !ordinary(id) || id.counted) : pool.filter(ordinary);
    if (pool.length === 0) return { ids: [], which: false };
  }
  // One line from lines in different sections: the step's other ingredients must agree.
  const one = (id: Identity): Choice =>
    new Set(pool.map((p) => p.section)).size > 1
      ? { ids: [id], which: false, across: pool }
      : { ids: [id], which: false };
  if (pool.length === 1) return { ids: pool, which: false };
  const defaults = pool.filter(ordinary);
  if (defaults.length === 1 && !plural) return one(defaults[0] as Identity);
  const among = defaults.length > 1 ? defaults : pool;
  const subset = (a: string[], b: string[]) => a.length < b.length && a.every((w) => b.includes(w));
  const plainest = among.filter((id) =>
    among.every((other) => other === id || subset(extras(id), extras(other))),
  );
  if (plainest.length === 1 && !plural) return one(plainest[0] as Identity);
  // "The nuts", "the cheeses", "the apples": every one of them.
  const named = (id: Identity) => id.options.some((o) => o.at(-1) === word);
  if (plural && (GROUP_WORDS.has(word) || (pool.length <= 3 && pool.every(named)))) {
    return { ids: pool, which: false, every: true };
  }
  // "The sauce", "the glaze": the recipe's own, not one of the bought ones.
  if (DISH_WORDS.has(word)) return { ids: [], which: false };
  // Two lines that read the same (the crust's butter and the filling's): the one in the section
  // the step's other ingredients come from, else nothing.
  const writtenWords = written.split(/[\s-]+/u).map(root);
  const names = among.map((id) => nameBesides(id.line.text, writtenWords).toLowerCase());
  if (among.length > 4) return { ids: [], which: false };
  if (names.some((n) => !n) || new Set(names).size !== names.length) {
    return { ids: among, which: false, tie: true };
  }
  return { ids: among, which: true };
}

// ---------------------------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------------------------

interface Total {
  value: number;
  unit: string | null;
}

/** A line's amounts that arithmetic can use: the main one and the same amount another way. */
function totals(text: string): Total[] {
  const read = readIngredient(text);
  const exact = (a: IngredientAmount) => a.high === null && !a.approximate && a.low > 0;
  const main = read.amounts.find((a) => a.role === "main");
  if (!main || !exact(main) || /^\s*(?:about|approximately|around|roughly|~)/iu.test(text)) {
    return [];
  }
  return read.amounts
    .filter((a) => (a.role === "main" || a.role === "alternate") && exact(a))
    .map((a) => ({ value: a.low, unit: a.unit }));
}

/** An amount in another amount's unit, or null when they can't be compared exactly. */
function inUnit(value: number, unit: string | null, to: string | null): number | null {
  if (unit === to) return value;
  const a = unit ? unitNamed(unit) : undefined;
  const b = to ? unitNamed(to) : undefined;
  if (!a?.base || !b?.base || a.kind !== b.kind || (a.kind !== "volume" && a.kind !== "weight")) {
    return null;
  }
  return (value * a.base) / b.base;
}

const METRIC = new Set(["gram", "kilogram", "milliliter", "liter", "centiliter", "deciliter"]);

function friendlyIn(value: number, unit: string | null): boolean {
  if (value <= 1e-6) return false;
  if (unit && METRIC.has(unit)) return Math.abs(value - Math.round(value)) < 0.01;
  const fractions =
    unit === "teaspoon"
      ? [0, 1 / 8, 1 / 4, 3 / 8, 1 / 2, 5 / 8, 3 / 4, 7 / 8]
      : unit === "tablespoon"
        ? [0, 1 / 2]
        : unit === "cup"
          ? [0, 1 / 8, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4]
          : [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4];
  const rest = value - Math.floor(value + 1e-6);
  return fractions.some((f) => Math.abs(rest - f) < 0.005) || Math.abs(rest - 1) < 0.005;
}

/** A worked-out amount in a measure a cook can use: ¼ cup, or 13 tablespoons, or nothing. */
function friendly(value: number, unit: string | null): Total | null {
  if (friendlyIn(value, unit)) return { value: round(value), unit };
  // Less than a cup is measured in spoons ("13 tablespoons"); less than a tablespoon in teaspoons.
  const smaller: [string, number][] =
    unit === "cup"
      ? [
          ["tablespoon", 16],
          ["teaspoon", 3],
        ]
      : unit === "tablespoon"
        ? [["teaspoon", 3]]
        : [];
  for (const [s, below] of smaller) {
    const v = inUnit(value, unit, s);
    if (v !== null && v < below && friendlyIn(v, s)) return { value: round(v), unit: s };
  }
  return null;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

const SHORT_UNIT: Record<string, [string, string]> = {
  teaspoon: ["tsp", "tsp"],
  tablespoon: ["tbsp", "tbsp"],
  cup: ["cup", "cups"],
  ounce: ["oz", "oz"],
  pound: ["lb", "lb"],
  gram: ["g", "g"],
  kilogram: ["kg", "kg"],
  milliliter: ["ml", "ml"],
  liter: ["l", "l"],
};

const VULGAR: [number, string][] = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
];

function numberText(value: number): string {
  const whole = Math.floor(value + 1e-6);
  const rest = value - whole;
  const f = VULGAR.find(([v]) => Math.abs(v - rest) < 0.005);
  if (!f || rest < 0.005) return String(Math.round(value * 100) / 100);
  return whole ? `${whole}${f[1]}` : f[1];
}

/**
 * A worked-out amount of a line, written as an ingredient line so it can be shown scaled and
 * converted like the line itself: "¼ cup sugar" for the rest of "1 cup sugar, divided".
 */
export function amountLine(text: string, value: number, unit: string | null): string {
  const read = readIngredient(text);
  const main = read.amounts.find((a) => a.role === "main");
  const name = ingredientName(text);
  let unitText = "";
  if (unit) {
    const written = main && main.unit === unit ? text.slice(main.start, main.end) : "";
    const spelled = written.replace(/^[\d\s.,/½¼¾⅓⅔⅛⅜⅝⅞⅐-⅞‐‑–-]+/u, "").trim();
    const u = unitNamed(unit);
    const lower = spelled.toLowerCase().replace(/\.$/u, "");
    if (spelled && u && u.words.includes(lower)) {
      const one = value <= 1 + 1e-6;
      // "tbsp" is "tbsp" for any number; "cup" is "cups".
      const short = /^(?:tbsps?|tsps?|tbs|tbl|oz|lbs?|pts?|qts?|gal|kg|g|ml|l|c|t)$/iu.test(lower);
      const singular = lower.endsWith("s") && u.words.includes(lower.slice(0, -1));
      const plural = !short && !lower.endsWith("s") && u.words.includes(`${lower}s`);
      unitText = one && singular ? spelled.slice(0, -1) : !one && plural ? `${spelled}s` : spelled;
    } else {
      const short = SHORT_UNIT[unit];
      unitText = short ? (value <= 1 + 1e-6 ? short[0] : short[1]) : unit;
    }
  }
  // "the remaining 1 egg", not "1 eggs".
  const counted = !unit && value <= 1 + 1e-6 ? singular(name) : name;
  return [numberText(value), unitText, counted].filter(Boolean).join(" ");
}

/** A name's last word in the singular, as written otherwise: "large eggs" → "large egg". */
function singular(name: string): string {
  return name.replace(/([\p{L}]+)$/u, (w) => {
    if (IRREGULAR[w.toLowerCase()]) return w.replace(/ves$/iu, "f");
    if (/ies$/iu.test(w) && w.length > 4) return `${w.slice(0, -3)}y`;
    if (/(?:ches|shes|sses|xes|oes)$/iu.test(w)) return w.slice(0, -2);
    if (/[^su]s$/iu.test(w) && w.length > 3) return w.slice(0, -1);
    return w;
  });
}

// ---------------------------------------------------------------------------------------------
// Putting it together
// ---------------------------------------------------------------------------------------------

/** One line's use in one step, before it's decided how much. */
interface Use {
  step: number;
  at: number;
  id: Identity;
  share: Share;
  /** The step's own words for it ("sugar" in "3/4 cup of the sugar"). */
  word: string;
  /** With the words before it that say it's what's left: "the remaining whipped cream". */
  phrase: string;
  /** "garnish with", "dust with": a little more on top, if the line is used elsewhere. */
  topping?: true;
}

/**
 * The share that counts when a step names a line twice: "the remaining sugar … the cinnamon
 * sugar" is the rest; "⅓ of the flour … then the remaining flour" is all that's left; "Cook the
 * bacon … crumble 5 slices of the cooked bacon" is all the bacon (unless it's divided).
 */
function merge(a: Share, b: Share, divided: boolean): Share {
  if (a.kind === "skip") return b;
  if (b.kind === "skip") return a;
  const known = (x: Share) => x.kind === "written" || x.kind === "several" || x.kind === "part";
  const amountsOf = (x: Share) =>
    x.kind === "written"
      ? [
          {
            amount: x.amount,
            exact: x.exact,
            remaining: x.remaining,
            ...(x.name ? { name: x.name } : {}),
          },
        ]
      : x.kind === "several"
        ? x.amounts
        : [];
  const rest = (x: Share) => x.kind === "remaining" || (x.kind === "several" && !!x.rest);
  // "Melt a little of the butter … add the remaining butter", "cook 2 or 3 chicken breasts …
  // cook the rest of the chicken breasts": the whole line, in this step.
  const bit = (x: Share) => x.kind === "small" || x.kind === "portion";
  if (
    ((bit(a) || a.kind === "plain") && b.kind === "remaining") ||
    (a.kind === "remaining" && bit(b))
  ) {
    return { kind: "whole" };
  }
  // "Add ice cubes and shake to melt most of the ice": all of it went in first. "all but 1/2 cup
  // sugar … some of the remaining sugar": the first says how much.
  if ((a.kind === "plain" || bit(a)) && bit(b)) return a;
  if (rest(a) || rest(b)) {
    const amounts = [...amountsOf(a), ...amountsOf(b)];
    return amounts.length ? { kind: "several", amounts, rest: true } : { kind: "remaining" };
  }
  if (a.kind === "plain" && known(b) && !divided) return a;
  if (amountsOf(a).length && amountsOf(b).length) {
    return { kind: "several", amounts: [...amountsOf(a), ...amountsOf(b)] };
  }
  const RANK: Record<Share["kind"], number> = {
    whole: 10,
    several: 9,
    written: 8,
    bare: 7,
    part: 6,
    remaining: 5,
    reserved: 4,
    portion: 3,
    small: 2,
    plain: 1,
    skip: 0,
  };
  return RANK[b.kind] > RANK[a.kind] ? b : a;
}

/** Things listed again on their own ("Salt and pepper") that are no part's name. */
const PANTRY = set("salt pepper oil water sugar butter flour");

/** Words naming a part of a recipe, for headings written without a colon. */
const PART_WORDS = set(`
  dough crust filling frosting topping glaze icing batter streusel crumble marinade dressing
  sauce garnish assembly base layer cake
  `);

/** An ingredient line that is a section's name with no colon: "Homemade Dough", "Topping". */
function isSectionLine(text: string): boolean {
  return (
    looksLikeTitle(text) &&
    readIngredient(text).amounts.length === 0 &&
    contentRoots(text).some((w) => PART_WORDS.has(w))
  );
}

/** A step that is only a section's name: "Crust", "Coconut Layer", "Make the glaze". */
function looksLikeTitle(text: string): boolean {
  const t = text.trim().replace(/:$/u, "");
  if (!t || /[.,;!?()\d]/u.test(t)) return false;
  const words = t.split(/\s+/u);
  return (
    words.length <= 5 && words.every((w) => /^\p{Lu}/u.test(w) || w === "&" || STOP.has(root(w)))
  );
}

/**
 * Text in the ingredient list that isn't one ingredient: a sentence of the method ("Spread a thin
 * layer of pudding over the bottom of …"), or several ingredients run together ("¾ cup sugar,
 * ¼ cup cornstarch, ½ teaspoon salt"). Matching it could only list the wrong thing.
 */
function notALine(text: string): boolean {
  const t = text.trim();
  if (/^(?:notes?|hint|tip)\s*:/iu.test(t)) return true;
  if (!/^[\d½¼¾⅓⅔⅛]/u.test(t) && t.split(/\s+/u).length >= 10 && /[.!]$/u.test(t)) return true;
  // (Not "8 grams salt (about 1 1/2 teaspoons table salt, 2 teaspoons Morton …)", nor "4 chicken
  // breasts, 6 ounces".)
  return /,\s*[\d½¼¾⅓⅔⅛]+(?:[\s/\d]*)(?:\([^)]*\)\s*)?\s*(?:cups?|tablespoons?|teaspoons?|tbsps?|tsps?|ounces?|oz|grams?|g|ml|pounds?|lbs?)\.?\s+(?!each\b)[\p{L}]{3,}/iu.test(
    t.replace(/\([^)]*\)/gu, ""),
  );
}

/** A note in the method rather than something to do. */
const NOTE =
  /^\s*(?:notes?\b|tips?\b|last time\b|be sure\b|plan ahead\b|keep in mind\b|we\s+(?:use|like|prefer|recommend)\b|i\s+(?:added|used|like|make|made|prefer|have|find|usually|always|sometimes)\b|this recipe\b|to ensure the best results\b|cook['’]?s\s+notes?\b|we\s+(?:found|find|tested|tried|think|love)\b|most\s+(?:[\p{L}-]+\s+){0,3}(?:require|call|need|use)s?\b|speaking of\b|did you\b|[\p{L}' ]{0,40}\bsuggests?\s+caution\b)/iu;

/** "For the crust, …", "To make the glaze: …", "FOR THE CHUTNEY: …" at the start of a step. */
const INLINE_SECTION =
  /^\s*(?:\d+\.\s*)?(?:for|to make|make)\s+the\s+([\p{L}\s-]{2,40}?)\s*(?:\([^)]{0,30}\)\s*)?[,:]/iu;

/**
 * The ingredients each step uses, by step ID, in the order the step names them. Headings get no
 * entry; a step that names nothing gets an empty list.
 */
export function stepIngredients(
  ingredients: readonly IngredientLine[],
  directions: readonly DirectionStep[],
  options: StepIngredientOptions = {},
): Map<string, StepUse[]> {
  const titles = options.linkedTitles;
  const titleOf = (id: string) =>
    titles instanceof Map ? titles.get(id) : (titles as Record<string, string> | undefined)?.[id];
  let section = -1;
  const identities: Identity[] = [];
  // A line that only names a part of the recipe ("Homemade Dough", "Topping", "Optional
  // Ingredients", "Sandwiches" when the method says "For the sandwiches:") is a heading.
  const key = (words: Set<string>) => [...words].sort().join(" ");
  const parts = new Set(
    directions.flatMap((d) =>
      [INLINE_SECTION.exec(d.text)?.[1], d.heading || looksLikeTitle(d.text) ? d.text : null]
        .filter((t): t is string => !!t)
        .map((t) => key(sectionWords(t))),
    ),
  );
  // Words of the measured lines, for "Chicken and rice" over the chicken and the rice lines.
  const measured = new Set(
    ingredients
      .filter((l) => !l.heading && readIngredient(l.text).amounts.length > 0)
      .flatMap((l) => contentRoots(ingredientName(l.text))),
  );
  const isLabel = (text: string) =>
    isSectionLine(text) ||
    (readIngredient(text).amounts.length === 0 &&
      /^\p{Lu}/u.test(text.trim()) &&
      !/[\d,(]|\b(?:to taste|for|optional|as needed)\b/iu.test(text) &&
      text.trim().split(/\s+/u).length <= 5 &&
      ((options) =>
        options.length >= 2 &&
        options.every((o) => measured.has(o.at(-1) ?? "") && !PANTRY.has(o.at(-1) ?? "")))(
        optionsOf(ingredientName(text)),
      )) ||
    (readIngredient(text).amounts.length === 0 &&
      !/\d/u.test(text) &&
      (/\bingredients?\b/iu.test(text) ||
        (text.trim().split(/\s+/u).length <= 4 && parts.has(key(sectionWords(text)))) ||
        // "Chicken, veggies and rice"
        /^\p{Lu}[\p{L}]*(?:\s[\p{L}]+)?,\s+[\p{L}]+(?:\s[\p{L}]+)?\s+and\s+[\p{L}]+$/u.test(
          text.trim(),
        )));
  const lines = ingredients.map((line) =>
    !line.heading && isLabel(line.text) ? { ...line, heading: true } : line,
  );
  for (const line of lines) {
    if (line.heading) {
      section++;
      continue;
    }
    if (notALine(line.text)) continue;
    identities.push(identify(line, section, titleOf(line.id)));
  }
  const scopeFor = scopes(identities, lines);
  const headings = lines.filter((l) => l.heading).map((l) => sectionWords(l.text));

  // Every step's mentions.
  const steps: { step: DirectionStep; mentions: Mention[] }[] = [];
  let methodHeading: string | null = null;
  const indexes = new Map<Identity[], PoolIndex>();
  for (const step of directions) {
    if (step.heading) {
      methodHeading = step.text;
      continue;
    }
    // A step that is only a section's name ("Crust", "Coconut Layer") starts that section.
    if (looksLikeTitle(step.text)) {
      methodHeading = step.text;
      steps.push({ step, mentions: [] });
      continue;
    }
    // "Note: …", "Last time I made this … I added brown sugar": the cook's note, not a step.
    if (NOTE.test(step.text)) {
      steps.push({ step, mentions: [] });
      continue;
    }
    // "For the crust, cream the butter…", "FOR THE CHUTNEY: Combine…": this step's section.
    const inline = INLINE_SECTION.exec(step.text)?.[1];
    const { pool, section: scoped } = scopeFor(inline ?? methodHeading);
    let index = indexes.get(pool);
    if (!index) {
      index = indexPool(pool);
      indexes.set(pool, index);
    }
    const ctx: StepContext = {
      previous: steps.at(-1)?.step.text,
      section: scoped,
      text: step.text,
      ...stepWords(step.text),
      pool,
      index,
      headings,
    };
    steps.push({ step, mentions: identities.length ? findMentions(ctx) : [] });
  }

  // Mixtures and melted things point back to the step that made them: the step where the
  // ingredient first went in, or a later one that used a mixture of it.
  const mixtures = new Map<number, { at: number; end: number; name: string; use: StepUse }[]>();
  const madeIn = new Map<Identity, number[]>();
  /** Steps that used a mixture: what they make is a mixture too. */
  const mixed = new Set<number>();
  /** "step:line" for a line that's in a mixture the step uses. */
  const inMixture = new Set<string>();
  const counts = (m: Mention) => !m.which && m.share.kind !== "skip";
  const usedHere = (s: number) => {
    const ids = new Set<Identity>();
    for (const m of steps[s]?.mentions ?? []) {
      if (counts(m)) m.ids.forEach((id) => ids.add(id));
    }
    return ids;
  };
  steps.forEach(({ step, mentions }, s) => {
    for (const m of mentions) {
      if (m.ids.length === 0) continue;
      if (m.mixture || (m.melted && m.ids.every((id) => !id.divided))) {
        // Made in this same step ("the blueberries and flour ... the blueberry mixture")?
        const earlierHere = mentions.some(
          (o) =>
            o !== m && o.start < m.start && !o.mixture && o.ids.some((id) => m.ids.includes(id)),
        );
        // The latest step that made it: mixed it with something else, or melted it.
        const made = (e: number) =>
          m.mixture
            ? mixed.has(e) || usedHere(e).size >= 2
            : /\bmelt/iu.test(steps[e]?.step.text ?? "");
        // "the melted chocolate" may be the milk chocolate the mousse melted.
        const word = root(m.word.split(/\s+/u).at(-1) ?? "");
        const made_ = m.melted
          ? [
              ...m.ids,
              ...identities.filter(
                (id) => !m.ids.includes(id) && (id.heads.has(word) || id.compoundHeads.has(word)),
              ),
            ]
          : m.ids;
        const before = made_.flatMap((id) => (madeIn.get(id) ?? []).filter((e) => e < s));
        const making = before.filter(made);
        const from = earlierHere
          ? -1
          : Math.max(-1, ...(making.length || m.melted ? making : before));
        const source = steps[from];
        if (!source) {
          if (m.mixture) m.ids = [];
          continue;
        }
        const lead =
          m.share.kind === "part" || m.share.kind === "remaining" || m.share.kind === "portion"
            ? shareWords(step.text, m.start)
            : "";
        const lineIds = [...usedHere(from)].map((id) => id.line.id);
        const list = mixtures.get(s) ?? [];
        const name = m.mixture ?? `melted ${m.word}`;
        // One row a mixture: "the ham/onion mixture" isn't also "the onion mixture", nor "the
        // jam mixture … the remaining jam mixture" two.
        const end = m.start + name.length;
        const again = list.some(
          (o) =>
            o.use.kind === "mixture" &&
            o.use.fromStepId === source.step.id &&
            ((m.start >= o.at && m.start < o.end) ||
              (o.name.toLowerCase() === name.toLowerCase() && (!lead || o.use.name === o.name))),
        );
        if (!again) {
          list.push({
            at: m.start,
            end,
            name,
            use: { kind: "mixture", name: `${lead}${name}`, fromStepId: source.step.id, lineIds },
          });
        }
        mixtures.set(s, list);
        // What went into it was used here too, for a later "the chocolate mixture".
        for (const id of m.ids) madeIn.set(id, [...(madeIn.get(id) ?? []), s]);
        mixed.add(s);
        // "Pour the pasta mixture … until the pasta is cooked": not the pasta again.
        for (const id of m.ids) inMixture.add(`${s}:${id.line.id}`);
        m.ids = [];
        continue;
      }
      if (!counts(m)) continue;
      for (const id of m.ids) {
        const at = madeIn.get(id) ?? [];
        if (!at.includes(s)) madeIn.set(id, [...at, s]);
      }
    }
  });

  // Each line's uses, one per step.
  const uses = new Map<Identity, Use[]>();
  const whiches: { step: number; at: number; use: StepUse; ids: Identity[] }[] = [];
  steps.forEach(({ step, mentions }, s) => {
    for (const m of mentions) {
      if (m.ids.length === 0) continue;
      if (m.which) {
        // "brush away any clumps of oil": not a use, so nothing to be unsure about.
        if (m.share.kind === "skip") continue;
        // "The rest of the cheese": the cheese that was used in part before.
        if (m.share.kind === "remaining" || m.share.kind === "reserved") {
          const split = m.ids.filter(
            (id) =>
              id.divided ||
              (uses.get(id) ?? []).some(
                (u) => u.share.kind === "part" || u.share.kind === "written",
              ),
          );
          if (split.length === 1) m.ids = split;
        }
        if (m.ids.length > 1) {
          const words = m.word.split(/[\s-]+/u).map(root);
          whiches.push({
            step: s,
            at: m.start,
            ids: m.ids,
            use: {
              kind: "which",
              lineIds: m.ids.map((id) => id.line.id),
              word: m.word,
              names: m.ids.map((id) => nameBesides(id.line.text, words)),
            },
          });
          continue;
        }
      }
      const inBefore = (id: Identity) =>
        (uses.get(id) ?? []).some((u) => u.step < s && u.share.kind !== "skip");
      // "Garnish with the onions" after "Cook the onion": the onions not in yet.
      if (m.every && m.ids.length > 1) {
        const fresh = m.ids.filter((id) => !inBefore(id));
        if (fresh.length && fresh.length < m.ids.length) m.ids = fresh;
      }
      // "Place sparkling sugar … dredge in sugar", once the plain sugar is in: the sparkling.
      const picked = m.ids[0];
      if (
        m.backRef &&
        picked &&
        m.ids.length === 1 &&
        m.share.kind === "plain" &&
        !picked.divided &&
        inBefore(picked)
      ) {
        m.ids = [m.backRef];
      }
      const phraseOf = (m: Mention) => {
        const lead =
          /\b(?:the\s+)?(?:remaining|rest\s+of(?:\s+the)?|remainder\s+of(?:\s+the)?|reserved|leftover|other\s+half\s+of(?:\s+the)?)\s+(?:[\p{L}-]+\s+){0,2}$/iu.exec(
            step.text.slice(Math.max(0, m.start - 50), m.start),
          )?.[0] ?? "the remaining ";
        const words = `${lead}${m.word}`;
        return words.charAt(0).toLowerCase() + words.slice(1);
      };
      for (const id of m.ids) {
        const list = uses.get(id) ?? [];
        const here = list.find((u) => u.step === s);
        const read = asWritten(m.share, id);
        let share: Share = read.kind === "written" ? { ...read, name: m.word } : read;
        // "dust with flour", "drizzle with olive oil" for "…, plus more for drizzling": the
        // extra, not the measured line again.
        // "2 cups flour, plus more for dusting": the extra is for the counter, not the parsley's
        // "plus more for serving".
        const extra =
          /\b(?:plus|and)\s+(?:more|extra|additional)\b|\bextra\b/iu.test(id.line.text) &&
          !/\b(?:more|extra)\b[^,;]*\bfor\s+(?:the\s+)?(?:serv|garnish|topp|decorat|finish)/iu.test(
            id.line.text,
          );
        const earlier = list.some((u) => u.step < s && u.share.kind !== "skip");
        if (share.kind === "plain" && inMixture.has(`${s}:${id.line.id}`)) share = { kind: "skip" };
        // "Remove the onion", "Return the chicken to the pan": what's in already.
        if (share.kind === "plain" && m.aside === "moved" && earlier) share = { kind: "skip" };
        // "Poach an egg" of the 4 eggs: one, as the step says; "the poached egg", once they're
        // in: them again, not 4 more.
        const many = totals(id.line.text).some((t) => t.unit === null && t.value > 1);
        // "4 garlic cloves, 2 smashed, 2 thinly sliced": "the smashed garlic" is 2 of them.
        const preps = share.kind === "plain" ? splitPrep(id.line.text) : [];
        if (preps.length) {
          const own = m.word.split(/\s+/u)[0]?.toLowerCase() ?? "";
          const before = /([\p{L}]+)\s+$/u
            .exec(step.text.slice(Math.max(0, m.start - 20), m.start))?.[1]
            ?.toLowerCase();
          if (preps.includes(own)) share = { kind: "small", words: m.word };
          else if (before && preps.includes(before)) {
            share = { kind: "small", words: `${before} ${m.word}` };
          }
        }
        const counted = id.options.some(
          (o) => o.at(-1) === root(m.word.split(/\s+/u).at(-1) ?? ""),
        );
        if (share.kind === "plain" && many && counted && !pluralWord(m.word)) {
          const a = /\b(an?)\s+$/iu.exec(step.text.slice(Math.max(0, m.start - 4), m.start));
          if (a) share = { kind: "small", words: `${a[1]} ${m.word}` };
          // "the warm poached egg", once they're in (not "the chicken", which is all of it).
          else if (
            earlier &&
            !id.divided &&
            /\b(?:poached|cooked|fried|boiled|baked|roasted|grilled|toasted|seared|browned|scrambled|braised)\s+$/iu.test(
              step.text.slice(Math.max(0, m.start - 20), m.start),
            )
          ) {
            share = { kind: "skip" };
          }
        }
        if (
          share.kind === "plain" &&
          !forThePan(id) &&
          ((m.dusting && (extra || (earlier && !id.divided))) ||
            (earlier && (m.serving || forTheExtra(id, step.text, m.start))))
        ) {
          share = { kind: "skip" };
        }
        const topping = m.serving || m.dusting ? { topping: true as const } : {};
        if (!here) {
          list.push({
            step: s,
            at: m.start,
            id,
            share,
            word: m.word,
            phrase: phraseOf(m),
            ...topping,
          });
        } else if (
          // "½ tsp Diamond Crystal or ¼ tsp Morton kosher salt": one of the line's own choices.
          here.share.kind === "written" &&
          share.kind === "written" &&
          /^[^.;!?]{0,40}\bor\b[^.;!?]{0,40}$/iu.test(
            step.text.slice(here.share.amount.end, share.amount.start),
          )
        ) {
          continue;
        } else {
          here.share = merge(here.share, share, id.divided);
          // "Crack 1 egg … repeat with remaining eggs": what's left, as the step says it.
          if (share.kind === "remaining" || share.kind === "reserved") here.phrase = phraseOf(m);
        }
        uses.set(id, list);
      }
    }
  });

  // "Just before serving, garnish with confectioners' sugar" when the 4 cups go into the frosting
  // later: a little extra, not the measured line.
  for (const list of uses.values()) {
    for (const u of list) {
      if (
        u.topping &&
        u.share.kind === "plain" &&
        !u.id.divided &&
        !forThePan(u.id) &&
        list.some((o) => o.step > u.step && o.share.kind !== "skip")
      ) {
        u.share = { kind: "skip" };
      }
    }
  }

  const result = new Map<string, { at: number; use: StepUse }[]>();
  steps.forEach(({ step }) => result.set(step.id, []));
  const put = (s: number, at: number, use: StepUse) => {
    const step = steps[s]?.step;
    if (step) result.get(step.id)?.push({ at, use });
  };

  for (const [id, list] of uses) {
    const decided = decide(id, list);
    list.forEach((u, k) => (decided[k] ?? []).forEach((use) => put(u.step, u.at, use)));
  }
  for (const [s, list] of mixtures) list.forEach((m) => put(s, m.at, m.use));
  const flagged = new Set<string>();
  const flaggedSteps = new Set<string>();
  for (const w of whiches) {
    // Not when the step already names one of them ("the cheddar ... the cheese"), or another
    // line it fits ("Add the vegetable oil … heat the oil").
    const here = steps[w.step]?.step.id ?? "";
    const listed = new Set(
      (result.get(here) ?? []).flatMap(({ use }) => ("lineId" in use ? [use.lineId] : [])),
    );
    const word = w.use.kind === "which" ? root(w.use.word.split(/\s+/u).at(-1) ?? "") : "";
    const fits = (id: Identity) => id.heads.has(word) || id.compoundHeads.has(word);
    if (w.ids.some((id) => listed.has(id.line.id))) continue;
    if (identities.some((id) => listed.has(id.line.id) && fits(id))) continue;
    // Nor when every one of them is already in ("Broil the cheese"): nothing new goes in.
    const inBefore = (id: Identity) =>
      (uses.get(id) ?? []).some((u) => u.step < w.step && u.share.kind !== "skip");
    if (w.ids.every(inBefore)) continue;
    // "the saucepan of cooked rice": what's already in, cooked.
    const before = steps[w.step]?.step.text.slice(Math.max(0, w.at - 20), w.at) ?? "";
    if (
      /\b(?:cooked|prepared|reserved|drained|melted|toasted)\s+$/iu.test(before) &&
      w.ids.some(inBefore)
    ) {
      continue;
    }
    // Once a step, and not again in a later step ("Cook the rice … the cooked rice").
    const lineKey = w.ids.map((id) => id.line.id).join(",");
    const key = `${here}:${lineKey}`;
    if (
      flagged.has(key) ||
      [...flaggedSteps].some((k) => k.endsWith(`|${lineKey}`) && !k.startsWith(`${here}|`))
    ) {
      continue;
    }
    flagged.add(key);
    flaggedSteps.add(`${here}|${lineKey}`);
    put(w.step, w.at, w.use);
  }

  // Each use once a step: "the flour mixture" named twice is one row.
  const once = (list: { use: StepUse }[]) => {
    const seen = new Set<string>();
    return list.filter(({ use }) => {
      const key = JSON.stringify(use);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  return new Map(
    [...result].map(([stepId, list]) => [
      stepId,
      once(list.sort((a, b) => a.at - b.at)).map(({ use }) => use),
    ]),
  );
}

/**
 * A step doing what a line's extra is for ("2 tbsp olive oil, plus more for drizzling", then
 * "drizzle with olive oil"): the extra, not the measured amount.
 */
function forTheExtra(id: Identity, text: string, at: number): boolean {
  const purpose =
    /\b(?:plus|and)\s+(?:more|extra|additional)(?:\s+[\p{L}]+)?\s+(?:for|to)\s+(?:the\s+)?([\p{L}]+)/iu.exec(
      id.line.text,
    )?.[1];
  if (!purpose) return false;
  const sentence = text.slice(sentenceStart(text, at), at + 40);
  const stem = purpose.toLowerCase().slice(0, 5);
  if (/^(?:serv|garni|topp|decor|finis)/u.test(stem)) return SERVING.test(sentence);
  return new RegExp(`\\b${stem}`, "iu").test(sentence);
}

/** "half the ", "the rest of the ": the words before a mixture's name. */
function shareWords(text: string, start: number): string {
  const m =
    /\b((?:half|some|part|most|(?:the\s+)?(?:remaining|rest|remainder))(?:\s+of)?(?:\s+the)?\s+)$/iu.exec(
      text.slice(0, start),
    );
  return m?.[1]?.toLowerCase() ?? "";
}

/**
 * A number the step writes before a name, with no unit ("with 1 egg", "press 8 cookies"): the
 * step's own amount. It's exact for a line counted the same way; "the remaining 1/4 chicken
 * broth" of a measured line is checked against what's left instead.
 */
function asWritten(s: Share, id: Identity): Share {
  if (s.kind !== "bare") return s;
  const counted = totals(id.line.text).some((t) => t.unit === null);
  if (s.remaining && !counted) return s;
  const amount: IngredientAmount = {
    low: s.value,
    high: null,
    unit: null,
    role: "other",
    approximate: false,
    start: s.start,
    end: s.end,
  };
  return { kind: "written", amount, exact: counted, remaining: s.remaining };
}

/**
 * How much of a line each step uses, from every step that uses it: for each use, the rows it
 * shows (none when it isn't a use of the listed amount after all).
 *
 * Only a divided line, or one a step takes a share of ("3/4 cup of the sugar", "half the
 * butter"), is ever part-used. Then "the remaining sugar" is worked out when every other share
 * is known exactly. When it can't be, a divided line says Fennl isn't sure how much (the recipe
 * doesn't say); when it's certain but not one tidy measure, or the line isn't divided, the step's
 * own words say it ("the remaining milk"). A line named again that isn't divided isn't listed
 * again once a share of it is known ("until the potatoes are soft").
 */
function decide(id: Identity, uses: Use[]): StepUse[][] {
  const lineId = id.line.id;
  const text = id.line.text;
  const all = totals(text);
  // A line with no amount at all ("Salt and pepper"): nothing to be unsure about.
  const unmeasured = !readIngredient(text).amounts.some((a) => a.role === "main");
  const divided = id.divided;
  const amountIn = (a: IngredientAmount, total: Total) =>
    a.high === null && !a.approximate ? inUnit(a.low, a.unit, total.unit) : null;
  // A step amount bigger than the whole line is for something else ("4 cups water" to boil).
  const tooBig = (a: IngredientAmount) =>
    all.some((t) => amountIn(a, t) !== null) &&
    all.every((t) => {
      const v = amountIn(a, t);
      return v === null || v > t.value * 1.001;
    });
  const kept = uses.map(({ share: s }): Share | null => {
    if (s.kind === "skip") return null;
    if (s.kind === "written" && tooBig(s.amount)) return null;
    if (s.kind === "several") {
      const amounts = s.amounts.filter((a) => !tooBig(a.amount));
      const one = amounts[0];
      if (s.rest) return amounts.length ? { ...s, amounts } : { kind: "remaining" };
      if (!one) return null;
      if (amounts.length === 1) return { kind: "written", ...one };
      return { kind: "several", amounts };
    }
    return s;
  });

  const known = (s: Share, total: Total): number | null => {
    if (s.kind === "written") return s.exact ? amountIn(s.amount, total) : null;
    if (s.kind === "part") return total.value * s.fraction;
    if (s.kind === "several") {
      if (s.rest) return null;
      let sum = 0;
      for (const { amount, exact } of s.amounts) {
        const v = exact ? amountIn(amount, total) : null;
        if (v === null) return null;
        sum += v;
      }
      return sum;
    }
    return null;
  };
  const isKnown = (s: Share | null) =>
    !!s && (s.kind === "written" || s.kind === "part" || (s.kind === "several" && !s.rest));
  /** Exactly how much, as far as the step says (in some unit). */
  const exactly = (s: Share) =>
    (s.kind === "written" && s.exact) ||
    s.kind === "part" ||
    (s.kind === "several" && !s.rest && s.amounts.every((a) => a.exact));
  const split =
    divided || kept.some((s) => isKnown(s) || (s?.kind === "several" && s.amounts.length > 0));
  const stepsWhere = (test: (s: Share) => boolean) =>
    uses.filter((_, k) => kept[k] && test(kept[k] as Share)).map((u) => u.step);
  const firstKnown = Math.min(...stepsWhere(isKnown));
  const firstUse = kept.findIndex((s) => !!s);
  const explicit = (s: Share) => s.kind === "remaining" || s.kind === "bare";
  const lastExplicit = Math.max(-1, ...stepsWhere(explicit));

  // Every share is written out and they add up to the whole line ("Crush 18 Oreos … chop the
  // remaining 10"): a later "the chopped Oreos" is them again, not more.
  const lastKnown = Math.max(-1, ...stepsWhere(isKnown));
  const accounted = all.some((t) => {
    let sum = 0;
    for (const s of kept) {
      if (!s || !isKnown(s)) continue;
      const v = known(s, t);
      if (v === null) return false;
      sum += v;
    }
    return Math.abs(sum - t.value) < 1e-3;
  });
  // What each plain, "whole", "reserved" or "remaining" use is: all of it, the rest (worked out,
  // or else unsure), unsure, not listed again, or the step's own words.
  type Role = "all" | "rest" | "some" | "drop" | "words";
  const others = (k: number) => kept.filter((o, j) => j !== k && !!o) as Share[];
  const role = uses.map((u, k): Role | null => {
    const s = kept[k];
    if (!s) return null;
    if (s.kind === "whole") return divided && others(k).length > 0 ? "some" : "all";
    if (!(s.kind === "plain" || s.kind === "reserved" || explicit(s))) return null;
    const earlier = kept.some((o, j) => j < k && !!o);
    // "the reserved flour", once some went in before: as the step says it.
    if (s.kind === "reserved") return earlier || unmeasured ? "words" : "all";
    if (unmeasured) return s.kind === "remaining" ? "words" : "all";
    // "Fold half into the batter … the remaining whipped cream": what's left, in its words.
    if (!split) return s.kind === "remaining" && earlier ? "words" : "all";
    if (accounted && !explicit(s) && u.step > lastKnown) return "drop";
    if (explicit(s)) return "rest";
    if (divided) return lastExplicit >= 0 ? "some" : "rest";
    // Not divided, and named again after a share was taken (or before it, once it's in): the
    // recipe doesn't say it's what's left (it may be the whole line, or something else), so it
    // isn't listed again.
    return k === firstUse && u.step < firstKnown ? "all" : "drop";
  });
  const rests = role.filter((r) => r === "rest").length;
  const inWords = (k: number): StepUse => ({
    kind: "small",
    lineId,
    words: uses[k]?.phrase ?? "",
  });

  /** What's left after every other step's share and `here` (this step's own amounts). */
  const whatsLeft = (k: number, here: Share[] = []): StepUse => {
    const s = kept[k] as Share;
    const unsure: StepUse = divided ? { kind: "some", lineId } : inWords(k);
    const rest = [
      ...(kept.filter((o, j) => j !== k && !!o && role[j] !== "drop") as Share[]),
      ...here,
    ];
    if ((rests !== 1 && here.length === 0) || rest.length === 0 || all.length === 0) return unsure;
    // Some share isn't known exactly ("add the sugar gradually", "about 1 cup"): not sure.
    if (!rest.every(exactly)) return unsure;
    const fromSteps = rest.flatMap((o) =>
      o.kind === "written"
        ? [o.amount]
        : o.kind === "several"
          ? o.amounts.map((a) => a.amount)
          : [],
    );
    // Amounts that don't scale like the line: a count ("2 of the eggs"), "half a cup".
    const counts = fromSteps.some(
      (a) => !a.unit || unitNamed(a.unit)?.kind === "count" || a.unscaled,
    );
    for (const total of all) {
      let used = 0;
      let ok = true;
      for (const o of rest) {
        const v = known(o, total);
        if (v === null) ok = false;
        else used += v;
      }
      if (!ok) continue;
      // "The remaining 1/4 chicken broth": only when that's exactly what's left.
      if (s.kind === "bare" && Math.abs(total.value - used - s.value) > 1e-3) return unsure;
      // Less than nothing left: something's not what it seems.
      if (total.value - used < 1e-6) return divided ? { kind: "some", lineId } : inWords(k);
      const left = friendly(total.value - used, total.unit);
      if (left) {
        return {
          kind: "remaining",
          lineId,
          value: left.value,
          unit: left.unit,
          ...(fromSteps.length
            ? { fromSteps: counts ? ("counts" as const) : ("measures" as const) }
            : {}),
        };
      }
    }
    // Certain, but not one tidy measure (5/6 cup), or in another kind of unit (a stick less
    // 2 tablespoons): the step's own words.
    return inWords(k);
  };

  const written = (a: IngredientAmount, remaining: boolean, name: string): StepUse => ({
    kind: "written",
    lineId,
    start: a.start,
    end: a.end,
    name,
    ...(remaining ? { remaining: true as const } : {}),
  });

  return uses.map((u, k): StepUse[] => {
    const s = kept[k];
    if (!s) return [];
    const r = role[k];
    if (r === "drop") return [];
    if (r === "words") return [inWords(k)];
    if (r === "all") return [{ kind: "all", lineId }];
    if (r === "some") return [{ kind: "some", lineId }];
    if (r === "rest") return [whatsLeft(k)];
    switch (s.kind) {
      case "written":
        return [written(s.amount, s.remaining, s.name ?? u.word)];
      case "several": {
        // "Grate 2 tablespoons butter ... cut the remaining 8 tablespoons": each as written.
        const rows = s.amounts.map((a) => written(a.amount, a.remaining, a.name ?? u.word));
        if (!s.rest) return rows;
        // … and what's left after them and every other step's share.
        if (others(k).length === 0 && !divided) return [{ kind: "all", lineId }];
        const left = whatsLeft(k, [{ kind: "several", amounts: s.amounts }]);
        return [...rows, left];
      }
      case "part": {
        if (unmeasured) return [{ kind: "small", lineId, words: s.words }];
        for (const total of all) {
          const v = friendly(total.value * s.fraction, total.unit);
          if (v) return [{ kind: "part", lineId, value: v.value, unit: v.unit, words: s.words }];
        }
        // "1/4 of the chicken" of 1½ lb: exactly what the step says, in its words.
        return [{ kind: "small", lineId, words: s.words }];
      }
      case "small":
        return [{ kind: "small", lineId, words: s.words }];
      case "portion":
        return unmeasured || !split
          ? [{ kind: "small", lineId, words: s.words }]
          : [{ kind: "some", lineId }];
      default:
        return [{ kind: "all", lineId }];
    }
  });
}
