import { useEffect } from "react";
import { isColorScheme, type ColorScheme } from "../../shared/appearance";
import { useSession } from "../auth/client";
import { useAppearance } from "./appearance";

/**
 * The color scheme belongs to the account, so it follows the person to every device
 * (CLAUDE.md, "Design"). This device keeps a copy so the right colors show from the first paint.
 * Light/dark and text size stay per device.
 */
export async function saveAccountScheme(colorScheme: ColorScheme): Promise<boolean> {
  try {
    const res = await fetch("/api/account/appearance", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ colorScheme }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Keeps this device in step with the account: when the session brings the account's scheme,
 * use it here. Accounts only get a scheme when one is chosen in Settings; until then, each
 * device keeps whatever it shows.
 */
export function useAccountSchemeSync(): void {
  const { data: session } = useSession();
  const [appearance, update] = useAppearance();
  const signedIn = Boolean(session);
  const accountScheme = session?.user.colorScheme;

  useEffect(() => {
    if (signedIn && isColorScheme(accountScheme) && accountScheme !== appearance.scheme) {
      update({ scheme: accountScheme });
    }
    // Only when the account's value arrives or changes, not on every local change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, accountScheme]);
}
