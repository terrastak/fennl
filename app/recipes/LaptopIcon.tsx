import styles from "./recipes.module.css";

/**
 * A small icon shown only on a laptop (U23), beside words that say the same thing; hidden from
 * screen readers, and not drawn at all elsewhere, so phones look as before.
 */
export function LaptopIcon({
  path,
  fill = false,
  className,
}: {
  path: string;
  fill?: boolean;
  /** More classes (a colour, a turn) beside the shared size. */
  className?: string | undefined;
}) {
  return (
    <svg
      className={`${styles.laptopIcon} ${className ?? ""}`}
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
