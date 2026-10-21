import { describe, expect, it } from "vitest";
import { highlightWords } from "./highlight";

// Phase E10: the words the AI wasn't sure of, highlighted in the line.

describe("highlightWords", () => {
  it("marks each word wherever it is, longest first", () => {
    expect(highlightWords("1/3 Cups flour", ["1/3", "flour"])).toEqual([
      { text: "1/3", marked: true },
      { text: " Cups ", marked: false },
      { text: "flour", marked: true },
    ]);
    expect(highlightWords("2 Sq Bakers Choc", ["Sq", "Sq Bakers"])).toEqual([
      { text: "2 ", marked: false },
      { text: "Sq Bakers", marked: true },
      { text: " Choc", marked: false },
    ]);
  });

  it("leaves a line alone when the words aren't in it (any more)", () => {
    expect(highlightWords("2 cups flour", ["flowr", " "])).toEqual([
      { text: "2 cups flour", marked: false },
    ]);
  });
});
