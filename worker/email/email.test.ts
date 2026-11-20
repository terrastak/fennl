import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailNotConfiguredError, createEmailSender } from "./email";
import { devOutbox } from "./outbox";
import {
  passwordResetEmail,
  photoGraceReminderEmail,
  photoGraceStartedEmail,
  verificationEmail,
} from "./templates";

afterEach(() => {
  vi.restoreAllMocks();
});

const baseEnv = { DEV_EMAIL_OUTBOX: undefined } as unknown as Env;
const about = { kind: "verification", userId: null } as const;

describe("email templates", () => {
  it("have a plain-text and an HTML version, each with the link", () => {
    const url = "https://app.example/api/auth/verify-email?token=abc&callbackURL=%2F";
    for (const mail of [
      verificationEmail({ email: "a@example.com", name: "June" }, url),
      passwordResetEmail({ email: "a@example.com", name: "June" }, url),
    ]) {
      expect(mail.to).toBe("a@example.com");
      expect(mail.text).toContain(url);
      expect(mail.text).toContain("Hi June,");
      expect(mail.html).toContain(url.replace(/&/g, "&amp;"));
    }
  });

  it("never lets a name inject HTML", () => {
    const mail = verificationEmail(
      { email: "a@example.com", name: '<img src=x onerror="alert(1)">' },
      "https://app.example/x",
    );
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
  });
});

describe("photo grace period emails (wording approved 2026-11-20)", () => {
  const to = { email: "a@example.com", name: "Tester" };
  const deleteAfter = new Date("2027-02-16T12:00:00Z");
  const endedAt = new Date("2026-11-18T12:00:00Z");
  const account = "https://app.example/account";

  it("say a code's Premium was a trial, when it ended, and when photos are deleted for good", () => {
    const mail = photoGraceStartedEmail(to, deleteAfter, { kind: "code", endedAt }, account);
    expect(mail.subject).toBe("Your Fennl Premium trial has ended.");
    expect(mail.text).toContain(
      "Thank you for trying Fennl Premium. Your free trial from your invite code ended on November 18, 2026, so your account is now on Fennl Free.",
    );
    expect(mail.text).toContain(
      "until February 16, 2027. After that date, they will be permanently deleted.",
    );
    expect(mail.text).toContain(
      "To keep your photos, you can subscribe to Premium before February 16. If you have a new code, you can add it on your Account page. If you need more time to try Premium, just reply to this email and we'll help.",
    );
    expect(mail.text).toContain(`Subscribe to Premium: ${account}`);
    expect(mail.text).toContain(
      "If you'd rather stay on the free plan, please download any photos you want to keep before February 16.",
    );
    expect(mail.text).toContain("Happy cooking,\nThe Fennl team");
    expect(mail.html).toContain("<strong>February 16, 2027</strong>");
    expect(mail.html).toContain(`href="${account}"`);
    expect(mail.html).toContain("Happy cooking,<br>The Fennl team");
    // The button comes before the last paragraphs.
    expect(mail.html.indexOf(account)).toBeLessThan(mail.html.indexOf("rather stay"));
  });

  it("word each reason Premium ended", () => {
    const started = (ended: Parameters<typeof photoGraceStartedEmail>[2]) =>
      photoGraceStartedEmail(to, deleteAfter, ended, account);
    const admin = started({ kind: "admin", endedAt });
    expect(admin.subject).toBe("Your Fennl Premium trial has ended.");
    expect(admin.text).toContain("Your free Premium trial ended on November 18, 2026");
    const paid = started({ kind: "subscription", endedAt });
    expect(paid.subject).toBe("Your Fennl Premium subscription has ended.");
    expect(paid.text).toContain(
      "Thank you for being a Fennl Premium subscriber. Your subscription ended on November 18, 2026",
    );
    expect(paid.text).toContain(
      "To keep your photos, you can subscribe to Premium again before February 16. If you have any questions, just reply to this email and we'll help.",
    );
    expect(paid.text).not.toContain("new code");
    const unknown = started({ kind: "unknown" });
    expect(unknown.subject).toBe("Your Fennl Premium has ended.");
    expect(unknown.text).toContain(
      "Thank you for using Fennl Premium. Your account no longer has Premium, so it's now on Fennl Free.",
    );
  });

  it("remind with the date, and say the photos are deleted tomorrow on the last day", () => {
    const code = { kind: "code", endedAt } as const;
    const week = photoGraceReminderEmail(to, deleteAfter, 7, code, account);
    expect(week.subject).toBe("A reminder: your Fennl photos are kept until February 16, 2027");
    expect(week.text).toContain(
      "are kept until February 16, 2027, 7 days from now. After that date, they will be permanently deleted.",
    );
    expect(week.text).toContain("If you need more time to try Premium");
    expect(week.text).toContain(`Subscribe to Premium: ${account}`);
    const last = photoGraceReminderEmail(to, deleteAfter, 1, code, account);
    expect(last.subject).toBe("Your Fennl photos will be deleted tomorrow");
    expect(last.text).toContain(
      "the photos you've added to Fennl recipes will be permanently deleted tomorrow, February 16, 2027.",
    );
    const paid = photoGraceReminderEmail(
      to,
      deleteAfter,
      30,
      { kind: "subscription", endedAt },
      account,
    );
    expect(paid.text).toContain("If you have any questions, just reply");
    expect(paid.text).not.toContain("new code");
  });

  it("leave the button out where the app's address isn't known", () => {
    const mail = photoGraceStartedEmail(to, deleteAfter, { kind: "unknown" }, null);
    expect(mail.text).not.toContain("Subscribe to Premium:");
    expect(mail.html).not.toContain("<a ");
  });
});

describe("sending email", () => {
  it("goes to Resend when it's configured", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "1" }), { status: 200 }));
    const send = createEmailSender({
      ...baseEnv,
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "Fennl <hello@mail.example.com>",
    });
    const sent = await send({
      to: "a@example.com",
      subject: "Hi",
      text: "Hello",
      html: "<p>Hello</p>",
      ...about,
    });
    // Resend's id for the email, which its events name (U14); kind and person stay with Fennl.
    expect(sent).toEqual({ id: "1" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init!.body as string)).toEqual({
      from: "Fennl <hello@mail.example.com>",
      to: ["a@example.com"],
      subject: "Hi",
      text: "Hello",
      html: "<p>Hello</p>",
    });
  });

  it("reports Resend's refusal without the API key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"message":"domain not verified"}', { status: 403 }),
    );
    const send = createEmailSender({ ...baseEnv, RESEND_API_KEY: "re_secret", EMAIL_FROM: "x" });
    const error = await send({
      to: "a@example.com",
      subject: "s",
      text: "t",
      html: "h",
      ...about,
    }).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("domain not verified");
    expect(String(error)).not.toContain("re_secret");
  });

  it("keeps emails in the dev outbox only when asked to", async () => {
    const send = createEmailSender({ ...baseEnv, DEV_EMAIL_OUTBOX: "true" });
    await send({ to: "Outbox@Example.com", subject: "s", text: "t", html: "h", ...about });
    expect(devOutbox.list("outbox@example.com")[0]?.subject).toBe("s");
  });

  it("fails clearly when nothing is configured", async () => {
    const send = createEmailSender(baseEnv);
    await expect(
      send({ to: "a@example.com", subject: "s", text: "t", html: "h", ...about }),
    ).rejects.toThrow(EmailNotConfiguredError);
  });
});
