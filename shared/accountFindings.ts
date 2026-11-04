/**
 * The admin console's account page (U15): Fennl's findings about an account ("What's going on"),
 * the checks that found nothing, and everything that happened on it ("What happened"), in plain
 * words. Pure: the Worker gathers the records (worker/admin/accountRecords.ts) and these
 * functions turn them into what the page shows. Never a gendered pronoun for a person: their
 * first name, "they" or no pronoun.
 */
import type { AccountEvent, LimitRefusedDetails, RefusedLimit } from "./accountEvents";
import { EMAIL_PROBLEMS, type EmailProblem } from "./emailDelivery";
import { suggestEmail } from "./emailTypos";
import type { Entitlements, LimitKey } from "./entitlements";
import { addBlockedBy, photoLevel, type Usage } from "./limits";

// ---------------------------------------------------------------------------------------------
// What the page gets.
// ---------------------------------------------------------------------------------------------

export type FindingKey =
  | "sign_up_bounced"
  | "email_not_arriving"
  | "email_spam"
  | "cant_add"
  | "failed_sign_ins"
  | "feedback_unread"
  | "photos_deleted_on"
  | "premium_ending"
  | "device_back_and_forth"
  | "imports_failing"
  | "email_change_waiting"
  | "temporary_password"
  | "unverified_removal";

export const FINDING_KEYS: readonly FindingKey[] = [
  "sign_up_bounced",
  "email_not_arriving",
  "email_spam",
  "cant_add",
  "failed_sign_ins",
  "feedback_unread",
  "photos_deleted_on",
  "premium_ending",
  "device_back_and_forth",
  "imports_failing",
  "email_change_waiting",
  "temporary_password",
  "unverified_removal",
];

export function isFindingKey(value: unknown): value is FindingKey {
  return typeof value === "string" && (FINDING_KEYS as readonly string[]).includes(value);
}

/** A button on a finding: it opens the matching tool with these values filled in. */
export type FindingAction =
  | { kind: "extend_premium"; label: string; tier: "individual" | "household" }
  | { kind: "raise_limit"; label: string; limit: LimitKey; value: number | null }
  | { kind: "change_email"; label: string }
  | { kind: "unblock"; label: string }
  /** `email`: the address to change to (a likely typo put right), or "" to type one. */
  | { kind: "fix_sign_up_address"; label: string; email: string }
  | { kind: "send_sign_up_link"; label: string }
  | { kind: "open_feedback"; label: string; feedbackId: string }
  | { kind: "password_reset"; label: string }
  | { kind: "view_as"; label: string };

export interface Finding {
  key: FindingKey;
  /** "Needs you" or "Worth knowing" (shown in words as well as colour). */
  level: "needs_you" | "worth_knowing";
  title: string;
  body: string;
  /** Why it matters, or how it connects to another finding. */
  why?: string;
  /** When it started (ISO), when known. */
  since: string | null;
  /** "since Oct 31", "2 hours ago", "22 hours left". */
  sinceText: string;
  /** The newest record it's about: a new one brings a handled finding back. */
  fingerprint: string;
  actions: FindingAction[];
  /** Marked handled by an admin, at this fingerprint. */
  handled: { at: string; by: string; note: string | null } | null;
}

export type HistoryCategory = "email" | "device" | "plan" | "recipes" | "support";

/** One line of "What happened", newest first. */
export interface HistoryEntry {
  at: string;
  category: HistoryCategory;
  text: string;
  /** A second line: the mail server's reason, an admin's reason, a note. */
  detail?: string;
  /** Tied to a finding: marked "Problem". */
  problem: boolean;
  /**
   * Kept for good (sign-up, codes, plan changes, feedback, admin actions); the rest is kept 90
   * days, so "Everything" shows these.
   */
  keptForGood: boolean;
}

// ---------------------------------------------------------------------------------------------
// What the Worker gathers. Times are ms since 1970.
// ---------------------------------------------------------------------------------------------

export interface AccountRecords {
  person: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    emailProblem: EmailProblem | null;
    createdAt: number;
    mustChangePassword: boolean;
    role: string | null;
  };
  /** Better Auth's account rows: "credential" (email and password), "google", "apple". */
  signInMethods: string[];
  household: { id: string; name: string; members: { userId: string; name: string }[] } | null;
  plan: Entitlements | null;
  /** What the household would have on Free (for "after Premium ends"). */
  freePlan: Entitlements | null;
  /** Recipes and photos against the plan's limits. */
  usage: Usage | null;
  /** Premium from codes, newest first. `endsAt`: when it ends (or ended), null for no end. */
  codeGrants: {
    id: string;
    code: string;
    tier: string;
    startsAt: number;
    endsAt: number | null;
    revokedAt: number | null;
    createdAt: number;
  }[];
  /** Premium given by an admin without a code (U15), newest first. */
  adminGrants: {
    id: string;
    tier: string;
    startsAt: number;
    endsAt: number;
    revokedAt: number | null;
    createdAt: number;
  }[];
  /** The person's own devices, revoked ones too. */
  devices: {
    id: string;
    label: string;
    firstSeenAt: number;
    lastSeenAt: number;
    revokedAt: number | null;
    revokedReason: string | null;
    lastChangeTime: number | null;
  }[];
  /** Live sign-in sessions that are the person (not an admin acting as them). */
  sessions: { createdAt: number }[];
  /** Emails sent to the account in the last 90 days, newest first. */
  emails: {
    id: string;
    kind: string;
    toAddress: string;
    sentAt: number;
    status: string;
    statusAt: number;
    detail: string | null;
  }[];
  /** Account events in the last 90 days, newest first. */
  events: AccountEvent[];
  emailChanges: {
    id: string;
    kind: string;
    oldEmail: string;
    newEmail: string;
    byAdmin: boolean;
    createdAt: number;
    expiresAt: number | null;
    completedAt: number | null;
    cancelledAt: number | null;
  }[];
  feedback: {
    id: string;
    message: string;
    createdAt: number;
    readAt: number | null;
    repliedAt: number | null;
    doneAt: number | null;
  }[];
  photoGrace: {
    id: string;
    startedAt: number;
    deleteAfter: number;
    remindedDays: number;
    endedAt: number | null;
    endedReason: string | null;
  }[];
  overrides: { key: string; value: number | null; expiresAt: number | null }[];
  /** Admin actions on the account (the audit log), newest first. */
  adminLog: {
    id: string;
    action: string;
    adminName: string | null;
    reason: string | null;
    details: Record<string, unknown> | null;
    createdAt: number;
  }[];
  /** Findings marked handled. */
  handled: {
    finding: string;
    fingerprint: string;
    adminName: string | null;
    note: string | null;
    handledAt: number;
  }[];
  /** When an unverified account is removed (null: it never is: Google, Apple, a waiting change). */
  removalAt: number | null;
}

