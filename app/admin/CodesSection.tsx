import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import type { AdminCode, AdminCodeUse, CodeChanges, NewCode } from "../../shared/codes";
import styles from "./admin.module.css";

// Codes that give free Premium (phase B5), and the invite-only sign-up switch. The server checks
// everything again and records each change in the audit log.

const ERRORS: Record<string, string> = {
  invalid_label: "Give the code a name (up to 100 characters).",
  invalid_code: "Codes use letters, numbers and dashes (4 to 40).",
  code_taken: "That code already exists. Choose another, or leave it blank for a random one.",
  invalid_access: "Choose a date in the future, or a number of days (1 to 3650).",
  invalid_max_uses: "The number of uses must be a whole number, at least 1.",
  invalid_redeem_by: "The last day to use it must be in the future.",
  not_a_date_code: "Only codes that last until a date have a date to change.",
  no_changes: "Nothing has changed.",
  already_disabled: "That code is already turned off.",
};

function errorText(body: unknown): string {
  const code = (body as { error?: string } | null)?.error;
  return (code && ERRORS[code]) ?? "Something went wrong. Try again.";
}

async function send(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => null)) as unknown;
  return { ok: res.ok, json };
}

function day(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";
}

/** A date field's value ("2027-03-31") as the end of that day where the admin is. */
function endOfDay(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999).toISOString();
}

/** An ISO time as a date field's value, in the admin's own time zone. */
function dateValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function gives(code: AdminCode): string {
  const plan = code.tier === "household" ? "Household" : "Individual";
  return "until" in code.access
    ? `${plan}, until ${day(code.access.until)}`
    : `${plan}, ${code.access.days} days each`;
}

const STATUS: Record<AdminCode["status"], string> = {
  active: "Active",
  disabled: "Turned off",
  expired: "Expired",
  used_up: "All used",
};

// ---------------------------------------------------------------------------------------------

