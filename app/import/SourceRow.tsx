import type { ReactNode } from "react";
import { LaptopIcon } from "../recipes/LaptopIcon";
import { LAPTOP_ICONS } from "../recipes/laptopIcons";
import styles from "./import.module.css";

// The Import page's sources on a laptop (U23 slice 6): each source has an icon and a quiet button
// with a small arrow out of a tray. Since U24 (owner's request 2026-11-08) each source is a card
// in a grid that grows with the window, and what a source opens spans the grid's width right
// under that card, the cards after it following below. These pieces are drawn on a laptop only,
// so phones look as before.

/**
 * A source's own parts (its icon, name, explanation and button): a card on a laptop. Elsewhere it
 * adds nothing (display: contents), so phones look as before.
 */
export function SourceCard({ children }: { children: ReactNode }) {
  return <div className={styles.sourceCard}>{children}</div>;
}

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
