import type { ExtensionMe } from "../shared/extension";
import { CONNECT_PATH } from "../shared/extension";
import "../app/styles/tokens.css";
import { ORIGIN, disconnect, savedConnection, whoAmI, type Connection } from "./connection";
import {
  PHOTO_SITES,
  bringPhotos,
  capturePage,
  photosAllowed,
  problemText,
  reviewPath,
  sendPage,
} from "./capture";
import { button, el } from "./ui";
import "./popup.css";

// The toolbar button's panel (phase E5): connect to Fennl, see who it's connected to and what
// the plan lets it import, import the page you're on (phase E6), open Fennl, or disconnect.

const app = document.getElementById("app") as HTMLElement;

function openFennl(path: string) {
  void chrome.tabs.create({ url: `${ORIGIN}${path}` });
  window.close();
}

function show(...nodes: Node[]) {
  app.replaceChildren(el("h1", "Fennl"), ...nodes);
}

function showConnect(note?: string) {
  const parts: Node[] = [];
  if (note) parts.push(el("p", note, "note"));
  parts.push(
    el(
      "p",
      "Connect this extension to your Fennl account to import recipes from the pages you visit. You'll confirm in Fennl; you never type your password here.",
    ),
    button("Connect to Fennl", true, () => openFennl(CONNECT_PATH)),
    el(
      "p",
      "You need a Fennl account to use the extension. During the beta, accounts are by invitation.",
      "muted",
    ),
  );
  show(...parts);
}

function planText(me: ExtensionMe): string {
  if (!me.importPages) return "Importing pages needs Premium.";
  if (me.photos) return "Imports recipes and their photos.";
  return "Imports recipe text. Photos come with Premium.";
}

const TIER_NAMES: Record<ExtensionMe["tier"], string> = {
  free: "Free plan",
  individual: "Premium",
  household: "Premium (household)",
};

function showConnected(connection: Connection, me: ExtensionMe, canBringPhotos: boolean) {
  const who = el("p", undefined, "who");
  who.append("Connected as ", el("strong", me.name), el("span", ` (${me.email})`, "muted"));
  const plan = el("p");
  plan.append(el("strong", TIER_NAMES[me.tier]), ` · ${planText(me)}`);
  const parts: Node[] = [];
  if (me.importPages) {
    const status = el("p", undefined, "status");
    status.setAttribute("role", "status");
    const importButton = button("Import this page", true, () => {
      void importThisPage(connection, importButton, status, me.photos && canBringPhotos);
    });
    parts.push(importButton, status);
    if (me.photos && !canBringPhotos) {
      // Normally asked as the last step of connecting (setup.html); here for anyone who said
      // "Not now" or connected before. From its own button: Chrome's question may close this
      // panel, and nothing in progress is lost that way.
      parts.push(
        el(
          "p",
          "Some sites only let a browser download their photos. Allow it once, and the extension brings recipes' photos from any site.",
          "muted",
        ),
        button("Allow photos from any site", false, () => {
          void chrome.permissions.request(PHOTO_SITES).then(async (granted) => {
            if (granted) showConnected(connection, me, true);
          });
        }),
      );
    }
  } else {
    parts.push(button("See plans in Fennl", true, () => openFennl("/account")));
  }
  parts.push(
    who,
    plan,
    button("Open Fennl", false, () => openFennl("/")),
    button("Disconnect", false, () => {
      void disconnect(connection).then(() => showConnect("Disconnected."));
    }),
  );
  show(...parts);
}

/** Reads the page, sends it, and opens Fennl's review screen for it. */
async function importThisPage(
  connection: Connection,
  importButton: HTMLButtonElement,
  status: HTMLElement,
  withPhotos: boolean,
) {
  importButton.disabled = true;
  status.className = "status";
  status.textContent = "Reading the page…";
  const page = await capturePage();
  if (!("problem" in page)) status.textContent = "Sending it to Fennl…";
  const sent = "problem" in page ? null : await sendPage(connection, page);
  if (sent?.ok) {
    if (withPhotos && sent.jobs.some((job) => job.photos.length > 0)) {
      status.textContent = "Bringing the photos…";
      await bringPhotos(connection, sent.jobs);
    }
    status.textContent = "Opening it in Fennl to review…";
    return openFennl(reviewPath(sent.jobs));
  }
  if (sent?.problem === "not_connected") {
    return showConnect("This extension isn't connected any more. Connect it again to carry on.");
  }
  const problem = "problem" in page ? page.problem : (sent?.problem ?? "failed");
  status.className = "status problem";
  status.textContent = problemText(problem);
  importButton.disabled = false;
}

async function start() {
  const connection = await savedConnection();
  if (!connection) return showConnect();
  const result = await whoAmI(connection);
  switch (result.status) {
    case "connected":
      return showConnected(connection, result.me, await photosAllowed());
    case "not_connected":
      return showConnect("This extension isn't connected any more. Connect it again to carry on.");
    case "password_change_required":
      return show(
        el("p", "Choose a new password in Fennl first."),
        button("Open Fennl", true, () => openFennl("/")),
      );
    case "offline":
      return show(
        el("p", "Fennl can't be reached right now. Check your connection, then try again."),
        button("Try again", true, () => void start()),
      );
  }
}

void start();
