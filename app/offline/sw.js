/* global BUILD, FILES */
// The app's own files kept on the device, so Fennl opens with no connection (phase C4b).
//
// vite.config.ts writes this file into the build as /sw.js, with two values put in front:
// BUILD (changes whenever any file does) and FILES (the app's files: scripts, styles, fonts,
// icons). Recipes aren't here: they're in the local database (app/sync/), and the account on
// the server is what counts.
//
// - Installing keeps every file of this build, plus the app's page ("/").
// - Opening a page tries the network first, so an online visit always gets the newest release;
//   with no connection, the kept page is used (the app then shows the requested page itself).
// - The app's files come from what's kept, falling back to the network. Lookups ignore "Vary":
//   scripts and fonts are requested with an Origin header the kept copies were saved without.
// - The API, the admin area and the storage test are never kept or answered from here.
// - A new build's worker takes over straight away and removes the old files. An open page then
//   offers to reload (app/sync/version.ts).

const CACHE = `fennl-app-${BUILD}`;
const PAGE = "/";
const NEVER = [/^\/api\//, /^\/admin(\/|$)/, /^\/storage-trial/, /^\/sw\.js$/];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([PAGE, ...FILES]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("fennl-app-") && name !== CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.some((pattern) => pattern.test(url.pathname))) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(PAGE, { cacheName: CACHE, ignoreVary: true })
          .then((kept) => kept ?? Response.error()),
      ),
    );
    return;
  }
  event.respondWith(
    caches
      .match(request, { cacheName: CACHE, ignoreVary: true })
      .then((kept) => kept ?? fetch(request)),
  );
});
