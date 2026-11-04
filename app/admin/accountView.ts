/**
 * The admin account page and Needs attention (phase U15): the shapes the console reads, and the
 * plain helpers that put them into words. The findings and the history are put together on the
 * server (shared/accountFindings.ts); this only shows them.
 */
import type { AccountDetail } from "../../shared/adminAccounts";
import type { Finding, FindingAction, HistoryEntry } from "../../shared/accountFindings";
import type { EmailProblem } from "../../shared/emailDelivery";
import { planName } from "../pages/plan";

export type {
  AccountOverview,
  AttentionItem,
  AttentionOverview,
  ComingUpItem,
} from "../../shared/adminAccounts";

/**
 * "?tz=Europe/London": the admin's own time zone, so the server's words ("since Oct 31") use the
 * same days as the console. Empty when the browser doesn't say.
 */
export function timeZoneQuery(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone ? `?tz=${encodeURIComponent(zone)}` : "";
  } catch {
    return "";
  }
}

/** The account page's facts. */
export type AccountFacts = AccountDetail;

export type HistoryCategory = HistoryEntry["category"];
export type HistoryFilter = HistoryCategory | "all";

/** The filter buttons of "What happened", in order. */
export const HISTORY_FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "email", label: "Emails" },
  { id: "device", label: "Sign-in and devices" },
  { id: "plan", label: "Plan and limits" },
  { id: "recipes", label: "Recipes and imports" },
  { id: "support", label: "Feedback and admin" },
];

/** The word shown before each entry. */
export const CATEGORY_WORDS: Record<HistoryCategory, string> = {
  email: "Email",
  device: "Device",
  plan: "Plan",
  recipes: "Recipes",
  support: "Support",
};

