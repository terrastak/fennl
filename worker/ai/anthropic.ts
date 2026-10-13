import Anthropic from "@anthropic-ai/sdk";
import {
  NO_TOKENS,
  type AiProvider,
  type AiRequest,
  type AiResult,
  type AiTokens,
} from "./provider";

// The Anthropic adapter (phase E7): Claude models through Anthropic's API, with the key from the
// Worker secret ANTHROPIC_API_KEY. Prices are Anthropic's own, in US dollars per million tokens
// (platform.claude.com/docs/en/about-claude/pricing, checked 2026-10-12), so the metering in
// ai_usage can estimate each call's cost; a model not listed here can't be configured.

interface Prices {
  input: number;
  output: number;
  cacheRead: number;
  /** Five-minute cache writes. */
  cacheWrite: number;
}

interface ModelPrices extends Prices {
  /** Haiku 5.5 charges more for a prompt over this many tokens. */
  longPromptOver?: number;
  long?: Prices;
}

const PRICES: Record<string, ModelPrices> = {
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    longPromptOver: 100_000,
    long: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
  },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** Whether Anthropic's adapter knows a model (and its prices). */
export const knownAnthropicModel = (model: string) => model in PRICES;

/** Dollars per million tokens is millionths of a dollar per token. */
export function anthropicCost(model: string, tokens: AiTokens): number {
  const prices = PRICES[model];
  if (!prices) return 0;
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  const p =
    prices.long && prices.longPromptOver && prompt > prices.longPromptOver ? prices.long : prices;
  return Math.ceil(
    tokens.input * p.input +
      tokens.output * p.output +
      tokens.cacheRead * p.cacheRead +
      tokens.cacheWrite * p.cacheWrite,
  );
}

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    // A read takes seconds; two retries cover the vendor's brief overloads.
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  knows(model: string): boolean {
    return model in PRICES;
  }

  costMicroUsd(model: string, tokens: AiTokens): number {
    return anthropicCost(model, tokens);
  }

  async read(request: AiRequest): Promise<AiResult> {
    const content: Anthropic.ContentBlockParam[] = [];
    for (const part of request.parts) {
      content.push({ type: "text", text: `${part.label}:` });
      if (part.kind === "image") {
        content.push({
          type: "image",
          source: { type: "base64", media_type: part.mediaType, data: toBase64(part.bytes) },
        });
      } else if (part.kind === "pdf") {
        content.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: toBase64(part.bytes) },
        });
      } else {
        content.push({ type: "text", text: part.text });
      }
    }
    content.push({ type: "text", text: request.instruction });

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: request.model,
        max_tokens: request.maxOutputTokens,
        // The instructions are the same for every read, so they're cached.
        system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
        output_config: {
          effort: request.effort,
          format: { type: "json_schema", schema: request.schema },
        },
        messages: [{ role: "user", content }],
      });
    } catch (error) {
      const detail =
        error instanceof Anthropic.APIError
          ? `${error.status ?? "no status"}: ${error.message}`
          : String(error);
      return { ok: false, problem: "failed", tokens: NO_TOKENS, detail: detail.slice(0, 500) };
    }

    const tokens: AiTokens = {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
    };
    if (message.stop_reason === "refusal") {
      return {
        ok: false,
        problem: "refused",
        tokens,
        detail: message.stop_details?.category ?? null,
      };
    }
    if (message.stop_reason === "max_tokens") {
      return { ok: false, problem: "cut_off", tokens, detail: null };
    }
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    try {
      return { ok: true, output: JSON.parse(text) as unknown, tokens };
    } catch {
      return { ok: false, problem: "bad_output", tokens, detail: text.slice(0, 200) };
    }
  }
}
