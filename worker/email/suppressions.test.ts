import { afterEach, describe, expect, it, vi } from "vitest";
import { removeSuppression } from "./suppressions";

const KEY = "re_manage_secret_never_shown";
const withKey = { RESEND_MANAGE_KEY: KEY } as unknown as Env;

afterEach(() => {
  vi.restoreAllMocks();
});

/** Everything written to the console during a test, as one string. */
function consoleOutput() {
  const calls = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
  ];
  return () => calls.flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n");
}

describe("taking an address off Resend's suppression list", () => {
  it("asks Resend to remove that address, with the manage key", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('{"object":"suppression","deleted":true}', { status: 200 }));
    expect(await removeSuppression(withKey, "sarah+food@example.com")).toBe("removed");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/suppressions/sarah%2Bfood%40example.com");
    expect(init?.method).toBe("DELETE");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it("says when the address wasn't on the list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
    expect(await removeSuppression(withKey, "a@example.com")).toBe("not_blocked");
  });

  it("does nothing without the key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await removeSuppression({} as Env, "a@example.com")).toBe("not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never shows the key when Resend refuses or can't be reached", async () => {
    const output = consoleOutput();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(`{"message":"bad key ${KEY}"}`, { status: 401 }),
    );
    const refused = await removeSuppression(withKey, "a@example.com");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error(`network down for ${KEY}`));
    const unreachable = await removeSuppression(withKey, "a@example.com");
    expect([refused, unreachable]).toEqual(["failed", "failed"]);
    expect(output()).not.toContain(KEY);
    expect(output()).toContain("401");
  });
});
