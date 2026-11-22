import type { DraftSaveState } from "../editorSession";

// The words beside the editor's heading while a draft is kept (U27 part 3, owner's choices
// 2026-11-21 and 22; the mockup's bar-states.png), and the dot before them.

/** The dot: grey with no changes, a ring while saving or waiting, navy once in the account. */
export type DraftDot = "none" | "saving" | "draft" | "offline" | "problem" | "stopped";

export interface DraftStatusInput {
  save: DraftSaveState;
  /** How many parts differ from the saved recipe. */
  parts: number;
  isNew: boolean;
  /** Editing is allowed now (canEdit). */
  editable: boolean;
  /** Changes may wait on this device (Premium). */
  offlineEnabled: boolean;
  /** No connection (or saving keeps failing, which pauses a free account the same way). */
  noConnection: boolean;
  /** The kept version is in the account; null when nothing is kept. */
  inAccount: boolean | null;
  /** The account turned this version away; it's kept on this device. */
  refused: boolean;
}

export interface DraftStatus {
  text: string;
  dot: DraftDot;
}

export function draftStatus(input: DraftStatusInput): DraftStatus {
  const { save, parts } = input;
  if (!input.editable && !input.offlineEnabled && input.noConnection) {
    return { text: "Can’t save the draft: no connection", dot: "stopped" };
  }
  if (parts === 0 && save !== "saving" && save !== "failed") {
    return { text: "No changes yet", dot: "none" };
  }
  if (save === "failed" || (save === "kept" && input.refused)) {
    return { text: "Couldn’t save the draft just now; trying again", dot: "problem" };
  }
  if (save === "kept" && input.inAccount) {
    const count = input.isNew ? "" : ` · ${parts} ${parts === 1 ? "change" : "changes"}`;
    return { text: `Draft saved${count}`, dot: "draft" };
  }
  if (input.noConnection && input.offlineEnabled && save !== "saving") {
    return { text: "Draft kept on this device · waiting to connect", dot: "offline" };
  }
  return { text: "Saving draft…", dot: "saving" };
}
