import { describe, expect, it } from "vitest";
import { draftStatus, type DraftStatusInput } from "./draftStatus";

const base: DraftStatusInput = {
  save: "kept",
  parts: 3,
  isNew: false,
  editable: true,
  offlineEnabled: true,
  noConnection: false,
  inAccount: true,
  refused: false,
};
const text = (change: Partial<DraftStatusInput>) => draftStatus({ ...base, ...change }).text;

describe("draftStatus", () => {
  it("says each state in the approved words", () => {
    expect(text({ save: "unchanged", parts: 0, inAccount: null })).toBe("No changes yet");
    expect(text({ save: "saving" })).toBe("Saving draft…");
    expect(text({})).toBe("Draft saved · 3 changes");
    expect(text({ parts: 1 })).toBe("Draft saved · 1 change");
    expect(text({ isNew: true })).toBe("Draft saved");
    // Kept here, not yet in the account.
    expect(text({ inAccount: false })).toBe("Saving draft…");
    expect(text({ inAccount: false, noConnection: true })).toBe(
      "Draft kept on this device · waiting to connect",
    );
    expect(
      draftStatus({ ...base, offlineEnabled: false, editable: false, noConnection: true }),
    ).toEqual({ text: "Can’t save the draft: no connection", dot: "stopped" });
    expect(text({ save: "failed" })).toBe("Couldn’t save the draft just now; trying again");
    expect(text({ refused: true, inAccount: false })).toBe(
      "Couldn’t save the draft just now; trying again",
    );
  });
});
