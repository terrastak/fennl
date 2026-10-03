import { describe, expect, it } from "vitest";
import { greetingFor } from "./greeting";

const at = (hour: number) => new Date(2026, 9, 3, hour, 30);

describe("greetingFor", () => {
  it("follows the time of day", () => {
    expect(greetingFor(at(2))).toBe("Good evening");
    expect(greetingFor(at(7))).toBe("Good morning");
    expect(greetingFor(at(13))).toBe("Good afternoon");
    expect(greetingFor(at(19))).toBe("Good evening");
  });
});
