import encode from "@jsquash/webp/encode";

// Encodes photos as WebP in a background worker (phase D2), so the page stays responsive while
// it works. Uses libwebp compiled to WebAssembly (@jsquash/webp, Apache-2.0): browsers' own
// canvas can't make WebP in Safari, on the Mac or the iPhone (spec.md D2). The encoder file is
// downloaded the first time a photo needs it.

export interface WebpRequest {
  id: number;
  width: number;
  height: number;
  /** RGBA pixels, transferred (not copied) to the worker. */
  pixels: ArrayBuffer;
  /** 0 to 1, like canvas.toBlob. */
  quality: number;
}

export type WebpResponse =
  | { id: number; ok: true; bytes: ArrayBuffer; ms: number }
  | { id: number; ok: false; message: string };

self.onmessage = async (event: MessageEvent<WebpRequest>) => {
  const { id, width, height, pixels, quality } = event.data;
  const started = performance.now();
  try {
    const data = new ImageData(new Uint8ClampedArray(pixels), width, height);
    const bytes = await encode(data, { quality: Math.round(quality * 100), method: 4 });
    const reply: WebpResponse = { id, ok: true, bytes, ms: performance.now() - started };
    self.postMessage(reply, { transfer: [bytes] });
  } catch (error) {
    const reply: WebpResponse = { id, ok: false, message: String(error) };
    self.postMessage(reply);
  }
};
