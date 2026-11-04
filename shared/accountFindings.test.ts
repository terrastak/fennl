import { describe, expect, it } from "vitest";
import type { AccountEvent } from "./accountEvents";
import {
  accountFindings,
  accountHistory,
  accountOverview,
  dateWords,
  firstName,
  needsAttention,
  type AccountRecords,
  type Finding,
} from "./accountFindings";
import { LIMIT_KEYS, type Entitlements } from "./entitlements";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Wednesday 4 November 2026, 12:00 UTC.
const NOW = Date.UTC(2026, 10, 4, 12, 0);

function plan(over: Partial<Entitlements> = {}): Entitlements {
  const limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, null])) as Record<
    (typeof LIMIT_KEYS)[number],
    number | null
  >;
  return {
    ...limits,
    max_recipes: 100,
    max_text_bytes: 3 * 1024 * 1024,
    max_recipe_bytes: 256 * 1024,
    max_devices: 1,
    tier: "free",
    source: "free",
    trialing: false,
    past_due: false,
    ends_at: null,
    max_members: 1,
    images_enabled: false,
    offline_enabled: false,
    history_enabled: false,
    import_structured_enabled: true,
    import_ai_enabled: false,
    ...over,
  };
}

function records(over: Partial<AccountRecords> = {}): AccountRecords {
  const free = plan();
  return {
    person: {
      id: "dana",
      name: "Dana Ortiz",
      email: "dana@oldwork.com",
      emailVerified: true,
      emailProblem: null,
      createdAt: NOW - 34 * DAY,
      mustChangePassword: false,
      role: null,
    },
    signInMethods: ["credential"],
    household: { id: "h1", name: "Dana", members: [{ userId: "dana", name: "Dana Ortiz" }] },
    plan: free,
    freePlan: free,
    usage: {
      recipes: 10,
      textBytes: 50_000,
      maxRecipes: 100,
      maxTextBytes: 3 * 1024 * 1024,
      maxRecipeBytes: 256 * 1024,
    },
    codeGrants: [],
    adminGrants: [],
    devices: [],
    sessions: [{ createdAt: NOW - 2 * DAY }],
    emails: [],
    events: [],
    emailChanges: [],
    feedback: [],
    photoGrace: [],
    overrides: [],
    adminLog: [],
    handled: [],
    removalAt: null,
    ...over,
  };
}

const find = (r: AccountRecords, key: Finding["key"]) =>
  accountFindings(r, NOW).findings.find((f) => f.key === key);

const event = (e: Omit<AccountEvent, "id"> & { id?: string }, i = 0): AccountEvent =>
  ({ id: e.id ?? `e${i}`, ...e }) as AccountEvent;

/** Findings' words never use a gendered pronoun for the person. */
function noGenderedPronouns(findings: Finding[]) {
  for (const f of findings) {
    const words = [f.title, f.body, f.why ?? "", ...f.actions.map((a) => a.label)].join(" ");
    expect(words).not.toMatch(/\b(she|her|hers|he|him|his|herself|himself)\b/i);
  }
}

/** Dana's case from the mockup: Premium from a code ended, over Free's recipe limit. */
function dana(): AccountRecords {
  return records({
    usage: {
      recipes: 142,
      textBytes: 1.1 * 1024 * 1024,
      maxRecipes: 100,
      maxTextBytes: 3 * 1024 * 1024,
      maxRecipeBytes: 256 * 1024,
    },
    codeGrants: [
      {
        id: "g1",
        code: "FRIENDS-OCT",
        tier: "individual",
        startsAt: NOW - 34 * DAY,
        endsAt: NOW - 4 * DAY,
        revokedAt: null,
        createdAt: NOW - 34 * DAY,
      },
    ],
    events: [
      event(
        {
          id: "r2",
          kind: "limit_refused",
          details: { limit: "max_recipes", what: "recipe", used: 142, max: 100, origin: "app" },
          at: NOW - 2 * HOUR,
        },
        0,
      ),
      event({
        id: "r1",
        kind: "limit_refused",
        details: { limit: "max_recipes", what: "import", origin: "server" },
        at: NOW - 3 * DAY,
      }),
    ],
    feedback: [
      {
        id: "f1",
        message: "I can’t add new recipes anymore, it says I’m over a limit?",
        createdAt: NOW - DAY,
        readAt: null,
        repliedAt: null,
        doneAt: null,
      },
    ],
  });
}

