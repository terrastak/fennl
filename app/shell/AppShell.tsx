import { useEffect, useRef, type ReactNode } from "react";
import { EmailNotice } from "../account/EmailNotice";
import { ActingBanner } from "../acting/ActingBanner";
import { LibraryProvider } from "../recipes/LibraryProvider";
import { navigate } from "../navigation";
import { Link } from "../router";
import { SyncNotices } from "../sync/SyncNotices";
import { SyncStatusLine } from "../sync/SyncStatusLine";
import { useTrashCount } from "../sync/useSync";
import { FloatingTimers, TimersDialog } from "../timers/Timers";
import {
  openTimers,
  openTimersFromLeft,
  timersSide,
  useSoonest,
  useView,
} from "../timers/timersView";
import styles from "./AppShell.module.css";
import {
  AccountIcon,
  FeedbackIcon,
  ImportIcon,
  RecipesIcon,
  SettingsIcon,
  TimerIcon,
  TrashIcon,
} from "./icons";
import { Library, LibrarySearch } from "./Library";
import { Logo } from "./Logo";
import { askSearchFocus } from "./typeToSearch";

interface NavItem {
  href: string;
  label: string;
  icon: () => ReactNode;
}

const RECIPES_NAV: NavItem = { href: "/", label: "Recipes", icon: RecipesIcon };
const IMPORT_NAV: NavItem = { href: "/import", label: "Import", icon: ImportIcon };
const PRIMARY_NAV: NavItem[] = [RECIPES_NAV, IMPORT_NAV];

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
 * Since U17 the sidebar holds the recipe box (search, quick lists, saved searches, categories),
 * with Import, Timers and Trash (U21) just above Send feedback, Settings and Account.
 */
export function AppShell(props: AppShellProps) {
  return (
    <LibraryProvider>
      <Frame {...props} />
    </LibraryProvider>
  );
}

function Frame({ path, title, children }: AppShellProps) {
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
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
      // The left panel's box on a computer; on a phone the recipe list's own, opening the list
      // from another page (U17: the Recipes tab is where a phone searches).
      const box = [...document.querySelectorAll<HTMLInputElement>("[data-type-to-search]")].find(
        (el) => el.getClientRects().length > 0,
      );
      if (box) box.focus();
      else {
        askSearchFocus();
        navigate("/");
      }
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
    // Typing in the left panel's search box from another page opens the recipe list: the
    // typing carries on there.
    if (document.activeElement?.hasAttribute("data-shell-search")) return;
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
        <div className={styles.sideTop}>
          <div className={styles.brandRow}>
            <Link href="/" className={styles.logoLink} aria-label="Fennl, go to recipes">
              <Logo />
            </Link>
            <SyncStatusLine className={styles.sideStatus} />
          </div>
          <LibrarySearch />
        </div>
        <Library />
        <nav aria-label="Main" className={styles.sideNav}>
          <ul className={styles.navList}>
            <NavLink item={IMPORT_NAV} path={path} />
            <li>
              <TimersButton className={styles.navLink} />
            </li>
            <TrashLink path={path} />
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
          <Logo compact />
        </Link>
        <SyncStatusLine className={styles.topStatus} />
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
        <EmailNotice />
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
  const view = useView();
  const label = count > 0 ? `Timers, ${count} ${count === 1 ? "timer" : "timers"}` : "Timers";
  // The left panel's Timers opens the panel beside it, and shows as chosen while it's open (U24).
  const open = !compact && view !== null && view.kind !== "start" && timersSide() === "left";
  return (
    <button
      type="button"
      className={[className, ringing ? styles.timersRinging : "", open ? styles.timersOpen : ""]
        .filter(Boolean)
        .join(" ")}
      aria-haspopup="dialog"
      aria-label={label}
      onClick={compact ? openTimers : openTimersFromLeft}
    >
      <TimerIcon />
      {compact ? (
        // On a phone the icon has its name under it (U17 mockup), or the soonest one's time.
        text || ringing ? (
          <span className={styles.timerTime}>{ringing ? "Done!" : text}</span>
        ) : (
          <span className={styles.topBarLabel}>Timers</span>
        )
      ) : (
        <>
          Timers
          {count > 0 ? <span className={styles.timerCount}>{count}</span> : null}
        </>
      )}
    </button>
  );
}

/**
 * Trash in the left panel (U21, moved from the recipe list's ⋯), with how many recipes are in it.
 * A phone keeps Trash in the ⋯ menu.
 */
function TrashLink({ path }: { path: string }) {
  const count = useTrashCount();
  return (
    <li>
      <Link
        href="/trash"
        className={styles.navLink}
        aria-current={path === "/trash" ? "page" : undefined}
        // Said as the left panel's rows say their counts ("Trash, 3 recipes").
        aria-label={count ? `Trash, ${count} ${count === 1 ? "recipe" : "recipes"}` : undefined}
      >
        <TrashIcon />
        Trash
        {count ? (
          <span className={styles.navCount} aria-hidden="true">
            {count}
          </span>
        ) : null}
      </Link>
    </li>
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
