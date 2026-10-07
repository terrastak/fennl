import type { Cursors, PullResponse, SyncChange } from "../../shared/sync";

/** Messages between a tab and its local database worker (phase C4). */

/** A recipe as the list shows it. */
export interface RecipeSummary {
  id: string;
  title: string;
  ownerUserId: string;
  updatedAt: string;
  /** Changed here, and the server hasn't confirmed it yet. */
  waiting: boolean;
}

/** A change waiting to be sent, in the order it was made. */
export interface OutboxEntry {
  seq: number;
  change: SyncChange;
}

export type DbRequest =
  | { op: "open"; userId: string }
  | { op: "snapshot" }
  | { op: "enqueue"; change: SyncChange; now: string }
  | { op: "ack"; seqs: number[] }
  | { op: "applyPull"; page: PullResponse; now: string }
  | { op: "recheck"; now: string }
  | { op: "listRecipes" }
  | { op: "wipe" };

export interface DbResults {
  open: null;
  snapshot: { cursors: Cursors; outbox: OutboxEntry[] };
  enqueue: { seq: number };
  ack: null;
  applyPull: null;
  recheck: null;
  listRecipes: RecipeSummary[];
  wipe: null;
}

export type DbResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; busy: boolean; message: string };
