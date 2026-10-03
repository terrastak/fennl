import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { devOutbox } from "../email/outbox";
import app from "../index";
import { ORIGIN, PASSWORD as password, linkInLatestEmail, signUp, visitor } from "../test/visitor";
import { signInMethods } from "./auth";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("sign-up and email verification", () => {
  it("sends a confirmation email, and only a confirmed address can sign in", async () => {
    const email = "june@example.com";
    const v = await signUp(email);
    expect(await v.session()).toBeNull();

    const [mail] = devOutbox.list(email);
    expect(mail?.subject).toBe("Confirm your email for Fennl");
    expect(mail?.html).toContain("Confirm my email");

    const early = await v.request("/api/auth/sign-in/email", { body: { email, password } });
    expect(early.status).toBe(403);
    expect(await early.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });

    const confirm = await v.request(linkInLatestEmail(email));
    expect(confirm.status).toBe(302);
    expect(confirm.headers.get("location")).toBe("/");
    // Confirming signs you in.
    expect(await v.session()).toMatchObject({ user: { email, emailVerified: true } });
  });

  it("signs out and back in", async () => {
    const email = "rose@example.com";
    const v = await signUp(email);
    await v.request(linkInLatestEmail(email));

    expect((await v.request("/api/auth/sign-out", { body: {} })).status).toBe(200);
    expect(await v.session()).toBeNull();

    const wrong = await v.request("/api/auth/sign-in/email", {
      body: { email, password: "not the password" },
    });
    expect(wrong.status).toBe(401);

    const ok = await v.request("/api/auth/sign-in/email", { body: { email, password } });
    expect(ok.status).toBe(200);
    expect(await v.session()).toMatchObject({ user: { email } });
  });

  it("rejects passwords shorter than 8 characters", async () => {
    const res = await visitor().request("/api/auth/sign-up/email", {
      body: { name: "Dad", email: "dad@example.com", password: "short" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "PASSWORD_TOO_SHORT" });
  });
});

describe("password reset", () => {
  it("emails a link that sets a new password and ends old sessions", async () => {
    const email = "nana@example.com";
    const v = await signUp(email);
    await v.request(linkInLatestEmail(email));

    const other = visitor();
    const ask = await other.request("/api/auth/request-password-reset", {
      body: { email, redirectTo: "/reset-password" },
    });
    expect(ask.status).toBe(200);
    expect(devOutbox.list(email)[0]?.subject).toBe("Reset your Fennl password");

    const open = await other.request(linkInLatestEmail(email));
    expect(open.status).toBe(302);
    const target = new URL(open.headers.get("location")!, ORIGIN);
    expect(target.pathname).toBe("/reset-password");
    const token = target.searchParams.get("token");
    expect(token).toBeTruthy();

    const newPassword = "a much better password";
    const reset = await other.request("/api/auth/reset-password", {
      body: { newPassword, token },
    });
    expect(reset.status).toBe(200);

    expect(await v.session()).toBeNull();
    const old = await other.request("/api/auth/sign-in/email", { body: { email, password } });
    expect(old.status).toBe(401);
    const fresh = await other.request("/api/auth/sign-in/email", {
      body: { email, password: newPassword },
    });
    expect(fresh.status).toBe(200);
  });

  it("answers the same whether or not the address has an account", async () => {
    const res = await visitor().request("/api/auth/request-password-reset", {
      body: { email: "nobody@example.com", redirectTo: "/reset-password" },
    });
    expect(res.status).toBe(200);
    expect(devOutbox.list("nobody@example.com")).toEqual([]);
  });
});

describe("rate limits", () => {
  it("slows down repeated sign-in attempts from one address, without blocking others", async () => {
    const attacker = visitor("198.51.100.7");
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await attacker.request("/api/auth/sign-in/email", {
        body: { email: "june@example.com", password: `guess ${i}` },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);

    const someoneElse = await visitor("198.51.100.8").request("/api/auth/sign-in/email", {
      body: { email: "june@example.com", password: "another guess" },
    });
    expect(someoneElse.status).toBe(401);
  });
});

describe("sign-in methods", () => {
  it("offers Google and Apple only when they're fully set up", () => {
    expect(signInMethods(env)).toEqual({ email: true, google: false, apple: false });
    expect(
      signInMethods({ ...env, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }),
    ).toMatchObject({ google: true, apple: false });
    expect(
      signInMethods({ ...env, APPLE_CLIENT_ID: "id", APPLE_TEAM_ID: "team", APPLE_KEY_ID: "key" }),
    ).toMatchObject({ apple: false });
  });

  it("is published for the app", async () => {
    const res = await visitor().request("/api/sign-in-methods");
    expect(await res.json()).toEqual({ email: true, google: false, apple: false });
  });
});

describe("dev outbox", () => {
  it("is closed when real email is configured", async () => {
    const res = await app.request("/api/dev/outbox", {}, { ...env, RESEND_API_KEY: "re_x" });
    expect(res.status).toBe(404);
    const off = await app.request("/api/dev/outbox", {}, { ...env, DEV_EMAIL_OUTBOX: undefined });
    expect(off.status).toBe(404);
  });
});
