import { describe, expect, it } from "vitest";
import { draftContent, draftIssues } from "./importDraft";
import { readPaprikaNutrition, readPaprikaRecipe, type PaprikaRecipe } from "./paprika";

const jpeg = (n: number) => btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, n));

const base = {
  uid: "2254C685-1111",
  hash: "ab12",
  name: "Chicken Fajitas",
  ingredients: "4 tablespoons oil\n\nAVOCADO CREMA:\n1 large avocado",
  directions: "1. Marinate the chicken.\n\n2. FOR THE CREMA: Blend.\n\nTACOS\n3. Serve.",
  notes: "Allowed to blacken a little.",
  servings: "Yield: 6 servings",
  prep_time: "20 min",
  cook_time: "1 hr 5 min",
  total_time: "",
  difficulty: "Easy",
  rating: 4,
  source: "Tasteofhome.com",
  source_url: "http://www.tasteofhome.com/recipes/fajitas",
  categories: ["Mexican", "Entrees", "mexican"],
  created: "2015-06-13 13:17:32",
  nutritional_info: "",
  photos: [],
};

function read(extra: Record<string, unknown> = {}): PaprikaRecipe {
  const result = readPaprikaRecipe({ ...base, ...extra }, "Chicken Fajitas.paprikarecipe");
  if ("problem" in result) throw new Error(result.problem);
  return result;
}

describe("a Paprika recipe", () => {
  it("becomes a draft with Paprika's id and hash, so importing again updates it", () => {
    const r = read();
    expect(draftIssues(r.draft)).toEqual([]);
    expect(r.draft).toMatchObject({
      source: "paprika",
      externalId: "2254C685-1111",
      externalHash: "ab12",
      producer: { importer: "paprika", model: null },
    });
    const c = draftContent(r.draft);
    expect(c.title).toBe("Chicken Fajitas");
    expect(c.ingredients.map((l) => [l.text, l.heading])).toEqual([
      ["4 tablespoons oil", false],
      ["AVOCADO CREMA:", true],
      ["1 large avocado", false],
    ]);
    expect(c.directions.map((l) => [l.text, l.heading])).toEqual([
      ["Marinate the chicken.", false],
      ["FOR THE CREMA: Blend.", false],
      ["TACOS", true],
      ["Serve.", false],
    ]);
    expect(c.times).toEqual({
      prep: { minutes: 20, text: null },
      cook: { minutes: 65, text: null },
      total: { minutes: null, text: null },
    });
    expect(c.servings).toEqual({ count: 6, yield: "Yield: 6 servings" });
    expect(c.source).toEqual({
      kind: "website",
      name: "Tasteofhome.com",
      url: "http://www.tasteofhome.com/recipes/fajitas",
      author: null,
      page: null,
    });
    expect(c.difficulty).toBe("easy");
    expect(c.notes).toBe("");
  });

  it("keeps the person's own things apart: stars, notes, categories, when it was added", () => {
    const r = read();
    expect(r.rating).toBe(4);
    expect(r.note).toBe("Allowed to blacken a little.");
    expect(r.categories).toEqual([["Mexican"], ["Entrees"]]);
    expect(r.createdAt).toBe("2015-06-13T13:17:32.000Z");
    expect(read({ rating: 0 }).rating).toBeNull();
  });

  it("reads Paprika's other ways of writing times", () => {
    const times = draftContent(
      read({
        prep_time: "0:45",
        cook_time: "25 minutes to 35 minutes",
        total_time: "prep: 45 min. + chilling",
      }).draft,
    ).times;
    expect(times.prep).toEqual({ minutes: 45, text: null });
    expect(times.cook).toEqual({ minutes: 25, text: "to 35 minutes" });
    expect(times.total).toEqual({ minutes: null, text: "prep: 45 min. + chilling" });
    expect(draftContent(read({ prep_time: "35 to 38 mins" }).draft).times.prep).toEqual({
      minutes: 35,
      text: "to 38 mins",
    });
  });

  it("keeps a difficulty that isn't one of Fennl's as words", () => {
    expect(draftContent(read({ difficulty: "Intermediate" }).draft).difficulty).toBe("medium");
    const odd = draftContent(read({ difficulty: "Weekend project" }).draft);
    expect(odd.difficulty).toBeNull();
    expect(odd.difficultyText).toBe("Weekend project");
  });

  it("calls a source without a web address 'other'", () => {
    expect(draftContent(read({ source: "Mom", source_url: "" }).draft).source).toMatchObject({
      kind: "other",
      name: "Mom",
      url: null,
    });
    expect(read({ source: "", source_url: "" }).draft.fields.source).toBeUndefined();
  });

  it("puts the cover first, using the full-size one when Paprika has it", () => {
    const small = read({ photo: "cover.jpg", photo_hash: "C0", photo_data: jpeg(1) });
    expect(small.photos.map((p) => [p.name, p.hash])).toEqual([["cover.jpg", "C0"]]);
    expect(small.draft.photos).toEqual([{ input: 1, role: "photo" }]);
    expect(small.draft.inputs[1]).toMatchObject({ kind: "image", name: "cover.jpg" });

    const large = read({
      photo: "cover.jpg",
      photo_hash: "C0",
      photo_data: jpeg(1),
      photo_large: "big.jpg",
      photos: [
        { name: "2", filename: "big.jpg", hash: "B2", data: jpeg(2) },
        { name: "1", filename: "first.jpg", hash: "F1", data: jpeg(3) },
      ],
    });
    expect(large.photos.map((p) => p.hash)).toEqual(["B2", "F1"]);
    expect(large.photos[0]?.bytes).toBe(5);
  });

  it("needs an id, a title, and ingredients or directions", () => {
    expect(readPaprikaRecipe({ ...base, uid: "" })).toEqual({ problem: "no_id" });
    expect(readPaprikaRecipe({ ...base, name: " " })).toEqual({ problem: "no_title" });
    expect(readPaprikaRecipe({ ...base, ingredients: "", directions: "" })).toEqual({
      problem: "no_ingredients_or_directions",
    });
    expect(readPaprikaRecipe([1, 2])).toEqual({ problem: "not_json" });
    expect("problem" in readPaprikaRecipe({ ...base, ingredients: "" })).toBe(false);
  });
});

