import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailNotConfiguredError, createEmailSender } from "./email";
import { devOutbox } from "./outbox";
import { passwordResetEmail, verificationEmail } from "./templates";

afterEach(() => {
  vi.restoreAllMocks();
});

const baseEnv = { DEV_EMAIL_OUTBOX: undefined } as unknown as Env;

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
    await send({ to: "a@example.com", subject: "Hi", text: "Hello", html: "<p>Hello</p>" });

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
    const error = await send({ to: "a@example.com", subject: "s", text: "t", html: "h" }).catch(
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("domain not verified");
    expect(String(error)).not.toContain("re_secret");
  });

  it("keeps emails in the dev outbox only when asked to", async () => {
    const send = createEmailSender({ ...baseEnv, DEV_EMAIL_OUTBOX: "true" });
    await send({ to: "Outbox@Example.com", subject: "s", text: "t", html: "h" });
    expect(devOutbox.list("outbox@example.com")[0]?.subject).toBe("s");
  });

  it("fails clearly when nothing is configured", async () => {
    const send = createEmailSender(baseEnv);
    await expect(send({ to: "a@example.com", subject: "s", text: "t", html: "h" })).rejects.toThrow(
      EmailNotConfiguredError,
    );
  });
});
