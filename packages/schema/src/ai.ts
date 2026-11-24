/**
 * The AI providers Frontier can call, and the shapes the server and the settings page share about
 * them. Keys never travel in any of these shapes towards the browser: only a masked hint does.
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
  "custom",
]);
export type AiProviderKind = z.infer<typeof AiProviderKind>;

export interface AiProviderKindInfo {
  label: string;
  /** One sentence on what it is and where its keys are made. */
  blurb: string;
  /** Only an OpenAI-compatible endpoint needs its address given. */
  needsBaseUrl: boolean;
  /** A local endpoint may answer without a key. */
  keyRequired: boolean;
  /** What a key usually starts with; shown as the placeholder and checked as a warning only. */
  keyPrefix: string;
  /** Where to set a hard spending limit with the provider. */
  billingUrl: string | null;
  /** Whether the provider says what each call cost. Without it the cost is estimated. */
  reportsCost: boolean;
  /** Whether more than one can be added. */
  many: boolean;
}

/** Every kind, in the order the settings page offers them. */
export const AI_PROVIDER_KINDS: Record<AiProviderKind, AiProviderKindInfo> = {
  openrouter: {
    label: "OpenRouter",
    blurb:
      "One key, hundreds of models from every maker. The easiest start. Keys at openrouter.ai/keys.",
    needsBaseUrl: false,
    keyRequired: true,
    keyPrefix: "sk-or-",
    billingUrl: "https://openrouter.ai/settings/keys",
    reportsCost: true,
    many: false,
  },
  anthropic: {
    label: "Anthropic",
    blurb: "Claude, directly. Keys at console.anthropic.com.",
    needsBaseUrl: false,
    keyRequired: true,
    keyPrefix: "sk-ant-",
    billingUrl: "https://console.anthropic.com/settings/limits",
    reportsCost: false,
    many: false,
  },
  openai: {
    label: "OpenAI",
    blurb: "GPT and image models, directly. Keys at platform.openai.com.",
    needsBaseUrl: false,
    keyRequired: true,
    keyPrefix: "sk-",
    billingUrl: "https://platform.openai.com/settings/organization/limits",
    reportsCost: false,
    many: false,
  },
  google: {
    label: "Google AI Studio",
    blurb: "Gemini, directly. Keys at aistudio.google.com.",
    needsBaseUrl: false,
    keyRequired: true,
    keyPrefix: "AIza",
    billingUrl: "https://aistudio.google.com/usage",
    reportsCost: false,
    many: false,
  },
  xai: {
    label: "xAI",
    blurb: "Grok, directly. Keys at console.x.ai.",
    needsBaseUrl: false,
    keyRequired: true,
    keyPrefix: "xai-",
    billingUrl: "https://console.x.ai",
    reportsCost: false,
    many: false,
  },
  mistral: {
    label: "Mistral",
    blurb: "Mistral's models, directly. Keys at console.mistral.ai.",
    needsBaseUrl: false,
    keyRequired: true,
    keyPrefix: "",
    billingUrl: "https://console.mistral.ai/usage",
    reportsCost: false,
    many: false,
  },
  deepseek: {
    label: "DeepSeek",
    blurb: "DeepSeek's models, directly. Keys at platform.deepseek.com.",
    needsBaseUrl: false,
    keyRequired: true,
    keyPrefix: "sk-",
    billingUrl: "https://platform.deepseek.com/usage",
    reportsCost: false,
    many: false,
  },
  groq: {
    label: "Groq",
    blurb: "Fast open models. Keys at console.groq.com.",
    needsBaseUrl: false,
    keyRequired: true,
    keyPrefix: "gsk_",
    billingUrl: "https://console.groq.com/settings/billing",
    reportsCost: false,
    many: false,
  },
  custom: {
    label: "Other, OpenAI-compatible",
    blurb: "Any server that speaks OpenAI's chat format, such as a local one. Give its address.",
    needsBaseUrl: true,
    keyRequired: false,
    keyPrefix: "",
    billingUrl: null,
    reportsCost: false,
    many: true,
  },
};

/** A provider id: the kind for the built-in ones, `custom`, `custom-2`… for endpoints. */
export const AiProviderId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

const PREFIX = /^([a-z][a-z0-9-]{0,31}):(.+)$/;
const KINDS = new Set<string>(AiProviderKind.options);

/**
 * Splits a model id into its provider and the provider's own name for the model. Ids written
 * before there was more than one provider are OpenRouter's ("anthropic/claude-…"); an OpenRouter
 * name never starts with a provider id and a colon, since its first part always has a slash.
 */
