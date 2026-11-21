import type { FastifyInstance } from "fastify";
import { AiSettingsRequest, type ModelsResponse, type SettingsResponse } from "@frontier/schema";
import { z } from "zod";
import { monthOf } from "../ai/log.js";
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

export function settingsRoutes(app: FastifyInstance, s: Services): void {
  /** Tells the status area whether AI is usable, after anything that can change it. */
  async function report(): Promise<void> {
    s.status.ai(await s.ai.ready("extraction"), s.ai.lastError);
  }

  app.get("/api/settings", async (request): Promise<SettingsResponse> => {
    const settings = (await s.settings.read())!;
    const key = await s.ai.key();
    const { spentUsd } = await s.ai.spending();
    return {
      ai: {
        keySet: key !== null,
        keyFrom: key?.from ?? "none",
        keyLast4: key ? key.key.slice(-4) : null,
        canStoreKey: s.config.secretsKey !== null,
        models: settings.ai.models,
        monthlyCapUsd: settings.ai.monthlyCapUsd,
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
    const secretsKey = s.config.secretsKey;
    if (typeof input.key === "string" && !secretsKey) {
      throw new ApiError(
        "secrets_key_missing",
        "The server has no SECRETS_KEY, so it cannot store a key. Set SECRETS_KEY (32 bytes in " +
          "base64) in the server's environment, or give the provider key there as OPENROUTER_API_KEY.",
      );
    }
    await s.settings.update((now) => ({
      ...now,
      ai: {
        ...now.ai,
        ...(input.key === undefined
          ? {}
          : { key: input.key === null ? null : encrypt(secretsKey!, input.key.trim()) }),
        ...(input.models ? { models: { ...now.ai.models, ...input.models } } : {}),
        ...(input.monthlyCapUsd === undefined ? {} : { monthlyCapUsd: input.monthlyCapUsd }),
        ...(input.proposeOnPublish === undefined
          ? {}
          : { proposeOnPublish: input.proposeOnPublish }),
      },
    }));
    await report();
    return { ok: true as const };
  });

  /** One small call to the chosen model, to show that the key and the model work. */
  app.post("/api/settings/ai/test", async () => {
    const before = (await s.ai.spending()).spentUsd;
    try {
      const answer = await s.ai.complete({
        task: "extraction",
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

  app.get("/api/ai/models", async (): Promise<ModelsResponse> => ({
    models: await s.models.list(),
  }));

  app.get("/api/ai/log", async (request) => {
    const month = LogQuery.parse(request.query).month ?? monthOf(new Date());
    const calls = await s.aiLog.calls(month);
    return {
      month,
      totalUsd: await s.aiLog.spent(month),
      capUsd: (await s.settings.read())!.ai.monthlyCapUsd,
      calls: calls.reverse().slice(0, 200),
    };
  });
}
