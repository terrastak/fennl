import type { Effort } from "./provider";

// The models Fennl reads with, and how (phase E7). Apart from worker/ai/config.ts, which reads the
// admin console's settings, so the model comparison (import-quality/aiCompare.ts) can use it.

/**
 * The models to read with, cheapest first (decided 2026-10-12): every import is read by the
 * first; a read that looks wrong gets a second look by the next; "Read again" uses the one after
 * the last that read it.
 */
export const DEFAULT_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];

/** The cheapest model works at medium; a second look or a re-read is for hard cases. */
export const effortFor = (level: number): Effort => (level === 0 ? "medium" : "high");

/** Room for a long recipe and the model's thinking. */
export const MAX_OUTPUT_TOKENS = 16_000;
