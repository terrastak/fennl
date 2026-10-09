import { readJpegInfo, swapsSides, type JpegInfo } from "./jpegInfo";
import { fittedSize } from "./settings";

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
export function draw(image: HTMLImageElement, maxEdge: number): HTMLCanvasElement {
  const target = fittedSize(image.naturalWidth, image.naturalHeight, maxEdge);
  let source: CanvasImageSource = image;
  let { naturalWidth: width, naturalHeight: height } = image;
  while (width / 2 >= target.width * 1.5 && (width / 2) * (height / 2) <= 16_000_000) {
    width = Math.round(width / 2);
    height = Math.round(height / 2);
    source = paint(source, width, height);
  }
  return paint(source, target.width, target.height);
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
  if (source instanceof HTMLCanvasElement) release(source);
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
