import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../pages/PageHeader";
import { Link } from "../router";
import type { DraftItem } from "../sync/dbProtocol";
import { canEdit } from "../sync/status";
import { activeSyncClient, useDrafts, useSyncStatus } from "../sync/useSync";
import { DoneBar } from "../ui/DoneBar";
import { CardFace } from "./CardFace";
import { CardQuestion } from "./CardQuestion";
import { changedText, draftName, draftsText, startedText, untitledLabel } from "./drafts/draftText";
import { LaptopIcon } from "./LaptopIcon";
import { LAPTOP_ICONS } from "./laptopIcons";
import styles from "./recipes.module.css";

// Drafts (U27 part 3, owner's choices 2026-11-21 and 22): the person's own drafts, newest change
// first, as the recipe list's cards laid out as Trash's (U24), two across on a phone. A tag on
// the cover says "New recipe", or "Changes not saved" for a recipe already in the recipe box; a
// line says when it was last changed and, for a saved recipe, what changed (in the editor's
// section names). An untitled new recipe is named by what's typed so far and when it was started,
// so two never look the same. At the foot, Continue editing (navy words, as the photo and the
// title do) and Discard (red words, asking first in the card's foot, in Trash's pale red). No
// ink button and no line explaining drafts: the tags and the editor's "Draft saved" say it.

const discardQuestion = (item: DraftItem) =>
  item.isNew
    ? { question: "Discard this new recipe?", note: "It won’t be added to your recipes." }
    : { question: "Discard your changes?", note: "The recipe goes back to how it was saved." };

/** One draft, as the recipe list's card. */
function DraftCard({
  item,
  asking,
  editable,
  offline,
  onAsk,
  onConfirm,
  onCancel,
}: {
  item: DraftItem;
  asking: boolean;
  editable: boolean;
  offline: boolean;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = `draft-title-${item.recipeId}`;
  const href = `/recipes/${item.recipeId}/edit`;
  const name = draftName(item);
  return (
    <li>
      <div className={`${styles.card} ${styles.trashCard} ${asking ? styles.trashAsking : ""}`}>
        {/* The photo and the title open the editor on the draft, as Continue editing does. */}
        <Link
          href={href}
          className={styles.trashCardLink}
          aria-labelledby={`${titleId}-tag ${titleId}`}
          tabIndex={-1}
        >
          <CardFace
            recipe={{
              id: item.recipeId,
              title: item.title,
              cover: item.cover,
              addedBy: null,
              myRating: null,
              totalMinutes: item.totalMinutes,
              categories: item.categories,
              waiting: false,
              favorite: false,
            }}
            titleId={titleId}
            tag={item.isNew ? "New recipe" : "Changes not saved"}
            untitledHint={item.untitledHint}
          />
        </Link>
        <p className={styles.trashWhen}>
          <span>{changedText(item.editedAt, item.isNew ? null : item.parts)}</span>
          {!item.title ? <span>{startedText(item.startedAt)}</span> : null}
          {offline && !item.inAccount ? (
            <span>Not in your account yet · waiting to connect</span>
          ) : null}
        </p>
        {asking ? (
          <CardQuestion
            {...discardQuestion(item)}
            action="Discard"
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        ) : (
          <div className={`${styles.trashButtons} ${styles.trashCardButtons}`}>
            <Link href={href} className={`${styles.putBack} ${styles.continueEditing}`}>
              <LaptopIcon path={LAPTOP_ICONS.pen} />
              Continue editing<span className="visually-hidden"> {name}</span>
            </Link>
            <button
              type="button"
              className={`${styles.textButton} ${styles.deleteForGood} ${styles.discardDraft}`}
              disabled={!editable}
              data-draft-discard={item.recipeId}
              onClick={onAsk}
            >
              <LaptopIcon path={LAPTOP_ICONS.discard} />
              Discard<span className="visually-hidden"> {name}</span>
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

export function DraftsPage() {
  const items = useDrafts();
  const status = useSyncStatus();
  const editable = canEdit(status);
  const offline = status.phase === "offline";
  /** Which draft's Discard is being asked about. */
  const [asking, setAsking] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState(false);
  /** A new number moves the focus to the done bar's words, when the card pressed goes away. */
  const [focusKey, setFocusKey] = useState(0);

  // A question closed with Cancel gives the focus back to the Discard that asked it.
  const page = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    const selector = focusAfter.current;
    if (!selector) return;
    focusAfter.current = null;
    page.current?.querySelector<HTMLElement>(selector)?.focus();
  });
  const cancel = (id: string) => {
    focusAfter.current = `[data-draft-discard="${CSS.escape(id)}"]`;
    setAsking(null);
  };

  const discard = async (item: DraftItem) => {
    setAsking(null);
    try {
      await activeSyncClient()?.discardDraft(item.recipeId);
      setMessage(`Discarded “${item.title || untitledLabel(item.untitledHint)}”.`);
      setProblem(false);
    } catch {
      setMessage("Couldn’t discard it just now. Please try again.");
      setProblem(true);
    }
    setFocusKey((key) => key + 1);
  };

  const list = items ?? [];
  return (
    <div ref={page} className={`${styles.trashPage} ${styles.draftsPage}`}>
      <Link href="/" className={styles.back}>
        ← All recipes
      </Link>
      <PageHeader title="Drafts" />
      <DoneBar
        message={message}
        problem={problem}
        messageClassName={styles.trashMessage}
        focusKey={focusKey}
      />

      {items === null ? null : list.length === 0 ? (
        <p className={styles.hint}>No drafts.</p>
      ) : (
        <>
          <div className={styles.trashTop}>
            <span className={styles.trashCount}>{draftsText(list.length)}</span>
          </div>
          <ul className={`${styles.grid} ${styles.twoUp} ${styles.trashGrid}`} aria-label="Drafts">
            {list.map((item) => (
              <DraftCard
                key={item.recipeId}
                item={item}
                asking={asking === item.recipeId}
                editable={editable}
                offline={offline}
                onAsk={() => setAsking(item.recipeId)}
                onConfirm={() => void discard(item)}
                onCancel={() => cancel(item.recipeId)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