// ---------------------------------------------------------------------------------------------
// Words.
// ---------------------------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** "Dana" from "Dana Ortiz"; "This person" without a name. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "This person";
}

/** "3 MB", "1.1 GB": sizes as people say them (1 MB = 1024 KB). */
export function bytesText(bytes: number): string {
  const units = [
    { size: 1024 ** 3, name: "GB" },
    { size: 1024 ** 2, name: "MB" },
    { size: 1024, name: "KB" },
  ];
  for (const unit of units) {
    if (bytes >= unit.size) {
      const value = bytes / unit.size;
      return `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit.name}`;
    }
  }
  return `${bytes} bytes`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const tierName = (tier: string) =>
  tier === "household" ? "Household" : tier === "individual" ? "Individual" : "Free";

/** A short, one-line quote of what someone wrote. */
export function excerpt(text: string, max = 120): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** A mail server's reason, quoted inside a sentence: without its own closing full stop. */
function reasonText(text: string): string {
  return excerpt(text, 200).replace(/\.+$/, "");
}

/** Dates as the admin reads them, in their time zone ("UTC" when not known). */
export function dateWords(now: number, timeZone = "UTC") {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const parts = (ms: number) => {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(ms);
    const get = (type: string) => Number(p.find((x) => x.type === type)?.value ?? 0);
    return Date.UTC(get("year"), get("month") - 1, get("day"));
  };
  const today = parts(now);
  const daysFromToday = (ms: number) => Math.round((parts(ms) - today) / DAY);
  const thisYear = new Date(today).getUTCFullYear();
  const day = (ms: number) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      month: "short",
      day: "numeric",
      ...(new Date(parts(ms)).getUTCFullYear() !== thisYear ? { year: "numeric" } : {}),
    }).format(ms);
  const time = (ms: number) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(ms);
  /** "today", "tomorrow", "yesterday", or "Oct 31". */
  const relativeDay = (ms: number) => {
    const d = daysFromToday(ms);
    return d === 0 ? "today" : d === 1 ? "tomorrow" : d === -1 ? "yesterday" : day(ms);
  };
  /** "just now", "2 hours ago", "yesterday", "Oct 31". */
  const ago = (ms: number) => {
    const elapsed = now - ms;
    if (elapsed < 2 * 60 * 1000) return "just now";
    if (elapsed < HOUR) return `${Math.floor(elapsed / 60000)} minutes ago`;
    if (daysFromToday(ms) === 0) return plural(Math.floor(elapsed / HOUR), "hour") + " ago";
    return relativeDay(ms);
  };
  /**
   * How long something has gone on: "in the last 40 minutes", "in the last 3 hours" when it
   * started today, otherwise "since yesterday", "since Oct 31".
   */
  const since = (ms: number) => {
    if (daysFromToday(ms) !== 0) return `since ${relativeDay(ms)}`;
    const elapsed = Math.max(0, now - ms);
    if (elapsed < HOUR) {
      const minutes = Math.ceil(elapsed / 60000);
      return minutes <= 1 ? "in the last minute" : `in the last ${minutes} minutes`;
    }
    const hours = Math.ceil(elapsed / HOUR);
    return hours <= 1 ? "in the last hour" : `in the last ${hours} hours`;
  };
  /** "22 hours left", "86 days left". */
  const left = (ms: number) => {
    const remaining = ms - now;
    if (remaining <= 0) return "due now";
    if (remaining < 48 * HOUR)
      return `${plural(Math.max(1, Math.floor(remaining / HOUR)), "hour")} left`;
    return `${plural(Math.ceil(remaining / DAY), "day")} left`;
  };
  return { day, time, relativeDay, ago, since, left, daysFromToday };
}

const EMAIL_WORDS: Record<string, string> = {
  verification: "“Verify your email for Fennl”",
  password_reset: "“Reset your Fennl password”",
  email_change: "“Verify your new email for Fennl”",
  email_changed: "“Your Fennl email address was changed”",
  temporary_password: "“Your Fennl password was reset by support”",
  photo_grace_started: "The email saying photos will be deleted",
  photo_grace_reminder: "A reminder that photos will be deleted",
};
const emailWords = (kind: string) => EMAIL_WORDS[kind] ?? "An email";

const STATUS_WORDS: Record<string, string> = {
  sent: "was sent",
  delivered: "was delivered",
  delayed: "is delayed",
  bounced: "bounced",
  soft_bounced: "bounced for now (the mail server may still take it)",
  complained: "was marked as spam",
  suppressed: "wasn’t sent: Resend is blocking the address",
  failed: "couldn’t be sent",
  withheld: "wasn’t sent: another account uses the address",
};
const PROBLEM_STATUSES = new Set(["bounced", "complained", "suppressed", "failed"]);
const isProblemEmail = (status: string) => (EMAIL_PROBLEMS as readonly string[]).includes(status);

const METHOD_WORDS: Record<string, string> = {
  credential: "email and password",
  password: "email and password",
  google: "Google",
  apple: "Apple",
  email_link: "the link in an email",
  passkey: "a passkey",
};
const methodWords = (method: string) => METHOD_WORDS[method] ?? "another way";

/** "email and password or Google". */
function methodsText(methods: string[]): string {
  const words = [...new Set(methods.map(methodWords))];
  return words.length === 0 ? "no sign-in method" : words.join(" or ");
}

