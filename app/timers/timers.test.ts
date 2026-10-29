import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMinute,
  listTimers,
  pauseTimer,
  resumeTimer,
  setTimeLeft,
  startTimer,
  stopTimer,
  timeLeft,
} from "./timers";

// Timers (U9): pausing holds the time still, and a timer's time can be changed.

const now = () => Date.now();
const only = () => listTimers()[0]!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T18:00:00Z"));
  for (const t of listTimers()) stopTimer(t.id);
});
afterEach(() => vi.useRealTimers());

describe("a timer", () => {
  it("is a recipe's or the person's own", () => {
    startTimer("Simmer", 45 * 60, "Green Chile Stew");
    startTimer("Pasta", 10 * 60, null);
    expect(listTimers().map((t) => [t.label, t.recipeTitle])).toEqual([
      ["Simmer", "Green Chile Stew"],
      ["Pasta", null],
    ]);
  });

  it("holds still while paused, and carries on from there", () => {
    startTimer("Simmer", 10 * 60, null);
    vi.advanceTimersByTime(2 * 60_000);
    pauseTimer(only().id);
    expect(timeLeft(only(), now())).toBe(8 * 60_000);
    vi.advanceTimersByTime(5 * 60_000);
    expect(timeLeft(only(), now())).toBe(8 * 60_000);
    // A minute more while paused.
    addMinute(only().id);
    expect(timeLeft(only(), now())).toBe(9 * 60_000);
    resumeTimer(only().id);
    vi.advanceTimersByTime(60_000);
    expect(timeLeft(only(), now())).toBe(8 * 60_000);
    expect(only().pausedLeft).toBeNull();
  });

  it("can be set to any time, and starts from it", () => {
    startTimer("Bake", 25 * 60, null);
    pauseTimer(only().id);
    setTimeLeft(only().id, 50 * 60 + 30);
    expect(only().pausedLeft).toBeNull();
    expect(timeLeft(only(), now())).toBe((50 * 60 + 30) * 1000);
    vi.advanceTimersByTime(30_000);
    expect(timeLeft(only(), now())).toBe(50 * 60_000);
  });

  it("starts again when a rung one is set", () => {
    startTimer("Rest", 60, null);
    const rung = { ...only(), done: true };
    expect(timeLeft(rung, now() + 120_000)).toBe(0);
    setTimeLeft(only().id, 120);
    expect(only().done).toBe(false);
  });
});
