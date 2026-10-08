import { useEffect } from "react";
import { useSession } from "./client";

// Who's signed in, when there's no connection to ask (phase C4b). With the app's files kept on
// the device, Fennl can open offline, but the sign-in check needs the server. So the app
// remembers the little it needs about the signed-in person, and uses it only when the server
// can't be reached. The sign-in itself stays in its http-only cookie; nothing secret is kept
// here. Once the server answers again, its answer is what counts.

const KEY = "fennl:last-session";

/** The parts of the session the app's frame uses. */
export interface AppSession {
  user: { id: string; name: string; email: string; mustChangePassword?: boolean | null };
  session: { id: string };
}

function remember(session: AppSession) {
  const kept: AppSession = {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      mustChangePassword: session.user.mustChangePassword ?? null,
    },
    session: { id: session.session.id },
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Storage not allowed: offline opening just won't know who was signed in.
  }
}

function forget() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}

function remembered(): AppSession | null {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? "null") as AppSession | null;
    return kept?.user.id && kept.session.id ? kept : null;
  } catch {
    return null;
  }
}

/** The server couldn't be reached (rather than saying "nobody is signed in"). */
function unreachable(error: unknown): boolean {
  if (!error) return false;
  const status = (error as { status?: number }).status;
  return !navigator.onLine || !status || status >= 500;
}

/**
 * The session, as useSession gives it, except that with no connection the last signed-in person
 * is used (`offline` is then true).
 */
export function useAppSession() {
  const result = useSession();
  const { data, isPending, error } = result;

  useEffect(() => {
    if (data) remember(data as AppSession);
    // The server said nobody is signed in here: forget whoever was.
    else if (!isPending && !error) forget();
  }, [data, isPending, error]);

  if (!data && !isPending && unreachable(error)) {
    const kept = remembered();
    if (kept) return { ...result, data: kept, offline: true as const };
  }
  return { ...result, data: data as AppSession | null | undefined, offline: false as const };
}
