import type { SyncChange } from "../../shared/sync";
import type { CategoryData } from "../categories/tree";
import type { RecipeDetail, RecipeSummary } from "./dbProtocol";
import type { SearchResults } from "./search";
import { SyncEngine } from "./engine";
import { STARTING, type SyncStatus } from "./status";

// Several tabs, one local copy (phase C4). Only one tab can open the local database (C2), so
// the tabs agree, through the browser's Web Locks, which one owns it. That tab runs syncing; the
// others send it their requests over a BroadcastChannel and hear back when anything changes.
// When the owner closes, the lock passes to another tab, which opens the database and carries
// on (CLAUDE.md, "Stack").

interface Calls {
  save: { args: [SyncChange]; result: undefined };
  saveMany: { args: [SyncChange[]]; result: undefined };
  getCategories: { args: []; result: CategoryData };
  search: { args: [string]; result: SearchResults };
  listRecipes: { args: []; result: RecipeSummary[] };
  getRecipe: { args: [string]; result: RecipeDetail | null };
  syncNow: { args: []; result: undefined };
}
type CallName = keyof Calls;

type Message =
  | { type: "call"; id: string; from: string; name: CallName; args: unknown[] }
  | { type: "reply"; id: string; to: string; ok: boolean; value?: unknown; error?: string }
  | { type: "status"; owner: string; status: SyncStatus }
  | { type: "changed" }
  | { type: "hello" };

interface Outstanding {
  name: CallName;
  args: unknown[];
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/** How long a tab waits for the owner to answer before giving up on a request. */
const CALL_TIMEOUT_MS = 30_000;

export class SyncClient {
  private readonly tabId = crypto.randomUUID();
  private channel: BroadcastChannel | null = null;
  private engine: SyncEngine | null = null;
  /** Settles once this tab's engine has opened the local copy. */
  private ready: Promise<void> = Promise.resolve();
  private owner: string | null = null;
  private status: SyncStatus = STARTING;
  private statusListeners = new Set<() => void>();
  private changeListeners = new Set<() => void>();
  private outstanding = new Map<string, Outstanding>();
  private release: (() => void) | null = null;
  private stopped = false;

  constructor(
    readonly userId: string,
    private readonly deviceId: string,
  ) {}

  start() {
    const name = `fennl-sync-${this.userId}`;
    this.channel = new BroadcastChannel(name);
    this.channel.onmessage = (event: MessageEvent<Message>) => void this.receive(event.data);
    if (navigator.locks) {
      // Waits in line while another tab owns the copy; runs when this tab's turn comes.
      void navigator.locks.request(name, () => this.own());
      this.post({ type: "hello" });
    } else {
      void this.own();
    }
  }

  stop() {
    this.stopped = true;
    this.engine?.stop();
    this.engine = null;
    this.release?.();
    this.channel?.close();
    for (const call of this.outstanding.values()) call.reject(new Error("Stopped"));
    this.outstanding.clear();
  }

  // --- What the app uses ---------------------------------------------------------------------

  getStatus = (): SyncStatus => this.status;

  subscribeStatus = (listener: () => void) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };

  /** Called whenever the local copy changes (here or in another tab). */
  subscribeChanges = (listener: () => void) => {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  };

  save(change: SyncChange) {
    return this.call("save", [change]);
  }

  saveMany(changes: SyncChange[]) {
    return this.call("saveMany", [changes]);
  }

  listRecipes() {
    return this.call("listRecipes", []);
  }

  getCategories() {
    return this.call("getCategories", []);
  }

  search(query: string) {
    return this.call("search", [query]);
  }

  getRecipe(id: string) {
    return this.call("getRecipe", [id]);
  }

  syncNow() {
    return this.call("syncNow", []);
  }

  // --- Owning the local copy -----------------------------------------------------------------

  /** This tab's turn: open the database and sync, until the tab closes. */
  private async own(): Promise<void> {
    if (this.stopped) return;
    const engine = new SyncEngine(this.userId, this.deviceId, {
      status: (status) => {
        this.setStatus(status);
        this.post({ type: "status", owner: this.tabId, status });
      },
      changed: () => {
        this.notifyChanged();
        this.post({ type: "changed" });
      },
    });
    this.engine = engine;
    this.owner = this.tabId;
    this.ready = engine.start();
    // Requests that were waiting for the old owner are answered here now.
    for (const [id, call] of this.outstanding) {
      this.outstanding.delete(id);
      this.run(call.name, call.args).then(call.resolve, call.reject);
    }
    await this.ready;
    // Hold the lock until this tab goes away.
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  private async run(name: CallName, args: unknown[]): Promise<unknown> {
    const engine = this.engine;
    if (!engine) throw new Error("Not the owner");
    await this.ready;
    switch (name) {
      case "save":
        return engine.save(args[0] as SyncChange);
      case "saveMany":
        return engine.saveMany(args[0] as SyncChange[]);
      case "listRecipes":
        return engine.listRecipes();
      case "getCategories":
        return engine.getCategories();
      case "search":
        return engine.search(args[0] as string);
      case "getRecipe":
        return engine.getRecipe(args[0] as string);
      case "syncNow":
        return engine.sync();
    }
  }

  // --- Asking the owner ----------------------------------------------------------------------

  private call<N extends CallName>(name: N, args: Calls[N]["args"]): Promise<Calls[N]["result"]> {
    if (this.engine) return this.run(name, args) as Promise<Calls[N]["result"]>;
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.outstanding.delete(id);
        reject(new Error("No answer from the tab that owns the local copy."));
      }, CALL_TIMEOUT_MS);
      this.outstanding.set(id, {
        name,
        args,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as Calls[N]["result"]);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.post({ type: "call", id, from: this.tabId, name, args });
    });
  }

  private async receive(message: Message) {
    switch (message.type) {
      case "call": {
        if (!this.engine) return;
        try {
          const value = await this.run(message.name, message.args);
          this.post({ type: "reply", id: message.id, to: message.from, ok: true, value });
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          this.post({ type: "reply", id: message.id, to: message.from, ok: false, error: text });
        }
        return;
      }
      case "reply": {
        if (message.to !== this.tabId) return;
        const call = this.outstanding.get(message.id);
        this.outstanding.delete(message.id);
        if (message.ok) call?.resolve(message.value);
        else call?.reject(new Error(message.error));
        return;
      }
      case "status": {
        if (this.engine) return;
        const newOwner = message.owner !== this.owner;
        this.owner = message.owner;
        this.setStatus(message.status);
        // A new owner never heard the requests sent to the old one: send them again.
        if (newOwner) {
          for (const [id, call] of this.outstanding) {
            this.post({ type: "call", id, from: this.tabId, name: call.name, args: call.args });
          }
          this.notifyChanged();
        }
        return;
      }
      case "changed":
        this.notifyChanged();
        return;
      case "hello":
        if (this.engine) {
          this.post({ type: "status", owner: this.tabId, status: this.engine.getStatus() });
        }
        return;
    }
  }

  private post(message: Message) {
    this.channel?.postMessage(message);
  }

  private setStatus(status: SyncStatus) {
    this.status = status;
    for (const listener of this.statusListeners) listener();
  }

  private notifyChanged() {
    for (const listener of this.changeListeners) listener();
  }
}
