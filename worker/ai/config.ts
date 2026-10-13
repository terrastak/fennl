import type { AdminAiSettings } from "../../shared/adminAi";
import { SECOND_LOOK_DEFAULTS, type SecondLookRules } from "../../shared/aiAnswer";
import type { Database } from "../db/client";
import { readText, type TextSettingKey } from "../settings/settings";
import { AnthropicProvider } from "./anthropic";
import { FakeProvider } from "./fake";
import { DEFAULT_MODELS } from "./models";
import type { AiProvider } from "./provider";

// How Fennl reads with the AI (phase E7): which provider, which models, and the money limits.
// The provider comes from the Worker's configuration (AI_PROVIDER, and the vendor's key as a
// secret); the models and limits are app settings the admin console changes without a deploy.
// Model names appear only in worker/ai/ (CLAUDE.md, "AI import").

export { DEFAULT_MODELS, MAX_OUTPUT_TOKENS, effortFor } from "./models";

/** Fennl-wide monthly money limits, in cents (decided 2026-10-12: $50 alert, $150 pause). */
export const DEFAULT_ALERT_CENTS = 5_000;
export const DEFAULT_PAUSE_CENTS = 15_000;

export interface AiConfig {
  provider: AiProvider;
  models: string[];
  rules: SecondLookRules;
  /** Email the owner when this month's estimated cost reaches this (millionths of a dollar). */
  alertMicroUsd: number;
  /** Pause AI imports for everyone at this. */
  pauseMicroUsd: number;
}

/** The provider this Worker is set up for, or null when it has none (no key). */
export function aiProvider(env: Env): AiProvider | null {
  if (env.AI_PROVIDER === "fake") return new FakeProvider();
  if (!env.ANTHROPIC_API_KEY) return null;
  return new AnthropicProvider(env.ANTHROPIC_API_KEY);
}

/** A list of models as typed in the admin console: names the provider knows, at least one. */
export function parseModels(text: string, knows: (model: string) => boolean): string[] | null {
  const models = text
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (models.length === 0 || models.length > 4) return null;
  if (new Set(models).size !== models.length) return null;
  return models.every((m) => /^[a-z0-9.-]{1,80}$/.test(m) && knows(m)) ? models : null;
}

async function number(db: Database, key: TextSettingKey, fallback: number): Promise<number> {
  const text = await readText(db, key);
  const n = text === null ? NaN : Number(text);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** The admin console's settings for AI reading, with defaults for any not set. */
export async function aiSettings(
  db: Database,
  knows: (model: string) => boolean,
): Promise<AdminAiSettings> {
  const stored = await readText(db, "ai_models");
  return {
    alertCents: await number(db, "ai_alert_cents_per_month", DEFAULT_ALERT_CENTS),
    pauseCents: await number(db, "ai_pause_cents_per_month", DEFAULT_PAUSE_CENTS),
    models: (stored && parseModels(stored, knows)) || DEFAULT_MODELS,
    missingAmounts: await number(
      db,
      "ai_second_look_missing_amounts",
      SECOND_LOOK_DEFAULTS.missingAmounts,
    ),
    oddAmount: await number(db, "ai_second_look_odd_amount", SECOND_LOOK_DEFAULTS.oddAmount),
  };
}

/** Everything a read needs to know, or null when AI reading isn't set up on this Worker. */
export async function aiConfig(env: Env, db: Database): Promise<AiConfig | null> {
  const provider = aiProvider(env);
  if (!provider) return null;
  const settings = await aiSettings(db, (m) => provider.knows(m));
  return {
    provider,
    models: settings.models,
    rules: { missingAmounts: settings.missingAmounts, oddAmount: settings.oddAmount },
    alertMicroUsd: settings.alertCents * 10_000,
    pauseMicroUsd: settings.pauseCents * 10_000,
  };
}
