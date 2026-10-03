/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLOR_SCHEMES, isColorMode, isColorScheme, SCHEME_PREVIEW } from "../../shared/appearance";

// Read from disk: Vitest turns CSS imports (even ?raw) into empty strings.
const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

/** Returns the declarations inside the first `selector { ... }` block, or throws. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No block for selector: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

function colors(selector: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const match of block(selector).matchAll(/(--color-[a-z-]+):\s*([^;]+);/g)) {
    vars.set(match[1] as string, (match[2] as string).trim().toLowerCase());
  }
  return vars;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi as number) + 0.05) / ((lo as number) + 0.05);
}

const SCHEME_BLOCKS = {
  "harbor light": ':root[data-scheme="harbor"]',
  "heirloom light": ':root[data-scheme="heirloom"]',
  "harbor dark": ':root[data-mode="dark"]',
  "heirloom dark": ':root[data-scheme="heirloom"][data-mode="dark"]',
  "harbor dark (device)": ':root:not([data-mode="light"])',
  "heirloom dark (device)": ':root[data-scheme="heirloom"]:not([data-mode="light"])',
} as const;

/** [foreground, background] pairs that must stay readable (WCAG AA, 4.5:1). */
const READABLE_PAIRS: [string, string][] = [
  ["--color-text", "--color-bg"],
  ["--color-text", "--color-surface"],
  ["--color-text", "--color-surface-sunken"],
  ["--color-text-muted", "--color-bg"],
  ["--color-text-muted", "--color-surface"],
  ["--color-text-subtle", "--color-bg"],
  ["--color-text-subtle", "--color-surface"],
  ["--color-accent", "--color-bg"],
  ["--color-accent", "--color-surface"],
  ["--color-on-accent", "--color-accent"],
  ["--color-accent-soft-text", "--color-accent-soft"],
  ["--color-warm-text", "--color-bg"],
  ["--color-warm-text", "--color-warm-soft"],
  ["--color-hand", "--color-bg"],
  ["--color-hand", "--color-surface"],
  ["--color-danger", "--color-surface"],
];

describe("design tokens", () => {
  const reference = colors(SCHEME_BLOCKS["harbor light"]);

  it.each(Object.entries(SCHEME_BLOCKS))("%s defines every color token", (_name, selector) => {
    expect([...colors(selector).keys()].sort()).toEqual([...reference.keys()].sort());
  });

  it("device-following dark mode matches the explicit dark colors", () => {
    expect(colors(SCHEME_BLOCKS["harbor dark (device)"])).toEqual(
      colors(SCHEME_BLOCKS["harbor dark"]),
    );
    expect(colors(SCHEME_BLOCKS["heirloom dark (device)"])).toEqual(
      colors(SCHEME_BLOCKS["heirloom dark"]),
    );
  });

  it.each(Object.entries(SCHEME_BLOCKS))("%s keeps text readable", (_name, selector) => {
    const vars = colors(selector);
    for (const [fg, bg] of READABLE_PAIRS) {
      const ratio = contrast(vars.get(fg) as string, vars.get(bg) as string);
      expect(ratio, `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("has a block for every color scheme in shared/appearance.ts", () => {
    for (const scheme of COLOR_SCHEMES) {
      expect(() => block(`:root[data-scheme="${scheme}"]`)).not.toThrow();
    }
  });

  it("settings previews use the same colors as the tokens", () => {
    for (const scheme of COLOR_SCHEMES) {
      const vars = colors(`:root[data-scheme="${scheme}"]`);
      const p = SCHEME_PREVIEW[scheme];
      expect({
        bg: vars.get("--color-bg"),
        surface: vars.get("--color-surface"),
        accent: vars.get("--color-accent"),
        onAccent: vars.get("--color-on-accent"),
        hand: vars.get("--color-hand"),
        text: vars.get("--color-text"),
      }).toEqual(p);
    }
  });

  it("recognises valid appearance values", () => {
    expect(isColorScheme("heirloom")).toBe(true);
    expect(isColorScheme("paprika")).toBe(false);
    expect(isColorMode("system")).toBe(true);
    expect(isColorMode(undefined)).toBe(false);
  });
});
