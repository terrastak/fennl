// The paths of the admin console's small icons on a laptop (U23; AdminIcon.tsx).
export const ADMIN_ICONS = {
  /** A circle with an exclamation mark: Needs attention. */
  attention: "M12 8v5M12 16.5h.01M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0",
  /** Two people: Accounts. */
  people:
    "M15.5 19v-1.5a3.5 3.5 0 0 0-3.5-3.5H6a3.5 3.5 0 0 0-3.5 3.5V19M12.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0M21.5 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.1a3.5 3.5 0 0 1 0 6.8",
  /** A speech bubble: Feedback. */
  message: "M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z",
  /** A ticket: Codes and sign-up. */
  ticket:
    "M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4zM10 6v12",
  /** Sliders: Plan limits. */
  sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  /** Sparkles: AI imports. */
  spark:
    "M10 3.5 11.6 8.4 16.5 10 11.6 11.6 10 16.5 8.4 11.6 3.5 10 8.4 8.4zM18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z",
  /** Lines of a list: Activity. */
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  /** A person with a shield's outline: Your admin account. */
  shield: "M12 3.5 19.5 6v5.5c0 4.4-3.2 7.9-7.5 9-4.3-1.1-7.5-4.6-7.5-9V6z",
  /** An arrow out of a door: Sign out. */
  signOut: "M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16.5 5.5 12 10 7.5M5.5 12h10",
  search: "M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0M20 20l-3.5-3.5",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  chevronRight: "m9 6 6 6-6 6",
  chevron: "m6 9 6 6 6-6",
  check: "m5 12.5 4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  /** A key: asks for the passkey again. */
  key: "M14.5 14a5 5 0 1 0-4.6-3L3.5 17.4V20.5h3.1v-2h2v-2h2l1.4-1.4a5 5 0 0 0 2.5-1.1M16.5 7.5h.01",
  /** An eye: View as. */
  eye: "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  /** A star: Premium. */
  star: "m12 3.5 2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z",
  pen: "M4 20h4L19 9l-4-4L4 16z",
  /** An envelope: email. */
  mail: "M3.5 6.5h17v11h-17zM3.5 7l8.5 6.5L20.5 7",
  /** A paper plane: send again. */
  send: "M21 3 10.5 13.5M21 3l-6.5 18-4-7.5-7.5-4z",
  /** A clock going back: the admin log. */
  history: "M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4M12 7.5V12l3 2",
  /** An unlocked padlock: password help. */
  lock: "M6 11h12v9H6zM8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2",
  info: "M12 11v6M12 7.5h.01M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0",
  /** Two sheets: copy. */
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  /** An arrow curling back: undo, move back. */
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  /** A plus: new. */
  plus: "M12 5v14M5 12h14",
  /** A circular arrow: refresh. */
  refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v4.5h-4.5",
  /** A switch off: turn off. */
  off: "M12 3.5v8M7 6.3a7.5 7.5 0 1 0 10 0",
} as const;

export type AdminIconName = keyof typeof ADMIN_ICONS;
