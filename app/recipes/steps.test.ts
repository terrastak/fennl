import { describe, expect, it } from "vitest";
import { directionsFromText } from "../../shared/recipeLines";
import {
  dropBlankStep,
  firstChange,
  followKeys,
  isBlankStep,
  joinWithNext,
  joinWithPrevious,
  moveStep,
  ordered,
  pasteInto,
  pastedLines,
  replaceRange,
  selectedText,
  splitStep,
  stepLabels,
  stepsFromText,
  textFromSteps,
  typedInto,
} from "./steps";

const STEPS = ["Heat the oil.", "Add the onion.", "Simmer 10 minutes."];

describe("steps and the Directions text", () => {
  it("are one step per line, a blank one too", () => {
    expect(stepsFromText("A\nB\n")).toEqual(["A", "B", ""]);
    expect(stepsFromText("")).toEqual([""]);
    expect(textFromSteps(["A", "", "B"])).toBe("A\n\nB");
  });

  it("knows a blank step, or one with only a bullet", () => {
    expect(isBlankStep("")).toBe(true);
    expect(isBlankStep("   ")).toBe(true);
    expect(isBlankStep("• ")).toBe(true);
    expect(isBlankStep("Stir.")).toBe(false);
  });

  it("puts two places in order", () => {
    const a = { step: 2, offset: 1 };
    const b = { step: 0, offset: 4 };
    expect(ordered(a, b)).toEqual({ start: b, end: a });
    expect(ordered(b, a)).toEqual({ start: b, end: a });
  });
});

describe("Enter", () => {
  it("at the end of a step starts a new empty step under it", () => {
    expect(splitStep(STEPS, { step: 0, offset: STEPS[0]!.length })).toEqual({
      texts: ["Heat the oil.", "", "Add the onion.", "Simmer 10 minutes."],
      cursor: { step: 1, offset: 0 },
    });
  });

  it("in the middle of a step splits it there", () => {
    expect(splitStep(["Mix well. Bake."], { step: 0, offset: 10 })).toEqual({
      texts: ["Mix well. ", "Bake."],
      cursor: { step: 1, offset: 0 },
    });
  });

  it("over words selected in the step takes them out first", () => {
    expect(splitStep(["Mix well and bake."], { step: 0, offset: 8 }, 13)).toEqual({
      texts: ["Mix well", "bake."],
      cursor: { step: 1, offset: 0 },
    });
  });
});

describe("Backspace and Delete at a step's edge", () => {
  it("Backspace at the start joins the step to the end of the one above", () => {
    expect(joinWithPrevious(STEPS, 1)).toEqual({
      texts: ["Heat the oil.Add the onion.", "Simmer 10 minutes."],
      cursor: { step: 0, offset: "Heat the oil.".length },
    });
    expect(joinWithPrevious(STEPS, 0)).toBeNull();
  });

  it("Backspace in an empty step takes it away", () => {
    expect(joinWithPrevious(["Stir.", ""], 1)).toEqual({
      texts: ["Stir."],
      cursor: { step: 0, offset: 5 },
    });
  });

  it("Delete at the end joins the next step to it", () => {
    expect(joinWithNext(STEPS, 1)).toEqual({
      texts: ["Heat the oil.", "Add the onion.Simmer 10 minutes."],
      cursor: { step: 1, offset: "Add the onion.".length },
    });
    expect(joinWithNext(STEPS, 2)).toBeNull();
  });
});

