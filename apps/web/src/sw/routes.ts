/**
 * What the service worker answers, as one pure function the worker asks before every answer.
 *
 * It answers navigations with the app, the app's own built files from the precache, and images
 * already stored on the device. Nothing else: never an `/api/` read, a write, the session, the
 * status or its stream. Those go to the network as if there were no worker, so every failure to
 * reach the server still reaches `api.ts` and the connection service as a failure.
 */

/** The Cache Storage cache of images stored on the device. */
export const IMAGES = "frontier-images";

export type SwRoute = "shell" | "precache" | "image" | "none";

/** Files the worker never answers, whatever the request: they are how it is updated and switched off. */
const OWN = new Set(["/sw.js", "/build.json"]);

/** Built files with hashed names, the icons and the manifest. */
const PRECACHED = /^\/(assets|icons)\/|^\/(index\.html|manifest\.webmanifest)$/;

export function routeOf({
  url,
  method,
  mode,
}: {
  url: URL;
  method: string;
  mode: string;
}): SwRoute {
  const path = url.pathname;
  if (method !== "GET" || OWN.has(path) || path === "/health") return "none";
  if (path.startsWith("/api/")) {
    // An image of the library, not one from a proposal's branch, nor one opened as a page.
    const image =
      path === "/api/images" &&
      mode !== "navigate" &&
      url.searchParams.has("path") &&
      !url.searchParams.has("branch");
    return image ? "image" : "none";
  }
  if (mode === "navigate") return "shell";
  return PRECACHED.test(path) ? "precache" : "none";
}

/** The `path` an image address shows, for finding the same image stored at another width. */
export function imagePath(url: URL): string | null {
  return url.pathname === "/api/images" ? url.searchParams.get("path") : null;
}
