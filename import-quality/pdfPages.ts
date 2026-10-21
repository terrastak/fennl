import { createCanvas } from "@napi-rs/canvas";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { pageKind, type PageKind } from "../shared/pdfImport";
import { pictureShare } from "../shared/pdfPictures";
import { pageText, type PdfTextPiece } from "../shared/pdfText";

// A PDF's pages as the app sees them (app/pdf/pdfFile.ts), for the model comparison in Node:
// the same pdf.js, each page's own text and how it's read, and pages drawn as pictures (with
// @napi-rs/canvas, the canvas pdf.js uses outside a browser).

export interface PdfPage {
  page: number;
  text: string;
  kind: PageKind;
}

export interface OpenedPdf {
  pages: PdfPage[];
  /** A page drawn on white, its longer side `longEdge` pixels. */
  picture(
    page: number,
    longEdge: number,
    type: "jpeg" | "webp",
    quality: number,
  ): Promise<Uint8Array>;
  close(): Promise<void>;
}

export async function openPdf(bytes: Uint8Array): Promise<OpenedPdf> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const pages: PdfPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const text = pageText((await p.getTextContent()).items as PdfTextPiece[]);
    const ops = await p.getOperatorList();
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = p.view;
    const share = pictureShare(
      ops.fnArray,
      ops.argsArray,
      {
        save: OPS.save,
        restore: OPS.restore,
        transform: OPS.transform,
        paintFormXObjectBegin: OPS.paintFormXObjectBegin,
        paintFormXObjectEnd: OPS.paintFormXObjectEnd,
        pictures: [
          OPS.paintImageXObject,
          OPS.paintInlineImageXObject,
          OPS.paintImageXObjectRepeat,
          OPS.paintImageMaskXObject,
        ],
      },
      x1 - x0,
      y1 - y0,
    );
    pages.push({ page: n, text, kind: pageKind(text, share) });
  }
  return {
    pages,
    async picture(page, longEdge, type, quality) {
      const p = await doc.getPage(page);
      const base = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: longEdge / Math.max(base.width, base.height) });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await p.render({ canvas: canvas as never, canvasContext: context as never, viewport })
        .promise;
      return new Uint8Array(await canvas.encode(type, quality));
    },
    close: () => task.destroy(),
  };
}
