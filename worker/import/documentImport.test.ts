import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { RecipeDraft } from "../../shared/importDraft";
import type { ImportJobDetail, ImportTextResponse } from "../../shared/importJobs";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { importJob } from "../db/schema";
import { setUpDatabase, signUpConfirmed, type Visitor } from "../test/visitor";

// Phase E18: a recipe saved as a document. The app takes its text out on the device and sends it
// like pasted text, with the file's name and, on Premium, how many pictures it offers; each draft
// offers them as photos to keep, handed over by the app afterwards.

const db = () => database(env.DB);

beforeAll(async () => {
  await setUpDatabase();
});

let counter = 0;

async function person(premium: boolean): Promise<Visitor> {
  const v = await signUpConfirmed(`document-${++counter}@example.com`);
  if (premium) {
    const code = await createCode(
      db(),
      {
        code: `DOC-${counter}`,
        label: "Document import tests",
        tier: "individual",
        access: { forever: true },
        allowsSignUp: true,
        maxUses: null,
        redeemBy: null,
      },
      null,
    );
    expect((await v.request("/api/codes/redeem", { body: { code: code.code } })).status).toBe(200);
  }
  return v;
}

const LAID_OUT = `Beer Cheese Sauce

Ingredients
4 tablespoons unsalted butter
4 tablespoons all-purpose flour
2 cups light beer
6 ounces grated sharp Cheddar

Directions
Melt the butter, whisk in the flour, then the beer.
Stir in the cheese until smooth.`;

/** A small PNG's bytes (its signature is all the server checks). */
const png = () =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(7)]);

const draftOf = async (id: string) =>
  JSON.parse(
    (await db().select().from(importJob).where(eq(importJob.id, id)).get())!.draft!,
  ) as RecipeDraft;

describe("a recipe from a document", () => {
  it("is read like pasted text, named by its file, offering its pictures as photos (Premium)", async () => {
    const v = await person(true);
    const res = await v.request("/api/import/text", {
      body: { text: LAID_OUT, fileName: "Beercheese sauce.docx", pictures: 2 },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ImportTextResponse;
    const [job] = body.jobs;
    const draft = await draftOf(job!.id);
    expect(draft.source).toBe("text");
    expect(draft.inputs.map((i) => [i.kind, i.name])).toEqual([
      ["text", "Beercheese sauce.docx"],
      ["image", "Beercheese sauce.docx, picture 1"],
      ["image", "Beercheese sauce.docx, picture 2"],
    ]);
    expect(draft.photos).toEqual([
      { input: 1, role: "photo" },
      { input: 2, role: "photo" },
    ]);
    expect(body.pictures).toEqual([{ job: job!.id, inputs: [1, 2] }]);

    // The app hands the first picture over; the review screen can show it.
    const given = await v.request(`/api/import/jobs/${job!.id}/inputs/1`, { bytes: png() });
    expect(given.status).toBe(201);
    const shown = await v.request(`/api/import/jobs/${job!.id}/inputs/1`);
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-type")).toBe("image/png");
    // The review screen names the document.
    const detail = (await (
      await v.request(`/api/import/jobs/${job!.id}`)
    ).json()) as ImportJobDetail;
    expect(detail.pastedFrom).toBe("Beercheese sauce.docx");
    expect(detail.pastedText).toBe(LAID_OUT);
  });

  it("is free when it's clearly laid out, with no pictures offered on Free", async () => {
    const v = await person(false);
    const res = await v.request("/api/import/text", {
      body: { text: LAID_OUT, fileName: "Beer cheese.rtf", pictures: 3 },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ImportTextResponse;
    expect(body.pictures).toBeUndefined();
    const draft = await draftOf(body.jobs[0]!.id);
    expect(draft.inputs.map((i) => i.name)).toEqual(["Beer cheese.rtf"]);
    expect(draft.photos).toEqual([]);
    // One that needs the AI is Premium.
    const messy = await v.request("/api/import/text", {
      body: {
        text: "Mix a cup of butter with two cups of flour, roll into balls and bake 15 minutes at 350.",
        fileName: "Cookies.txt",
        pictures: 0,
      },
    });
    expect(messy.status).toBe(403);
  });

  it("turns away a bad file name or picture count", async () => {
    const v = await person(true);
    const send = (extra: Record<string, unknown>) =>
      v.request("/api/import/text", { body: { text: LAID_OUT, ...extra } });
    expect((await send({ fileName: " " })).status).toBe(400);
    expect((await send({ fileName: "x".repeat(201) })).status).toBe(400);
    expect((await send({ fileName: "a.docx", pictures: 11 })).status).toBe(400);
    expect((await send({ fileName: "a.docx", pictures: 1.5 })).status).toBe(400);
  });
});
