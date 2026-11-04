import { describe, expect, it } from "vitest";
// Better Auth's own check (its endpoints validate addresses with zod's z.email()).
import * as z from "zod";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("keeps an address trimmed and in lower case", () => {
    expect(normalizeEmail("  Sarah.Lee+Recipes@Gmail.com ")).toBe("sarah.lee+recipes@gmail.com");
    expect(normalizeEmail("o'brien@mail.example.co.uk")).toBe("o'brien@mail.example.co.uk");
  });

  it("refuses what isn't an address", () => {
    for (const input of [null, 42, "", "not an address", "sarah@", "@gmail.com", "sarah@gmail"]) {
      expect(normalizeEmail(input)).toBeNull();
    }
    expect(normalizeEmail(`${"a".repeat(250)}@x.com`)).toBeNull();
  });

  // An address Better Auth refuses can't be signed in with or sent a link (phase U14).
  it("refuses every address Better Auth refuses", () => {
    for (const input of ["sarah@gmail.c", "a@b..com", "josé@x.com", "a!b@x.com", ".a@x.com"]) {
      expect(z.email().safeParse(input).success).toBe(false);
      expect(normalizeEmail(input)).toBeNull();
    }
  });

  it("agrees with Better Auth's check", () => {
    const samples = [
      "sarah@gmail.com",
      "sarah.lee@mail.example.co.uk",
      "a+b@x.io",
      "o'brien@x.com",
      "a-b_c@sub-domain.example.org",
      "sarah@gmail.c",
      "a@b..com",
      "a..b@x.com",
      "a.@x.com",
      "a@-x.com",
      "a@x.c0m",
      "josé@x.com",
      "a b@x.com",
    ];
    for (const sample of samples) {
      expect(normalizeEmail(sample) !== null, sample).toBe(z.email().safeParse(sample).success);
    }
  });
});
