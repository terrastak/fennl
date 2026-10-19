import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

/**
 * Runs SQL on the local test database, the way the runbooks do it on the real one. Only for what
 * must never go through the app (granting the admin role), and only in auth.setup.ts, before any
 * other test runs: a write from this separate process can find the app server mid-query and make
 * that request fail with "database is locked".
 */
export function runLocalSql(sql: string): void {
  const args = ["wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.jsonc"];
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync("npx", [...args, "--command", sql], { stdio: "pipe" });
      return;
    } catch (error) {
      if (attempt >= 5) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300 * attempt);
    }
  }
}

/** Sets something up through the local test server's setup route (worker/dev/testSetup.ts). */
export async function testSetup(
  request: APIRequestContext,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await request.post("/api/dev/test-setup", { data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Switches invite-only sign-up on or off for the local test database. Browser tests run with it
 * off, so they can make accounts; the server-side tests cover invite-only sign-up itself.
 */
export async function setInviteOnly(request: APIRequestContext, on: boolean): Promise<void> {
  await testSetup(request, { kind: "inviteOnly", on });
}

/** Makes a code in the local test database, as the admin console would. Returns the code. */
export async function makeCode(
  request: APIRequestContext,
  options: {
    tier: "individual" | "household";
    until?: Date;
    days?: number;
    allowsSignUp: boolean;
  },
): Promise<string> {
  const { code } = await testSetup(request, {
    kind: "code",
    tier: options.tier,
    accessUntil: options.until?.getTime() ?? null,
    accessDays: options.days ?? null,
    allowsSignUp: options.allowsSignUp,
  });
  return code as string;
}

/**
 * Admin accounts, made and given the admin role by auth.setup.ts before any other test runs (the
 * role is only ever granted by a direct database command). One per admin test, project and
 * attempt, so a retried test starts with a fresh account. The key is the test's own label.
 */
export const ADMIN_ACCOUNTS = {
  passkey: "Owner",
  helps: "Helper",
  restores: "Support",
  feedback: "Support",
  acts: "Ada Admin",
  "ai-outcomes": "Analyst",
} as const;
export type AdminLabel = keyof typeof ADMIN_ACCOUNTS;
/** Where the admin tests run (the console is checked on a computer). */
export const ADMIN_PROJECTS = ["desktop"] as const;
export const ADMIN_ATTEMPTS = 2;
export const ADMINS_FILE = "e2e/.auth/admins.json";

/** The admin account made for this test (by label), its project and its attempt. */
export function adminEmail(
  testInfo: { project: { name: string }; retry: number },
  label: AdminLabel,
): string {
  const admins = JSON.parse(readFileSync(ADMINS_FILE, "utf8")) as Record<string, string>;
  const key = `${testInfo.project.name}:${label}:${testInfo.retry}`;
  const email = admins[key];
  if (!email) throw new Error(`No admin account ${key}: add it in e2e/support.ts (ADMIN_*)`);
  return email;
}
