import { CODE_PROBLEMS, codeProblemMessage, type CodeProblem } from "../../shared/codes";

/**
 * Hands the sign-up code to the server before the account is made. The server checks it and keeps
 * it (in a short-lived cookie) for the moment the account is created, whichever way that happens.
 * Returns an error message, or null when all is well. An empty code clears any earlier one.
 */
export async function checkSignUpCode(code: string): Promise<string | null> {
  const trimmed = code.trim();
  try {
    if (!trimmed) {
      await fetch("/api/sign-up/code", { method: "DELETE" });
      return null;
    }
    const res = await fetch("/api/sign-up/code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: trimmed }),
    });
    if (res.ok) return null;
    return codeErrorMessage(await res.json().catch(() => ({})), res.status);
  } catch {
    return "We couldn't check that code. Check your connection and try again.";
  }
}

/** Plain English for an error from the code routes. */
export function codeErrorMessage(body: unknown, status: number): string {
  if (status === 429) return codeProblemMessage("rate_limited");
  const error = (body as { error?: unknown } | null)?.error;
  return (CODE_PROBLEMS as readonly unknown[]).includes(error)
    ? codeProblemMessage(error as CodeProblem)
    : codeProblemMessage("invalid");
}
