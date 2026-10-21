import { pageKind, type PageKind } from "../../shared/pdfImport";
import { pictureShare } from "../../shared/pdfPictures";
import { pageText, type PdfTextPiece } from "../../shared/pdfText";

// A PDF opened on this device (phase E12), with Mozilla's pdf.js, loaded only when a PDF is
// chosen. Its "legacy" build: the modern one needs JavaScript newer than Safari and Chrome had in
// October 2026 (Map.getOrInsertComputed). The file never leaves the device whole: Fennl reads each page's own text, sees whether
// it's a scanned picture, and draws pages as pictures where they're needed (a scanned page, and
// each recipe's pages, kept with it like page photos).

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfTask = ReturnType<PdfJs["getDocument"]>;
type PdfDocument = Awaited<PdfTask["promise"]>;

let loading: Promise<PdfJs> | null = null;

/** pdf.js, with its worker, loaded once. */
function pdfjs(): Promise<PdfJs> {
  loading ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ])
    .then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

/** One page: its own text, and whether it's read from that text or as a picture. */
export interface PdfPageInfo {
  page: number;
  text: string;
  kind: PageKind;
}

export class PdfFile {
  private constructor(
    private readonly lib: PdfJs,
    private readonly task: PdfTask,
    private readonly doc: PdfDocument,
    readonly name: string,
  ) {}

  /**
   * Opens a PDF. Fails with "locked" for one that needs a password, "not_a_pdf" for anything
   * pdf.js can't read.
   */
  static async open(file: File): Promise<PdfFile> {
    const lib = await pdfjs();
    try {
      const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
      return new PdfFile(lib, task, await task.promise, file.name);
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "PasswordException")
        throw new Error("locked", { cause: error });
      throw new Error("not_a_pdf", { cause: error });
    }
  }

  get pageCount(): number {
    return this.doc.numPages;
  }

  /** A page's own text, and how it's read. */
  async info(page: number): Promise<PdfPageInfo> {
    const p = await this.doc.getPage(page);
    const text = pageText((await p.getTextContent()).items as PdfTextPiece[]);
    const ops = await p.getOperatorList();
    const { OPS } = this.lib;
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
    p.cleanup();
    return { page, text, kind: pageKind(text, share) };
  }

  /** A page drawn as a picture, its longer side `longEdge` pixels, on white. */
  async picture(
    page: number,
    longEdge: number,
    type: "image/jpeg" | "image/png" = "image/jpeg",
    quality = 0.85,
  ): Promise<Blob> {
    const p = await this.doc.getPage(page);
    const base = p.getViewport({ scale: 1 });
    const viewport = p.getViewport({ scale: longEdge / Math.max(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no_canvas");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvas, canvasContext: context, viewport }).promise;
    p.cleanup();
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error("no_picture");
    return blob;
  }

  /** Lets go of the PDF and its pages. */
  close(): void {
    void this.task.destroy();
  }
}
