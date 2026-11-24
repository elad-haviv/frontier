/**
 * The kill worker: what `/sw.js` answers while `FRONTIER_SERVICE_WORKER=off`, in place of the
 * app's own service worker. A browser that checks for an update installs it and is rid of the app's
 * worker and its caches at once, without waiting for the author to press Reload.
 *
 * It is served as `(${killWorker.toString()})(self);`, so the function must stand alone: no imports,
 * no names from outside it. It never touches IndexedDB, so the save queue and its unsent changes
 * stay, and the app sends them from the network as before.
 */

/** The parts of a service worker's global scope the kill worker uses. Tests give a fake one. */
export interface KillWorkerScope {
  addEventListener(
    type: "install" | "activate",
    listener: (event: { waitUntil(work: Promise<unknown>): void }) => void,
  ): void;
  skipWaiting(): Promise<void>;
  caches: { keys(): Promise<string[]>; delete(name: string): Promise<boolean> };
  clients: {
    claim(): Promise<void>;
    matchAll(options: {
      type: "window";
    }): Promise<readonly { url: string; navigate(url: string): Promise<unknown> }[]>;
  };
  registration: { unregister(): Promise<boolean> };
}

export function killWorker(scope: KillWorkerScope): void {
  // Takes over at once, whatever pages the old worker still has open.
  scope.addEventListener("install", (event) => event.waitUntil(scope.skipWaiting()));
  scope.addEventListener("activate", (event) =>
    event.waitUntil(
      (async () => {
        // The open pages become its own, so it can send them to the network below.
        await scope.clients.claim();
        for (const name of await scope.caches.keys()) {
          if (name.startsWith("workbox-") || name.startsWith("frontier-")) {
            await scope.caches.delete(name);
          }
        }
        await scope.registration.unregister();
        // Only the pages it controls are listed; each loads its own address again, from the network.
        for (const client of await scope.clients.matchAll({ type: "window" })) {
          await client.navigate(client.url).catch(() => undefined);
        }
      })(),
    ),
  );
}

/** The script `/sw.js` answers while the switch is off. */
export const KILL_WORKER_SCRIPT = `(${killWorker.toString()})(self);\n`;
