/** Shape of the `/api/health` response, shared by the Worker and the app. */
export type DatabaseStatus = "ok" | "unavailable";

export interface HealthStatus {
  /** "ok" only when everything the server depends on answers; otherwise "degraded". */
  status: "ok" | "degraded";
  service: "fennl";
  database: DatabaseStatus;
}

export function healthStatus(database: DatabaseStatus): HealthStatus {
  return { status: database === "ok" ? "ok" : "degraded", service: "fennl", database };
}

export function isHealthStatus(value: unknown): value is HealthStatus {
  if (typeof value !== "object" || value === null) return false;
  const { status, service, database } = value as Record<string, unknown>;
  return (
    service === "fennl" &&
    (status === "ok" || status === "degraded") &&
    (database === "ok" || database === "unavailable")
  );
}
