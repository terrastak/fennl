import type { AiAnswer, AiRecipe } from "../../shared/aiAnswer";
import { anthropicCost, knownAnthropicModel } from "./anthropic";
import { PDF_FIND_SCHEMA, type PdfRecipe } from "../../shared/pdfImport";
import type { AiProvider, AiRequest, AiResult, AiTokens } from "./provider";

// A stand-in AI for tests and local development (AI_PROVIDER=fake; phase E7): no vendor, no key,
// no cost. It answers with a plain recipe unless a test says otherwise, and records every
// request, so tests can check the metering, the limits and the second look without spending
// anything. Prices are Anthropic's, so the cost estimates look like real ones.

export const FAKE_TOKENS: AiTokens = { input: 6000, output: 2000, cacheRead: 0, cacheWrite: 0 };

/** A recipe the fake reads, sure of everything unless told otherwise. */
export function fakeRecipe(overrides: Partial<AiRecipe> = {}): AiRecipe {
  const sure = { confidence: "high" as const };
  return {
    title: { text: "Sugar Butter Balls", ...sure },
    description: { text: "", ...sure },
    ingredients: [
      { text: "1 cup butter", heading: false, ...sure },
      { text: "1/2 cup powdered sugar", heading: false, ...sure },
      { text: "2 cups flour", heading: false, ...sure },
    ],
    directions: [
      { text: "Cream the butter and sugar, then work in the flour.", heading: false, ...sure },
      { text: "Roll into balls and bake at 350°F for 15 minutes.", heading: false, ...sure },
    ],
    notes: { text: "", ...sure },
    times: {
      prep: { minutes: 15, text: null },
      cook: { minutes: 15, text: null },
      total: { minutes: null, text: null },
      ...sure,
    },
    servings: { count: 48, yield: "4 dozen", ...sure },
    source: { kind: "person", name: "Grandma", author: null, page: null, url: null, ...sure },
    unclear: [],
    ...overrides,
  };
}

export const fakeAnswer = (...recipes: AiRecipe[]): AiAnswer => ({
  recipes: recipes.length ? recipes : [fakeRecipe()],
});

type Reply = (request: AiRequest) => AiResult | Promise<AiResult>;

/** Given to the fake as text (the browser tests do), it answers unsure, however often it's asked. */
export const FAKE_UNSURE = "fake:unsure";

/**
 * Finding a PDF's recipes (phase E12): each page given as text whose first line is a title starts
 * a recipe of that name; the pages after it (to the next) are its own.
 */
function fakeFind(request: AiRequest): AiResult {
  const recipes: PdfRecipe[] = [];
  for (const part of request.parts) {
    const page = Number(/^Page (\d+)/.exec(part.label)?.[1]);
    if (!page) continue;
    const title = part.kind === "text" ? part.text.trim().split("\n")[0]?.trim() : "";
    const last = recipes[recipes.length - 1];
    if (title) recipes.push({ title, firstPage: page, lastPage: page });
    else if (last) last.lastPage = page;
  }
  return { ok: true, output: { recipes }, tokens: FAKE_TOKENS };
}

const defaultReply: Reply = (request) => {
  if (request.schema === (PDF_FIND_SCHEMA as unknown)) return fakeFind(request);
  // One recipe of a PDF (phase E12): it reads the one asked for, by its title.
  const focus = /only the recipe titled "([^"]+)"/.exec(request.instruction)?.[1];
  if (focus) {
    return {
      ok: true,
      output: fakeAnswer(fakeRecipe({ title: { text: focus, confidence: "high" } })),
      tokens: FAKE_TOKENS,
    };
  }
  const unsure = request.parts.some((p) => p.kind === "text" && p.text.includes(FAKE_UNSURE));
  const recipe = unsure
    ? fakeRecipe({
        ingredients: [
          { text: "1 cup butter", heading: false, confidence: "high" },
          // Fairly sure ("medium"), so the browser tests reach "Read again" without the automatic
          // second look, which only a guessed ("low") amount sets off.
          { text: "2 1/4 cup flour", heading: false, confidence: "medium", unsure: ["2 1/4"] },
        ],
        unclear: ["The amount of flour is smudged"],
      })
    : fakeRecipe();
  return { ok: true, output: fakeAnswer(recipe), tokens: FAKE_TOKENS };
};

/** What the fake does, for tests to change, and what it was asked. */
export const fakeAi = {
  reply: defaultReply,
  requests: [] as AiRequest[],
  /** Back to answering with the plain recipe, forgetting earlier requests. */
  reset() {
    this.reply = defaultReply;
    this.requests = [];
  },
  /** Answer each model with its own reply (models not listed get the plain recipe). */
  byModel(replies: Record<string, AiResult>) {
    this.reply = (request) => replies[request.model] ?? defaultReply(request);
  },
};

export class FakeProvider implements AiProvider {
  readonly name = "fake";

  /** The models Anthropic's adapter knows, so settings are checked as they would be for real. */
  knows(model: string): boolean {
    return knownAnthropicModel(model);
  }

  costMicroUsd(model: string, tokens: AiTokens): number {
    return anthropicCost(model, tokens);
  }

  async read(request: AiRequest): Promise<AiResult> {
    fakeAi.requests.push(request);
    return fakeAi.reply(request);
  }
}
