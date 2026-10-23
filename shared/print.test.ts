import { describe, expect, it } from "vitest";
import { DEFAULT_PRINT, isPrintOptions, printOptions, printOrder } from "./print";

// Phase F6: what a printout holds.

describe("print choices", () => {
  it("start with the QR code on and the contents page off", () => {
    expect(printOptions(null)).toEqual(DEFAULT_PRINT);
    expect(DEFAULT_PRINT.qr).toBe(true);
    expect(DEFAULT_PRINT.contents).toBe(false);
  });

  it("keep what was stored and fill in anything missing or not understood", () => {
    expect(printOptions({ layout: "card3x5", photo: false, qr: "no", later: 1 })).toEqual({
      ...DEFAULT_PRINT,
      layout: "card3x5",
      photo: false,
    });
    expect(printOptions({ layout: "poster" }).layout).toBe("standard");
  });

  it("are only taken whole and correct by the server", () => {
    expect(isPrintOptions(DEFAULT_PRINT)).toBe(true);
    expect(isPrintOptions({ ...DEFAULT_PRINT, layout: "poster" })).toBe(false);
    expect(isPrintOptions({ ...DEFAULT_PRINT, extra: true })).toBe(false);
    const missing = Object.fromEntries(Object.entries(DEFAULT_PRINT).filter(([k]) => k !== "qr"));
    expect(isPrintOptions(missing)).toBe(false);
    expect(isPrintOptions([])).toBe(false);
  });
});

describe("the recipes a printout holds", () => {
  const links: Record<string, string[]> = {
    tacos: ["crema", "salsa"],
    crema: ["lime"],
    lime: ["zest"],
    zest: ["deeper"],
    salsa: ["crema"],
  };
  const linksOf = (id: string) => links[id] ?? [];
  const order = (chosen: string[], withLinked = true, max?: number) =>
    printOrder(chosen, linksOf, withLinked, max).map((p) => `${p.id}<${p.linkedFrom ?? ""}`);

  it("follows each recipe with the ones it links to, as deep as a page shows them", () => {
    expect(order(["tacos"])).toEqual([
      "tacos<",
      "crema<tacos",
      "lime<crema",
      "zest<lime",
      "salsa<tacos",
    ]);
  });

  it("prints each recipe once, a chosen one where it was chosen", () => {
    expect(order(["tacos", "crema"])).toEqual([
      "tacos<",
      "salsa<tacos",
      "crema<",
      "lime<crema",
      "zest<lime",
      "deeper<zest",
    ]);
    expect(order(["crema", "crema"])).toEqual(["crema<", "lime<crema", "zest<lime", "deeper<zest"]);
  });

  it("leaves linked recipes out when asked", () => {
    expect(order(["tacos", "salsa"], false)).toEqual(["tacos<", "salsa<"]);
  });

  it("stays within the limit, the chosen recipes first", () => {
    expect(order(["tacos", "salsa", "zest"], true, 4)).toEqual([
      "tacos<",
      "crema<tacos",
      "salsa<",
      "zest<",
    ]);
    expect(order(["a", "b", "c"], true, 2)).toEqual(["a<", "b<"]);
  });
});
