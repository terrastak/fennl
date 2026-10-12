/**
 * "Tidy fractions and temperatures" on the import review screen (phase E4): the fixes people
 * otherwise make by hand after an import. Only what is plainly a fraction or an oven
 * temperature changes; the review screen shows the result, and it can be undone.
 */

/** Fractions with a character of their own. */
const FRACTIONS: Record<string, string> = {
  "1/2": "½",
  "1/3": "⅓",
  "2/3": "⅔",
  "1/4": "¼",
  "3/4": "¾",
  "1/5": "⅕",
  "2/5": "⅖",
  "3/5": "⅗",
  "4/5": "⅘",
  "1/6": "⅙",
  "5/6": "⅚",
  "1/8": "⅛",
  "3/8": "⅜",
  "5/8": "⅝",
  "7/8": "⅞",
};
const GLYPHS = Object.values(FRACTIONS).join("");

/**
 * "1 1/2", "1-1/2" and "1 and 1/2" become "1½", "1/2" and "1⁄2" become "½", and "1 ½" becomes
 * "1½". Never inside dates or longer numbers ("1/2/2026", "11/24", "1/2.5").
 */
export function tidyFractions(text: string): string {
  return (
    text
      // A whole number and a fraction: "1 1/2", "1-1/2", "1 ½".
      .replace(
        new RegExp(
          String.raw`(?<![\d/⁄.,])(\d+)(?:\s+and\s+|\s+|-)(?:(\d)\s*[/⁄]\s*(\d)(?![\d/⁄]|\.\d)|([${GLYPHS}]))`,
          "g",
        ),
        (whole: string, n: string, num?: string, den?: string, glyph?: string) => {
          const fraction = glyph ?? FRACTIONS[`${num}/${den}`];
          return fraction ? `${n}${fraction}` : whole;
        },
      )
      // A fraction on its own: "1/2", "1⁄2".
      .replace(
        /(?<![\d/⁄.,])(\d)\s*[/⁄]\s*(\d)(?![\d/⁄]|\.\d)/g,
        (whole, num: string, den: string) => {
          return FRACTIONS[`${num}/${den}`] ?? whole;
        },
      )
  );
}

/**
 * Oven temperatures written out become "350°F" and "180°C": "350 degrees F", "350 deg. F",
 * "350° F", "350 ºF", "350 degrees Fahrenheit", and "350F" or "350 F" (capital letter, 90 or
 * more, so "2 C" stays two cups).
 */
export function tidyTemperatures(text: string): string {
  return text
    .replace(
      /\b(\d{2,3})\s*(?:[°º˚]\s*|deg(?:rees?|s|\.)?\s+)(f(?:ahrenheit)?|c(?:elsius|entigrade)?)\b/gi,
      (_, n: string, unit: string) => `${n}°${unit.charAt(0).toUpperCase()}`,
    )
    .replace(/\b(\d{2,3})\s?([FC])\b(?![.']?\w)/g, (whole, n: string, unit: string) =>
      Number(n) >= 90 ? `${n}°${unit}` : whole,
    );
}

/** Both: what the review screen's button does to each line. */
export function tidyText(text: string): string {
  return tidyTemperatures(tidyFractions(text));
}
