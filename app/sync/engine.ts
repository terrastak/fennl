import type { Entitlements } from "../../shared/entitlements";
import { addBlockedBy, type Usage } from "../../shared/limits";
import { RECIPE_SCHEMA_VERSION } from "../../shared/recipe";
import {
  SYNC_RULES,
  checkChange,
  formatCursors,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SyncChange,
} from "../../shared/sync";
import type { CategoryData } from "../categories/tree";
import { LocalDb, LocalDbError } from "./dbClient";
import type { SearchResults } from "./search";
import type { OutboxEntry, RecipeDetail, RecipeSummary, TrashItem } from "./dbProtocol";
import { batches, stampedAsSent } from "./records";
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

/**
 * Whether the plan allows offline editing, as last heard from the server, so an app opened with
 * no connection (phase C4b) behaves as the plan does. The server still decides every push.
 */
const planKey = (userId: string) => `fennl:offline-editing:${userId}`;

function rememberedPlan(userId: string): boolean {
  try {
    return localStorage.getItem(planKey(userId)) === "true";
  } catch {
    return false;
  }
}

function rememberPlan(userId: string, offlineEnabled: boolean) {
  try {
    localStorage.setItem(planKey(userId), String(offlineEnabled));
  } catch {
    // Not kept: an offline start then waits for the connection to allow editing.
  }
}

/** The recipe a change is about, if any. */
function recipeOf(change: SyncChange): string | null {
  if (change.kind === "recipe") return change.id;
  if (change.kind === "category") return null;
  return change.recipeId;
}

/** Times held changes are sent again in one go, at most (they converge well before). */
const RELEASES_PER_SYNC = 3;

/** The household's usage as last heard (phase C11), so a reload knows it before the first sync. */
const usageKey = (userId: string) => `fennl:usage:${userId}`;

function rememberedUsage(userId: string): Usage | null {
  try {
    const text = localStorage.getItem(usageKey(userId));
    return text ? (JSON.parse(text) as Usage) : null;
  } catch {
    return null;
  }
}

