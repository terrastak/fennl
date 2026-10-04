import { useEffect, useState } from "react";

export interface SignInMethods {
  email: boolean;
  google: boolean;
  apple: boolean;
  /** Creating an account needs an invite code (invite-only sign-up, switched in the admin console). */
  signUpCodeRequired: boolean;
}

/** Asks the server which sign-in buttons this deployment supports. */
export function useSignInMethods(): SignInMethods {
  const [methods, setMethods] = useState<SignInMethods>({
    email: true,
    google: false,
    apple: false,
    signUpCodeRequired: true,
  });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/sign-in-methods", { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<SignInMethods>) : null))
      .then((body) => {
        if (body) setMethods(body);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return methods;
}
