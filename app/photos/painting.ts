import { useEffect, useState } from "react";
import { currentPhotoCache } from "./usePhoto";
import { photoUrl } from "./cache";
import { PAINTING, SAMPLE, paintStrokes, seededRandom } from "./brushStrokes";

// The painted background behind a recipe's photo on wide screens (owner's choice 2026-10-24):
// Fennl paints the dish in loose brush strokes from the photo's small copy, on the device, with
// no AI, and the page shows it softened behind the title (the strokes: ./brushStrokes.ts). The
// photo is mirrored and zoomed in first, and the strokes' randomness starts from the photo
// itself, so every photo gets its own painting and the same photo always the same one.

function canvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function context(c: OffscreenCanvas | HTMLCanvasElement) {
  const ctx = c.getContext("2d") as
    OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error("No 2D canvas");
  return ctx;
}

/** Paints a photo (its small copy) as brush strokes; answers the painting as a JPEG. */
export async function paintPhoto(photo: Blob, key: string): Promise<Blob> {
  const random = seededRandom(key);
  const image = await createImageBitmap(photo);
  const small = canvas(SAMPLE.width, SAMPLE.height);
  const sx = context(small);
  // Mirrored and zoomed in a little, nudged by the photo's own numbers: an echo of the dish,
  // not a copy of the photo's layout.
  const scale = Math.max(SAMPLE.width / image.width, SAMPLE.height / image.height) * 1.35;
  const w = image.width * scale;
  const h = image.height * scale;
  sx.translate(SAMPLE.width, 0);
  sx.scale(-1, 1);
  sx.drawImage(
    image,
    (SAMPLE.width - w) / 2 + (random() - 0.5) * 40,
    (SAMPLE.height - h) / 2 + (random() - 0.5) * 30,
    w,
    h,
  );
  image.close();
  const sample = sx.getImageData(0, 0, SAMPLE.width, SAMPLE.height).data;

  const out = canvas(PAINTING.width, PAINTING.height);
  const ctx = context(out);
  const middle = (Math.floor(SAMPLE.height / 2) * SAMPLE.width + Math.floor(SAMPLE.width / 2)) * 4;
  ctx.fillStyle = `rgb(${sample[middle]} ${sample[middle + 1]} ${sample[middle + 2]})`;
  ctx.fillRect(0, 0, PAINTING.width, PAINTING.height);
  ctx.lineCap = "round";
  for (const stroke of paintStrokes(sample, random)) {
    ctx.strokeStyle = `rgb(${stroke.colour.join(" ")} / 0.78)`;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    ctx.moveTo(...stroke.from);
    ctx.quadraticCurveTo(...stroke.bend, ...stroke.to);
    ctx.stroke();
  }
  return out instanceof HTMLCanvasElement
    ? new Promise((resolve, reject) =>
        out.toBlob((b) => (b ? resolve(b) : reject(new Error("No painting"))), "image/jpeg", 0.8),
      )
    : out.convertToBlob({ type: "image/jpeg", quality: 0.8 });
}

/** Paintings made on this visit, by photo: painting again is quick, but not free. */
const painted = new Map<string, Promise<Blob>>();

/**
 * The painting of a photo for an <img>, or null while it's being made (or when it can't be: no
 * small copy offline, or a browser without canvas). The page looks right without it.
 */
export function usePainting(hash: string | null): string | null {
  const [state, setState] = useState<{ hash: string; url: string } | null>(null);
  useEffect(() => {
    if (!hash) return;
    let cancelled = false;
    let url: string | null = null;
    let job = painted.get(hash);
    if (!job) {
      const cache = currentPhotoCache();
      const small = cache
        ? cache.get(hash, "thumb")
        : fetch(photoUrl(hash, "thumb")).then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            return r.blob();
          });
      job = small.then((blob) => paintPhoto(blob, hash));
      painted.set(hash, job);
      job.catch(() => painted.delete(hash));
    }
    job
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ hash, url });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [hash]);
  return state?.hash === hash ? state.url : null;
}