function rememberUsage(userId: string, usage: Usage) {
  try {
    localStorage.setItem(usageKey(userId), JSON.stringify(usage));
  } catch {
    // Not kept: known again at the next sync.
  }
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
  /** When the last change was made here (see save). */
  private lastChangedAt = 0;
  /**
   * New recipes the server turned away for a plan limit (phase C11), and every change for them.
   * They exist only here, so they're kept (not dropped like other refusals) and sent again once
   * the household has room. Forgotten on reload, when they're simply tried again.
   */
  private heldRecipes = new Set<string>();
  private releases = 0;
  private cleanup: (() => void)[] = [];

  /**
   * acting: an admin is acting as this person (phase C12). Their copy is kept apart from the
   * person's own and starts empty, changes are never queued (saves go straight to the server),
   * and nothing about the account is remembered in this browser.
   */
  constructor(
    private readonly userId: string,
    private readonly deviceId: string,
    private readonly events: EngineEvents,
    private readonly acting = false,
  ) {
    this.status = acting
      ? STARTING
      : { ...STARTING, offlineEnabled: rememberedPlan(userId), usage: rememberedUsage(userId) };
  }

  private setStatus(next: Partial<SyncStatus>) {
    const held = this.outbox.filter((e) => this.isHeld(e)).length;
    this.status = { ...this.status, ...next, pending: this.outbox.length - held, held };
    this.events.status(this.status);
  }

  private isHeld(entry: OutboxEntry): boolean {
    const recipe = recipeOf(entry.change);
    return recipe !== null && this.heldRecipes.has(recipe);
  }

  /** Changes to send now: everything waiting but what's held for a plan limit. */
  private sendable(): OutboxEntry[] {
    return this.outbox.filter((e) => !this.isHeld(e));
  }

  /** The household's usage, from the server's latest answer (phase C11). */
  private heard(usage: Usage | undefined) {
    if (!usage) return;
    if (!this.acting) rememberUsage(this.userId, usage);
    this.setStatus({ usage });
    // Room again: what was held goes with the next send.
    if (this.heldRecipes.size > 0 && !addBlockedBy(usage) && this.releases < RELEASES_PER_SYNC) {
      this.releases += 1;
      this.heldRecipes.clear();
      this.setStatus({});
      this.again = true;
    }
  }

  /** Opens the local copy (waiting for a tab that just closed to let go of it), then syncs. */
  async start(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.db.call({
          op: "open",
          userId: this.userId,
          file: this.acting ? `acting-${this.userId}` : this.userId,
        });
        if (this.acting) await this.db.call({ op: "wipe" });
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
    if (this.acting) return;
    try {
      const plan = (await request("/api/entitlements")) as Entitlements;
      rememberPlan(this.userId, plan.offline_enabled);
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
  save(change: SyncChange): Promise<void> {
    return this.saveMany([change]);
  }

  /** Saves several changes at once (filing many recipes): all of them, or none. */
  async saveMany(changes: SyncChange[]): Promise<void> {
    if (changes.length === 0) return;
    // Each change is later than the one before, even within a millisecond, so the server keeps
    // the last of two quick changes to the same field.
    const checkedChanges = changes.map((change) => {
      const changedAt = Math.max(change.changedAt, this.lastChangedAt + 1);
      this.lastChangedAt = changedAt;
      const checked = checkChange({ ...change, changedAt });
      if (!checked.ok) throw new Error(`Invalid change: ${JSON.stringify(checked.issues)}`);
      return checked.value;
    });
    if (!canEdit(this.status)) throw new Error("Editing is paused.");
    const { seqs } = await this.db.call({
      op: "enqueue",
      changes: checkedChanges,
      now: new Date().toISOString(),
    });
    checkedChanges.forEach((change, i) => this.outbox.push({ seq: seqs[i] ?? 0, change }));
    this.setStatus({});
    this.events.changed();
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.sendTimer = setTimeout(() => void this.sync(), SEND_AFTER_MS);
  }

  /** Empties this browser's copy (an admin's, when they stop acting as someone). */
  async wipe(): Promise<void> {
    this.outbox = [];
    await this.db.call({ op: "wipe" });
    this.stop();
  }

  listRecipes(): Promise<RecipeSummary[]> {
    return this.db.call({ op: "listRecipes" });
  }

  getRecipe(id: string): Promise<RecipeDetail | null> {
    return this.db.call({ op: "getRecipe", recipeId: id });
  }

  getCategories(): Promise<CategoryData> {
    return this.db.call({ op: "getCategories" });
  }

  search(query: string): Promise<SearchResults> {
    return this.db.call({ op: "search", query });
  }

  listTrash(): Promise<TrashItem[]> {
    return this.db.call({ op: "listTrash" });
  }

  /**
   * Deletes recipes in Trash for good (phase C9): all of them, or those named. Needs a
   * connection. What's waiting is sent first, so a recipe just put back isn't deleted after all.
   * Returns how many were deleted.
   */
  async emptyTrash(recipeIds?: string[]): Promise<number> {
    // A sync may already be running (then sync() only asks for another): wait for it, briefly.
    // Held new recipes (phase C11) aren't in Trash, so they needn't wait.
    for (let i = 0; i < 20 && (this.running || this.sendable().length > 0); i++) {
      await this.sync();
      if (this.running || this.sendable().length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (this.status.phase === "offline") break;
    }
    if (this.sendable().length > 0) throw new Error("Changes are still waiting to be sent.");
    const answer = (await request("/api/trash/empty", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(recipeIds ? { recipeIds } : {}),
    })) as { expunged: number };
    await this.sync();
    return answer.expunged;
  }

  /** Sends what's waiting, then fetches what's new. One at a time; a request meanwhile runs after. */
  async sync(): Promise<void> {
    if (this.stopped || this.status.phase === "unavailable") return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.releases = 0;
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
      changes: this.status.offlineEnabled
        ? entries.map((e) => e.change)
        : stampedAsSent(
            entries.map((e) => e.change),
            sentAt,
          ),
    };
  }

  private async push() {
    const waiting = this.sendable();
    if (waiting.length === 0) return;
    const margin = 64 * 1024;
    for (const batch of batches(
      waiting,
      SYNC_RULES.changesPerPush,
      SYNC_RULES.pushBytes - margin,
    )) {
      const { results, usage } = (await request("/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this.pushBody(batch)),
      })) as PushResponse;
      // Kept, already there, or refused for good: no longer waiting. A failed save stays, and so
      // does a new recipe turned away for a plan limit (with everything for it).
      let failed = false;
      const done = batch.filter((entry, i) => {
        const result = results[i];
        if (result?.status !== "rejected") return true;
        if (result.reason === "failed") {
          failed = true;
          return false;
        }
        const recipe = recipeOf(entry.change);
        const isNew = entry.change.kind === "recipe" && entry.change.create !== undefined;
        if (result.reason === "limit" && recipe && (isNew || this.heldRecipes.has(recipe))) {
          this.heldRecipes.add(recipe);
          return false;
        }
        console.warn("The server refused a change", result, entry.change);
        return true;
      });
      await this.db.call({ op: "ack", seqs: done.map((e) => e.seq) });
      const sent = new Set(done.map((e) => e.seq));
      this.outbox = this.outbox.filter((e) => !sent.has(e.seq));
      this.setStatus({});
      this.heard(usage);
      if (failed) throw new SyncProblem("waiting");
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
      this.heard(pulled.usage);
      if (!pulled.more) return;
      this.events.changed();
    }
  }

  private flushOnClose() {
    const waiting = this.sendable();
    if (waiting.length === 0) return;
    const fits: OutboxEntry[] = [];
    let bytes = 512;
    for (const entry of waiting) {
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
