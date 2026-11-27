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
    // An image of a project's library (`/api/p/<slug>/images`), not one from a proposal's
    // branch, nor one opened as a page. Each project's images have their own addresses, so one
    // project's are never answered for another.
    const image =
      IMAGE.test(path) &&
      mode !== "navigate" &&
      url.searchParams.has("path") &&
      !url.searchParams.has("branch");
    return image ? "image" : "none";
  }
  if (mode === "navigate") return "shell";
  return PRECACHED.test(path) ? "precache" : "none";
}

/** The address of a project's images. */
const IMAGE = /^\/api\/p\/[^/]+\/images$/;

/**
 * What an image address shows, for finding the same image stored at another width: the project
 * and the `path`, so the same path in another project is another image.
 */
export function imagePath(url: URL): string | null {
  const path = url.searchParams.get("path");
  return IMAGE.test(url.pathname) && path !== null ? `${url.pathname}\n${path}` : null;
}
