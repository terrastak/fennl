import { describe, expect, it } from "vitest";
import { healthStatus, isHealthStatus } from "./health";

describe("health status", () => {
  it("reports ok when the database answers", () => {
    expect(healthStatus("ok")).toEqual({ status: "ok", service: "fennl", database: "ok" });
  });

  it("reports degraded when the database doesn't answer", () => {
    expect(healthStatus("unavailable")).toEqual({
      status: "degraded",
      service: "fennl",
      database: "unavailable",
    });
  });

  it("recognises a valid response and rejects anything else", () => {
    expect(isHealthStatus(healthStatus("ok"))).toBe(true);
    expect(isHealthStatus(healthStatus("unavailable"))).toBe(true);
    expect(isHealthStatus({ status: "ok", service: "fennl" })).toBe(false);
    expect(isHealthStatus({ status: "error", service: "fennl", database: "ok" })).toBe(false);
    expect(isHealthStatus(null)).toBe(false);
    expect(isHealthStatus("ok")).toBe(false);
  });
});
