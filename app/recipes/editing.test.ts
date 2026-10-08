import { describe, expect, it } from "vitest";
import { emptyRecipeContent } from "../../shared/recipe";
import {
  changedFields,
  issueMessage,
  lineAt,
  lineEnd,
  moveLine,
  pick,
  timeFromText,
  webAddress,
  wholeNumber,
} from "./editing";
import { timeText } from "./format";

describe("moving a line with Alt+arrow", () => {
  const text = "1 cup flour\n2 eggs\n1 cup milk";

  it("moves the cursor's line down and up, cursor and all", () => {
    // Cursor after "2 e" on the second line.
    const cursor = text.indexOf("2 eggs") + 3;
    expect(moveLine(text, cursor, 1)).toEqual({
      text: "1 cup flour\n1 cup milk\n2 eggs",
      cursor: "1 cup flour\n1 cup milk\n".length + 3,
    });
    expect(moveLine(text, cursor, -1)).toEqual({
      text: "2 eggs\n1 cup flour\n1 cup milk",
      cursor: 3,
    });
  });

  it("does nothing at the ends", () => {
    expect(moveLine(text, 0, -1)).toBeNull();
    expect(moveLine(text, text.length, 1)).toBeNull();
  });

  it("works at the end of a line", () => {
    expect(moveLine(text, "1 cup flour".length, 1)?.text).toBe("2 eggs\n1 cup flour\n1 cup milk");
  });
});

describe("the line the cursor is on", () => {
  const text = "- 1 cup flour\n\n2 eggs";
  it("counts only lines the list keeps", () => {
    expect(lineAt(text, 0, "ingredients")).toBe(0);
    expect(lineAt(text, text.length, "ingredients")).toBe(1);
    expect(lineAt(text, "- 1 cup flour\n".length, "ingredients")).toBeNull();
    expect(lineAt("", 0, "directions")).toBeNull();
  });

  it("finds where a line ends", () => {
    expect(lineEnd(text, 0, "ingredients")).toBe("- 1 cup flour".length);
    expect(lineEnd(text, 1, "ingredients")).toBe(text.length);
  });
});

describe("reading a time box", () => {
  it.each([
    ["45", 45, null],
    ["45 min", 45, null],
    ["1 hr 30 min", 90, null],
    ["1h30", 90, null],
    ["1 1/2 hours", 90, null],
    ["1½ hours", 90, null],
    ["1.5 hrs", 90, null],
    ["2 hours and 15 minutes", 135, null],
    ["1 day", 1440, null],
    ["20 min plus resting", 20, "plus resting"],
    ["overnight", null, "overnight"],
    ["2-3 hours", null, "2-3 hours"],
    ["", null, null],
  ])("%s", (input, minutes, text) => {
    expect(timeFromText(input)).toEqual({ minutes, text });
  });

  it("reads back what the recipe page shows", () => {
    for (const shown of ["1 hr 15 min", "2 hr", "30 min", "1 hr 30 min plus overnight"]) {
      const time = timeFromText(shown);
      expect(timeText(time)).toBe(shown);
    }
  });
});

describe("changes to save", () => {
  it("are the fields that differ", () => {
    const before = { ...emptyRecipeContent(), title: "Stew" };
    const after = { ...before, title: "Green stew", notes: "Spicy" };
    expect(changedFields(before, after)).toEqual(["title", "notes"]);
    expect(pick(after, ["title"])).toEqual({ title: "Green stew" });
    expect(changedFields(before, { ...before })).toEqual([]);
  });

  it("reads web addresses", () => {
    expect(webAddress(" ")).toBeNull();
    expect(webAddress("example.com/stew")).toBe("https://example.com/stew");
    expect(webAddress("http://example.com")).toBe("http://example.com");
  });

  it("explains problems", () => {
    expect(issueMessage({ path: "title", problem: "missing" })).toBe("Give the recipe a title.");
    expect(issueMessage({ path: "ingredients.2.text", problem: "too_long" })).toBe(
      "Line 3 is too long.",
    );
  });

  it("reads number boxes", () => {
    expect(wholeNumber("")).toBeNull();
    expect(wholeNumber("45")).toBe(45);
    expect(wholeNumber("2.6")).toBe(3);
    expect(wholeNumber("abc")).toBeNull();
  });
});
