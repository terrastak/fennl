/** Turns a Better Auth error into plain English for the person at the keyboard. */
export function authErrorMessage(error: { code?: string | undefined; status?: number } | null) {
  if (!error) return "Something went wrong. Please try again.";
  if (error.status === 429) return "Too many tries. Please wait a minute, then try again.";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password don't match. Check them and try again.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "There's already an account with that email. Sign in instead, or reset your password.";
    case "PASSWORD_TOO_SHORT":
      return "Your password needs at least 8 characters.";
    case "PASSWORD_TOO_LONG":
      return "That password is too long. Please use 128 characters or fewer.";
    case "INVALID_EMAIL":
      return "That doesn't look like an email address.";
    case "INVALID_TOKEN":
      return "That link has expired or was already used. Please ask for a new one.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/** Errors that come back in the address after Google or Apple, or after an email link. */
export function linkErrorMessage(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "account_not_linked":
      return "That email already has a Fennl account. Sign in with your password first, then you can use Google or Apple too.";
    case "access_denied":
      return "Sign-in was cancelled.";
    case "invalid_token":
    case "INVALID_TOKEN":
    case "token_expired":
      return "That link has expired or was already used.";
    default:
      return "We couldn't sign you in that way. Please try again.";
  }
}
