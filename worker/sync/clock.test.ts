import { describe, expect, it } from "vitest";
import { CLOCK_RULES, serverTimes } from "./clock";

// Phase C3: a push's changes moved onto the server's clock, keeping each device's own order.

const now = 1_800_000_000_000;

describe("serverTimes", () => {
  it("moves changes by the difference between the device's clock and the server's", () => {
    // The device's clock is an hour behind.
    const hour = 3_600_000;
    const sentAt = now - hour;
    const { times, latest } = serverTimes([sentAt - 2_000, sentAt - 1_000], sentAt, now, null);
    expect(times).toEqual([now - 2_000, now - 1_000]);
    expect(latest).toEqual({ changedAt: sentAt - 1_000, time: now - 1_000 });
  });

  it("never counts a change as made after the push was sent", () => {
    const { times } = serverTimes([now + 365 * 86_400_000], now, now, null);
    expect(times).toEqual([now]);
  });

  it("keeps a device's later change after its earlier one when the earlier push was slower", () => {
    // The previous push took 30 seconds to arrive, so its change was put 30 seconds later.
    const previous = { changedAt: now - 60_000, time: now - 30_000 };
    // This one was made a second after it and arrived at once.
    const { times, latest } = serverTimes([now - 59_000, now - 58_000], now, now, previous);
    expect(times[0]).toBe(previous.time + 1);
    // The push moves as one, so its own changes keep their order and spacing.
    expect(times[1]).toBe(previous.time + 1 + 1_000);
    expect(latest).toEqual({ changedAt: now - 58_000, time: previous.time + 1_001 });
  });

  it("moves nothing when the device's previous change is already earlier", () => {
    const previous = { changedAt: now - 60_000, time: now - 60_000 };
    expect(serverTimes([now - 1_000], now, now, previous).times).toEqual([now - 1_000]);
  });

  it("leaves changes sent again alone, and remembers nothing new for them", () => {
    const previous = { changedAt: now - 1_000, time: now - 500 };
    const { times, latest } = serverTimes([now - 1_000], now, now, previous);
    expect(times).toEqual([now - 1_000]);
    expect(latest).toBeNull();
  });

  it("moves a push at most a minute later than its own clock difference says", () => {
    // A device can't use its previous change to send changes far into the future.
    const previous = { changedAt: now - 10, time: now + 3_600_000 };
    const { times } = serverTimes([now - 5], now, now, previous);
    expect(times).toEqual([now - 5 + CLOCK_RULES.maxLiftMs]);
  });
});
