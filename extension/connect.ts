import {
  CONNECTED_MESSAGE,
  CONNECT_FINISHED_MESSAGE,
  CONNECT_MESSAGE,
  isExtensionKey,
} from "../shared/extension";
import { saveConnection, savedConnection } from "./connection";

// Runs only on Fennl's "Connect the extension" page (manifest.json, content_scripts). When the
// person confirms there, the page hands over the new key; it's kept in the extension's storage
// and the page is told, along with the connection it replaces (which the page then removes).
// The page also learns the extension is installed, so it can say so. Once the page has finished,
// the extension's background script may move it on to one more step (extension/background.ts).

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data as { type?: unknown; key?: unknown; linkId?: unknown } | null;
  if (data?.type === CONNECT_FINISHED_MESSAGE) {
    chrome.runtime.sendMessage({ type: CONNECT_FINISHED_MESSAGE }).catch(() => {});
    return;
  }
  if (data?.type !== CONNECT_MESSAGE) return;
  if (!isExtensionKey(data.key) || typeof data.linkId !== "string") return;
  const connection = { key: data.key, linkId: data.linkId };
  void (async () => {
    const previous = await savedConnection();
    await saveConnection(connection);
    window.postMessage(
      {
        type: CONNECTED_MESSAGE,
        replaced: previous && previous.linkId !== connection.linkId ? previous.linkId : null,
      },
      window.location.origin,
    );
  })();
});

// "The extension is installed": the page waits for this before offering to connect.
document.documentElement.dataset.fennlExtension = chrome.runtime.getManifest().version;
