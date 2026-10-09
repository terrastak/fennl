import type { PhotoSize } from "./cache";
import styles from "./photos.module.css";
import { usePhotoUrl } from "./usePhoto";

/**
 * A recipe photo (phase D2). Its box keeps the photo's shape while it loads, so the page doesn't
 * jump; if it can't be shown (offline and not kept here), the box says so quietly.
 */
export function PhotoImage({
  hash,
  size,
  width,
  height,
  alt,
  className,
  fit = "cover",
}: {
  hash: string;
  size: PhotoSize;
  width: number;
  height: number;
  /** Empty for a photo that only decorates (the list's covers). */
  alt: string;
  className?: string | undefined;
  fit?: "cover" | "contain";
}) {
  const url = usePhotoUrl(hash, size);
  const shape = { aspectRatio: `${width} / ${height}` };
  if (url === "failed") {
    return (
      <span
        className={`${styles.missing} ${className ?? ""}`}
        style={shape}
        role={alt ? "img" : undefined}
        aria-label={alt ? `${alt} (not available offline)` : undefined}
      >
        {alt ? "Photo not available offline" : null}
      </span>
    );
  }
  if (!url)
    return (
      <span className={`${styles.loading} ${className ?? ""}`} style={shape} aria-hidden="true" />
    );
  return (
    <img
      src={url}
      alt={alt}
      width={width}
      height={height}
      className={`${styles.image} ${fit === "contain" ? styles.contain : ""} ${className ?? ""}`}
    />
  );
}
