/**
 * Remembers which address we just emailed, for the "Check your email" page (it survives a reload
 * of that tab). Kept out of the page address so it doesn't end up in logs.
 */
const KEY = "fennl:pending-email";

export function rememberPendingEmail(email: string): void {
  try {
    sessionStorage.setItem(KEY, email);
  } catch {
    // Storage can be unavailable (private mode); the page then asks for the address instead.
  }
}

export function pendingEmail(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
