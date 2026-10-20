import { describe, expect, it } from "vitest";
import { MAX_SAVED_SEARCHES } from "../../shared/savedSearch";
import { problemText, readList } from "./savedSearches";

const entry = (over: Record<string, unknown> = {}) => ({
  id: "a",
  name: "Quick",
  query: "time=30",
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  ...over,
});

describe("reading the list", () => {
  it("keeps well-formed entries", () => {
    expect(readList([entry()])).toEqual([entry()]);
  });

  it("drops entries missing a name, a query or an id", () => {
    expect(
      readList([entry(), entry({ name: 5 }), entry({ query: null }), entry({ id: undefined })]),
    ).toEqual([entry()]);
  });

  it("gives nothing for something that isn't a list", () => {
    expect(readList(null)).toBeNull();
    expect(readList({ searches: [] })).toBeNull();
    expect(readList("x")).toBeNull();
  });
});

describe("saying what went wrong", () => {
  it("has plain words for each problem", () => {
    for (const error of [
      "offline",
      "name_taken",
      "too_many",
      "invalid_name",
      "invalid_query",
      "not_found",
      "rate_limited",
    ]) {
      expect(problemText(error)).not.toBe(problemText("something else"));
    }
    expect(problemText("too_many")).toContain(String(MAX_SAVED_SEARCHES));
    expect(problemText("offline")).toContain("connection");
  });
});
