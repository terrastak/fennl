import type { ImportWebError, ImportWebResponse } from "../shared/importJobs";
import { ABSOLUTE_MAX_IMAGE_BYTES } from "../shared/images";
import { ORIGIN, forgetConnection, type Connection } from "./connection";

// "Import this page" (phase E6): read the page in the current tab as the person sees it (signed
// in, after its scripts have drawn it) and send it to Fennl, which reads it into drafts for
// review. Chrome lets the extension read the tab only because the person clicked its button
// (the activeTab permission), so it has no standing access to any site.

export interface CapturedPage {
  html: string;
  url: string;
}

export type CaptureProblem = "no_tab" | "fennl_page" | "restricted";

/**
 * Runs inside the page: a copy of it as it is now, without what can't hold a recipe (scripts
 * other than recipe data, styles, pictures drawn in code), which can make a page many times
 * larger. Leaves the page itself untouched.
 */
function pageAsShown(): CapturedPage {
  const copy = document.documentElement.cloneNode(true) as HTMLElement;
  copy
    .querySelectorAll(
      'script:not([type*="ld+json" i]), style, link[rel~="stylesheet" i], svg, canvas, video, iframe',
    )
    .forEach((node) => node.remove());
  return { html: `<!DOCTYPE html>\n${copy.outerHTML}`, url: location.href };
}

/** The tab to import: the one the button was clicked on. */
async function targetTab(): Promise<chrome.tabs.Tab | undefined> {
  const target = __FENNL_TEST__ ? new URLSearchParams(location.search).get("target") : null;
  const [tab] = target
    ? await chrome.tabs.query({ url: target })
    : await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export async function capturePage(): Promise<CapturedPage | { problem: CaptureProblem }> {
  const tab = await targetTab();
  if (tab?.id === undefined) return { problem: "no_tab" };
  let page: CapturedPage | undefined;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageAsShown,
    });
    page = result?.result;
  } catch {
    // Chrome's own pages, the Chrome Web Store and files can't be read by extensions.
    return { problem: "restricted" };
  }
  if (!page) return { problem: "restricted" };
  if (new URL(page.url).origin === ORIGIN) return { problem: "fennl_page" };
  return page;
}

type SentJob = ImportWebResponse["jobs"][number];

export type SendResult =
  | { ok: true; jobs: SentJob[] }
  | { ok: false; problem: ImportWebError | "not_connected" | "offline" | "failed" };

/** Sends the page to Fennl with the extension's key. */
export async function sendPage(connection: Connection, page: CapturedPage): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch(`${ORIGIN}/api/import/web`, {
      method: "POST",
      headers: { authorization: `Bearer ${connection.key}`, "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(page),
    });
  } catch {
    return { ok: false, problem: "offline" };
  }
  if (res.ok) return { ok: true, jobs: ((await res.json()) as ImportWebResponse).jobs };
  if (res.status === 401) {
    await forgetConnection();
    return { ok: false, problem: "not_connected" };
  }
  const error = ((await res.json().catch(() => ({}))) as { error?: ImportWebError }).error;
  return { ok: false, problem: error ?? "failed" };
}

/**
 * Reading photos from any site: asked for once, as the last step of connecting on Premium
 * (setup.html), or later from the panel's "Allow photos" button.
 */
export const PHOTO_SITES = { origins: ["https://*/*", "http://*/*"] };

/** In the tests' build, which may read any site already, a test can have it ask anyway. */
export const TEST_ASK_FOR_PHOTOS = "testAskForPhotos";

export async function photosAllowed(): Promise<boolean> {
  if (
    __FENNL_TEST__ &&
    (await chrome.storage.local.get(TEST_ASK_FOR_PHOTOS))[TEST_ASK_FOR_PHOTOS]
  ) {
    return false;
  }
  return chrome.permissions.contains(PHOTO_SITES);
}

/**
 * Brings the drafts' photos from the browser and hands them to Fennl (some sites, Food Network
 * for one, refuse photo downloads from servers but not from a browser). Best effort: a photo
 * that can't be had here is left for Fennl to try itself. Returns how many arrived.
 */
export async function bringPhotos(connection: Connection, jobs: SentJob[]): Promise<number> {
  let brought = 0;
  for (const job of jobs) {
    for (const photo of job.photos) {
      try {
        const res = await fetch(photo.url);
        if (!res.ok) continue;
        const blob = await res.blob();
        if (blob.size === 0 || blob.size > ABSOLUTE_MAX_IMAGE_BYTES) continue;
        const sent = await fetch(`${ORIGIN}/api/import/jobs/${job.id}/inputs/${photo.input}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${connection.key}`,
            "content-type": "application/octet-stream",
          },
          credentials: "omit",
          body: blob,
        });
        if (sent.ok) brought += 1;
      } catch {
        // Left for Fennl to fetch itself.
      }
    }
  }
  return brought;
}

/** Where to review what was sent: the draft, or the list when the page had several recipes. */
export function reviewPath(jobs: SentJob[]): string {
  const [only] = jobs;
  return jobs.length === 1 && only ? `/import/${only.id}` : "/import";
}

/** What to tell the person when importing didn't work. */
export function problemText(
  problem: CaptureProblem | ImportWebError | "offline" | "failed",
): string {
  switch (problem) {
    case "no_tab":
      return "Fennl couldn't find the page to import. Click the Fennl button on the recipe's page.";
    case "restricted":
      return "Chrome doesn't let extensions read this page. Open the recipe on its own website, then try again.";
    case "fennl_page":
      return "This page is already in Fennl.";
    case "no_recipe":
      return "Fennl couldn't find a recipe on this page. It reads the recipe details most recipe sites publish; pages without them will be readable later.";
    case "page_too_large":
      return "This page is too large to import.";
    case "import_not_included":
      return "Importing pages needs Premium.";
    case "daily_limit":
      return "That's as many imports as your plan allows today. Try again tomorrow.";
    case "rate_limited":
      return "That's a lot of pages at once. Wait a minute, then try again.";
    case "offline":
      return "Fennl can't be reached right now. Check your connection, then try again.";
    case "invalid_request":
    case "failed":
      return "This page couldn't be imported. Please try again.";
  }
}
