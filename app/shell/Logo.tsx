import styles from "./Logo.module.css";

/** Working logo from A4: a fennel frond in an accent-colored circle, plus the wordmark. */
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true" focusable="false">
      <circle cx="17" cy="17" r="17" fill="var(--color-accent)" />
      <path
        d="M17 26V12M17 16l-5-6M17 16l5-6M17 20l-4-3M17 20l4-3"
        stroke="var(--color-on-accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** `compact`: the phone's top bar, a little smaller (U17 mockup) so the status fits beside it. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? `${styles.logo} ${styles.compact}` : styles.logo}>
      <LogoMark size={compact ? 28 : 34} />
      <span className={styles.wordmark}>Fennl</span>
    </span>
  );
}
