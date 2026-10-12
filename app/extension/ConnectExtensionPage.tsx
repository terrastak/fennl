import { useEffect, useRef, useState } from "react";
import { CONNECTED_MESSAGE, CONNECT_MESSAGE } from "../../shared/extension";
import { PageHeader } from "../pages/PageHeader";
import recipes from "../recipes/recipes.module.css";
import { Link } from "../router";
import { createExtensionLink, removeExtensionLink } from "./api";
import styles from "./extension.module.css";

// /connect-extension (phase E5): the Fennl extension opens this page to connect to the account.
// The person confirms; the server makes a key for the extension, and the page hands it to the
// extension's script here (extension/connect.ts), which keeps it. A key the extension doesn't
// pick up is taken back at once. Nothing is typed into the extension itself.

/** How long to wait for the extension to say it kept the key. */
const ANSWER_MS = 5000;

type State =
  | { kind: "ready" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "problem"; text: string };

/** The extension's script marks the page when it's installed (extension/connect.ts). */
const extensionInstalled = () => Boolean(document.documentElement.dataset.fennlExtension);

/** Hands the key to the extension; resolves with the connection it replaced, or false. */
function handOver(key: string, linkId: string): Promise<string | null | false> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(false);
    }, ANSWER_MS);
    function onMessage(event: MessageEvent<unknown>) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; replaced?: unknown } | null;
      if (data?.type !== CONNECTED_MESSAGE) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(typeof data.replaced === "string" ? data.replaced : null);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ type: CONNECT_MESSAGE, key, linkId }, window.location.origin);
  });
}

export function ConnectExtensionPage() {
  const [state, setState] = useState<State>({ kind: "ready" });
  const [installed, setInstalled] = useState(extensionInstalled);
  const result = useRef<HTMLParagraphElement>(null);

  // The extension's script may mark the page a moment after it opens.
  useEffect(() => {
    if (installed) return;
    const timer = setInterval(() => {
      if (extensionInstalled()) setInstalled(true);
    }, 250);
    return () => clearInterval(timer);
  }, [installed]);

  useEffect(() => {
    if (state.kind === "connected" || state.kind === "problem") result.current?.focus();
  }, [state.kind]);

  const connect = async () => {
    setState({ kind: "connecting" });
    const created = await createExtensionLink();
    if (!created.ok) {
      const text = {
        too_many:
          "Ten extensions are connected to your account already. Disconnect one in Settings, then try again.",
        offline: "Connecting needs a connection. Try again when you're back online.",
        not_while_impersonating: "An extension can't be connected while acting as someone.",
        failed: "The extension couldn't be connected just now. Please try again.",
      }[created.problem];
      setState({ kind: "problem", text });
      return;
    }
    const replaced = await handOver(created.key, created.id);
    if (replaced === false) {
      // Nothing kept the key: take it back, so no unused key is left on the account.
      await removeExtensionLink(created.id);
      setState({
        kind: "problem",
        text: "The Fennl extension didn't answer. Check it's installed and turned on in this browser, then try again.",
      });
      return;
    }
    // The extension was connected before: its old key is no longer needed.
    if (replaced) await removeExtensionLink(replaced);
    setState({ kind: "connected" });
  };

  return (
    <>
      <PageHeader title="Connect the Fennl extension">
        <p>The Fennl extension for Chrome imports recipes from the pages you visit.</p>
      </PageHeader>
      <section className={styles.card} aria-labelledby="connect-what">
        <h2 id="connect-what">What connecting does</h2>
        <ul className={styles.list}>
          <li>The extension can send pages you choose to Fennl to import, for you to review.</li>
          <li>It can&rsquo;t see or change your recipes, and it never asks for your password.</li>
          <li>You can disconnect it at any time in Settings.</li>
        </ul>
        {state.kind === "connected" ? (
          <p ref={result} tabIndex={-1} role="status" className={styles.done}>
            Connected. You can close this tab and use the Fennl button in Chrome&rsquo;s toolbar.
          </p>
        ) : (
          <>
            {!installed ? (
              <p className={recipes.hint}>
                Fennl can&rsquo;t see the extension in this browser yet. Install it, then open this
                page from its button.
              </p>
            ) : null}
            <button
              type="button"
              className={recipes.primary}
              disabled={!installed || state.kind === "connecting"}
              onClick={() => void connect()}
            >
              {state.kind === "connecting" ? "Connecting…" : "Connect the extension"}
            </button>
            {state.kind === "problem" ? (
              <p ref={result} tabIndex={-1} role="alert" className={styles.problem}>
                {state.text}
              </p>
            ) : null}
          </>
        )}
        <p className={recipes.hint}>
          <Link href="/settings">Settings</Link> lists every connected extension.
        </p>
      </section>
    </>
  );
}
