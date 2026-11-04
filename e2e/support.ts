import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

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

/** The id the local dev outbox gave the newest email to an address (phase U14). */
export async function latestEmailId(request: APIRequestContext, to: string): Promise<string> {
  let id = "";
  await expect(async () => {
    const res = await request.get(`/api/dev/outbox?to=${encodeURIComponent(to)}`);
    const emails = (await res.json()) as { id?: string }[];
    expect(emails[0]?.id).toBeTruthy();
    id = emails[0]!.id!;
  }).toPass({ timeout: 10_000 });
  return id;
}

/** The local webhook signing secret: from .dev.vars, else the example it's made from. */
function webhookSecret(): string {
  for (const file of [".dev.vars", ".dev.vars.example"]) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const match = text.match(/^RESEND_WEBHOOK_SECRET=(.+)$/m);
    if (match) return match[1]!.trim();
  }
  throw new Error("RESEND_WEBHOOK_SECRET is missing from .dev.vars and .dev.vars.example");
}

/**
 * Sends an event about an email to Fennl's webhook (POST /api/email/events), signed the way
 * Resend signs them (Svix: an HMAC-SHA256 of "id.timestamp.body" with the secret after
 * "whsec_", base64-decoded), as if Resend said what happened to it (phase U14).
 */
export async function sendEmailEvent(
  request: APIRequestContext,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  const body = JSON.stringify({ type, created_at: new Date().toISOString(), data });
  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(webhookSecret().replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  const res = await request.post("/api/email/events", {
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
    data: body,
  });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Resend's word that the newest email to an address bounced for good (phase U14). */
export async function bounceLatestEmail(request: APIRequestContext, to: string): Promise<void> {
  const emailId = await latestEmailId(request, to);
  await sendEmailEvent(request, "email.bounced", {
    email_id: emailId,
    to: [to],
    bounce: {
      type: "Permanent",
      subType: "General",
      message: "The recipient's email address doesn't exist.",
    },
  });
}

/** Makes a confirmed account through the API, signed in within this context. */
export async function signUpConfirmed(
  context: BrowserContext,
  baseURL: string,
  name = "June Lee",
  email = uniqueEmail("e2e"),
): Promise<string> {
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
  attention: "Attention Admin",
  extends: "Grant Admin",
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

/**
 * Opens what a phone folds away behind a "Show the..." button (the import review screen's
 * original), and does nothing where it's already shown. Waits for the button or the content
 * first: deciding the moment the page appears skips the button while it's still being drawn.
 */
export async function showFolded(show: Locator, content: Locator): Promise<void> {
  await expect(show.or(content).first()).toBeVisible();
  if (await show.isVisible()) await show.click();
  await expect(content.first()).toBeVisible();
}

/** A software passkey device, so a test can create and use passkeys without a person. */
export async function addVirtualAuthenticator(context: BrowserContext, page: Page): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

/**
 * Signs in to the admin console as this test's admin account, adding its passkey (which also
 * signs in with it), so the passkey sign-in is fresh for tools that ask for it again.
 */
export async function signInAdmin(
  page: Page,
  context: BrowserContext,
  testInfo: { project: { name: string }; retry: number },
  label: AdminLabel,
): Promise<void> {
  const email = adminEmail(testInfo, label);
  await context.clearCookies();
  await addVirtualAuthenticator(context, page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Admin console" })).toBeVisible();
}
