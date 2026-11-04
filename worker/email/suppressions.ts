/**
 * Taking an address off Resend's suppression list (phase U14), so the next email to it is tried
 * again ("This address is right", and U15's admin Unblock). Resend skips every email to an
 * address on that list, with no end date
 * (https://resend.com/docs/dashboard/emails/email-suppressions, checked 2026-11-04).
 *
 * The ONLY user of RESEND_MANAGE_KEY: removing needs a Resend key with Full access, which can
 * change anything in the Resend account, so it is never used for sending and never appears in a
 * log, an error or an answer.
 */

export type RemoveSuppressionResult = "removed" | "not_blocked" | "not_configured" | "failed";

const SUPPRESSIONS_API = "https://api.resend.com/suppressions/";

/** Resend's Remove Suppression (https://resend.com/docs/api-reference/suppressions/remove-suppression). */
export async function removeSuppression(
  env: Env,
  address: string,
): Promise<RemoveSuppressionResult> {
  const key = env.RESEND_MANAGE_KEY;
  if (!key) return "not_configured";
  let status: number;
  try {
    const res = await fetch(SUPPRESSIONS_API + encodeURIComponent(address), {
      method: "DELETE",
      // Resend refuses requests without a User-Agent.
      headers: { Authorization: `Bearer ${key}`, "User-Agent": "Fennl" },
    });
    status = res.status;
    await res.body?.cancel();
  } catch {
    console.error("Couldn't reach Resend to remove a suppression");
    return "failed";
  }
  if (status >= 200 && status < 300) return "removed";
  if (status === 404) return "not_blocked";
  console.error(`Resend didn't remove a suppression (${status})`);
  return "failed";
}
