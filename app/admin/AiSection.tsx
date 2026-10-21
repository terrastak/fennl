import { useEffect, useId, useState, type FormEvent } from "react";
import type { AdminAiOverview, AdminAiSettings } from "../../shared/adminAi";
import { adminRequest, errorOf } from "./api";
import { AiOutcomesSection } from "./AiOutcomesSection";
import { centsAsDollars, dollars, parseDollars } from "./aiMoney";
import styles from "./admin.module.css";

// The AI imports section (phase E7): what the AI has cost this month, by model and by household,
// and the Fennl-wide settings. Changes ask for the passkey again and go in the audit log.

export function AiSection() {
  const [overview, setOverview] = useState<AdminAiOverview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void adminRequest<AdminAiOverview>("/api/admin/ai").then((result) => {
      if (cancelled) return;
      if (result.ok) setOverview(result.body as AdminAiOverview);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <section className={styles.card} aria-labelledby="ai-title">
        <h2 id="ai-title">AI imports</h2>
        <p role="alert" className={styles.error}>
          Couldn&rsquo;t load the AI imports just now.
        </p>
      </section>
    );
  }
  if (!overview) return <p role="status">Loading…</p>;
  const { settings } = overview;
  const reads = overview.reads;
  return (
    <>
      <section className={styles.card} aria-labelledby="ai-title">
        <h2 id="ai-title">AI imports</h2>
        {overview.provider === null ? (
          <p role="status" className={styles.notice}>
            No AI is set up on this server, so AI imports are unavailable. Add the ANTHROPIC_API_KEY
            secret (docs/setup/e7-ai-import.md).
          </p>
        ) : null}
        {overview.paused ? (
          <p role="status" className={styles.notice}>
            Paused: this month&rsquo;s estimated cost has reached the pause amount, so AI imports
            are refused for everyone until the month ends. Raise the pause amount below to restart
            them now.
          </p>
        ) : null}
        <dl className={styles.details}>
          <div>
            <dt>Estimated cost this month ({overview.month}, UTC)</dt>
            <dd>{dollars(overview.spentMicroUsd)}</dd>
          </div>
          <div>
            <dt>Imports read</dt>
            <dd>
              {reads}
              {reads > 0
                ? `, ${overview.secondLooks} with a second look (${Math.round(
                    (overview.secondLooks / reads) * 100,
                  )}%)`
                : ""}
              {overview.rereads > 0 ? `, ${overview.rereads} read again` : ""}
            </dd>
          </div>
          <div>
            <dt>Alert and pause</dt>
            <dd>
              Email at ${centsAsDollars(settings.alertCents)}, pause at $
              {centsAsDollars(settings.pauseCents)}
            </dd>
          </div>
        </dl>

        {overview.byModel.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="visually-hidden">Cost this month by model</caption>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Calls</th>
                  <th scope="col">Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                {overview.byModel.map((m) => (
                  <tr key={m.model}>
                    <th scope="row">{m.model}</th>
                    <td>{m.calls}</td>
                    <td>{dollars(m.costMicroUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.muted}>Nothing has been read with the AI this month.</p>
        )}
      </section>

      {overview.households.length > 0 ? (
        <section className={styles.card} aria-labelledby="ai-households-title">
          <h2 id="ai-households-title">Households this month</h2>
          <p className={styles.muted}>The 25 that cost most.</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Household</th>
                  <th scope="col">AI imports</th>
                  <th scope="col">Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                {overview.households.map((h) => (
                  <tr key={h.householdId}>
                    <th scope="row">{h.name}</th>
                    <td>{h.imports}</td>
                    <td>{dollars(h.costMicroUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <AiOutcomesSection />

      <AiSettingsForm
        settings={settings}
        onSaved={(next) => setOverview({ ...overview, settings: next })}
      />
    </>
  );
}

function AiSettingsForm({
  settings,
  onSaved,
}: {
  settings: AdminAiSettings;
  onSaved: (settings: AdminAiSettings) => void;
}) {
  const id = useId();
  const [alert, setAlert] = useState(centsAsDollars(settings.alertCents));
  const [pause, setPause] = useState(centsAsDollars(settings.pauseCents));
  const [models, setModels] = useState(settings.models.join(", "));
  const [secondLook, setSecondLook] = useState(settings.secondLook);
  const [missing, setMissing] = useState(String(settings.missingAmounts));
  const [odd, setOdd] = useState(String(settings.oddAmount));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const alertCents = parseDollars(alert);
    const pauseCents = parseDollars(pause);
    const missingAmounts = /^\d+$/.test(missing.trim()) ? Number(missing) : undefined;
    const oddAmount = /^\d+$/.test(odd.trim()) ? Number(odd) : undefined;
    if (alertCents === undefined || pauseCents === undefined) {
      setError("Amounts are in dollars, like 50 or 12.50.");
      return;
    }
    if (missingAmounts === undefined || oddAmount === undefined) {
      setError("The second-look numbers are whole numbers (0 turns a check off).");
      return;
    }
    setError(null);
    setBusy(true);
    const result = await adminRequest<AdminAiSettings>("/api/admin/ai/settings", {
      method: "PUT",
      body: { alertCents, pauseCents, models, secondLook, missingAmounts, oddAmount },
    });
    setBusy(false);
    if (result.ok) {
      onSaved(result.body as AdminAiSettings);
      setMessage("Saved.");
    } else {
      setError(
        (result.body as { field?: string } | null)?.field === "models" ||
          errorOf(result) === "invalid_value"
          ? "Check the models: names this server knows, cheapest first, separated by commas."
          : "That didn't save. Try again.",
      );
    }
  };

  return (
    <section className={styles.card} aria-labelledby="ai-settings-title">
      <h2 id="ai-settings-title">AI settings</h2>
      <p className={styles.muted}>
        For all of Fennl. Each household&rsquo;s own limits (AI imports a month, and the hidden cost
        backstop) are with the plan limits. Changes ask for your passkey again.
      </p>
      {message ? (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      ) : null}
      <form className={styles.stack} onSubmit={save}>
        <div className={styles.field}>
          <label htmlFor={`${id}-alert`}>Email me when the month&rsquo;s cost reaches ($)</label>
          <input
            id={`${id}-alert`}
            inputMode="decimal"
            value={alert}
            onChange={(e) => setAlert(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-pause`}>Pause AI imports for everyone at ($)</label>
          <input
            id={`${id}-pause`}
            inputMode="decimal"
            value={pause}
            onChange={(e) => setPause(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-models`}>Models, cheapest first</label>
          <input
            id={`${id}-models`}
            value={models}
            onChange={(e) => setModels(e.target.value)}
            aria-describedby={`${id}-models-hint`}
          />
          <p id={`${id}-models-hint`} className={styles.hint}>
            Every import is read by the first. &ldquo;Read again&rdquo; uses the next one after the
            model whose answer the person sees (the second, unless a second look happened).
          </p>
        </div>
        <label className={styles.choice}>
          <input
            type="checkbox"
            checked={secondLook}
            onChange={(e) => setSecondLook(e.target.checked)}
            aria-describedby={`${id}-second-hint`}
          />
          Automatic second look
        </label>
        <p id={`${id}-second-hint`} className={styles.hint}>
          When on, a read whose amounts look doubtful is read again by the next model at once, not
          counted as another import: an amount the first model only guessed, or amounts in the
          method that don&rsquo;t add up to the ingredient list (on photos, screenshots and PDFs). A
          word it couldn&rsquo;t read is only highlighted for the person. On unless turned off.
        </p>
        <div className={styles.field}>
          <label htmlFor={`${id}-missing`}>
            Second look when this many ingredients have no amount
          </label>
          <input
            id={`${id}-missing`}
            inputMode="numeric"
            value={missing}
            onChange={(e) => setMissing(e.target.value)}
            aria-describedby={`${id}-off-hint`}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-odd`}>
            Second look when cups, tablespoons and the like go above
          </label>
          <input
            id={`${id}-odd`}
            inputMode="numeric"
            value={odd}
            onChange={(e) => setOdd(e.target.value)}
            aria-describedby={`${id}-off-hint`}
          />
          <p id={`${id}-off-hint`} className={styles.hint}>
            0 turns the check off. A read with a doubtful amount, or missing a title, ingredients or
            method, always gets a second look.
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
        </div>
      </form>
    </section>
  );
}
