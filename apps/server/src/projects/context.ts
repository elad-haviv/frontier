import { AsyncLocalStorage } from "node:async_hooks";
import type { Services } from "../app.js";

/**
 * Which project's services a route handler is running for. The routes are written once, against
 * one `Services`, and registered once; the guard resolves the project of each request, and
 * `facade.ts` runs the handler inside this store, so that `s.drafts` in a handler is the drafts of
 * the project the request is for. Nothing here lets one request see another's project: the store
 * lives exactly as long as the handler's own promise chain.
 */
const store = new AsyncLocalStorage<Services>();

export const runWithProject = <T>(services: Services, work: () => T): T =>
  store.run(services, work);

/** The services of the project the current request is for, or undefined outside a request. */
export const currentServices = (): Services | undefined => store.getStore();

/**
 * What a route file is given as `s`: it reads through to the current request's project. The
 * server-wide members are the same for every project and can be read at any time, such as when a
 * route is registered; anything else outside a request is a mistake and says so.
 */
export function scopedServices(server: Services["server"]): Services {
  const everywhere: Record<string, unknown> = {
    server,
    ai: server.ai,
    aiLog: server.aiLog,
    models: server.models,
    settings: server.settings,
    imageFetcher: server.imageFetcher,
    config: server.config,
  };
  return new Proxy({} as Services, {
    get(_target, key) {
      const now = store.getStore();
      if (now) return (now as unknown as Record<string | symbol, unknown>)[key];
      if (typeof key === "string" && key in everywhere) return everywhere[key];
      throw new Error(
        `"${String(key)}" belongs to a project, and was read outside a request for one.`,
      );
    },
  });
}

/**
 * State a route file keeps for itself, once for each project (a cache, a set of runs under way).
 * `make` runs the first time a project asks.
 */
export function perProject<T>(make: () => T): () => T {
  const held = new WeakMap<Services, T>();
  return () => {
    const now = store.getStore();
    if (!now) throw new Error("Per-project state was read outside a request for a project.");
    let value = held.get(now);
    if (value === undefined) {
      value = make();
      held.set(now, value);
    }
    return value;
  };
}
