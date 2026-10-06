import { describe, expect, it } from "vitest";
import { verifiedText } from "./verified";

describe("verifiedText", () => {
  it("says whether an address is verified, and when if known", () => {
    expect(verifiedText(false, null)).toBe("Not verified");
    expect(verifiedText(true, null)).toBe("Verified (date not recorded)");
    expect(verifiedText(true, "2026-10-06T12:00:00.000Z")).toMatch(/^Verified on .*2026/);
  });
});
