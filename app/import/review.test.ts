import { describe, expect, it } from "vitest";
import type { RecipeDraft } from "../../shared/importDraft";
import type { ImportJobDetail } from "../../shared/importJobs";
import { emptyRecipeContent, type RecipeContent } from "../../shared/recipe";
import { ingredientsFromText, directionsFromText } from "../../shared/recipeLines";
import {
  createChange,
  fieldUpdates,
  fieldsToCheck,
  lineMarks,
  mergeReadAgain,
  moveLineTo,
  pathNames,
  snapshotDocument,
  tidiedBoxes,
  updateChange,
} from "./review";

function content(patch: Partial<RecipeContent> = {}): RecipeContent {
  return {
    ...emptyRecipeContent(),
    title: "Ginger Cookies",
    ingredients: ingredientsFromText(
      "For the dough:\n3/4 cup butter\n2-1/4 cups flour\nA cookie scoop",
    ),
    directions: directionsFromText("Heat oven to 350 degrees F.\nBake 1 1/2 hours."),
    ...patch,
  };
}

function draft(c: RecipeContent): RecipeDraft {
  return {
    version: 1,
    source: "website",
    externalId: "https://cookies.example.com/ginger",
    externalHash: null,
    inputs: [
      { kind: "page", name: null, url: "https://cookies.example.com/ginger", imageHash: null },
    ],
    fields: {
      title: { value: c.title, confidence: "high", from: [] },
      ingredients: { value: c.ingredients, confidence: "high", from: [] },
      directions: { value: c.directions, confidence: "high", from: [] },
      times: { value: c.times, confidence: "medium", from: [] },
      notes: { value: "", confidence: "low", from: [] },
    },
    lineConfidence: { ingredients: ["medium", "high", "high", "high"], directions: null },
    categories: null,
    photos: [],
    warnings: [],
    producer: { importer: "web", model: null },
  };
}

describe("what to check", () => {
  it("lists the fields the importer wasn't sure of", () => {
    expect(fieldsToCheck(draft(content()))).toEqual([
      { field: "times", note: "Worth a look" },
      { field: "notes", note: "Check this" },
    ]);
  });

  it("marks the lines it wasn't sure of, by line", () => {
    const c = content();
    const marks = lineMarks(draft(c), c);
    expect([...marks.entries()]).toEqual([[c.ingredients[0]!.id, "Worth a look"]]);
  });
});

describe("quick fixes", () => {
  it("tidies fractions and temperatures in both lists", () => {
    expect(tidiedBoxes(content())).toEqual({
      ingredients: "For the dough:\n¾ cup butter\n2¼ cups flour\nA cookie scoop",
      directions: "Heat oven to 350°F.\nBake 1½ hours.",
    });
  });

  it("moves a line to the end of the other list", () => {
    expect(moveLineTo(content(), "ingredients", 3)).toEqual({
      ingredients: "For the dough:\n3/4 cup butter\n2-1/4 cups flour",
      directions: "Heat oven to 350 degrees F.\nBake 1 1/2 hours.\nA cookie scoop",
    });
    expect(moveLineTo(content(), "directions", 0)?.ingredients).toMatch(/Heat oven to 350/);
    expect(moveLineTo(content(), "ingredients", 9)).toBeNull();
  });
});

describe("updating a recipe the household has", () => {
  it("changes only what the import has and differs, never wiping a field", () => {
    const existing = content({ notes: "Grandma doubles the ginger.", title: "Ginger cookies" });
    const imported = content({
      ingredients: ingredientsFromText("For the dough:\n3/4 cup butter\n2-1/4 cups flour\n1 egg"),
    });
    expect(fieldUpdates(existing, imported)).toEqual([
      { field: "title", name: "Title", before: "Ginger cookies", after: "Ginger Cookies" },
      {
        field: "ingredients",
        name: "Ingredients",
        before: "3 ingredients",
        after: "3 ingredients (1 new or changed)",
      },
    ]);
    // The same text with other line IDs is no change.
    expect(fieldUpdates(content(), content())).toEqual([]);
  });

  it("keeps the IDs of lines the recipe already had", () => {
    const existing = content();
    const imported = content({
      ingredients: ingredientsFromText("For the dough:\n3/4 cup butter\n2-1/4 cups flour\n1 egg"),
    });
    const change = updateChange("r1", existing, imported, 5)!;
    expect(Object.keys(change.fields)).toEqual(["ingredients"]);
    expect(change.fields.ingredients?.[1]?.id).toBe(existing.ingredients[1]?.id);
    expect(change.fields.ingredients?.[3]?.text).toBe("1 egg");
    expect(change.create).toBeUndefined();
    expect(updateChange("r1", existing, content(), 5)).toBeNull();
  });
});

