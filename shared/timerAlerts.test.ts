import { describe, expect, it } from "vitest";
import { cleanTimerAlert, isPushEndpoint, timerPush } from "./timerAlerts";

// U10: timer alerts with the phone locked.

describe("push addresses", () => {
  it("are only the browsers' own push services", () => {
    expect(isPushEndpoint("https://web.push.apple.com/QGuQ")).toBe(true);
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/a")).toBe(true);
    expect(isPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=a")).toBe(true);
    expect(isPushEndpoint("https://push.apple.com.example/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:8443/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("not an address")).toBe(false);
  });
});

describe("a timer to alert about", () => {
  const now = Date.UTC(2026, 9, 28, 18);
  const timer = {
    deviceId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    endsAt: now + 25 * 60_000,
    label: "Bake\n25 to 30   minutes",
    recipeTitle: "Banana bread",
    path: "/recipes/0f8fad5b-d9cb-469f-a165-70867728950e/cook",
  };

  it("is tidied: one line, cut to a length the alert shows", () => {
    expect(cleanTimerAlert(timer, now)?.label).toBe("Bake 25 to 30 minutes");
    expect(cleanTimerAlert({ ...timer, label: "x".repeat(500) }, now)?.label).toHaveLength(200);
    expect(cleanTimerAlert({ ...timer, recipeTitle: undefined }, now)?.recipeTitle).toBe("");
  });

  it("opens only a page of Fennl's own", () => {
    expect(cleanTimerAlert({ ...timer, path: "https://evil.example/" }, now)).toBeNull();
    expect(cleanTimerAlert({ ...timer, path: "//evil.example/" }, now)).toBeNull();
  });

  it("says what the timer was for, and for which recipe", () => {
    expect(timerPush("t1", { label: "Simmer 10 minutes", recipeTitle: "Dal", path: "/" })).toEqual({
      title: "Timer done",
      body: "Simmer 10 minutes (Dal)",
      tag: "t1",
      path: "/",
    });
    expect(timerPush("t1", { label: "Rest", recipeTitle: "", path: "/" }).body).toBe("Rest");
  });
});
