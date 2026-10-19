import { useEffect, useId, useState } from "react";
import type { AdminAiOutcomes } from "../../shared/adminAi";
import type { Comparison, PeriodKind } from "../../shared/aiOutcome";
import { adminRequest } from "./api";
import { dollars } from "./aiMoney";
import styles from "./admin.module.css";

// Admin console › AI imports › how the reads turned out (decided by the owner 2026-10-19;
// shared/aiOutcome.ts). For a month, quarter or year: whether the stronger model's second look
// and "Read again" came closer to what people saved, what they cost, and how each model's answers
// fared, so the extra cost can be judged on real imports as models and Fennl's own instructions
// change over time.

const KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: "month", label: "Month" },
  { kind: "quarter", label: "Quarter" },
  { kind: "year", label: "Year" },
];

const SOURCES: Record<string, string> = {
  website: "Web pages",
  photo: "Photos",
  screenshot: "Screenshots",
  pdf: "PDFs",
};

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "–");

/** "4 better · 2 same · 1 worse (of 7 saved)", or what's there when nothing was saved. */
function comparisonText(c: Comparison): string {
  const judged = c.better + c.same + c.worse;
  if (c.count === 0) return "None";
  if (judged === 0) return `${c.count}, none saved yet`;
  return `${c.better} closer · ${c.same} same · ${c.worse} further (of ${judged} saved)`;
}

export function AiOutcomesSection() {
  const kindId = useId();
  const periodId = useId();
  const [kind, setKind] = useState<PeriodKind>("month");
  const [period, setPeriod] = useState<string | null>(null);
  const [data, setData] = useState<AdminAiOutcomes | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const query = period ? `?period=${encodeURIComponent(period)}` : "";
    void adminRequest<AdminAiOutcomes>(`/api/admin/ai/outcomes${query}`).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setData(result.body as AdminAiOutcomes);
        setFailed(false);
      } else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const choices = data?.periods[kind] ?? [];
  const s = data?.summary;
  return (
    <section className={styles.card} aria-labelledby="ai-outcomes-title">
      <h2 id="ai-outcomes-title">How AI reads turned out</h2>
      <p className={styles.muted}>
        When a person saves a recipe the AI read, each model&rsquo;s answer is compared with what
        they kept. &ldquo;Closer&rdquo; means the stronger model&rsquo;s answer needed fewer
        changes. Only these scores are kept, never the recipes, for two years.
      </p>
      <div className={styles.filters}>
        <label htmlFor={kindId}>Show by</label>
        <select
          id={kindId}
          value={kind}
          onChange={(event) => {
            const next = event.currentTarget.value as PeriodKind;
            setKind(next);
            setPeriod(data?.periods[next][0]?.key ?? null);
          }}
        >
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <label htmlFor={periodId}>Period</label>
        <select
          id={periodId}
          value={data?.period ?? ""}
          onChange={(event) => setPeriod(event.currentTarget.value)}
          disabled={choices.length === 0}
        >
          {choices.length === 0 && data ? <option value={data.period}>{data.label}</option> : null}
          {choices.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {failed ? (
        <p role="alert" className={styles.error}>
          Couldn&rsquo;t load how the reads turned out just now.
        </p>
      ) : !data || !s ? (
        <p role="status">Loading…</p>
      ) : s.drafts === 0 ? (
        <p className={styles.muted}>
          No drafts read by the AI were saved or removed in {data.label}.
        </p>
      ) : (
        <>
          <dl className={styles.details}>
            <div>
              <dt>Drafts in {data.label}</dt>
              <dd>
                {s.drafts}: {s.saved} saved, {s.discarded} discarded, {s.expired} never reviewed
              </dd>
            </div>
          </dl>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption>Is the stronger model worth it?</caption>
              <thead>
                <tr>
                  <th scope="col">Extra read</th>
                  <th scope="col">How often</th>
                  <th scope="col">Against what was saved</th>
                  <th scope="col">Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Automatic second look</th>
                  <td>
                    {s.secondLook.count} of {s.drafts} ({pct(s.secondLook.count, s.drafts)})
                  </td>
                  <td>{comparisonText(s.secondLook)}</td>
                  <td>{dollars(data.cost.secondLook)}</td>
                </tr>
                <tr>
                  <th scope="row">Read again</th>
                  <td>
                    {s.readAgain.count} of {s.drafts} ({pct(s.readAgain.count, s.drafts)})
                  </td>
                  <td>{comparisonText(s.readAgain)}</td>
                  <td>{dollars(data.cost.reread)}</td>
                </tr>
                <tr>
                  <th scope="row">First reads</th>
                  <td>–</td>
                  <td>–</td>
                  <td>{dollars(data.cost.read)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption>By model: the answer people were shown</caption>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Shown</th>
                  <th scope="col">Lines exactly as saved</th>
                  <th scope="col">Saved with no change</th>
                  <th scope="col">Lines fixed, on average</th>
                </tr>
              </thead>
              <tbody>
                {s.byModel.map((m) => (
                  <tr key={m.model}>
                    <th scope="row">{m.model}</th>
                    <td>{m.shown}</td>
                    <td>{pct(m.exactLines, m.savedLines)}</td>
                    <td>
                      {m.untouched} of {m.saved} saved
                    </td>
                    <td>{m.linesFixed === null ? "–" : m.linesFixed.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption>By kind of import</caption>
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">Drafts</th>
                  <th scope="col">Second look</th>
                  <th scope="col">Read again</th>
                </tr>
              </thead>
              <tbody>
                {s.bySource.map((x) => (
                  <tr key={x.source}>
                    <th scope="row">{SOURCES[x.source] ?? x.source}</th>
                    <td>{x.drafts}</td>
                    <td>{comparisonText(x.secondLook)}</td>
                    <td>{comparisonText(x.readAgain)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className={styles.muted}>
            Fennl&rsquo;s instructions to the AI in this period:{" "}
            {s.setups.map((x) => `version ${x.setup} (${x.drafts})`).join(", ")}. A new version
            means Fennl changed how it asks; a new model name means the AI itself changed.
          </p>
        </>
      )}
    </section>
  );
}
