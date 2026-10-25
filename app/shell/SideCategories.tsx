import { useSyncExternalStore } from "react";
import { ADDRESS_EVENT, NAVIGATE_EVENT } from "../navigation";
import { Link } from "../router";
import { useCategoryTree } from "../sync/useSync";
import styles from "./AppShell.module.css";

// The categories in the sidebar on a wide screen (owner's choice 2026-10-25): one click shows a
// category's recipes from any screen. On a phone they're in the recipe list's Filters.

function subscribe(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATE_EVENT, listener);
  window.addEventListener(ADDRESS_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATE_EVENT, listener);
    window.removeEventListener(ADDRESS_EVENT, listener);
  };
}

/** The category the recipe list is showing (its key: the path in lower case), or "". */
function useShownCategory(): string {
  return useSyncExternalStore(
    subscribe,
    () =>
      window.location.pathname === "/"
        ? (new URLSearchParams(window.location.search).get("category") ?? "").toLocaleLowerCase()
        : "",
    () => "",
  );
}

export function SideCategories() {
  const tree = useCategoryTree();
  const shown = useShownCategory();
  if (!tree || tree.nodes.length === 0) return null;
  return (
    // Part of the sidebar's navigation, not a landmark of its own (pages have a "Categories" too).
    <div className={styles.sideCategories}>
      <p className={styles.sideHeading}>Categories</p>
      <ul className={styles.sideCategoryList}>
        {tree.nodes.map((node) => (
          <li key={node.key}>
            <Link
              href={`/?category=${encodeURIComponent(node.path)}`}
              className={styles.sideCategory}
              style={{ paddingLeft: `calc(var(--space-3) + ${node.depth} * var(--space-4))` }}
              aria-current={shown === node.key ? "page" : undefined}
            >
              {node.name}
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/categories" className={styles.sideEdit}>
        Edit categories
      </Link>
    </div>
  );
}
