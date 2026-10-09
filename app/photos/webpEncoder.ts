import type { WebpRequest, WebpResponse } from "./webpWorker";

/**
 * Sends photos to the WebP worker (webpWorker.ts), one or many at a time; each answer comes back
 * to the request with the same ID. The worker starts on first use.
 */
export class WebpEncoder {
  private worker: Worker | null = null;
  private next = 1;
  private waiting = new Map<number, (response: WebpResponse) => void>();

  private start(): Worker {
    const worker = new Worker(new URL("./webpWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WebpResponse>) => {
      this.waiting.get(event.data.id)?.(event.data);
      this.waiting.delete(event.data.id);
    };
    worker.onerror = (event) => {
      // A worker that couldn't load (or ran out of memory) fails everything it was given.
      for (const [id, done] of this.waiting) done({ id, ok: false, message: event.message });
      this.waiting.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    return worker;
  }

  /** Encodes the pixels as WebP. The pixel buffer is handed to the worker and can't be reused. */
  encode(image: ImageData, quality: number): Promise<WebpResponse> {
    const worker = (this.worker ??= this.start());
    const id = this.next++;
    const request: WebpRequest = {
      id,
      width: image.width,
      height: image.height,
      pixels: image.data.buffer as ArrayBuffer,
      quality,
    };
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      worker.postMessage(request, { transfer: [request.pixels] });
    });
  }

  close() {
    this.worker?.terminate();
    this.worker = null;
  }
}
