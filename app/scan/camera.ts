// The live camera for photographing pages (phase E9; spec.md E9, step 1). A camera view inside
// Fennl, so page after page can be photographed in one go (a phone's own camera, opened from a
// page, hands back one photo each time). Each picture is a real photo where the browser can take
// one (ImageCapture's takePhoto: on an iPhone 18 Pro in Safari, 12 MP and sharper than a frame of
// the live view, docs/research/2026-10-09-photo-trial.md), else a frame of the view. The torch and
// zoom are offered where the camera has them; the torch starts off (glare on glossy pages).

/** The camera features a page shot can use, where the browser and camera allow them. */
export interface CameraFeatures {
  torch: boolean;
  /** The zoom range; null when it can't be set. */
  zoom: { min: number; max: number } | null;
}

interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}
type ImageCaptureClass = new (track: MediaStreamTrack) => ImageCaptureLike;

/** Capabilities the TypeScript library doesn't list yet. */
interface CameraCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  zoom?: { min: number; max: number; step?: number };
}

export function cameraAvailable(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Starts the back camera, as large as it goes (a page's small writing needs every pixel). */
export function startCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 4096 },
      height: { ideal: 3072 },
    },
    audio: false,
  });
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function featuresOf(track: MediaStreamTrack): CameraFeatures {
  const capabilities = (track.getCapabilities?.() ?? {}) as CameraCapabilities;
  const zoom = capabilities.zoom;
  return {
    torch: capabilities.torch === true,
    zoom: zoom && zoom.max > zoom.min ? { min: zoom.min, max: zoom.max } : null,
  };
}

/** Turns the torch on or off. False when the camera wouldn't. */
export async function setTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

/** Sets the zoom (1 is none). False when the camera wouldn't. */
export async function setZoom(track: MediaStreamTrack, zoom: number): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

/** A frame of the live view, as a JPEG. */
async function frameOf(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")?.drawImage(video, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.95),
  );
  canvas.width = 1;
  canvas.height = 1;
  if (!blob) throw new Error("The camera picture couldn't be saved.");
  return blob;
}

/**
 * Takes a picture: a real photo where the browser can (focus settles for it, and it has the
 * camera's full size), else a frame of the live view.
 */
export async function takePicture(track: MediaStreamTrack, video: HTMLVideoElement): Promise<Blob> {
  const Capture = (window as Window & { ImageCapture?: ImageCaptureClass }).ImageCapture;
  if (Capture) {
    try {
      return await new Capture(track).takePhoto();
    } catch {
      // Some cameras refuse while the view is changing: a frame instead.
    }
  }
  return frameOf(video);
}
