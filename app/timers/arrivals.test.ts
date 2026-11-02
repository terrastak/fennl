import { beforeEach, describe, expect, it, vi } from "vitest";
import { arrived, checkArrivals, dismissMissed, expectArrival, expectNothing } from "./arrivals";

// Whether timer notifications reach this device (owner's choice 2026-10-29): nothing is said while
// they do; one that hasn't come long after its timer ended is noted once.

const stored = new Map<string, string>();
const noted = new Set<string>();

beforeEach(() => {
  stored.clear();
  noted.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  // What the service worker notes as each notification arrives.
  vi.stubGlobal("caches", {
    open: async () => ({ delete: async (key: string) => noted.delete(key) }),
  });
});

const missed = () => JSON.parse(stored.get("fennl:timer-missed") ?? "null") as unknown;
const start = Date.UTC(2026, 10, 2, 18);

describe("a timer's notification", () => {
  it("that arrived is ticked off, and nothing is said", async () => {
    expectArrival({ id: "t1", label: "Bake", endsAt: start });
    noted.add("/__arrived/t1");
    await checkArrivals(start + 60_000);
    expect(stored.has("fennl:timer-pending")).toBe(false);
    expect(missed()).toBeNull();
  });

  it("that hasn't come yet is waited for, past the 10 minutes it may take", async () => {
    expectArrival({ id: "t1", label: "Bake", endsAt: start });
    await checkArrivals(start + 10 * 60_000);
    expect(missed()).toBeNull();
    noted.add("/__arrived/t1");
    await checkArrivals(start + 10.5 * 60_000);
    expect(missed()).toBeNull();
    expect(stored.has("fennl:timer-pending")).toBe(false);
  });

  it("that never came is noted once, until dismissed", async () => {
    expectArrival({ id: "t1", label: "Bake", endsAt: start });
    await checkArrivals(start + 12 * 60_000);
    expect(missed()).toEqual({ label: "Bake", at: start });
    expect(stored.has("fennl:timer-pending")).toBe(false);
    dismissMissed();
    expect(missed()).toBeNull();
  });

  it("isn't expected once notifications are turned off", async () => {
    expectArrival({ id: "t1", label: "Bake", endsAt: start });
    expectNothing();
    await checkArrivals(start + 12 * 60_000);
    expect(missed()).toBeNull();
  });

  it("is forgotten once seen, so a second look doesn't count it again", async () => {
    noted.add("/__arrived/fennl-test");
    expect(await arrived("fennl-test")).toBe(true);
    expect(await arrived("fennl-test")).toBe(false);
  });
});
