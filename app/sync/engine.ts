import type { Entitlements } from "../../shared/entitlements";
import { RECIPE_SCHEMA_VERSION } from "../../shared/recipe";
import {
  SYNC_RULES,
  checkChange,
  formatCursors,
  type ChangeResult,
  type PullResponse,
  type PushRequest,
  type SyncChange,
} from "../../shared/sync";
import { LocalDb, LocalDbError } from "./dbClient";
import type { OutboxEntry, RecipeSummary } from "./dbProtocol";
import { batches } from "./records";
import type { SyncPhase, SyncStatus } from "./status";
import { canEdit, STARTING } from "./status";

// Keeping this browser's copy in step with the account (phase C4). Runs only in the tab that
// owns the local database (app/sync/tabs.ts); other tabs ask it.
//
// Every change is written here first and queued (the "outbox"), then sent. Free and Premium
// differ only by the plan's offline_enabled flag (CLAUDE.md: one client, one data layer):
// - Without it, a change is sent straight away, and editing pauses while that can't happen.
// - With it, changes wait while offline and are sent when the connection is back, retrying
//   with growing pauses.

/** How often to fetch while the app is open and visible, besides on opening and on focus. */
const FETCH_EVERY_MS = 60_000;
/** A short pause after a change, so a burst of changes goes in one push. */
const SEND_AFTER_MS = 300;
/** Pauses between retries after a failure: 2 s, doubling, at most a minute. */
const RETRY_MS = { first: 2_000, max: 60_000 };
/** A keepalive request (sent while the page closes) can carry at most 64 KB. */
const KEEPALIVE_BYTES = 60 * 1024;

/** A problem talking to the server. */
class SyncProblem extends Error {
  constructor(readonly phase: SyncPhase) {
    super(phase);
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new SyncProblem("offline");
  }
  if (res.ok) return res.json();
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.status === 401) throw new SyncProblem("signed_out");
  if (body?.error === "device_revoked" || body?.error === "device_not_registered") {
    throw new SyncProblem("signed_out");
  }
  if (body?.error === "upgrade_required") throw new SyncProblem("upgrade");
  throw new SyncProblem("waiting");
}

export interface EngineEvents {
  status(status: SyncStatus): void;
  /** The local copy changed: lists should read it again. */
  changed(): void;
}

export class SyncEngine {
  private db = new LocalDb();
  private status: SyncStatus = STARTING;
  private outbox: OutboxEntry[] = [];
  private running = false;
  private again = false;
  private stopped = false;
  private retryMs = RETRY_MS.first;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanup: (() => void)[] = [];

  constructor(
    private readonly userId: string,
    private readonly deviceId: string,
    private readonly events: EngineEvents,
  ) {}

  private setStatus(next: Partial<SyncStatus>) {
    this.status = { ...this.status, ...next, pending: this.outbox.length };
    this.events.status(this.status);
  }

  /** Opens the local copy (waiting for a tab that just closed to let go of it), then syncs. */
  async start(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.db.call({ op: "open", userId: this.userId });
        break;
      } catch (error) {
        if (!(error instanceof LocalDbError) || !error.busy || attempt >= 30 || this.stopped) {
          console.error("Couldn't open the local copy", error);
          this.setStatus({ phase: "unavailable" });
          return;
        }
        // The tab that had it is closing; its worker lets go in a moment.
        this.db.close();
        this.db = new LocalDb();
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    this.outbox = (await this.db.call({ op: "snapshot" })).outbox;
    this.setStatus({});
    this.events.changed();
    this.listen();
    await this.loadPlan();
    void this.sync();
  }