const LIMIT_WORDS: Record<RefusedLimit, string> = {
  max_recipes: "the recipe limit",
  max_text_bytes: "the recipe text limit",
  max_recipe_bytes: "the size limit for one recipe",
  max_devices: "the device limit",
  image_quota_bytes: "the photo storage limit",
  image_quota_count: "the number of photos allowed",
  image_max_file_bytes: "the size limit for one photo",
  image_uploads_per_minute: "photo uploads per minute",
  image_uploads_per_day: "photo uploads per day",
  max_photos_per_recipe: "photos per recipe",
  structured_imports_per_day: "imports per day",
  ai_imports_per_month: "AI imports this month",
  ai_cost_cents_per_month: "the hidden AI cost limit",
  images_enabled: "photos aren’t part of the plan",
  import_structured_enabled: "imports aren’t part of the plan",
  import_ai_enabled: "AI imports aren’t part of the plan",
};

const BYTE_LIMITS = new Set<RefusedLimit>([
  "max_text_bytes",
  "max_recipe_bytes",
  "image_quota_bytes",
  "image_max_file_bytes",
]);

const WHAT_WORDS: Record<string, string> = {
  recipe: "Adding a recipe",
  restore: "Putting a recipe back from Trash",
  import: "An import",
  photo: "Adding a photo",
  ai_import: "An AI import",
  device: "Signing in on another device",
};

function refusalText(details: LimitRefusedDetails): string {
  const what = WHAT_WORDS[details.what] ?? "Something";
  const limit = LIMIT_WORDS[details.limit] ?? "a limit";
  const show = (n: number) => (BYTE_LIMITS.has(details.limit) ? bytesText(n) : String(n));
  let numbers = "";
  if (details.limit !== "ai_cost_cents_per_month") {
    if (details.used !== undefined && details.max !== undefined && details.max !== null) {
      numbers = ` (${show(details.used)} of ${show(details.max)})`;
    } else if (details.max !== undefined && details.max !== null) {
      numbers = ` (${show(details.max)})`;
    }
  }
  const app = details.origin === "app" ? " Stopped in the app before sending." : "";
  return `${what} was refused: ${limit}${numbers}.${app}`;
}

const SOURCE_WORDS: Record<string, string> = {
  web: "a web page",
  photos: "photos",
  pdf: "a PDF",
  text: "pasted text or a file",
  read_again: "Read again",
};
const REASON_WORDS: Record<string, string> = {
  no_recipe: "no recipe was found",
  ai_unavailable: "the AI couldn’t be reached",
  paused: "AI imports were paused for everyone",
  page_too_large: "the page was too large",
  text_too_large: "the text was too long",
  pages_too_large: "the pages were too large",
  unreadable: "it couldn’t be read",
};
const importFailedText = (source: string, reason: string) =>
  `From ${SOURCE_WORDS[source] ?? source}: ${REASON_WORDS[reason] ?? reason.replace(/_/g, " ")}`;

const paidTier = (tier: string): "individual" | "household" =>
  tier === "household" ? "household" : "individual";

// ---------------------------------------------------------------------------------------------
// Findings.
// ---------------------------------------------------------------------------------------------

/** Every grant, code or admin, with where it came from. */
function allGrants(r: AccountRecords) {
  return [
    ...r.codeGrants.map((g) => ({
      id: g.id,
      tier: g.tier,
      startsAt: g.startsAt,
      endsAt: g.endsAt,
      revokedAt: g.revokedAt,
      createdAt: g.createdAt,
      from: `Code ${g.code}`,
      code: g.code as string | null,
    })),
    ...r.adminGrants.map((g) => ({
      id: g.id,
      tier: g.tier,
      startsAt: g.startsAt,
      endsAt: g.endsAt as number | null,
      revokedAt: g.revokedAt,
      createdAt: g.createdAt,
      from: "Support",
      code: null as string | null,
    })),
  ];
}

/** When a grant stopped giving Premium, or null while it still does (or never ends). */
const grantStopped = (g: { endsAt: number | null; revokedAt: number | null }, now: number) =>
  g.revokedAt ?? (g.endsAt !== null && g.endsAt <= now ? g.endsAt : null);

/** The code used when signing up: a grant made within a minute of the account. */
function signUpGrant(r: AccountRecords) {
  return r.codeGrants.find((g) => Math.abs(g.createdAt - r.person.createdAt) < 60_000) ?? undefined;
}

interface Built {
  finding: Omit<Finding, "handled">;
  /** The records shown as "Problem" in What happened. */
  related: string[];
}

/** A suggested raised limit: double, or a quarter over what's used, rounded. */
function raisedValue(limit: LimitKey, used: number, max: number | null): number | null {
  if (max === null) return null;
  if (BYTE_LIMITS.has(limit)) {
    const mb = 1024 * 1024;
    return Math.max(max * 2, Math.ceil((used * 1.25) / mb) * mb);
  }
  return Math.max(max * 2, Math.ceil((used * 1.25) / 50) * 50);
}

