import { describe, expect, it } from "vitest";
import { alertNeeds, cleanTimerAlert, isPushEndpoint, timerPush } from "./timerAlerts";

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

  it("says which timer finished, and where it's from", () => {
    expect(
      timerPush("t1", { label: "Simmer", recipeTitle: "Step 2 · Dal", path: "/recipes/r#step-2" }),
    ).toEqual({
      title: "Timer finished: Simmer",
      body: "Step 2 · Dal",
      tag: "t1",
      path: "/recipes/r#step-2",
    });
    expect(timerPush("t1", { label: "Pasta water", recipeTitle: "", path: "/" }).body).toBe(
      "Your timer",
    );
  });
});

describe("what a browser needs for alerts to arrive", () => {
  const ua = {
    iphone:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    ipadAsMac:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    macChrome:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    windowsEdge:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
    android:
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  };

  it("a phone or tablet gets them with Fennl closed", () => {
    expect(alertNeeds(ua.iphone, true).kind).toBe("phone");
    expect(alertNeeds(ua.android, true).kind).toBe("phone");
    // An iPad's Safari says it's a Mac; its touch screen gives it away.
    expect(alertNeeds(ua.ipadAsMac, true).kind).toBe("phone");
  });

  it("a Mac's Safari gets them even when quit", () => {
    expect(alertNeeds(ua.ipadAsMac, false)).toEqual({
      kind: "mac-safari",
      browser: "Safari",
      system: "mac",
    });
  });

  it("other computer browsers only while they run", () => {
    expect(alertNeeds(ua.macChrome, false)).toEqual({
      kind: "browser-running",
      browser: "Chrome",
      system: "mac",
    });
    expect(alertNeeds(ua.windowsEdge, false)).toEqual({
      kind: "browser-running",
      browser: "Edge",
      system: "windows",
    });
    expect(alertNeeds("", false).browser).toBe("your browser");
  });
});
