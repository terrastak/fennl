import type { ReactNode } from "react";
import styles from "./pages.module.css";

interface PageHeaderProps {
  title: string;
  /** Optional handwritten note tucked above the title (see docs/design/design-direction.md). */
  note?: string;
  children?: ReactNode;
}

/** Page title block. The heading takes focus after navigation (see AppShell). */
export function PageHeader({ title, note, children }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      {note ? <p className="hand-note">{note}</p> : null}
      <h1 tabIndex={-1} className={styles.title}>
        {title}
      </h1>
      {children ? <div className={styles.intro}>{children}</div> : null}
    </header>
  );
}
