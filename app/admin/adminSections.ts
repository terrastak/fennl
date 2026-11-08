import { useEffect, type RefObject } from "react";
import type { AdminIconName } from "./adminIcons";

// The admin console's sections, in the order its navigation lists them, and "/" for Find an
// account on a laptop (U23; AdminPanel.tsx).

export const SECTIONS = [
  { id: "attention", name: "Needs attention", icon: "attention", group: "main" },
  { id: "accounts", name: "Accounts", icon: "people", group: "main" },
  { id: "feedback", name: "Feedback", icon: "message", group: "main" },
  { id: "codes", name: "Codes and sign-up", icon: "ticket", group: "settings" },
  { id: "limits", name: "Plan limits", icon: "sliders", group: "settings" },
  { id: "ai", name: "AI imports", icon: "spark", group: "settings" },
  { id: "activity", name: "Activity", icon: "list", group: "records" },
  { id: "you", name: "Your admin account", icon: "shield", group: "bottom" },
] as const satisfies readonly {
  id: string;
  name: string;
  icon: AdminIconName;
  group: "main" | "settings" | "records" | "bottom";
}[];

export type SectionId = (typeof SECTIONS)[number]["id"];

export const GROUPS = [
  { id: "main", heading: null },
  { id: "settings", heading: "Settings" },
  { id: "records", heading: "Records" },
] as const;

/** "/" jumps to Find an account, unless the key is typed into a field. */
export function useSlashToFind(findRef: RefObject<HTMLInputElement | null>, on: boolean) {
  useEffect(() => {
    if (!on) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      findRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findRef, on]);
}
