import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { RecipeDraft } from "../../shared/importDraft";
import type { AiProvenance, ImportPhotosResponse } from "../../shared/importJobs";
import { PDF_RULES, type PdfFindResponse } from "../../shared/pdfImport";
import { fakeAi } from "../ai/fake";
import { createCode } from "../codes/admin";
import { database } from "../db/client";
import { aiUsage, importJob } from "../db/schema";
import { setUpDatabase, signUpConfirmed, type Visitor } from "../test/visitor";

// Phase E12: a PDF's recipes. The app finds them (one AI read of every page, free), then reads
// each from its pages (uploaded like page photos) with the pages' own text: one draft each, in
// one batch, counting as one AI import each.

const db = () => database(env.DB);

beforeAll(async () => {
  await setUpDatabase();
});

afterEach(() => {
  fakeAi.reset();
});

let counter = 0;

interface Person {
  v: Visitor;
  userId: string;
}

async function person(premium = true): Promise<Person> {
  const v = await signUpConfirmed(`pdf-${++counter}@example.com`);
  if (premium) {
    const code = await createCode(
      db(),
      {
        code: `PDF-${counter}`,
        label: "PDF import tests",
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
  return { v, userId: (await v.session())!.user.id };
}

/** Bytes that start like a WebP and differ each time. */
function webp(size = 256): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([...new TextEncoder().encode("RIFF")], 0);
  bytes.set([...new TextEncoder().encode("WEBP")], 8);
  const seed = ++counter;
  for (let i = 12; i < size; i++) bytes[i] = (seed * 31 + i * 7) % 251;
  return bytes;
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function upload(p: Person): Promise<string> {
  const res = await p.v.request(`/api/images/upload?owner=${p.userId}`, { bytes: webp() });
  expect(res.status).toBe(201);
  return ((await res.json()) as { hash: string }).hash;
}

const find = (p: Person, body: unknown) => p.v.request("/api/import/pdf/find", { body });

async function usage(userId: string) {
  return db().select().from(aiUsage).where(eq(aiUsage.userId, userId)).all();
}

describe("finding the recipes in a PDF", () => {
  it("lists them with their pages, from each page's text or picture, without counting an import", async () => {
    const p = await person();
    const res = await find(p, {
      pageCount: 3,
      pages: [
        { page: 1, text: "Lemon Bars\n1 cup flour\nBake." },
        { page: 2, image: base64(webp()), mediaType: "image/webp" },
        { page: 3, text: "Shortbread\n2 cups flour\nBake." },
      ],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as PdfFindResponse).recipes).toEqual([
      { title: "Lemon Bars", firstPage: 1, lastPage: 2 },
      { title: "Shortbread", firstPage: 3, lastPage: 3 },
    ]);
    // One call, as text and a picture, labelled by page.
    const [asked] = fakeAi.requests;
    expect(asked!.parts.map((part) => [part.kind, part.label])).toEqual([
      ["text", "Page 1, its text"],
      ["image", "Page 2, a picture"],
      ["text", "Page 3, its text"],
    ]);
    // Metered, but not an import.
    const rows = await usage(p.userId);
    expect(rows.map((r) => [r.purpose, r.countsAsImport, r.status])).toEqual([["find", 0, "ok"]]);
  });

  it("keeps the AI's list within the PDF and in order", async () => {
    const p = await person();
    fakeAi.reply = () => ({
      ok: true,
      output: {
        recipes: [
          { title: "  Soup  ", firstPage: 0, lastPage: 40 },
          { title: "", firstPage: 2, lastPage: 2 },
          { title: "Stew", firstPage: 3, lastPage: 1 },
        ],
      },
      tokens: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 },
    });
    const res = await find(p, { pageCount: 30, pages: [{ page: 1, text: "Soup" }] });
    expect(((await res.json()) as PdfFindResponse).recipes).toEqual([
      { title: "Soup", firstPage: 1, lastPage: PDF_RULES.recipePages },
      { title: "Stew", firstPage: 3, lastPage: 3 },
    ]);
  });

  it("takes at most 100 pages, in order, and is part of Premium", async () => {
    const p = await person();
    const many = Array.from({ length: PDF_RULES.pages + 1 }, (_, i) => ({
      page: i + 1,
      text: "x",
    }));
    expect((await find(p, { pageCount: many.length, pages: many })).status).toBe(413);
    expect(
      (
        await find(p, {
          pageCount: 2,
          pages: [
            { page: 2, text: "a" },
            { page: 1, text: "b" },
          ],
        })
      ).status,
    ).toBe(400);
    expect(
      (await find(p, { pageCount: 1, pages: [{ page: 1, image: "bm90IGFuIGltYWdl" }] })).status,
    ).toBe(400);
    const free = await person(false);
    expect((await find(free, { pageCount: 1, pages: [{ page: 1, text: "a" }] })).status).toBe(403);
  });
});

describe("reading one recipe of a PDF", () => {
  it("reads only that recipe, from its pages and their text, as one import in the PDF's batch", async () => {
    const p = await person();
    const first = await upload(p);
    const second = await upload(p);
    const batchId = crypto.randomUUID();
    const read = (title: string, pages: string[], numbers: number[]) =>
      p.v.request("/api/import/pdf", {
        body: {
          title,
          pages,
          pageNumbers: numbers,
          texts: numbers.map((n) => (n === 2 ? null : `Text of page ${n}`)),
          fileName: "Family recipes.pdf",
          batchId,
        },
      });
    const res = await read("Lemon Bars", [first, second], [1, 2]);
    expect(res.status).toBe(201);
    const { jobs } = (await res.json()) as ImportPhotosResponse;
    expect(jobs).toHaveLength(1);
    const job = (await db().select().from(importJob).where(eq(importJob.id, jobs[0]!.id)).get())!;
    expect(job.source).toBe("pdf");
    expect(job.batchId).toBe(batchId);
    const draft = JSON.parse(job.draft!) as RecipeDraft;
    expect(draft.fields.title?.value).toBe("Lemon Bars");
    expect(draft.inputs.map((i) => [i.name, i.imageHash])).toEqual([
      ["Family recipes.pdf, page 1", first],
      ["Family recipes.pdf, page 2", second],
    ]);
    expect(draft.photos).toEqual([
      { input: 0, role: "import_original" },
      { input: 1, role: "import_original" },
    ]);
    // The pictures, then each page's own text where it has some; asked for that recipe only.
    const asked = fakeAi.requests[0]!;
    expect(asked.parts.map((part) => [part.kind, part.label])).toEqual([
      ["image", "Page 1 of the PDF, as a picture"],
      ["image", "Page 2 of the PDF, as a picture"],
      ["text", "Page 1 of the PDF, its text"],
    ]);
    expect(asked.instruction).toContain('Transcribe only the recipe titled "Lemon Bars"');
    // "Read again" asks for the same recipe.
    const { ai } = JSON.parse(job.provenance) as AiProvenance;
    expect(ai.focus).toBe("Lemon Bars");
    const again = await p.v.request(`/api/import/jobs/${job.id}/read-again`, { body: {} });
    expect(again.status).toBe(200);
    expect(fakeAi.requests.at(-1)!.instruction).toContain('only the recipe titled "Lemon Bars"');

    // A second recipe of the same PDF joins the batch; each counts as an import.
    expect((await read("Shortbread", [second], [2])).status).toBe(201);
    const batch = await db().select().from(importJob).where(eq(importJob.batchId, batchId)).all();
    expect(batch.map((j) => JSON.parse(j.draft!).fields.title.value).sort()).toEqual([
      "Lemon Bars",
      "Shortbread",
    ]);
    const counted = await db()
      .select()
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, p.userId), eq(aiUsage.countsAsImport, 1)))
      .all();
    expect(counted.map((r) => r.purpose).sort()).toEqual(["read", "read", "reread"]);
  });

  it("turns away a request that isn't one recipe's pages", async () => {
    const p = await person();
    const hash = await upload(p);
    const body = {
      title: "Soup",
      pages: [hash],
      pageNumbers: [1],
      texts: [null],
      fileName: "a.pdf",
      batchId: crypto.randomUUID(),
    };
    const send = (change: Record<string, unknown>) =>
      p.v.request("/api/import/pdf", { body: { ...body, ...change } });
    expect((await send({ title: " " })).status).toBe(400);
    expect((await send({ pageNumbers: [1, 2] })).status).toBe(400);
    expect((await send({ texts: [] })).status).toBe(400);
    expect((await send({ batchId: "not-a-batch" })).status).toBe(400);
    expect(
      (
        await send({
          pages: Array(PDF_RULES.recipePages + 1).fill(hash),
          pageNumbers: Array(PDF_RULES.recipePages + 1).fill(1),
          texts: Array(PDF_RULES.recipePages + 1).fill(null),
        })
      ).status,
    ).toBe(400);
    // Someone else's photo isn't a page of theirs.
    const other = await person();
    const theirs = await upload(other);
    expect((await send({ pages: [theirs] })).status).toBe(404);
    expect((await send({})).status).toBe(201);
  });
});
