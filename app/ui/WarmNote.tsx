import type { ReactNode, Ref } from "react";
import ui from "./ui.module.css";

// The shared warning (U23, owner's choice 2026-11-07): one soft warm note, a pale warm fill, a
// coloured icon and dark text ("Editing is paused until this device is back online…"). On a laptop
// every screen draws it the same way (ui.module.css); phones, touch screens and narrow windows keep
// the screen's own look, passed in as `className`, so moving onto it changes nothing there.

export function WarmNote({
  children,
  className,
  role,
  tabIndex,
  ref,
}: {
  children: ReactNode;
  /** The screen's own look on phones (and its margins everywhere). */
  className?: string | undefined;
  role?: "status" | "alert" | undefined;
  tabIndex?: number | undefined;
  ref?: Ref<HTMLParagraphElement> | undefined;
}) {
  return (
    <p className={`${ui.warmNote} ${className ?? ""}`} role={role} tabIndex={tabIndex} ref={ref}>
      <svg className={ui.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 2 20h20zM12 10v4M12 17h.01" />
      </svg>
      <span>{children}</span>
    </p>
  );
}