describe("can't add", () => {
  it("explains a lapsed code, the refusals and the feedback, with buttons to fix it", () => {
    const r = dana();
    const f = find(r, "cant_add");
    expect(f).toMatchObject({
      level: "needs_you",
      title: "Dana can’t add recipes: their free Premium ended",
      fingerprint: "max_recipes:r2",
      since: new Date(NOW - 4 * DAY).toISOString(),
      sinceText: "since Oct 31",
      handled: null,
    });
    expect(f?.body).toContain("Code FRIENDS-OCT gave them Individual until Oct 31");
    expect(f?.body).toContain("142 recipes, over Free’s 100");
    expect(f?.body).toContain("Nothing has been deleted.");
    expect(f?.body).toContain("2 tries");
    expect(f?.why).toBe(
      "Probably why they wrote to you yesterday: “I can’t add new recipes anymore, it says I’m over a limit?”",
    );
    expect(f?.actions).toEqual([
      { kind: "extend_premium", label: "Extend their Premium…", tier: "individual" },
      { kind: "raise_limit", label: "Raise their recipe limit…", limit: "max_recipes", value: 200 },
    ]);
    noGenderedPronouns(accountFindings(r, NOW).findings);
  });

  it("isn't there under the limits, and says so among the checks", () => {
    const { findings, fine } = accountFindings(records(), NOW);
    expect(findings).toEqual([]);
    expect(fine).toContain("Under every limit that stops adding");
    expect(fine).toContain("No unread feedback");
    expect(fine).toContain("Emails are arriving");
    expect(fine).toContain("Signs in with email and password; no temporary password waiting");
  });

  it("a new refusal changes the fingerprint", () => {
    const r = dana();
    const before = find(r, "cant_add")?.fingerprint;
    r.events.unshift(
      event({
        id: "r3",
        kind: "limit_refused",
        details: { limit: "max_recipes", what: "restore", origin: "server" },
        at: NOW - HOUR,
      }),
    );
    expect(find(r, "cant_add")?.fingerprint).not.toBe(before);
  });
});

describe("handled", () => {
  it("is shown with who and the note, and leaves Needs attention, at the same fingerprint", () => {
    const r = dana();
    r.handled = [
      {
        finding: "cant_add",
        fingerprint: "max_recipes:r2",
        adminName: "Brian",
        note: "Replied by email",
        handledAt: NOW - HOUR,
      },
    ];
    const f = find(r, "cant_add");
    expect(f?.handled).toEqual({
      at: new Date(NOW - HOUR).toISOString(),
      by: "Brian",
      note: "Replied by email",
    });
    expect(f && needsAttention(f)).toBe(false);
  });

  it("comes back when something new happens", () => {
    const r = dana();
    r.handled = [
      {
        finding: "cant_add",
        fingerprint: "max_recipes:r1",
        adminName: "Brian",
        note: null,
        handledAt: NOW - 2 * DAY,
      },
    ];
    const f = find(r, "cant_add");
    expect(f?.handled).toBeNull();
    expect(f && needsAttention(f)).toBe(true);
  });
});

