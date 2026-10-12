/// <reference types="vite/client" />
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { ImportJobDetail, ImportWebResponse } from "../../shared/importJobs";
import { app } from "../index";
import {
  ORIGIN,
  overrideLimit,
  setUpDatabase,
  signUpConfirmed,
  type Visitor,
} from "../test/visitor";

// Phase E6: the Chrome extension sends the page you're on, as you see it, with its own key.
// Done when it works on the whole web test set: every saved page, sent as the extension sends
// it, becomes a draft for review with the right recipe.

const pages = import.meta.glob<string>("../../test_pages/*.html", {
  query: "?raw",
  import: "default",
  eager: true,
});
const expected = import.meta.glob<{ title: string }>("../../import-quality/expected/*.json", {
  import: "default",
  eager: true,
});

beforeAll(async () => {
  await setUpDatabase();
});

let counter = 0;

async function connected(): Promise<{ v: Visitor; key: string }> {
  const v = await signUpConfirmed(`extension-import-${++counter}@example.com`);
  const res = await v.request("/api/extension/links", { method: "POST" });
  const { key } = (await res.json()) as { key: string };
  return { v, key };
}

/** A request as the extension makes it: its key, no cookies. */
function asExtension(key: string, path: string, init: { method?: string; body?: unknown } = {}) {
  return app.request(
    `${ORIGIN}${path}`,
    {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        authorization: `Bearer ${key}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    },
    env,
  );
}

describe("sending a page from the extension", () => {
  it("makes drafts the person reviews in Fennl", async () => {
    const { v, key } = await connected();
    const html = pages["../../test_pages/tasteofhome-big-soft-ginger-cookies.html"]!;
    const url = "https://www.tasteofhome.com/recipes/big-soft-ginger-cookies/";
    const res = await asExtension(key, "/api/import/web", { body: { html, url } });
    expect(res.status).toBe(201);
    const { jobs } = (await res.json()) as ImportWebResponse;
    expect(jobs.map((j) => j.title)).toEqual(["Big Soft Ginger Cookies"]);

    // The same person sees it in Fennl, signed in as usual.
    const detail = await v.request(`/api/import/jobs/${jobs[0]!.id}`);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as ImportJobDetail).page.url).toBe(url);
  });

  it("follows the plan, like an import from Fennl", async () => {
    const { v, key } = await connected();
    await overrideLimit(v, "structured_imports_per_day", 0);
    const res = await asExtension(key, "/api/import/web", {
      body: { html: pages["../../test_pages/tasteofhome-big-soft-ginger-cookies.html"], url: null },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "import_not_included" });
  });

  it("needs a working key, which works on nothing else", async () => {
    const { key } = await connected();
    const bad = await asExtension(`fnx_${"B".repeat(43)}`, "/api/import/web", {
      body: { html: "<html></html>", url: null },
    });
    expect(bad.status).toBe(401);
    for (const path of ["/api/import/jobs", "/api/import/jobs/x"]) {
      expect((await asExtension(key, path)).status, path).toBe(401);
    }
    expect((await asExtension(key, "/api/import/jobs/x/discard", { method: "POST" })).status).toBe(
      401,
    );
  });

  it("reads every page of the web test set", async () => {
    const files = Object.keys(pages);
    expect(files.length).toBeGreaterThanOrEqual(31);
    let key = "";
    for (const [i, file] of files.entries()) {
      // A new person every 20 pages: one person may send 30 a minute (a guard against abuse).
      if (i % 20 === 0) key = (await connected()).key;
      const id = file.replace(/^.*\/(.*)\.html$/, "$1");
      const answer = expected[`../../import-quality/expected/${id}.json`];
      expect(answer, id).toBeDefined();
      const res = await asExtension(key, "/api/import/web", {
        body: { html: pages[file], url: null },
      });
      expect(res.status, id).toBe(201);
      const { jobs } = (await res.json()) as ImportWebResponse;
      expect(
        jobs.map((j) => j.title),
        id,
      ).toEqual([answer!.title]);
    }
  });
});
