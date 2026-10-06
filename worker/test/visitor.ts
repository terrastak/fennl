import { applyD1Migrations, env } from "cloudflare:test";
import { expect } from "vitest";
import { database } from "../db/client";
import { devOutbox } from "../email/outbox";
import { app } from "../index";
import { writeSetting } from "../settings/settings";

// Helpers for Worker tests that sign people up and act as them.

export const ORIGIN = "http://localhost";

/**
 * Applies the migrations to this test file's database. Sign-up is open unless a test says
 * otherwise, so tests that aren't about invite codes can make accounts freely.
 */
export async function setUpDatabase(options: { inviteOnly?: boolean } = {}) {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await writeSetting(database(env.DB), "sign_up_requires_code", options.inviteOnly ?? false, null);
}
export const PASSWORD = "correct horse battery";

let ipCounter = 0;

/** A fresh visitor: their own IP address (for rate limits) and cookie jar. */
export function visitor(ip = `203.0.113.${++ipCounter}`) {
  let cookie = "";
  return {
    async request(path: string, init: { method?: string; body?: unknown } = {}) {
      const headers: Record<string, string> = { origin: ORIGIN, "cf-connecting-ip": ip };
      if (cookie) headers.cookie = cookie;
      if (init.body !== undefined) headers["content-type"] = "application/json";
      const res = await app.request(
        `${ORIGIN}${path}`,
        {
          method: init.method ?? (init.body === undefined ? "GET" : "POST"),
          headers,
          redirect: "manual",
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        },
        env,
      );
      for (const setCookie of res.headers.getSetCookie()) {
        const [pair] = setCookie.split(";");
        if (!pair) continue;
        const [name] = pair.split("=");
        const kept = cookie
          .split("; ")
          .filter((c) => c && !c.startsWith(`${name}=`))
          .concat(/=$/.test(pair) || /max-age=0/i.test(setCookie) ? [] : [pair]);
        cookie = kept.join("; ");
      }
      return res;
    },
    /** Adds a cookie by hand ("name=value"), as a browser would send it. */
    addCookie(pair: string) {
      cookie = cookie ? `${cookie}; ${pair}` : pair;
    },
    /** The visitor's cookies, for calling the app with a different env or address. */
    cookie() {
      return cookie;
    },
    async session() {
      const res = await this.request("/api/auth/get-session");
      return (await res.json()) as {
        user: { id: string; email: string; emailVerified: boolean; colorScheme?: string | null };
        session: { id: string; activeOrganizationId?: string | null };
      } | null;
    },
  };
}

export type Visitor = ReturnType<typeof visitor>;

/** The link in the newest email sent to an address, as a path on this server. */
export function linkInLatestEmail(to: string): string {
  const [latest] = devOutbox.list(to);
  expect(latest, `an email to ${to}`).toBeDefined();
  const match = latest!.text.match(/https?:\/\/\S+/);
  expect(match, "a link in the email").not.toBeNull();
  const url = new URL(match![0]);
  return `${url.pathname}${url.search}`;
}

/** Signs up (not yet confirmed). */
export async function signUp(email: string, name = "June Lee"): Promise<Visitor> {
  const v = visitor();
  const res = await v.request("/api/auth/sign-up/email", {
    body: { name, email, password: PASSWORD, callbackURL: "/" },
  });
  expect(res.status).toBe(200);
  return v;
}

/** Signs up and confirms the email, which signs the visitor in. */
export async function signUpConfirmed(email: string, name = "June Lee"): Promise<Visitor> {
  const v = await signUp(email, name);
  const confirm = await v.request(linkInLatestEmail(email));
  expect(confirm.status).toBe(302);
  return v;
}
