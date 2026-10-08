import { describe, expect, it } from "vitest";
import {
  dayText,
  localDay,
  minutesText,
  namesText,
  servingsText,
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
    ).toBe("Salt Fat Acid Heat, by Samin Nosrat, page 42");
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