function build(r: AccountRecords, now: number, timeZone: string): Built[] {
  const d = dateWords(now, timeZone);
  const name = firstName(r.person.name);
  const out: Built[] = [];
  const unread = r.feedback
    .filter((f) => f.readAt === null)
    .sort((a, b) => b.createdAt - a.createdAt);
  const openGrace = r.photoGrace.find((g) => g.endedAt === null);
  const grants = allGrants(r);
  const lastTier = paidTier(
    [...grants].sort((a, b) => b.createdAt - a.createdAt)[0]?.tier ?? "individual",
  );

  // Sign-up link bounced.
  const verification = r.emails.find((e) => e.kind === "verification");
  const signUpBounced =
    !r.person.emailVerified && verification !== undefined && isProblemEmail(verification.status);
  if (signUpBounced && verification) {
    const suggestion = suggestEmail(verification.toAddress);
    const suggestedDomain = suggestion?.slice(suggestion.lastIndexOf("@") + 1);
    const reason = verification.detail ? `: “${reasonText(verification.detail)}”` : "";
    out.push({
      finding: {
        key: "sign_up_bounced",
        level: "needs_you",
        title: `${name}’s sign-up link couldn’t be delivered`,
        body:
          `Sent to ${verification.toAddress} and turned away${reason}.` +
          (suggestedDomain ? ` It looks like a typo for ${suggestedDomain}.` : ""),
        why: "The “Check your email” page already says so and lets them fix the address. If they get in touch instead, you can fix it here.",
        since: new Date(verification.statusAt).toISOString(),
        sinceText: d.ago(verification.statusAt),
        fingerprint: verification.id,
        actions: [
          ...(suggestion
            ? [
                {
                  kind: "fix_sign_up_address" as const,
                  label: `Change to ${suggestion} and send the link`,
                  email: suggestion,
                },
              ]
            : []),
          {
            kind: "fix_sign_up_address",
            label: suggestion ? "Use another address…" : "Change the address and send the link…",
            email: "",
          },
        ],
      },
      related: r.emails.filter((e) => e.kind === "verification").map((e) => e.id),
    });
  }

  // Emails not arriving, or blocked.
  const problem = r.person.emailProblem;
  const problemEmails = r.emails.filter(
    (e) => isProblemEmail(e.status) && e.toAddress === r.person.email.toLowerCase(),
  );
  if ((problem === "bounced" || problem === "suppressed") && !signUpBounced) {
    const latest = problemEmails[0];
    const consequences: string[] = [];
    if (openGrace) {
      consequences.push(
        `They’ll miss the reminders that their photos will be deleted on ${d.day(openGrace.deleteAfter)}.`,
      );
    }
    if (r.feedback.length > 0) consequences.push("A reply to their feedback would bounce too.");
    const what =
      problem === "bounced"
        ? `Their mail server turned the last email away${latest?.detail ? `: “${reasonText(latest.detail)}”` : ""}.`
        : "Resend, Fennl’s email service, is blocking the address, because emails to it bounced or were marked as spam before.";
    out.push({
      finding: {
        key: "email_not_arriving",
        level: "needs_you",
        title: `Emails to ${r.person.email} aren’t arriving`,
        body: [what, ...consequences].join(" "),
        why: "Fennl shows them a notice on every page asking them to check the address. Once they change it, or say it’s right, this clears by itself.",
        since: latest ? new Date(latest.statusAt).toISOString() : null,
        sinceText: latest ? `since ${d.relativeDay(latest.statusAt)}` : "now",
        fingerprint: `${problem}:${latest?.id ?? ""}`,
        actions: [
          { kind: "change_email", label: "Change their address…" },
          { kind: "unblock", label: "Unblock the address" },
        ],
      },
      related: problemEmails.map((e) => e.id),
    });
  }

  // Marked an email as spam.
  if (problem === "complained") {
    const latest = r.emails.find((e) => e.status === "complained");
    out.push({
      finding: {
        key: "email_spam",
        level: "needs_you",
        title: latest
          ? `${name} marked ${emailWords(latest.kind)} as spam`
          : `${name} marked a Fennl email as spam`,
        body: "Fennl stops emailing an address that marks its emails as spam, so they won’t get sign-in or photo emails until it’s started again.",
        why: "Too many spam reports can send Fennl’s emails to everyone’s spam folder.",
        since: latest ? new Date(latest.statusAt).toISOString() : null,
        sinceText: latest ? d.ago(latest.statusAt) : "now",
        fingerprint: latest?.id ?? "complained",
        actions: [
          { kind: "unblock", label: "Start emails again" },
          { kind: "change_email", label: "Change their address…" },
        ],
      },
      related: latest ? [latest.id] : [],
    });
  }

  // Can't add.
  const refusals = r.events.filter(
    (e): e is Extract<AccountEvent, { kind: "limit_refused" }> => e.kind === "limit_refused",
  );
  const usage = r.usage;
  const recipeLimit = usage ? addBlockedBy(usage) : null;
  const photosFull =
    usage?.photos?.enabled === true &&
    (photoLevel(usage.photos) === "full" || photoLevel(usage.photos) === "over");
  const blocking: LimitKey | null =
    recipeLimit ??
    (photosFull && usage?.photos
      ? usage.photos.maxBytes !== null && usage.photos.bytes >= usage.photos.maxBytes
        ? "image_quota_bytes"
        : "image_quota_count"
      : null);
  if (usage && blocking) {
    const isPhoto = blocking === "image_quota_bytes" || blocking === "image_quota_count";
    const related = refusals.filter((e) =>
      isPhoto
        ? e.details.limit === "image_quota_bytes" || e.details.limit === "image_quota_count"
        : e.details.limit === "max_recipes" || e.details.limit === "max_text_bytes",
    );
    const lapsed =
      r.plan?.tier === "free"
        ? grants
            .map((g) => ({ ...g, stopped: grantStopped(g, now) }))
            .filter((g) => g.stopped !== null)
            .sort((a, b) => (b.stopped ?? 0) - (a.stopped ?? 0))[0]
        : undefined;
    const used =
      blocking === "max_recipes"
        ? usage.recipes
        : blocking === "max_text_bytes"
          ? usage.textBytes
          : blocking === "image_quota_bytes"
            ? (usage.photos?.bytes ?? 0)
            : (usage.photos?.count ?? 0);
    const max =
      blocking === "max_recipes"
        ? usage.maxRecipes
        : blocking === "max_text_bytes"
          ? usage.maxTextBytes
          : blocking === "image_quota_bytes"
            ? (usage.photos?.maxBytes ?? null)
            : (usage.photos?.maxCount ?? null);
    const planName = r.plan ? tierName(r.plan.tier) : "Free";
    const where = `${planName}’s ${blocking === "max_recipes" ? max : blocking === "max_text_bytes" || blocking === "image_quota_bytes" ? bytesText(max ?? 0) : max}`;
    const state =
      blocking === "max_recipes"
        ? `${plural(used, "recipe")}, ${used > (max ?? 0) ? "over" : "at"} ${where}`
        : blocking === "max_text_bytes"
          ? `${bytesText(used)} of recipe text, ${used > (max ?? 0) ? "over" : "at"} ${where}`
          : blocking === "image_quota_bytes"
            ? `${bytesText(used)} of photos, ${used > (max ?? 0) ? "over" : "at"} ${where}`
            : `${plural(used, "photo")}, ${used > (max ?? 0) ? "over" : "at"} ${where}`;
    const blocked = isPhoto ? "new photos are blocked" : "new recipes and imports are blocked";
    const lead = lapsed
      ? `${lapsed.from} gave them ${tierName(lapsed.tier)} until ${d.day(lapsed.stopped ?? now)}. They’re now on Free with ${state}, so ${blocked}.`
      : `They have ${state}, so ${blocked}.`;
    const tries =
      related.length > 0
        ? ` Fennl turned away ${plural(related.length, "try", "tries")} to add, the latest ${d.ago(related[0]?.at ?? now)}.`
        : "";
    const start = lapsed?.stopped ?? related[related.length - 1]?.at ?? null;
    const wrote = unread.find((f) => start === null || f.createdAt >= start);
    const what = isPhoto ? "photos" : "recipes";
    out.push({
      finding: {
        key: "cant_add",
        level: "needs_you",
        title: lapsed
          ? `${name} can’t add ${what}: their free Premium ended`
          : `${name} can’t add ${what}: ${LIMIT_WORDS[blocking]} is reached`,
        body: `${lead}${tries} Nothing has been deleted.`,
        ...(wrote
          ? {
              why: `Probably why they wrote to you ${d.ago(wrote.createdAt)}: “${excerpt(wrote.message)}”`,
            }
          : {}),
        since: start !== null ? new Date(start).toISOString() : null,
        sinceText: start !== null ? `since ${d.relativeDay(start)}` : "now",
        fingerprint: `${blocking}:${related[0]?.id ?? r.plan?.tier ?? ""}`,
        actions: [
          ...(lapsed
            ? [
                {
                  kind: "extend_premium" as const,
                  label: "Extend their Premium…",
                  tier: paidTier(lapsed.tier),
                },
              ]
            : []),
          {
            kind: "raise_limit",
            label:
              blocking === "max_recipes"
                ? "Raise their recipe limit…"
                : blocking === "max_text_bytes"
                  ? "Raise their recipe text limit…"
                  : "Raise their photo limit…",
            limit: blocking,
            value: raisedValue(blocking, used, max),
          },
        ],
      },
      related: [
        ...related.map((e) => e.id),
        ...(lapsed ? [lapsed.id] : []),
        ...(wrote ? [wrote.id] : []),
      ],
    });
  }

  // Failed sign-ins in a row.
  const lastSignIn = Math.max(
    0,
    ...r.events.filter((e) => e.kind === "signed_in").map((e) => e.at),
    ...r.sessions.map((s) => s.createdAt),
  );
  const failed = r.events.filter(
    (e): e is Extract<AccountEvent, { kind: "sign_in_failed" }> =>
      e.kind === "sign_in_failed" && e.at > lastSignIn,
  );
  const firstFailed = failed[failed.length - 1];
  const lastFailed = failed[0];
  if (failed.length >= 5 && firstFailed && lastFailed) {
    const first = firstFailed;
    const browsers = [...new Set(failed.map((e) => e.details.browser))];
    const noPassword = failed.some((e) => !e.details.hasPassword);
    const others = r.signInMethods.filter((m) => m !== "credential");
    out.push({
      finding: {
        key: "failed_sign_ins",
        level: "needs_you",
        title: `${failed.length} failed sign-ins in a row`,
        body:
          `A wrong password was typed for ${r.person.email} ${plural(failed.length, "time")} ${d.since(first.at)}, on ${browsers.join(", ")}. Fennl keeps only the time and the browser, never what was typed.` +
          (noPassword
            ? ` The account has no Fennl password: ${name} signs in with ${methodsText(others)}, so a password can’t work.`
            : ""),
        why: "If it’s them, a password reset email gets them back in. If it isn’t, nothing gets in without the password.",
        since: new Date(first.at).toISOString(),
        sinceText: d.since(first.at),
        fingerprint: lastFailed.id,
        actions: [{ kind: "password_reset", label: "Send a password reset email" }],
      },
      related: failed.map((e) => e.id),
    });
  }

  // Unread feedback.
  const newest = unread[0];
  if (newest) {
    out.push({
      finding: {
        key: "feedback_unread",
        level: "needs_you",
        title:
          unread.length === 1
            ? "1 unread feedback message"
            : `${unread.length} unread feedback messages`,
        body: `${name} wrote ${d.ago(newest.createdAt)}: “${excerpt(newest.message, 200)}”`,
        since: new Date(newest.createdAt).toISOString(),
        sinceText: d.ago(newest.createdAt),
        fingerprint: newest.id,
        actions: [{ kind: "open_feedback", label: "Open in the inbox", feedbackId: newest.id }],
      },
      related: unread.map((f) => f.id),
    });
  }

  // Photos to be deleted.
  if (openGrace) {
    const mine = usage?.photos?.members.find((m) => m.userId === r.person.id);
    const count = mine ? `${plural(mine.count, "photo")}` : "photos";
    out.push({
      finding: {
        key: "photos_deleted_on",
        level: "worth_knowing",
        title: `${name}’s ${count} will be deleted on ${d.day(openGrace.deleteAfter)}`,
        body:
          "Photos are kept for 90 days after a plan stops including them. Extending their Premium stops this." +
          (problem ? " Their email isn’t arriving, so the reminders won’t reach them." : ""),
        since: new Date(openGrace.startedAt).toISOString(),
        sinceText: d.left(openGrace.deleteAfter),
        fingerprint: openGrace.id,
        actions: [{ kind: "extend_premium", label: "Extend their Premium…", tier: lastTier }],
      },
      related: [openGrace.id],
    });
  }

  // Free Premium ending soon.
  const plan = r.plan;
  if (
    plan &&
    (plan.source === "promo_code" || plan.source === "admin_grant") &&
    plan.ends_at !== null &&
    Date.parse(plan.ends_at) - now <= 14 * DAY
  ) {
    const endsAt = Date.parse(plan.ends_at);
    const grant = grants.find((g) => g.endsAt === endsAt && g.revokedAt === null);
    const free = r.freePlan;
    const overFree =
      free && usage
        ? addBlockedBy({
            ...usage,
            maxRecipes: free.max_recipes,
            maxTextBytes: free.max_text_bytes,
          })
        : null;
    out.push({
      finding: {
        key: "premium_ending",
        level: "worth_knowing",
        title: `Free Premium ends ${d.relativeDay(endsAt) === d.day(endsAt) ? `on ${d.day(endsAt)}` : d.relativeDay(endsAt)}`,
        body:
          `${grant?.from ?? (plan.source === "admin_grant" ? "Support" : "A code")} gives them ${tierName(plan.tier)} until ${d.day(endsAt)}, then Free.` +
          (overFree === "max_recipes" && free
            ? ` With ${plural(usage?.recipes ?? 0, "recipe")}, over Free’s ${free.max_recipes}, they won’t be able to add recipes then.`
            : overFree === "max_text_bytes" && free
              ? ` Their recipe text is over Free’s ${bytesText(free.max_text_bytes ?? 0)}, so they won’t be able to add recipes then.`
              : ""),
        since: null,
        sinceText: d.left(endsAt),
        fingerprint: `${grant?.id ?? "grant"}:${endsAt}`,
        actions: [
          { kind: "extend_premium", label: "Extend their Premium…", tier: paidTier(plan.tier) },
        ],
      },
      related: grant ? [grant.id] : [],
    });
  }

  // One device taking over back and forth.
  const takeovers = r.events.filter((e) => e.kind === "device_taken_over" && now - e.at <= 3 * DAY);
  const firstTakeover = takeovers[takeovers.length - 1];
  const lastTakeover = takeovers[0];
  if (takeovers.length >= 2 && firstTakeover && lastTakeover && (plan?.max_devices ?? 1) === 1) {
    const browsers = [
      ...new Set(
        takeovers.flatMap((e) =>
          e.kind === "device_taken_over" ? [e.details.browser, e.details.by] : [],
        ),
      ),
    ];
    const first = firstTakeover;
    out.push({
      finding: {
        key: "device_back_and_forth",
        level: "worth_knowing",
        title:
          browsers.length === 2
            ? `Switching between ${browsers[0]} and ${browsers[1]} signs ${name} out`
            : `Switching between devices signs ${name} out`,
        body: `${plan?.tier === "free" ? "Free allows" : "Their plan allows"} one device, so each one takes over from the other. If they ask why they keep being signed out, this is it.${plan?.tier === "free" ? " Premium fixes it too." : ""}`,
        since: new Date(first.at).toISOString(),
        sinceText: `${takeovers.length === 2 ? "twice" : `${takeovers.length} times`} ${d.since(first.at)}`,
        fingerprint: lastTakeover.id,
        actions: [],
      },
      related: takeovers.map((e) => e.id),
    });
  }

  // Imports failing.
  const importsFailed = r.events.filter(
    (e): e is Extract<AccountEvent, { kind: "import_failed" }> =>
      e.kind === "import_failed" && now - e.at <= 7 * DAY,
  );
  const firstImport = importsFailed[importsFailed.length - 1];
  const lastImport = importsFailed[0];
  if (importsFailed.length >= 3 && firstImport && lastImport) {
    const reasons = [
      ...new Set(importsFailed.map((e) => importFailedText(e.details.source, e.details.reason))),
    ];
    const first = firstImport;
    out.push({
      finding: {
        key: "imports_failing",
        level: "worth_knowing",
        title: `${importsFailed.length} imports failed in the last 7 days`,
        body: `${reasons.slice(0, 3).join(". ")}.`,
        since: new Date(first.at).toISOString(),
        sinceText: d.since(first.at),
        fingerprint: lastImport.id,
        actions: [{ kind: "view_as", label: `View as ${name}` }],
      },
      related: importsFailed.map((e) => e.id),
    });
  }

  // An email change waiting.
  const waiting = r.emailChanges.find(
    (c) =>
      c.kind === "change" &&
      c.completedAt === null &&
      c.cancelledAt === null &&
      c.expiresAt !== null &&
      c.expiresAt > now,
  );
  if (waiting?.expiresAt) {
    const expires = waiting.expiresAt;
    out.push({
      finding: {
        key: "email_change_waiting",
        level: "worth_knowing",
        title: `A change of address to ${waiting.newEmail} is waiting`,
        body: `The link was sent to ${waiting.newEmail} ${d.ago(waiting.createdAt)}${waiting.byAdmin ? " by support" : ""}. The account keeps ${r.person.email} until it’s opened; it stops working ${d.relativeDay(expires)} at ${d.time(expires)}.`,
        since: new Date(waiting.createdAt).toISOString(),
        sinceText: d.left(expires),
        fingerprint: waiting.id,
        actions: [],
      },
      related: [waiting.id],
    });
  }

  // A temporary password not changed yet.
  if (r.person.mustChangePassword) {
    const set = r.adminLog.find((a) => a.action === "account.temporary_password_set");
    out.push({
      finding: {
        key: "temporary_password",
        level: "worth_knowing",
        title: "A temporary password hasn’t been changed yet",
        body: `${set ? `${set.adminName ?? "Support"} set a temporary password ${d.ago(set.createdAt)}.` : "Support set a temporary password."} ${name} has to choose a new one at the next sign-in.`,
        since: set ? new Date(set.createdAt).toISOString() : null,
        sinceText: set ? `since ${d.relativeDay(set.createdAt)}` : "now",
        fingerprint: set?.id ?? "set",
        actions: [],
      },
      related: set ? [set.id] : [],
    });
  }

  // An unverified account's removal.
  if (!r.person.emailVerified && r.removalAt !== null) {
    const code = signUpGrant(r);
    const at = r.removalAt;
    out.push({
      finding: {
        key: "unverified_removal",
        level: "worth_knowing",
        title:
          at <= now
            ? `Due to be removed within the hour, as ${name} hasn’t verified`
            : `Removed ${d.relativeDay(at)} at ${d.time(at)} if ${name} doesn’t verify`,
        body:
          "Accounts whose email isn’t verified are removed 24 hours after signing up." +
          (code
            ? ` The use of invite code ${code.code} comes back then, so ${name} can sign up again with it.`
            : ""),
        since: new Date(r.person.createdAt).toISOString(),
        sinceText: d.left(at),
        fingerprint: `removal:${at}`,
        actions: [{ kind: "send_sign_up_link", label: "Send the sign-up link again" }],
      },
      related: [],
    });
  }

  return out;
}

