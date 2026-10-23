import { MAX_LINK_DEPTH } from "./subRecipes";

// Printing recipes (phase F6): the choices of what goes on paper, kept with the account so they
// follow the person to every device, and which recipes a printout holds: the ones chosen, each
// followed by the recipes it links to when those are printed too.

export const PRINT_LAYOUTS = ["standard", "large", "compact", "card4x6", "card3x5"] as const;
export type PrintLayout = (typeof PRINT_LAYOUTS)[number];

export const LAYOUT_NAMES: Record<PrintLayout, string> = {
  standard: "Standard",
  large: "Large type",
  compact: "Compact",
  card4x6: "Recipe card, 4×6",
  card3x5: "Recipe card, 3×5",
};

/** What a printout holds. Every switch is the person's, kept with their account. */
export interface PrintOptions {
  layout: PrintLayout;
  /** The cover photo (never on recipe cards: there's no room). */
  photo: boolean;
  /** The recipe's own notes. */
  notes: boolean;
  /** The household's stars and signed notes. */
  household: boolean;
  /** Nutrition per serving, when the recipe has some and it isn't hidden in Settings (F4). */
  nutrition: boolean;
  /** A QR code that opens the recipe in Fennl, for whoever may see it. */
  qr: boolean;
  /** The recipes its ingredients link to (F3), each on its own page after it. */
  linked: boolean;
  /** A contents page at the front of a booklet. */
  contents: boolean;
}

/** The choices before anyone changes them (owner's choices 2026-10-23: the QR code on). */
export const DEFAULT_PRINT: PrintOptions = {
  layout: "standard",
  photo: true,
  notes: true,
  household: true,
  nutrition: false,
  qr: true,
  linked: true,
  contents: false,
};

/** At most this many recipes in one printout (owner's choice 2026-10-23). */
export const MAX_PRINT_RECIPES = 200;

export const isPrintLayout = (value: unknown): value is PrintLayout =>
  PRINT_LAYOUTS.includes(value as PrintLayout);

const SWITCHES = [
  "photo",
  "notes",
  "household",
  "nutrition",
  "qr",
  "linked",
  "contents",
] as const satisfies readonly (keyof PrintOptions)[];

/**
 * Print choices from what was stored or sent: anything missing or not understood takes its
 * default, so choices added later never break ones kept before.
 */
export function printOptions(value: unknown): PrintOptions {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const options: PrintOptions = { ...DEFAULT_PRINT };
  if (isPrintLayout(v.layout)) options.layout = v.layout;
  for (const key of SWITCHES) {
    const on = v[key];
    if (typeof on === "boolean") options[key] = on;
  }
  return options;
}

/** Whether a value sent to the server is a whole, correct set of print choices. */
export function isPrintOptions(value: unknown): value is PrintOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  return (
    keys.length === SWITCHES.length + 1 &&
    isPrintLayout(v.layout) &&
    SWITCHES.every((key) => typeof v[key] === "boolean")
  );
}

/** A recipe card: small paper, one column of everything, no photo. */
export const isCard = (layout: PrintLayout) => layout === "card4x6" || layout === "card3x5";

/** One recipe in a printout, and the recipe it's printed for when it came in by a link. */
export interface PrintItem {
  id: string;
  /** The recipe whose ingredient links to this one, when it's printed because of that. */
  linkedFrom: string | null;
}

/**
 * The recipes a printout holds, in order: each one chosen, followed (when linked recipes are
 * printed too) by the recipes it links to, as deep as a recipe page expands them. Every recipe
 * is printed once, where it first comes (a linked recipe also chosen is printed where chosen),
 * and the whole stays within the limit, the chosen recipes first.
 */
export function printOrder(
  chosen: readonly string[],
  linksOf: (id: string) => readonly string[],
  withLinked: boolean,
  max = MAX_PRINT_RECIPES,
): PrintItem[] {
  const picked = [...new Set(chosen)].slice(0, max);
  const seen = new Set(picked);
  let room = max - picked.length;
  const order: PrintItem[] = [];
  const follow = (id: string, depth: number) => {
    if (!withLinked || depth >= MAX_LINK_DEPTH) return;
    for (const linked of linksOf(id)) {
      if (seen.has(linked) || room <= 0) continue;
      seen.add(linked);
      room--;
      order.push({ id: linked, linkedFrom: id });
      follow(linked, depth + 1);
    }
  };
  for (const id of picked) {
    order.push({ id, linkedFrom: null });
    follow(id, 0);
  }
  return order;
}
