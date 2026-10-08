import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

/** Sign-in for the admin console: passkeys, plus email and password to set up the first one. */
export const adminAuthClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [passkeyClient()],
});

export type AdminState =
  | { kind: "loading" }
  | { kind: "closed" }
  | { kind: "signed_out"; expired: boolean }
  | { kind: "not_admin" }
  | { kind: "impersonating" }
  | { kind: "passkey_setup" }
  | { kind: "passkey_sign_in" }
  | { kind: "ready"; me: AdminMe }
  | { kind: "error" };

export interface AdminMe {
  name: string;
  email: string;
  signedInAt: string;
  expiresAt: string;
  passkeys: { id: string; name: string | null; createdAt: string | null }[];
}

export interface AuditRow {
  id: string;
  action: string;
  createdAt: string;
  details: {
    method?: string;
    code?: string;
    ip?: string | null;
    country?: string | null;
  } | null;
}

/** Asks the server what the admin console should show (the checks live in worker/admin). */
export async function loadAdminState(): Promise<AdminState> {
  try {
    const res = await fetch("/api/admin/me");
    if (res.ok) return { kind: "ready", me: (await res.json()) as AdminMe };
    const body = (await res.json().catch(() => ({}))) as { error?: string; canRegister?: boolean };
    switch (body.error) {
      case "access_required":
        return { kind: "closed" };
      case "signed_out":
        return { kind: "signed_out", expired: false };
      case "session_expired":
        return { kind: "signed_out", expired: true };
      case "not_admin":
        return { kind: "not_admin" };
      case "impersonating":
        return { kind: "impersonating" };
      case "passkey_required":
        return body.canRegister ? { kind: "passkey_setup" } : { kind: "passkey_sign_in" };
      default:
        return { kind: "error" };
    }
  } catch {
    return { kind: "error" };
  }
}
