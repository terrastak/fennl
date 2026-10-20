// How sharp a photo of a page is (phase E9; spec.md E9, step 1: "score each shot's sharpness and
// offer 'This one looks blurry. Retake?' at once"). The score is the variance of the Laplacian
// (how strongly brightness changes at each pixel compared with its neighbours) over the middle of
// the picture, where the page is: crisp writing has strong, sudden changes; a blurred photo only
// gentle ones. Measured on a copy at a fixed size (SHARPNESS_EDGE), so scores compare.

/** The longest side of the copy a score is measured on. */
export const SHARPNESS_EDGE = 1200;

/**
 * Below this, a photo is offered a retake. Set from the owner's photo test on an iPhone 18 Pro
 * (2026-10-20, /photo-trial): a card in focus scored 1384, the same card too close to focus 71.
 * Checked again as more phones are tried.
 */
export const BLURRY_BELOW = 150;

/** The share of each side left out around the edges (the table, the fingers holding the card). */
const MARGIN = 0.1;

/** Pixels as a canvas gives them: RGBA, four bytes each. */
export interface Pixels {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** The Laplacian variance of the middle of the picture; higher is sharper. */
export function sharpness({ data, width, height }: Pixels): number {
  const x0 = Math.max(1, Math.floor(width * MARGIN));
  const x1 = Math.min(width - 1, Math.ceil(width * (1 - MARGIN)));
  const y0 = Math.max(1, Math.floor(height * MARGIN));
  const y1 = Math.min(height - 1, Math.ceil(height * (1 - MARGIN)));
  if (x1 - x0 < 1 || y1 - y0 < 1) return 0;
  // Brightness of each pixel (Rec. 601 weights, as integers).
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = ((data[p] ?? 0) * 299 + (data[p + 1] ?? 0) * 587 + (data[p + 2] ?? 0) * 114) / 1000;
  }
  let sum = 0;
  let squares = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let x = x0; x < x1; x++) {
      const i = row + x;
      const value =
        (gray[i - 1] ?? 0) +
        (gray[i + 1] ?? 0) +
        (gray[i - width] ?? 0) +
        (gray[i + width] ?? 0) -
        4 * (gray[i] ?? 0);
      sum += value;
      squares += value * value;
      n += 1;
    }
  }
  const mean = sum / n;
  return squares / n - mean * mean;
}

export const looksBlurry = (score: number | null) => score !== null && score < BLURRY_BELOW;
