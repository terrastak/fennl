// The brush strokes of Fennl's painting of a recipe's photo (app/photos/painting.ts): each stroke
// takes the photo's colour where it lands and follows the edges there, so the painting reads as
// food without being the photo.

/** Size of the painting; it's shown blurred, so a small one is plenty. */
export const PAINTING = { width: 600, height: 350 } as const;

/** Where the photo is sampled: a small copy, so reading a pixel is cheap. */
export const SAMPLE = { width: 240, height: 140 } as const;

/** Big strokes first, then smaller ones on top, like blocking in a painting. */
const PASSES = [
  { length: 110, width: 40, count: 420 },
  { length: 60, width: 20, count: 1100 },
] as const;

export interface Stroke {
  /** Start, bend and end of the stroke, in the painting's pixels. */
  from: [number, number];
  bend: [number, number];
  to: [number, number];
  width: number;
  colour: [number, number, number];
}

/** Repeatable random numbers from 0 to 1, starting from a key (the photo's hash). */
export function seededRandom(key: string): () => number {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * The strokes of a painting of `sample` (a photo's pixels, already mirrored and zoomed, as RGBA
 * rows `SAMPLE.width` wide). Each stroke follows the edge where it lands: across the direction
 * the brightness changes, or any way where it doesn't.
 */
export function paintStrokes(sample: Uint8ClampedArray, random: () => number): Stroke[] {
  const at = (x: number, y: number): [number, number, number] => {
    const cx = Math.max(0, Math.min(SAMPLE.width - 1, Math.floor(x)));
    const cy = Math.max(0, Math.min(SAMPLE.height - 1, Math.floor(y)));
    const i = (cy * SAMPLE.width + cx) * 4;
    return [sample[i] ?? 0, sample[i + 1] ?? 0, sample[i + 2] ?? 0];
  };
  const light = (x: number, y: number) => {
    const [r, g, b] = at(x, y);
    return 0.3 * r + 0.59 * g + 0.11 * b;
  };
  const strokes: Stroke[] = [];
  for (const pass of PASSES) {
    for (let n = 0; n < pass.count; n++) {
      const x = random() * PAINTING.width;
      const y = random() * PAINTING.height;
      const u = (x / PAINTING.width) * SAMPLE.width;
      const v = (y / PAINTING.height) * SAMPLE.height;
      const gx = light(u + 1, v) - light(u - 1, v);
      const gy = light(u, v + 1) - light(u, v - 1);
      const flat = Math.abs(gx) + Math.abs(gy) < 4;
      const angle =
        (flat ? random() * Math.PI : Math.atan2(gy, gx) + Math.PI / 2) + (random() - 0.5) * 0.5;
      const length = pass.length * (0.6 + random() * 0.8);
      const dx = (Math.cos(angle) * length) / 2;
      const dy = (Math.sin(angle) * length) / 2;
      strokes.push({
        from: [x - dx, y - dy],
        bend: [x + (random() - 0.5) * length * 0.3, y + (random() - 0.5) * length * 0.3],
        to: [x + dx, y + dy],
        width: pass.width * (0.7 + random() * 0.6),
        colour: at(u, v),
      });
    }
  }
  return strokes;
}
