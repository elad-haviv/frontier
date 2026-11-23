/**
 * The two files of the built app that are not plain static files: the service worker, which the
 * kill switch replaces, and `build.json`, which says which build this is. Both are always read
 * past the HTTP cache, so a deploy or the switch reaches a browser at its next check.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { KILL_WORKER_SCRIPT } from "./killWorker.js";

/** `dist/build.json`: the content hash of the built `index.html`, and the client API number. */
export interface Build {
  build: string;
  api?: number;
}

/** Reads the build's id once, at start. Without a build (`vite dev`, server tests) it is "dev". */
export function readBuild(webDir: string | undefined): Build {
  if (webDir === undefined) return { build: "dev" };
  try {
    const read = JSON.parse(readFileSync(join(webDir, "build.json"), "utf8")) as Partial<Build>;
    if (typeof read.build === "string" && read.build) {
      return { build: read.build, ...(typeof read.api === "number" ? { api: read.api } : {}) };
    }
  } catch {
    /* no build.json: a development run */
  }
  return { build: "dev" };
}

export function webRoutes(
  app: FastifyInstance,
  { webDir, serviceWorker, build }: { webDir: string; serviceWorker: boolean; build: Build },
): void {
  app.get("/sw.js", (_request, reply) => {
    reply.header("cache-control", "no-cache");
    if (!serviceWorker) {
      return reply.type("text/javascript; charset=utf-8").send(KILL_WORKER_SCRIPT);
    }
    // Without a built worker the app's registration fails quietly and it runs as before.
    if (!existsSync(join(webDir, "sw.js"))) {
      return reply
        .status(404)
        .send({ error: { code: "not_found", message: "There is nothing at this address." } });
    }
    return reply.sendFile("sw.js");
  });

  app.get("/build.json", (_request, reply) =>
    reply
      .header("cache-control", "no-cache")
      .send(serviceWorker ? build : { ...build, worker: false }),
  );
}
