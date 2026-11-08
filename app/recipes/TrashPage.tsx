import { useEffect, useId, useRef, useState } from "react";
import { NOTHING_LOST, restoreBlockedText } from "../limits/limitText";
import { reportRefused } from "../limits/reportRefused";
import { useAddBlocked } from "../limits/useLimits";
import { PageHeader } from "../pages/PageHeader";
import { DoneBar } from "../ui/DoneBar";
import { Link } from "../router";
import type { TrashItem } from "../sync/dbProtocol";
import { canEdit } from "../sync/status";
import { activeSyncClient, useSyncStatus, useTrash } from "../sync/useSync";
import { CardFace } from "./CardFace";
import { dayText, localDay, trashText } from "./format";
import { LaptopIcon } from "./LaptopIcon";
import { LAPTOP_ICONS } from "./laptopIcons";
import styles from "./recipes.module.css";
import { usePointer } from "./usePointer";

// Trash (phase C9): recipes moved to Trash, each kept for 30 days and then deleted for good
// (worker/sync/trash.ts). Each can be put back, or deleted for good now; "Empty Trash" deletes
// them all. Deleting for good needs a connection, since the server does it.
//
// On a laptop (U23, owner's choices 2026-11-07): the recipes in one white box of rows, Put back
// and Delete for good quiet buttons with small icons, "Empty Trash…" in red words beside the
// count, the question in a pale red strip under its row (a soft red "Delete for good" with the
// keyboard focus, then Cancel in plain words), and what happened in the shared done bar above
// the list. Phones keep the page as it was.
//
// U24 (owner's request 2026-11-08): on a laptop Trash uses the whole main area like the recipe
// list, and shows the recipes as the list's own cards in the list's grid (the photo or first
// letter, the title, stars and time, the categories), each saying when it went to Trash and how
// long it stays, with Put back and Delete for good as quiet words at its foot. Delete for good's
// question takes the foot of its card, in the same pale red; Empty Trash's stays under the count.

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
  const noteId = useId();
  return (
    <div className={styles.confirm} role="group" aria-label={question} aria-describedby={noteId}>
      <LaptopIcon path={WARNING} className={styles.confirmIcon} />
      <p>
        <span className={styles.confirmQuestion}>{question}</span>{" "}
        <span id={noteId} className={styles.confirmNote}>
          This can&rsquo;t be undone.
        </span>
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

/** One recipe in Trash as the recipe list's card, on a laptop (U24). */
function TrashCard({
  item,
  asking,
  busy,
  editable,
  online,
  onRestore,
  onAsk,
  onConfirm,
  onCancel,
}: {
  item: TrashItem;
  asking: boolean;
  busy: boolean;
  editable: boolean;
  online: boolean;
  onRestore: () => void;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const title = item.title || "Untitled";
  const titleId = `trash-title-${item.id}`;
  return (
    <li>
      <div className={`${styles.card} ${styles.trashCard} ${asking ? styles.trashAsking : ""}`}>
        {/* The photo and the title open the recipe, as the name does on a phone; named by its
            title alone, as before. */}
        <Link
          href={`/recipes/${item.id}`}
          className={styles.trashCardLink}
          aria-labelledby={titleId}
        >
          <CardFace recipe={{ ...item, title }} titleId={titleId} />
        </Link>
        <p className={styles.trashWhen}>
          <span>Moved to Trash {dayText(localDay(new Date(item.deletedAt)))}</span>{" "}
          <span>{trashText(item.deletedAt)}</span>
        </p>
        {asking ? (
          <Confirm
            question={`Delete “${title}” for good?`}
            action="Delete for good"
            busy={busy}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        ) : (
          <div className={`${styles.trashButtons} ${styles.trashCardButtons}`}>
            <button
              type="button"
              className={`${styles.primary} ${styles.putBack}`}
              disabled={!editable}
              onClick={onRestore}
            >
              <LaptopIcon path={LAPTOP_ICONS.undo} />
              Put back<span className="visually-hidden"> {title}</span>
            </button>
            <button
              type="button"
              className={`${styles.textButton} ${styles.deleteForGood}`}
              disabled={!online || busy}
              data-trash-delete={item.id}
              onClick={onAsk}
            >
              <LaptopIcon path={LAPTOP_ICONS.trash} />
              Delete for good<span className="visually-hidden"> {title}</span>
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

export function TrashPage() {
  const items = useTrash();
  const laptop = usePointer();
  const status = useSyncStatus();
  const editable = canEdit(status);
  const online = status.phase !== "offline" && status.phase !== "starting";
  /** Which "delete for good" is being asked about: one recipe's ID, or "all". */
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  /** The message says something went wrong (no green check in the done bar). */
  const [problem, setProblem] = useState(false);
  /** A new number moves the focus to the done bar's words, when the button pressed goes away. */
  const [focusKey, setFocusKey] = useState(0);
  const say = (text: string, wrong = false) => {
    setMessage(text);
    setProblem(wrong);
  };
  const sayAndFocus = (text: string, wrong = false) => {
    say(text, wrong);
    setFocusKey((key) => key + 1);
  };

  // A question closed with Cancel gives the focus back to the button that asked it, once the
  // button is back in the page.
  const page = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    const selector = focusAfter.current;
    if (!selector) return;
    focusAfter.current = null;
    page.current?.querySelector<HTMLElement>(selector)?.focus();
  });
  const cancel = (id: string) => {
    focusAfter.current =
      id === "all" ? "[data-trash-empty]" : `[data-trash-delete="${CSS.escape(id)}"]`;
    setAsking(null);
  };

  // Putting one back needs room under the plan's recipe limit (phase C11).
  const restoreBlocked = useAddBlocked(true);
  const restore = async (item: TrashItem) => {
    if (restoreBlocked && status.usage) {
      say(`${restoreBlockedText(status.usage)} ${NOTHING_LOST}`, true);
      reportRefused(restoreBlocked, "restore");
      return;
    }
    // Its card goes away, so the focus moves to what happened.
    if (await putBack(item)) sayAndFocus(`Put “${item.title || "Untitled"}” back in your recipes.`);
    else say("Couldn’t put it back just now. Please try again.", true);
  };

  const deleteForGood = async (recipeIds: string[] | undefined) => {
    setBusy(true);
    try {
      const n = (await activeSyncClient()?.emptyTrash(recipeIds)) ?? 0;
      // What was asked about goes away, so the focus moves to what happened.
      sayAndFocus(`Deleted ${recipesText(n)} for good.`);
    } catch {
      sayAndFocus(
        "Deleting for good needs a connection. Please try again when you’re online.",
        true,
      );
    } finally {
      setBusy(false);
      setAsking(null);
    }
  };

  const list = items ?? [];
  return (
    <div ref={page} className={styles.trashPage}>
      <Link href="/" className={styles.back}>
        ← All recipes
      </Link>
      <PageHeader title="Trash">
        <p>
          Recipes stay here for 30 days, then they&rsquo;re deleted for good. Until then you can put
          them back.
        </p>
      </PageHeader>
      <DoneBar
        message={message}
        problem={problem}
        messageClassName={styles.trashMessage}
        focusKey={focusKey}
      />

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
                onCancel={() => cancel("all")}
              />
            ) : (
              <button
                type="button"
                className={`${styles.secondary} ${styles.emptyTrash}`}
                disabled={!online || busy}
                data-trash-empty
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
          <ul
            className={laptop ? `${styles.grid} ${styles.trashGrid}` : styles.trashList}
            aria-label="Recipes in Trash"
          >
            {list.map((item) =>
              laptop ? (
                <TrashCard
                  key={item.id}
                  item={item}
                  asking={asking === item.id}
                  busy={busy}
                  editable={editable}
                  online={online}
                  onRestore={() => void restore(item)}
                  onAsk={() => setAsking(item.id)}
                  onConfirm={() => void deleteForGood([item.id])}
                  onCancel={() => cancel(item.id)}
                />
              ) : (
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
                      onCancel={() => cancel(item.id)}
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
                        Put back
                        <span className="visually-hidden"> {item.title || "Untitled"}</span>
                      </button>
                      <button
                        type="button"
                        className={`${styles.textButton} ${styles.deleteForGood}`}
                        disabled={!online || busy}
                        data-trash-delete={item.id}
                        onClick={() => setAsking(item.id)}
                      >
                        <LaptopIcon path={LAPTOP_ICONS.trash} />
                        Delete for good
                        <span className="visually-hidden"> {item.title || "Untitled"}</span>
                      </button>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        </>
      )}
    </div>
  );
}
