import { LaptopIcon } from "../recipes/LaptopIcon";
import { LAPTOP_ICONS } from "../recipes/laptopIcons";
import styles from "./import.module.css";

// The Import page's sources on a laptop (U23 slice 6): each source is a row of one white box, an
// icon at its start and a quiet button with a small arrow out of a tray at its end. These pieces
// are drawn on a laptop only, so phones look as before.

/** A source's icon at the start of its row. */
export function SourceIcon({ path }: { path: string }) {
  return (
    <span className={styles.sourceIcon} aria-hidden="true">
      <LaptopIcon path={path} />
    </span>
  );
}

/** The small arrow out of a tray before a source's button. */
export function UploadIcon() {
  return <LaptopIcon path={LAPTOP_ICONS.upload} />;
}
