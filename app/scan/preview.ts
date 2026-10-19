import { decode, draw, drawEdited, inspect, open, pixels, release } from "../photos/prepare";
import { cropOnOriginal, type PageEdit } from "./pages";
import { SHARPNESS_EDGE, sharpness } from "./sharpness";

// Small copies of pages for the screens that arrange them (phase E9). Each page gets one small,
// upright copy when it's added (and its sharpness is measured on it); turned and cropped previews
// are drawn from that, so arranging never reopens a 12 MP photo.

const toJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/** The page's small copy and how sharp it looks. Throws when the file isn't a picture. */
export async function smallCopy(file: Blob): Promise<{ small: Blob; sharpness: number | null }> {
  const source = await open(file, await inspect(file));
  const canvas = draw(source, SHARPNESS_EDGE);
  if (source instanceof ImageBitmap) source.close();
  try {
    let score: number | null = null;
    try {
      score = sharpness(pixels(canvas));
    } catch {
      // Some browsers won't hand back pixels (privacy settings): no score, no blur warning.
    }
    const small = await toJpeg(canvas, 0.85);
    if (!small) throw new Error("This browser couldn't copy the photo.");
    return { small, sharpness: score };
  } finally {
    release(canvas);
  }
}

/** The page as it'll be read: turned and cropped, from its small copy, as an object URL. */
export async function editedPreview(small: Blob, edit: PageEdit, maxEdge = 600): Promise<string> {
  const image = await decode(small);
  const canvas = drawEdited(image, cropOnOriginal(edit), edit.turns, maxEdge);
  const blob = await toJpeg(canvas, 0.8);
  release(canvas);
  if (!blob) throw new Error("This browser couldn't draw the page.");
  return URL.createObjectURL(blob);
}
