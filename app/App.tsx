import { useEffect, useState } from "react";
import { isHealthStatus } from "../shared/health";

type ServerState = "checking" | "ok" | "unreachable";

const serverLabels: Record<ServerState, string> = {
  checking: "checking…",
  ok: "ok",
  unreachable: "unreachable",
};

// Placeholder screen for phase A2. The real layout and design arrive in A4 and A5.
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
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Hello, Fennl</h1>
      <p>
        Server status: <output>{serverLabels[server]}</output>
      </p>
    </main>
  );
}
