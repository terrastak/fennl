import { useEffect, useState } from "react";
import { useSession } from "../auth/client";

// Nutrition shown or hidden everywhere (phase F4). Hiding it never deletes anything. The choice
// belongs to the account, so it follows the person to every device; this device keeps a copy so
// it still holds with no connection.

const cacheKey = "fennl:hide-nutrition";

function cached(): boolean | null {
  try {
    const value = localStorage.getItem(cacheKey);
    return value === "1" ? true : value === "0" ? false : null;
  } catch {
    return null;
  }
}

function keep(hidden: boolean): void {
  try {
    localStorage.setItem(cacheKey, hidden ? "1" : "0");
  } catch {
    // Not kept; the account's choice comes back with the next session.
  }
}

async function save(hidden: boolean): Promise<boolean> {
  try {
    const res = await fetch("/api/account/nutrition", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hidden }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Whether nutrition is hidden, and a way to change it (false when it couldn't be saved). */
export function useHideNutrition(): [boolean, (hidden: boolean) => Promise<boolean>] {
  const { data: session, refetch } = useSession();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const account = session?.user.hideNutrition;
  const hidden = chosen ?? (typeof account === "boolean" ? account : null) ?? cached() ?? false;

  const choose = async (next: boolean) => {
    setChosen(next);
    keep(next);
    const saved = await save(next);
    if (saved) void refetch();
    return saved;
  };
  useEffect(() => {
    if (typeof account === "boolean") keep(account);
  }, [account]);
  return [hidden, choose];
}
