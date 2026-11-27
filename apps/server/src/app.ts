import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import secureSession from "@fastify/secure-session";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AI_KEYS_HEADER } from "@frontier/schema";
import { readKeysHeader } from "./ai/keyring.js";
import { FolderTarget, S3Target } from "./backup/targets.js";
import type { Config } from "./config.js";
import { ApiError, settingsLink } from "./errors.js";
import { GitError } from "./git/gateway.js";
import type { FetchLimits, Resolve } from "./images/fromUrl.js";
import { guardProjects } from "./projects/guard.js";
import { projectApp, RouteBook, type ProjectRoute } from "./projects/facade.js";
import { scopedServices } from "./projects/context.js";
import { ensureFirstProject } from "./projects/first.js";
import { ProjectRegistry } from "./projects/registry.js";
import { buildServices, type Services } from "./projects/services.js";
import { authRoutes } from "./routes/auth.js";
import { characterRoutes } from "./routes/characters.js";
import { chronicleRoutes } from "./routes/chronicles.js";
import { commentRoutes } from "./routes/comments.js";
import { discoverRoutes } from "./routes/discover.js";
import { draftRoutes } from "./routes/drafts.js";
import { entryDraftRoutes } from "./routes/entryDraft.js";
import { entryRoutes } from "./routes/entries.js";
import { exportRoutes } from "./routes/export.js";
import { folderRoutes } from "./routes/folders.js";
import { graphRoutes } from "./routes/graph.js";
import { historyRoutes } from "./routes/history.js";
import { imageRoutes } from "./routes/images.js";
import { importRoutes } from "./routes/import.js";
import { inboxRoutes } from "./routes/inbox.js";
import { keepGoingRoutes } from "./routes/keepGoing.js";
import { libraryFileRoutes } from "./routes/libraryFiles.js";
import { loreRoutes } from "./routes/lore.js";
import { mapRoutes } from "./routes/maps.js";
import { passkeyRoutes } from "./routes/passkeys.js";
import { projectRoutes, projectsApi } from "./routes/projects.js";
import { proposalRoutes } from "./routes/proposals.js";
import { quarantineRoutes } from "./routes/quarantine.js";
import { searchRoutes } from "./routes/search.js";
import { settingsRoutes } from "./routes/settings.js";
import { healthRoute, statusRoutes } from "./routes/status.js";
import { webhookRoutes } from "./routes/webhook.js";
import { writingRoutes } from "./routes/writing.js";
import { makeServer, type Server } from "./server.js";
import { requirePerson } from "./auth/session.js";
import { readBuild, webRoutes } from "./web.js";

export { backupSources, backupPlan, PrefixedTarget } from "./projects/services.js";
export type { Services } from "./projects/services.js";

declare module "@fastify/secure-session" {
  interface SessionData {
    /** The id of the person logged in. Sessions from before accounts said "author"; see `auth/session.ts`. */
    user: string;
    /** How the person logged in. */
    method: "password" | "passkey";
    /** The person's `sessionEpoch` when the session started or last followed a change; see `currentPerson`. */
    epoch: number;
    /** When the person logged in (milliseconds), for what asks for a recent login. */
    loginAt: number;
    /** The challenge of a passkey ceremony in progress, and when it ends. */
    challenge: { value: string; until: number };
  }
}

export interface App {
  app: FastifyInstance;
  /** The first project's services (the library the server had before projects), not brought up. */
  services: Services;
  /** What belongs to the whole server. */
  server: Server;
  /** Every project route, with the role it needs: the table the guard enforces. */
  routes: ProjectRoute[];
}

/** Routes that need no session. */
const OPEN = new Set([
  "/api/login",
  "/api/session",
  "/api/github/webhook",
  "/health",
  "/api/passkeys/login/options",
  "/api/passkeys/login/verify",
]);

const THIRTY_DAYS = 30 * 24 * 60 * 60;

/**
 * The cache rule for a built file, by its path in the build: what names the other files is read
 * again each time, files whose names carry their hash are kept, and the icons for a day.
 */
function cacheRule(file: string): string | null {
  if (file === "index.html" || file === "manifest.webmanifest") return "no-cache";
  if (file.startsWith("assets/")) return "public, max-age=31536000, immutable";
  if (file.startsWith("icons/")) return "public, max-age=86400";
  return null;
}

