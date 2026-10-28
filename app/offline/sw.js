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
// - Timer alerts (U8, app/cook/timerAlerts.ts): a push from the server is shown as a
//   notification, and tapping it opens the cook page that started the timer.

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

// A timer alert from the server (U8). Every push must show a notification (browsers stop
// delivering them otherwise). When the cook page that started the timer is on screen it has
// rung already, so the notification is taken away again straight after, except through Apple's
// push service: Apple ends the subscription of a site whose pushes show nothing, and doesn't say
// whether one taken away counts, so there it stays.
self.addEventListener("push", (event) => {
  let alert = null;
  try {
    alert = event.data ? event.data.json() : null;
  } catch {
    alert = null;
  }
  const title = (alert && alert.title) || "Fennl";
  const path = (alert && typeof alert.path === "string" && alert.path) || "/";
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body: (alert && alert.body) || "",
        tag: (alert && alert.tag) || undefined,
        data: { path },
      });
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const ringing = windows.some(
        (client) => client.visibilityState === "visible" && new URL(client.url).pathname === path,
      );
      const subscription = await self.registration.pushManager.getSubscription();
      const apple = Boolean(
        subscription && /\.push\.apple\.com$/.test(new URL(subscription.endpoint).hostname),
      );
      if (ringing && !apple && alert && alert.tag) {
        const shown = await self.registration.getNotifications({ tag: alert.tag });
        for (const notification of shown) notification.close();
      }
    })(),
  );
});

// Tapping an alert: back to Fennl, on the page that started the timer.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.path) || "/";
  const url = new URL(path, self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).pathname === url.pathname);
      if (open) return open.focus();
      if (windows[0]) {
        await windows[0].focus();
        return windows[0].navigate(url.href);
      }
      return self.clients.openWindow(url.href);
    })(),
  );
});
