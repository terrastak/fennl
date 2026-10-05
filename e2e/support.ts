import { execFileSync } from "node:child_process";
import { expect, type APIRequestContext, type BrowserContext } from "@playwright/test";

/** Browser tests start signed in as this account (made by auth.setup.ts). */
export const SIGNED_IN_STATE = "e2e/.auth/user.json";

export const PASSWORD = "correct horse battery";

export function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * Gives a browser context its own visitor address, so each test gets its own sign-in rate limits.
 * (Cloudflare sets this header itself in real deployments; visitors can't choose it there.)
 */
export async function useFreshAddress(context: BrowserContext): Promise<void> {
  const part = () => Math.floor(Math.random() * 250) + 1;
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": `10.${part()}.${part()}.${part()}` });
}

/** The link in the newest email to an address, from the local dev outbox, as a path. */
export async function linkFromLatestEmail(
  request: APIRequestContext,
  to: string,
  count = 1,
): Promise<string> {
  let link = "";
  await expect(async () => {
    const res = await request.get(`/api/dev/outbox?to=${encodeURIComponent(to)}`);
    const emails = (await res.json()) as { text: string }[];
    expect(emails.length).toBeGreaterThanOrEqual(count);
    const match = emails[0]?.text.match(/https?:\/\/\S+/);
    expect(match).toBeTruthy();
    const url = new URL(match![0]);
    link = `${url.pathname}${url.search}`;
  }).toPass({ timeout: 10_000 });
  return link;
}

/** Makes a confirmed account through the API, signed in within this context. */
export async function signUpConfirmed(
  context: BrowserContext,
  baseURL: string,
  name = "June Lee",
): Promise<string> {
  const email = uniqueEmail("e2e");
  const res = await context.request.post("/api/auth/sign-up/email", {
    headers: { origin: baseURL },
    data: { name, email, password: PASSWORD, callbackURL: "/email-confirmed" },
  });
  expect(res.ok()).toBe(true);
  const link = await linkFromLatestEmail(context.request, email);
  const confirm = await context.request.get(link);
  expect(confirm.ok()).toBe(true);
  return email;
}

/**
 * Switches this test to its own new, signed-in account. For tests that change account settings
 * (like the color scheme), so they don't affect the shared test account other tests use.
 */
export async function useOwnAccount(context: BrowserContext, baseURL: string): Promise<string> {
  await context.clearCookies();
  await useFreshAddress(context);
  return signUpConfirmed(context, baseURL);
}

/** Runs SQL on the local test database, the way the runbooks do it on the real one. */
export function runLocalSql(sql: string): void {
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.jsonc", "--command", sql],
    { stdio: "ignore" },
  );
}

/**
 * Switches invite-only sign-up on or off for the local test database. Browser tests run with it
 * off, so they can make accounts; the server-side tests cover invite-only sign-up itself.
 */
export function setInviteOnly(on: boolean): void {
  runLocalSql(
    `INSERT INTO app_setting (key, value, updated_at) VALUES ('sign_up_requires_code', '${on}', ${Date.now()}) ` +
      `ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
}

/** Makes a code straight in the local test database. Returns the code. */
export function makeCode(options: {
  tier: "individual" | "household";
  until?: Date;
  days?: number;
  allowsSignUp: boolean;
}): string {
  const code = `E2E-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const now = Date.now();
  runLocalSql(
    "INSERT INTO promo_code (id, code, label, tier, access_until, access_days, allows_sign_up, " +
      "max_uses, uses, created_at, updated_at) VALUES " +
      `('${crypto.randomUUID()}', '${code}', 'Browser test', '${options.tier}', ` +
      `${options.until ? options.until.getTime() : "NULL"}, ${options.days ?? "NULL"}, ` +
      `${options.allowsSignUp ? 1 : 0}, NULL, 0, ${now}, ${now})`,
  );
  return code;
}
