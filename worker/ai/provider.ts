/**
 * The one way Fennl calls an AI (phase E7; CLAUDE.md, "AI import"): a provider takes images,
 * PDFs or text with instructions, and returns JSON in the shape it was asked for. Which provider
 * and model are configuration (worker/ai/config.ts), never written into import code; prompts
 * and checking the answer sit above this, in worker/ai/read.ts and shared/aiAnswer.ts, so a new
 * vendor is one new adapter file. Nothing else in Fennl talks to an AI vendor.
 */

export type ImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** Something to read, in order: a card's front, then its back. */
export type AiPart =
  | { kind: "image"; mediaType: ImageType; bytes: Uint8Array; label: string }
  | { kind: "pdf"; bytes: Uint8Array; label: string }
  | { kind: "text"; text: string; label: string };

/** How hard the model works on the answer: more thought costs more and takes longer. */
export type Effort = "low" | "medium" | "high";

export interface AiRequest {
  model: string;
  /** What the model is for and how to answer: the same for every request, so it's cached. */
  system: string;
  parts: AiPart[];
  /** What to do with these parts, after them. */
  instruction: string;
  /** The answer's JSON schema. */
  schema: Record<string, unknown>;
  effort: Effort;
  maxOutputTokens: number;
}

export interface AiTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const NO_TOKENS: AiTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Why there's no answer. */
export type AiProblem =
  /** The model declined (its safety checks). */
  | "refused"
  /** It ran out of room before finishing. */
  | "cut_off"
  /** It answered, but not in the asked-for shape. */
  | "bad_output"
  /** The call itself failed (network, the vendor's error, a missing key). */
  | "failed";

export type AiResult =
  | { ok: true; output: unknown; tokens: AiTokens }
  | { ok: false; problem: AiProblem; tokens: AiTokens; detail: string | null };

export interface AiProvider {
  /** Recorded with each call ("anthropic", "fake"). */
  readonly name: string;
  /** Whether this provider knows the model and its prices. */
  knows(model: string): boolean;
  /** What these tokens cost on this model, estimated, in millionths of a US dollar. */
  costMicroUsd(model: string, tokens: AiTokens): number;
  read(request: AiRequest): Promise<AiResult>;
}
