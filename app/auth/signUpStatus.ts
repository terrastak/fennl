import { useEffect, useState } from "react";

/**
 * What the server knows about the sign-up link (phase U14), asked with the proof it gave this
 * browser at sign-up (an http-only cookie). It never says which address an account has.
 */
export type SignUpLinkState = "waiting" | "delayed" | "not_arriving" | "not_sent";

const STATES = new Set<string>(["waiting", "delayed", "not_arriving", "not_sent"]);

/** How often "Check your email" asks while the tab is in view. */
export const POLL_MS = 15_000;
/** When it stops asking (a link that hasn't come by then won't). */
export const POLL_FOR_MS = 30 * 60_000;

async function readState(): Promise<SignUpLinkState | null> {
  const res = await fetch("/api/sign-up/status").catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { state?: unknown } | null;
  return typeof body?.state === "string" && STATES.has(body.state)
    ? (body.state as SignUpLinkState)
    : null;
}

/**
 * The sign-up link's state, asked at once, then every 15 seconds while the tab is in view and
 * whenever it comes back into view, for 30 minutes or until the link can't arrive. A new `round`
 * (after the address is fixed) starts asking again.
 */
export function useSignUpLinkState(round: number): SignUpLinkState {
  const [answer, setAnswer] = useState<{ round: number; state: SignUpLinkState } | null>(null);

  useEffect(() => {
    let stopped = false;
    const startedAt = Date.now();

    const ask = async () => {
      if (stopped) return;
      if (Date.now() - startedAt > POLL_FOR_MS) {
        stop();
        return;
      }
      const next = await readState();
      if (stopped || next === null) return;
      setAnswer({ round, state: next });
      if (next === "not_arriving") stop();
    };
    const askIfInView = () => {
      if (document.visibilityState === "visible") void ask();
    };
    const timer = setInterval(askIfInView, POLL_MS);
    document.addEventListener("visibilitychange", askIfInView);
    function stop() {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", askIfInView);
    }

    void ask();
    return stop;
  }, [round]);

  return answer?.round === round ? answer.state : "waiting";
}

/** Why a new address couldn't be used. */
export type AddressProblem = "invalid_email" | "too_many" | "failed";

/** Moves the unverified account to a new address and sends the link there. */
export async function changeSignUpAddress(email: string): Promise<AddressProblem | null> {
  const res = await fetch("/api/sign-up/address", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  }).catch(() => null);
  if (res?.ok) return null;
  const body = (await res?.json().catch(() => null)) as { error?: string } | null;
  return body?.error === "invalid_email" || body?.error === "too_many" ? body.error : "failed";
}
