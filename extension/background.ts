import { CONNECT_FINISHED_MESSAGE, CONNECT_PATH } from "../shared/extension";
import { photosAllowed } from "./capture";
import { ORIGIN, savedConnection, whoAmI } from "./connection";

// The extension's background script (phase E6), with one job: once Fennl's connect page says
// connecting is finished (passed on by extension/connect.ts), and the plan keeps photos but the
// extension can't yet bring them from any site, that tab moves on to the extension's own "one
// more step" page (setup.html). Chrome only asks for a permission from the extension's own
// pages, after a click there.

chrome.runtime.onMessage.addListener((message, sender) => {
  if ((message as { type?: unknown } | null)?.type !== CONNECT_FINISHED_MESSAGE) return;
  const tabId = sender.tab?.id;
  if (tabId === undefined || !sender.url) return;
  const from = new URL(sender.url);
  if (from.origin !== ORIGIN || from.pathname !== CONNECT_PATH) return;
  void askForPhotos(tabId);
});

async function askForPhotos(tabId: number) {
  const connection = await savedConnection();
  if (!connection) return;
  const result = await whoAmI(connection);
  if (result.status !== "connected" || !result.me.importPages || !result.me.photos) return;
  if (await photosAllowed()) return;
  await chrome.tabs.update(tabId, { url: chrome.runtime.getURL("setup.html") });
}