/** The checks that found nothing, by the same names. */
function fineChecks(r: AccountRecords, found: Set<FindingKey>, now: number, timeZone: string) {
  const d = dateWords(now, timeZone);
  const fine: string[] = [];
  if (!found.has("failed_sign_ins") && !found.has("temporary_password")) {
    fine.push(`Signs in with ${methodsText(r.signInMethods)}; no temporary password waiting`);
  }
  if (!found.has("email_change_waiting")) fine.push("No email change waiting");
  if (
    r.person.emailVerified &&
    !r.person.emailProblem &&
    !found.has("sign_up_bounced") &&
    !found.has("email_not_arriving")
  ) {
    fine.push("Emails are arriving");
  }
  if (!found.has("email_spam")) fine.push("No spam complaints");
  if (!found.has("cant_add")) fine.push("Under every limit that stops adding");
  if (r.overrides.length === 0) fine.push("No limit exceptions");
  const synced = r.devices
    .filter((dv) => dv.revokedAt === null && dv.lastChangeTime !== null)
    .sort((a, b) => (b.lastChangeTime ?? 0) - (a.lastChangeTime ?? 0))[0];
  if (synced?.lastChangeTime) {
    fine.push(
      `${synced.label} synced its last change ${d.relativeDay(synced.lastChangeTime)} at ${d.time(synced.lastChangeTime)}`,
    );
  }
  if (!found.has("imports_failing")) fine.push("No imports failing in the last 7 days");
  if (!found.has("photos_deleted_on")) fine.push("No photos waiting to be deleted");
  if (!found.has("feedback_unread")) fine.push("No unread feedback");
  return fine;
}

