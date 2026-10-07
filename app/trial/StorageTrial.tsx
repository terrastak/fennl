import { useEffect, useRef, useState } from "react";
import { deviceLabel } from "../../shared/devices";
import type { SearchResult, TrialRequest, TrialResponse } from "./protocol";
import { TrialClient } from "./trialClient";
import styles from "./trial.module.css";

// The storage trial page (phase C2): does SQLite in the browser work well on this device? It
// stores made-up recipes in this browser only, times writing and searching them, and shows the
// results in a form that can be copied and sent back.

/** How many test recipes to write. ?count= changes it (the automated tests use a few hundred). */
function recipeCount(): number {
  const asked = Number(new URLSearchParams(window.location.search).get("count"));
  return Number.isInteger(asked) && asked > 0 && asked <= 50000 ? asked : 10000;
}

function seconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
}

function megabytes(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Opened from the home screen (an installed app) rather than in a browser tab. */
function installed(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

interface Device {
  label: string;
  installed: boolean;
  opfs: boolean;
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

async function readDevice(): Promise<Device> {
  const storage = navigator.storage as StorageManager | undefined;
  const estimate = await storage?.estimate?.().catch(() => null);
  return {
    label: deviceLabel(navigator.userAgent),
    installed: installed(),
    opfs: typeof storage?.getDirectory === "function",
    persisted: (await storage?.persisted?.().catch(() => null)) ?? null,
    usage: estimate?.usage ?? null,
    quota: estimate?.quota ?? null,
  };
}

interface Results {
  sqliteVersion?: string;
  loadMs?: number;
  openMs?: number;
  existing?: number;
  written?: { count: number; ms: number; textBytes: number };
  measured?: { total: number; searches: SearchResult[]; listMs: number; readOneMs: number };
  persistAsked?: boolean;
}

type Status =
  | { kind: "idle" }
  | { kind: "working"; text: string }
  | { kind: "done" }
  | { kind: "busy" }
  | { kind: "failed"; text: string };

/** What opening the test database means for the page. */
function afterOpen(opened: TrialResponse): { status: Status; results: Partial<Results> } {
  if (opened.type === "error") {
    return {
      status: opened.busy ? { kind: "busy" } : { kind: "failed", text: opened.message },
      results: {},
    };
  }
  if (opened.type !== "opened") return { status: { kind: "idle" }, results: {} };
  return {
    status: { kind: "idle" },
    results: {
      sqliteVersion: opened.sqliteVersion,
      loadMs: opened.loadMs,
      openMs: opened.openMs,
      existing: opened.existing,
    },
  };
}

export function StorageTrial() {
  const count = recipeCount();
  const client = useRef<TrialClient | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [results, setResults] = useState<Results>({});
  const [status, setStatus] = useState<Status>({
    kind: "working",
    text: "Opening the test database…",
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const trial = new TrialClient((written, of) =>
      setStatus({
        kind: "working",
        text: `Writing test recipes: ${written.toLocaleString()} of ${of.toLocaleString()}…`,
      }),
    );
    client.current = trial;
    void readDevice().then((d) => {
      if (!cancelled) setDevice(d);
    });
    void trial.ask({ type: "open" }, "opened").then((opened) => {
      if (cancelled) return;
      const next = afterOpen(opened);
      setStatus(next.status);
      setResults((r) => ({ ...r, ...next.results }));
    });
    return () => {
      cancelled = true;
      trial.close();
      client.current = null;
    };
  }, []);

  const ask = (request: TrialRequest, done: TrialResponse["type"]) =>
    client.current?.ask(request, done) ??
    Promise.resolve<TrialResponse>({
      type: "error",
      during: request.type,
      busy: false,
      message: "The test isn't open.",
    });

  const tryAgain = async () => {
    if (!client.current) return;
    setStatus({ kind: "working", text: "Opening the test database…" });
    const next = afterOpen(await client.current.reopen());
    setStatus(next.status);
    setResults((r) => ({ ...r, ...next.results }));
  };

  const run = async () => {
    setCopied(false);
    setStatus({ kind: "working", text: "Writing test recipes…" });
    const written = await ask({ type: "write", count }, "written");
    if (written.type === "error") {
      setStatus({ kind: "failed", text: written.message });
      return;
    }
    if (written.type === "written") {
      setResults((r) => ({
        ...r,
        written: { count: written.count, ms: written.ms, textBytes: written.textBytes },
      }));
    }
    setStatus({ kind: "working", text: "Searching…" });
    const measured = await ask({ type: "measure" }, "measured");
    if (measured.type === "measured") {
      setResults((r) => ({
        ...r,
        measured: {
          total: measured.total,
          searches: measured.searches,
          listMs: measured.listMs,
          readOneMs: measured.readOneMs,
        },
      }));
    }
    setDevice(await readDevice());
    setStatus(
      measured.type === "error" ? { kind: "failed", text: measured.message } : { kind: "done" },
    );
  };

  const searchOnly = async () => {
    setStatus({ kind: "working", text: "Searching…" });
    const measured = await ask({ type: "measure" }, "measured");
    if (measured.type === "measured") {
      setResults((r) => ({
        ...r,
        measured: {
          total: measured.total,
          searches: measured.searches,
          listMs: measured.listMs,
          readOneMs: measured.readOneMs,
        },
      }));
    }
    setStatus({ kind: "done" });
  };

  const keepStorage = async () => {
    const granted = (await navigator.storage?.persist?.().catch(() => false)) ?? false;
    setResults((r) => ({ ...r, persistAsked: granted }));
    setDevice(await readDevice());
  };

  const clear = async () => {
    setStatus({ kind: "working", text: "Deleting the test recipes…" });
    await ask({ type: "clear" }, "cleared");
    setResults((r) => ({
      ...(r.sqliteVersion ? { sqliteVersion: r.sqliteVersion } : {}),
      existing: 0,
    }));
    setDevice(await readDevice());
    setStatus({ kind: "idle" });
  };

  const report = summary(device, results, status);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const working = status.kind === "working";
  return (
    <main className={styles.page}>
      <p className="hand-note">for the Fennl team</p>
      <h1 className={styles.title}>Recipe storage test</h1>
      <p className={styles.lead}>
        This checks how well this device can keep a copy of a recipe box. It writes{" "}
        {count.toLocaleString()} made-up recipes into this browser, times saving and searching them,
        then shows the results to send back. It doesn&rsquo;t touch any Fennl account, and you can
        delete the test recipes at the end.
      </p>

      <section className={styles.card} aria-labelledby="device-title">
        <h2 id="device-title">This device</h2>
        <dl className={styles.details}>
          <div>
            <dt>Browser</dt>
            <dd>
              {device
                ? `${device.label}${device.installed ? ", opened from the home screen" : ""}`
                : "…"}
            </dd>
          </div>
          <div>
            <dt>Storage space</dt>
            <dd>
              {device?.usage != null && device.quota != null
                ? `${megabytes(device.usage)} used of ${megabytes(device.quota)} available`
                : "Not reported"}
            </dd>
          </div>
          <div>
            <dt>Kept until you clear it</dt>
            <dd>
              {device?.persisted == null
                ? "Not reported"
                : device.persisted
                  ? "Yes"
                  : "Not yet (the browser may clear it when space runs low)"}
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.card} aria-labelledby="test-title">
        <h2 id="test-title">The test</h2>
        {results.existing ? (
          <p className={styles.notice} role="status">
            Found {results.existing.toLocaleString()} test recipes saved from an earlier run. They
            survived closing the page.
          </p>
        ) : null}
        <StatusLine status={status} />
        <div className={styles.row}>
          <button
            type="button"
            className={styles.button}
            disabled={working || status.kind === "busy"}
            onClick={() => void run()}
          >
            {results.existing ? "Add another" : "Run the test:"} {count.toLocaleString()} recipes
          </button>
          {results.existing ? (
            <button
              type="button"
              className={styles.secondary}
              disabled={working || status.kind === "busy"}
              onClick={() => void searchOnly()}
            >
              Search the saved ones
            </button>
          ) : null}
          {status.kind === "busy" ? (
            <button type="button" className={styles.secondary} onClick={() => void tryAgain()}>
              Try again
            </button>
          ) : null}
        </div>
      </section>

      {results.written || results.measured ? (
        <section className={styles.card} aria-labelledby="results-title">
          <h2 id="results-title">Results</h2>
          <pre className={styles.report}>{report}</pre>
          <div className={styles.row}>
            <button type="button" className={styles.button} onClick={() => void copy()}>
              Copy results
            </button>
            {copied ? (
              <span role="status" className={styles.hint}>
                Copied. Paste them into your message to Claude.
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className={styles.card} aria-labelledby="more-title">
        <h2 id="more-title">More checks</h2>
        <div className={styles.row}>
          <button type="button" className={styles.secondary} onClick={() => void keepStorage()}>
            Ask to keep this storage
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={working || status.kind === "busy"}
            onClick={() => void clear()}
          >
            Delete the test recipes
          </button>
        </div>
        {results.persistAsked !== undefined ? (
          <p role="status" className={styles.hint}>
            {results.persistAsked
              ? "The browser agreed to keep this storage."
              : "The browser didn't agree to keep this storage (normal for a browser tab; home-screen apps are often kept anyway)."}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "working")
    return (
      <p role="status" className={styles.hint}>
        {status.text}
      </p>
    );
  if (status.kind === "busy")
    return (
      <p role="alert" className={styles.notice}>
        Another tab has the test open. That&rsquo;s expected: only one tab can use this storage at a
        time. Close the other tab, then press Try again.
      </p>
    );
  if (status.kind === "failed")
    return (
      <p role="alert" className={styles.error}>
        Something went wrong: {status.text}
      </p>
    );
  if (status.kind === "done")
    return (
      <p role="status" className={styles.hint}>
        Done.
      </p>
    );
  return null;
}

/** The results as plain text, to copy and send. */
function summary(device: Device | null, r: Results, status: Status): string {
  const lines = [`Fennl storage test, ${new Date().toLocaleString()}`];
  if (device) {
    lines.push(
      `Device: ${device.label}${device.installed ? " (home screen app)" : " (browser tab)"}`,
    );
    if (device.usage != null && device.quota != null) {
      lines.push(`Storage: ${megabytes(device.usage)} used of ${megabytes(device.quota)}`);
    }
    lines.push(
      `Kept until cleared: ${device.persisted == null ? "not reported" : device.persisted ? "yes" : "no"}`,
    );
  }
  if (r.sqliteVersion) {
    lines.push(
      `SQLite ${r.sqliteVersion}: loaded in ${seconds(r.loadMs ?? 0)}, opened in ${seconds(r.openMs ?? 0)}`,
    );
  }
  if (r.existing) lines.push(`Found from an earlier run: ${r.existing.toLocaleString()} recipes`);
  if (r.written) {
    lines.push(
      `Wrote ${r.written.count.toLocaleString()} recipes in ${seconds(r.written.ms)} (${megabytes(r.written.textBytes)} of text in total)`,
    );
  }
  if (r.measured) {
    lines.push(`Recipes in the test box: ${r.measured.total.toLocaleString()}`);
    for (const s of r.measured.searches) {
      lines.push(`Search ${s.query}: ${seconds(s.ms)} (${s.matches.toLocaleString()} matches)`);
    }
    lines.push(`List the first 50 by title: ${seconds(r.measured.listMs)}`);
    lines.push(`Open one recipe: ${seconds(r.measured.readOneMs)}`);
  }
  if (r.persistAsked !== undefined)
    lines.push(`Asked to keep storage: ${r.persistAsked ? "granted" : "not granted"}`);
  if (status.kind === "busy")
    lines.push("Second tab: blocked while another tab had it open (expected)");
  if (status.kind === "failed") lines.push(`Error: ${status.text}`);
  return lines.join("\n");
}
