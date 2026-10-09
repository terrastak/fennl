import type { Usage } from "../../shared/limits";

/** Where syncing stands, shared by every open tab (phase C4). */

export type SyncPhase =
  /** Opening the local copy, first fetch. */
  | "starting"
  /** Everything here is in the account. */
  | "saved"
  /** Sending or fetching right now. */
  | "syncing"
  /** Changes are waiting: the last try failed, and another is coming. */
  | "waiting"
  /** No connection. */
  | "offline"
  /** Signed out (or this browser was): the page needs to reload. */
  | "signed_out"
  /** This version of the app is too old for the server: reload. */
  | "upgrade"
  /** This browser can't keep a local copy (storage blocked or broken). */
  | "unavailable";

export interface SyncStatus {
  phase: SyncPhase;
  /** Changes made here that the server hasn't confirmed. */
  pending: number;
  /** The plan includes offline editing (Premium): changes can wait to be sent. */
  offlineEnabled: boolean;
  /** When the last full sync finished. */
  lastSyncedAt: string | null;
  /** The household's recipe usage and limits, as last heard from the server (phase C11). */
  usage: Usage | null;
  /**
   * Changes to new recipes the server turned away for a plan limit (phase C11). They stay here,
   * not counted in `pending`, and are sent again once there's room.
   */
  held: number;
  /** What the plan allows for photos (phase D2), once known. The server checks it again. */
  photos: PhotoPlan | null;
}

export interface PhotoPlan {
  /** New photos may be added (Premium). */
  enabled: boolean;
  /** Photos on one recipe. Null: no limit. */
  maxPerRecipe: number | null;
  /** The biggest file the server takes. Null: no limit. */
  maxFileBytes: number | null;
}

export const STARTING: SyncStatus = {
  phase: "starting",
  pending: 0,
  offlineEnabled: false,
  lastSyncedAt: null,
  usage: null,
  held: 0,
  photos: null,
};

/**
 * Whether editing is allowed right now. Without offline editing (Free), saves must reach the
 * server as they happen, so editing pauses while there's no connection or saving fails
 * (CLAUDE.md, "Write paths"). With it, changes wait and are sent later.
 */
export function canEdit(status: SyncStatus): boolean {
  if (["starting", "signed_out", "upgrade", "unavailable"].includes(status.phase)) return false;
  if (status.offlineEnabled) return true;
  return status.phase !== "offline" && status.phase !== "waiting";
}

/** The few words shown in the app's frame. */
export function statusText(status: SyncStatus): string {
  const waiting = `${status.pending} ${status.pending === 1 ? "change" : "changes"} waiting`;
  switch (status.phase) {
    case "starting":
      return "Connecting…";
    case "saved":
      return status.pending > 0 ? waiting : "Saved to cloud";
    case "syncing":
      return status.pending > 0 ? `Saving ${status.pending}…` : "Syncing…";
    case "waiting":
      return status.pending > 0 ? waiting : "Trying again soon";
    case "offline":
      return status.pending > 0 ? `Offline · ${waiting}` : "Offline";
    case "signed_out":
      return "Signed out";
    case "upgrade":
      return "Update needed";
    case "unavailable":
      return "No local copy";
  }
}
