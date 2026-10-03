import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "../router";
import { Logo } from "../shell/Logo";
import styles from "./auth.module.css";

interface AuthLayoutProps {
  path: string;
  title: string;
  children: ReactNode;
}

/** The frame for sign-in and the other account screens: the logo and one centered card. */
export function AuthLayout({ path, title, children }: AuthLayoutProps) {
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    document.title = `${title} · Fennl`;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Same as the main app: after switching screens, start at the new heading.
    const heading = mainRef.current?.querySelector<HTMLElement>("h1");
    (heading ?? mainRef.current)?.focus();
  }, [path, title]);

  return (
    <div className={styles.page}>
      <header className={styles.brand}>
        <Link href="/sign-in" className={styles.brandLink} aria-label="Fennl">
          <Logo />
        </Link>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className={styles.main}>
        <div className={styles.card}>{children}</div>
        <p className={styles.note}>
          Your recipes are stored in your Fennl account. This browser keeps a temporary copy for
          speed.
        </p>
      </main>
    </div>
  );
}

interface AuthHeaderProps {
  title: string;
  note?: string;
  children?: ReactNode;
}

/** Title block for an account screen, with an optional handwritten note above it. */
export function AuthHeader({ title, note, children }: AuthHeaderProps) {
  return (
    <div className={styles.header}>
      {note ? <p className="hand-note">{note}</p> : null}
      <h1 tabIndex={-1} className={styles.title}>
        {title}
      </h1>
      {children ? <div className={styles.lead}>{children}</div> : null}
    </div>
  );
}
