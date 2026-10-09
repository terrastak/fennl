import { describe, expect, it } from "vitest";
import { MIN_SAVING, PHOTO_SETTINGS, fittedSize, keepOriginal } from "./settings";

describe("fittedSize", () => {
  it("shrinks the longest side to the limit and keeps the shape", () => {
    expect(fittedSize(4284, 5712, 2400)).toEqual({ width: 1800, height: 2400 });
    expect(fittedSize(5712, 4284, 3000)).toEqual({ width: 3000, height: 2250 });
  });

  it("never enlarges", () => {
    expect(fittedSize(1024, 1024, 2400)).toEqual({ width: 1024, height: 1024 });
  });
});

describe("keepOriginal", () => {
  const base = {
    type: "image/jpeg",
    bytes: 500_000,
    width: 2178,
    height: 2904,
    hasLocation: false,
    turned: false,
    encodedBytes: 450_000,
    maxEdge: PHOTO_SETTINGS.page.maxEdge,
    maxFileBytes: 5 * 1024 * 1024,
  };

  it("keeps a scan when re-encoding would save little (the owner's cookbook PDFs)", () => {
    expect(keepOriginal(base)).toBe(true);
    // Saving at least MIN_SAVING: use the re-encoded one.
    expect(keepOriginal({ ...base, encodedBytes: base.bytes * (1 - MIN_SAVING) - 1 })).toBe(false);
  });

  it("never keeps a camera photo: too big, turned, or carrying a location", () => {
    expect(keepOriginal({ ...base, width: 5712, height: 4284 })).toBe(false);
    expect(keepOriginal({ ...base, turned: true })).toBe(false);
    expect(keepOriginal({ ...base, hasLocation: true })).toBe(false);
  });

  it("keeps a GIF as it is while it fits the file limit", () => {
    const gif = { ...base, type: "image/gif", encodedBytes: 1 };
    expect(keepOriginal(gif)).toBe(true);
    expect(keepOriginal({ ...gif, bytes: 6 * 1024 * 1024 })).toBe(false);
  });

  it("re-encodes formats the server doesn't take, such as HEIC", () => {
    expect(keepOriginal({ ...base, type: "image/heic", encodedBytes: base.bytes * 2 })).toBe(false);
  });
});