function withHandled(r: AccountRecords, built: Built[]): Finding[] {
  return built.map(({ finding }) => {
    const row = r.handled.find(
      (h) => h.finding === finding.key && h.fingerprint === finding.fingerprint,
    );
    return {
      ...finding,
      handled: row
        ? {
            at: new Date(row.handledAt).toISOString(),
            by: row.adminName ?? "An admin",
            note: row.note,
          }
        : null,
    };
  });
}

/**
 * Fennl's findings about the account, most urgent first (Needs you, then Worth knowing), and the
 * checks that found nothing. `timeZone`: the admin's, for the dates in the words.
 */
export function accountFindings(
  records: AccountRecords,
  now: number,
  timeZone = "UTC",
): { findings: Finding[]; fine: string[] } {
  const built = build(records, now, timeZone);
  const findings = withHandled(records, built).sort((a, b) =>
    a.level === b.level ? 0 : a.level === "needs_you" ? -1 : 1,
  );
  return {
    findings,
    fine: fineChecks(records, new Set(findings.map((f) => f.key)), now, timeZone),
  };
}

/** A finding that needs the admin and isn't handled at its current fingerprint. */
export function needsAttention(finding: Finding): boolean {
  return finding.level === "needs_you" && finding.handled === null;
}

// ---------------------------------------------------------------------------------------------
// What happened.
// ---------------------------------------------------------------------------------------------

