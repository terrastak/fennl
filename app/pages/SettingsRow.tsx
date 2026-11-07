import { useId, type ReactNode } from "react";
import { usePointer } from "../recipes/usePointer";
import styles from "./SettingsPage.module.css";

/**
 * Settings on a laptop (U23): each section is one white box of rows, the setting's name and a
 * short explanation on the left and its control on the right. Phones, touch screens and windows
 * under 900px keep the page as it was: a heading per setting with its control underneath.
 */
export function SettingsBox({ children }: { children: ReactNode }) {
  return usePointer() ? <div className={styles.box}>{children}</div> : <>{children}</>;
}

interface RowProps {
  /** The setting's name. */
  name: ReactNode;
  /** Its explanation, under the name. */
  help?: ReactNode;
  /** The control, on the right. */
  children?: ReactNode;
  /** A tall control, or several lines of explanation: the control lines up with the name. */
  top?: boolean | undefined;
  /** A group of choices (radios): the name names the group. */
  group?: boolean | undefined;
  /** The name is the label of this field (a switch). */
  labelFor?: string | undefined;
}

/** One row of a laptop's settings box. */
export function SettingsRow({ name, help, children, top, group, labelFor }: RowProps) {
  const nameId = useId();
  return (
    <div
      className={`${styles.row} ${top ? styles.rowTop : ""}`}
      role={group ? "radiogroup" : undefined}
      aria-labelledby={group ? nameId : undefined}
    >
      <div className={styles.rowText}>
        {labelFor ? (
          <label className={styles.rowName} id={nameId} htmlFor={labelFor}>
            {name}
          </label>
        ) : (
          <p className={styles.rowName} id={nameId}>
            {name}
          </p>
        )}
        {help}
      </div>
      {children !== undefined ? <div className={styles.rowControl}>{children}</div> : null}
    </div>
  );
}

/** A small icon for a row's button or status, beside words that say the same thing. */
export function RowIcon({ path, className }: { path: string; className?: string | undefined }) {
  return (
    <svg
      className={className ?? styles.rowIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

export const CHECK = "m5 12.5 4.5 4.5L19 7.5";
export const PEN = "M4 20h4L19 9l-4-4L4 16z";
export const CHEVRON = "m9 6 6 6-6 6";
export const DOWNLOAD = "M12 4v11m-5-5 5 5 5-5M5 20h14";

/** A status word with a dot before it: green when all is well (the words say it too). */
export function StatusDot({ tone }: { tone: "ok" | "busy" | "waiting" | "problem" }) {
  return <span className={styles.dot} data-tone={tone} aria-hidden="true" />;
}
