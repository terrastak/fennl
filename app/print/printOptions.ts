import { useEffect, useState } from "react";
import { printOptions, type PrintOptions } from "../../shared/print";
import { useSession } from "../auth/client";

// What printouts hold (phase F6). The choices belong to the account, so they follow the person
// to every device; this device keeps a copy so they still hold with no connection, and a
// printout never waits on the server for them.

const cacheKey = "fennl:print";

function cached(): PrintOptions | null {
  try {
    const value = localStorage.getItem(cacheKey);
    return value ? printOptions(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}

function keep(options: PrintOptions): void {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(options));
  } catch {
    // Not kept; the account's choices come back with the next session.
  }
}

async function save(options: PrintOptions): Promise<boolean> {
  try {
    const res = await fetch("/api/account/print", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ options }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function fromAccount(text: string | null | undefined): PrintOptions | null {
  if (!text) return null;
  try {
    return printOptions(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The account's print choices, and a way to change them (false when they couldn't be saved). */
export function usePrintOptions(): [PrintOptions, (options: PrintOptions) => Promise<boolean>] {
  const { data: session, refetch } = useSession();
  const [chosen, setChosen] = useState<PrintOptions | null>(null);
  const stored = session?.user.printOptions;
  const options = chosen ?? fromAccount(stored) ?? cached() ?? printOptions(null);

  const choose = async (next: PrintOptions) => {
    setChosen(next);
    keep(next);
    const saved = await save(next);
    if (saved) void refetch();
    return saved;
  };
  useEffect(() => {
    const account = fromAccount(stored);
    if (account) keep(account);
  }, [stored]);
  return [options, choose];
}
