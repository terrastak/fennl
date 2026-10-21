import { describe, expect, it } from "vitest";
import {
  allScreenshots,
  cropOnOriginal,
  dragCorner,
  fitBox,
  isScreenshot,
  moved,
  turnBox,
  turned,
  unturnBox,
  type PageEdit,
} from "./pages";

// Phase E9: pages turned, cropped and put in order before they're read.

const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
const close = (a: object, b: object) =>
  Object.entries(b).forEach(([k, v]) =>
    expect((a as Record<string, number>)[k]).toBeCloseTo(v as number, 6),
  );

describe("pages in order", () => {
  it("move one place at a time, and not off either end", () => {
    expect(moved(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    expect(moved(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moved(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moved(["a", "b"], 1, 2)).toEqual(["a", "b"]);
  });
});

describe("turning", () => {
  it("takes the crop with the page, so it keeps the same words", () => {
    // The top-left corner goes to the top right.
    close(turnBox({ x: 0, y: 0, width: 0.5, height: 0.25 }), {
      x: 0.75,
      y: 0,
      width: 0.25,
      height: 0.5,
    });
    close(unturnBox(turnBox(box)), box);
    let page: PageEdit = { turns: 0, crop: box };
    for (let i = 0; i < 4; i++) page = turned(page);
    expect(page.turns).toBe(0);
    close(page.crop!, box);
  });

  it("finds the crop on the photo as taken", () => {
    expect(cropOnOriginal({ turns: 3, crop: null })).toBeNull();
    close(cropOnOriginal({ turns: 0, crop: box })!, box);
    // Cropped after turning once: the same part of the photo as before turning.
    close(cropOnOriginal(turned({ turns: 0, crop: box }))!, box);
    close(cropOnOriginal(turned(turned(turned({ turns: 0, crop: box }))))!, box);
  });
});

describe("cropping", () => {
  it("drags a corner, keeping the opposite one, never too small or off the page", () => {
    close(dragCorner(box, "bottom-right", 0.8, 0.9), { x: 0.1, y: 0.2, width: 0.7, height: 0.7 });
    close(dragCorner(box, "top-left", -1, 0), { x: 0, y: 0, width: 0.4, height: 0.6 });
    close(dragCorner(box, "top-left", 0.9, 0.9), { x: 0.3, y: 0.5, width: 0.1, height: 0.1 });
  });

  it("counts the whole page as no crop", () => {
    expect(fitBox({ x: 0, y: 0, width: 1, height: 1 })).toBeNull();
    close(fitBox({ x: 0.95, y: 0, width: 0.02, height: 2 })!, {
      x: 0.9,
      y: 0,
      width: 0.1,
      height: 1,
    });
  });
});

describe("screenshots (phase E11)", () => {
  const png = new Blob(["x"], { type: "image/png" });
  const jpeg = new Blob(["x"], { type: "image/jpeg" });

  it("are the PNG pictures chosen, never one the camera just took", () => {
    expect(isScreenshot(png, false)).toBe(true);
    expect(isScreenshot(jpeg, false)).toBe(false);
    expect(isScreenshot(new Blob(["x"], { type: "image/heic" }), false)).toBe(false);
    expect(isScreenshot(png, true)).toBe(false);
  });

  it("are read as screenshots only when every page is one", () => {
    expect(allScreenshots([{ screenshot: true }, { screenshot: true }])).toBe(true);
    expect(allScreenshots([{ screenshot: true }, { screenshot: false }])).toBe(false);
    expect(allScreenshots([])).toBe(false);
  });
});
