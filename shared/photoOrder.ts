import type { RecipePhoto } from "./recipe";

/**
 * Photos arranged by Fennl (phase D4; spec.md D4). The AI looks at a recipe's photos beside its
 * method and says what each one shows; these rules turn that into an order. Owner's choices
 * (2026-10-22):
 * - the cover is the best photo of the finished dish, or another clearly main photo;
 * - then photos of steps where seeing it helps make the dish, in the method's order;
 * - people don't need the same dish from three angles: another photo of the finished dish follows
 *   the cover only when it clearly adds something (the inside of a cake, how it's served);
 * - everything else follows the making of the dish: ingredients and getting ready, routine steps
 *   in the method's order, the other photos of the finished dish, then anything the AI couldn't
 *   place.
 * Where photos share a place, by when they were taken. A gallery someone has arranged by hand is
 * never rearranged.
 */

export const PHOTO_KINDS = ["finished", "step", "ingredients", "other"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

/** What the AI says about one photo, by its place in the list it was shown. */
export interface PhotoLabel {
  kind: PhotoKind;
  /** For a step: which step of the method (1 is the first), or null when it can't tell. */
  step: number | null;
  /**
   * For a step: seeing it helps someone make the dish. For another photo of the finished dish:
   * it clearly adds something the cover doesn't.
   */
  helps: boolean;
}

export interface PhotoLabels {
  /** One per photo, in the order they were shown; null for one the AI wasn't shown. */
  photos: (PhotoLabel | null)[];
  /** The photo that makes the best cover, by its place in the list. */
  cover: number;
}

/** The answer's shape, for the AI. */
export const PHOTO_LABELS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["photos", "cover"],
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["photo", "kind", "step", "helps"],
        properties: {
          photo: {
            type: "integer",
            description: "The photo's number, as labelled (1 is the first)",
          },
          kind: {
            type: "string",
            enum: [...PHOTO_KINDS],
            description:
              "finished: the dish made; step: making it; ingredients: the ingredients or getting ready; other: anything else",
          },
          step: {
            type: ["integer", "null"],
            description:
              "For a step: which step of the method it shows (1 is the first), else null",
          },
          helps: {
            type: "boolean",
            description:
              "For a step: seeing it would help someone make the dish (a texture, a shape, how it should look). For a photo of the finished dish other than the cover: it clearly shows something the cover doesn't (the inside, how it's served). Otherwise false",
          },
        },
      },
    },
    cover: {
      type: "integer",
      description:
        "The number of the photo that makes the best cover: the finished dish at its best, or another clearly main photo",
    },
  },
} as const;

/**
 * The AI's answer, checked: one label per photo (in the order shown, numbered from 1), and a
 * cover among them. Null when it doesn't fit.
 */
export function photoLabels(answer: unknown, count: number, steps: number): PhotoLabels | null {
  if (typeof answer !== "object" || answer === null) return null;
  const a = answer as { photos?: unknown; cover?: unknown };
  if (!Array.isArray(a.photos) || !Number.isInteger(a.cover)) return null;
  const cover = (a.cover as number) - 1;
  if (cover < 0 || cover >= count) return null;
  const photos: (PhotoLabel | null)[] = Array.from({ length: count }, () => null);
  for (const item of a.photos as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const p = item as Record<string, unknown>;
    const n = (p.photo as number) - 1;
    if (!Number.isInteger(n) || n < 0 || n >= count || photos[n]) return null;
    if (!(PHOTO_KINDS as readonly unknown[]).includes(p.kind)) return null;
    const step =
      p.kind === "step" &&
      Number.isInteger(p.step) &&
      (p.step as number) >= 1 &&
      (p.step as number) <= steps
        ? (p.step as number)
        : null;
    photos[n] = { kind: p.kind as PhotoKind, step, helps: p.helps === true };
  }
  if (photos.some((p) => p === null)) return null;
  return { photos, cover };
}

/** The gallery's images, sorted: the same photos give the same key, whatever their order. */
export const photosKey = (hashes: string[]) => [...hashes].sort().join(",");

/** Fennl put this gallery in order and nobody has changed it since: worth saying so. */
export const arrangedByFennl = (gallery: RecipePhoto[]) =>
  gallery.length > 1 &&
  gallery.some((photo) => photo.arrangedBy === "fennl") &&
  !gallery.some((photo) => photo.arrangedBy === "person");

/** Someone has moved a photo in this gallery: its order is theirs (phase D4). */
export const arrangedByHand = (gallery: RecipePhoto[]) =>
  gallery.some((photo) => photo.arrangedBy === "person");

/**
 * Earlier first by when taken; photos that don't say come after those that do, in the order they
 * were added (the gallery's order).
 */
function byTime(a: { photo: RecipePhoto; at: number }, b: { photo: RecipePhoto; at: number }) {
  const ta = a.photo.takenAt ?? null;
  const tb = b.photo.takenAt ?? null;
  if (ta !== null && tb !== null && ta !== tb) return ta - tb;
  if ((ta === null) !== (tb === null)) return ta === null ? 1 : -1;
  return a.at - b.at;
}

/**
 * The gallery's photos in Fennl's order, by the AI's labels (given in the gallery's current
 * order), or by when they were taken when there are none.
 */
export function arrangedOrder(gallery: RecipePhoto[], labels: PhotoLabels | null): RecipePhoto[] {
  const items = gallery.map((photo, at) => ({ photo, at, label: labels?.photos[at] ?? null }));
  if (!labels) return [...items].sort(byTime).map((i) => i.photo);
  /** A place in the order, then the step, then the time. */
  const place = (i: (typeof items)[number]): number => {
    const label = i.label;
    if (i.at === labels.cover) return 0;
    if (!label) return 8;
    switch (label.kind) {
      case "finished":
        return label.helps ? 1 : 6;
      case "step":
        return label.helps ? 2 : 5;
      case "ingredients":
        return 4;
      default:
        return 7;
    }
  };
  return [...items]
    .sort(
      (a, b) =>
        place(a) - place(b) ||
        (a.label?.step ?? Infinity) - (b.label?.step ?? Infinity) ||
        byTime(a, b),
    )
    .map((i) => i.photo);
}

/**
 * POST /api/photos/arrange's answer: the gallery's photo ids in Fennl's order, and how it was
 * decided: "fennl" (by what the AI saw), "time" (by when they were taken: the AI wasn't
 * available), "person" (arranged by hand: left as it is), "unchanged" (fewer than two photos).
 */
export interface PhotoOrderResponse {
  order: string[];
  by: "fennl" | "time" | "person" | "unchanged";
}
