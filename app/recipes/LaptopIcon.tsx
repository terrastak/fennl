import styles from "./recipes.module.css";

/**
 * A small icon shown only on a laptop (U23), beside words that say the same thing; hidden from
 * screen readers, and not drawn at all elsewhere, so phones look as before.
 */
export function LaptopIcon({ path, fill = false }: { path: string; fill?: boolean }) {
  return (
    <svg
      className={styles.laptopIcon}
      viewBox="0 0 24 24"
      fill={fill ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={fill ? 1.5 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
