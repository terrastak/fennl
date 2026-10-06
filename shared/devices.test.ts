import { describe, expect, it } from "vitest";
import { deviceLabel, isDeviceId } from "./devices";

describe("device names", () => {
  it("names common browsers and systems", () => {
    expect(
      deviceLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iPhone");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome on Mac");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      ),
    ).toBe("Edge on Windows");
    expect(
      deviceLabel("Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0"),
    ).toBe("Firefox on Android");
    expect(
      deviceLabel(
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Chrome on iPad");
  });

  it("falls back gracefully", () => {
    expect(deviceLabel(null)).toBe("A browser");
    expect(deviceLabel("curl/8.0")).toBe("A browser");
  });

  it("accepts only plausible device IDs", () => {
    expect(isDeviceId(crypto.randomUUID())).toBe(true);
    expect(isDeviceId("short")).toBe(false);
    expect(isDeviceId("has spaces in it, which is wrong")).toBe(false);
    expect(isDeviceId(42)).toBe(false);
  });
});
