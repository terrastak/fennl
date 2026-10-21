/**
 * How much of a PDF page its pictures cover (phase E12), from the page's drawing operations as
 * pdf.js lists them (page.getOperatorList()). A scanned page is one big picture, often with a
 * text layer the scanner added that reads badly ("HAMBURGER RUNS BUNS"), so a page mostly
 * covered by pictures is read as a picture (pageKind, shared/pdfImport.ts). Kept free of pdf.js
 * itself, so it runs anywhere and is tested on its own.
 */

/** The pdf.js operation numbers this needs (its OPS). */
export interface PdfOps {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  /** Operations that paint a picture into the unit square of the current transform. */
  pictures: number[];
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` then `n` (PDF order: the new transform applies first). */
function multiply(n: Matrix, m: Matrix): Matrix {
  return [
    n[0] * m[0] + n[1] * m[2],
    n[0] * m[1] + n[1] * m[3],
    n[2] * m[0] + n[3] * m[2],
    n[2] * m[1] + n[3] * m[3],
    n[4] * m[0] + n[5] * m[2] + m[4],
    n[4] * m[1] + n[5] * m[3] + m[5],
  ];
}

const isMatrix = (value: unknown): value is Matrix =>
  Array.isArray(value) && value.length === 6 && value.every((v) => typeof v === "number");

/**
 * The share of the page (0 to 1) its pictures cover, adding them up (a scanner may paint a page
 * in strips). `width` and `height`: the page's size, in the same units as its drawing.
 */
export function pictureShare(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  ops: PdfOps,
  width: number,
  height: number,
): number {
  const pageArea = Math.abs(width * height);
  if (!pageArea) return 0;
  const pictures = new Set(ops.pictures);
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  let covered = 0;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null | undefined;
    if (fn === ops.save) {
      stack.push(ctm);
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === ops.transform) {
      const m = args?.slice(0, 6);
      if (isMatrix(m)) ctm = multiply(m, ctm);
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = args?.[0];
      if (isMatrix(m)) ctm = multiply(m, ctm);
    } else if (fn === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn !== undefined && pictures.has(fn)) {
      covered += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
      if (covered >= pageArea) return 1;
    }
  }
  return Math.min(1, covered / pageArea);
}
