import { useEffect, useRef, useState } from "react";
import {
  featuresOf,
  setTorch,
  setZoom,
  startCamera,
  stopCamera,
  takePicture,
  type CameraFeatures,
} from "./camera";
import { looksBlurry } from "./sharpness";
import styles from "./scan.module.css";

// The live camera, scanner style (phase E9; spec.md E9, step 1): photograph page after page, then
// Done. Each picture's sharpness is checked at once, with "This one looks blurry. Retake?". An
// outline shows where to put the page, which keeps the phone back from the page (too close and
// the lens can't focus). The torch starts off; a 2× zoom is offered where the camera has it, to
// stand further back.

export interface TakenPage {
  id: string;
  sharpness: number | null;
}

export function CameraView({
  count,
  max,
  onTaken,
  onRetake,
  onDone,
  onFailed,
}: {
  /** Pages so far. */
  count: number;
  /** The most pages one recipe takes. */
  max: number;
  /** A picture was taken: added as a page. Null when it couldn't be used. */
  onTaken(picture: Blob): Promise<TakenPage | null>;
  /** The person wants to take that page again: it's removed. */
  onRetake(id: string): void;
  onDone(): void;
  /** The camera didn't start (no permission, no camera, a browser that won't). */
  onFailed(reason: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const shutter = useRef<HTMLButtonElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [features, setFeatures] = useState<CameraFeatures>({ torch: false, zoom: null });
  const [torch, setTorchOn] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blurry, setBlurry] = useState<TakenPage | null>(null);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    let live = true;
    void startCamera()
      .then(async (media) => {
        if (!live) {
          stopCamera(media);
          return;
        }
        stream.current = media;
        const track = media.getVideoTracks()[0];
        if (track) setFeatures(featuresOf(track));
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play().catch(() => undefined);
        }
        setReady(true);
        shutter.current?.focus();
      })
      .catch((error: unknown) => {
        if (live) onFailed(error instanceof Error ? error.name : "failed");
      });
    return () => {
      live = false;
      stopCamera(stream.current);
      stream.current = null;
    };
    // Started once, when the camera opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const track = () => stream.current?.getVideoTracks()[0] ?? null;

  const take = async () => {
    const t = track();
    if (!t || !video.current || busy) return;
    setBusy(true);
    setBlurry(null);
    try {
      const picture = await takePicture(t, video.current);
      // Some cameras let the torch go out for the photo: put it back as it was.
      if (torch) void setTorch(t, true);
      const page = await onTaken(picture);
      if (!page) {
        setAnnounce("That picture couldn't be used. Please take it again.");
      } else if (looksBlurry(page.sharpness)) {
        setBlurry(page);
      } else {
        setAnnounce(`Page ${count + 1} taken.`);
      }
    } catch {
      setAnnounce("That picture couldn't be taken. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggleTorch = async () => {
    const t = track();
    if (t && (await setTorch(t, !torch))) setTorchOn(!torch);
  };

  const toggleZoom = async () => {
    const t = track();
    const range = features.zoom;
    if (!t || !range) return;
    const next = zoomed ? Math.max(1, range.min) : Math.min(2, range.max);
    if (await setZoom(t, next)) setZoomed(!zoomed);
  };

  const retake = () => {
    if (!blurry) return;
    onRetake(blurry.id);
    setBlurry(null);
    setAnnounce("Removed. Take it again when you're ready.");
    shutter.current?.focus();
  };

  return (
    <dialog
      ref={dialog}
      className={styles.camera}
      aria-labelledby="camera-title"
      onCancel={(event) => {
        event.preventDefault();
        onDone();
      }}
    >
      <div className={styles.cameraBar}>
        <h2 id="camera-title" className={styles.cameraTitle}>
          Photograph the pages
        </h2>
        <div className={styles.cameraTools}>
          {features.torch ? (
            <button
              type="button"
              className={styles.cameraButton}
              aria-pressed={torch}
              onClick={() => void toggleTorch()}
            >
              Light
            </button>
          ) : null}
          {features.zoom && features.zoom.max >= 1.5 ? (
            <button
              type="button"
              className={styles.cameraButton}
              aria-pressed={zoomed}
              onClick={() => void toggleZoom()}
            >
              2× zoom
            </button>
          ) : null}
        </div>
      </div>

      <div className={styles.viewfinder}>
        <video ref={video} className={styles.video} muted playsInline aria-label="Camera view" />
        <div className={styles.guide} aria-hidden="true" />
        {!ready ? (
          <p role="status" className={styles.cameraStatus}>
            Starting the camera…
          </p>
        ) : null}
      </div>

      <p className={styles.cameraTip}>
        Fit the page inside the frame, in good light, and hold still. Take each side or page in
        turn.
      </p>

      {blurry ? (
        <div role="alert" className={styles.blurry}>
          <p>This one looks blurry. Retake?</p>
          <div className={styles.cameraTools}>
            <button type="button" className={styles.cameraButton} onClick={retake}>
              Retake
            </button>
            <button
              type="button"
              className={styles.cameraButton}
              onClick={() => {
                setBlurry(null);
                shutter.current?.focus();
              }}
            >
              Keep it
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.cameraControls}>
        <p className={styles.cameraCount} aria-live="polite">
          {count === 0 ? "No pages yet" : count === 1 ? "1 page" : `${count} pages`}
          {count >= max ? ", as many as one recipe takes" : ""}
        </p>
        <button
          ref={shutter}
          type="button"
          className={styles.shutter}
          disabled={!ready || busy || count >= max}
          onClick={() => void take()}
        >
          <span className="visually-hidden">Take photo</span>
        </button>
        <button type="button" className={styles.cameraDone} onClick={onDone}>
          Done
        </button>
      </div>
      <p role="status" className="visually-hidden">
        {announce}
      </p>
    </dialog>
  );
}