describe("emails", () => {
  it("a bounced sign-up link, with the likely typo", () => {
    const r = records({
      person: {
        ...records().person,
        name: "Sarah Lee",
        email: "sarah.lee@gmial.com",
        emailVerified: false,
        emailProblem: "bounced",
        createdAt: NOW - 2 * HOUR,
      },
      emails: [
        {
          id: "m1",
          kind: "verification",
          toAddress: "sarah.lee@gmial.com",
          sentAt: NOW - 2 * HOUR,
          status: "bounced",
          statusAt: NOW - 2 * HOUR,
          detail: "The domain gmial.com doesn't exist",
        },
      ],
      removalAt: NOW + 22 * HOUR,
      codeGrants: [
        {
          id: "g1",
          code: "SPRING-BETA",
          tier: "individual",
          startsAt: NOW - 2 * HOUR,
          endsAt: null,
          revokedAt: null,
          createdAt: NOW - 2 * HOUR + 500,
        },
      ],
    });
    const { findings, fine } = accountFindings(r, NOW);
    const bounced = findings.find((f) => f.key === "sign_up_bounced");
    expect(bounced).toMatchObject({
      level: "needs_you",
      title: "Sarah’s sign-up link couldn’t be delivered",
      fingerprint: "m1",
      sinceText: "2 hours ago",
    });
    expect(bounced?.body).toContain("It looks like a typo for gmail.com.");
    expect(bounced?.actions[0]).toEqual({
      kind: "fix_sign_up_address",
      label: "Change to sarah.lee@gmail.com and send the link",
      email: "sarah.lee@gmail.com",
    });
    // Not shown twice as "emails not arriving".
    expect(findings.some((f) => f.key === "email_not_arriving")).toBe(false);
    const removal = findings.find((f) => f.key === "unverified_removal");
    expect(removal).toMatchObject({ level: "worth_knowing", sinceText: "22 hours left" });
    expect(removal?.title).toBe("Removed tomorrow at 10:00 if Sarah doesn’t verify");
    expect(removal?.body).toContain("invite code SPRING-BETA comes back");
    expect(fine).not.toContain("Emails are arriving");
    noGenderedPronouns(findings);

    const history = accountHistory(r, NOW);
    expect(history[0]).toMatchObject({
      category: "email",
      text: "“Verify your email for Fennl” to sarah.lee@gmial.com bounced.",
      detail: "The mail server said: The domain gmial.com doesn't exist",
      problem: true,
      keptForGood: false,
    });
    const signUp = history.find((h) => h.text.startsWith("Signed up"));
    expect(signUp).toMatchObject({ category: "plan", keptForGood: true });
    expect(signUp?.text).toBe(
      "Signed up with email and password, using invite code SPRING-BETA (Individual, no end date).",
    );
  });

  it("emails not arriving to a verified address, and the address blocked", () => {
    const bounced = records({
      person: { ...records().person, emailProblem: "bounced" },
      emails: [
        {
          id: "m2",
          kind: "photo_grace_started",
          toAddress: "dana@oldwork.com",
          sentAt: NOW - 4 * DAY,
          status: "bounced",
          statusAt: NOW - 4 * DAY,
          detail: "Mailbox does not exist",
        },
      ],
    });
    const f = find(bounced, "email_not_arriving");
    expect(f).toMatchObject({
      level: "needs_you",
      fingerprint: "bounced:m2",
      sinceText: "since Oct 31",
    });
    expect(f?.actions.map((a) => a.kind)).toEqual(["change_email", "unblock"]);

    const blocked = records({ person: { ...records().person, emailProblem: "suppressed" } });
    expect(find(blocked, "email_not_arriving")?.fingerprint).toBe("suppressed:");
    expect(find(blocked, "email_not_arriving")?.body).toContain("Resend");
  });

  it("marked as spam", () => {
    const r = records({
      person: { ...records().person, name: "Mark Tan", emailProblem: "complained" },
      emails: [
        {
          id: "m3",
          kind: "temporary_password",
          toAddress: "dana@oldwork.com",
          sentAt: NOW - 2 * DAY,
          status: "complained",
          statusAt: NOW - 2 * DAY,
          detail: null,
        },
      ],
    });
    expect(find(r, "email_spam")).toMatchObject({
      title: "Mark marked “Your Fennl password was reset by support” as spam",
      fingerprint: "m3",
    });
    expect(accountFindings(r, NOW).fine).not.toContain("No spam complaints");
  });
});

