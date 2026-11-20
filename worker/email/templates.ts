import type { EmailContent } from "./email";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );
}

/** A paragraph: plain text, or parts of it in bold. A line break ("\n") is kept. */
type Paragraph = string | Array<string | { bold: string }>;

function paragraphText(p: Paragraph): string {
  return typeof p === "string"
    ? p
    : p.map((part) => (typeof part === "string" ? part : part.bold)).join("");
}

function paragraphHtml(p: Paragraph): string {
  const parts = typeof p === "string" ? [p] : p;
  const inner = parts
    .map((part) =>
      typeof part === "string" ? escapeHtml(part) : `<strong>${escapeHtml(part.bold)}</strong>`,
    )
    .join("")
    .replace(/\n/g, "<br>");
  return `<p style="margin:0 0 16px">${inner}</p>`;
}

/**
 * Plain, readable HTML with inline styles and no images or tracking, so it lands in inboxes. The
 * button, if any, comes after the paragraphs, then the paragraphs `after` it.
 */
function layout(
  paragraphs: Paragraph[],
  button?: { label: string; url: string } | { removed: string },
  after: Paragraph[] = [],
): string {
  const body = paragraphs.map(paragraphHtml).join("\n");
  const rest =
    after.length > 0
      ? `\n<div style="margin-top:24px">${after.map(paragraphHtml).join("\n")}</div>`
      : "";
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f6f5f0;color:#1d2420;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
<p style="margin:0 0 24px;font-size:20px;font-weight:600;color:#24406b">Fennl</p>
${body}
${button ? ("removed" in button ? removedHtml(button.removed) : buttonHtml(button)) : ""}${rest}
</div>
</body>
</html>`;
}

/** In Fennl's copy (U26), where a button whose link works like a key to the account was. */
function removedHtml(note: string): string {
  return `<p style="margin:24px 0;padding:8px 12px;border:1px dashed #b9bdb5;border-radius:8px;background:#f6f5f0;color:#5b625c;font-size:14px">${escapeHtml(note)}</p>`;
}

/**
 * An email whose button's link works like a key to the account (verifying an address, choosing a
 * password): the HTML sent, and Fennl's copy with the button replaced by a note saying what was
 * there (U26), so a copy in the database never holds a working link.
 */
function withSecretButton(
  paragraphs: Paragraph[],
  button: { label: string; url: string },
  removed: string,
  after: Paragraph[] = [],
): { html: string; copyHtml: string } {
  return {
    html: layout(paragraphs, button, after),
    copyHtml: layout(paragraphs, { removed }, after),
  };
}

function buttonHtml(button: { label: string; url: string }): string {
  const url = escapeHtml(button.url);
  return `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#24406b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(button.label)}</a></p>
<p style="margin:0;font-size:14px;color:#5b625c">If the button doesn't work, copy this link into your browser:<br><a href="${url}" style="color:#24406b;word-break:break-all">${url}</a></p>`;
}

function greeting(name: string): string {
  const first = name.trim();
  return first ? `Hi ${first},` : "Hi,";
}

export function verificationEmail(to: { email: string; name: string }, url: string): EmailContent {
  const lines = [
    greeting(to.name),
    "Please verify your email address to finish setting up your Fennl account. The link works for 24 hours.",
    "If you didn't create a Fennl account, you can ignore this email.",
  ];
  return {
    to: to.email,
    subject: "Verify your email for Fennl",
    text: `${lines[0]}\n\n${lines[1]}\n\n${url}\n\n${lines[2]}\n`,
    ...withSecretButton(
      lines,
      { label: "Verify my email", url },
      "The button to verify the email address was here. Its link is removed for safety.",
    ),
  };
}

export function passwordResetEmail(to: { email: string; name: string }, url: string): EmailContent {
  const lines = [
    greeting(to.name),
    "Someone asked to reset the password for your Fennl account. The link works for 1 hour.",
    "If that wasn't you, you can ignore this email. Your password won't change.",
  ];
  return {
    to: to.email,
    subject: "Reset your Fennl password",
    text: `${lines[0]}\n\n${lines[1]}\n\n${url}\n\n${lines[2]}\n`,
    ...withSecretButton(
      lines,
      { label: "Choose a new password", url },
      "The button to choose a new password was here. Its link is removed for safety.",
    ),
  };
}

/** A short security notice to the owner. Plain, with no links to click. */
export function adminAlertEmail(to: string, subject: string, lines: string[]): EmailContent {
  const closing =
    "If this wasn't you, change the admin account's password and remove its passkeys right away.";
  return ownerNoticeEmail(to, subject, [...lines, closing]);
}

