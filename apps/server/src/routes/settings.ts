import type { FastifyInstance } from "fastify";
import {
  AI_PROVIDER_KINDS,
  AiProviderKind,
  AiSettingsRequest,
  AiTestRequest,
  ModelPricesRequest,
  ModelsQuery,
  qualifyModelId,
  splitModelId,
  type AiLogResponse,
  type KeyCheckResponse,
  type ModelsResponse,
  type SettingsResponse,
} from "@frontier/schema";
import { z } from "zod";
import { deviceKey } from "../ai/keyring.js";
import { type AiCall, monthOf } from "../ai/log.js";
import { keyMissing } from "../ai/provider.js";
import { ProviderError, type ProviderAdapter } from "../ai/providers/index.js";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

const LogQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

const Reply = z.object({ reply: z.string() });

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
): Promise<KeyCheckResponse> {
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
    // Not reached at all (as opposed to refused).
    const unreachable = e.opts.status === undefined && e.retry;
    return { ok: false, refused: !unreachable, message: e.message, models: null };
  }
}

export function settingsRoutes(app: FastifyInstance, s: Services): void {
  const limiter = new CheckLimiter();
  const connections = s.ai.connections;

  app.get("/api/settings", async (request): Promise<SettingsResponse> => {
    const settings = (await s.settings.read())!;
    const { spentUsd } = await s.ai.spending();
    return {
      ai: {
        modelPrices: settings.ai.modelPrices,
        models: settings.ai.models,
        artStyle: settings.ai.artStyle,
        proposeOnPublish: settings.ai.proposeOnPublish,
        spentUsd,
      },
      signIn: {
        passkeys: settings.passkeys.map(({ id, name, addedAt }) => ({ id, name, addedAt })),
        passwordOff: settings.passwordOff,
        method: request.session.get("method") ?? "password",
      },
    };
  });

  app.put("/api/settings/ai", async (request) => {
    const input = AiSettingsRequest.parse(request.body);
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
        ...(input.artStyle === undefined ? {} : { artStyle: input.artStyle }),
        ...(input.proposeOnPublish === undefined
          ? {}
          : { proposeOnPublish: input.proposeOnPublish }),
      },
    }));
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
      // A missing key is for the web app to ask about, not a failed test.
      if (err.code === "ai_key_missing") throw err;
      return {
        ok: false,
        costUsd: (await s.ai.spending()).spentUsd - before,
        message: err.message,
      };
    }
  });

  /**
   * Checks the key this request carries for a provider, with a free call to the provider. Nothing
   * is stored, whatever the answer: the key lives in the person's browser.
   */
  app.post("/api/ai/keys/:kind/check", async (request): Promise<KeyCheckResponse> => {
    const parsed = AiProviderKind.safeParse((request.params as { kind: string }).kind);
    if (!parsed.success) throw new ApiError("not_found", "There is no such provider.");
    const kind = parsed.data;
    const key = deviceKey(kind);
    if (!key) throw keyMissing(kind);
    limiter.take();
    return checkWith(connections.trial(kind, key), kind);
  });

  /** Says that the notice about keys deleted from the server was seen, so it is not shown again. */
  app.delete("/api/notices/keys-removed", async () => {
    await s.settings.update((now) => ({ ...now, ai: { ...now.ai, keysRemoved: null } }));
    s.status.keysWereRemoved(null);
    return { ok: true as const };
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
        name: AI_PROVIDER_KINDS[c.provider as AiProviderKind]?.label ?? c.provider,
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
      byProvider: [...byProvider.values()],
      calls: full.reverse().slice(0, 200),
    };
  });
}
