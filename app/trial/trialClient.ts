import type { TrialRequest, TrialResponse } from "./protocol";

/**
 * Talks to the storage trial's database worker (phase C2): one request at a time, each answered
 * by the reply that finishes it. Progress messages go to `onProgress` on the way.
 */
export class TrialClient {
  private worker: Worker;
  private waiting: ((response: TrialResponse) => boolean) | null = null;

  constructor(private readonly onProgress: (written: number, of: number) => void) {
    this.worker = this.start();
  }

  private start(): Worker {
    const worker = new Worker(new URL("./trialWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<TrialResponse>) => {
      const response = event.data;
      if (response.type === "progress") this.onProgress(response.written, response.of);
      if (this.waiting?.(response)) this.waiting = null;
    };
    return worker;
  }

  ask(request: TrialRequest, done: TrialResponse["type"]): Promise<TrialResponse> {
    return new Promise((resolve) => {
      this.waiting = (response) => {
        if (response.type !== done && response.type !== "error") return false;
        resolve(response);
        return true;
      };
      this.worker.postMessage(request);
    });
  }

  /** Starts a fresh worker (after another tab let go of the storage) and opens again. */
  reopen(): Promise<TrialResponse> {
    this.worker.terminate();
    this.worker = this.start();
    return this.ask({ type: "open" }, "opened");
  }

  close() {
    this.worker.terminate();
  }
}
