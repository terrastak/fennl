import { describe, expect, it } from "vitest";
import { SAMPLE, paintStrokes, seededRandom } from "./brushStrokes";

/** A photo's pixels: dark on the left half, light on the right, so one upright edge. */
function halves(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(SAMPLE.width * SAMPLE.height * 4);
  for (let y = 0; y < SAMPLE.height; y++) {
    for (let x = 0; x < SAMPLE.width; x++) {
      const i = (y * SAMPLE.width + x) * 4;
      const light = x >= SAMPLE.width / 2;
      pixels.set(light ? [240, 200, 120, 255] : [60, 40, 20, 255], i);
    }
  }
  return pixels;
}

describe("Fennl's painting of a photo", () => {
  it("is the same painting every time for the same photo, and another for another", () => {
    const a = paintStrokes(halves(), seededRandom("photo-a"));
    expect(paintStrokes(halves(), seededRandom("photo-a"))).toEqual(a);
    expect(paintStrokes(halves(), seededRandom("photo-b"))).not.toEqual(a);
  });

  it("paints in the photo's own colours", () => {
    const strokes = paintStrokes(halves(), seededRandom("colours"));
    const colours = new Set(strokes.map((s) => s.colour.join(",")));
    expect(colours).toEqual(new Set(["60,40,20", "240,200,120"]));
  });

  it("follows the photo's edges", () => {
    // Strokes that land on the upright edge run up and down it, not across it.
    const middle = (SAMPLE.width / 2) * (600 / SAMPLE.width);
    const onEdge = paintStrokes(halves(), seededRandom("edges")).filter((s) => {
      const x = (s.from[0] + s.to[0]) / 2;
      return Math.abs(x - middle) < 2;
    });
    expect(onEdge.length).toBeGreaterThan(0);
    for (const s of onEdge) {
      const across = Math.abs(s.to[0] - s.from[0]);
      const along = Math.abs(s.to[1] - s.from[1]);
      expect(along).toBeGreaterThan(across);
    }
  });
});
