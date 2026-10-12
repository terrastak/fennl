import "../app/styles/tokens.css";
import { PHOTO_SITES } from "./capture";
import { ORIGIN, savedConnection, whoAmI } from "./connection";
import { button, el } from "./ui";
import "./popup.css";

// The last step of connecting, on Premium (phase E6): Fennl's connect page moves on to this page
// (extension/background.ts) to ask, once, to bring photos from any site, since some sites (Food
// Network, for one) only let a browser download their photos. Chrome asks only from the
// extension's own pages, after a click, so the question waits for this page's button. "Not now"
// leaves it to the same button in the panel (popup.ts).

const app = document.getElementById("app") as HTMLElement;

function show(...nodes: Node[]) {
  app.replaceChildren(el("h1", "Fennl"), ...nodes);
}

function finish(text: string) {
  const status = el("p", text, "done");
  status.setAttribute("role", "status");
  status.tabIndex = -1;
  show(
    status,
    el(
      "p",
      "To import a recipe, open it and click the Fennl button in Chrome's toolbar. You can close this tab.",
    ),
    button("Open Fennl", false, () => {
      location.href = `${ORIGIN}/`;
    }),
  );
  status.focus();
}

async function start() {
  const connection = await savedConnection();
  const result = connection ? await whoAmI(connection) : null;
  const who = el("p");
  if (result?.status === "connected") {
    who.append("Connected as ", el("strong", result.me.name), ` (${result.me.email}).`);
  } else {
    who.append("Connected to Fennl.");
  }
  show(
    who,
    el("h2", "One more step: photos"),
    el(
      "p",
      "Some sites only let a browser download their photos, so the extension brings a recipe's photos itself when you import it. Chrome asks you once to allow this for any site.",
    ),
    el("p", "The extension only downloads the photos of a recipe you import.", "muted"),
    button("Allow photos from any site", true, () => {
      void chrome.permissions.request(PHOTO_SITES).then((granted) => {
        finish(
          granted
            ? "All set. Photos come with the recipes you import."
            : "Photos aren't allowed yet. You can allow them any time from the Fennl button.",
        );
      });
    }),
    button("Not now", false, () => {
      finish("Photos aren't allowed yet. You can allow them any time from the Fennl button.");
    }),
  );
}

void start();
