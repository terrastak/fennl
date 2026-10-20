import { describe, expect, it } from "vitest";
import {
  cleanSavedName,
  cleanSavedQuery,
  MAX_SAVED_NAME_LENGTH,
  sameSavedName,
} from "./savedSearch";

describe("names", () => {
  it("tidies spaces", () => {
    expect(cleanSavedName("  Quick   weeknight  dinners ")).toBe("Quick weeknight dinners");
  });

  it("refuses nothing, too long, and things that aren't text", () => {
    expect(cleanSavedName("   ")).toBeNull();
    expect(cleanSavedName("")).toBeNull();
    expect(cleanSavedName("x".repeat(MAX_SAVED_NAME_LENGTH + 1))).toBeNull();
    expect(cleanSavedName("x".repeat(MAX_SAVED_NAME_LENGTH))).not.toBeNull();
    expect(cleanSavedName(5)).toBeNull();
    expect(cleanSavedName(null)).toBeNull();
  });

  it("treats names that differ only in case or spacing as the same", () => {
    expect(sameSavedName("Quick  dinners", " quick dinners")).toBe(true);
    expect(sameSavedName("Quick dinners", "Quick lunches")).toBe(false);
  });
});

describe("queries", () => {
  it("keeps what the recipe list writes", () => {
    const query = "q=soup&category=Dinners&also=Vegan&time=30&without=mushroom&without=kale";
    expect(cleanSavedQuery(query)).toBe(query);
  });

  it("allows a leading question mark", () => {
    expect(cleanSavedQuery("?rating=4")).toBe("rating=4");
  });

  it("refuses a key the list doesn't understand", () => {
    expect(cleanSavedQuery("time=30&admin=1")).toBeNull();
    expect(cleanSavedQuery("next=/settings")).toBeNull();
  });

  it("refuses an empty search, since there is nothing to save", () => {
    expect(cleanSavedQuery("")).toBeNull();
    expect(cleanSavedQuery("?")).toBeNull();
  });

  it("refuses long values, too many parts, and things that aren't text", () => {
    expect(cleanSavedQuery(`q=${"a".repeat(201)}`)).toBeNull();
    expect(
      cleanSavedQuery(Array.from({ length: 61 }, (_, i) => `with=w${i}`).join("&")),
    ).toBeNull();
    expect(cleanSavedQuery(`q=${"a".repeat(2001)}`)).toBeNull();
    expect(cleanSavedQuery(undefined)).toBeNull();
    expect(cleanSavedQuery({ q: "soup" })).toBeNull();
  });

  it("writes characters the same way each time", () => {
    expect(cleanSavedQuery("category=Desserts%20%E2%80%BA%20Cakes")).toBe(
      "category=Desserts+%E2%80%BA+Cakes",
    );
  });
});