/** A plain notice to the owner (ADMIN_ALERT_EMAIL), such as the AI's monthly cost (phase E7). */
export function ownerNoticeEmail(to: string, subject: string, paragraphs: string[]): EmailContent {
  return {
    to,
    subject,
    text: `${paragraphs.join("\n")}\n`,
    html: `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f6f5f0;color:#1d2420;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#24406b">${escapeHtml(subject)}</p>
${paragraphs.map((p) => `<p style="margin:0 0 8px">${escapeHtml(p)}</p>`).join("\n")}
</div>
</body>
</html>`,
  };
}

/**
 * Tells someone that Fennl support set a temporary password on their account (phase B7). The
 * password itself is never emailed; support gives it to the person directly.
 */
export function temporaryPasswordEmail(
  to: { email: string; name: string },
  signInUrl: string,
): EmailContent {
  const lines = [
    greeting(to.name),
    "Fennl support has set a temporary password on your account, as you asked. When you next sign in with it, you'll choose a new password of your own.",
    "If you didn't ask for help with your password, reply to this email so we can look into it.",
  ];
  return {
    to: to.email,
    subject: "Your Fennl password was reset by support",
    text: `${lines.join("\n\n")}\n\nSign in: ${signInUrl}\n`,
    html: layout(lines, { label: "Sign in to Fennl", url: signInUrl }),
  };
}

/**
 * The link that makes a new address the account's email (phase B7a), sent to the new address.
 * Until it's opened, the account keeps its old address.
 */
export function emailChangeEmail(
  to: { email: string; name: string },
  url: string,
  bySupport: boolean,
): EmailContent {
  const lines = [
    greeting(to.name),
    bySupport
      ? "Fennl support is changing your account's email to this address, as you asked. Please verify it to finish. The link works for 24 hours."
      : "Please verify this address to make it the email for your Fennl account. The link works for 24 hours.",
    "Until you do, your account keeps its current email. If you didn't ask for this, you can ignore this email.",
  ];
  return {
    to: to.email,
    subject: "Verify your new email for Fennl",
    text: `${lines[0]}\n\n${lines[1]}\n\n${url}\n\n${lines[2]}\n`,
    ...withSecretButton(
      lines,
      { label: "Verify my new email", url },
      "The button to verify the new email address was here. Its link is removed for safety.",
    ),
  };
}

/**
 * The security notice sent to the old address once a change takes effect. It shows only part of
 * the new address, and has nothing to click.
 */
export function emailChangedNotice(
  to: { email: string; name: string },
  maskedNewEmail: string,
): EmailContent {
  const lines = [
    greeting(to.name),
    `The email address for your Fennl account was just changed to ${maskedNewEmail}. From now on, sign in with the new address.`,
    "If you made this change, there's nothing more to do. If you didn't, reply to this email right away so we can secure your account.",
  ];
  return {
    to: to.email,
    subject: "Your Fennl email address was changed",
    text: `${lines.join("\n\n")}\n`,
    html: layout(lines),
  };
}

