import { PHOTO_LABELS_SCHEMA } from "../../shared/photoOrder";
import { ARRANGE_INSTRUCTION, ARRANGE_OUTPUT_TOKENS, ARRANGE_SYSTEM } from "./prompt";
import type { AiPart, AiRequest, ImageType } from "./provider";

// The AI request that puts a recipe's photos in order (phase D4; worker/ai/arrange.ts), on its
// own so the photo-order measurement (import-quality/photoOrderCompare.ts) asks exactly the same.

export interface ArrangeInput {
  title: string;
  /** The method's steps, numbered from 1 (headings left out). */
  steps: string[];
  photos: { mediaType: ImageType; bytes: Uint8Array }[];
}

/** The request for the AI: the recipe, then each photo labelled with its number. */
export function arrangeRequest(model: string, input: ArrangeInput): AiRequest {
  const method = input.steps.map((step, i) => `${i + 1}. ${step}`).join("\n");
  const parts: AiPart[] = [
    {
      kind: "text",
      text: `${input.title}\n\nMethod:\n${method || "(none written)"}`,
      label: "The recipe",
    },
    ...input.photos.map((photo, i): AiPart => ({
      kind: "image",
      mediaType: photo.mediaType,
      bytes: photo.bytes,
      label: `Photo ${i + 1}`,
    })),
  ];
  return {
    model,
    system: ARRANGE_SYSTEM,
    parts,
    instruction: ARRANGE_INSTRUCTION,
    schema: PHOTO_LABELS_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
    maxOutputTokens: ARRANGE_OUTPUT_TOKENS,
  };
}
