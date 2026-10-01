import { describe, expect, it } from "vitest";
import { healthStatus, isHealthStatus } from "./health";

describe("health status", () => {
  it("reports ok", () => {
    expect(healthStatus()).toEqual({ status: "ok", service: "fennl" });
  });

  it("recognises a valid response and rejects anything else", () => {
    expect(isHealthStatus(healthStatus())).toBe(true);
    expect(isHealthStatus({ status: "error", service: "fennl" })).toBe(false);
    expect(isHealthStatus(null)).toBe(false);
    expect(isHealthStatus("ok")).toBe(false);
  });
});
