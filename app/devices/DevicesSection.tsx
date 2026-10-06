import { useCallback, useEffect, useState } from "react";
import type { DeviceList } from "../../shared/devices";
import { deviceId } from "./deviceId";
import { lastUsed } from "./lastUsed";
import styles from "./devices.module.css";

/** Settings › Devices: where Fennl is signed in, with "Sign out" for the others. */
export function DevicesSection() {
  const [list, setList] = useState<DeviceList | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/devices?current=${encodeURIComponent(deviceId())}`);
      if (!res.ok) throw new Error(String(res.status));
      setList((await res.json()) as DeviceList);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/devices?current=${encodeURIComponent(deviceId())}`)
      .then((res) => (res.ok ? (res.json() as Promise<DeviceList>) : Promise.reject(res)))
      .then((body) => {
        if (!cancelled) setList(body);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async (id: string, label: string) => {
    setBusy(id);
    setMessage(null);
    const res = await fetch(`/api/devices/${encodeURIComponent(id)}/sign-out`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: deviceId() }),
    }).catch(() => null);
    setBusy(null);
    setMessage(res?.ok ? `Signed out ${label}.` : `Couldn't sign out ${label}. Try again.`);
    await load();
  };

  return (
    <section aria-labelledby="devices-title" className={styles.section}>
      <h2 id="devices-title">Devices</h2>
      {list ? (
        <p className={styles.help}>
          {list.max === null
            ? "Your plan has no device limit."
            : list.max === 1
              ? "Your plan includes one device at a time. Opening Fennl on another device asks to sign this one out."
              : `Your plan includes up to ${list.max} devices at once.`}{" "}
          A device here means a browser: a private window, or a browser whose data was cleared,
          counts as a new one.
        </p>
      ) : null}
      {message ? (
        <p role="status" className={styles.help}>
          {message}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className={styles.help}>
          Couldn&rsquo;t load your devices just now.
        </p>
      ) : list === null ? (
        <p role="status" className={styles.help}>
          Loading…
        </p>
      ) : (
        <ul className={styles.list}>
          {list.devices.map((d) => (
            <li key={d.id} className={styles.device}>
              <span>
                <span className={styles.name}>{d.label}</span>
                {d.current ? <span className={styles.badge}>This device</span> : null}
                <span className={styles.seen}>Last used {lastUsed(d.lastSeenAt)}</span>
              </span>
              {d.current ? null : (
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy !== null}
                  onClick={() => void signOut(d.id, d.label)}
                >
                  Sign out<span className="visually-hidden"> {d.label}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
