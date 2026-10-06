import { useEffect, useState } from "react";
import type { EmailChangeResult } from "../../shared/email";
import { queryParam } from "../navigation";
import { Link } from "../router";
import { AuthHeader } from "./AuthLayout";
import { useSession } from "./client";
import styles from "./auth.module.css";

/**
 * One request per link, even if the page renders twice (React's development mode): a second
 * request would find the link already used.
 */
const requests = new Map<string, Promise<EmailChangeResult | "failed">>();

function finishChange(token: string) {
  let request = requests.get(token);
  if (!request) {
    request = fetch("/api/account/email/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) =>
        res.ok ? ((await res.json()) as { result: EmailChangeResult }).result : "failed",
      )
      .catch(() => "failed" as const);
    requests.set(token, request);
  }
  return request;
}

const OUTCOMES: Record<Exclude<EmailChangeResult, "done"> | "failed", [string, string]> = {
  expired: [
    "That link has expired",
    "Links work for 24 hours. Your account still uses its previous email. You can ask for a new link in Settings.",
  ],
  invalid: [
    "That link didn't work",
    "It may have been used already, or replaced by a newer request. Your account's email hasn't changed.",
  ],
  in_use: [
    "That address is taken",
    "Another Fennl account uses that address now, so your email wasn't changed.",
  ],
  failed: ["Something went wrong", "We couldn't finish just now. Please open the link again."],
};

/** Where the link sent to a new email address lands (phase B7a). Works signed in or not. */
export function VerifyEmailChangePage() {
  const [token] = useState(() => queryParam("token") ?? "");
  const [result, setResult] = useState<EmailChangeResult | "failed" | null>(null);
  const { data: session, isPending, refetch } = useSession();

  useEffect(() => {
    let cancelled = false;
    void finishChange(token).then((outcome) => {
      if (cancelled) return;
      setResult(outcome);
      // A signed-in browser shows the new address straight away.
      if (outcome === "done") void refetch();
    });
    return () => {
      cancelled = true;
    };
  }, [token, refetch]);

  if (result === null) {
    return <AuthHeader title="Verifying your new email…" />;
  }

  const next = isPending ? null : (
    <Link href={session ? "/settings" : "/sign-in"} className={styles.button}>
      {session ? "Go to Settings" : "Sign in"}
    </Link>
  );

  if (result !== "done") {
    const [title, text] = OUTCOMES[result];
    return (
      <>
        <AuthHeader title={title}>
          <p>{text}</p>
        </AuthHeader>
        {next}
      </>
    );
  }

  return (
    <>
      <AuthHeader title="Your new email is verified" note="All set">
        <p>Your Fennl account now uses this address. Sign in with it from now on.</p>
      </AuthHeader>
      {next}
    </>
  );
}
