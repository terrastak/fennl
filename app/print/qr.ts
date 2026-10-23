import { encode } from "uqr";

// The QR code on a printout (phase F6): the recipe's own Fennl address. Scanning it grants
// nothing by itself: the address asks the person to sign in, and the recipe opens only for
// someone who may see it (today, its household; CLAUDE.md, "Access rule").

/** The address a printed recipe's QR code opens. */
export function recipeAddress(origin: string, recipeId: string): string {
  return `${origin}/recipes/${recipeId}`;
}

/** Modules of clear space around the code, as scanners expect. */
export const QUIET_ZONE = 4;

/**
 * A QR code as one SVG path, a unit square per dark module, with the clear space around it:
 * `size` modules across in all. Medium error correction, so a smudge or a crease still scans.
 */
export function qrCode(text: string): { size: number; path: string; modules: boolean[][] } {
  const { data, size } = encode(text, { ecc: "M", border: 0 });
  const parts: string[] = [];
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`);
    }),
  );
  return { size: size + QUIET_ZONE * 2, path: parts.join(""), modules: data };
}
