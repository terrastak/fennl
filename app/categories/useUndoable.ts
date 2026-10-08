import { useState } from "react";
import type { SyncChange } from "../../shared/sync";
import { saveChanges } from "../sync/useSync";
import { restamp, type Plan } from "./tree";

// The last change made on a page (categories, filing, a recipe moved to Trash), and how to take
// it back (shown by UndoBar.tsx).

export interface Done {
  message: string;
  undo: SyncChange[];
}

/** Saves a plan, and remembers how to take it back. `first` is something done before it opened. */
export function useUndoable(first: () => Done | null = () => null) {
  const [done, setDone] = useState<Done | null>(first);
  const [failed, setFailed] = useState(false);

  const run = async (plan: Plan, message: string): Promise<boolean> => {
    if (plan.changes.length === 0) return true;
    const ok = await saveChanges(plan.changes);
    setFailed(!ok);
    if (ok) setDone({ message, undo: plan.undo });
    return ok;
  };

  const undo = async () => {
    if (!done) return;
    const ok = await saveChanges(restamp(done.undo, Date.now()));
    setFailed(!ok);
    if (ok) setDone({ message: "Undone.", undo: [] });
  };

  return { done, failed, run, undo };
}