describe("Alt+↑ / Alt+↓", () => {
  it("moves the step, and says where it went", () => {
    expect(moveStep(STEPS, 1, -1)).toEqual({
      texts: ["Add the onion.", "Heat the oil.", "Simmer 10 minutes."],
      step: 0,
    });
    expect(moveStep(STEPS, 1, 1)).toEqual({
      texts: ["Heat the oil.", "Simmer 10 minutes.", "Add the onion."],
      step: 2,
    });
  });

  it("does nothing at the top or bottom", () => {
    expect(moveStep(STEPS, 0, -1)).toBeNull();
    expect(moveStep(STEPS, 2, 1)).toBeNull();
  });

  it("keeps the step's ID with it, so its heading and link go too", () => {
    const lines = directionsFromText(textFromSteps(STEPS), [], () => crypto.randomUUID());
    const moved = moveStep(STEPS, 2, -1)!;
    const after = directionsFromText(textFromSteps(moved.texts), lines);
    expect(after.map((line) => line.id)).toEqual([lines[0]!.id, lines[2]!.id, lines[1]!.id]);
  });
});

describe("pasting", () => {
  it("makes one step per line, blank lines dropped and numbers cleaned off", () => {
    expect(pastedLines("1. Heat the oil.\n\n2. Add the onion.\r\n• Simmer.\n")).toEqual([
      "Heat the oil.",
      "Add the onion.",
      "Simmer.",
    ]);
  });

  it("several lines at the cursor split the step around them", () => {
    const edit = pasteInto(
      ["Start. End."],
      { start: { step: 0, offset: 7 }, end: { step: 0, offset: 7 } },
      "One.\n\nTwo.\nThree.",
    );
    expect(edit).toEqual({
      texts: ["Start. One.", "Two.", "Three.End."],
      cursor: { step: 2, offset: "Three.".length },
    });
  });

  it("leaves one line within a step to the browser", () => {
    const at = { step: 0, offset: 2 };
    expect(pasteInto(STEPS, { start: at, end: at }, "more")).toBeNull();
  });

  it("puts one line with its line ending into the step, the cursor after it", () => {
    const at = { step: 1, offset: 1 };
    expect(pasteInto(STEPS, { start: at, end: at }, "X\n")).toEqual({
      texts: ["Heat the oil.", "AXdd the onion.", "Simmer 10 minutes."],
      cursor: { step: 1, offset: 2 },
    });
    expect(pasteInto(STEPS, { start: at, end: at }, "\nmore\n\n")?.texts[1]).toBe(
      "Amoredd the onion.",
    );
  });

  it("one line over a selection across steps joins what's left around it", () => {
    const range = { start: { step: 0, offset: 5 }, end: { step: 2, offset: 7 } };
    expect(pasteInto(STEPS, range, "warm")).toEqual({
      texts: ["Heat warm10 minutes."],
      cursor: { step: 0, offset: "Heat warm".length },
    });
  });
});

describe("a selection across steps", () => {
  const range = { start: { step: 0, offset: 5 }, end: { step: 2, offset: 7 } };

  it("copies as one line per step", () => {
    expect(selectedText(STEPS, range)).toBe("the oil.\nAdd the onion.\nSimmer ");
    expect(
      selectedText(STEPS, { start: { step: 1, offset: 4 }, end: { step: 1, offset: 7 } }),
    ).toBe("the");
  });

  it("typing over it joins what's left into one step", () => {
    expect(replaceRange(STEPS, range, "x")).toEqual({
      texts: ["Heat x10 minutes."],
      cursor: { step: 0, offset: 6 },
    });
  });

  it("deleting it joins what's left into one step", () => {
    expect(replaceRange(STEPS, range, "")).toEqual({
      texts: ["Heat 10 minutes."],
      cursor: { step: 0, offset: 5 },
    });
  });

  it("Enter over it leaves two steps", () => {
    expect(replaceRange(STEPS, range, "\n")).toEqual({
      texts: ["Heat ", "10 minutes."],
      cursor: { step: 1, offset: 0 },
    });
  });

  it("keeps places inside the steps", () => {
    expect(
      replaceRange(["abc"], { start: { step: 0, offset: 9 }, end: { step: 4, offset: 9 } }, "!"),
    ).toEqual({ texts: ["abc!"], cursor: { step: 0, offset: 4 } });
  });
});

