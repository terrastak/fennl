/**
 * What an uploaded photo has to be (phase D1; CLAUDE.md, "R2 and image rules"). The server checks
 * every upload with these rules and never trusts the browser's own compression or the file's
 * declared type: it looks at the file's first bytes (its "signature") instead.
 */

/** The picture formats Fennl stores. The app sends WebP (or JPEG where WebP can't be made). */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** However high a plan's file limit is set, a single upload is never read past this. */
export const ABSOLUTE_MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const ascii = (bytes: Uint8Array, start: number, text: string) =>
  bytes.length >= start + text.length &&
  [...text].every((char, i) => bytes[start + i] === char.charCodeAt(0));

/**
 * The picture format a file really is, from its first bytes, or null when it isn't one Fennl
 * stores. (Whether the picture inside is intact is not checked here.)
 */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte)
  ) {
    return "image/png";
  }
  // WebP: "RIFF", a 4-byte size, then "WEBP".
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "image/webp";
  // AVIF: an ISO file whose first box is "ftyp" with the brand "avif" or "avis".
  if (ascii(bytes, 4, "ftyp") && (ascii(bytes, 8, "avif") || ascii(bytes, 8, "avis"))) {
    return "image/avif";
  }
  return null;
}

/** An image's ID is the SHA-256 of its bytes, in lowercase hex. */
export function isImageHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
