import { useEffect, useState } from "react";
import { useSession } from "../auth/client";
import { actingEndsAt, isActing, stopActing, type ActingSession } from "./acting";
import styles from "./acting.module.css";

/**
 * The bright "Acting as …" bar on every page while an admin acts as someone (phase C12), with
 * when it ends and a way out. At the end time it leaves by itself.
 */
export function ActingBanner() {
  const { data } = useSession();
  const session = data as
    (ActingSession & { user: { id: string; name: string; email: string } }) | null;
  const acting = isActing(session);
  const endsAt = session && acting ? (actingEndsAt(session)?.getTime() ?? null) : null;
  const [leaving, setLeaving] = useState(false);
  const userId = session?.user.id ?? "";

  useEffect(() => {
    if (endsAt === null || !userId) return;
    const timer = setTimeout(() => void stopActing(userId), Math.max(0, endsAt - Date.now()));
    return () => clearTimeout(timer);
  }, [endsAt, userId]);

  if (!session || !acting) return null;
  const until =
    endsAt === null
      ? null
      : new Date(endsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <div className={styles.banner} role="region" aria-label="Acting as this person">
      <p>
        <strong>
          Acting as {session.user.name} ({session.user.email})
        </strong>
        . Every change is recorded under your name in the admin log.
        {until ? ` Ends at ${until}.` : ""}
      </p>
      <button
        type="button"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          void stopActing(userId);
        }}
      >
        {leaving ? "Stopping…" : `Stop acting as ${session.user.name}`}
      </button>
    </div>
  );
}