/** "January 7, 2027", the same wherever the scheduled job runs. */
function longDate(when: Date): string {
  return when.toLocaleDateString("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  });
}

/** "January 7", for a date already given in full. */
function monthDay(when: Date): string {
  return when.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * What the person had before their plan stopped including photos, so the photo emails can say
 * what ended: free Premium from an invite or promo code, Premium given from the admin console
 * (both called a trial), a paid subscription (Stage I), or not known.
 */
export type PremiumEnded =
  { kind: "code" | "admin" | "subscription"; endedAt: Date } | { kind: "unknown" };

const SIGN_OFF = "Happy cooking,\nThe Fennl team";

/** The photo emails' button: the Account page for now (codes), checkout once billing exists. */
function subscribeButton(accountUrl: string | null) {
  return accountUrl ? { label: "Subscribe to Premium", url: accountUrl } : undefined;
}

/** The plain-text version of an email with a button between its paragraphs. */
function plainText(
  before: Paragraph[],
  button: { label: string; url: string } | undefined,
  after: Paragraph[],
): string {
  const parts = [...before.map(paragraphText)];
  if (button) parts.push(`${button.label}: ${button.url}`);
  parts.push(...after.map(paragraphText));
  return `${parts.join("\n\n")}\n`;
}

/** How to keep the photos, by what ended (wording approved by the owner 2026-11-20). */
function keepPhotos(ended: PremiumEnded, before: string, again: boolean): Paragraph {
  if (ended.kind === "subscription") {
    return [
      {
        bold: `To keep your photos, you can subscribe to Premium${again ? " again" : ""} before ${before}.`,
      },
      " If you have any questions, just reply to this email and we'll help.",
    ];
  }
  return [
    { bold: `To keep your photos, you can subscribe to Premium before ${before}.` },
    " If you have a new code, you can add it on your Account page. If you need more time to try Premium, just reply to this email and we'll help.",
  ];
}

/**
 * The start of the 90-day photo grace period (phase D3): the person's Premium ended, so their
 * plan no longer includes photos. Says what ended (a trial from a code, or a subscription), that
 * the photos are kept until the date and then permanently deleted, and how to keep them. The
 * button opens the Account page (`accountUrl`; none where the app's address isn't known).
 */
export function photoGraceStartedEmail(
  to: { email: string; name: string },
  deleteAfter: Date,
  ended: PremiumEnded,
  accountUrl: string | null,
): EmailContent {
  const date = longDate(deleteAfter);
  const before = monthDay(deleteAfter);
  const subject =
    ended.kind === "subscription"
      ? "Your Fennl Premium subscription has ended."
      : ended.kind === "unknown"
        ? "Your Fennl Premium has ended."
        : "Your Fennl Premium trial has ended.";
  const what =
    ended.kind === "code"
      ? `Thank you for trying Fennl Premium. Your free trial from your invite code ended on ${longDate(ended.endedAt)}, so your account is now on Fennl Free.`
      : ended.kind === "admin"
        ? `Thank you for trying Fennl Premium. Your free Premium trial ended on ${longDate(ended.endedAt)}, so your account is now on Fennl Free.`
        : ended.kind === "subscription"
          ? `Thank you for being a Fennl Premium subscriber. Your subscription ended on ${longDate(ended.endedAt)}, so your account is now on Fennl Free.`
          : "Thank you for using Fennl Premium. Your account no longer has Premium, so it's now on Fennl Free.";
  const lines: Paragraph[] = [
    greeting(to.name),
    what,
    "Your recipes are all still here, and they always will be. You can keep opening, cooking from and editing them just as before.",
    [
      "Fennl Free doesn't include photos, so we'll keep the photos you've added safe for 90 days, until ",
      { bold: date },
      ". After that date, they will be permanently deleted. Until then you can see them as usual, and download them with your recipes any time from Settings › Download your recipes.",
    ],
    keepPhotos(ended, before, true),
  ];
  const after: Paragraph[] = [
    `If you'd rather stay on the free plan, please download any photos you want to keep before ${before}. We'll send you a reminder before then.`,
    SIGN_OFF,
  ];
  const button = subscribeButton(accountUrl);
  return {
    to: to.email,
    subject,
    text: plainText(lines, button, after),
    html: layout(lines, button, after),
  };
}

/**
 * A reminder during the photo grace period (phase D3), at 30, 7 and 1 days left: the photos are
 * kept until the date, then permanently deleted (the last one says they're deleted tomorrow).
 */
export function photoGraceReminderEmail(
  to: { email: string; name: string },
  deleteAfter: Date,
  daysLeft: number,
  ended: PremiumEnded,
  accountUrl: string | null,
): EmailContent {
  const date = longDate(deleteAfter);
  const tomorrow = daysLeft <= 1;
  const lines: Paragraph[] = [
    greeting(to.name),
    tomorrow
      ? [
          "Just a reminder: the photos you've added to Fennl recipes will be permanently deleted tomorrow, ",
          { bold: date },
          ".",
        ]
      : [
          "Just a reminder: the photos you've added to Fennl recipes are kept until ",
          { bold: date },
          `, ${daysLeft} days from now. After that date, they will be permanently deleted.`,
        ],
    // Bold only in the first email; here the date above is the one to see.
    paragraphText(keepPhotos(ended, "then", false)),
  ];
  const after: Paragraph[] = [
    "If you'd rather stay on the free plan, please download any photos you want to keep from Settings › Download your recipes. Your recipes themselves are never deleted.",
    SIGN_OFF,
  ];
  const button = subscribeButton(accountUrl);
  return {
    to: to.email,
    subject: tomorrow
      ? "Your Fennl photos will be deleted tomorrow"
      : `A reminder: your Fennl photos are kept until ${date}`,
    text: plainText(lines, button, after),
    html: layout(lines, button, after),
  };
}
