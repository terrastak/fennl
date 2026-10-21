// Pages photographed or chosen for one recipe, before they're read (phase E9; spec.md E9, step 2:
// reorder, rotate, crop or remove pages before reading). Nothing is changed in the photo itself
// until it's prepared for upload (app/photos/prepare.ts), so turning and cropping lose nothing.

/** Part of a page as shown (after turning), as fractions of its width and height. */
export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Quarter turns clockwise. */
export type Turns = 0 | 1 | 2 | 3;

/** How a page is to be turned and cropped when it's prepared. */
export interface PageEdit {
  turns: Turns;
  /** Null: the whole page. */
  crop: CropBox | null;
}

export interface ScanPage extends PageEdit {
  id: string;
  /** The photo as the camera or file gave it. */
  file: Blob;
  /** A small copy, upright, for previews (made once). */
  small: Blob;
  /** How sharp it looks (app/scan/sharpness.ts); null when it couldn't be measured. */
  sharpness: number | null;
  /** A screenshot rather than a photo (phase E11; isScreenshot). */
  screenshot: boolean;
}

/**
 * Whether a picture is a screenshot (phase E11): phones and computers save screenshots as PNG,
 * and cameras save photos as JPEG or HEIC. A picture the camera just took is a photo.
 */
export const isScreenshot = (file: Blob, taken: boolean) => !taken && file.type === "image/png";

/** Pages read as screenshots: when every one is (a photo among them makes them photos). */
export const allScreenshots = (pages: Pick<ScanPage, "screenshot">[]) =>
  pages.length > 0 && pages.every((page) => page.screenshot);

/** The smallest crop, as a share of each side: enough to keep a few words. */
export const MIN_CROP = 0.1;

/** The list with one item moved from `from` to `to`. */
export function moved<T>(list: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= list.length || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** A box on a page, once the page is turned a quarter clockwise. */
export function turnBox(box: CropBox): CropBox {
  return { x: 1 - box.y - box.height, y: box.x, width: box.height, height: box.width };
}

/** A box on a page, once the page is turned a quarter anticlockwise. */
export function unturnBox(box: CropBox): CropBox {
  return { x: box.y, y: 1 - box.x - box.width, width: box.height, height: box.width };
}

/** The page turned a quarter clockwise; its crop turns with it, so it keeps the same words. */
export function turned<T extends PageEdit>(page: T): T {
  return {
    ...page,
    turns: ((page.turns + 1) % 4) as Turns,
    crop: page.crop ? turnBox(page.crop) : null,
  };
}

/** The crop on the photo as it was taken (before turning), for preparing it. */
export function cropOnOriginal(edit: PageEdit): CropBox | null {
  let box = edit.crop;
  if (!box) return null;
  for (let i = 0; i < edit.turns; i++) box = unturnBox(box);
  return box;
}

/** A box kept on the page and no smaller than MIN_CROP; null when it's the whole page. */
export function fitBox(box: CropBox): CropBox | null {
  const width = Math.min(1, Math.max(MIN_CROP, box.width));
  const height = Math.min(1, Math.max(MIN_CROP, box.height));
  const x = Math.min(1 - width, Math.max(0, box.x));
  const y = Math.min(1 - height, Math.max(0, box.y));
  const whole = x < 0.002 && y < 0.002 && width > 0.996 && height > 0.996;
  return whole ? null : { x, y, width, height };
}

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * The box with one corner moved to (x, y), the opposite corner staying put; never smaller than
 * MIN_CROP or off the page.
 */
export function dragCorner(box: CropBox, corner: Corner, x: number, y: number): CropBox {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  let left = box.x;
  let top = box.y;
  let right = box.x + box.width;
  let bottom = box.y + box.height;
  if (corner.endsWith("left")) left = Math.min(clamp(x), right - MIN_CROP);
  else right = Math.max(clamp(x), left + MIN_CROP);
  if (corner.startsWith("top")) top = Math.min(clamp(y), bottom - MIN_CROP);
  else bottom = Math.max(clamp(y), top + MIN_CROP);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export const WHOLE_PAGE: CropBox = { x: 0, y: 0, width: 1, height: 1 };
