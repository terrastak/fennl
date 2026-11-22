import { useEffect, useRef, useState } from "react";
import { Link } from "../../router";
import { activeSyncClient } from "../../sync/useSync";
import { CardQuestion } from "../CardQuestion";
import { LaptopIcon } from "../LaptopIcon";
import { LAPTOP_ICONS } from "../laptopIcons";
import styles from "../recipes.module.css";

// The recipe page of a recipe the person has a draft of (U27 part 3, C3 mockup): the saved recipe
// as always, with a pale warm strip at the top, "You have changes that aren't saved yet.", then
// Continue editing (navy words, as Edit does) and Discard (red words, asking first, in the strip,
// in Trash's pale red). Cook mode, printing, scaling and the list keep using the saved recipe.

export function DraftStrip({
  recipeId,
  editable,
  onDiscarded,
}: {
  recipeId: string;
  editable: boolean;
  /** The changes went: the strip goes with them, so the page says so and takes the focus. */
  onDiscarded: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  const discardButton = useRef<HTMLButtonElement>(null);
  // Cancel gives the focus back to Discard, once it's back in the page.
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current || asking) return;
    refocus.current = false;
    discardButton.current?.focus();
  }, [asking]);

  const discard = async () => {
    try {
      const client = activeSyncClient();
      if (!client) throw new Error("Not connected yet.");
      await client.discardDraft(recipeId);
      setAsking(false);
      onDiscarded();
    } catch {
      setFailed(true);
      setAsking(false);
    }
  };

  return (
    <div className={`${styles.draftStrip} ${asking ? styles.draftStripAsking : ""}`}>
      {asking ? (
        <CardQuestion
          question="Discard your changes?"
          note="The recipe goes back to how it was saved."
          action="Discard"
          onConfirm={() => void discard()}
          onCancel={() => {
            refocus.current = true;
            setAsking(false);
          }}
        />
      ) : (
        <>
          <LaptopIcon path={LAPTOP_ICONS.pen} className={styles.draftStripIcon} />
          <p role={failed ? "alert" : undefined}>
            {failed
              ? "Couldn’t discard your changes just now. Please try again."
              : "You have changes that aren’t saved yet."}
          </p>
          <div className={styles.draftStripButtons}>
            <Link href={`/recipes/${recipeId}/edit`} className={styles.continueEditing}>
              <LaptopIcon path={LAPTOP_ICONS.pen} />
              Continue editing
            </Link>
            <button
              ref={discardButton}
              type="button"
              className={styles.discardDraft}
              disabled={!editable}
              onClick={() => {
                setFailed(false);
                setAsking(true);
              }}
            >
              <LaptopIcon path={LAPTOP_ICONS.discard} />
              Discard<span className="visually-hidden"> your changes</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
