import { describe, expect, it } from "vitest";
import { moveOpen } from "./openCategories";

describe("open categories after a move", () => {
  it("keeps the moved category and what's open inside it open under their new paths", () => {
    const open = new Set(["desserts", "desserts › cakes", "breakfast", "dessertsx"]);
    expect([...moveOpen(open, "desserts", "breakfast › desserts")].sort()).toEqual([
      "breakfast",
      "breakfast › desserts",
      "breakfast › desserts › cakes",
      "dessertsx",
    ]);
    // And back again (Undo).
    const back = moveOpen(
      moveOpen(open, "desserts", "breakfast › desserts"),
      "breakfast › desserts",
      "desserts",
    );
    expect([...back].sort()).toEqual([...open].sort());
    expect(moveOpen(open, "soup", "soup")).toBe(open);
  });
});
