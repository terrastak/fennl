import { readJpegInfo, swapsSides, type JpegInfo } from "./jpegInfo";
import { PHOTO_SETTINGS, fittedSize, keepOriginal, type PhotoKind } from "./settings";
import type { WebpEncoder } from "./webpEncoder";

// Getting a photo ready to upload, in the browser (phase D2): draw it upright at the right size,
// then encode it. Drawing through an <img> element (not createImageBitmap) because Safari has
// had bugs turning photos upright on the other path; every browser turns an <img> by its EXIF
// orientation. The canvas is only ever as big as the result, never the camera's full size:
// iPhones refuse canvases over about 16.7 million pixels, and a 24 MP photo is bigger.

/** What a file looks like before anything is done to it. */
export interface Original {
  type: string;
  bytes: number;
  /** From the JPEG header (only for JPEGs). */
  jpeg: JpegInfo | null;
}

export async function inspect(file: Blob): Promise<Original> {
  // The header is near the start; a quarter of a megabyte holds it even with big EXIF blocks.
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  return { type: file.type, bytes: file.size, jpeg: readJpegInfo(head) };
}

/** Something a photo can be drawn from. */
export type Drawable = HTMLImageElement | ImageBitmap | HTMLCanvasElement;

export function sizeOf(source: Drawable): { width: number; height: number } {
  return source instanceof HTMLImageElement
    ? { width: source.naturalWidth, height: source.naturalHeight }
    : { width: source.width, height: source.height };
}

/** Bigger than this, a photo is opened at a reduced size (some Android phones take 200 MP). */
export const HUGE_PIXELS = 50_000_000;

/**
 * Opens a photo for drawing, turned upright. Very large photos (over HUGE_PIXELS, sized from the
 * file's own header first) are opened at a reduced size where the browser can, so a phone doesn't
 * run out of memory; everything else goes through an <img> (see above).
 */
export async function open(file: Blob, original: Original): Promise<Drawable> {
  const jpeg = original.jpeg;
  if (jpeg && jpeg.width * jpeg.height > HUGE_PIXELS && "createImageBitmap" in window) {
    try {
      // Only a width, so the shape is kept whichever way the photo is turned.
      return await createImageBitmap(file, {
        imageOrientation: "from-image",
        resizeWidth: 4000,
        resizeQuality: "high",
      });
    } catch {
      // Not supported this way: the ordinary path below.
    }
  }
  return decode(file);
}

/** Loads a picture file into an image element, turned upright. */
export async function decode(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Whether the browser turned the picture upright: its drawn shape matches the EXIF turn. Only
 * tells for quarter turns (orientations 5 to 8), where width and height swap.
 */
export function turnedUpright(image: HTMLImageElement, jpeg: JpegInfo | null): boolean | null {
  if (!jpeg || !swapsSides(jpeg.orientation)) return null;
  return image.naturalWidth === jpeg.height && image.naturalHeight === jpeg.width;
}

/**
 * Draws the picture with its longest side at most `maxEdge`. Large reductions are done in halves,
 * which looks sharper than one big jump in browsers whose scaling is rough.
 */
export function draw(image: Drawable, maxEdge: number): HTMLCanvasElement {
  const size = sizeOf(image);
  const target = fittedSize(size.width, size.height, maxEdge);
  let source: CanvasImageSource = image;
  let { width, height } = size;
  while (width / 2 >= target.width * 1.5 && (width / 2) * (height / 2) <= 16_000_000) {
    width = Math.round(width / 2);
    height = Math.round(height / 2);
    const next = paint(source, width, height);
    // Free the in-between steps, never the picture passed in.
    if (source !== image && source instanceof HTMLCanvasElement) release(source);
    source = next;
  }
  const result = paint(source, target.width, target.height);
  if (source !== image && source instanceof HTMLCanvasElement) release(source);
  return result;
}

function paint(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser couldn't make a drawing surface for the photo.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** Gives a canvas's memory back at once (Safari otherwise holds it for a while). */
export function release(canvas: HTMLCanvasElement) {
  canvas.width = 1;
  canvas.height = 1;
}

/**
 * The browser's own encoder. `type` is what came back, which isn't always what was asked for:
 * Safari answers a request for WebP with a PNG.
 */
export function encodeWithCanvas(
  canvas: HTMLCanvasElement,
  type: "image/webp" | "image/jpeg",
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** The canvas's pixels, for the WebAssembly encoder. */
export function pixels(canvas: HTMLCanvasElement): ImageData {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser couldn't read the photo's pixels.");
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

// ---------------------------------------------------------------------------------------------
// The whole preparation, as the app uses it
// ---------------------------------------------------------------------------------------------

/** The small copy for lists: longest side, quality. */
export const THUMB = { maxEdge: 480, quality: 0.75 };

export interface Prepared {
  /** What to upload: the original (kept as it is) or the prepared version. */
  file: Blob;
  width: number;
  height: number;
  thumb: Blob;
}

async function encodeBest(
  canvas: HTMLCanvasElement,
  quality: number,
  encoder: WebpEncoder,
): Promise<Blob> {
  const answer = await encoder.encode(pixels(canvas), quality);
  if (answer.ok) return new Blob([answer.bytes], { type: "image/webp" });
  // The WebAssembly encoder couldn't load: the browser's own JPEG, never its "WebP" (on Safari
  // that's a PNG twice the size of the original).
  const jpeg = await encodeWithCanvas(canvas, "image/jpeg", quality);
  if (!jpeg) throw new Error("This browser couldn't save the photo.");
  return jpeg;
}

/**
 * Gets a photo ready to upload (spec.md D2): upright, no larger than its kind allows, as WebP,
 * with a small copy for lists. The original is uploaded instead when it's already fine as it is
 * (a GIF, or a small scan that re-encoding would barely shrink). Only pixels are kept, so a
 * camera photo's location never leaves the device.
 */
export async function preparePhoto(
  file: Blob,
  kind: PhotoKind,
  encoder: WebpEncoder,
  maxFileBytes: number | null,
): Promise<Prepared> {
  const settings = PHOTO_SETTINGS[kind];
  const original = await inspect(file);
  const source = await open(file, original);
  const size = sizeOf(source);
  const canvas = draw(source, settings.maxEdge);
  if (source instanceof ImageBitmap) source.close();
  try {
    const thumbCanvas = draw(canvas, THUMB.maxEdge);
    const thumb = await encodeBest(thumbCanvas, THUMB.quality, encoder);
    release(thumbCanvas);
    // A GIF is kept as it is (animation and all) whenever it fits.
    if (original.type === "image/gif" && (maxFileBytes === null || file.size <= maxFileBytes)) {
      return { file, width: size.width, height: size.height, thumb };
    }
    const prepared = await encodeBest(canvas, settings.quality, encoder);
    const keep = keepOriginal({
      type: original.type,
      bytes: original.bytes,
      width: original.jpeg?.width ?? size.width,
      height: original.jpeg?.height ?? size.height,
      hasLocation: original.jpeg?.hasLocation ?? false,
      turned: (original.jpeg?.orientation ?? 1) !== 1,
      encodedBytes: prepared.size,
      maxEdge: settings.maxEdge,
      maxFileBytes,
    });
    return keep
      ? { file, width: size.width, height: size.height, thumb }
      : { file: prepared, width: canvas.width, height: canvas.height, thumb };
  } finally {
    release(canvas);
  }
}
