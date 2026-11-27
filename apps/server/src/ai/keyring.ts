/**
 * The AI keys of the request being served (stage 27f). Each person keeps their keys in their own
 * browser and sends them with every request that can lead to an AI call; the server uses them for
 * that request and forgets them. This is the only place they live on the server, and only in the
 * memory of the request: an `AsyncLocalStorage`, so the code that calls the provider (deep in a
 * service, far from the route) reads the right person's keys without a key being passed through
 * every function, stored on a service, or written anywhere.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  AI_KEYS_HEADER,
  type AiProviderKind,
  type DeviceKeys,
  decodeDeviceKeys,
} from "@frontier/schema";
import type { FastifyInstance } from "fastify";

const current = new AsyncLocalStorage<DeviceKeys>();

/** The keys of the request being served, or none outside one. */
export function deviceKeys(): DeviceKeys {
  return current.getStore() ?? {};
}

/** The key this request carries for a provider, or null. */
export function deviceKey(kind: AiProviderKind): string | null {
  return deviceKeys()[kind] ?? null;
}

/** Runs `work` with these keys as the request's own. For routes that try a typed key, and tests. */
export function withDeviceKeys<T>(keys: DeviceKeys, work: () => T): T {
  return current.run(keys, work);
}

/**
 * Reads the keys header of each request into the request's own context, then takes the header off
 * the request so nothing later (a log line, an error report, a plugin) can see it. Registered
 * before every other hook.
 */
export function readKeysHeader(app: FastifyInstance): void {
  app.addHook("onRequest", (request, _reply, done) => {
    const value = request.headers[AI_KEYS_HEADER];
    const keys = decodeDeviceKeys(Array.isArray(value) ? value[0] : value);
    delete request.headers[AI_KEYS_HEADER];
    delete request.raw.headers[AI_KEYS_HEADER];
    current.run(keys, done);
  });
}
