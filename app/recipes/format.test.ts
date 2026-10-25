import { describe, expect, it } from "vitest";
import {
  dayText,
  localDay,
  minutesText,
  namesText,
  servingsFacts,
  servingsText,
  sourceCredit,
  sourceLine,
  stars,
  timeText,
  trashText,
} from "./format";

describe("recipe details as they read", () => {
  it("writes times in hours and minutes", () => {
    expect(minutesText(30)).toBe("30 min");
    expect(minutesText(120)).toBe("2 hr");
    expect(minutesText(75)).toBe("1 hr 15 min");
    expect(timeText({ minutes: 20, text: "plus overnight" })).toBe("20 min plus overnight");
    expect(timeText({ minutes: null, text: "A few hours" })).toBe("A few hours");
    expect(timeText({ minutes: null, text: null })).toBeNull();
  });

  it("writes servings and yield", () => {
    expect(servingsText({ count: 6, yield: null })).toBe("Serves 6");
    expect(servingsText({ count: null, yield: "2 loaves" })).toBe("2 loaves");
    expect(servingsText({ count: 8, yield: "about 24 cookies" })).toBe(
      "Serves 8 · about 24 cookies",
    );
    expect(servingsText({ count: 8, yield: "Serves 8 to 10" })).toBe("Serves 8 to 10");
    expect(servingsText({ count: null, yield: null })).toBeNull();
  });

  it("writes days, with the year only when it isn't this one", () => {
    const today = new Date(2026, 9, 7);
    expect(dayText("2026-10-03", today)).toMatch(/Oct\s+3/);
    expect(dayText("2026-10-03", today)).not.toMatch(/2026/);
    expect(dayText("2025-12-24", today)).toMatch(/2025/);
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("writes stars, names and sources", () => {
    expect(stars(4)).toBe("★★★★☆");
    expect(namesText(["June"])).toBe("June");
    expect(namesText(["June", "Sam", "Rose"])).toBe("June, Sam and Rose");
    expect(
      sourceLine({
        kind: "cookbook",
        name: "Salt Fat Acid Heat",
        url: null,
        author: "Samin Nosrat",
        page: "42",
      }),
    ).toBe("Samin Nosrat, Salt Fat Acid Heat, page 42");
    expect(
      sourceLine({ kind: "person", name: "Nana", url: null, author: null, page: null }),
    ).toBeNull();
  });
});

describe("time left in Trash", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  it("counts down from 30 days", () => {
    expect(trashText("2026-10-08T12:00:00Z", now)).toBe("Deleted for good in 30 days");
    expect(trashText("2026-09-08T13:00:00Z", now)).toBe("Deleted for good in 1 day");
    expect(trashText("2026-09-01T00:00:00Z", now)).toBe("Deleted for good within the hour");
  });
});

describe("where a recipe came from (owner's choices 2026-10-25)", () => {
  const site = (name: string | null, author: string | null, url: string | null = null) =>
    sourceLine({ kind: "website", name, url, author, page: null });

  it("credits the person via the site", () => {
    expect(site("Food Network", "Nigella Lawson")).toBe("Nigella Lawson via Food Network");
    expect(site("The Pioneer Woman", "Ree Drummond")).toBe("Ree Drummond via The Pioneer Woman");
    expect(site("tasty.co", "Alvin Zhou and Claire King")).toBe(
      "Alvin Zhou and Claire King via tasty.co",
    );
  });

  it("names a source once when the site and the author are the same", () => {
    expect(site("donnahay.com.au", "Donna Hay")).toBe("Donna Hay");
    expect(site("Nigella.com", "Nigella")).toBe("Nigella");
    expect(site("Cookie and Kate", "Cookie and Kate")).toBe("Cookie and Kate");
    expect(site("SURE-JELL", "SURE-JELL")).toBe("SURE-JELL");
    expect(site("Good Housekeeping", "The Good Housekeeping Test Kitchen")).toBe(
      "Good Housekeeping",
    );
  });

  it("leaves out an editor and a site's tagline", () => {
    expect(site("Betty Crocker", "Edited by Angela Ritchie")).toBe("Betty Crocker");
    expect(site("Bake from Scratch - #thebakefeed", "Bake from Scratch")).toBe("Bake from Scratch");
    // A site named after its author: the site's name says both.
    expect(site("Sally's Baking", "By Sally")).toBe("Sally's Baking");
    expect(site("Cooking is Messy", "Cook's Country")).toBe("Cook's Country via Cooking is Messy");
  });

  it("names the site by its address when that's all there is, and links to the recipe", () => {
    const url = "https://thefoodcharlatan.com/dutch-apple-pie-recipe/";
    expect(sourceCredit({ kind: "website", name: null, url, author: null, page: null })).toEqual({
      text: "thefoodcharlatan.com",
      url,
    });
    expect(site(null, null)).toBeNull();
  });
});

describe("what a recipe serves and makes", () => {
  it("says each once", () => {
    expect(servingsFacts({ count: 14, yield: "Makes 14" })).toEqual([
      { label: "Makes", value: "14" },
    ]);
    expect(servingsFacts({ count: 14, yield: "14 cookies" })).toEqual([
      { label: "Makes", value: "14 cookies" },
    ]);
    expect(servingsFacts({ count: 8, yield: "about 24 cookies" })).toEqual([
      { label: "Serves", value: "8" },
      { label: "Makes", value: "about 24 cookies" },
    ]);
    expect(servingsFacts({ count: 8, yield: "Serves 8 to 10" })).toEqual([
      { label: "Serves", value: "8 to 10" },
    ]);
    expect(servingsFacts({ count: 6, yield: null })).toEqual([{ label: "Serves", value: "6" }]);
    expect(servingsFacts({ count: null, yield: null })).toEqual([]);
  });
});