/** Admin actions shown under "Plan and limits" rather than "Feedback and admin". */
const PLAN_ACTIONS = new Set(["premium.extended", "limit.override_set", "limit.override_removed"]);

/** Admin actions that say nothing new (a page opened) or are shown from their own records. */
const QUIET_ACTIONS = new Set([
  "account.viewed",
  "impersonation.ended",
  "account.email_change_started",
  "account.email_change_cancelled",
  "account.email_restored",
]);

function adminActionText(
  a: AccountRecords["adminLog"][number],
  name: string,
  d: ReturnType<typeof dateWords>,
): string {
  const who = a.adminName ?? "An admin";
  const details = a.details ?? {};
  const str = (key: string) => (typeof details[key] === "string" ? (details[key] as string) : "");
  switch (a.action) {
    case "impersonation.started":
      return `${who} started viewing as ${name}`;
    case "impersonation.change":
      return `${who} made a change while viewing as ${name}${str("request") ? ` (${str("request")})` : ""}`;
    case "account.password_reset_sent":
      return `${who} sent a password reset email${details.signOutEverywhere === true ? " and signed them out everywhere" : ""}`;
    case "account.temporary_password_set":
      return `${who} set a temporary password`;
    case "account.signed_out_everywhere":
      return `${who} signed them out everywhere`;
    case "premium.extended": {
      const until = typeof details.until === "string" ? Date.parse(details.until) : NaN;
      return `${who} gave Premium ${tierName(str("tier"))} until ${Number.isNaN(until) ? "a date" : d.day(until)}`;
    }
    case "limit.override_set": {
      const key = str("key") as RefusedLimit;
      const value = details.value;
      const shown =
        value === null
          ? "no limit"
          : typeof value === "number"
            ? BYTE_LIMITS.has(key)
              ? bytesText(value)
              : String(value)
            : "?";
      return `${who} set an exception: ${LIMIT_WORDS[key] ?? key} is ${shown}${str("expiresAt") ? ` until ${d.day(Date.parse(str("expiresAt")))}` : ""}`;
    }
    case "limit.override_removed":
      return `${who} removed the exception to ${LIMIT_WORDS[str("key") as RefusedLimit] ?? str("key")}`;
    case "email.unblocked":
      return `${who} unblocked ${str("address") || "the address"}`;
    case "sign_up.address_fixed":
      return `${who} changed the sign-up address from ${str("from")} to ${str("to")} and sent the link`;
    case "sign_up.link_sent":
      return `${who} sent the sign-up link again`;
    case "finding.handled":
      return `${who} marked “${str("title") || str("finding")}” handled`;
    case "finding.unhandled":
      return `${who} took back “${str("title") || str("finding")}” as handled`;
    case "feedback.read":
      return `${who} read their feedback`;
    case "feedback.updated":
      return `${who} updated their feedback${details.replied === true ? ": replied" : details.done === true ? ": done" : ""}`;
    default:
      return `${who}: ${a.action}`;
  }
}

