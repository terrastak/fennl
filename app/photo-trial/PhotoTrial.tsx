import { useEffect, useRef, useState } from "react";
import { deviceLabel } from "../../shared/devices";
import {
  decode,
  draw,
  encodeWithCanvas,
  inspect,
  pixels,
  release,
  turnedUpright,
  type Original,
} from "../photos/prepare";
import { PHOTO_SETTINGS, keepOriginal, type PhotoKind } from "../photos/settings";
import { WebpEncoder } from "../photos/webpEncoder";
import styles from "./photoTrial.module.css";

// The photo test page (phase D2): how does this device handle the photos Fennl will store? It
// prepares photos exactly as the app will (upright, resized, encoded three ways) and reports the
// times and sizes. Nothing is uploaded: the photos never leave this device.

/** Fennl's file limit (plan_limits, decided 2026-10-08); only used here to judge "keep as is". */
const FILE_LIMIT = 5 * 1024 * 1024;

function kb(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

function time(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function installed(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

interface Encoded {
  bytes: number;
  ms: number;
}

interface PhotoResult {
  id: number;
  name: string;
  source: "camera" | "chosen";
  kind: PhotoKind;
  original: Original;
  decodeMs: number;
  shown: { width: number; height: number };
  upright: boolean | null;
  drawMs: number;
  size: { width: number; height: number };
  canvasWebp: (Encoded & { type: string }) | null;
  canvasJpeg: Encoded | null;
  wasmWebp: Encoded | { error: string };
  keep: boolean;
  preview: string | null;
}

interface PhotoFailure {
  id: number;
  name: string;
  source: "camera" | "chosen";
  type: string;
  bytes: number;
  error: string;
}

type Row = PhotoResult | PhotoFailure;
const failed = (row: Row): row is PhotoFailure => "error" in row;

interface LiveCamera {
  state: "off" | "starting" | "on" | "failed";
  error?: string;
  stream?: { width: number; height: number };
  imageCapture?: boolean;
  frame?: { width: number; height: number };
  still?: { width: number; height: number } | { error: string };
  /** Previews, to see by eye whether the pictures came out upright and sharp. */
  framePreview?: string;
  stillPreview?: string;
}

/** Whether the browser's own canvas can make WebP (Safari gives a PNG instead). */
async function canvasMakesWebp(): Promise<boolean> {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const blob = await encodeWithCanvas(canvas, "image/webp", 0.8);
  return blob?.type === "image/webp";
}

export function PhotoTrial() {
  const [kind, setKind] = useState<PhotoKind>("page");
  const [rows, setRows] = useState<Row[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [nativeWebp, setNativeWebp] = useState<boolean | null>(null);
  const [live, setLive] = useState<LiveCamera>({ state: "off" });
  const [copied, setCopied] = useState(false);
  const encoder = useRef<WebpEncoder | null>(null);
  const nextId = useRef(1);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const label = deviceLabel(navigator.userAgent);
  const home = installed();

  useEffect(() => {
    encoder.current = new WebpEncoder();
    void canvasMakesWebp().then(setNativeWebp);
    return () => {
      encoder.current?.close();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const prepare = async (file: File, source: "camera" | "chosen"): Promise<Row> => {
    const id = nextId.current++;
    const name = file.name || "photo";
    try {
      const settings = PHOTO_SETTINGS[kind];
      const original = await inspect(file);
      let started = performance.now();
      const image = await decode(file);
      const decodeMs = performance.now() - started;

      started = performance.now();
      const canvas = draw(image, settings.maxEdge);
      const drawMs = performance.now() - started;

      started = performance.now();
      const webp = await encodeWithCanvas(canvas, "image/webp", settings.quality);
      const canvasWebp = webp
        ? { type: webp.type, bytes: webp.size, ms: performance.now() - started }
        : null;
      started = performance.now();
      const jpeg = await encodeWithCanvas(canvas, "image/jpeg", settings.quality);
      const canvasJpeg = jpeg ? { bytes: jpeg.size, ms: performance.now() - started } : null;

      const size = { width: canvas.width, height: canvas.height };
      const data = pixels(canvas);
      release(canvas);
      encoder.current ??= new WebpEncoder();
      const answer = await encoder.current.encode(data, settings.quality);
      const wasmWebp = answer.ok
        ? { bytes: answer.bytes.byteLength, ms: answer.ms }
        : { error: answer.message };

      const smallest = answer.ok ? answer.bytes.byteLength : (canvasJpeg?.bytes ?? Infinity);
      const keep = keepOriginal({
        type: original.type,
        bytes: original.bytes,
        width: original.jpeg?.width ?? image.naturalWidth,
        height: original.jpeg?.height ?? image.naturalHeight,
        hasLocation: original.jpeg?.hasLocation ?? false,
        turned: (original.jpeg?.orientation ?? 1) !== 1,
        encodedBytes: smallest,
        maxEdge: settings.maxEdge,
        maxFileBytes: FILE_LIMIT,
      });
      const previewBlob = answer.ok ? new Blob([answer.bytes], { type: "image/webp" }) : jpeg;
      return {
        id,
        name,
        source,
        kind,
        original,
        decodeMs,
        shown: { width: image.naturalWidth, height: image.naturalHeight },
        upright: turnedUpright(image, original.jpeg),
        drawMs,
        size,
        canvasWebp,
        canvasJpeg,
        wasmWebp,
        keep,
        preview: previewBlob ? URL.createObjectURL(previewBlob) : null,
      };
    } catch (error) {
      return {
        id,
        name,
        source,
        type: file.type,
        bytes: file.size,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const add = async (files: FileList | null, source: "camera" | "chosen") => {
    // Copy the list first: clearing the input empties it, and the input must be cleared so the
    // next photo (even the same one) is noticed. Each photo is kept as it arrives, so taking
    // several in a row never replaces the one before.
    const list = files ? [...files] : [];
    if (!list.length) return;
    setCopied(false);
    for (const [index, file] of list.entries()) {
      setWorking(`Preparing photo ${index + 1} of ${list.length}…`);
      const row = await prepare(file, source);
      setRows((current) => [...current, row]);
    }
    setWorking(null);
  };

  const startCamera = async () => {
    setLive({ state: "starting" });
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 4096 },
          height: { ideal: 3072 },
        },
        audio: false,
      });
      stream.current = media;
      const settings = media.getVideoTracks()[0]?.getSettings() ?? {};
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play().catch(() => undefined);
      }
      setLive({
        state: "on",
        stream: { width: settings.width ?? 0, height: settings.height ?? 0 },
        imageCapture: "ImageCapture" in window,
      });
    } catch (error) {
      setLive({
        state: "failed",
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  };

  const grabFrame = async () => {
    const element = video.current;
    if (!element || !stream.current) return;
    const frame = { width: element.videoWidth, height: element.videoHeight };
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext("2d")?.drawImage(element, 0, 0);
    const frameBlob = await encodeWithCanvas(canvas, "image/jpeg", 0.9);
    release(canvas);
    const framePreview = frameBlob ? URL.createObjectURL(frameBlob) : undefined;
    let still: LiveCamera["still"];
    let stillPreview: string | undefined;
    const track = stream.current.getVideoTracks()[0];
    const Capture = (
      window as Window & {
        ImageCapture?: new (track: MediaStreamTrack) => { takePhoto(): Promise<Blob> };
      }
    ).ImageCapture;
    if (Capture && track) {
      try {
        const blob = await new Capture(track).takePhoto();
        const image = await decode(blob);
        still = { width: image.naturalWidth, height: image.naturalHeight };
        stillPreview = URL.createObjectURL(blob);
      } catch (error) {
        still = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    setLive((current) => ({
      ...current,
      frame,
      ...(still ? { still } : {}),
      ...(framePreview ? { framePreview } : {}),
      ...(stillPreview ? { stillPreview } : {}),
    }));
  };

  const stopCamera = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setLive((current) => ({ ...current, state: "off" }));
  };

  const report = summary({ label, home, nativeWebp, rows, live });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className={styles.page}>
      <p className="hand-note">for the Fennl team</p>
      <h1 className={styles.title}>Photo test</h1>
      <p className={styles.lead}>
        This checks how this device prepares photos for Fennl: turning them upright, making them
        smaller, and saving them in three different ways. Nothing is uploaded; the photos stay on
        this device. If the page goes blank or reloads by itself during a photo, the device ran out
        of memory: please say so when you send the results.
      </p>

      <section className={styles.card} aria-labelledby="device-title">
        <h2 id="device-title">This device</h2>
        <dl className={styles.details}>
          <div>
            <dt>Browser</dt>
            <dd>{`${label}${home ? ", opened from the home screen" : ""}`}</dd>
          </div>
          <div>
            <dt>Browser makes WebP</dt>
            <dd>{nativeWebp == null ? "Checking…" : nativeWebp ? "Yes" : "No"}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.card} aria-labelledby="photos-title">
        <h2 id="photos-title">Photos</h2>
        <fieldset className={styles.choice}>
          <legend>What are the photos of?</legend>
          <label>
            <input
              type="radio"
              name="kind"
              checked={kind === "page"}
              onChange={() => setKind("page")}
            />{" "}
            A cookbook page or recipe card
          </label>
          <label>
            <input
              type="radio"
              name="kind"
              checked={kind === "dish"}
              onChange={() => setKind("dish")}
            />{" "}
            Food
          </label>
        </fieldset>
        <div className={styles.row}>
          <label className={styles.button} aria-disabled={working !== null}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="visually-hidden"
              disabled={working !== null}
              onChange={(event) => {
                const files = event.currentTarget.files;
                void add(files, "camera").finally(() => (event.target.value = ""));
              }}
            />
            Take a photo
          </label>
          <label className={styles.secondary} aria-disabled={working !== null}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="visually-hidden"
              disabled={working !== null}
              onChange={(event) => {
                const files = event.currentTarget.files;
                void add(files, "chosen").finally(() => (event.target.value = ""));
              }}
            />
            Choose photos
          </label>
        </div>
        {working ? (
          <p role="status" className={styles.hint}>
            {working}
          </p>
        ) : null}
        <ul className={styles.photos} aria-label="Prepared photos">
          {rows.map((row) => (
            <PhotoRow key={row.id} row={row} />
          ))}
        </ul>
      </section>

      <section className={styles.card} aria-labelledby="live-title">
        <h2 id="live-title">Live camera</h2>
        <p className={styles.hint}>
          Checks how sharp a picture from a live camera view inside a web page can be, compared with
          the phone&rsquo;s own camera above.
        </p>
        <video
          ref={video}
          className={live.state === "on" ? styles.video : "visually-hidden"}
          muted
          playsInline
          aria-label="Live camera view"
        />
        <div className={styles.row}>
          {live.state === "on" ? (
            <>
              <button type="button" className={styles.button} onClick={() => void grabFrame()}>
                Take a picture from the live view
              </button>
              <button type="button" className={styles.secondary} onClick={stopCamera}>
                Stop the camera
              </button>
            </>
          ) : (
            <button
              type="button"
              className={styles.secondary}
              disabled={live.state === "starting"}
              onClick={() => void startCamera()}
            >
              Start the live camera
            </button>
          )}
        </div>
        {live.state === "failed" ? (
          <p role="alert" className={styles.error}>
            The live camera didn&rsquo;t start: {live.error}
          </p>
        ) : null}
        {live.stream ? (
          <p role="status" className={styles.hint}>
            {liveLine(live)}
          </p>
        ) : null}
        {live.framePreview || live.stillPreview ? (
          <div className={styles.row}>
            {live.framePreview ? (
              <a
                href={live.framePreview}
                target="_blank"
                rel="noreferrer"
                className={styles.preview}
              >
                <img src={live.framePreview} alt="Picture from the live view" />
              </a>
            ) : null}
            {live.stillPreview ? (
              <a
                href={live.stillPreview}
                target="_blank"
                rel="noreferrer"
                className={styles.preview}
              >
                <img src={live.stillPreview} alt="Full photo from the live camera" />
              </a>
            ) : null}
          </div>
        ) : null}
      </section>

      {rows.length || live.stream || live.state === "failed" ? (
        <section className={styles.card} aria-labelledby="results-title">
          <h2 id="results-title">Results</h2>
          <pre className={styles.report}>{report}</pre>
          <div className={styles.row}>
            <button type="button" className={styles.button} onClick={() => void copy()}>
              Copy results
            </button>
            {copied ? (
              <span role="status" className={styles.hint}>
                Copied. Paste them into your message to Claude.
              </span>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function PhotoRow({ row }: { row: Row }) {
  if (failed(row)) {
    return (
      <li className={styles.photo}>
        <p className={styles.error}>
          {row.name} ({row.type || "unknown type"}, {kb(row.bytes)}) couldn&rsquo;t be prepared:{" "}
          {row.error}
        </p>
      </li>
    );
  }
  return (
    <li className={styles.photo}>
      {row.preview ? (
        <a href={row.preview} target="_blank" rel="noreferrer" className={styles.preview}>
          <img src={row.preview} alt={`Prepared version of ${row.name}`} />
        </a>
      ) : null}
      <pre className={styles.report}>{photoLines(row).join("\n")}</pre>
    </li>
  );
}

function photoLines(r: PhotoResult): string[] {
  const o = r.original;
  const lines = [
    `${r.name} (${r.source === "camera" ? "from the camera" : "chosen"}, treated as ${r.kind === "page" ? "a page" : "food"})`,
    `  Original: ${o.type || "unknown type"}, ${kb(o.bytes)}` +
      (o.jpeg
        ? `, ${o.jpeg.width}×${o.jpeg.height} stored, turn ${o.jpeg.orientation}, location ${o.jpeg.hasLocation ? "yes" : "no"}`
        : ""),
    `  Opened: ${r.shown.width}×${r.shown.height} in ${time(r.decodeMs)}` +
      (r.upright === null ? "" : r.upright ? ", turned upright" : ", NOT turned upright"),
    `  Resized: ${r.size.width}×${r.size.height} in ${time(r.drawMs)}`,
    `  Browser WebP: ${
      !r.canvasWebp
        ? "failed"
        : r.canvasWebp.type === "image/webp"
          ? `${kb(r.canvasWebp.bytes)} in ${time(r.canvasWebp.ms)}`
          : `not available (gave ${r.canvasWebp.type || "nothing"}, ${kb(r.canvasWebp.bytes)})`
    }`,
    `  Browser JPEG: ${r.canvasJpeg ? `${kb(r.canvasJpeg.bytes)} in ${time(r.canvasJpeg.ms)}` : "failed"}`,
    `  WebAssembly WebP: ${"error" in r.wasmWebp ? `failed (${r.wasmWebp.error})` : `${kb(r.wasmWebp.bytes)} in ${time(r.wasmWebp.ms)}`}`,
    `  Upload: ${r.keep ? "the original, as it is" : "the prepared version"}`,
  ];
  return lines;
}

function liveLine(live: LiveCamera): string {
  if (!live.stream) return "";
  const parts = [`Live view: ${live.stream.width}×${live.stream.height}`];
  if (live.frame) parts.push(`picture from it: ${live.frame.width}×${live.frame.height}`);
  if (live.still) {
    parts.push(
      "error" in live.still
        ? `full photo (ImageCapture): failed, ${live.still.error}`
        : `full photo (ImageCapture): ${live.still.width}×${live.still.height}`,
    );
  } else if (live.imageCapture === false) {
    parts.push("full photo (ImageCapture): not available");
  }
  return parts.join("; ");
}

/** Everything, as plain text to copy and send. */
function summary(input: {
  label: string;
  home: boolean;
  nativeWebp: boolean | null;
  rows: Row[];
  live: LiveCamera;
}): string {
  const lines = [
    `Fennl photo test, ${new Date().toLocaleString()}`,
    `Device: ${input.label} (${input.home ? "home screen app" : "browser tab"})`,
    `Browser makes WebP: ${input.nativeWebp == null ? "not checked" : input.nativeWebp ? "yes" : "no"}`,
  ];
  for (const row of input.rows) {
    lines.push("");
    if (failed(row)) {
      lines.push(
        `${row.name}: FAILED (${row.type || "unknown type"}, ${kb(row.bytes)}): ${row.error}`,
      );
    } else {
      lines.push(...photoLines(row));
    }
  }
  if (input.live.state === "failed") lines.push("", `Live camera: failed, ${input.live.error}`);
  else if (input.live.stream) lines.push("", liveLine(input.live));
  return lines.join("\n");
}
