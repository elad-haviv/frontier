/**
 * The service worker. It keeps the app shell so Frontier opens with no connection, and answers
 * images already stored on the device. What it answers is decided by `routeOf` (`routes.ts`).
 *
 * It never skips waiting by itself and never claims pages: a new version waits until the author
 * presses Reload, which sends `SKIP_WAITING` (`offline/updates.ts`).
 */
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  matchPrecache,
  precache,
} from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { StaleWhileRevalidate } from "workbox-strategies";
import { IMAGES, imagePath, routeOf, type SwRoute } from "./routes.ts";

declare const self: ServiceWorkerGlobalScope;

precache(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const is =
  (route: SwRoute) =>
  ({ url, request, sameOrigin }: { url: URL; request: Request; sameOrigin: boolean }) =>
    sameOrigin && routeOf({ url, method: request.method, mode: request.mode }) === route;

// Every page address gets the app, which then routes.
registerRoute(is("shell"), createHandlerBoundToURL("/index.html"));

// The built files. One the precache lacks, as a file of a newer deploy, comes from the network.
registerRoute(
  is("precache"),
  async ({ request }) => (await matchPrecache(request)) ?? fetch(request),
);

// An image stored on the device is answered from it and refreshed in the background; any other
// goes to the network, and only when that fails does a copy of it at another width stand in.
const stored = new StaleWhileRevalidate({ cacheName: IMAGES });
registerRoute(is("image"), async (options) => {
  const cache = await caches.open(IMAGES);
  if (await cache.match(options.request)) return stored.handle(options);
  try {
    return await fetch(options.request);
  } catch (error) {
    const path = imagePath(options.url);
    for (const key of path === null ? [] : await cache.keys()) {
      if (imagePath(new URL(key.url)) === path) {
        const other = await cache.match(key);
        if (other) return other;
      }
    }
    throw error;
  }
});

self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") void self.skipWaiting();
});
