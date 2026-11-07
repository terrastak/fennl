import type { ReactNode, Ref } from "react";
import ui from "./ui.module.css";

// The shared warning (U23, owner's choice 2026-11-07): one soft warm note, a pale warm fill, a
// coloured icon and dark text ("Editing is paused until this device is back online…"). On a laptop
// every screen draws it the same way (ui.module.css); phones, touch screens and narrow windows keep
// the screen's own look, passed in as `className`, so moving onto it changes nothing there.
//
// With a `title` it is a section with a heading and whatever follows (the review screen's "Worth
// checking" and its list): the heading and the rest sit straight in the section elsewhere, as if
// the note weren't there.

export function WarmNote({
  children,
  className,
  role,
  tabIndex,
  ref,
  title,
  titleId,
  titleClassName,
}: {
  children: ReactNode;
  /** The screen's own look on phones (and its margins everywhere). */
  className?: string | undefined;
  role?: "status" | "alert" | undefined;
  tabIndex?: number | undefined;
  ref?: Ref<HTMLParagraphElement> | undefined;
  /** A heading: the note is then a section named by it, holding `children` under it. */
  title?: string | undefined;
  /** The heading's id (the section is labelled by it). */
  titleId?: string | undefined;
  /** The heading's own look on phones. */
  titleClassName?: string | undefined;
}) {
  const icon = (
    <svg className={ui.icon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 2 20h20zM12 10v4M12 17h.01" />
    </svg>
  );
  if (title !== undefined) {
    return (
      <section className={`${ui.warmNote} ${className ?? ""}`} aria-labelledby={titleId}>
        {icon}
        <div className={ui.warmBody}>
          <h2 id={titleId} className={titleClassName}>
            {title}
          </h2>
          {children}
        </div>
      </section>
    );
  }
  return (
    <p className={`${ui.warmNote} ${className ?? ""}`} role={role} tabIndex={tabIndex} ref={ref}>
      {icon}
      <span>{children}</span>
    </p>
  );
}
