import type {
  ReadAgainError,
  ImportJobDetail,
  ImportJobSummary,
  ImportPhotosError,
  ImportPhotosResponse,
  ImportTextError,
  ImportTextResponse,
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

/** Photos of one recipe's pages, already uploaded, to be read into drafts (phase E9). */
export async function importPhotoPages(
  hashes: string[],
  /** Every page is a screenshot (phase E11). */
  screenshots = false,
): Promise<{ jobs: ImportJobSummary[] } | { problem: ImportPhotosError | "offline" | "failed" }> {
  let res: Response;
  try {
    res = await fetch("/api/import/photos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pages: hashes, screenshots }),
    });
  } catch {
    return { problem: "offline" };
  }
  if (res.ok) return (await res.json()) as ImportPhotosResponse;
  const error = ((await res.json().catch(() => ({}))) as { error?: ImportPhotosError }).error;
  return { problem: error ?? "failed" };
}

/** What to tell people when reading photos didn't work. */
export function photoProblemText(problem: ImportPhotosError | "offline" | "failed"): string {
  switch (problem) {
    case "no_recipe":
      return "Fennl couldn't find a recipe in those photos. If they're blurry or dark, clearer ones may help.";
    case "ai_import_not_included":
      return "Reading recipes from photos is part of Premium.";
    case "monthly_limit":
      return "This month's AI imports are used up. They start again on the 1st.";
    case "paused":
      return "Reading with AI is paused for now. Please try again later.";
    case "ai_unavailable":
      return "Fennl couldn't read the photos just now. Please try again in a few minutes.";
    case "too_many_pages":
      return "That's more photos than one recipe takes. Remove a few and try again.";
    case "pages_too_large":
      return "Those photos are too large to read together. Remove a page or two and try again.";
    case "page_missing":
      return "One of the photos couldn't be found. Please try again.";
    case "rate_limited":
      return "That's a lot of recipes at once. Wait a minute, then try again.";
    case "offline":
      return "Importing needs a connection. Try again when you're back online.";
    case "invalid_request":
    case "failed":
      return "The photos couldn't be read. Please try again.";
  }
}

/** Recipe text pasted into the Import page, to be read into drafts (phase E15). */
export async function importPastedText(
  text: string,
): Promise<{ jobs: ImportJobSummary[] } | { problem: ImportTextError | "offline" | "failed" }> {
  let res: Response;
  try {
    res = await fetch("/api/import/text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    return { problem: "offline" };
  }
  if (res.ok) return (await res.json()) as ImportTextResponse;
  const error = ((await res.json().catch(() => ({}))) as { error?: ImportTextError }).error;
  return { problem: error ?? "failed" };
}

/** What to tell people when reading pasted text didn't work. */
export function pastedProblemText(problem: ImportTextError | "offline" | "failed"): string {
  switch (problem) {
    case "no_recipe":
      return "Fennl couldn't find a recipe in that text.";
    case "web_address":
      return "That's a web address. Fennl can't import from a link yet. Open the page and use the Fennl extension, or save the page and import the file.";
    case "text_too_large":
      return "That's too much text for one import. Paste just the recipe, or a few recipes at a time.";
    case "ai_import_not_included":
      return "Fennl can read recipes it can follow clearly: a title, then “Ingredients” and “Directions” headings. This text isn't laid out that way, so it would need reading with AI, which is part of Premium.";
    case "import_not_included":
      return "Importing isn't part of your plan.";
    case "daily_limit":
      return "That's as many imports as your plan allows today. Try again tomorrow.";
    case "monthly_limit":
      return "That text needs reading with AI, and this month's AI imports are used up. They start again on the 1st.";
    case "paused":
      return "That text needs reading with AI, which is paused for now. Please try again later.";
    case "ai_unavailable":
      return "Fennl couldn't read that text just now. Please try again in a few minutes.";
    case "rate_limited":
      return "That's a lot at once. Wait a minute, then try again.";
    case "offline":
      return "Importing needs a connection. Try again when you're back online.";
    case "invalid_request":
    case "failed":
      return "That text couldn't be imported. Please try again.";
  }
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
