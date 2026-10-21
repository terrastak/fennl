import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ingredientsFromText } from "../shared/recipeLines";
import type { RecipeDraft } from "../shared/importDraft";
import { IMPORTERS } from "./importers";
import {
  exactMisses,
  loadSamples,
  reportMarkdown,
  runScorecard,
  testSetIssues,
  type Importer,
} from "./scorecard";

// The scorecard as part of the test run (phase E1): the test set must be well formed, and the
// report is written to import-quality/report.md (not kept in git), which `npm run
// import:quality` prints and CI adds to each run's summary.

describe("import quality scorecard", () => {
  it("has a well-formed test set", async () => {
    expect(await testSetIssues(await loadSamples())).toEqual([]);
  });

  it("writes the quality report, and exact importers are exact", async () => {
    const card = await runScorecard(IMPORTERS);
    const report = reportMarkdown(card);
    await writeFile(join(import.meta.dirname, "report.md"), `${report}\n`);
    expect(report).toContain("# Import quality");
    // What decides how the dish turns out must be right (agreed 2026-10-11): see the report.
    expect(exactMisses(card)).toEqual([]);
  }, 120_000);

  it("scores what an importer finds", async () => {
    // A stand-in importer for cards: it reads every card as the same two-line recipe.
    const draft = (title: string): RecipeDraft => ({
      version: 1,
      source: "photo",
      externalId: null,
      externalHash: null,
      inputs: [{ kind: "image", name: null, url: null, imageHash: null }],
      fields: {
        title: { value: title, confidence: "high", from: [] },
        ingredients: {
          value: ingredientsFromText("1 cup butter\n1 tsp vanilla"),
          confidence: "medium",
          from: [],
        },
      },
      lineConfidence: { ingredients: null, directions: null },
      categories: null,
      photos: [],
      warnings: [],
      producer: { importer: "stand-in", model: null },
    });
    const standIn: Importer = {
      name: "stand-in",
      kinds: ["card"],
      run: (_files, sample) =>
        Promise.resolve(
          sample.id === "sugar-butter-balls-card" ? [draft("Sugar Butter Balls")] : [],
        ),
    };
    const card = await runScorecard([standIn]);
    const results = card.results.filter((r) => r.importer === "stand-in");
    expect(results.map((r) => r.sample.id).sort()).toEqual([
      "choc-pie-card",
      "milky-way-cake-card",
      "mushrooms-eggs-card",
      "peanut-butter-candy-card",
      "sugar-butter-balls-card",
      "walnut-cherry-cake-card",
    ]);
    const balls = results.find((r) => r.sample.id === "sugar-butter-balls-card")!;
    expect(balls.scores[0]?.fields.title).toBe(1);
    expect(balls.scores[0]?.ingredients).toMatchObject({ exact: 2, missing: 4 });
    expect(balls.overall).toBeGreaterThan(0);
    expect(balls.overall).toBeLessThan(0.6);
    const cake = results.find((r) => r.sample.id === "walnut-cherry-cake-card")!;
    expect(cake.overall).toBe(0);

    const report = reportMarkdown(card);
    expect(report).toContain("| stand-in | 6 |");
    expect(report).toContain("a recipe wasn't found");
    expect(report).not.toContain("- card:");
    // The stand-in isn't marked exact, so the rule for published data doesn't apply to it.
    expect(exactMisses(card)).toEqual([]);

    // Marked exact, every miss in what decides how the dish turns out is named.
    const exact = await runScorecard([{ ...standIn, name: "exact stand-in", exact: true }]);
    expect(exactMisses(exact)).toEqual([
      "walnut-cherry-cake-card (exact stand-in): not found",
      expect.stringMatching(/^sugar-butter-balls-card \(exact stand-in\): ingredients \d+%$/),
      "sugar-butter-balls-card (exact stand-in): directions 0%",
      "sugar-butter-balls-card (exact stand-in): servings count",
      "choc-pie-card (exact stand-in): not found",
      "milky-way-cake-card (exact stand-in): not found",
      "mushrooms-eggs-card (exact stand-in): not found",
      "peanut-butter-candy-card (exact stand-in): not found",
    ]);
    expect(reportMarkdown(exact)).toContain("## Must be exact");
  });
});
