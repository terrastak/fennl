import { describe, expect, it } from "vitest";
import { orderAfter, orderAt } from "./order";

describe("photo order", () => {
  it("puts a moved photo between its new neighbours", () => {
    expect(orderAt([1, 2, 3], 0)).toBe(0); // the new cover
    expect(orderAt([1, 2, 3], 1)).toBe(1.5);
    expect(orderAt([1, 2, 3], 3)).toBe(4);
    expect(orderAt([], 0)).toBe(1);
  });

  it("adds new photos at the end", () => {
    expect(orderAfter([])).toBe(1);
    expect(orderAfter([0, 1.5, 4])).toBe(5);
  });
});
