import { useEffect, useState } from "react";
import { isUnitSystem, type UnitSystem } from "../../shared/scale";
import { useSession } from "../auth/client";

// The units recipes are read in (phase F1): as written, US or metric. The choice belongs to the
// account, so it follows the person to every device; this device keeps a copy so it still holds
// with no connection.

const cacheKey = "fennl:units";

function cachedUnits(): UnitSystem | null {
  try {
    const value = localStorage.getItem(cacheKey);
    return isUnitSystem(value) ? value : null;
  } catch {
    return null;
  }
}

function keepUnits(units: UnitSystem): void {
  try {
    localStorage.setItem(cacheKey, units);
  } catch {
    // Not kept; the account's choice comes back with the next session.
  }
}

async function saveUnits(units: UnitSystem): Promise<boolean> {
  try {
    const res = await fetch("/api/account/units", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ units }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The account's units, and a way to change them (false when it couldn't be saved). */
export function useUnits(): [UnitSystem, (units: UnitSystem) => Promise<boolean>] {
  const { data: session, refetch } = useSession();
  const [chosen, setChosen] = useState<UnitSystem | null>(null);
  const account = session?.user.units;
  const units = chosen ?? (isUnitSystem(account) ? account : null) ?? cachedUnits() ?? "written";

  const choose = async (next: UnitSystem) => {
    setChosen(next);
    keepUnits(next);
    const saved = await saveUnits(next);
    if (saved) void refetch();
    return saved;
  };
  useEffect(() => {
    if (isUnitSystem(account)) keepUnits(account);
  }, [account]);
  return [units, choose];
}
