/**
 * The AI keys of the request being served (stage 31f). Each person keeps their keys in their own
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
import type { FastifyInstance, FastifyRequest } from "fastify";
import { outsideSavedView } from "../projects/view.js";

/**
 * What a request holds: the keys it carried, and who asked. The holder is emptied when the
 * response is over, so a timer, a promise or a log line that still reaches it later finds nothing.
 */
interface Holder {
  keys: DeviceKeys;
  person: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    keysHolder: Holder;
  }
}

const current = new AsyncLocalStorage<Holder>();

/** The keys of the request being served, or none outside one. */
export function deviceKeys(): DeviceKeys {
  return current.getStore()?.keys ?? {};
}

/** The key this request carries for a provider, or null. */
export function deviceKey(kind: AiProviderKind): string | null {
  return deviceKeys()[kind] ?? null;
}

/** Who the request being served is from (their id), or null outside one. */
export function requestPerson(): string | null {
  return current.getStore()?.person ?? null;
}

/**
 * Whether the code running now is serving this request (not another one, and not a timer or task
 * that left the request). Lets a change that cuts a person's open requests spare the one making it.
 */
export function isThisRequest(request: FastifyRequest): boolean {
  const here = current.getStore();
  return here !== undefined && here === request.keysHolder;
}

/** Runs `work` with these keys as the request's own. For routes that try a typed key, and tests. */
export function withDeviceKeys<T>(
  keys: DeviceKeys,
  work: () => T,
  person: string | null = null,
): T {
  return current.run({ keys, person }, work);
}

/**
 * Runs `work` as if no request were being served, so a timer or task it starts never inherits the
 * request's keys. Use it where a request arms something that outlives it (the backup's timer).
 */
export function outsideRequest<T>(work: () => T): T {
  // Also out of the saved view a reader's request runs in: a timer started here serves everyone.
  return outsideSavedView(() => current.exit(work));
}

/**
 * Reads the keys header of each request into the request's own holder, then takes the header off
 * the request so nothing later (a log line, an error report, a plugin) can see it. The holder is
 * made current again just before the handler, because the body is read from the socket, whose
 * events do not carry the context of the request's start; and it is emptied when the response is
 * over. Registered before every other hook.
 */
export function readKeysHeader(app: FastifyInstance): void {
  app.decorateRequest("keysHolder", null as unknown as Holder);
  app.addHook("onRequest", (request, reply, done) => {
    const value = request.headers[AI_KEYS_HEADER];
    const holder: Holder = {
      keys: decodeDeviceKeys(Array.isArray(value) ? value[0] : value),
      person: null,
    };
    request.keysHolder = holder;
    delete request.headers[AI_KEYS_HEADER];
    delete request.raw.headers[AI_KEYS_HEADER];
    reply.raw.once("close", () => {
      holder.keys = {};
      holder.person = null;
    });
    current.run(holder, done);
  });
  app.addHook("preValidation", (request, _reply, done) => current.run(request.keysHolder, done));
  app.addHook("preHandler", (request, _reply, done) => current.run(request.keysHolder, done));
}
