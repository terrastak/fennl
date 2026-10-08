import { eq } from "drizzle-orm";
import type { SessionCreatedEvent } from "../auth/options";
import { database } from "../db/client";
import { user } from "../db/schema";
import { createEmailSender } from "../email/email";
import { adminAlertEmail } from "../email/templates";
import { recordAdminAction } from "./audit";

async function adminAccount(env: Env, userId: string) {
  const row = await database(env.DB)
    .select({ email: user.email, name: user.name, role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .get();
  return row?.role === "admin" ? row : undefined;
}

/** Emails the owner (ADMIN_ALERT_EMAIL) about something an admin account did. */
export async function alertOwner(env: Env, subject: string, lines: string[], request?: Request) {
  if (!env.ADMIN_ALERT_EMAIL) return;
  const where = request
    ? [
        `IP address: ${request.headers.get("cf-connecting-ip") ?? "unknown"} (${request.headers.get("cf-ipcountry") ?? "unknown country"})`,
        `Browser: ${request.headers.get("user-agent") ?? "unknown"}`,
        `Address: ${new URL(request.url).hostname}`,
      ]
    : [];
  await createEmailSender(env)(
    adminAlertEmail(env.ADMIN_ALERT_EMAIL, subject, [
      ...lines,
      `Time: ${new Date().toUTCString()}`,
      ...where,
    ]),
  );
}

/**
 * Better Auth calls these after every new session and every new passkey. They act only for
 * admin accounts: each admin sign-in and passkey is logged and emailed to the owner.
 * Failures are logged, not thrown, so a mail outage can't lock the owner out.
 */
export function adminEventHandlers(env: Env) {
  return {
    async onSessionCreated(event: SessionCreatedEvent) {
      try {
        const admin = await adminAccount(env, event.userId);
        if (!admin) return;
        await recordAdminAction(
          env,
          {
            adminUserId: event.userId,
            action: "admin.sign_in",
            details: { method: event.method, sessionId: event.sessionId },
          },
          event.request,
        );
        await alertOwner(
          env,
          "Fennl admin sign-in",
          [`The admin account ${admin.email} just signed in (${event.method}).`],
          event.request,
        );
      } catch (error) {
        console.error("Admin sign-in alert or log failed", error);
      }
    },
    async onPasskeyRegistered(userId: string, request: Request | undefined) {
      try {
        const admin = await adminAccount(env, userId);
        if (!admin) return;
        await recordAdminAction(
          env,
          { adminUserId: userId, action: "admin.passkey_registered" },
          request,
        );
        await alertOwner(
          env,
          "New passkey on a Fennl admin account",
          [`A new passkey was added to the admin account ${admin.email}.`],
          request,
        );
      } catch (error) {
        console.error("Admin passkey alert or log failed", error);
      }
    },
  };
}
