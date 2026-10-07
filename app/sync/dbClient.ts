import type { DbRequest, DbResponse, DbResults } from "./dbProtocol";

/** A failed request to the local database. `busy`: another tab still holds the storage. */
export class LocalDbError extends Error {
  constructor(
    message: string,
    readonly busy: boolean,
  ) {
    super(message);
  }
}

type Request = DbRequest extends infer R ? R : never;

/** Talks to the local database worker (app/sync/dbWorker.ts): one promise per request. */
export class LocalDb {
  private worker = new Worker(new URL("./dbWorker.ts", import.meta.url), { type: "module" });
  private nextId = 1;
  private waiting = new Map<number, (response: DbResponse) => void>();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<DbResponse>) => {
      const done = this.waiting.get(event.data.id);
      this.waiting.delete(event.data.id);
      done?.(event.data);
    };
  }

  call<R extends Request>(request: R): Promise<DbResults[R["op"]]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (response) => {
        if (response.ok) resolve(response.value as DbResults[R["op"]]);
        else reject(new LocalDbError(response.message, response.busy));
      });
      this.worker.postMessage({ ...request, id });
    });
  }

  close() {
    this.worker.terminate();
    for (const done of this.waiting.values()) {
      done({ id: 0, ok: false, busy: false, message: "closed" });
    }
    this.waiting.clear();
  }
}
