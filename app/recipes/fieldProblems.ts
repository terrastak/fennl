import type { RecipeIssue } from "../../shared/recipe";
import { issueMessage } from "./editing";

// Tying the editor's fields to their problems (phase C6), shared with the import review screen.

/** Problems for one field (its path, or anything under it). */
export function problemsFor(issues: RecipeIssue[], path: string): string[] {
  const matching = issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));
  return [...new Set(matching.map(issueMessage))];
}

/** The attributes that tie a field to its hint and problems. */
export function described(id: string, hint: boolean, problems: string[]) {
  const ids = [hint ? `${id}-hint` : "", problems.length > 0 ? `${id}-problem` : ""];
  const describedBy = ids.filter(Boolean).join(" ");
  return {
    id,
    "aria-invalid": problems.length > 0 ? true : undefined,
    "aria-describedby": describedBy || undefined,
  };
}
