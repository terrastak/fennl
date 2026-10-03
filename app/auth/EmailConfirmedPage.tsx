import { useState } from "react";
import { queryParam } from "../navigation";
import { Link } from "../router";
import { AuthHeader } from "./AuthLayout";
import { useSession } from "./client";
import { linkErrorMessage } from "./messages";
import styles from "./auth.module.css";

/** Where the link in a confirmation email lands, signed in (or with an error in the address). */
export function EmailConfirmedPage() {
  const [error] = useState(() => linkErrorMessage(queryParam("error")));
  const { data: session, isPending } = useSession();

  if (error) {
    return (
      <>
        <AuthHeader title="That link didn't work">
          <p>{error} Sign in, and we&rsquo;ll send you a fresh one.</p>
        </AuthHeader>
        <Link href="/sign-in" className={styles.button}>
          Go to sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeader title="Your email is confirmed" note="You're all set">
        <p>Thanks{session ? `, ${session.user.name}` : ""}. Your Fennl account is ready.</p>
      </AuthHeader>
      {isPending ? null : (
        <Link href={session ? "/" : "/sign-in"} className={styles.button}>
          {session ? "Go to your recipes" : "Sign in"}
        </Link>
      )}
    </>
  );
}
