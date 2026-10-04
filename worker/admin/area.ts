/**
 * Where the admin area lives (CLAUDE.md, "Admin console"):
 *  - Production: only on ADMIN_HOSTNAME, which is behind Cloudflare Access. On the app's own
 *    address, admin paths don't exist.
 *  - Previews and local development (no ADMIN_HOSTNAME): under /admin on the same address. The
 *    whole preview Worker is behind Access; locally, ACCESS_DEV_BYPASS stands in for it.
 */
export function adminAreaAllowedOn(env: Env, url: URL): boolean {
  return env.ADMIN_HOSTNAME ? url.hostname === env.ADMIN_HOSTNAME : true;
}

/** This request is for the dedicated admin address (production). */
export function onAdminHost(env: Env, url: URL): boolean {
  return Boolean(env.ADMIN_HOSTNAME) && url.hostname === env.ADMIN_HOSTNAME;
}

export function isAdminPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/") ||
    pathname.startsWith("/api/auth/passkey/")
  );
}

/** A request for a built file (script, font, icon...), not a page. */
export function isStaticFile(pathname: string): boolean {
  return /\.[a-z0-9]+$/i.test(pathname.split("/").pop() ?? "");
}
