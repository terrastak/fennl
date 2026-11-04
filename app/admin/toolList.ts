import type { AccountDetail } from "../../shared/adminAccounts";
import type { LimitKey } from "../../shared/entitlements";
import { firstName } from "./accountView";

// The account page's tools (phase U15): which ones it offers, and what a finding fills in.

export type ToolId =
  "view_as" | "premium" | "limits" | "email" | "sign_up" | "password" | "admin_log";

/** Values a finding's button fills in. */
export interface ToolPrefill {
  tier?: "individual" | "household" | undefined;
  limit?: LimitKey | undefined;
  value?: number | null | undefined;
  email?: string | undefined;
}

export interface OpenTool {
  id: ToolId;
  prefill: ToolPrefill;
}

/** Whether this is an email-and-password sign-up still waiting for its link. */
export function waitingSignUp(detail: AccountDetail): boolean {
  return !detail.emailVerified && detail.signInMethods.includes("credential");
}

/** The tool buttons, in the order the side card lists them. */
export function toolList(
  detail: AccountDetail,
): { id: ToolId; label: string; passkey: boolean; prefill?: ToolPrefill }[] {
  const isAdmin = detail.role === "admin";
  const first = firstName(detail.name) || "them";
  const tools: { id: ToolId; label: string; passkey: boolean; prefill?: ToolPrefill }[] = [];
  if (!isAdmin) tools.push({ id: "view_as", label: `View as ${first}`, passkey: true });
  if (detail.household) {
    tools.push({ id: "premium", label: "Extend or give Premium…", passkey: true });
    tools.push({ id: "limits", label: "Limit exceptions…", passkey: true });
  }
  if (waitingSignUp(detail)) {
    tools.push({ id: "sign_up", label: "Change the sign-up address…", passkey: true });
  } else {
    tools.push({ id: "email", label: "Email address…", passkey: true });
  }
  tools.push({ id: "password", label: "Password help…", passkey: false });
  tools.push({ id: "admin_log", label: "Admin log for this account…", passkey: false });
  return tools;
}

export const TOOL_TITLES: Record<ToolId, string> = {
  view_as: "View as this user",
  premium: "Extend or give Premium",
  limits: "Limits for this account",
  email: "Email address",
  sign_up: "Sign-up link",
  password: "Password help",
  admin_log: "Admin activity for this account",
};
