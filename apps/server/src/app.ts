import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import secureSession from "@fastify/secure-session";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import { ApiError } from "./errors.js";
import { appTokenSource } from "./git/appAuth.js";
import { GitError, GitGateway } from "./git/gateway.js";
import { ImageServer } from "./images/serve.js";
import { Publisher } from "./publish/publish.js";
import { draftRoutes } from "./routes/drafts.js";
import { DraftStore } from "./state/drafts.js";
import { VaultIndex } from "./index/build.js";
import { authRoutes } from "./routes/auth.js";
import { entryRoutes } from "./routes/entries.js";
import { imageRoutes } from "./routes/images.js";
import { statusRoutes } from "./routes/status.js";
import { webhookRoutes } from "./routes/webhook.js";
import { StateFiles } from "./state/files.js";
import { SettingsStore } from "./state/settings.js";
import { StatusService } from "./status/status.js";

declare module "@fastify/secure-session" {
  interface SessionData {
    user: string;
  }
}

export interface Services {
  config: Config;
  git: GitGateway;
  index: VaultIndex;
  status: StatusService;
  files: StateFiles;
  settings: SettingsStore;
  images: ImageServer;
  drafts: DraftStore;
  publisher: Publisher;
  /** Fetches `main`, resets the working copy and rebuilds the index. */
  sync(): Promise<void>;
}

export interface App {
  app: FastifyInstance;
  services: Services;
}

/** Routes that need no session. */
const OPEN = new Set(["/api/login", "/api/session", "/api/github/webhook", "/health"]);

const THIRTY_DAYS = 30 * 24 * 60 * 60;

export interface BuildOptions {
  /** Used by tests to watch Git commands. */
  onGitCommand?: (args: readonly string[]) => void;
  logger?: boolean;
  /** Folder of the built web app. When it holds a build, the server also serves the interface. */
  webDir?: string;
}

/** Builds the server. The caller decides when to clone, sync and listen. */
export async function buildApp(config: Config, options: BuildOptions = {}): Promise<App> {
  const vaultDir = join(config.dataDir, "vault");
  const stateDir = join(config.dataDir, "state");

  const git = new GitGateway({
    dir: vaultDir,
    remoteUrl: config.remoteUrl,
    author: config.commitAuthor,
    committer: config.commitBot,
    ...(config.githubApp ? { token: appTokenSource(config.githubApp) } : {}),
    ...(options.onGitCommand ? { onCommand: options.onGitCommand } : {}),
  });
  const index = new VaultIndex(vaultDir);
  const status = new StatusService(index);
  const files = new StateFiles();
  const settings = new SettingsStore(stateDir, files);
  const images = new ImageServer(vaultDir, config.dataDir);
  const drafts = new DraftStore(stateDir, files);
  await drafts.load();

  const services: Services = {
    config,
    git,
    index,
    status,
    files,
    settings,
    images,
    drafts,
    publisher: undefined as unknown as Publisher,
    async sync() {
      const result = await git.fetch();
      status.fetched(result.current);
      if (index.commit !== result.current) index.build(result.current);
      await services.publisher.clearPublished();
      status.indexed();
    },
  };
  services.publisher = new Publisher({
    vaultDir,
    git,
    index,
    drafts,
    status,
    sync: () => services.sync(),
  });

  // Coolify's proxy sits in front, so the client address and protocol come from its headers.
  const app = Fastify({ trustProxy: true, logger: options.logger ?? false });

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

  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0] ?? "";
    if (OPEN.has(path) || !path.startsWith("/api/")) return;
    if (request.session.get("user") !== "author") {
      throw new ApiError("unauthenticated", "Log in first.");
    }
  });

  app.addHook("onSend", async (_request, reply) => {
    reply.header(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
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
      return send(error.status, error.code, error.message, error.extra);
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
  if (serveWeb) await app.register(fastifyStatic, { root: webDir, wildcard: false });

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

  authRoutes(app, services);
  entryRoutes(app, services);
  draftRoutes(app, services);
  imageRoutes(app, services);
  statusRoutes(app, services);
  webhookRoutes(app, services);

  return { app, services };
}
