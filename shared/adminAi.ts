/**
 * The admin console's AI imports section (phase E7): what the AI has cost this month, and the
 * settings that limit it (decided 2026-10-12). Money is in millionths of a US dollar unless the
 * name says cents.
 */

export interface AdminAiSettings {
  /** Email the owner when this month's estimated AI cost reaches this. */
  alertCents: number;
  /** Pause AI imports for everyone at this. */
  pauseCents: number;
  /** The models to read with, cheapest first. */
  models: string[];
  /** A second look when this many ingredient lines have no amount (0: off). */
  missingAmounts: number;
  /** A second look when cups, tablespoons and the like go above this (0: off). */
  oddAmount: number;
}

export interface AdminAiOverview {
  /** The provider this server reads with, or null when none is set up (no key). */
  provider: string | null;
  /** "2026-10" (UTC). */
  month: string;
  spentMicroUsd: number;
  /** Over the pause amount: AI imports are refused for everyone this month. */
  paused: boolean;
  /** New imports read this month, and how many of them got a second look. */
  reads: number;
  secondLooks: number;
  rereads: number;
  settings: AdminAiSettings;
  byModel: { model: string; calls: number; costMicroUsd: number }[];
  /** The households that cost most this month, most first. */
  households: { householdId: string; name: string; imports: number; costMicroUsd: number }[];
}
