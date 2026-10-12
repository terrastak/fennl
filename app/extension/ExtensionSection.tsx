import { useEffect, useState } from "react";
import type { ExtensionLinkSummary } from "../../shared/extension";
import { lastUsed } from "../devices/lastUsed";
import styles from "../devices/devices.module.css";
import { extensionLinks, removeExtensionLink } from "./api";

/**
 * Settings › Chrome extension (phase E5): the extensions connected to this account, each with
 * Disconnect. They can only send pages to import; they can't read or change recipes.
 */
export function ExtensionSection() {
  const [links, setLinks] = useState<ExtensionLinkSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void extensionLinks().then((list) => {
      if (cancelled) return;
      if (list) setLinks(list);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const remove = async (link: ExtensionLinkSummary) => {
    setBusy(link.id);
    setMessage(null);
    const ok = await removeExtensionLink(link.id);
    setBusy(null);
    if (ok) {
      setLinks((all) => all?.filter((l) => l.id !== link.id) ?? null);
      setMessage(`Disconnected the extension in ${link.label}.`);
    } else {
      setMessage(`Couldn't disconnect the extension in ${link.label}. Try again.`);
    }
  };

  return (
    <section aria-labelledby="extension-title" className={styles.section}>
      <h2 id="extension-title">Chrome extension</h2>
      <p className={styles.help}>
        The Fennl extension for Chrome imports recipes from the pages you visit. Each one you
        connect is listed here. It can only send pages to import; it can&rsquo;t see or change your
        recipes. Changing your password disconnects them all, and one unused for 90 days disconnects
        itself.
      </p>
      {message ? (
        <p role="status" className={styles.help}>
          {message}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className={styles.help}>
          Couldn&rsquo;t load your connected extensions just now.
        </p>
      ) : links === null ? (
        <p role="status" className={styles.help}>
          Loading…
        </p>
      ) : links.length === 0 ? (
        <p className={styles.help}>No extension is connected.</p>
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
                onClick={() => void remove(link)}
              >
                Disconnect<span className="visually-hidden"> the extension in {link.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
