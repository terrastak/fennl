// Moving a push's changes onto the server's clock (phase C3), keeping each device's own order.
//
// A device's clock may be wrong, so each push says when it was sent and every change in it is
// moved by the difference between that and the server's clock. That difference also holds how
// long the push took to arrive, which varies from push to push: a slow push followed by a quick
// one could put a device's later change before its earlier one, and "last change wins" would then
// keep the earlier one. So the server remembers the time it gave each device's latest change, and
// a newer change from that device always lands after it.

/** A device's latest change: when it was made by the device's clock, and the time it was given. */
export interface DeviceClock {
  changedAt: number;
  time: number;
}

export const CLOCK_RULES = {
  /**
   * The most a push is moved later than its own clock difference says, to stay after the device's
   * previous change. Enough for any difference in how long two pushes took; small enough that a
   * device can't send changes far into the future.
   */
  maxLiftMs: 60_000,
} as const;

/**
 * Each change's time on the server's clock, and the device's latest change afterwards (null if
 * this push has nothing newer than what the device sent before).
 *
 * Nothing counts as made later than the push was sent. The whole push moves by one amount, so its
 * changes keep their order among themselves.
 */
export function serverTimes(
  changedAts: number[],
  sentAt: number,
  now: number,
  last: DeviceClock | null,
): { times: number[]; latest: DeviceClock | null } {
  const made = changedAts.map((changedAt) => Math.min(changedAt, sentAt));
  let shift = now - sentAt;
  const newer = last ? made.filter((changedAt) => changedAt > last.changedAt) : made;
  if (last && newer.length > 0) {
    const needed = last.time + 1 - Math.min(...newer);
    shift = Math.max(shift, Math.min(needed, shift + CLOCK_RULES.maxLiftMs));
  }
  const times = made.map((changedAt) => Math.max(1, changedAt + shift));
  if (newer.length === 0) return { times, latest: null };
  const changedAt = Math.max(...newer);
  return { times, latest: { changedAt, time: Math.max(1, changedAt + shift) } };
}
