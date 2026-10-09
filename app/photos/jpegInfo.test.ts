import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readJpegInfo, swapsSides } from "./jpegInfo";

/** A minimal JPEG header: optional EXIF (orientation, GPS), then a frame of the given size. */
function jpeg(options: {
  width: number;
  height: number;
  orientation?: number;
  gps?: boolean;
  little?: boolean;
}): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  const entries: [number, number, number, number][] = []; // tag, type, count, value
  if (options.orientation) entries.push([0x0112, 3, 1, options.orientation]);
  if (options.gps) entries.push([0x8825, 4, 1, 0]);
  if (entries.length) {
    const le = options.little ?? false;
    const u16 = (n: number) => (le ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
    const u32 = (n: number) =>
      le
        ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]
        : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    const tiff = [
      ...(le ? [0x49, 0x49] : [0x4d, 0x4d]),
      ...u16(42),
      ...u32(8),
      ...u16(entries.length),
    ];
    for (const [tag, type, count, value] of entries) {
      // A SHORT value sits in the first two bytes of the four-byte value field.
      tiff.push(
        ...u16(tag),
        ...u16(type),
        ...u32(count),
        ...(type === 3 ? [...u16(value), 0, 0] : u32(value)),
      );
    }
    tiff.push(...u32(0));
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    out.push(0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body);
  }
  const { width: w, height: h } = options;
  out.push(0xff, 0xc0, 0, 11, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0);
  out.push(0xff, 0xda, 0, 2, 0xff, 0xd9);
  return Uint8Array.from(out);
}

describe("readJpegInfo", () => {
  it("reads size, turn and location, in either byte order", () => {
    expect(readJpegInfo(jpeg({ width: 4032, height: 3024, orientation: 6, gps: true }))).toEqual({
      orientation: 6,
      width: 4032,
      height: 3024,
      hasLocation: true,
    });
    expect(readJpegInfo(jpeg({ width: 800, height: 600, orientation: 3, little: true }))).toEqual({
      orientation: 3,
      width: 800,
      height: 600,
      hasLocation: false,
    });
  });

  it("treats a photo without EXIF as upright", () => {
    expect(readJpegInfo(jpeg({ width: 10, height: 20 }))).toEqual({
      orientation: 1,
      width: 10,
      height: 20,
      hasLocation: false,
    });
  });

  it("reads the owner's iPhone photos: turned a quarter, with a location", () => {
    for (const name of ["IMG_0019", "IMG_0020"]) {
      const bytes = new Uint8Array(readFileSync(`test_images/${name}.jpeg`));
      expect(readJpegInfo(bytes)).toEqual({
        orientation: 6,
        width: 5712,
        height: 4284,
        hasLocation: true,
      });
    }
    // A small web JPEG with no EXIF.
    const card = readJpegInfo(new Uint8Array(readFileSync("test_images/handwriten1.jpg")));
    expect(card).toMatchObject({ orientation: 1, width: 720, height: 405, hasLocation: false });
  });

  it("returns null for anything else, and never throws on damaged files", () => {
    expect(readJpegInfo(new Uint8Array(readFileSync("test_images/handwritten2.gif")))).toBeNull();
    expect(readJpegInfo(new Uint8Array())).toBeNull();
    const whole = jpeg({ width: 100, height: 50, orientation: 8, gps: true });
    for (let cut = 0; cut < whole.length; cut++) {
      expect(() => readJpegInfo(whole.slice(0, cut))).not.toThrow();
    }
  });
});

describe("swapsSides", () => {
  it("is true only for the quarter turns", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(swapsSides)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
  });
});
