import { ADMIN_ICONS, type AdminIconName } from "./adminIcons";
import styles from "./admin.module.css";

// The admin console's small icons on a laptop (U23): beside words that say the same thing, hidden
// from screen readers, and not drawn at all elsewhere (admin.module.css), so phones look as before.

export function AdminIcon({
  name,
  className,
}: {
  name: AdminIconName;
  /** More classes (a colour) beside the shared size. */
  className?: string | undefined;
}) {
  return (
    <svg
      className={`${styles.icon} ${className ?? ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ADMIN_ICONS[name]} />
    </svg>
  );
}
