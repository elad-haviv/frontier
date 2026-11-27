/**
 * What every provider adapter does. An adapter knows one provider's wire format and nothing of
 * Frontier: the log, the settings and the checks on answers stay in `AiProvider`.
 */
import type { AiProviderKind, ModelAbilities } from "@frontier/schema";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** A tool the model may call, with a JSON Schema for its arguments. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** The arguments as the model wrote them: JSON text, not yet checked. */
  arguments: string;
}

/**
 * How much the model thinks before it answers, where the model can. "off" asks for no thinking
 * where that can be switched off; a number is a budget of thinking tokens.
 */
export type Reasoning = "off" | "low" | "medium" | "high" | { budgetTokens: number };

export interface ChatRequest {
  /** The provider's own name for the model, without the provider prefix. */
  model: string;
  system: string;
  messages: ChatMessage[];
  /** Asks for an answer in this JSON form. The text of the answer is then that JSON. */
  schema?: { name: string; json: Record<string, unknown> };
  tools?: ToolSpec[];
  maxTokens?: number;
  reasoning?: Reasoning;
  /** Asks for the model's thinking to be sent back, where it can be (a streamed answer shows it). */
  showReasoning?: boolean;
  /** Ends the request: a timeout, the author leaving, or both. */
  signal: AbortSignal;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  /** In US dollars, when the provider says what the call cost; null when it does not. */
  costUsd: number | null;
}

export interface ChatResult {
  /** The answer's text; with a schema, the JSON of the answer. */
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: string | null;
}

/**
 * Whether a finish reason says the answer stopped at the token limit: "length" (OpenAI's format),
 * "max_tokens" (Anthropic), "MAX_TOKENS" (Gemini).
 */
export const isCutOff = (finishReason: string | null): boolean =>
  finishReason === "length" || finishReason === "max_tokens" || finishReason === "MAX_TOKENS";

/** What a streamed answer yields, in order. `done` comes once, last. */
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "done"; usage: Usage; finishReason: string | null };

export interface ImageRequest {
  model: string;
  prompt: string;
  /** The shape asked for, as a ratio of width to height; a model that takes no size ignores it. */
  aspect?: "1:1" | "3:2" | "2:3";
  signal: AbortSignal;
}

export interface ImageResult {
  bytes: Buffer;
  mime: string;
  usage: Usage;
}

/** A model as a provider lists it, before Frontier adds prices and suitability. */
export interface ListedModel {
  /** The provider's own name for it. */
  model: string;
  name: string;
  description: string | null;
  contextLength: number | null;
  maxOutput: number | null;
  /** US dollars per million tokens, when the list gives them. */
  promptPrice: number | null;
  completionPrice: number | null;
  abilities: ModelAbilities;
  /** Whether it can write text at all; image-only models cannot do the text tasks. */
  textOut: boolean | null;
}

export interface ProviderAdapter {
  readonly kind: AiProviderKind;
  complete(req: ChatRequest): Promise<ChatResult>;
  /** Present where the provider streams. */
  stream?(req: ChatRequest): AsyncIterable<StreamEvent>;
  /** Present where the provider makes pictures. */
  image?(req: ImageRequest): Promise<ImageResult>;
  listModels(signal: AbortSignal): Promise<ListedModel[]>;
  /** Resolves when the key works; throws a ProviderError saying why when it does not. */
  testKey(signal: AbortSignal): Promise<void>;
}

/** What an adapter is made from: one connection's address and key. */
export interface Connection {
  kind: AiProviderKind;
  /** No trailing slash. */
  baseUrl: string;
  key: string | null;
  fetch: typeof fetch;
}

/**
 * A call that failed, with words fit to show the author. `retry` is true when sending it again
 * may work (the provider's own trouble, the network, a timeout).
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
    readonly opts: { status?: number; timedOut?: boolean; aborted?: boolean; usage?: Usage } = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }
  get timedOut(): boolean {
    return this.opts.timedOut === true;
  }
  get aborted(): boolean {
    return this.opts.aborted === true;
  }
}
