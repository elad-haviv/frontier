import type { AiProviderKind } from "@frontier/schema";
import { AnthropicAdapter } from "./anthropic.js";
import { GoogleAdapter } from "./google.js";
import { OpenAiCompatibleAdapter } from "./openaiCompatible.js";
import type { Connection, ProviderAdapter } from "./types.js";

export * from "./types.js";

/** Each provider's usual address. An OpenAI-compatible endpoint has none: the author gives it. */
export const DEFAULT_BASE_URL: Record<Exclude<AiProviderKind, "custom">, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  xai: "https://api.x.ai/v1",
  mistral: "https://api.mistral.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
};

export function makeAdapter(c: Connection): ProviderAdapter {
  switch (c.kind) {
    case "anthropic":
      return new AnthropicAdapter(c);
    case "google":
      return new GoogleAdapter(c);
    default:
      return new OpenAiCompatibleAdapter(c.kind, c);
  }
}
