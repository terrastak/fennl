import { describe, expect, it } from "vitest";
import app from "./index";

describe("worker API", () => {
  it("answers the health check", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "fennl" });
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