  stop() {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    if (this.sendTimer) clearTimeout(this.sendTimer);
    for (const undo of this.cleanup) undo();
    this.db.close();
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  private listen() {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void this.loadPlan();
        void this.sync();
      }
    };
    const onOnline = () => void this.sync();
    // The browser knows the connection dropped: say so now, not at the next failed save.
    const onOffline = () => {
      if (this.status.phase !== "signed_out" && this.status.phase !== "upgrade") {
        this.setStatus({ phase: "offline" });
      }
    };
    // Changes not sent yet go out as the page closes; the server ignores repeats, so they're
    // simply sent again (and confirmed) next time.
    const onHide = () => this.flushOnClose();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pagehide", onHide);
    const every = setInterval(() => {
      if (document.visibilityState === "visible") void this.sync();
    }, FETCH_EVERY_MS);
    this.cleanup.push(
      () => document.removeEventListener("visibilitychange", onVisible),
      () => window.removeEventListener("online", onOnline),
      () => window.removeEventListener("offline", onOffline),
      () => window.removeEventListener("pagehide", onHide),
      () => clearInterval(every),
    );
  }

  /** The plan decides whether changes may wait (offline_enabled). Never trusted by the server. */
  private async loadPlan() {
    try {
      const plan = (await request("/api/entitlements")) as Entitlements;
      if (plan.offline_enabled !== this.status.offlineEnabled) {
        this.setStatus({ offlineEnabled: plan.offline_enabled });
      }
      // Ask the browser to keep the copy when changes may wait in it (C2: not every browser
      // agrees; home-screen apps usually do).
      if (plan.offline_enabled) void navigator.storage?.persist?.().catch(() => false);
    } catch {
      // Offline: keep what we knew.
    }
  }

  /** Saves a change here and queues it to be sent. */
  async save(change: SyncChange): Promise<void> {
    const checked = checkChange(change);
    if (!checked.ok) throw new Error(`Invalid change: ${JSON.stringify(checked.issues)}`);
    if (!canEdit(this.status)) throw new Error("Editing is paused.");
    const { seq } = await this.db.call({
      op: "enqueue",
      change: checked.value,
      now: new Date().toISOString(),
    });
    this.outbox.push({ seq, change: checked.value });
    this.setStatus({});
    this.events.changed();
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.sendTimer = setTimeout(() => void this.sync(), SEND_AFTER_MS);
  }

  listRecipes(): Promise<RecipeSummary[]> {
    return this.db.call({ op: "listRecipes" });
  }

  /** Sends what's waiting, then fetches what's new. One at a time; a request meanwhile runs after. */
  async sync(): Promise<void> {
    if (this.stopped || this.status.phase === "unavailable") return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.cycle();
      } while (this.again && !this.stopped);
    } finally {
      this.running = false;
    }
  }

  private async cycle() {
    if (this.status.phase === "signed_out" || this.status.phase === "upgrade") return;
    this.setStatus({ phase: "syncing" });
    try {
      await this.push();
      await this.pull();
      await this.db.call({ op: "recheck", now: new Date().toISOString() });
      this.retryMs = RETRY_MS.first;
      this.setStatus({ phase: "saved", lastSyncedAt: new Date().toISOString() });
    } catch (error) {
      const phase = error instanceof SyncProblem ? error.phase : "waiting";
      if (!(error instanceof SyncProblem)) console.error("Sync failed", error);
      this.setStatus({ phase });
      if (phase === "offline" || phase === "waiting") {
        this.timers.push(setTimeout(() => void this.sync(), this.retryMs));
        this.retryMs = Math.min(this.retryMs * 2, RETRY_MS.max);
      }
    }
    this.events.changed();
  }

  /** The waiting changes as a push. Without offline editing they're always fresh (see below). */
  private pushBody(entries: OutboxEntry[]): PushRequest {
    const sentAt = Date.now();
    return {
      deviceId: this.deviceId,
      schemaVersion: RECIPE_SCHEMA_VERSION,
      sentAt,
      // Without offline editing a change waits only while a save is being retried (editing is
      // paused meanwhile, and there's one device), so it's sent as made now; the server would
      // otherwise take a delayed save for an offline queue.
      changes: entries.map((e) =>
        this.status.offlineEnabled ? e.change : { ...e.change, changedAt: sentAt },
      ),
    };
  }

  private async push() {
    if (this.outbox.length === 0) return;
    const margin = 64 * 1024;
    for (const batch of batches(
      [...this.outbox],
      SYNC_RULES.changesPerPush,
      SYNC_RULES.pushBytes - margin,
    )) {
      const { results } = (await request("/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this.pushBody(batch)),
      })) as { results: ChangeResult[] };
      // Kept, already there, or refused for good: no longer waiting. A failed save stays.
      const done = batch.filter((_, i) => {
        const result = results[i];
        if (result?.status === "rejected" && result.reason !== "failed") {
          console.warn("The server refused a change", result, batch[i]?.change);
        }
        return !(result?.status === "rejected" && result.reason === "failed");
      });
      await this.db.call({ op: "ack", seqs: done.map((e) => e.seq) });
      const sent = new Set(done.map((e) => e.seq));
      this.outbox = this.outbox.filter((e) => !sent.has(e.seq));
      this.setStatus({});
      if (done.length < batch.length) throw new SyncProblem("waiting");
    }
  }

  private async pull() {
    let { cursors } = await this.db.call({ op: "snapshot" });
    for (let page = 0; page < 1000; page++) {
      const query = new URLSearchParams({
        deviceId: this.deviceId,
        schemaVersion: String(RECIPE_SCHEMA_VERSION),
        since: formatCursors(cursors),
      });
      const pulled = (await request(`/api/sync/pull?${query.toString()}`)) as PullResponse;
      await this.db.call({ op: "applyPull", page: pulled, now: new Date().toISOString() });
      cursors = pulled.cursors;
      if (!pulled.more) return;
      this.events.changed();
    }
  }

  private flushOnClose() {
    if (this.outbox.length === 0) return;
    const fits: OutboxEntry[] = [];
    let bytes = 512;
    for (const entry of this.outbox) {
      const size = JSON.stringify(entry.change).length + 1;
      if (bytes + size > KEEPALIVE_BYTES) break;
      fits.push(entry);
      bytes += size;
    }
    if (fits.length === 0) return;
    void fetch("/api/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(this.pushBody(fits)),
      keepalive: true,
    }).catch(() => undefined);
  }
}