function historyEntries(r: AccountRecords, now: number, timeZone: string, problems: Set<string>) {
  const d = dateWords(now, timeZone);
  const name = firstName(r.person.name);
  const out: HistoryEntry[] = [];
  const add = (
    at: number,
    category: HistoryCategory,
    text: string,
    options: { detail?: string | null; problem?: boolean; keptForGood?: boolean } = {},
  ) =>
    out.push({
      at: new Date(at).toISOString(),
      category,
      text,
      ...(options.detail ? { detail: options.detail } : {}),
      problem: options.problem ?? false,
      keptForGood: options.keptForGood ?? false,
    });

  // Emails.
  for (const e of r.emails) {
    add(
      e.sentAt,
      "email",
      `${emailWords(e.kind)} to ${e.toAddress} ${STATUS_WORDS[e.status] ?? e.status}.`,
      {
        detail: e.detail ? `The mail server said: ${e.detail}` : null,
        problem: PROBLEM_STATUSES.has(e.status) || problems.has(e.id),
      },
    );
  }

  // Sign-ins and devices, recipes and imports (account events).
  for (const e of r.events) {
    switch (e.kind) {
      case "signed_in":
        add(
          e.at,
          "device",
          `Signed in on ${e.details.browser} with ${methodWords(e.details.method)}`,
        );
        break;
      case "sign_in_failed":
        add(
          e.at,
          "device",
          e.details.hasPassword
            ? `A sign-in on ${e.details.browser} failed: wrong password`
            : `A password was tried on ${e.details.browser}, but the account has no Fennl password`,
          { problem: problems.has(e.id) },
        );
        break;
      case "device_taken_over":
        add(
          e.at,
          "device",
          `${e.details.by} took over from ${e.details.browser}, which was signed out`,
          {
            problem: problems.has(e.id),
          },
        );
        break;
      case "limit_refused":
        add(e.at, "recipes", refusalText(e.details), { problem: problems.has(e.id) });
        break;
      case "import_failed":
        add(
          e.at,
          "recipes",
          `An import failed. ${importFailedText(e.details.source, e.details.reason)}.`,
          {
            problem: problems.has(e.id),
          },
        );
        break;
    }
  }
  for (const dv of r.devices) {
    add(dv.firstSeenAt, "device", `First used Fennl on ${dv.label}`);
    if (dv.revokedAt !== null && dv.revokedReason === "signed_out") {
      add(dv.revokedAt, "device", `${dv.label} was signed out`);
    }
  }

  // Plan and codes.
  const atSignUp = signUpGrant(r);
  const signUpMethod = r.signInMethods.includes("credential")
    ? "credential"
    : (r.signInMethods[0] ?? "credential");
  add(
    r.person.createdAt,
    "plan",
    `Signed up with ${methodWords(signUpMethod)}${
      atSignUp
        ? `, using invite code ${atSignUp.code} (${tierName(atSignUp.tier)}${atSignUp.endsAt !== null ? ` until ${d.day(atSignUp.endsAt)}` : ", no end date"})`
        : ""
    }.`,
    { keptForGood: true },
  );
  for (const g of r.codeGrants) {
    if (g !== atSignUp) {
      add(
        g.createdAt,
        "plan",
        `Used code ${g.code}: ${tierName(g.tier)}${g.endsAt !== null ? ` until ${d.day(g.endsAt)}` : ", no end date"}.`,
        { keptForGood: true },
      );
    }
    if (g.revokedAt !== null) {
      add(g.revokedAt, "plan", `Premium from code ${g.code} was ended early.`, {
        keptForGood: true,
        problem: problems.has(g.id),
      });
    } else if (g.endsAt !== null && g.endsAt <= now) {
      add(g.endsAt, "plan", `Premium from code ${g.code} ended.`, {
        keptForGood: true,
        problem: problems.has(g.id),
      });
    }
  }
  for (const g of r.adminGrants) {
    if (g.revokedAt === null && g.endsAt <= now) {
      add(g.endsAt, "plan", "Premium given by support ended.", {
        keptForGood: true,
        problem: problems.has(g.id),
      });
    }
  }
  for (const g of r.photoGrace) {
    add(
      g.startedAt,
      "plan",
      `The plan stopped including photos: they’ll be deleted on ${d.day(g.deleteAfter)} unless it includes them again.`,
      {
        keptForGood: true,
        problem: problems.has(g.id),
      },
    );
    if (g.endedAt !== null) {
      const why =
        g.endedReason === "premium"
          ? "Photos are kept: the plan includes them again."
          : g.endedReason === "deleted"
            ? "The photos were deleted, 90 days after the plan stopped including them."
            : "Nothing to delete: no photos left.";
      add(g.endedAt, "plan", why, { keptForGood: true });
    }
  }

  // Feedback, email changes and admin actions.
  for (const f of r.feedback) {
    const state =
      f.doneAt !== null
        ? "Done"
        : f.repliedAt !== null
          ? "Replied"
          : f.readAt !== null
            ? "Read"
            : "Not read yet";
    add(f.createdAt, "support", `Sent feedback: “${excerpt(f.message)}”`, {
      detail: state,
      problem: problems.has(f.id),
      keptForGood: true,
    });
  }
  for (const c of r.emailChanges) {
    if (c.kind === "restore") {
      add(
        c.createdAt,
        "support",
        `Support put back the address ${c.newEmail} (was ${c.oldEmail}).`,
        {
          keptForGood: true,
        },
      );
      continue;
    }
    add(
      c.createdAt,
      "support",
      `${c.byAdmin ? "Support started" : `${name} started`} changing the address from ${c.oldEmail} to ${c.newEmail}.`,
      { keptForGood: true, problem: problems.has(c.id) },
    );
    if (c.completedAt !== null) {
      add(c.completedAt, "support", `The address changed to ${c.newEmail}.`, { keptForGood: true });
    } else if (c.cancelledAt !== null) {
      add(c.cancelledAt, "support", `The change to ${c.newEmail} was cancelled.`, {
        keptForGood: true,
      });
    }
  }
  for (const a of r.adminLog) {
    if (QUIET_ACTIONS.has(a.action)) continue;
    const note =
      a.action.startsWith("finding.") && typeof a.details?.note === "string"
        ? (a.details.note as string)
        : null;
    add(a.createdAt, PLAN_ACTIONS.has(a.action) ? "plan" : "support", adminActionText(a, name, d), {
      detail: a.reason ? `Reason: ${a.reason}` : note ? `Note: ${note}` : null,
      problem: problems.has(a.id),
      keptForGood: true,
    });
  }

  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Everything that happened on the account, newest first, in plain words. */
export function accountHistory(
  records: AccountRecords,
  now: number,
  timeZone = "UTC",
): HistoryEntry[] {
  const problems = new Set(build(records, now, timeZone).flatMap((b) => b.related));
  return historyEntries(records, now, timeZone, problems);
}

/** The account page's "What's going on" and "What happened" together. */
export function accountOverview(
  records: AccountRecords,
  now: number,
  timeZone = "UTC",
): { findings: Finding[]; fine: string[]; history: HistoryEntry[] } {
  const { findings, fine } = accountFindings(records, now, timeZone);
  return { findings, fine, history: accountHistory(records, now, timeZone) };
}
