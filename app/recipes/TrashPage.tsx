import { useState } from "react";
import { NOTHING_LOST, restoreBlockedText } from "../limits/limitText";
import { reportRefused } from "../limits/reportRefused";
import { useAddBlocked } from "../limits/useLimits";
import { PageHeader } from "../pages/PageHeader";
import { DoneBar } from "../ui/DoneBar";
import { Link } from "../router";
import type { TrashItem } from "../sync/dbProtocol";
import { canEdit } from "../sync/status";
import { activeSyncClient, useSyncStatus, useTrash } from "../sync/useSync";
import { dayText, localDay, trashText } from "./format";
import { LaptopIcon } from "./LaptopIcon";
import { LAPTOP_ICONS } from "./laptopIcons";
import styles from "./recipes.module.css";

// Trash (phase C9): recipes moved to Trash, each kept for 30 days and then deleted for good
// (worker/sync/trash.ts). Each can be put back, or deleted for good now; "Empty Trash" deletes
// them all. Deleting for good needs a connection, since the server does it.
//
// On a laptop (U23, owner's choices 2026-11-07): the recipes in one white box of rows, Put back
// and Delete for good quiet buttons with small icons, "Empty Trash…" in red words beside the
// count, the question in a pale red strip under its row (a soft red "Delete for good" with the
// keyboard focus, then Cancel in plain words), and what happened in the shared done bar above
// the list. Phones keep the page as it was.

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

/** A warning sign, beside the question on a laptop. */
const WARNING = "M12 4 2.5 20h19zM12 10v4M12 17.2v.1";

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
      <LaptopIcon path={WARNING} className={styles.confirmIcon} />
      <p>
        <span className={styles.confirmQuestion}>{question}</span>{" "}
        <span className={styles.confirmNote}>This can&rsquo;t be undone.</span>
      </p>
      <div className={styles.trashButtons}>
        <button
          type="button"
          className={styles.dangerButton}
          disabled={busy}
          autoFocus
          onClick={onConfirm}
        >
          <LaptopIcon path={LAPTOP_ICONS.trash} />
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
  /** The message says something went wrong (no green check in the done bar). */
  const [problem, setProblem] = useState(false);
  const say = (text: string, wrong = false) => {
    setMessage(text);
    setProblem(wrong);
  };

  // Putting one back needs room under the plan's recipe limit (phase C11).
  const restoreBlocked = useAddBlocked(true);
  const restore = async (item: TrashItem) => {
    if (restoreBlocked && status.usage) {
      say(`${restoreBlockedText(status.usage)} ${NOTHING_LOST}`, true);
      reportRefused(restoreBlocked, "restore");
      return;
    }
    if (await putBack(item)) say(`Put “${item.title || "Untitled"}” back in your recipes.`);
    else say("Couldn’t put it back just now. Please try again.", true);
  };

  const deleteForGood = async (recipeIds: string[] | undefined) => {
    setBusy(true);
    try {
      const n = (await activeSyncClient()?.emptyTrash(recipeIds)) ?? 0;
      say(`Deleted ${recipesText(n)} for good.`);
    } catch {
      say("Deleting for good needs a connection. Please try again when you’re online.", true);
    } finally {
      setBusy(false);
      setAsking(null);
    }
  };

  const list = items ?? [];
  return (
    <div className={styles.trashPage}>
      <Link href="/" className={styles.back}>
        ← All recipes
      </Link>
      <PageHeader title="Trash">
        <p>
          Recipes stay here for 30 days, then they&rsquo;re deleted for good. Until then you can put
          them back.
        </p>
      </PageHeader>
      <DoneBar message={message} problem={problem} messageClassName={styles.trashMessage} />

      {items === null ? null : list.length === 0 ? (
        <p className={styles.hint}>Trash is empty.</p>
      ) : (
        <>
          <div className={styles.trashTop}>
            <span className={styles.trashCount}>{recipesText(list.length)}</span>
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
                className={`${styles.secondary} ${styles.emptyTrash}`}
                disabled={!online || busy}
                onClick={() => setAsking("all")}
              >
                <LaptopIcon path={LAPTOP_ICONS.trash} />
                Empty Trash
                <span className={styles.laptopOnly} aria-hidden="true">
                  …
                </span>
              </button>
            )}
            {!online ? (
              <span className={styles.hint}>Emptying Trash needs a connection.</span>
            ) : null}
          </div>
          <ul className={styles.trashList} aria-label="Recipes in Trash">
            {list.map((item) => (
              <li
                key={item.id}
                className={`${styles.trashItem} ${asking === item.id ? styles.trashAsking : ""}`}
              >
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
                      className={`${styles.primary} ${styles.putBack}`}
                      disabled={!editable}
                      onClick={() => void restore(item)}
                    >
                      <LaptopIcon path={LAPTOP_ICONS.undo} />
                      Put back<span className="visually-hidden"> {item.title}</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.textButton} ${styles.deleteForGood}`}
                      disabled={!online || busy}
                      onClick={() => setAsking(item.id)}
                    >
                      <LaptopIcon path={LAPTOP_ICONS.trash} />
                      Delete for good<span className="visually-hidden"> {item.title}</span>
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
