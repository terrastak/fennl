import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "./index";

describe("worker API", () => {
  it("answers the health check, including the database", async () => {
    const res = await app.request("/api/health", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "fennl", database: "ok" });
  });

  it("reports degraded when the database doesn't answer", async () => {
    const brokenDb = {
      prepare() {
        throw new Error("database is down");
      },
    } as unknown as D1Database;
    const res = await app.request("/api/health", {}, { ...env, DB: brokenDb });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: "degraded",
      service: "fennl",
      database: "unavailable",
    });
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await app.request("/api/does-not-exist", {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
