import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "../router";
import { SyncNotices } from "../sync/SyncNotices";
import { SyncStatusLine } from "../sync/SyncStatusLine";
import styles from "./AppShell.module.css";
import { AccountIcon, FeedbackIcon, ImportIcon, RecipesIcon, SettingsIcon } from "./icons";
import { Logo } from "./Logo";

interface NavItem {
  href: string;
  label: string;
  icon: () => ReactNode;
}

const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Recipes", icon: RecipesIcon },
  { href: "/import", label: "Import", icon: ImportIcon },
];

const SECONDARY_NAV: NavItem[] = [
  { href: "/settings", label: "Settings", icon: SettingsIcon },
  { href: "/account", label: "Account", icon: AccountIcon },
];

const FEEDBACK_PATH = "/feedback";

/** The feedback page, told which page the person was on (phase B8). */
function feedbackHref(path: string): string {
  return path === FEEDBACK_PATH
    ? FEEDBACK_PATH
    : `${FEEDBACK_PATH}?from=${encodeURIComponent(path)}`;
}

interface AppShellProps {
  path: string;
  title: string;
  children: ReactNode;
}

/**
 * The frame around every page: a sidebar on wide screens, a top bar and bottom tabs on phones.
 * Only one navigation is visible at a time (CSS hides the other), so screen readers see one.
 */
export function AppShell({ path, title, children }: AppShellProps) {
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    document.title = `${title} · Fennl`;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // After switching pages, move focus to the new page's heading so keyboard and
    // screen-reader users start at the top of the new content.
    const heading = mainRef.current?.querySelector<HTMLElement>("h1");
    (heading ?? mainRef.current)?.focus();
  }, [path, title]);

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>

      <aside className={styles.sidebar}>
        <Link href="/" className={styles.logoLink} aria-label="Fennl, go to recipes">
          <Logo />
        </Link>
        <SyncStatusLine className={styles.sideStatus} />
        <nav aria-label="Main" className={styles.sideNav}>
          <ul className={styles.navList}>
            {PRIMARY_NAV.map((item) => (
              <NavLink key={item.href} item={item} path={path} />
            ))}
          </ul>
          <ul className={`${styles.navList} ${styles.navListBottom}`}>
            <li>
              <Link
                href={feedbackHref(path)}
                className={styles.navLink}
                aria-current={path === FEEDBACK_PATH ? "page" : undefined}
              >
                <FeedbackIcon />
                Send feedback
              </Link>
            </li>
            {SECONDARY_NAV.map((item) => (
              <NavLink key={item.href} item={item} path={path} />
            ))}
          </ul>
        </nav>
      </aside>

      <header className={styles.topBar}>
        <Link href="/" className={styles.logoLink} aria-label="Fennl, go to recipes">
          <Logo />
        </Link>
        <SyncStatusLine className={styles.topStatus} />
        <Link
          href={feedbackHref(path)}
          className={styles.topBarLink}
          aria-current={path === FEEDBACK_PATH ? "page" : undefined}
        >
          <FeedbackIcon />
          Feedback
        </Link>
      </header>

      <main id="main" ref={mainRef} tabIndex={-1} className={styles.main}>
        <SyncNotices />
        {children}
      </main>

      <nav aria-label="Main" className={styles.tabBar}>
        <ul className={styles.tabList}>
          {[...PRIMARY_NAV, ...SECONDARY_NAV].map((item) => {
            const current = isCurrent(item.href, path);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={styles.tab}
                  aria-current={current ? "page" : undefined}
                >
                  <Icon />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function NavLink({ item, path }: { item: NavItem; path: string }) {
  const current = isCurrent(item.href, path);
  const Icon = item.icon;
  return (
    <li>
      <Link href={item.href} className={styles.navLink} aria-current={current ? "page" : undefined}>
        <Icon />
        {item.label}
      </Link>
    </li>
  );
}

function isCurrent(href: string, path: string): boolean {
  // Recipe pages belong to Recipes.
  if (href === "/") return path === "/" || path.startsWith("/recipes/");
  return path === href || path.startsWith(`${href}/`);
}
