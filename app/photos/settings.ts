/**
 * How Fennl prepares a photo before uploading it (phase D2; spec.md D2, step 1). Starting values,
 * checked with the owner's own photos on 2026-10-08 and 2026-10-09 and to be confirmed on real
 * devices with the photo test (/photo-trial).
 */

/** What the picture is of: food looks best a little softer; text needs every edge. */
export type PhotoKind = "dish" | "page";

export interface PhotoSettings {
  /** The longest side is made no larger than this, in pixels. Photos are never enlarged. */
  maxEdge: number;
  /** Encoder quality, 0 to 1. */
  quality: number;
}

export const PHOTO_SETTINGS: Record<PhotoKind, PhotoSettings> = {
  dish: { maxEdge: 2400, quality: 0.85 },
  // Cookbook pages, handwritten cards and screenshots.
  page: { maxEdge: 3000, quality: 0.9 },
};

/**
 * Keep an already-compressed photo as it is unless re-encoding saves at least this much: a
 * second round of compression loses a little quality, and the AI import reads the original.
 */
export const MIN_SAVING = 0.2;

/** The size a photo is drawn at: its longest side at most `maxEdge`, never larger than it is. */
export function fittedSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Formats the server stores as they are (shared/images.ts), so an original can be kept. */
const KEEPABLE = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Whether to upload the original file rather than the re-encoded one. GIFs are kept as they are
 * (animation included) while they fit the file limit. Anything else is kept only if it is a
 * stored format, already small enough on its longest side, without location data, and
 * re-encoding wouldn't save at least MIN_SAVING.
 */
export function keepOriginal(input: {
  type: string;
  bytes: number;
  width: number;
  height: number;
  hasLocation: boolean;
  /** Turned by EXIF: the original's pixels aren't upright, so it can't be kept as it is. */
  turned: boolean;
  encodedBytes: number;
  maxEdge: number;
  maxFileBytes: number | null;
}): boolean {
  const fits = input.maxFileBytes === null || input.bytes <= input.maxFileBytes;
  if (input.type === "image/gif") return fits;
  if (!KEEPABLE.includes(input.type) || !fits || input.hasLocation || input.turned) return false;
  if (Math.max(input.width, input.height) > input.maxEdge) return false;
  return input.encodedBytes > input.bytes * (1 - MIN_SAVING);
}