describe("sign-ins", () => {
  const failures = (n: number, hasPassword = true) =>
    Array.from({ length: n }, (_, i) =>
      event(
        {
          id: `s${n - i}`,
          kind: "sign_in_failed",
          details: { browser: "Safari on iPhone", hasPassword },
          at: NOW - i * 60_000,
        },
        i,
      ),
    );

  it("five or more since the last sign-in", () => {
    expect(find(records({ events: failures(4) }), "failed_sign_ins")).toBeUndefined();
    const f = find(records({ events: failures(5) }), "failed_sign_ins");
    expect(f).toMatchObject({ title: "5 failed sign-ins in a row", fingerprint: "s5" });
    expect(f?.body).toContain("never what was typed");
    // Started today: how long, not "since 4 minutes ago".
    expect(f?.sinceText).toBe("in the last 4 minutes");
    expect(f?.body).toContain("5 times in the last 4 minutes, on Safari on iPhone");
    const earlier = find(
      records({ events: failures(5).map((e) => ({ ...e, at: e.at - 3 * HOUR })) }),
      "failed_sign_ins",
    );
    expect(earlier?.sinceText).toBe("in the last 4 hours");
    const yesterday = find(
      records({ events: failures(5).map((e) => ({ ...e, at: e.at - DAY })) }),
      "failed_sign_ins",
    );
    expect(yesterday?.sinceText).toBe("since yesterday");
    expect(f?.actions).toEqual([{ kind: "password_reset", label: "Send a password reset email" }]);
  });

  it("a sign-in after them ends the run", () => {
    const events = [
      event({
        id: "in",
        kind: "signed_in",
        details: { browser: "Safari on iPhone", method: "password" },
        at: NOW,
      }),
      ...failures(6).map((e) => ({ ...e, at: e.at - HOUR })),
    ];
    expect(find(records({ events }), "failed_sign_ins")).toBeUndefined();
  });

  it("says when the account has no password", () => {
    const f = find(
      records({ signInMethods: ["google"], events: failures(5, false) }),
      "failed_sign_ins",
    );
    expect(f?.body).toContain("signs in with Google");
  });
});

describe("worth knowing", () => {
  it("photos to be deleted, Premium ending, back-and-forth devices, failing imports", () => {
    const r = records({
      photoGrace: [
        {
          id: "pg",
          startedAt: NOW - 4 * DAY,
          deleteAfter: NOW + 86 * DAY,
          remindedDays: 90,
          endedAt: null,
          endedReason: null,
        },
      ],
      events: [
        event({
          id: "t2",
          kind: "device_taken_over",
          details: { browser: "Chrome on Mac", by: "Safari on iPhone" },
          at: NOW - HOUR,
        }),
        event({
          id: "t1",
          kind: "device_taken_over",
          details: { browser: "Safari on iPhone", by: "Chrome on Mac" },
          at: NOW - DAY,
        }),
        event({
          id: "i3",
          kind: "import_failed",
          details: { source: "photos", reason: "no_recipe" },
          at: NOW - HOUR,
        }),
        event({
          id: "i2",
          kind: "import_failed",
          details: { source: "photos", reason: "no_recipe" },
          at: NOW - 2 * HOUR,
        }),
        event({
          id: "i1",
          kind: "import_failed",
          details: { source: "web", reason: "ai_unavailable" },
          at: NOW - 3 * HOUR,
        }),
      ],
    });
    const { findings } = accountFindings(r, NOW);
    expect(findings.find((f) => f.key === "photos_deleted_on")).toMatchObject({
      level: "worth_knowing",
      sinceText: "86 days left",
      title: "Dana’s photos will be deleted on Jan 29, 2027",
    });
    expect(findings.find((f) => f.key === "device_back_and_forth")).toMatchObject({
      title: "Switching between Chrome on Mac and Safari on iPhone signs Dana out",
      sinceText: "twice since yesterday",
    });
    const imports = findings.find((f) => f.key === "imports_failing");
    expect(imports?.title).toBe("3 imports failed in the last 7 days");
    expect(imports?.sinceText).toBe("in the last 3 hours");
    expect(imports?.body).toContain("From photos: no recipe was found");
    noGenderedPronouns(findings);

    const ending = records({
      plan: plan({
        tier: "individual",
        source: "promo_code",
        ends_at: new Date(NOW + 3 * DAY).toISOString(),
        max_recipes: null,
      }),
      usage: { ...records().usage!, recipes: 150 },
      codeGrants: [
        {
          id: "g",
          code: "BETA-FALL",
          tier: "individual",
          startsAt: NOW - 30 * DAY,
          endsAt: NOW + 3 * DAY,
          revokedAt: null,
          createdAt: NOW - 30 * DAY,
        },
      ],
    });
    const f = find(ending, "premium_ending");
    expect(f?.title).toBe("Free Premium ends on Nov 7");
    expect(f?.body).toContain("Code BETA-FALL gives them Individual until Nov 7");
    expect(f?.body).toContain("over Free’s 100");
    expect(f?.sinceText).toBe("3 days left");
  });

  it("an email change waiting and a temporary password", () => {
    const r = records({
      person: { ...records().person, mustChangePassword: true },
      emailChanges: [
        {
          id: "c1",
          kind: "change",
          oldEmail: "dana@oldwork.com",
          newEmail: "dana@new.com",
          byAdmin: true,
          createdAt: NOW - HOUR,
          expiresAt: NOW + 23 * HOUR,
          completedAt: null,
          cancelledAt: null,
        },
      ],
      adminLog: [
        {
          id: "a1",
          action: "account.temporary_password_set",
          adminName: "Brian",
          reason: null,
          details: {},
          createdAt: NOW - DAY,
        },
      ],
    });
    const { findings, fine } = accountFindings(r, NOW);
    expect(findings.map((f) => f.key)).toEqual(["email_change_waiting", "temporary_password"]);
    expect(findings[1]?.body).toContain("Brian set a temporary password yesterday");
    expect(fine).not.toContain("No email change waiting");
  });
});