export function splitModelId(id: string): { provider: string; model: string } {
  const m = PREFIX.exec(id.trim());
  if (m && (KINDS.has(m[1]!) || /^custom-\d+$/.test(m[1]!))) {
    return { provider: m[1]!, model: m[2]! };
  }
  return { provider: "openrouter", model: id.trim() };
}

/** The provider-qualified form of a model id: a bare id is OpenRouter's. */
export const qualifyModelId = (id: string): string => {
  const { provider, model } = splitModelId(id);
  return `${provider}:${model}`;
};

/** The last check of a provider's key: a free call listing its models. */
export const ProviderCheck = z.object({
  at: z.string(),
  ok: z.boolean(),
  /** The provider's words when it refused, with anything like a key taken out. */
  message: z.string().nullable(),
});
export type ProviderCheck = z.infer<typeof ProviderCheck>;

/** A provider connection as stored in settings. The key is encrypted with SECRETS_KEY. */
export const AiProviderEntry = z.object({
  id: AiProviderId,
  kind: AiProviderKind,
  /** A name the author gave it; the kind's label when null. */
  name: z.string().max(80).nullable().default(null),
  key: z.object({ iv: z.string(), data: z.string(), tag: z.string() }).nullable().default(null),
  /** Required for `custom`; for the others an override of the usual address. */
  baseUrl: z.string().url().nullable().default(null),
  enabled: z.boolean().default(true),
  addedAt: z.string().nullable().default(null),
  check: ProviderCheck.nullable().default(null),
});
export type AiProviderEntry = z.infer<typeof AiProviderEntry>;

/** Prices the author entered for a model whose price is not known otherwise. */
export const ModelPrice = z.object({
  /** US dollars per million tokens. */
  promptPrice: z.number().min(0).max(10_000),
  completionPrice: z.number().min(0).max(10_000),
});
export type ModelPrice = z.infer<typeof ModelPrice>;

export const AiTaskName = z.enum(["extraction", "conversation", "art"]);
export type AiTaskName = z.infer<typeof AiTaskName>;

/** A provider as the settings page sees it. */
export const AiProviderView = z.object({
  id: z.string(),
  kind: AiProviderKind,
  name: z.string(),
  baseUrl: z.string().nullable(),
  enabled: z.boolean(),
  keySet: z.boolean(),
  /** Where the key in use comes from. */
  keyFrom: z.enum(["settings", "environment", "none"]),
  /** The key masked, as "sk-…a1b2". */
  keyHint: z.string().nullable(),
  /** A stored key that cannot be read, because SECRETS_KEY changed: it must be entered again. */
  keyUnreadable: z.boolean(),
  /** Whether the entry is stored in settings; one known only from the environment is not. */
  stored: z.boolean(),
  check: ProviderCheck.nullable(),
  /** The tasks whose chosen model is this provider's. */
  usedFor: z.array(AiTaskName),
});
export type AiProviderView = z.infer<typeof AiProviderView>;

/** `GET /api/ai/providers` */
export const ProvidersResponse = z.object({
  providers: z.array(AiProviderView),
  /** False when SECRETS_KEY is not set, so no key can be stored. */
  canStoreKey: z.boolean(),
});
export type ProvidersResponse = z.infer<typeof ProvidersResponse>;

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

/** `POST /api/ai/providers`: the key is checked with the provider before anything is stored. */
export const AddProviderRequest = z.object({
  kind: AiProviderKind,
  key: z.string().trim().min(1).max(2000).optional(),
  baseUrl: z.string().trim().url().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  /** Store it even though the provider could not be reached (not when it refused the key). */
  saveAnyway: z.boolean().optional(),
});
export type AddProviderRequest = z.infer<typeof AddProviderRequest>;

/** `PUT /api/ai/providers/:id/key`: checked like an added one. `null` removes the stored key. */
export const ProviderKeyRequest = z.object({
  key: z.string().trim().min(1).max(2000).nullable(),
  saveAnyway: z.boolean().optional(),
});

/** `PATCH /api/ai/providers/:id` */
export const UpdateProviderRequest = z.object({
  baseUrl: z.string().trim().url().nullable().optional(),
  name: z.string().trim().min(1).max(80).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateProviderRequest = z.infer<typeof UpdateProviderRequest>;

/** What a check, an add or a key change answers. */
export const ProviderCheckResponse = z.object({
  ok: z.boolean(),
  /** Whether it was stored. */
  saved: z.boolean(),
  /** The provider refused the key, as opposed to not answering. "Save anyway" is offered only then not. */
  refused: z.boolean(),
  message: z.string(),
  /** How many models the key can use, when the list came back. */
  models: z.number().nullable(),
  provider: AiProviderView.nullable(),
});
export type ProviderCheckResponse = z.infer<typeof ProviderCheckResponse>;

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
  capUsd: z.number(),
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
