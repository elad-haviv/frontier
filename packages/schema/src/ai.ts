/**
 * The AI providers Frontier can call, and the shapes the server and the web app share about them.
 * Keys are kept only in the browser, on each device (stage 27f). They travel to the server in one
 * request header, `AI_KEYS_HEADER`, and never come back in any shape here.
 */
import { z } from "zod";

export const AiProviderKind = z.enum([
  "openrouter",
  "anthropic",
  "openai",
  "google",
  "xai",
  "mistral",
  "deepseek",
  "groq",
]);
export type AiProviderKind = z.infer<typeof AiProviderKind>;

export interface AiProviderKindInfo {
  label: string;
  /** One sentence on what it is and where its keys are made. */
  blurb: string;
  /** What a key usually starts with; shown as the placeholder and checked as a warning only. */
  keyPrefix: string;
  /** Where to set a hard spending limit with the provider. */
  billingUrl: string | null;
  /** Whether the provider says what each call cost. Without it the cost is estimated. */
  reportsCost: boolean;
}

/** Every kind, in the order the settings page offers them. */
export const AI_PROVIDER_KINDS: Record<AiProviderKind, AiProviderKindInfo> = {
  openrouter: {
    label: "OpenRouter",
    blurb:
      "One key, hundreds of models from every maker. The easiest start. Keys at openrouter.ai/keys.",
    keyPrefix: "sk-or-",
    billingUrl: "https://openrouter.ai/settings/keys",
    reportsCost: true,
  },
  anthropic: {
    label: "Anthropic",
    blurb: "Claude, directly. Keys at console.anthropic.com.",
    keyPrefix: "sk-ant-",
    billingUrl: "https://console.anthropic.com/settings/limits",
    reportsCost: false,
  },
  openai: {
    label: "OpenAI",
    blurb: "GPT and image models, directly. Keys at platform.openai.com.",
    keyPrefix: "sk-",
    billingUrl: "https://platform.openai.com/settings/organization/limits",
    reportsCost: false,
  },
  google: {
    label: "Google AI Studio",
    blurb: "Gemini, directly. Keys at aistudio.google.com.",
    keyPrefix: "AIza",
    billingUrl: "https://aistudio.google.com/usage",
    reportsCost: false,
  },
  xai: {
    label: "xAI",
    blurb: "Grok, directly. Keys at console.x.ai.",
    keyPrefix: "xai-",
    billingUrl: "https://console.x.ai",
    reportsCost: false,
  },
  mistral: {
    label: "Mistral",
    blurb: "Mistral's models, directly. Keys at console.mistral.ai.",
    keyPrefix: "",
    billingUrl: "https://console.mistral.ai/usage",
    reportsCost: false,
  },
  deepseek: {
    label: "DeepSeek",
    blurb: "DeepSeek's models, directly. Keys at platform.deepseek.com.",
    keyPrefix: "sk-",
    billingUrl: "https://platform.deepseek.com/usage",
    reportsCost: false,
  },
  groq: {
    label: "Groq",
    blurb: "Fast open models. Keys at console.groq.com.",
    keyPrefix: "gsk_",
    billingUrl: "https://console.groq.com/settings/billing",
    reportsCost: false,
  },
};

/** The header that carries this device's AI keys with a request. */
export const AI_KEYS_HEADER = "frontier-ai-keys";

/** The keys one device holds, by provider kind. */
export type DeviceKeys = Partial<Record<AiProviderKind, string>>;

/** Printable ASCII only: a key is sent in a header, and no real key is anything else. */
const KEY_TEXT = /^[\x21-\x7e]{1,2000}$/;

/** The header's value for a set of keys: base64 of a small JSON map of kind to key. */
export function encodeDeviceKeys(keys: DeviceKeys): string {
  return btoa(JSON.stringify(keys));
}

/**
 * The keys a header value holds. Anything wrong with it (not base64, not JSON, an unknown
 * provider, a value that cannot be a key) is left out rather than failing the request.
 */
export function decodeDeviceKeys(value: string | undefined): DeviceKeys {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(value));
  } catch {
    return {};
  }
  const out: DeviceKeys = {};
  if (typeof parsed !== "object" || parsed === null) return out;
  for (const kind of AiProviderKind.options) {
    const key = (parsed as Record<string, unknown>)[kind];
    if (typeof key === "string" && KEY_TEXT.test(key)) out[kind] = key;
  }
  return out;
}

/** A key shown without giving it away: its usual prefix and its last four characters. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length < 12) return "…" + k.slice(-2);
  const prefix = /^[A-Za-z]{2,4}[-_]/.exec(k)?.[0] ?? "";
  return `${prefix}…${k.slice(-4)}`;
}

const PREFIX = /^([a-z][a-z0-9-]{0,31}):(.+)$/;
const KINDS = new Set<string>(AiProviderKind.options);

/**
 * Splits a model id into its provider and the provider's own name for the model. Ids written
 * before there was more than one provider are OpenRouter's ("anthropic/claude-…"); an OpenRouter
 * name never starts with a provider id and a colon, since its first part always has a slash.
 */
export function splitModelId(id: string): { provider: string; model: string } {
  const m = PREFIX.exec(id.trim());
  if (m && KINDS.has(m[1]!)) return { provider: m[1]!, model: m[2]! };
  return { provider: "openrouter", model: id.trim() };
}

/** The provider-qualified form of a model id: a bare id is OpenRouter's. */
export const qualifyModelId = (id: string): string => {
  const { provider, model } = splitModelId(id);
  return `${provider}:${model}`;
};

