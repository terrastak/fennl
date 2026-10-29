import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActingBanner } from "../acting/ActingBanner";
import { Link } from "../router";
import { SyncNotices } from "../sync/SyncNotices";
import { SyncStatusLine } from "../sync/SyncStatusLine";
import { FloatingTimers, TimersDialog } from "../timers/Timers";
import { openTimers, useSoonest } from "../timers/timersView";
import styles from "./AppShell.module.css";
import {
  AccountIcon,
  FeedbackIcon,
  ImportIcon,
  RecipesIcon,
  SearchIcon,
  SettingsIcon,
  TimerIcon,
} from "./icons";
import { Logo } from "./Logo";
import { ShellSearch } from "./ShellSearch";

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
  // The phone's search field, opened from the top bar.
  const [searchOpen, setSearchOpen] = useState(false);

  // "/" jumps to search from anywhere that isn't a place you type (phase C13c).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      const side = document.querySelector<HTMLInputElement>('[data-shell-search="side"]');
      if (side && side.getClientRects().length > 0) side.focus();
      else setSearchOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        <ShellSearch variant="side" />
        <nav aria-label="Main" className={styles.sideNav}>
          <ul className={styles.navList}>
            {PRIMARY_NAV.map((item) => (
              <NavLink key={item.href} item={item} path={path} />
            ))}
            <li>
              <TimersButton className={styles.navLink} />
            </li>
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
        <button
          type="button"
          className={styles.topSearchButton}
          aria-expanded={searchOpen}
          onClick={() => setSearchOpen(!searchOpen)}
        >
          <SearchIcon />
          <span className="visually-hidden">Search</span>
        </button>
        {searchOpen ? <ShellSearch variant="top" onDone={() => setSearchOpen(false)} /> : null}
        <TimersButton className={styles.topTimers} compact />
        <Link
          href={feedbackHref(path)}
          className={styles.topBarLink}
          aria-current={path === FEEDBACK_PATH ? "page" : undefined}
        >
          <FeedbackIcon />
          <span className={styles.topBarLabel}>Feedback</span>
        </Link>
      </header>

      <main id="main" ref={mainRef} tabIndex={-1} className={styles.main}>
        <ActingBanner />
        <SyncNotices />
        {children}
      </main>

      <FloatingTimers />
      <TimersDialog />

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

/**
 * Timers (U9): in the sidebar, with how many there are; in a phone's top bar, the ⏱ with the
 * soonest one's time left.
 */
function TimersButton({
  className,
  compact = false,
}: {
  className: string | undefined;
  compact?: boolean;
}) {
  const { count, text, ringing } = useSoonest();
  const label = count > 0 ? `Timers, ${count} ${count === 1 ? "timer" : "timers"}` : "Timers";
  return (
    <button
      type="button"
      className={ringing ? `${className} ${styles.timersRinging}` : className}
      aria-haspopup="dialog"
      aria-label={label}
      onClick={openTimers}
    >
      <TimerIcon />
      {compact ? (
        text ? (
          <span className={styles.timerTime}>{ringing ? "Done!" : text}</span>
        ) : ringing ? (
          <span className={styles.timerTime}>Done!</span>
        ) : null
      ) : (
        <>
          Timers
          {count > 0 ? <span className={styles.timerCount}>{count}</span> : null}
        </>
      )}
    </button>
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
  // Recipe pages, categories and Trash belong to Recipes.
  if (href === "/") {
    return (
      path === "/" ||
      path.startsWith("/recipes/") ||
      path === "/categories" ||
      path === "/trash" ||
      path === "/duplicates"
    );
  }
  return path === href || path.startsWith(`${href}/`);
}
