import { describe, expect, it } from "vitest";
import { detectImageType, isImageHash } from "./images";

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => Uint8Array.from([...value].map((c) => c.charCodeAt(0)));

describe("detectImageType", () => {
  it("recognizes JPEG, PNG, GIF, WebP and AVIF by their first bytes", () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16))).toBe("image/jpeg");
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      "image/png",
    );
    expect(detectImageType(text("GIF89a......"))).toBe("image/gif");
    expect(detectImageType(text("GIF87a......"))).toBe("image/gif");
    expect(detectImageType(text("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(detectImageType(text("\0\0\0\x1cftypavif\0\0\0\0"))).toBe("image/avif");
    expect(detectImageType(text("\0\0\0\x1cftypavis\0\0\0\0"))).toBe("image/avif");
  });

  it("refuses everything else, whatever it is called", () => {
    expect(detectImageType(text("GIF90a......"))).toBeNull();
    expect(detectImageType(text("GIF8"))).toBeNull();
    expect(detectImageType(text("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(detectImageType(text("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(detectImageType(text("PK\x03\x04 a zip of pictures"))).toBeNull();
    expect(detectImageType(text("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(detectImageType(text("\0\0\0\x1cftypheic\0\0\0\0"))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull();
  });
});

describe("isImageHash", () => {
  it("accepts a lowercase SHA-256 in hex and nothing else", () => {
    expect(isImageHash("a".repeat(64))).toBe(true);
    expect(isImageHash("A".repeat(64))).toBe(false);
    expect(isImageHash("a".repeat(63))).toBe(false);
    expect(isImageHash("../" + "a".repeat(61))).toBe(false);
    expect(isImageHash(undefined)).toBe(false);
  });
});
