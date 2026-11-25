import type { FastifyInstance } from "fastify";
import {
  AI_PROVIDER_KINDS,
  AddProviderRequest,
  AiSettingsRequest,
  AiTestRequest,
  ModelPricesRequest,
  ModelsQuery,
  ProviderKeyRequest,
  UpdateProviderRequest,
  qualifyModelId,
  splitModelId,
  type AiLogResponse,
  type AiProviderEntry,
  type AiProviderKind,
  type AiTaskName,
  type ModelsResponse,
  type ProviderCheckResponse,
  type ProvidersResponse,
  type Settings,
  type SettingsResponse,
} from "@frontier/schema";
import { z } from "zod";
import type { ResolvedProvider } from "../ai/connections.js";
import { type AiCall, monthOf } from "../ai/log.js";
import { endpointProblem } from "../ai/providers/guard.js";
import { ProviderError, type ProviderAdapter } from "../ai/providers/index.js";
import { ApiError } from "../errors.js";
import { encrypt } from "../state/secrets.js";
import type { Services } from "../app.js";

const LogQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

const Reply = z.object({ reply: z.string() });
const TASKS: AiTaskName[] = ["extraction", "conversation", "art"];

/** Without a month's worth of calls, the typical sizes of a call of each task. */
const TYPICAL: ModelsResponse["typical"] = {
  extraction: { promptTokens: 3000, completionTokens: 400 },
  conversation: { promptTokens: 14000, completionTokens: 1200 },
  art: { promptTokens: 0, completionTokens: 0 },
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)]!;
};

/** Key checks call a third party, so a few a minute is plenty. */
class CheckLimiter {
  private times: number[] = [];
  take(now = Date.now()): void {
    this.times = this.times.filter((t) => now - t < 60_000);
    if (this.times.length >= 20) {
      throw new ApiError("rate_limited", "Too many key checks. Wait a minute and try again.");
    }
    this.times.push(now);
  }
}

/** A free call with the key: listing the provider's models. */
async function checkWith(
  adapter: ProviderAdapter,
  kind: AiProviderKind,
): Promise<{ ok: boolean; refused: boolean; message: string; models: number | null }> {
  try {
    // OpenRouter lists its models without a key, so its key is checked on its own first.
    if (kind === "openrouter") await adapter.testKey(AbortSignal.timeout(20_000));
    const models = await adapter.listModels(AbortSignal.timeout(20_000));
    return {
      ok: true,
      refused: false,
      message: `The key works: ${models.length} model${models.length === 1 ? "" : "s"} listed.`,
      models: models.length,
    };
  } catch (err) {
    const e = err instanceof ProviderError ? err : new ProviderError("The check failed.", false);
    // Not reached at all (as opposed to refused): saving anyway is offered.
    const unreachable = e.opts.status === undefined && e.retry;
    return { ok: false, refused: !unreachable, message: e.message, models: null };
  }
}

