import type {
  ReadAgainError,
  ImportJobDetail,
  ImportJobSummary,
  ImportWebError,
  ImportWebResponse,
} from "../../shared/importJobs";

// The import routes (worker/import/routes.ts), for the Import page and the review screen.

export type ImportProblem = ImportWebError | "offline" | "failed";

/** Sends a web page to be read into drafts. */
export async function importWebPage(
  html: string,
  url: string | null,
): Promise<{ jobs: ImportJobSummary[] } | { problem: ImportProblem }> {
  let res: Response;
  try {
    res = await fetch("/api/import/web", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html, url }),
    });
  } catch {
    return { problem: "offline" };
  }
  if (res.ok) return (await res.json()) as ImportWebResponse;
  const error = ((await res.json().catch(() => ({}))) as { error?: ImportWebError }).error;
  return { problem: error ?? "failed" };
}

/** The drafts waiting for review. Null when they can't be fetched. */
export async function importJobs(): Promise<ImportJobSummary[] | null> {
  const res = await fetch("/api/import/jobs").catch(() => null);
  if (!res?.ok) return null;
  return ((await res.json()) as { jobs: ImportJobSummary[] }).jobs;
}

/** One draft. Null when it isn't there (saved elsewhere, discarded); undefined when offline. */
export async function importJob(id: string): Promise<ImportJobDetail | null | undefined> {
  const res = await fetch(`/api/import/jobs/${encodeURIComponent(id)}`).catch(() => null);
  if (!res) return undefined;
  if (res.status === 404) return null;
  if (!res.ok) return undefined;
  return (await res.json()) as ImportJobDetail;
}

export async function discardImportJob(id: string): Promise<boolean> {
  const res = await fetch(`/api/import/jobs/${encodeURIComponent(id)}/discard`, {
    method: "POST",
  }).catch(() => null);
  return Boolean(res?.ok || res?.status === 404);
}

/** The draft went into a recipe the household already had. */
export async function markImportSaved(id: string, recipeId: string): Promise<boolean> {
  const res = await fetch(`/api/import/jobs/${encodeURIComponent(id)}/saved`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipeId }),
  }).catch(() => null);
  return Boolean(res?.ok);
}

/** Where a draft's photo is shown from (the server fetches it from the page's site). */
export const inputUrl = (jobId: string, input: number) =>
  `/api/import/jobs/${encodeURIComponent(jobId)}/inputs/${input}`;

/** What to tell people when reading a page didn't work. */
export function importProblemText(problem: ImportProblem): string {
  switch (problem) {
    case "no_recipe":
      return "Fennl couldn't find a recipe in that page.";
    case "ai_import_not_included":
      return "That page doesn't publish its recipe details, so Fennl would have to read it with AI. Reading with AI is part of Premium.";
    case "monthly_limit":
      return "That page needs reading with AI, and this month's AI imports are used up. They start again on the 1st.";
    case "paused":
      return "That page needs reading with AI, which is paused for now. Please try again later.";
    case "ai_unavailable":
      return "Fennl couldn't read that page just now. Please try again in a few minutes.";
    case "page_too_large":
      return "That page is too large to import. Try saving it again as “Webpage, HTML only”.";
    case "import_not_included":
      return "Importing isn't part of your plan.";
    case "daily_limit":
      return "That's as many imports as your plan allows today. Try again tomorrow.";
    case "rate_limited":
      return "That's a lot of pages at once. Wait a minute, then try again.";
    case "offline":
      return "Importing needs a connection. Try again when you're back online.";
    case "invalid_request":
    case "failed":
      return "That page couldn't be imported. Please try again.";
  }
}

/** "Read again" (phase E7): the AI reads the draft's photos or page once more, with a stronger model. */
export async function readAgain(
  id: string,
): Promise<{ job: ImportJobDetail } | { problem: ReadAgainError | "offline" }> {
  let res: Response;
  try {
    res = await fetch(`/api/import/jobs/${encodeURIComponent(id)}/read-again`, { method: "POST" });
  } catch {
    return { problem: "offline" };
  }
  if (res.ok) return { job: (await res.json()) as ImportJobDetail };
  const error = ((await res.json().catch(() => ({}))) as { error?: ReadAgainError }).error;
  return { problem: error ?? "unavailable" };
}
