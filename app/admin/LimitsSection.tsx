import { useEffect, useId, useState, type FormEvent } from "react";
import type { PlanLimitRow } from "../../shared/adminAccounts";
import type { LimitKey } from "../../shared/entitlements";
import { adminRequest } from "./api";
import { LIMIT_LABELS, LIMIT_ORDER, inputValue, isBytes, parseInput, showLimit } from "./limits";
import styles from "./admin.module.css";

const TIER_NAMES: [string, string][] = [
  ["free", "Free"],
  ["individual", "Individual"],
  ["household", "Household"],
  ["trial", "During a trial"],
];

/** Every tier limit (plan_limits), editable one at a time. Changes ask for the passkey again. */
export function LimitsSection() {
  const [rows, setRows] = useState<PlanLimitRow[] | null>(null);
  const [editing, setEditing] = useState<{ tier: string; key: LimitKey } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void adminRequest<PlanLimitRow[]>("/api/admin/limits").then((result) => {
      if (!cancelled) setRows(result.ok ? (result.body as PlanLimitRow[]) : []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = (tier: string, key: LimitKey) =>
    rows?.find((r) => r.tier === tier && r.key === key);

  return (
    <section className={styles.card} aria-labelledby="limits-title">
      <h2 id="limits-title">Plan limits</h2>
      <p className={styles.muted}>
        What each plan allows. Changes reach everyone within about a minute, and ask for your
        passkey again. For one account, use an exception on its page instead.
      </p>
      {message ? (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      ) : null}
      {rows === null ? (
        <p role="status">Loading…</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Limit</th>
                {TIER_NAMES.map(([tier, name]) => (
                  <th scope="col" key={tier}>
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LIMIT_ORDER.map((key) => (
                <tr key={key}>
                  <th scope="row">{LIMIT_LABELS[key]}</th>
                  {TIER_NAMES.map(([tier, name]) => {
                    const row = value(tier, key);
                    if (editing?.tier === tier && editing.key === key) {
                      return (
                        <td key={tier}>
                          <EditLimit
                            tier={tier}
                            tierName={name}
                            limitKey={key}
                            current={row?.value ?? null}
                            onDone={(next, saved) => {
                              if (next) setRows(next);
                              if (saved) setMessage(saved);
                              setEditing(null);
                            }}
                          />
                        </td>
                      );
                    }
                    return (
                      <td key={tier}>
                        {row ? showLimit(key, row.value) : "—"}{" "}
                        {row || tier !== "trial" ? (
                          <button
                            type="button"
                            className={styles.linkButton}
                            onClick={() => {
                              setMessage(null);
                              setEditing({ tier, key });
                            }}
                          >
                            Change
                            <span className="visually-hidden">
                              {" "}
                              {LIMIT_LABELS[key]} for {name}
                            </span>
                          </button>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EditLimit({
  tier,
  tierName,
  limitKey,
  current,
  onDone,
}: {
  tier: string;
  tierName: string;
  limitKey: LimitKey;
  current: number | null;
  onDone: (rows: PlanLimitRow[] | null, message: string | null) => void;
}) {
  const id = useId();
  const [text, setText] = useState(inputValue(limitKey, current));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseInput(limitKey, text);
    if (parsed === undefined) {
      setError("A number, or blank for no limit.");
      return;
    }
    setBusy(true);
    const result = await adminRequest<PlanLimitRow[]>(`/api/admin/limits/${tier}/${limitKey}`, {
      method: "PUT",
      body: { value: parsed },
    });
    setBusy(false);
    if (result.ok) {
      onDone(
        result.body as PlanLimitRow[],
        `${LIMIT_LABELS[limitKey]} for ${tierName}: ${showLimit(limitKey, parsed)}.`,
      );
    } else {
      setError("That didn't save. Try again.");
    }
  };

  return (
    <form className={styles.stack} onSubmit={save}>
      <div className={styles.field}>
        <label htmlFor={`${id}-v`}>
          {LIMIT_LABELS[limitKey]} for {tierName}
          {isBytes(limitKey) ? " (MB)" : ""}
        </label>
        <input
          id={`${id}-v`}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby={`${id}-hint`}
        />
        <p id={`${id}-hint`} className={styles.hint}>
          Blank for no limit.
        </p>
      </div>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <div className={styles.row}>
        <button type="submit" className={styles.button} disabled={busy}>
          Save
        </button>
        <button type="button" className={styles.secondary} onClick={() => onDone(null, null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
