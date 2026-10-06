import { useState } from "react";
import type { DeviceSummary } from "../../shared/devices";
import { AuthHeader } from "../auth/AuthLayout";
import { authClient } from "../auth/client";
import { FormError } from "../auth/fields";
import { navigate } from "../navigation";
import { lastUsed } from "./lastUsed";
import styles from "../auth/auth.module.css";

/**
 * Shown instead of the app when the household is already using all the devices its plan allows.
 * Taking over is instant, with no waiting period (CLAUDE.md, "Tables").
 */
export function TakeoverScreen({
  max,
  devices,
  takeOver,
}: {
  max: number;
  devices: DeviceSummary[];
  takeOver: (signOut?: string[]) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (signOut?: string[]) => {
    setBusy(true);
    setError(null);
    const done = await takeOver(signOut);
    setBusy(false);
    if (!done) setError("That didn't work. Please wait a moment and try again.");
  };

  const signOut = async () => {
    setBusy(true);
    await authClient.signOut();
    navigate("/sign-in", { replace: true });
  };

  const other = devices[0];
  return (
    <>
      {max === 1 ? (
        <AuthHeader title="Use Fennl on this device?">
          <p>
            Your plan includes one device at a time
            {other ? (
              <>
                , and Fennl is open on <strong>{other.label}</strong> (last used{" "}
                {lastUsed(other.lastSeenAt)})
              </>
            ) : null}
            . Using it here signs that device out. Your recipes are stored in your account, so
            nothing is lost.
          </p>
        </AuthHeader>
      ) : (
        <AuthHeader title="Choose a device to sign out">
          <p>
            Your plan includes up to {max} devices at once, and they&rsquo;re all in use. Sign one
            out to use Fennl here. Your recipes are stored in your account, so nothing is lost.
          </p>
        </AuthHeader>
      )}
      <FormError message={error} />
      {max === 1 ? (
        <div className={styles.form}>
          <button
            type="button"
            className={styles.button}
            onClick={() => void run()}
            disabled={busy}
          >
            Use Fennl on this device
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={signOut}
            disabled={busy}
          >
            Sign out here instead
          </button>
        </div>
      ) : (
        <div className={styles.form}>
          <ul className={styles.deviceList}>
            {devices.map((d) => (
              <li key={d.id}>
                <span>
                  <strong>{d.label}</strong>
                  <br />
                  Last used {lastUsed(d.lastSeenAt)}
                </span>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void run([d.id])}
                  disabled={busy}
                >
                  Sign out {d.label}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={signOut}
            disabled={busy}
          >
            Sign out here instead
          </button>
        </div>
      )}
    </>
  );
}