/** The periods of "What happened": days back, or null for everything kept. */
export const PERIODS: { days: number | null; label: string }[] = [
  { days: 30, label: "Last 30 days" },
  { days: 60, label: "Last 60 days" },
  { days: 90, label: "Last 90 days" },
  { days: null, label: "Everything" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The entries a filter and period show, and how many older ones the period hides. */
export function historyShown(
  history: HistoryEntry[],
  filter: HistoryFilter,
  days: number | null,
  now: number,
): { shown: HistoryEntry[]; hidden: number } {
  const matching = history.filter((h) => filter === "all" || h.category === filter);
  if (days === null) return { shown: matching, hidden: 0 };
  const from = now - days * DAY_MS;
  const shown = matching.filter((h) => Date.parse(h.at) >= from);
  return { shown, hidden: matching.length - shown.length };
}

const KEPT =
  "Emails, sign-ins and devices are kept for 90 days; sign-up, codes, plan changes, feedback and your admin actions are kept for good.";

/** The line under the list. */
export function periodNote(days: number | null, shown: number, hidden: number): string {
  if (days === null) return shown === 0 ? `Nothing here yet. ${KEPT}` : KEPT;
  if (hidden > 0) {
    return `${hidden} older ${hidden === 1 ? "entry" : "entries"} before ${days} days ago. Choose a longer period to see ${hidden === 1 ? "it" : "them"}.`;
  }
  // The period hides nothing, so a longer one would show nothing more.
  if (shown === 0) return `Nothing here yet, and nothing older. ${KEPT}`;
  return `Nothing older is hidden: this is everything kept. ${KEPT}`;
}

/** "2 things need you · 2 worth knowing · 6 checks fine". */
export function summaryLine(findings: Finding[], fine: number): string {
  const needs = findings.filter((f) => f.level === "needs_you").length;
  const knowing = findings.length - needs;
  const parts: string[] = [];
  if (needs > 0) parts.push(`${needs} ${needs === 1 ? "thing needs" : "things need"} you`);
  if (knowing > 0) parts.push(`${knowing} worth knowing`);
  if (needs === 0 && knowing === 0) parts.push("Nothing needs you");
  if (fine > 0) parts.push(`${fine} ${fine === 1 ? "check" : "checks"} fine`);
  return parts.join(" · ");
}

/** Needs you first, otherwise as the server put them (most urgent first). */
export function inOrder(findings: Finding[]): Finding[] {
  const rank = (f: Finding) => (f.level === "needs_you" ? 0 : 1);
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map(({ f }) => f);
}

/** The actions that ask for the admin's passkey again. */
const PASSKEY_ACTIONS: ReadonlySet<FindingAction["kind"]> = new Set([
  "extend_premium",
  "raise_limit",
  "change_email",
  "fix_sign_up_address",
  "view_as",
]);

export function asksForPasskey(kind: FindingAction["kind"]): boolean {
  return PASSKEY_ACTIONS.has(kind);
}

/** The findings that are about emails, which offer "See the emails". */
export function aboutEmails(finding: Finding): boolean {
  return (
    finding.key === "sign_up_bounced" ||
    finding.key === "email_not_arriving" ||
    finding.key === "email_spam"
  );
}

/** A person's first name, for "View as Dana"; the whole name when it's one word. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function clock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A day: "Oct 31", or "Oct 31, 2025" in another year. */
export function shortDay(date: Date, now: Date): string {
  return date.toLocaleDateString(
    undefined,
    date.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}

/** When an entry happened: "Today 8:41", "Yesterday 21:05", "Oct 31 0:05". */
export function entryTime(iso: string, now: Date): string {
  const at = new Date(iso);
  if (sameDay(at, now)) return `Today ${clock(at)}`;
  if (sameDay(at, new Date(now.getTime() - DAY_MS))) return `Yesterday ${clock(at)}`;
  return `${shortDay(at, now)} ${clock(at)}`;
}

/** The same inside a sentence: "last used today 8:41". */
export function entryTimeInline(iso: string, now: Date): string {
  return entryTime(iso, now).replace(/^(Today|Yesterday)/, (word) => word.toLowerCase());
}

/** When something started, in a few words: "just now", "2 hours ago", "yesterday", "Nov 2". */
export function sinceWords(iso: string | null, now: Date): string {
  if (!iso) return "";
  const at = new Date(iso);
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
  if (sameDay(at, now)) {
    const hours = Math.floor(minutes / 60);
    return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  }
  if (sameDay(at, new Date(now.getTime() - DAY_MS))) return "yesterday";
  return shortDay(at, now);
}

/** A date field's value ("2027-03-31") as the end of that day where the admin is. */
export function endOfDay(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999).toISOString();
}

/** A date as a date field's value, where the admin is. */
export function dateValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** What's wrong with an address, in words. */
export const EMAIL_PROBLEM_WORDS: Record<EmailProblem, string> = {
  bounced: "bouncing",
  complained: "marked a Fennl email as spam",
  suppressed: "blocked by the email service",
};

/** "Just Dana", "Dana and Sam". */
export function householdWords(members: { name: string; email: string }[]): string {
  const names = members.map((m) => m.name || m.email);
  if (names.length === 0) return "Nobody yet";
  const [only] = names;
  if (names.length === 1 && only) return `Just ${firstName(only) || only}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Where the plan comes from, in words: "Premium Individual from code FRIENDS-OCT until Nov 30". */
export function planWords(detail: AccountFacts): string {
  const plan = detail.plan;
  const now = new Date();
  if (!plan) return "No household yet";
  const until = plan.ends_at ? ` until ${shortDay(new Date(plan.ends_at), now)}` : "";
  const source: string = plan.source;
  if (plan.tier !== "free") {
    if (source === "promo_code") {
      const live = detail.grants.find(
        (g) => !g.ended && (!g.endsAt || Date.parse(g.endsAt) > Date.now()),
      );
      return `${planName(plan)} from ${live ? `code ${live.code}` : "a code"}${until}`;
    }
    if (source === "admin_grant") return `${planName(plan)}, given by an admin${until}`;
    return `${planName(plan)}${until}`;
  }
  // Free: say what it was before, when a code's Premium ended.
  const ended = [...detail.grants]
    .filter((g) => g.ended || (g.endsAt && Date.parse(g.endsAt) <= Date.now()))
    .sort((a, b) => (b.endsAt ?? b.usedAt).localeCompare(a.endsAt ?? a.usedAt))[0];
  if (ended) {
    const tier = ended.tier === "household" ? "Household" : "Individual";
    return `Free · was ${tier} (code ${ended.code})${
      ended.endsAt ? ` until ${shortDay(new Date(ended.endsAt), now)}` : ""
    }`;
  }
  if (!detail.emailVerified && detail.grants.length > 0) {
    const code = detail.grants[0];
    if (code)
      return `${code.tier === "household" ? "Household" : "Individual"} from code ${code.code}, once verified`;
  }
  return "Free";
}
