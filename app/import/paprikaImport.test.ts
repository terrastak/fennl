import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Usage } from "../../shared/limits";
import { bytesSource } from "../../shared/paprikaFile";
import type { ImportedRecipe } from "../sync/dbProtocol";
import { planPaprika, previewPaprika, type PaprikaPreview } from "./paprikaImport";

const SAMPLE = join(
  import.meta.dirname,
  "../../import-quality/test_paprika/owner-library-sample.paprikarecipes",
);

async function sample(existing: ImportedRecipe[] = []): Promise<PaprikaPreview> {
  const source = bytesSource(new Uint8Array(await readFile(SAMPLE)));
  return previewPaprika(source, "My Recipes.paprikarecipes", existing, null, () => undefined);
}

const imported = (uid: string, hash: string | null, more: Partial<ImportedRecipe> = {}) =>
  ({
    id: crypto.randomUUID(),
    ownerUserId: "me",
    title: "Earlier",
    import: {
      source: "paprika",
      importJobId: null,
      externalId: uid,
      externalHash: hash,
      importedAt: "2026-10-01T00:00:00.000Z",
      photos: [],
    },
    inTrash: false,
    galleryPhotos: 0,
    ...more,
  }) satisfies ImportedRecipe;

const free: Usage = {
  recipes: 95,
  textBytes: 0,
  maxRecipes: 100,
  maxTextBytes: 3 * 1024 * 1024,
  maxRecipeBytes: 256 * 1024,
};

describe("previewing a Paprika file", () => {
  it("finds every recipe, new when nothing was imported before", async () => {
    const preview = await sample();
    expect(preview.items).toHaveLength(8);
    expect(preview.problems).toEqual([]);
    expect(preview.items.every((item) => item.status === "new")).toBe(true);
    expect(preview.items.every((item) => item.photos.length === 1)).toBe(true);
  });

  it("matches recipes imported before by Paprika's id", async () => {
    const first = await sample();
    const [a, b, c] = first.items;
    const preview = await sample([
      imported(a!.uid, a!.hash, {
        import: { ...imported(a!.uid, a!.hash).import, photos: [a!.photos[0]!.hash] },
      }),
      imported(b!.uid, "an older hash"),
      imported(c!.uid, c!.hash, { inTrash: true }),
    ]);
    const status = (uid: string) => preview.items.find((item) => item.uid === uid);
    expect(status(a!.uid)).toMatchObject({ status: "unchanged", missingPhotos: [] });
    expect(status(b!.uid)).toMatchObject({ status: "changed" });
    expect(status(b!.uid)?.missingPhotos).toHaveLength(1);
    expect(status(c!.uid)?.status).toBe("in_trash");
  });
});

describe("planning the import", () => {
  it("adds new recipes while the plan has room, and lists the rest", async () => {
    const plan = planPaprika(await sample(), free, {
      enabled: false,
      maxPerRecipe: 0,
      maxFileBytes: null,
    });
    expect(plan.add).toHaveLength(5);
    expect(plan.needRoom).toHaveLength(3);
    expect(plan.photos).toBe(0);
  });

  it("counts photos to bring in when the plan has photos", async () => {
    const preview = await sample();
    const plan = planPaprika(preview, null, {
      enabled: true,
      maxPerRecipe: 10,
      maxFileBytes: null,
    });
    expect(plan.add).toHaveLength(8);
    expect(plan.needRoom).toEqual([]);
    expect(plan.photos).toBe(8);
    expect(plan.photoBytes).toBe(
      preview.items.reduce((sum, item) => sum + item.photos[0]!.bytes, 0),
    );
  });

  it("keeps changed, unchanged and Trash apart", async () => {
    const first = await sample();
    const [a, b, c] = first.items;
    const plan = planPaprika(
      await sample([
        imported(a!.uid, a!.hash),
        imported(b!.uid, "an older hash"),
        imported(c!.uid, c!.hash, { inTrash: true }),
      ]),
      null,
      null,
    );
    expect(plan).toMatchObject({ unchanged: 1, inTrash: 1 });
    expect(plan.changed.map((item) => item.uid)).toEqual([b!.uid]);
    expect(plan.add).toHaveLength(5);
  });
});