export function settingsRoutes(app: FastifyInstance, s: Services): void {
  const limiter = new CheckLimiter();
  const connections = s.ai.connections;

  /** Tells the status area whether AI is usable, after anything that can change it. */
  async function report(): Promise<void> {
    s.status.ai(await s.ai.ready("extraction"), s.ai.lastError, await s.ai.ready("conversation"));
  }

  function secretsKey(): Buffer {
    const key = s.config.secretsKey;
    if (!key) {
      throw new ApiError(
        "secrets_key_missing",
        "The server has no SECRETS_KEY, so it cannot store a key. Set SECRETS_KEY (32 bytes in " +
          "base64) in the server's environment, or give the provider key there as OPENROUTER_API_KEY.",
      );
    }
    return key;
  }

  async function stored(id: string): Promise<AiProviderEntry | null> {
    return (await s.settings.read())!.ai.providers.find((p) => p.id === id) ?? null;
  }

  /** Changes one stored provider; one known only from the environment is stored first. */
  async function changeProvider(
    id: string,
    change: (p: AiProviderEntry) => AiProviderEntry,
  ): Promise<void> {
    const known = await connections.get(id);
    const kind =
      known?.kind ?? (id in AI_PROVIDER_KINDS && id !== "custom" ? (id as AiProviderKind) : null);
    if (!kind) throw new ApiError("not_found", "There is no such provider.");
    await s.settings.update((now) => {
      const exists = now.ai.providers.some((p) => p.id === id);
      const base: AiProviderEntry = {
        id,
        kind,
        name: null,
        key: null,
        baseUrl: null,
        enabled: true,
        addedAt: new Date().toISOString(),
        check: null,
      };
      return {
        ...now,
        ai: {
          ...now.ai,
          providers: exists
            ? now.ai.providers.map((p) => (p.id === id ? change(p) : p))
            : [...now.ai.providers, change(base)],
        },
      };
    });
    s.models.forget();
  }

  function checkBaseUrl(url: string | undefined | null): void {
    if (!url) return;
    const problem = endpointProblem(url, s.config.imageFetchAllowLoopback);
    if (problem) throw new ApiError("invalid", problem);
  }

  /**
   * D3: a model whose calls are not priced by its provider can be chosen only when its price is
   * known, from a list or typed by the author, so the cap always means something.
   */
  async function checkPriced(settings: Settings, id: string): Promise<void> {
    const { provider } = splitModelId(id);
    const p = await connections.get(provider);
    if (!p || AI_PROVIDER_KINDS[p.kind].reportsCost) return;
    if (settings.ai.modelPrices[id]) return;
    const listed = await s.models.find(id);
    if (listed && listed.promptPrice !== null && listed.completionPrice !== null) return;
    throw new ApiError(
      "invalid",
      `No price is known for ${splitModelId(id).model}, so its cost could not count against the cap. ` +
        "Type its price per million tokens first (0 for a free model).",
    );
  }

  app.get("/api/settings", async (request): Promise<SettingsResponse> => {
    const settings = (await s.settings.read())!;
    const key = await s.ai.key();
    const { spentUsd } = await s.ai.spending();
    const providers = await Promise.all((await connections.list()).map((p) => connections.view(p)));
    return {
      ai: {
        keySet: key !== null,
        keyFrom: key?.from ?? "none",
        keyLast4: key ? key.key.slice(-4) : null,
        providers,
        modelPrices: settings.ai.modelPrices,
        canStoreKey: s.config.secretsKey !== null,
        models: settings.ai.models,
        artStyle: settings.ai.artStyle,
        monthlyCapUsd: settings.ai.monthlyCapUsd,
        proposeOnPublish: settings.ai.proposeOnPublish,
        spentUsd,
      },
      signIn: {
        passkeys: settings.passkeys.map(({ id, name, addedAt }) => ({ id, name, addedAt })),
        passwordOff: settings.passwordOff,
        method: request.session.get("method") ?? "password",
      },
      keepGoing: settings.keepGoing,
    };
  });

  app.put("/api/settings/ai", async (request) => {
    const input = AiSettingsRequest.parse(request.body);
    const now = (await s.settings.read())!;
    for (const task of TASKS) {
      const id = input.models?.[task];
      if (id && qualifyModelId(id) !== now.ai.models[task])
        await checkPriced(now, qualifyModelId(id));
    }
    // The key of the page before stage 18 is OpenRouter's.
    if (input.key !== undefined) {
      const key = input.key === null ? null : encrypt(secretsKey(), input.key.trim());
      if (key === null && !(await stored("openrouter"))) {
        // Nothing stored to remove.
      } else {
        await changeProvider("openrouter", (p) => ({ ...p, key, check: null }));
      }
    }
    await s.settings.update((now) => ({
      ...now,
      ai: {
        ...now.ai,
        ...(input.models
          ? {
              models: {
                extraction:
                  input.models.extraction === undefined
                    ? now.ai.models.extraction
                    : input.models.extraction,
                conversation:
                  input.models.conversation === undefined
                    ? now.ai.models.conversation
                    : input.models.conversation,
                art: input.models.art === undefined ? now.ai.models.art : input.models.art,
              },
            }
          : {}),
        ...(input.monthlyCapUsd === undefined ? {} : { monthlyCapUsd: input.monthlyCapUsd }),
        ...(input.artStyle === undefined ? {} : { artStyle: input.artStyle }),
        ...(input.proposeOnPublish === undefined
          ? {}
          : { proposeOnPublish: input.proposeOnPublish }),
      },
    }));
    await report();
    return { ok: true as const };
  });

  app.put("/api/settings/ai/prices", async (request) => {
    const { prices } = ModelPricesRequest.parse(request.body);
    await s.settings.update((now) => {
      const next = { ...now.ai.modelPrices };
      for (const [id, price] of Object.entries(prices)) {
        const q = qualifyModelId(id);
        if (price === null) delete next[q];
        else next[q] = price;
      }
      return { ...now, ai: { ...now.ai, modelPrices: next } };
    });
    return { ok: true as const };
  });

  /**
   * One small call to a task's model (or a model being tried), to show that the key and the
   * model work. For concept art it makes a picture, which costs a few cents.
   */
  app.post("/api/settings/ai/test", async (request) => {
    const { task = "extraction", model } = AiTestRequest.parse(request.body ?? {});
    const before = (await s.ai.spending()).spentUsd;
    try {
      if (task === "art") {
        if (model) throw new ApiError("invalid", "Choose the art model first, then try it.");
        const { bytes } = await s.ai.image("A small sketch of a lantern on a table.", "test");
        const costUsd = (await s.ai.spending()).spentUsd - before;
        return {
          ok: true,
          costUsd,
          message: "The model made a picture.",
          image: `data:image/png;base64,${bytes.toString("base64")}`,
        };
      }
      const answer = await s.ai.complete({
        task,
        ...(model ? { model } : {}),
        system: 'Answer with the JSON object {"reply": "ok"}.',
        user: "Say ok.",
        maxTokens: 50,
        schema: {
          name: "test",
          check: Reply,
          json: {
            type: "object",
            additionalProperties: false,
            required: ["reply"],
            properties: { reply: { type: "string" } },
          },
        },
      });
      const costUsd = (await s.ai.spending()).spentUsd - before;
      return { ok: true, costUsd, message: `The model answered "${answer.reply}".` };
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      return {
        ok: false,
        costUsd: (await s.ai.spending()).spentUsd - before,
        message: err.message,
      };
    } finally {
      await report();
    }
  });

  app.get("/api/ai/providers", async (): Promise<ProvidersResponse> => ({
    providers: await Promise.all((await connections.list()).map((p) => connections.view(p))),
    canStoreKey: s.config.secretsKey !== null,
  }));

  async function viewOf(id: string) {
    const p = await connections.get(id);
    return p ? connections.view(p) : null;
  }

  /** Adds a provider. Its key is checked with the provider first and stored only if it works. */
  app.post("/api/ai/providers", async (request): Promise<ProviderCheckResponse> => {
    const input = AddProviderRequest.parse(request.body);
    const info = AI_PROVIDER_KINDS[input.kind];
    if (info.needsBaseUrl && !input.baseUrl) {
      throw new ApiError("invalid", "Give the endpoint's address, such as https://example.com/v1.");
    }
    checkBaseUrl(input.baseUrl);
    if (info.keyRequired && !input.key) throw new ApiError("invalid", "Enter the key.");
    const now = (await s.settings.read())!;
    let id: string = input.kind;
    if (info.many) {
      for (let n = 1; now.ai.providers.some((p) => p.id === id); n++) id = `${input.kind}-${n + 1}`;
    } else if (now.ai.providers.some((p) => p.id === id && (p.key || p.kind === "custom"))) {
      throw new ApiError("invalid", `${info.label} is connected already. Replace its key instead.`);
    }
    const key = input.key ? encrypt(secretsKey(), input.key) : null;
    limiter.take();
    const result = await checkWith(
      connections.trial(input.kind, input.key ?? null, input.baseUrl ?? null),
      input.kind,
    );
    const save = result.ok || (input.saveAnyway === true && !result.refused);
    if (save) {
      const entry: AiProviderEntry = {
        id,
        kind: input.kind,
        name: input.name ?? null,
        key,
        baseUrl: input.baseUrl?.replace(/\/+$/, "") ?? null,
        enabled: true,
        addedAt: new Date().toISOString(),
        check: {
          at: new Date().toISOString(),
          ok: result.ok,
          message: result.ok ? null : result.message,
        },
      };
      await s.settings.update((n) => ({
        ...n,
        ai: { ...n.ai, providers: [...n.ai.providers.filter((p) => p.id !== id), entry] },
      }));
      s.models.forget();
      await report();
    }
    return { ...result, saved: save, provider: save ? await viewOf(id) : null };
  });

  /** Checks the key in use again, and keeps what was found. */
  app.post("/api/ai/providers/:id/check", async (request): Promise<ProviderCheckResponse> => {
    const { id } = request.params as { id: string };
    const p = await connections.get(id);
    if (!p) throw new ApiError("not_found", "There is no such provider.");
    if (!p.key && AI_PROVIDER_KINDS[p.kind].keyRequired) {
      throw new ApiError(
        "invalid",
        p.keyUnreadable
          ? "The stored key can't be read. Enter it again."
          : "There is no key to check.",
      );
    }
    limiter.take();
    const result = await checkWith(connections.adapter(p), p.kind);
    if (p.stored) {
      await changeProvider(id, (e) => ({
        ...e,
        check: {
          at: new Date().toISOString(),
          ok: result.ok,
          message: result.ok ? null : result.message,
        },
      }));
    }
    s.models.forget();
    await report();
    return { ...result, saved: p.stored, provider: await viewOf(id) };
  });

  /** Replaces a provider's key, checked first; `null` removes the stored key. */
  app.put("/api/ai/providers/:id/key", async (request): Promise<ProviderCheckResponse> => {
    const { id } = request.params as { id: string };
    const input = ProviderKeyRequest.parse(request.body);
    const p = await connections.get(id);
    if (!p) throw new ApiError("not_found", "There is no such provider.");
    if (input.key === null) {
      await changeProvider(id, (e) => ({ ...e, key: null, check: null }));
      await report();
      return {
        ok: true,
        saved: true,
        refused: false,
        message: "The key was removed.",
        models: null,
        provider: await viewOf(id),
      };
    }
    const key = encrypt(secretsKey(), input.key);
    limiter.take();
    const result = await checkWith(connections.trial(p.kind, input.key, p.storedBaseUrl), p.kind);
    const save = result.ok || (input.saveAnyway === true && !result.refused);
    if (save) {
      await changeProvider(id, (e) => ({
        ...e,
        key,
        check: {
          at: new Date().toISOString(),
          ok: result.ok,
          message: result.ok ? null : result.message,
        },
      }));
      await report();
    }
    return { ...result, saved: save, provider: await viewOf(id) };
  });

  app.patch("/api/ai/providers/:id", async (request) => {
    const { id } = request.params as { id: string };
    const input = UpdateProviderRequest.parse(request.body);
    checkBaseUrl(input.baseUrl);
    const p = await connections.get(id);
    if (p?.kind === "custom" && input.baseUrl === null) {
      throw new ApiError("invalid", "An OpenAI-compatible endpoint needs its address.");
    }
    await changeProvider(id, (e) => ({
      ...e,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.baseUrl === undefined
        ? {}
        : { baseUrl: input.baseUrl?.replace(/\/+$/, "") ?? null }),
    }));
    await report();
    return { provider: await viewOf(id) };
  });

  /**
   * Removes a provider and its key. Refused while a task uses it unless `?force=1` (after the
   * page asked); those tasks are then off until other models are chosen.
   */
  app.delete("/api/ai/providers/:id", async (request) => {
    const { id } = request.params as { id: string };
    const force = ["1", "true"].includes(String((request.query as { force?: unknown }).force));
    const now = (await s.settings.read())!;
    if (!now.ai.providers.some((p) => p.id === id)) {
      throw new ApiError("not_found", "Only a provider stored here can be removed.");
    }
    const using = TASKS.filter((t) => {
      const m = now.ai.models[t];
      return m ? splitModelId(m).provider === id : false;
    });
    if (using.length > 0 && !force) {
      throw new ApiError("invalid", "A task uses this provider. Confirm to remove it anyway.");
    }
    await s.settings.update((n) => ({
      ...n,
      ai: {
        ...n.ai,
        providers: n.ai.providers.filter((p) => p.id !== id),
        models: {
          extraction: using.includes("extraction") ? null : n.ai.models.extraction,
          conversation: using.includes("conversation") ? null : n.ai.models.conversation,
          art: using.includes("art") ? null : n.ai.models.art,
        },
      },
    }));
    s.models.forget();
    await report();
    return { ok: true as const, turnedOff: using };
  });

  app.get("/api/ai/models", async (request): Promise<ModelsResponse> => {
    const q = ModelsQuery.parse(request.query ?? {});
    const listed = await s.models.list({
      ...(q.q ? { q: q.q } : {}),
      ...(q.task ? { task: q.task } : {}),
      ...(q.provider ? { provider: q.provider } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      refresh: q.refresh !== undefined,
    });
    const calls = await s.aiLog.calls(monthOf(new Date()));
    const typical = { ...TYPICAL };
    for (const task of ["extraction", "conversation"] as const) {
      const done = calls.filter((c) => c.task === task && c.ok);
      if (done.length >= 3) {
        typical[task] = {
          promptTokens: median(done.map((c) => c.promptTokens)),
          completionTokens: median(done.map((c) => c.completionTokens)),
        };
      }
    }
    return { ...listed, typical };
  });

  app.get("/api/ai/log", async (request): Promise<AiLogResponse> => {
    const month = LogQuery.parse(request.query).month ?? monthOf(new Date());
    const calls = await s.aiLog.calls(month);
    const names = new Map<string, string>(
      (await connections.list()).map((p: ResolvedProvider) => [p.id, p.name]),
    );
    const full = calls.map((c: AiCall) => ({
      ...c,
      // Lines written before stage 18 were all OpenRouter's, its cost reported.
      provider: c.provider ?? splitModelId(c.model).provider,
      costKind: c.costKind ?? ("reported" as const),
    }));
    const byProvider = new Map<string, AiLogResponse["byProvider"][number]>();
    for (const c of full) {
      const row = byProvider.get(c.provider) ?? {
        provider: c.provider,
        name:
          names.get(c.provider) ??
          AI_PROVIDER_KINDS[c.provider as AiProviderKind]?.label ??
          c.provider,
        calls: 0,
        usd: 0,
        reported: 0,
        estimated: 0,
        unknown: 0,
      };
      row.calls++;
      row.usd += c.costUsd;
      row[c.costKind]++;
      byProvider.set(c.provider, row);
    }
    return {
      month,
      totalUsd: await s.aiLog.spent(month),
      capUsd: (await s.settings.read())!.ai.monthlyCapUsd,
      byProvider: [...byProvider.values()],
      calls: full.reverse().slice(0, 200),
    };
  });
}
