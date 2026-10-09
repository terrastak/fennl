import type { EmailMessage } from "./email";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );
}

/** Plain, readable HTML with inline styles and no images or tracking, so it lands in inboxes. */
function layout(paragraphs: string[], button?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join("\n");
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f6f5f0;color:#1d2420;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
<p style="margin:0 0 24px;font-size:20px;font-weight:600;color:#24406b">Fennl</p>
${body}
${button ? buttonHtml(button) : ""}
</div>
</body>
</html>`;
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

export function verificationEmail(to: { email: string; name: string }, url: string): EmailMessage {
  const lines = [
    greeting(to.name),
    "Please verify your email address to finish setting up your Fennl account. The link works for 24 hours.",
    "If you didn't create a Fennl account, you can ignore this email.",
  ];
  return {
    to: to.email,
    subject: "Verify your email for Fennl",
    text: `${lines[0]}\n\n${lines[1]}\n\n${url}\n\n${lines[2]}\n`,
    html: layout(lines, { label: "Verify my email", url }),
  };
}

export function passwordResetEmail(to: { email: string; name: string }, url: string): EmailMessage {
  const lines = [
    greeting(to.name),
    "Someone asked to reset the password for your Fennl account. The link works for 1 hour.",
    "If that wasn't you, you can ignore this email. Your password won't change.",
  ];
  return {
    to: to.email,
    subject: "Reset your Fennl password",
    text: `${lines[0]}\n\n${lines[1]}\n\n${url}\n\n${lines[2]}\n`,
    html: layout(lines, { label: "Choose a new password", url }),
  };
}

/** A short security notice to the owner. Plain, with no links to click. */
export function adminAlertEmail(to: string, subject: string, lines: string[]): EmailMessage {
  const closing =
    "If this wasn't you, change the admin account's password and remove its passkeys right away.";
  const paragraphs = [...lines, closing];
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
): EmailMessage {
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
): EmailMessage {
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
    html: layout(lines, { label: "Verify my new email", url }),
  };
}

/**
 * The security notice sent to the old address once a change takes effect. It shows only part of
 * the new address, and has nothing to click.
 */
export function emailChangedNotice(
  to: { email: string; name: string },
  maskedNewEmail: string,
): EmailMessage {
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

/**
 * The start of the 90-day photo grace period (phase D3): the person's plan no longer includes
 * photos. Nothing to click; the app says the same in Settings.
 */
export function photoGraceStartedEmail(
  to: { email: string; name: string },
  deleteAfter: Date,
): EmailMessage {
  const date = longDate(deleteAfter);
  const lines = [
    greeting(to.name),
    `Your Fennl plan no longer includes photos, so the photos you've added to recipes will be kept until ${date}, then deleted.`,
    "Until then you can still see them, and download them with your recipes from Settings › Download your recipes.",
    `If you have Premium again before ${date}, your photos stay. Your recipes themselves are never deleted.`,
  ];
  return {
    to: to.email,
    subject: `Your Fennl photos are kept until ${date}`,
    text: `${lines.join("\n\n")}\n`,
    html: layout(lines),
  };
}

/** A reminder during the photo grace period (phase D3), some days before the photos go. */
export function photoGraceReminderEmail(
  to: { email: string; name: string },
  deleteAfter: Date,
  daysLeft: number,
): EmailMessage {
  const date = longDate(deleteAfter);
  const when = daysLeft <= 1 ? "tomorrow" : `in ${daysLeft} days`;
  const lines = [
    greeting(to.name),
    `The photos you've added to Fennl recipes will be deleted ${when}, on ${date}, because your plan no longer includes photos.`,
    "To keep a copy, download them with your recipes from Settings › Download your recipes.",
    `If you have Premium again before ${date}, your photos stay. Your recipes themselves are never deleted.`,
  ];
  return {
    to: to.email,
    subject: `Your Fennl photos will be deleted ${when}`,
    text: `${lines.join("\n\n")}\n`,
    html: layout(lines),
  };
}