export function SignUpSwitch() {
  const [required, setRequired] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => (res.ok ? (res.json() as Promise<{ signUpRequiresCode: boolean }>) : null))
      .then((body) => setRequired(body?.signUpRequiresCode ?? null))
      .catch(() => setError("Couldn't load the sign-up setting."));
  }, []);

  const flip = async () => {
    if (required === null) return;
    setBusy(true);
    setError(null);
    const { ok, json } = await send("/api/admin/settings", "PUT", {
      signUpRequiresCode: !required,
    });
    setBusy(false);
    if (ok) setRequired((json as { signUpRequiresCode: boolean }).signUpRequiresCode);
    else setError(errorText(json));
  };

  return (
    <section className={styles.card} aria-labelledby="sign-up-title">
      <h2 id="sign-up-title">Sign-up</h2>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {required === null ? (
        <p role="status">Loading…</p>
      ) : (
        <>
          <p className={styles.muted} role="status">
            {required
              ? "Invite-only: creating an account needs an invite code."
              : "Open: anyone can create an account. Promo codes are optional."}
          </p>
          <button type="button" className={styles.secondary} onClick={flip} disabled={busy}>
            {required ? "Open sign-up to everyone" : "Make sign-up invite-only"}
          </button>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

export function CodesSection() {
  const [codes, setCodes] = useState<AdminCode[] | null>(null);
  const [view, setView] = useState<
    { kind: "list" } | { kind: "new" } | { kind: "code"; id: string }
  >({ kind: "list" });
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/codes").catch(() => null);
    setCodes(res?.ok ? ((await res.json()) as AdminCode[]) : []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/codes")
      .then((res) => (res.ok ? (res.json() as Promise<AdminCode[]>) : []))
      .then((rows) => {
        if (!cancelled) setCodes(rows);
      })
      .catch(() => setCodes([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const backToList = async (message: string | null = null) => {
    setNotice(message);
    setView({ kind: "list" });
    await load();
  };

  return (
    <section className={styles.card} aria-labelledby="codes-title">
      <div className={styles.headingRow}>
        <h2 id="codes-title">Invite and promo codes</h2>
        {view.kind === "list" ? (
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              setNotice(null);
              setView({ kind: "new" });
            }}
          >
            New code
          </button>
        ) : null}
      </div>
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      {view.kind === "new" ? (
        <NewCodeForm onDone={backToList} />
      ) : view.kind === "code" ? (
        <CodeDetail id={view.id} onBack={backToList} />
      ) : codes === null ? (
        <p role="status">Loading…</p>
      ) : codes.length === 0 ? (
        <p className={styles.muted}>No codes yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Name</th>
                <th scope="col">Gives</th>
                <th scope="col">Used</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((code) => (
                <tr key={code.id}>
                  <td>
                    <button
                      type="button"
                      className={`${styles.linkButton} ${styles.code}`}
                      onClick={() => {
                        setNotice(null);
                        setView({ kind: "code", id: code.id });
                      }}
                    >
                      {code.code}
                    </button>
                  </td>
                  <td>{code.label}</td>
                  <td>{gives(code)}</td>
                  <td>
                    {code.uses}
                    {code.maxUses !== null ? ` of ${code.maxUses}` : ""}
                  </td>
                  <td>{STATUS[code.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

function NewCodeForm({ onDone }: { onDone: (message: string | null) => Promise<void> }) {
  const id = useId();
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [tier, setTier] = useState<"household" | "individual">("household");
  const [kind, setKind] = useState<"until" | "days">("until");
  const [until, setUntil] = useState("");
  const [days, setDays] = useState("30");
  const [allowsSignUp, setAllowsSignUp] = useState(true);
  const [maxUses, setMaxUses] = useState("");
  const [redeemBy, setRedeemBy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (kind === "until" && !until) {
      setError("Choose the date Premium lasts until.");
      return;
    }
    const input: NewCode = {
      label,
      tier,
      access: kind === "until" ? { until: endOfDay(until) } : { days: Number(days) },
      allowsSignUp,
      maxUses: maxUses ? Number(maxUses) : null,
      redeemBy: redeemBy ? endOfDay(redeemBy) : null,
      ...(code.trim() ? { code: code.trim() } : {}),
    };
    setBusy(true);
    const { ok, json } = await send("/api/admin/codes", "POST", input);
    setBusy(false);
    if (ok) await onDone(`Created ${(json as AdminCode).code}.`);
    else setError(errorText(json));
  };

  return (
    <form className={styles.stack} onSubmit={submit} aria-label="New code">
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <div className={styles.field}>
        <label htmlFor={`${id}-label`}>Name</label>
        <input
          id={`${id}-label`}
          required
          maxLength={100}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-describedby={`${id}-label-hint`}
        />
        <p id={`${id}-label-hint`} className={styles.hint}>
          For you, not shown to people. For example &ldquo;Beta testers, first wave&rdquo;.
        </p>
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-code`}>Code (optional)</label>
        <input
          id={`${id}-code`}
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-describedby={`${id}-code-hint`}
        />
        <p id={`${id}-code-hint`} className={styles.hint}>
          Leave blank for a random code that can&rsquo;t be guessed.
        </p>
      </div>
      <fieldset className={styles.choices}>
        <legend>Plan</legend>
        <label className={styles.choice}>
          <input
            type="radio"
            name={`${id}-tier`}
            checked={tier === "household"}
            onChange={() => setTier("household")}
          />
          Premium Household
        </label>
        <label className={styles.choice}>
          <input
            type="radio"
            name={`${id}-tier`}
            checked={tier === "individual"}
            onChange={() => setTier("individual")}
          />
          Premium Individual
        </label>
      </fieldset>
      <fieldset className={styles.choices}>
        <legend>Premium lasts</legend>
        <div className={styles.choice}>
          <input
            id={`${id}-until-kind`}
            type="radio"
            name={`${id}-kind`}
            checked={kind === "until"}
            onChange={() => setKind("until")}
          />
          <label htmlFor={`${id}-until-kind`}>Until a date, for everyone</label>
          <input
            type="date"
            aria-label="Premium lasts until"
            value={until}
            disabled={kind !== "until"}
            onChange={(e) => setUntil(e.target.value)}
          />
        </div>
        <div className={styles.choice}>
          <input
            id={`${id}-days-kind`}
            type="radio"
            name={`${id}-kind`}
            checked={kind === "days"}
            onChange={() => setKind("days")}
          />
          <label htmlFor={`${id}-days-kind`}>A number of days from when each person uses it</label>
          <input
            type="number"
            aria-label="Number of days"
            min={1}
            max={3650}
            value={days}
            disabled={kind !== "days"}
            onChange={(e) => setDays(e.target.value)}
          />
        </div>
        <p className={styles.hint}>
          A date can be moved later, and it moves for everyone who used the code.
        </p>
      </fieldset>
      <label className={styles.choice}>
        <input
          type="checkbox"
          checked={allowsSignUp}
          onChange={(e) => setAllowsSignUp(e.target.checked)}
        />
        Can be used to create an account (an invite)
      </label>
      <div className={styles.field}>
        <label htmlFor={`${id}-max`}>How many people can use it (optional)</label>
        <input
          id={`${id}-max`}
          type="number"
          min={1}
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-by`}>Last day it can be used (optional)</label>
        <input
          id={`${id}-by`}
          type="date"
          value={redeemBy}
          onChange={(e) => setRedeemBy(e.target.value)}
        />
      </div>
      <div className={styles.row}>
        <button type="submit" className={styles.button} disabled={busy}>
          {busy ? "Creating…" : "Create code"}
        </button>
        <button type="button" className={styles.secondary} onClick={() => void onDone(null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------

function CodeDetail({
  id,
  onBack,
}: {
  id: string;
  onBack: (message: string | null) => Promise<void>;
}) {
  const formId = useId();
  const [data, setData] = useState<{ code: AdminCode; uses: AdminCodeUse[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [until, setUntil] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [redeemBy, setRedeemBy] = useState("");
  const [endAccess, setEndAccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const show = useCallback((next: { code: AdminCode; uses: AdminCodeUse[] }) => {
    setData(next);
    setLabel(next.code.label);
    setUntil("until" in next.code.access ? dateValue(next.code.access.until) : "");
    setMaxUses(next.code.maxUses === null ? "" : String(next.code.maxUses));
    setRedeemBy(dateValue(next.code.redeemBy));
  }, []);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/admin/codes/${id}`);
    if (res.ok) show((await res.json()) as { code: AdminCode; uses: AdminCodeUse[] });
    else setError("Couldn't load that code.");
  }, [id, show]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/codes/${id}`)
      .then((res) =>
        res.ok ? (res.json() as Promise<{ code: AdminCode; uses: AdminCodeUse[] }>) : null,
      )
      .then((next) => {
        if (cancelled) return;
        if (next) show(next);
        else setError("Couldn't load that code.");
      })
      .catch(() => setError("Couldn't load that code."));
    return () => {
      cancelled = true;
    };
  }, [id, show]);

  if (!data) {
    return error ? (
      <p role="alert" className={styles.error}>
        {error}
      </p>
    ) : (
      <p role="status">Loading…</p>
    );
  }
  const { code, uses } = data;
  const isDateCode = "until" in code.access;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const changes: CodeChanges = {};
    if (label.trim() !== code.label) changes.label = label;
    if (
      isDateCode &&
      until &&
      until !== dateValue("until" in code.access ? code.access.until : null)
    )
      changes.accessUntil = endOfDay(until);
    const max = maxUses ? Number(maxUses) : null;
    if (max !== code.maxUses) changes.maxUses = max;
    const by = redeemBy ? endOfDay(redeemBy) : null;
    if (redeemBy !== dateValue(code.redeemBy)) changes.redeemBy = by;
    setBusy(true);
    const { ok, json } = await send(`/api/admin/codes/${code.id}`, "PATCH", changes);
    setBusy(false);
    if (ok) await onBack(`Saved ${code.code}.`);
    else setError(errorText(json));
  };

  const turnOff = async () => {
    setError(null);
    setBusy(true);
    const { ok, json } = await send(`/api/admin/codes/${code.id}/disable`, "POST", { endAccess });
    setBusy(false);
    if (ok) await onBack(`Turned off ${code.code}.`);
    else setError(errorText(json));
  };

  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <button type="button" className={styles.secondary} onClick={() => void onBack(null)}>
          Back to codes
        </button>
      </div>
      <h3 className={styles.code}>{code.code}</h3>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <dl className={styles.details}>
        <div>
          <dt>Gives</dt>
          <dd>{gives(code)}</dd>
        </div>
        <div>
          <dt>Creates accounts</dt>
          <dd>{code.allowsSignUp ? "Yes (an invite)" : "No (existing accounts only)"}</dd>
        </div>
        <div>
          <dt>Used</dt>
          <dd>
            {code.uses}
            {code.maxUses !== null ? ` of ${code.maxUses}` : ""}
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{STATUS[code.status]}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{day(code.createdAt)}</dd>
        </div>
      </dl>

      <form className={styles.stack} onSubmit={save} aria-label="Change this code">
        <div className={styles.field}>
          <label htmlFor={`${formId}-label`}>Name</label>
          <input
            id={`${formId}-label`}
            required
            maxLength={100}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        {isDateCode ? (
          <div className={styles.field}>
            <label htmlFor={`${formId}-until`}>Premium lasts until</label>
            <input
              id={`${formId}-until`}
              type="date"
              required
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              aria-describedby={`${formId}-until-hint`}
            />
            <p id={`${formId}-until-hint`} className={styles.hint}>
              Changes it for everyone who used this code.
            </p>
          </div>
        ) : null}
        <div className={styles.field}>
          <label htmlFor={`${formId}-max`}>How many people can use it (blank for no limit)</label>
          <input
            id={`${formId}-max`}
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${formId}-by`}>Last day it can be used (blank for none)</label>
          <input
            id={`${formId}-by`}
            type="date"
            value={redeemBy}
            onChange={(e) => setRedeemBy(e.target.value)}
          />
        </div>
        <div className={styles.row}>
          <button type="submit" className={styles.button} disabled={busy}>
            Save changes
          </button>
        </div>
      </form>

      {code.disabledAt ? null : (
        <div className={styles.stack}>
          <h3>Turn off</h3>
          <p className={styles.hint}>
            Nobody new can use it. People who already used it keep their Premium unless you end it
            below.
          </p>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={endAccess}
              onChange={(e) => setEndAccess(e.target.checked)}
            />
            Also end Premium for the {uses.length} {uses.length === 1 ? "person" : "people"} who
            used it (they go back to Free; nothing is deleted)
          </label>
          <div className={styles.row}>
            <button type="button" className={styles.secondary} onClick={turnOff} disabled={busy}>
              Turn off this code
            </button>
          </div>
        </div>
      )}

      <h3>Who used it</h3>
      {uses.length === 0 ? (
        <p className={styles.muted}>Nobody yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Used</th>
                <th scope="col">Premium ends</th>
              </tr>
            </thead>
            <tbody>
              {uses.map((use) => (
                <tr key={`${use.email}-${use.usedAt}`}>
                  <td>
                    {use.name}
                    <br />
                    {use.email}
                  </td>
                  <td>{day(use.usedAt)}</td>
                  <td>
                    {day(use.endsAt)}
                    {use.ended ? " (ended early)" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className={styles.linkButton} onClick={() => void reload()}>
        Refresh
      </button>
    </div>
  );
}
