import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceList } from "../../shared/devices";
import type { ExtensionLinkSummary } from "../../shared/extension";
import { deviceId } from "../devices/deviceId";
import { lastUsed } from "../devices/lastUsed";
import { extensionLinks, removeExtensionLink } from "../extension/api";
import acc from "../pages/AccountPage.module.css";
import pages from "../pages/pages.module.css";
import settings from "../pages/SettingsPage.module.css";
import { RowIcon } from "../pages/SettingsRow";
import { usePointer } from "../recipes/usePointer";
import { DoneBar } from "../ui/DoneBar";
import { ACCOUNT_ICONS, deviceIcon } from "./accountIcons";
import styles from "./signedIn.module.css";

/**
 * Account › Where you're signed in: every device (browser) signed in to the account, and every
 * Chrome extension connected to it, each with Sign out or Disconnect, and one button to sign out
 * every other device. Devices came in phase B6, extensions in E5.
 */
export function SignedInSection() {
  const [devices, setDevices] = useState<DeviceList | null>(null);
  const [links, setLinks] = useState<ExtensionLinkSummary[] | null>(null);
  const [devicesFailed, setDevicesFailed] = useState(false);
  const [linksFailed, setLinksFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const laptop = usePointer();
  // On a laptop, a sign-out or disconnect that worked takes its own button away with the device
  // or extension; the focus then moves to the bar's words rather than the top of the page.
  const [focusKey, setFocusKey] = useState(0);
  const focusCount = useRef(0);
  const moveFocus = () => setFocusKey(++focusCount.current);

  const loadDevices = useCallback(async () => {
    const res = await fetch(`/api/devices?current=${encodeURIComponent(deviceId())}`).catch(
      () => null,
    );
    if (res?.ok) {
      setDevices((await res.json()) as DeviceList);
      setDevicesFailed(false);
    } else {
      setDevicesFailed(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/devices?current=${encodeURIComponent(deviceId())}`)
      .then((res) => (res.ok ? (res.json() as Promise<DeviceList>) : Promise.reject(res)))
      .then((body) => {
        if (!cancelled) setDevices(body);
      })
      .catch(() => {
        if (!cancelled) setDevicesFailed(true);
      });
    void extensionLinks().then((list) => {
      if (cancelled) return;
      if (list) setLinks(list);
      else setLinksFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async (id: string, label: string) => {
    setBusy(id);
    setMessage(null);
    setFocusKey(0);
    const res = await fetch(`/api/devices/${encodeURIComponent(id)}/sign-out`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: deviceId() }),
    }).catch(() => null);
    setBusy(null);
    setMessage(res?.ok ? `Signed out ${label}.` : `Couldn't sign out ${label}. Try again.`);
    if (res?.ok) moveFocus();
    await loadDevices();
  };

  const signOutOthers = async () => {
    setBusy("others");
    setMessage(null);
    setFocusKey(0);
    const res = await fetch("/api/devices/sign-out-others", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: deviceId() }),
    }).catch(() => null);
    setBusy(null);
    const error = res?.ok
      ? null
      : ((await res?.json().catch(() => ({}))) as { error?: string } | undefined)?.error;
    setMessage(
      res?.ok
        ? "Signed out all your other devices."
        : error === "not_while_impersonating"
          ? "Other devices can't be signed out while acting as someone."
          : "Couldn't sign out your other devices. Try again.",
    );
    if (res?.ok) moveFocus();
    await loadDevices();
  };

  const disconnect = async (link: ExtensionLinkSummary) => {
    setBusy(link.id);
    setMessage(null);
    setFocusKey(0);
    const ok = await removeExtensionLink(link.id);
    setBusy(null);
    if (ok) {
      setLinks((all) => all?.filter((l) => l.id !== link.id) ?? null);
      setMessage(`Disconnected the extension in ${link.label}.`);
      moveFocus();
    } else {
      setMessage(`Couldn't disconnect the extension in ${link.label}. Try again.`);
    }
  };

  const others = devices?.devices.filter((d) => !d.current).length ?? 0;

  const plan =
    devices === null
      ? null
      : devices.max === null
        ? "Your plan has no device limit."
        : devices.max === 1
          ? "Your plan includes one device at a time. Opening Fennl on another device asks to sign this one out."
          : `Your plan includes up to ${devices.max} devices at once.`;

  if (laptop) {
    // On a laptop (U23 slice 9): Devices and the Chrome extension each their own white box, a
    // row per device with a small picture of it, and "Sign out all other devices" at the top
    // right of the Devices box. What happened shows in the grey bar under the introduction.
    const done = message !== null && !/^Couldn|can.t be signed out/.test(message);
    return (
      <section className={settings.section} aria-labelledby="signed-in-title">
        <h2 id="signed-in-title">Where you&rsquo;re signed in</h2>
        <p className={`${settings.help} ${acc.lead}`}>
          The devices signed in to your account, and the Chrome extensions connected to it. Sign out
          or disconnect any you no longer use.
        </p>
        {message ? (
          <div className={acc.doneSpace}>
            <DoneBar message={message} problem={!done} focusKey={focusKey} />
          </div>
        ) : null}

        <div className={acc.boxes}>
          <div className={`${settings.box} ${acc.box}`}>
            <div className={`${settings.row} ${settings.rowTop}`}>
              <div className={settings.rowText}>
                <h3 id="devices-title" className={acc.boxTitle}>
                  Devices
                </h3>
                {plan ? (
                  <p className={settings.help}>
                    {plan} A device here means a browser: a private window, or a browser whose data
                    was cleared, counts as a new one.
                  </p>
                ) : null}
              </div>
              {others > 1 ? (
                <div className={settings.rowControl}>
                  <button
                    type="button"
                    className={settings.rowButton}
                    disabled={busy !== null}
                    onClick={() => void signOutOthers()}
                  >
                    <RowIcon path={ACCOUNT_ICONS.signOut} />
                    Sign out all other devices
                  </button>
                </div>
              ) : null}
            </div>
            {devicesFailed ? (
              <p role="alert" className={acc.boxLine}>
                Couldn&rsquo;t load your devices just now.
              </p>
            ) : devices === null ? (
              <p role="status" className={acc.boxLine}>
                Loading…
              </p>
            ) : (
              <ul className={acc.devices} aria-labelledby="devices-title">
                {devices.devices.map((d) => (
                  <li key={d.id} className={acc.device}>
                    <span className={acc.deviceIcon}>
                      <RowIcon path={deviceIcon(d.label)} className={acc.deviceIconSvg} />
                    </span>
                    <span className={acc.deviceText}>
                      <span className={acc.deviceName}>
                        {d.label}
                        {d.current ? <span className={acc.tag}>This device</span> : null}
                      </span>
                      <span className={acc.seen}>Last used {lastUsed(d.lastSeenAt)}</span>
                    </span>
                    {d.current ? null : (
                      <button
                        type="button"
                        className={settings.rowButton}
                        disabled={busy !== null}
                        onClick={() => void signOut(d.id, d.label)}
                      >
                        <RowIcon path={ACCOUNT_ICONS.signOut} />
                        Sign out<span className="visually-hidden"> {d.label}</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={`${settings.box} ${acc.box}`}>
            <div className={`${settings.row} ${settings.rowTop}`}>
              <div className={settings.rowText}>
                <h3 id="extensions-title" className={acc.boxTitle}>
                  Chrome extension
                </h3>
                <p className={settings.help}>
                  The Fennl extension for Chrome imports recipes from the pages you visit. It can
                  only send pages to import; it can&rsquo;t see or change your recipes. Changing
                  your password disconnects every extension, and one unused for 90 days disconnects
                  itself.
                </p>
              </div>
            </div>
            {linksFailed ? (
              <p role="alert" className={acc.boxLine}>
                Couldn&rsquo;t load your connected extensions just now.
              </p>
            ) : links === null ? (
              <p role="status" className={acc.boxLine}>
                Loading…
              </p>
            ) : links.length === 0 ? (
              <p className={acc.boxLine}>No extension is connected.</p>
            ) : (
              <ul className={acc.devices} aria-label="Connected extensions">
                {links.map((link) => (
                  <li key={link.id} className={acc.device}>
                    <span className={acc.deviceIcon}>
                      <RowIcon path={ACCOUNT_ICONS.extension} className={acc.deviceIconSvg} />
                    </span>
                    <span className={acc.deviceText}>
                      <span className={acc.deviceName}>Extension in {link.label}</span>
                      <span className={acc.seen}>Last used {lastUsed(link.lastUsedAt)}</span>
                    </span>
                    <button
                      type="button"
                      className={settings.rowButton}
                      disabled={busy !== null}
                      onClick={() => void disconnect(link)}
                    >
                      <RowIcon path={ACCOUNT_ICONS.unplug} />
                      Disconnect
                      <span className="visually-hidden"> the extension in {link.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`${pages.card} ${pages.stacked}`} aria-labelledby="signed-in-title">
      <h2 id="signed-in-title">Where you&rsquo;re signed in</h2>
      <p>
        The devices signed in to your account, and the Chrome extensions connected to it. Sign out
        or disconnect any you no longer use.
      </p>
      {message ? <p role="status">{message}</p> : null}

      <div className={styles.group}>
        <h3 id="devices-title">Devices</h3>
        {devices ? (
          <p>
            {devices.max === null
              ? "Your plan has no device limit."
              : devices.max === 1
                ? "Your plan includes one device at a time. Opening Fennl on another device asks to sign this one out."
                : `Your plan includes up to ${devices.max} devices at once.`}{" "}
            A device here means a browser: a private window, or a browser whose data was cleared,
            counts as a new one.
          </p>
        ) : null}
        {devicesFailed ? (
          <p role="alert">Couldn&rsquo;t load your devices just now.</p>
        ) : devices === null ? (
          <p role="status">Loading…</p>
        ) : (
          <ul className={styles.list} aria-labelledby="devices-title">
            {devices.devices.map((d) => (
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
        {others > 1 ? (
          <button
            type="button"
            className={`${styles.button} ${styles.all}`}
            disabled={busy !== null}
            onClick={() => void signOutOthers()}
          >
            Sign out all other devices
          </button>
        ) : null}
      </div>

      <div className={styles.group}>
        <h3 id="extensions-title">Chrome extension</h3>
        <p>
          The Fennl extension for Chrome imports recipes from the pages you visit. It can only send
          pages to import; it can&rsquo;t see or change your recipes. Changing your password
          disconnects every extension, and one unused for 90 days disconnects itself.
        </p>
        {linksFailed ? (
          <p role="alert">Couldn&rsquo;t load your connected extensions just now.</p>
        ) : links === null ? (
          <p role="status">Loading…</p>
        ) : links.length === 0 ? (
          <p>No extension is connected.</p>
        ) : (
          <ul className={styles.list} aria-label="Connected extensions">
            {links.map((link) => (
              <li key={link.id} className={styles.device}>
                <span>
                  <span className={styles.name}>Extension in {link.label}</span>
                  <span className={styles.seen}>Last used {lastUsed(link.lastUsedAt)}</span>
                </span>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy !== null}
                  onClick={() => void disconnect(link)}
                >
                  Disconnect<span className="visually-hidden"> the extension in {link.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
