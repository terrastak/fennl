import { useEffect, useState } from "react";
import { isHealthStatus } from "../shared/health";

type ServerState = "checking" | "ok" | "unreachable";

const serverLabels: Record<ServerState, string> = {
  checking: "checking…",
  ok: "ok",
  unreachable: "unreachable",
};

// Placeholder screen, styled with the A4 design tokens. The real app shell arrives in A5.
export function App() {
  const [server, setServer] = useState<ServerState>("checking");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => setServer(isHealthStatus(body) ? "ok" : "unreachable"))
      .catch(() => {
        if (!controller.signal.aborted) setServer("unreachable");
      });
    return () => controller.abort();
  }, []);

  return (
    <main style={{ padding: "var(--space-12) var(--space-10)" }}>
      <p className="hand-note">Welcome home</p>
      <h1 style={{ fontSize: "var(--text-4xl)" }}>Hello, Fennl</h1>
      <p style={{ color: "var(--color-text-muted)" }}>
        Server status: <output>{serverLabels[server]}</output>
      </p>
    </main>
  );
}