describe("words with line breaks typed into a step (dropped or filled in)", () => {
  it("make one step per line, blank lines dropped, the cursor at the end", () => {
    expect(typedInto([""], 0, "Soak.\n\nSimmer.\nServe.")).toEqual({
      texts: ["Soak.", "Simmer.", "Serve."],
      cursor: { step: 2, offset: 6 },
    });
  });

  it("keep the cursor where the box had it, blank lines allowed for", () => {
    // "B" + dropped "X\n\n" + "ravo two.", the cursor after the drop.
    expect(typedInto(["Alpha.", "Bravo two."], 1, "BX\n\nravo two.", 4)).toEqual({
      texts: ["Alpha.", "BX", "ravo two."],
      cursor: { step: 2, offset: 0 },
    });
    expect(typedInto(["Bravo."], 0, "BX\nY\nravo.", 4)).toEqual({
      texts: ["BX", "Y", "ravo."],
      cursor: { step: 1, offset: 1 },
    });
    // On a blank line that goes: the end of the line before it.
    expect(typedInto(["ab"], 0, "a\n\nb", 2)).toEqual({
      texts: ["a", "b"],
      cursor: { step: 0, offset: 1 },
    });
  });

  it("are plain typing without one", () => {
    expect(typedInto(STEPS, 1, "Add the onions.")).toEqual({
      texts: ["Heat the oil.", "Add the onions.", "Simmer 10 minutes."],
      cursor: { step: 1, offset: 15 },
    });
  });
});

describe("after Undo or Redo", () => {
  it("the cursor goes to the first step that changed, where it changed", () => {
    expect(firstChange(["B", "C", "A"], ["B", "A", "C"])).toEqual({ step: 1, offset: 0 });
    expect(firstChange(["Alpha one. X", "B"], ["Alpha one.", "B"])).toEqual({
      step: 0,
      offset: 10,
    });
    expect(firstChange(["Mix.", "Bake."], ["Mix.Bake."])).toEqual({ step: 0, offset: 4 });
  });
});

describe("an empty step left behind", () => {
  it("goes", () => {
    expect(dropBlankStep(["Stir.", "", "Bake."], 1)).toEqual(["Stir.", "Bake."]);
  });

  it("stays when it has words, or is the only step", () => {
    expect(dropBlankStep(["Stir.", "Bake."], 1)).toBeNull();
    expect(dropBlankStep([""], 0)).toBeNull();
  });
});

describe("keys that follow the steps", () => {
  let n = 0;
  const key = () => `k${++n}`;

  it("stay in place while the number of steps is the same (typing, a move)", () => {
    expect(followKeys(["a", "b"], ["1", "2"], ["ax", "b"], key)).toEqual(["1", "2"]);
  });

  it("stay with the unchanged steps when one goes", () => {
    expect(followKeys(["a", "", "c", "d"], ["1", "2", "3", "4"], ["a", "c", "d"], key)).toEqual([
      "1",
      "3",
      "4",
    ]);
  });

  it("give a split's new step a new key, the first half keeping its own", () => {
    n = 0;
    expect(followKeys(["a", "bc", "d"], ["1", "2", "3"], ["a", "b", "c", "d"], key)).toEqual([
      "1",
      "2",
      "k1",
      "3",
    ]);
  });
});

describe("what a screen reader hears", () => {
  it("counts the steps, not the headings", () => {
    const texts = ["Pat dry.", "Cook the salmon", "Heat the oil.", ""];
    const lines = directionsFromText(texts.join("\n")).map((line, i) => ({
      ...line,
      heading: i === 1,
    }));
    expect(stepLabels(texts, lines)).toEqual({
      group: "Directions, 2 steps",
      steps: ["Step 1 of 2", "Heading, Cook the salmon", "Step 2 of 2", "New step"],
    });
  });

  it("calls a box with nothing in it Directions", () => {
    expect(stepLabels([""], [])).toEqual({ group: "Directions, 0 steps", steps: ["Directions"] });
    expect(stepLabels(["Stir."], [{ heading: false }]).group).toBe("Directions, 1 step");
  });
});
