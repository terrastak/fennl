import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { QUIET_ZONE, qrCode, recipeAddress } from "./qr";

// Phase F6: the printed QR code reads back as the recipe's address.

/** The code drawn as pixels, as a phone's camera would see it, then read. */
function read(text: string): string | null {
  const { size, modules } = qrCode(text);
  const scale = 4;
  const width = size * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const at = (((y + QUIET_ZONE) * scale + dy) * width + (x + QUIET_ZONE) * scale + dx) * 4;
          pixels.fill(0, at, at + 3);
        }
      }
    }),
  );
  return jsQR(pixels, width, width)?.data ?? null;
}

describe("the printed QR code", () => {
  it("opens the recipe's own page", () => {
    const address = recipeAddress("https://beta.fennl.app", "0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(address).toBe("https://beta.fennl.app/recipes/0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(read(address)).toBe(address);
  });

  it("is one path of unit squares inside its clear space", () => {
    const { size, path, modules } = qrCode("https://example.com/recipes/x");
    expect(size).toBe(modules.length + QUIET_ZONE * 2);
    expect(path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/u);
  });
});
