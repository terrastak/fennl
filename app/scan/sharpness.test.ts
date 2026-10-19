import { describe, expect, it } from "vitest";
import { BLURRY_BELOW, looksBlurry, sharpness, type Pixels } from "./sharpness";

// Phase E9: "This one looks blurry. Retake?"

/** Black writing on white: thin lines every few pixels, softened by `blur` passes. */
function page(blur: number, size = 200): Pixels {
  let gray = new Float32Array(size * size).fill(240);
  for (let y = 20; y < size - 20; y += 6) {
    for (let x = 20; x < size - 20; x++) if ((x * 7 + y) % 11 < 7) gray[y * size + x] = 30;
  }
  for (let pass = 0; pass < blur; pass++) {
    const next = new Float32Array(gray);
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        next[i] =
          ((gray[i] ?? 0) * 4 +
            (gray[i - 1] ?? 0) +
            (gray[i + 1] ?? 0) +
            (gray[i - size] ?? 0) +
            (gray[i + size] ?? 0)) /
          8;
      }
    }
    gray = next;
  }
  const data = new Uint8ClampedArray(size * size * 4);
  gray.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  return { data, width: size, height: size };
}

describe("sharpness", () => {
  it("is high for crisp writing and low once it's blurred", () => {
    const crisp = sharpness(page(0));
    const soft = sharpness(page(12));
    expect(crisp).toBeGreaterThan(BLURRY_BELOW * 10);
    expect(soft).toBeLessThan(BLURRY_BELOW);
    expect(looksBlurry(soft)).toBe(true);
    expect(looksBlurry(crisp)).toBe(false);
    expect(looksBlurry(null)).toBe(false);
  });

  it("is zero for a blank page", () => {
    const blank = new Uint8ClampedArray(50 * 50 * 4).fill(200);
    expect(sharpness({ data: blank, width: 50, height: 50 })).toBe(0);
  });
});
