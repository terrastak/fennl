import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import styles from "./auth.module.css";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  /** Shown on the label's right, for example "Forgot password?". */
  aside?: ReactNode;
};

/** A labelled text field. The hint is read out with the field. */
export function Field({ label, hint, aside, ...input }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        {aside}
      </div>
      <input
        id={id}
        className={styles.input}
        aria-describedby={hint ? hintId : undefined}
        {...input}
      />
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A message that screen readers announce as soon as it appears. */
export function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className={styles.error}>
      {message}
    </p>
  ) : null;
}

export function FormNotice({ message }: { message: string | null }) {
  return message ? (
    <p role="status" className={styles.notice}>
      {message}
    </p>
  ) : null;
}
