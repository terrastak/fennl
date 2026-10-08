import { useState } from "react";
import { PageHeader } from "../pages/PageHeader";
import { Link } from "../router";
import type { TrashItem } from "../sync/dbProtocol";
import { canEdit } from "../sync/status";
import { activeSyncClient, useSyncStatus, useTrash } from "../sync/useSync";
import { dayText, localDay, trashText } from "./format";
import styles from "./recipes.module.css";

// Trash (phase C9): recipes moved to Trash, each kept for 30 days and then deleted for good
// (worker/sync/trash.ts). Each can be put back, or deleted for good now; "Empty Trash" deletes
// them all. Deleting for good needs a connection, since the server does it.

const recipesText = (n: number) => `${n} ${n === 1 ? "recipe" : "recipes"}`;

async function putBack(item: TrashItem): Promise<boolean> {
  try {
    await activeSyncClient()?.save({
      kind: "recipe",
      id: item.id,
      fields: {},
      deleted: false,
      changedAt: Date.now(),
    });
    return true;
  } catch {
    return false;
  }
}

/** "Delete … for good?", asked right where the button was. */
function Confirm({
  question,
  action,
  busy,
  onConfirm,
  onCancel,
}: {
  question: string;
  action: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={styles.confirm} role="group" aria-label={question}>
      <p>{question} This can&rsquo;t be undone.</p>
      <div className={styles.trashButtons}>
        <button
          type="button"
          className={styles.dangerButton}
          disabled={busy}
          autoFocus
          onClick={onConfirm}
        >
          {busy ? "Deleting…" : action}
        </button>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function TrashPage() {
  const items = useTrash();
  const status = useSyncStatus();
  const editable = canEdit(status);
  const online = status.phase !== "offline" && status.phase !== "starting";
  /** Which "delete for good" is being asked about: one recipe's ID, or "all". */
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const restore = async (item: TrashItem) => {
    setMessage(
      (await putBack(item))
        ? `Put “${item.title || "Untitled"}” back in your recipes.`
        : "Couldn’t put it back just now. Please try again.",
    );
  };

  const deleteForGood = async (recipeIds: string[] | undefined) => {
    setBusy(true);
    try {
      const n = (await activeSyncClient()?.emptyTrash(recipeIds)) ?? 0;
      setMessage(`Deleted ${recipesText(n)} for good.`);
    } catch {
      setMessage("Deleting for good needs a connection. Please try again when you’re online.");
    } finally {
      setBusy(false);
      setAsking(null);
    }
  };

  const list = items ?? [];
  return (
    <>
      <Link href="/" className={styles.back}>
        ← All recipes
      </Link>
      <PageHeader title="Trash">
        <p>
          Recipes stay here for 30 days, then they&rsquo;re deleted for good. Until then you can put
          them back.
        </p>
      </PageHeader>
      <p role="status" className={styles.trashMessage}>
        {message}
      </p>

      {items === null ? null : list.length === 0 ? (
        <p className={styles.hint}>Trash is empty.</p>
      ) : (
        <>
          <div className={styles.trashTop}>
            {asking === "all" ? (
              <Confirm
                question={`Delete all ${recipesText(list.length)} in Trash for good?`}
                action="Empty Trash"
                busy={busy}
                onConfirm={() => void deleteForGood(undefined)}
                onCancel={() => setAsking(null)}
              />
            ) : (
              <button
                type="button"
                className={styles.secondary}
                disabled={!online || busy}
                onClick={() => setAsking("all")}
              >
                Empty Trash
              </button>
            )}
            {!online ? (
              <span className={styles.hint}>Emptying Trash needs a connection.</span>
            ) : null}
          </div>
          <ul className={styles.trashList} aria-label="Recipes in Trash">
            {list.map((item) => (
              <li key={item.id} className={styles.trashItem}>
                <div className={styles.trashText}>
                  <Link href={`/recipes/${item.id}`} className={styles.trashTitle}>
                    {item.title || "Untitled"}
                  </Link>
                  <span className={styles.hint}>
                    {item.addedBy ? `Added by ${item.addedBy} · ` : ""}
                    Moved to Trash {dayText(localDay(new Date(item.deletedAt)))} ·{" "}
                    {trashText(item.deletedAt)}
                  </span>
                </div>
                {asking === item.id ? (
                  <Confirm
                    question={`Delete “${item.title || "Untitled"}” for good?`}
                    action="Delete for good"
                    busy={busy}
                    onConfirm={() => void deleteForGood([item.id])}
                    onCancel={() => setAsking(null)}
                  />
                ) : (
                  <div className={styles.trashButtons}>
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={!editable}
                      onClick={() => void restore(item)}
                    >
                      Put back<span className="visually-hidden"> {item.title}</span>
                    </button>
                    <button
                      type="button"
                      className={styles.textButton}
                      disabled={!online || busy}
                      onClick={() => setAsking(item.id)}
                    >
                      Delete for good<span className="visually-hidden"> {item.title}</span>
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