describe("what happened", () => {
  it("everything, newest first, with problems marked and what's kept for good", () => {
    const r = dana();
    r.adminLog = [
      {
        id: "a2",
        action: "account.viewed",
        adminName: "Brian",
        reason: null,
        details: {},
        createdAt: NOW - 10 * 60_000,
      },
      {
        id: "a1",
        action: "premium.extended",
        adminName: "Brian",
        reason: "Beta tester",
        details: { tier: "individual", until: new Date(NOW + 30 * DAY).toISOString() },
        createdAt: NOW - 5 * 60_000,
      },
    ];
    const { history } = accountOverview(r, NOW);
    const times = history.map((h) => Date.parse(h.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(history[0]).toMatchObject({
      category: "plan",
      text: "Brian gave Premium Individual until Dec 4",
      detail: "Reason: Beta tester",
      keptForGood: true,
    });
    // Opening the account isn't a line of its own.
    expect(history.some((h) => h.text.includes("viewed"))).toBe(false);
    const refused = history.find((h) => h.category === "recipes");
    expect(refused).toMatchObject({
      text: "Adding a recipe was refused: the recipe limit (142 of 100). Stopped in the app before sending.",
      problem: true,
      keptForGood: false,
    });
    expect(history.find((h) => h.text === "Premium from code FRIENDS-OCT ended.")).toMatchObject({
      problem: true,
      keptForGood: true,
    });
    expect(history.find((h) => h.category === "support")).toMatchObject({
      text: "Sent feedback: “I can’t add new recipes anymore, it says I’m over a limit?”",
      detail: "Not read yet",
      problem: true,
      keptForGood: true,
    });
  });
});

describe("words", () => {
  it("first names and dates in the admin's time zone", () => {
    expect(firstName("Dana Ortiz")).toBe("Dana");
    expect(firstName("  ")).toBe("This person");
    const utc = dateWords(NOW);
    expect(utc.ago(NOW - 3 * HOUR)).toBe("3 hours ago");
    expect(utc.ago(NOW - 30 * 60_000)).toBe("30 minutes ago");
    expect(utc.relativeDay(NOW + DAY)).toBe("tomorrow");
    expect(utc.left(NOW + 5 * DAY)).toBe("5 days left");
    // 12:00 UTC is 21:00 in Tokyo.
    expect(dateWords(NOW, "Asia/Tokyo").time(NOW)).toBe("21:00");
    expect(dateWords(NOW, "Not/AZone").time(NOW)).toBe("12:00");
  });
});
