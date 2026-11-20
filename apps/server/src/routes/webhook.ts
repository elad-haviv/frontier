import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ApiError } from "../errors.js";
import type { Services } from "../app.js";

/** Checks GitHub's `X-Hub-Signature-256` header against the unparsed request body. */
export function validSignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function webhookRoutes(app: FastifyInstance, s: Services): void {
  app.post("/api/github/webhook", async (request) => {
    const secret = s.config.webhookSecret;
    if (!secret) throw new ApiError("not_found", "No webhook is configured.");
    const header = request.headers["x-hub-signature-256"];
    const raw = (request as typeof request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    if (!validSignature(secret, raw, Array.isArray(header) ? header[0] : header)) {
      throw new ApiError("unauthenticated", "The webhook signature does not match.");
    }
    const body = request.body as { ref?: string } | null;
    if (request.headers["x-github-event"] === "push" && body?.ref === "refs/heads/main") {
      await s.sync();
    }
    return { ok: true as const };
  });
}
