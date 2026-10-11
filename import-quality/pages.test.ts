import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWebRecipes } from "../shared/webRecipe";
import { loadSamples } from "./scorecard";

// The saved web pages of the quality test set (phase E3). The test set is public, so each page
// is a trimmed copy (trimPage.ts): the recipe data and recipe card, without the site's
// articles, photos, comments or scripts.

const root = join(import.meta.dirname, "..");

describe("saved web pages", async () => {
  const pages = (await loadSamples()).filter((s) => s.kind === "web");

  it.each(pages.map((s) => [s.id, s] as const))(
    "%s is a trimmed copy with a recipe",
    async (_, sample) => {
      expect(sample.url).toMatch(/^https?:\/\//);
      const html = await readFile(join(root, sample.inputs[0] as string), "utf8");
      expect(html).toContain("A trimmed copy of a recipe page for Fennl's import tests");
      expect(html.length).toBeLessThan(100_000);
      expect(html).not.toMatch(/<script(?![^>]*ld\+json)/i);
      expect(html).not.toMatch(/<img(?![^>]*itemprop)/i);
      expect(html).not.toMatch(/"(?:articleBody|reviewBody)"/);
      expect(readWebRecipes(html, sample.url ?? null).length).toBeGreaterThan(0);
    },
  );
});