it("saves a new recipe with where it came from", () => {
  const c = content();
  const job = {
    id: "job-1",
    draft: draft(c),
    page: { url: "https://cookies.example.com/ginger?ref=x", title: null },
  } as ImportJobDetail;
  const change = createChange("r1", job, c, Date.UTC(2026, 9, 12));
  expect(change.create).toEqual({
    createdAt: "2026-10-12T00:00:00.000Z",
    import: {
      source: "website",
      importJobId: "job-1",
      externalId: "https://cookies.example.com/ginger",
      externalHash: null,
      importedAt: "2026-10-12T00:00:00.000Z",
    },
  });
  expect(change.fields.title).toBe("Ginger Cookies");
  expect(Object.keys(change.fields)).toHaveLength(11);
});

it("reads category paths", () => {
  expect(pathNames("Diet › Vegan")).toEqual(["Diet", "Vegan"]);
  expect(pathNames("Desserts")).toEqual(["Desserts"]);
});

it("shows the page's copy in a document that can't fetch anything", () => {
  const doc = snapshotDocument("<ul><li>1 cup flour</li></ul>", "body{color:red}");
  expect(doc).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
  expect(doc).toContain("<li>1 cup flour</li>");
});

describe("Read again (phase E7)", () => {
  const before = draft(content());
  const after: RecipeDraft = {
    ...draft(
      content({
        title: "Ginger Snaps",
        ingredients: ingredientsFromText("3/4 cup butter\n2 1/4 cups flour\n1 egg"),
      }),
    ),
    lineConfidence: { ingredients: ["high", "high", "low"], directions: null },
    warnings: ["The last line is faint"],
    producer: { importer: "ai", model: "model-b" },
  };

  it("takes the new reading where the person changed nothing", () => {
    const merged = mergeReadAgain(before, content(), after, []);
    expect(merged.fields.title?.value).toBe("Ginger Snaps");
    expect(merged.fields.ingredients?.value.map((l) => l.text)).toEqual([
      "3/4 cup butter",
      "2 1/4 cups flour",
      "1 egg",
    ]);
    expect(merged.lineConfidence.ingredients).toEqual(["high", "high", "low"]);
    expect(merged.warnings).toEqual(["The last line is faint"]);
    expect(merged.producer.model).toBe("model-b");
  });

  it("keeps what the person already changed, and their categories", () => {
    const edited = content({
      title: "Mum's Ginger Cookies",
      ingredients: ingredientsFromText("For the dough:\n1 cup butter\n2-1/4 cups flour"),
    });
    const merged = mergeReadAgain(before, edited, after, [["Desserts", "Cookies"]]);
    expect(merged.fields.title).toEqual({
      value: "Mum's Ginger Cookies",
      confidence: "high",
      from: [],
    });
    expect(merged.fields.ingredients?.value.map((l) => l.text)).toEqual([
      "For the dough:",
      "1 cup butter",
      "2-1/4 cups flour",
    ]);
    // The person's own lines aren't marked.
    expect(merged.lineConfidence.ingredients).toBeNull();
    // Untouched fields still take the new reading.
    expect(merged.fields.directions?.value.map((l) => l.text)).toEqual(
      after.fields.directions?.value.map((l) => l.text),
    );
    expect(merged.categories?.value).toEqual(["Desserts › Cookies"]);
  });
});
