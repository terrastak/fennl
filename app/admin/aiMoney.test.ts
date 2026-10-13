import { describe, expect, it } from "vitest";
import { centsAsDollars, dollars, parseDollars } from "./aiMoney";

describe("AI cost amounts in the admin console", () => {
  it("shows millionths of a dollar and cents as dollars", () => {
    expect(dollars(1600)).toBe("$0.00");
    expect(dollars(12_345_678)).toBe("$12.35");
    expect(centsAsDollars(5000)).toBe("50.00");
  });

  it("reads dollars as cents", () => {
    expect(parseDollars("50")).toBe(5000);
    expect(parseDollars("$12.5")).toBe(1250);
    expect(parseDollars(" 0.01 ")).toBe(1);
    expect(parseDollars("12.345")).toBeUndefined();
    expect(parseDollars("-1")).toBeUndefined();
    expect(parseDollars("")).toBeUndefined();
  });
});
