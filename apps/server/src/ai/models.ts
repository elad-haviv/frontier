/**
 * The models of every connected provider, for choosing one per task. Each provider's list is kept
 * for ten minutes.
 *
 * Direct providers' lists are thin: OpenAI's gives ids only, Anthropic's names and limits, Google's
 * token limits; none gives prices. OpenRouter's public list (no key needed) gives prices and
 * abilities for the same models under its own names, so each direct model is matched to it by
 * name ("claude-sonnet-5-5" and "anthropic/claude-sonnet-5.5") and takes its prices from there. A
 * model with no match has no price unless the author types one; prices are never made up.
 */
import { createHash } from "node:crypto";
import {
  AI_PROVIDER_KINDS,
  type AiProviderKind,
  type AiTaskName,
  type CatalogModel,
  type ModelsResponse,
  type Suits,
} from "@frontier/schema";
import type { SettingsStore } from "../state/settings.js";
import type { Connections, ResolvedProvider } from "./connections.js";
import type { ListedModel } from "./providers/index.js";
import { recommendedAmong } from "./recommended.js";

const TTL = 10 * 60 * 1000;
/** A list that could not be fetched is tried again after a minute, not on every keystroke. */
const FAILED_TTL = 60 * 1000;
const PUBLIC_TTL = 60 * 60 * 1000;

type Fetched = { ok: true; models: ListedModel[] } | { ok: false; error: string };

export interface ModelFilter {
  q?: string;
  task?: AiTaskName;
  provider?: string;
  refresh?: boolean;
  limit?: number;
}

export type Catalogue = Omit<ModelsResponse, "typical">;

const yesNo = (v: boolean | null): Suits => (v === true ? "yes" : v === false ? "no" : "unknown");

/** OpenRouter's name for each maker, for matching direct models to its list. */
const OPENROUTER_VENDOR: Partial<Record<AiProviderKind, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  xai: "x-ai",
  mistral: "mistralai",
  deepseek: "deepseek",
};

