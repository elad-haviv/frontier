/** The provider's model list, for the settings page. Kept for an hour. */
import type { Config } from "../config.js";
import { ApiError } from "../errors.js";

export interface ModelInfo {
  id: string;
  name: string;
  /** US dollars per million tokens. */
  promptPrice: number;
  completionPrice: number;
}

const HOUR = 60 * 60 * 1000;

export class ModelCatalogue {
  private cached: { at: number; models: ModelInfo[] } | null = null;

  constructor(
    private readonly config: Pick<Config, "openrouterUrl">,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Models that can answer in a fixed form, which every task of Frontier asks for. */
  async list(): Promise<ModelInfo[]> {
    if (this.cached && this.now() - this.cached.at < HOUR) return this.cached.models;
    let body: unknown;
    try {
      const res = await this.fetcher(`${this.config.openrouterUrl}/models`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(String(res.status));
      body = await res.json();
    } catch {
      throw new ApiError("ai_failed", "The model list could not be fetched from the AI provider.");
    }
    const data = (body as { data?: unknown }).data;
    const models: ModelInfo[] = [];
    for (const raw of Array.isArray(data) ? data : []) {
      const m = raw as {
        id?: unknown;
        name?: unknown;
        pricing?: { prompt?: unknown; completion?: unknown };
        supported_parameters?: unknown;
      };
      if (typeof m.id !== "string") continue;
      const supported = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
      if (!supported.includes("structured_outputs")) continue;
      const perMillion = (v: unknown) => Math.round(Number(v) * 1e6 * 1e4) / 1e4 || 0;
      models.push({
        id: m.id,
        name: typeof m.name === "string" ? m.name : m.id,
        promptPrice: perMillion(m.pricing?.prompt),
        completionPrice: perMillion(m.pricing?.completion),
      });
    }
    models.sort((a, b) => a.name.localeCompare(b.name));
    this.cached = { at: this.now(), models };
    return models;
  }

  async find(id: string): Promise<ModelInfo | undefined> {
    return (await this.list().catch(() => [])).find((m) => m.id === id);
  }
}