/** Prices the author entered for a model whose price is not known otherwise. */
export const ModelPrice = z.object({
  /** US dollars per million tokens. */
  promptPrice: z.number().min(0).max(10_000),
  completionPrice: z.number().min(0).max(10_000),
});
export type ModelPrice = z.infer<typeof ModelPrice>;

export const AiTaskName = z.enum(["extraction", "conversation", "art"]);
export type AiTaskName = z.infer<typeof AiTaskName>;

/** Yes, no, or not known: some providers do not say what a model can do. */
export const Ability = z.boolean().nullable();
export const Suits = z.enum(["yes", "no", "unknown"]);
export type Suits = z.infer<typeof Suits>;

export const ModelAbilities = z.object({
  /** Answers in a JSON form that is asked for. Lore, writing and fields need it. */
  structuredOutput: Ability,
  imagesIn: Ability,
  /** Makes pictures. Concept art needs it. */
  imageOut: Ability,
  reasoning: Ability,
  tools: Ability,
});
export type ModelAbilities = z.infer<typeof ModelAbilities>;

export const CatalogModel = z.object({
  /** Provider-qualified, as stored in settings: "anthropic:claude-…". */
  id: z.string(),
  /** The provider's own name for it. */
  model: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  provider: z.string(),
  providerKind: AiProviderKind,
  providerName: z.string(),
  contextLength: z.number().nullable(),
  maxOutput: z.number().nullable(),
  /** US dollars per million tokens; null when not known. */
  promptPrice: z.number().nullable(),
  completionPrice: z.number().nullable(),
  /** US dollars per picture, for image models whose price is given that way. */
  imagePrice: z.number().nullable(),
  /**
   * Where the prices and abilities come from: the provider's own list, OpenRouter's public list
   * matched by name, or the author.
   */
  priceFrom: z.enum(["provider", "openrouter", "author"]).nullable(),
  /** False when nothing but the name is known (no match in any list). */
  checked: z.boolean(),
  /** Whether each call's cost is told by the provider, rather than estimated from prices. */
  costReported: z.boolean(),
  abilities: ModelAbilities,
  suits: z.object({ extraction: Suits, conversation: Suits, art: Suits }),
  /** The tasks this is Frontier's pick for. */
  recommendedFor: z.array(AiTaskName),
});
export type CatalogModel = z.infer<typeof CatalogModel>;

/** `GET /api/ai/models?q=&task=&provider=&refresh=1` */
export const ModelsQuery = z.object({
  /** Words that must all occur in the id, name or provider, ignoring letter case. */
  q: z.string().max(200).optional(),
  /** Leaves out the models that cannot do this task. */
  task: AiTaskName.optional(),
  provider: z.string().optional(),
  /** Fetches the lists again instead of using the copy kept for a few minutes. */
  refresh: z.enum(["1", "true"]).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

export const ModelsResponse = z.object({
  models: z.array(CatalogModel),
  /** Each connected provider and whether its list could be fetched. */
  providers: z.array(
    z.object({
      id: z.string(),
      kind: AiProviderKind,
      name: z.string(),
      ok: z.boolean(),
      error: z.string().nullable(),
      count: z.number(),
    }),
  ),
  /** Typical tokens per call of each task, from this month's log or a default. */
  typical: z.record(
    AiTaskName,
    z.object({ promptTokens: z.number(), completionTokens: z.number() }),
  ),
});
export type ModelsResponse = z.infer<typeof ModelsResponse>;

/**
 * `POST /api/ai/keys/:kind/check`: a free call with the key in the request, listing the
 * provider's models. Nothing is stored on the server, whatever the answer.
 */
export const KeyCheckResponse = z.object({
  ok: z.boolean(),
  /** The provider refused the key, as opposed to not answering. */
  refused: z.boolean(),
  message: z.string(),
  /** How many models the key can use, when the list came back. */
  models: z.number().nullable(),
});
export type KeyCheckResponse = z.infer<typeof KeyCheckResponse>;

/** `PUT /api/settings/ai/prices`. Null removes the author's price for that model. */
export const ModelPricesRequest = z.object({
  prices: z.record(z.string().min(1), ModelPrice.nullable()),
});

/** `POST /api/settings/ai/test` */
export const AiTestRequest = z.object({
  task: AiTaskName.optional(),
  /** A model to try before it is chosen; the task's own model when not given. */
  model: z.string().min(1).max(300).optional(),
});

/** How a call's cost is known: told by the provider, worked out from prices, or not at all. */
export const CostKind = z.enum(["reported", "estimated", "unknown"]);
export type CostKind = z.infer<typeof CostKind>;

/** `GET /api/ai/log?month=` */
export const AiLogResponse = z.object({
  month: z.string(),
  totalUsd: z.number(),
  byProvider: z.array(
    z.object({
      provider: z.string(),
      name: z.string(),
      calls: z.number(),
      usd: z.number(),
      /** How the costs were known, for the "How we know" column. */
      reported: z.number(),
      estimated: z.number(),
      unknown: z.number(),
    }),
  ),
  calls: z.array(
    z.object({
      at: z.string(),
      task: z.string(),
      model: z.string(),
      provider: z.string(),
      promptTokens: z.number(),
      completionTokens: z.number(),
      costUsd: z.number(),
      costKind: CostKind,
      entry: z.string().nullable(),
      ok: z.boolean(),
      error: z.string().optional(),
    }),
  ),
});
export type AiLogResponse = z.infer<typeof AiLogResponse>;
