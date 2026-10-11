import { describe, expect, it } from "vitest";
import { cleanText, cleanTitle, readDuration, readNutrition, readYield } from "./webText";

// Phase E3: cleaning up what recipe pages publish as structured data.

describe("cleanText", () => {
  it("decodes entities, twice over when a page encodes them twice", () => {
    expect(cleanText("Grandma&#8217;s 1/2 c.&nbsp;packed sugar")).toBe(
      "Grandma’s 1/2 c. packed sugar",
    );
    expect(cleanText("Mac &amp;amp; cheese")).toBe("Mac & cheese");
  });

  it("takes out tags, keeping a line break where a paragraph or <br> was", () => {
    expect(cleanText("<p>Preheat the oven.</p>\n<p>Grease a pan.</p>")).toBe(
      "Preheat the oven.\nGrease a pan.",
    );
    expect(cleanText("Mix<br/>Bake")).toBe("Mix\nBake");
    expect(cleanText("<p>Mix <strong>well</strong></p>", true)).toBe("Mix well");
  });

  it("treats a line break inside HTML as a space", () => {
    expect(cleanText("<p>bake for about 1\nhour, until golden.</p>")).toBe(
      "bake for about 1 hour, until golden.",
    );
  });

  it("reads fractions written with <sup> and <sub>", () => {
    expect(cleanText("<p>about 1<sup>1</sup>⁄<sub>4</sub> hours</p>")).toBe("about 1 1/4 hours");
  });

  it("fixes text read in the wrong encoding, and odd spaces", () => {
    expect(cleanText("Heat to 350Â°F. Itâ€™s ready.")).toBe("Heat to 350°F. It’s ready.");
    expect(cleanText("To make the​ Malted Dough")).toBe("To make the Malted Dough");
    expect(cleanText("1/4  cup    mayonnaise")).toBe("1/4 cup mayonnaise");
  });

  it("keeps numbers and ignores what isn't text", () => {
    expect(cleanText(12)).toBe("12");
    expect(cleanText(null)).toBe("");
    expect(cleanText({ name: "x" })).toBe("");
  });

  it("leaves a lone less-than sign alone", () => {
    expect(cleanText("< 30 Mins")).toBe("< 30 Mins");
  });
});

describe("cleanTitle", () => {
  it("drops the words pages put after a recipe's name", () => {
    expect(cleanTitle("Chewy Sweet Coconut Bars Recipe", null)).toBe("Chewy Sweet Coconut Bars");
    expect(cleanTitle("Salted, Malted Ice Cream Recipe by Tasty", null)).toBe(
      "Salted, Malted Ice Cream",
    );
    expect(cleanTitle("Granola | Once Upon a Chef", "Once Upon a Chef")).toBe("Granola");
    expect(cleanTitle("SURE.JELL  Dutch Apple Pie Jam", null)).toBe(
      "SURE.JELL Dutch Apple Pie Jam",
    );
  });

  it("keeps a name that is just the word", () => {
    expect(cleanTitle("Recipe", null)).toBe("Recipe");
  });
});

describe("readDuration", () => {
  it.each([
    ["PT15M", 15],
    ["PT1H15M", 75],
    ["PT0H20M", 20],
    ["PT90M", 90],
    ["P1DT2H", 1560],
    ["PT1H30M0S", 90],
  ])("reads %s", (iso, minutes) => {
    expect(readDuration(iso)).toEqual({ minutes, text: null });
  });

  it("reads words, keeping what isn't a time", () => {
    expect(readDuration("1 hour 10 minutes")).toEqual({ minutes: 70, text: null });
    expect(readDuration("1¼ hours")).toEqual({ minutes: 75, text: null });
    expect(readDuration("2 hours, plus 3 hours 30 minutes for chilling")).toEqual({
      minutes: 120,
      text: "plus 3 hours 30 minutes for chilling",
    });
    expect(readDuration("overnight")).toEqual({ minutes: null, text: "overnight" });
  });

  it("gives nothing for no time, or none", () => {
    expect(readDuration("PT0S")).toBeNull();
    expect(readDuration("")).toBeNull();
    expect(readDuration(undefined)).toBeNull();
  });
});

describe("readYield", () => {
  it.each([
    ["6", { count: 6, yield: null }],
    [6, { count: 6, yield: null }],
    ["6 servings", { count: 6, yield: null }],
    ["12 to 16 servings", { count: 12, yield: "12 to 16 servings" }],
    ["Serves 6 to 8", { count: 6, yield: "Serves 6 to 8" }],
    ["4-5 serving(s)", { count: 4, yield: "4-5 serving(s)" }],
    ["2-1/2 dozen", { count: null, yield: "2-1/2 dozen" }],
    ["1 c.", { count: null, yield: "1 c." }],
    ["1.5", { count: null, yield: "1.5" }],
    [[12, "12 bars"], { count: 12, yield: "12 bars" }],
    [["1.5", "1.5 litres / quarts"], { count: null, yield: "1.5 litres / quarts" }],
    [null, { count: null, yield: null }],
  ])("reads %j", (value, expected) => {
    expect(readYield(value)).toEqual(expected);
  });
});

describe("readNutrition", () => {
  it("reads each nutrient in Fennl's unit", () => {
    expect(
      readNutrition({
        "@type": "NutritionInformation",
        calories: "521.8571428571429",
        fatContent: "14.9 grams",
        sodiumContent: "0.2 g",
        cholesterolContent: "92 milligrams",
        proteinContent: "4g protein",
        servingSize: "1 slice",
      }),
    ).toEqual({
      perServing: { calories: 521.9, fat: 14.9, sodium: 200, cholesterol: 92, protein: 4 },
      text: "Per serving: 1 slice",
      source: "website",
    });
  });

  it("gives nothing when there's nothing to read", () => {
    expect(readNutrition({ calories: "" })).toBeNull();
    expect(readNutrition(undefined)).toBeNull();
  });
});
