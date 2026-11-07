// The small icons on the Account page and the email notice on a laptop (U23 slice 9), drawn with
// RowIcon (app/pages/SettingsRow.tsx) beside words that say the same thing.
export const ACCOUNT_ICONS = {
  /** An arrow out of a door, for signing out. */
  signOut: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10",
  laptop:
    "M6.5 5h11A1.5 1.5 0 0 1 19 6.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 13.5v-7A1.5 1.5 0 0 1 6.5 5zM3 19h18",
  phone: "M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2",
  tablet: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2",
  /** A puzzle piece, for a browser extension. */
  extension:
    "M9 4h3v2a2 2 0 1 0 4 0V4h3v5h-2a2 2 0 1 0 0 4h2v6h-5v-2a2 2 0 1 0-4 0v2H5v-5h2a2 2 0 1 0 0-4H5V4z",
  /** A plug, for disconnecting. */
  unplug: "M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5",
  /** A speech bubble, for feedback. */
  chat: "M4 5h16v11H9l-5 4z",
  /** An "i" in a circle, for a note that explains. */
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 11v5M12 8h.01",
  /** A warning sign, for an error about what was just typed. */
  alert: "M12 4 2.8 19.5h18.4zM12 10v4.5M12 17h.01",
  /** An envelope, for the email notice. */
  mail: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3.5 6.5l8.5 6 8.5-6",
  /** A picture, for the photos note. */
  photo:
    "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM10.6 10a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0zM21 16l-5-5-8 8",
} as const;

/** A small picture of the kind of device a label names ("Safari on iPhone"). */
export function deviceIcon(label: string): string {
  if (/\bon (iPhone|Android)\b/.test(label)) return ACCOUNT_ICONS.phone;
  if (/\bon iPad\b/.test(label)) return ACCOUNT_ICONS.tablet;
  return ACCOUNT_ICONS.laptop;
}