describe("Paprika's nutrition text", () => {
  it("reads labels first, with or without colons and units", () => {
    expect(
      readPaprikaNutrition(
        "Trans Fat: 0 grams\nFat: 15 grams\nCalories: 522\nSaturated Fat: 9 grams\nUnsaturated Fat: 5 grams\nSodium: 27 milligrams",
      )?.perServing,
    ).toEqual({ fat: 15, calories: 522, saturatedFat: 9, sodium: 27 });
    expect(
      readPaprikaNutrition(
        "Calories: 467kcal | Carbohydrates: 71g | Protein: 7g | Vitamin A: 580IU",
      )?.perServing,
    ).toEqual({ calories: 467, carbohydrates: 71, protein: 7 });
    expect(readPaprikaNutrition("Calories (kcal) 250\nFat (g) 22")?.perServing).toEqual({
      calories: 250,
      fat: 22,
    });
  });

  it("reads amounts first (Taste of Home)", () => {
    expect(
      readPaprikaNutrition(
        "1 slice: 446 calories, 26g fat (13g saturated fat), 93mg cholesterol, 313mg sodium, 55g carbohydrate (42g sugars, 1g fiber), 8g protein.",
      )?.perServing,
    ).toEqual({
      calories: 446,
      fat: 26,
      saturatedFat: 13,
      cholesterol: 93,
      sodium: 313,
      carbohydrates: 55,
      sugar: 42,
      fiber: 1,
      protein: 8,
    });
  });

  it("doesn't take a heading line's numbers for the label after them", () => {
    const n = readPaprikaNutrition(
      "640 Calories 27g Fat 96g Carbs 5g Protein\nNutrition Facts\nCalories 640\nTotal Fat 27g 35%",
    );
    expect(n?.perServing).toMatchObject({ calories: 640, fat: 27, carbohydrates: 96, protein: 5 });
  });

  it("always keeps the text, even when nothing in it is read", () => {
    expect(readPaprikaNutrition("High in fibre")).toEqual({
      perServing: {},
      text: "High in fibre",
      source: "paprika",
    });
    expect(readPaprikaNutrition("")).toBeNull();
  });
});
