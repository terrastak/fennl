import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  PaprikaEntryError,
  PaprikaFileError,
  bytesSource,
  paprikaEntries,
  readPaprikaEntry,
} from "./paprikaFile";

const root = join(import.meta.dirname, "..");
const recipe = (name: string) =>
  gzipSync(strToU8(JSON.stringify({ uid: `${name}-1`, name, ingredients: "1 egg" })));
const stored = (files: Record<string, Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 0 }]])));

async function problemOf(bytes: Uint8Array) {
  try {
    await paprikaEntries(bytesSource(bytes));
    return null;
  } catch (error) {
    return error instanceof PaprikaFileError ? error.problem : String(error);
  }
}

async function entryProblem(files: Record<string, Uint8Array>) {
  const source = bytesSource(stored(files));
  const [entry] = (await paprikaEntries(source)).recipes;
  try {
    await readPaprikaEntry(source, entry!);
    return null;
  } catch (error) {
    return error instanceof PaprikaEntryError ? error.problem : String(error);
  }
}

describe("Paprika files", () => {
  it("reads the owner's library sample, one recipe at a time", async () => {
    const bytes = await readFile(
      join(root, "import-quality/test_paprika/owner-library-sample.paprikarecipes"),
    );
    const source = bytesSource(new Uint8Array(bytes));
    const { recipes, others } = await paprikaEntries(source);
    expect(recipes).toHaveLength(8);
    expect(others).toBe(0);
    const first = (await readPaprikaEntry(source, recipes[0]!)) as Record<string, unknown>;
    expect(typeof first.uid).toBe("string");
  });

  it("turns away a file that isn't a zip, whatever it's called", async () => {
    expect(await problemOf(strToU8("This is a text file renamed .paprikarecipes"))).toBe("not_zip");
    expect(await problemOf(new Uint8Array(0))).toBe("not_zip");
  });

  it("turns away a zip with no Paprika recipes in it (a zip of photos)", async () => {
    const photos = stored({
      "IMG_0001.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
      "IMG_0002.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]),
    });
    expect(await problemOf(photos)).toBe("not_paprika");
    expect(await problemOf(zipSync({}))).toBe("not_paprika");
  });

  it("counts other entries and ignores what zip programs add", async () => {
    const { recipes, others } = await paprikaEntries(
      bytesSource(
        stored({
          "Eggs.paprikarecipe": recipe("Eggs"),
          "readme.txt": strToU8("hello"),
          "__MACOSX/._Eggs.paprikarecipe": new Uint8Array(4),
        }),
      ),
    );
    expect(recipes.map((r) => r.name)).toEqual(["Eggs.paprikarecipe"]);
    expect(others).toBe(1);
  });

  it("turns away a file claiming more entries than one may hold, before reading them", async () => {
    const bytes = stored({ "Eggs.paprikarecipe": recipe("Eggs") });
    const end = bytes.length - 22;
    bytes[end + 10] = 0x50; // 50,000 entries
    bytes[end + 11] = 0xc3;
    expect(await problemOf(bytes)).toBe("too_many");
  });

  it("lists a recipe with bad JSON as a problem", async () => {
    expect(await entryProblem({ "Bad.paprikarecipe": gzipSync(strToU8("{not json")) })).toBe(
      "not_json",
    );
  });

  it("lists a recipe that isn't gzip, or is cut short, as damaged", async () => {
    expect(await entryProblem({ "Plain.paprikarecipe": strToU8('{"uid":"1"}') })).toBe("damaged");
    const cut = recipe("Eggs").subarray(0, 20);
    expect(await entryProblem({ "Cut.paprikarecipe": cut })).toBe("damaged");
  });

  it("stops unpacking a zip bomb as soon as it grows past the limit", async () => {
    // 20 MB of spaces packs into about 20 KB: far more than 50 times its size.
    const bomb = gzipSync(new Uint8Array(20 * 1024 * 1024).fill(0x20), { level: 9 });
    expect(bomb.length).toBeLessThan(100_000);
    expect(await entryProblem({ "Bomb.paprikarecipe": bomb })).toBe("too_large");
  });

  it("reads a recipe zipped with compression as well as stored", async () => {
    const source = bytesSource(zipSync({ "Eggs.paprikarecipe": recipe("Eggs") }, { level: 6 }));
    const [entry] = (await paprikaEntries(source)).recipes;
    expect(await readPaprikaEntry(source, entry!)).toMatchObject({ name: "Eggs" });
  });
});