export interface BuildOptions {
  /** Used by tests to watch Git commands. */
  onGitCommand?: (args: readonly string[]) => void;
  logger?: boolean;
  /** Where the log lines go when `logger` is on; the standard output when not given. Tests read it. */
  logStream?: { write(line: string): void };
  /** How long after a change the backup runs. Tests shorten it. */
  backupDelayMs?: number;
  /** How long a note from outside is kept from AI features. Tests shorten it. */
  settleMs?: number;
  /** Stands in for the network in tests of the AI provider. */
  fetch?: typeof fetch;
  /** Folder of the built web app. When it holds a build, the server also serves the interface. */
  webDir?: string;
  /** Stands in for DNS when tests take an image from a web address. */
  resolveHost?: Resolve;
  /** Shorter limits for taking an image from a web address, for tests. */
  imageFetchLimits?: Partial<FetchLimits>;
}

/** Builds the server. The caller decides when to clone, sync and listen. */
export async function buildApp(config: Config, options: BuildOptions = {}): Promise<App> {
  const server = makeServer(config, {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.resolveHost ? { resolveHost: options.resolveHost } : {}),
    ...(options.imageFetchLimits ? { imageFetchLimits: options.imageFetchLimits } : {}),
  });
  const target =
    config.backup.kind === "local"
      ? new FolderTarget(config.backup.dir)
      : new S3Target(config.backup.s3);
  server.registry = new ProjectRegistry((record) =>
    buildServices(server, record, {
      target,
      ...(options.onGitCommand ? { onGitCommand: options.onGitCommand } : {}),
      ...(options.backupDelayMs !== undefined ? { backupDelayMs: options.backupDelayMs } : {}),
      ...(options.settleMs !== undefined ? { settleMs: options.settleMs } : {}),
    }),
  );

  // AI keys are never kept here: each request brings the person's own (see ai/keyring.ts). Keys an
  // earlier version stored in the settings file are deleted now, and the web app says so once.
  const keysRemoved = await server.settings.removeStoredKeys(new Date(), config.unusedKeyVars);
  server.keysRemoved = keysRemoved ?? (await server.settings.read())?.ai.keysRemoved ?? null;

  const first = await ensureFirstProject(server);
  const services = await server.registry.adopt(first);

  // Coolify's proxy sits in front, so the client address and protocol come from its headers.
  // AI keys arrive in a request header. They are taken off the request before anything else sees
  // it, and redacted from any log line as well, in case a request is ever logged whole.
  const app = Fastify({
    trustProxy: true,
    logger: options.logger
      ? {
          ...(options.logStream ? { stream: options.logStream } : {}),
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            `req.headers["${AI_KEYS_HEADER}"]`,
            "req.body.key",
          ],
        }
      : false,
  });
  readKeysHeader(app);
  // A failed AI call is written to the server's log too, or production shows only a bare 502.
  server.ai.logFailuresTo(app.log);

  // Keep the unparsed body: the webhook signature is computed over the exact bytes sent.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    (request as typeof request & { rawBody?: Buffer }).rawBody = body as Buffer;
    if ((body as Buffer).length === 0) return done(null, null);
    try {
      done(null, JSON.parse((body as Buffer).toString("utf8")));
    } catch {
      done(new ApiError("invalid", "The request body is not valid JSON."));
    }
  });

  await app.register(secureSession, {
    key: config.sessionKey,
    cookieName: "frontier_session",
    expiry: THIRTY_DAYS,
    cookie: {
      path: "/",
      httpOnly: true,
      secure: config.publicUrl.startsWith("https://"),
      sameSite: "lax",
      maxAge: THIRTY_DAYS,
    },
  });
  await app.register(rateLimit, { global: false });
  // One image per upload, up to 25 MB.
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

  app.addHook("onClose", async () => server.registry.closeAll());

  app.decorateRequest("person", null);
  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0] ?? "";
    if (OPEN.has(path) || !path.startsWith("/api/")) return;
    const person = await requirePerson(request, server.people);
    request.keysHolder.person = person.id;
  });

  // Which build this server carries, for reading logs and the browser's network panel.
  const build = readBuild(options.webDir);
  app.log.info({ build: build.build }, "Serving build");

  app.addHook("onSend", async (request, reply) => {
    reply.header(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; " +
        "base-uri 'self'; form-action 'self'",
    );
    if (request.url.startsWith("/api/")) reply.header("frontier-build", build.build);
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
  });

  app.setErrorHandler((error: unknown, _request, reply) => {
    const send = (
      status: number,
      code: string,
      message: string,
      extra: Record<string, string> = {},
    ) => reply.status(status).send({ error: { code, message, ...extra } });
    if (error instanceof ApiError)
      return send(error.status, error.code, error.message, {
        ...settingsLink(error),
        ...error.extra,
      });
    if (error instanceof ZodError) {
      const first = error.issues[0];
      return send(
        400,
        "invalid",
        first ? `${first.path.join(".") || "request"}: ${first.message}` : "Invalid request.",
      );
    }
    if (error instanceof GitError) {
      if (error.code === "git_busy") return send(503, "git_busy", error.message);
      if (error.code === "main_moved") return send(409, "main_moved", error.message);
      if (error.code === "push_failed") return send(502, "push_failed", error.message);
      return send(500, "merge_failed", error.message);
    }
    const e = error as { statusCode?: number; message?: string };
    if (e.statusCode === 429)
      return send(429, "rate_limited", "Too many attempts. Wait 15 minutes and try again.");
    if (e.statusCode !== undefined && e.statusCode >= 400 && e.statusCode < 500) {
      return send(e.statusCode, "invalid", e.message ?? "Invalid request.");
    }
    app.log.error(error);
    return send(500, "merge_failed", "The server hit an unexpected error.");
  });

  const webDir = options.webDir;
  const serveWeb = webDir !== undefined && existsSync(join(webDir, "index.html"));
  if (serveWeb) {
    // One route per built file, but for the two that `webRoutes` answers itself. The plugin sets
    // no cache header; `cacheRule` does.
    await app.register(fastifyStatic, {
      root: webDir,
      wildcard: false,
      globIgnore: ["sw.js", "build.json"],
      cacheControl: false,
      setHeaders: (res, path) => {
        const rule = cacheRule(relative(webDir, path).split(sep).join("/"));
        if (rule) res.setHeader("cache-control", rule);
      },
    });
    webRoutes(app, { webDir, serviceWorker: config.serviceWorker, build });
  }

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    // The interface handles its own addresses: any page address gets the app, which then routes.
    if (serveWeb && request.method === "GET" && !path.startsWith("/api/") && path !== "/health") {
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    }
    return reply
      .status(404)
      .send({ error: { code: "not_found", message: "There is nothing at this address." } });
  });

  // The project routes: written once against one `Services`, registered once for every project
  // under `/api/p/:project`, and at their old addresses for devices on the previous web build.
  const book = new RouteBook();
  guardProjects(app, server, book);
  const forProject = projectApp(app, book);
  const s = scopedServices(server);
  entryRoutes(forProject, s);
  graphRoutes(forProject, s);
  draftRoutes(forProject, s);
  imageRoutes(forProject, s);
  inboxRoutes(forProject, s);
  proposalRoutes(forProject, s);
  quarantineRoutes(forProject, s);
  mapRoutes(forProject, s);
  chronicleRoutes(forProject, s);
  libraryFileRoutes(forProject, s);
  folderRoutes(forProject, s);
  loreRoutes(forProject, s);
  entryDraftRoutes(forProject, s);
  keepGoingRoutes(forProject, s);
  writingRoutes(forProject, s);
  commentRoutes(forProject, s);
  characterRoutes(forProject, s);
  discoverRoutes(forProject, s);
  exportRoutes(forProject, s);
  importRoutes(forProject, s);
  historyRoutes(forProject, s);
  searchRoutes(forProject, s);
  statusRoutes(forProject, s);
  // The project's own routes have no alias: `DELETE /api/project` must not exist.
  projectRoutes(projectApp(app, book, { aliases: false }), s);

  // What belongs to the whole server, or to the person.
  authRoutes(app, server);
  passkeyRoutes(app, server);
  settingsRoutes(app, server);
  projectsApi(app, server);
  healthRoute(app, server);
  webhookRoutes(app, server);

  return { app, services, server, routes: book.routes };
}
