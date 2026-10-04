import type { EmailMessage } from "./email";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );
}

/** Plain, readable HTML with inline styles and no images or tracking, so it lands in inboxes. */
function layout(paragraphs: string[], button: { label: string; url: string }): string {
  const url = escapeHtml(button.url);
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join("\n");
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f6f5f0;color:#1d2420;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
<p style="margin:0 0 24px;font-size:20px;font-weight:600;color:#24406b">Fennl</p>
${body}
<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#24406b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(button.label)}</a></p>
<p style="margin:0;font-size:14px;color:#5b625c">If the button doesn't work, copy this link into your browser:<br><a href="${url}" style="color:#24406b;word-break:break-all">${url}</a></p>
</div>
</body>
</html>`;
}

function greeting(name: string): string {
  const first = name.trim();
  return first ? `Hi ${first},` : "Hi,";
}

export function verificationEmail(to: { email: string; name: string }, url: string): EmailMessage {
  const lines = [
    greeting(to.name),
    "Please confirm your email address to finish setting up your Fennl account. The link works for 24 hours.",
    "If you didn't create a Fennl account, you can ignore this email.",
  ];
  return {
    to: to.email,
    subject: "Confirm your email for Fennl",
    text: `${lines[0]}\n\n${lines[1]}\n\n${url}\n\n${lines[2]}\n`,
    html: layout(lines, { label: "Confirm my email", url }),
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
