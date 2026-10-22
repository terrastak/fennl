import { describe, expect, it } from "vitest";
import {
  arrangedByFennl,
  arrangedByHand,
  arrangedOrder,
  photoLabels,
  photosKey,
  type PhotoLabel,
} from "./photoOrder";
import type { RecipePhoto } from "./recipe";

const photo = (id: string, takenAt: number | null = null, more: Partial<RecipePhoto> = {}) =>
  ({
    id,
    recipeId: "r",
    imageHash: `${id}`.padEnd(64, "0"),
    role: "photo",
    width: 100,
    height: 100,
    sortOrder: 0,
    addedByUserId: "u",
    takenAt,
    updatedAt: "",
    deletedAt: null,
    serverSeq: 0,
    ...more,
  }) satisfies RecipePhoto;

const finished = (helps = false): PhotoLabel => ({ kind: "finished", step: null, helps });
const step = (n: number | null, helps: boolean): PhotoLabel => ({ kind: "step", step: n, helps });
const ingredients: PhotoLabel = { kind: "ingredients", step: null, helps: false };
const other: PhotoLabel = { kind: "other", step: null, helps: false };

describe("Fennl's order for a recipe's photos", () => {
  it("follows the owner's order: cover, what adds, helpful steps, then the making of the dish", () => {
    const gallery = ["angle", "whisk", "ingredients", "shaping", "cover", "cut", "dog", "oven"].map(
      (id, i) => photo(id, 1000 + i),
    );
    const order = arrangedOrder(gallery, {
      photos: [
        finished(), // another angle: with the rest, after the routine steps
        step(1, false), // whisking flour: routine
        ingredients,
        step(2, true), // shaping the dough: helps
        finished(),
        finished(true), // the inside, cut open: adds something
        other,
        step(3, true),
      ],
      cover: 4,
    });
    expect(order.map((p) => p.id)).toEqual([
      "cover",
      "cut",
      "shaping",
      "oven",
      "ingredients",
      "whisk",
      "angle",
      "dog",
    ]);
  });

  it("puts photos of the same place in step order, then by when they were taken", () => {
    const gallery = [photo("b", 2000), photo("a", 1000), photo("late", 3000), photo("cover")];
    const order = arrangedOrder(gallery, {
      photos: [step(4, true), step(4, true), step(1, true), finished()],
      cover: 3,
    });
    expect(order.map((p) => p.id)).toEqual(["cover", "late", "a", "b"]);
  });

  it("without the AI, goes by when they were taken, keeping the rest in their place", () => {
    const gallery = [photo("x"), photo("late", 3000), photo("early", 1000), photo("y")];
    expect(arrangedOrder(gallery, null).map((p) => p.id)).toEqual(["early", "late", "x", "y"]);
  });

  it("leaves photos the AI wasn't shown to the end", () => {
    const gallery = [photo("unseen"), photo("dish")];
    const order = arrangedOrder(gallery, { photos: [null, finished()], cover: 1 });
    expect(order.map((p) => p.id)).toEqual(["dish", "unseen"]);
  });

  it("knows a gallery arranged by hand, and one Fennl arranged", () => {
    const fennl = [
      photo("a", null, { arrangedBy: "fennl" }),
      photo("b", null, { arrangedBy: "fennl" }),
    ];
    expect(arrangedByFennl(fennl)).toBe(true);
    expect(arrangedByHand(fennl)).toBe(false);
    const moved = [fennl[0]!, { ...fennl[1]!, arrangedBy: "person" as const }];
    expect(arrangedByFennl(moved)).toBe(false);
    expect(arrangedByHand(moved)).toBe(true);
    expect(arrangedByFennl([fennl[0]!])).toBe(false);
  });

  it("keys a set of photos whatever their order", () => {
    expect(photosKey(["b", "a"])).toBe(photosKey(["a", "b"]));
  });
});

describe("the AI's answer", () => {
  const answer = {
    photos: [
      { photo: 2, kind: "finished", step: null, helps: false },
      { photo: 1, kind: "step", step: 2, helps: true },
    ],
    cover: 2,
  };

  it("is read into one label per photo, in the order shown", () => {
    expect(photoLabels(answer, 2, 3)).toEqual({
      photos: [step(2, true), finished()],
      cover: 1,
    });
  });

  it("drops a step number the method doesn't have", () => {
    const bad = { ...answer, photos: [answer.photos[0], { ...answer.photos[1], step: 9 }] };
    expect(photoLabels(bad, 2, 3)?.photos[0]).toEqual(step(null, true));
  });

  it("is turned away when it doesn't fit", () => {
    expect(photoLabels(null, 2, 3)).toBeNull();
    expect(photoLabels({ ...answer, cover: 3 }, 2, 3)).toBeNull();
    expect(photoLabels({ ...answer, photos: [answer.photos[0]] }, 2, 3)).toBeNull();
    expect(
      photoLabels({ ...answer, photos: [answer.photos[0], answer.photos[0]] }, 2, 3),
    ).toBeNull();
    expect(
      photoLabels(
        { ...answer, photos: [answer.photos[0], { ...answer.photos[1], kind: "dog" }] },
        2,
        3,
      ),
    ).toBeNull();
  });
});
