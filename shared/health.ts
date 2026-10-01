/** Shape of the `/api/health` response, shared by the Worker and the app. */
export interface HealthStatus {
  status: "ok";
  service: "fennl";
}

export function healthStatus(): HealthStatus {
  return { status: "ok", service: "fennl" };
}

export function isHealthStatus(value: unknown): value is HealthStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).status === "ok" &&
    (value as Record<string, unknown>).service === "fennl"
  );
}