/** A model name reduced so the two lists' spellings meet: no dates, dots as dashes. */
export function matchName(id: string): string {
  return id
    .toLowerCase()
    .replace(/^models\//, "")
    .replace(/^[a-z0-9-]+\//, "")
    .replace(/:.*$/, "")
    .replace(/\./g, "-")
    .replace(/-(\d{8}|\d{4}-\d{2}-\d{2}|\d{4})$/, "")
    .replace(/-latest$/, "");
}

export class ModelCatalogue {
  private cache = new Map<string, { at: number; result: Promise<Fetched> }>();
  private publicList: { at: number; result: Promise<Map<string, ListedModel>> } | null = null;
  private readonly now: () => number;

  constructor(
    private readonly d: {
      connections: Connections;
      settings: SettingsStore;
      /** OpenRouter's address, for its public list. */
      openrouterUrl: string;
      now?: () => number;
    },
  ) {
    this.now = d.now ?? Date.now;
  }

  /** Forgets every kept list, after a key or a provider changed. */
  forget(): void {
    this.cache.clear();
  }

  private keyOf(p: ResolvedProvider): string {
    const key = p.key ? createHash("sha256").update(p.key).digest("hex").slice(0, 16) : "";
    return `${p.id}|${p.kind}|${p.baseUrl}|${key}`;
  }

  private fetchList(p: ResolvedProvider, refresh: boolean): Promise<Fetched> {
    const k = this.keyOf(p);
    const kept = this.cache.get(k);
    const at = this.now();
    if (kept && !refresh) {
      const age = at - kept.at;
      if (age < FAILED_TTL) return kept.result;
      if (age < TTL) return kept.result.then((r) => (r.ok ? r : this.fetchList(p, true)));
    }
    const result: Promise<Fetched> = this.d.connections
      .adapter(p)
      .listModels(AbortSignal.timeout(20_000))
      .then(
        (models): Fetched => ({ ok: true, models }),
        (err: unknown): Fetched => ({
          ok: false,
          error: `Couldn't fetch ${p.name}'s model list.${err instanceof Error ? ` ${err.message}` : ""}`,
        }),
      );
    this.cache.set(k, { at, result });
    return result;
  }

  /** OpenRouter's public list by matched name and vendor, kept for an hour. Empty if unreachable. */
  private openRouterIndex(): Promise<Map<string, ListedModel>> {
    if (this.publicList && this.now() - this.publicList.at < PUBLIC_TTL) {
      return this.publicList.result;
    }
    const result = this.d.connections
      .adapter({
        kind: "openrouter",
        baseUrl: this.d.openrouterUrl,
        key: null,
        storedBaseUrl: null,
      })
      .listModels(AbortSignal.timeout(20_000))
      .then(
        (models) => {
          const index = new Map<string, ListedModel>();
          for (const m of models) {
            const vendor = m.model.split("/")[0]!;
            const k = `${vendor}|${matchName(m.model)}`;
            // The plain model comes before its ":free" or ":thinking" variants.
            if (!index.has(k) || !m.model.includes(":")) index.set(k, m);
          }
          return index;
        },
        () => {
          // Try again in a minute rather than an hour.
          if (this.publicList) this.publicList.at = this.now() - PUBLIC_TTL + FAILED_TTL;
          return new Map<string, ListedModel>();
        },
      );
    this.publicList = { at: this.now(), result };
    return result;
  }

  /** Every model of every usable provider, with the status of each provider's list. */
  async all(refresh = false): Promise<Catalogue> {
    const settings = await this.d.settings.read();
    const prices = settings?.ai.modelPrices ?? {};
    const providers = (await this.d.connections.list()).filter((p) => this.d.connections.usable(p));
    const lists = await Promise.all(providers.map((p) => this.fetchList(p, refresh)));
    const needsIndex = providers.some((p, i) => OPENROUTER_VENDOR[p.kind] && lists[i]!.ok);
    const index = needsIndex ? await this.openRouterIndex() : new Map<string, ListedModel>();
    const models: CatalogModel[] = [];
    const status: Catalogue["providers"] = [];
    providers.forEach((p, i) => {
      const got = lists[i]!;
      status.push({
        id: p.id,
        kind: p.kind,
        name: p.name,
        ok: got.ok,
        error: got.ok ? null : got.error,
        count: got.ok ? got.models.length : 0,
      });
      if (!got.ok) return;
      const reports = AI_PROVIDER_KINDS[p.kind].reportsCost;
      const vendor = OPENROUTER_VENDOR[p.kind];
      for (const m of got.models) {
        const id = `${p.id}:${m.model}`;
        const twin = vendor ? index.get(`${vendor}|${matchName(m.model)}`) : undefined;
        const own = prices[id];
        const listed = m.promptPrice !== null && m.completionPrice !== null;
        const priced = own ?? (listed ? m : twin && twin.promptPrice !== null ? twin : null);
        const priceFrom = own ? "author" : listed ? "provider" : priced ? "openrouter" : null;
        const pick = (a: boolean | null, b: boolean | null | undefined) => a ?? b ?? null;
        const abilities = {
          structuredOutput: pick(m.abilities.structuredOutput, twin?.abilities.structuredOutput),
          imagesIn: pick(m.abilities.imagesIn, twin?.abilities.imagesIn),
          imageOut: pick(m.abilities.imageOut, twin?.abilities.imageOut),
          reasoning: pick(m.abilities.reasoning, twin?.abilities.reasoning),
          tools: pick(m.abilities.tools, twin?.abilities.tools),
        };
        const textOut = pick(m.textOut, twin?.textOut);
        const text: Suits = textOut === false ? "no" : yesNo(abilities.structuredOutput);
        // Anthropic makes no pictures, whatever a list says.
        const art: Suits = p.kind === "anthropic" ? "no" : yesNo(abilities.imageOut);
        models.push({
          id,
          model: m.model,
          name: m.name !== m.model ? m.name : (twin?.name ?? m.name),
          description: m.description ?? twin?.description ?? null,
          provider: p.id,
          providerKind: p.kind,
          providerName: p.name,
          contextLength: m.contextLength ?? twin?.contextLength ?? null,
          maxOutput: m.maxOutput ?? twin?.maxOutput ?? null,
          promptPrice: priced ? priced.promptPrice : null,
          completionPrice: priced ? priced.completionPrice : null,
          imagePrice: null,
          priceFrom,
          // OpenRouter's own list, or one that says what models can do, counts as checked.
          checked:
            twin !== undefined ||
            (m.abilities.structuredOutput !== null && (listed || p.kind !== "custom")),
          costReported: reports,
          abilities,
          suits: { extraction: text, conversation: text, art },
          recommendedFor: [],
        });
      }
    });
    const picks = recommendedAmong(new Set(models.map((m) => m.id)));
    for (const task of ["extraction", "conversation", "art"] as const) {
      const m = models.find((x) => x.id === picks[task]);
      if (m) m.recommendedFor.push(task);
    }
    const order = new Map(providers.map((p, i) => [p.id, i]));
    models.sort(
      (a, b) => order.get(a.provider)! - order.get(b.provider)! || a.name.localeCompare(b.name),
    );
    return { models, providers: status };
  }

  /** The catalogue cut down to what is asked for: words, a task, a provider. */
  async list(filter: ModelFilter = {}): Promise<Catalogue> {
    const { models, providers } = await this.all(filter.refresh ?? false);
    const words = (filter.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const out = models.filter((m) => {
      if (filter.provider && m.provider !== filter.provider) return false;
      if (filter.task && m.suits[filter.task] === "no") return false;
      if (words.length === 0) return true;
      const hay = `${m.id} ${m.name} ${m.providerName}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    return { models: filter.limit ? out.slice(0, filter.limit) : out, providers };
  }

  /** One model by its provider-qualified id; undefined when its list cannot be had. */
  async find(id: string): Promise<CatalogModel | undefined> {
    try {
      return (await this.all()).models.find((m) => m.id === id);
    } catch {
      return undefined;
    }
  }
}
