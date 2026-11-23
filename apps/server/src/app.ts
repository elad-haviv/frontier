import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import secureSession from "@fastify/secure-session";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { FieldProposer } from "./ai/fields.js";
import { FieldJob } from "./ai/job.js";
import { AiLog } from "./ai/log.js";
import { ModelCatalogue } from "./ai/models.js";
import { AiProvider } from "./ai/provider.js";
import { LoginLimiter } from "./auth/limit.js";
import { ChronicleStore } from "./chronicles/store.js";
import { MapStore } from "./maps/store.js";
import { FolderStore } from "./folders/store.js";
import { LibraryFileStore } from "./library/files.js";
import { folderRoutes } from "./routes/folders.js";
import { libraryFileRoutes } from "./routes/libraryFiles.js";
import { Conversations } from "./ai/conversations.js";
import { LoreAsker } from "./ai/lore.js";
import { loreRoutes } from "./routes/lore.js";
import { writingRoutes } from "./routes/writing.js";
import { commentRoutes } from "./routes/comments.js";
import { CommentStore } from "./comments/store.js";
import { characterRoutes } from "./routes/characters.js";
import { discoverRoutes } from "./routes/discover.js";
import { exportRoutes } from "./routes/export.js";
import { Discoverer } from "./ai/discover.js";
import { CharacterTalk } from "./ai/characters.js";
import { WritingHelper } from "./ai/writing.js";
import { chronicleRoutes } from "./routes/chronicles.js";
import { mapRoutes } from "./routes/maps.js";
import { historyRoutes } from "./routes/history.js";
import { importRoutes } from "./routes/import.js";
import { Backup } from "./backup/backup.js";
import { EntryChanger } from "./entries/change.js";
import { ProposalStore } from "./proposals/store.js";
import { Quarantine, REVIEW_FILE } from "./quarantine/quarantine.js";
import { passkeyRoutes } from "./routes/passkeys.js";
import { proposalRoutes } from "./routes/proposals.js";
import { quarantineRoutes } from "./routes/quarantine.js";
import { settingsRoutes } from "./routes/settings.js";
import { FolderTarget, S3Target } from "./backup/targets.js";
import type { Config } from "./config.js";
import { ApiError } from "./errors.js";
import { appTokenSource } from "./git/appAuth.js";
import { GitError, GitGateway } from "./git/gateway.js";
import { ImageServer } from "./images/serve.js";
import { type FetchLimits, ImageFetcher, type Resolve } from "./images/fromUrl.js";
import { BranchInbox } from "./inbox/branches.js";
import { inboxRoutes } from "./routes/inbox.js";
import { Publisher } from "./publish/publish.js";
import { draftRoutes } from "./routes/drafts.js";
import { DraftStore } from "./state/drafts.js";
import { VaultIndex } from "./index/build.js";
import { SearchIndex } from "./index/search.js";
import { authRoutes } from "./routes/auth.js";
import { entryRoutes } from "./routes/entries.js";
import { graphRoutes } from "./routes/graph.js";
import { imageRoutes } from "./routes/images.js";
import { searchRoutes } from "./routes/search.js";
import { statusRoutes } from "./routes/status.js";
import { webhookRoutes } from "./routes/webhook.js";
import { StateFiles } from "./state/files.js";
import { SettingsStore } from "./state/settings.js";
import { StatusService } from "./status/status.js";
import { readBuild, webRoutes } from "./web.js";

declare module "@fastify/secure-session" {
  interface SessionData {
    user: string;
    /** How the author logged in. */
    method: "password" | "passkey";
    /** The challenge of a passkey ceremony in progress, and when it ends. */
    challenge: { value: string; until: number };
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
  /** Takes images from web addresses, with the safeguards that keep the server's network safe. */
  imageFetcher: ImageFetcher;
  drafts: DraftStore;
  publisher: Publisher;
  branches: BranchInbox;
  ai: AiProvider;
  aiLog: AiLog;
  models: ModelCatalogue;
  changer: EntryChanger;
  proposals: ProposalStore;
  fields: FieldProposer;
  fieldJob: FieldJob;
  quarantine: Quarantine;
  loginLimit: LoginLimiter;
  maps: MapStore;
  chronicles: ChronicleStore;
  /** Library item files, such as the folder file, through one store. */
  libraryFiles: LibraryFileStore;
  folders: FolderStore;
  lore: LoreAsker;
  writing: WritingHelper;
  characters: CharacterTalk;
  discoverer: Discoverer;
  conversations: Conversations;
  comments: CommentStore;
  backup: Backup;
  search: SearchIndex;
  /** Fetches `main`, resets the working copy and rebuilds the index. */
  sync(): Promise<void>;
}

export interface App {
  app: FastifyInstance;
  services: Services;
}

/** The folders that hold data which cannot be rebuilt from the vault repository. */
export function backupSources(dataDir: string, ownLibrary = false): Record<string, string> {
  return {
    state: join(dataDir, "state"),
    generated: join(dataDir, "assets", "generated"),
    // Frontier's own library exists nowhere else, so it is backed up with the rest.
    ...(ownLibrary ? { library: join(dataDir, "library.git") } : {}),
  };
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
  const vaultDir = join(config.dataDir, "vault");
  const stateDir = join(config.dataDir, "state");

  const git = new GitGateway({
    dir: vaultDir,
    remoteUrl: config.remoteUrl,
    author: config.commitAuthor,
    committer: config.commitBot,
    ...(config.githubApp
      ? { token: appTokenSource(config.githubApp) }
      : config.githubToken
        ? { token: async () => config.githubToken }
        : {}),
    ...(options.onGitCommand ? { onCommand: options.onGitCommand } : {}),
  });
  const index = new VaultIndex(vaultDir);
  const status = new StatusService(index, {
    library: config.library,
    backupOutside: config.backup.kind === "s3",
    // Read only when a snapshot is made, after the draft store below exists.
    keptCopies: () => drafts.keptCount(),
  });
  const files = new StateFiles();
  const settings = new SettingsStore(stateDir, files);
  const images = new ImageServer(vaultDir, config.dataDir);
  const imageFetcher = new ImageFetcher({
    publicUrl: config.publicUrl,
    allowLoopback: config.imageFetchAllowLoopback,
    ...(options.resolveHost ? { resolve: options.resolveHost } : {}),
    ...(options.imageFetchLimits ? { limits: options.imageFetchLimits } : {}),
  });
  const drafts = new DraftStore(stateDir, files);
  await drafts.load();
  const backup = new Backup({
    sources: backupSources(config.dataDir, config.library === "own"),
    target:
      config.backup.kind === "local"
        ? new FolderTarget(config.backup.dir)
        : new S3Target(config.backup.s3),
    stateFile: join(stateDir, "backup.json"),
    ...(options.backupDelayMs !== undefined ? { delayMs: options.backupDelayMs } : {}),
    onResult: (state) => status.backedUp(state.lastSuccessAt, state.lastError),
  });
  files.onChange(() => backup.noteChange());
  const last = await backup.lastState();
  status.backedUp(last.lastSuccessAt, last.lastError);

  const aiLog = new AiLog(stateDir, () => backup.noteChange());
  const ai = new AiProvider({
    config,
    settings,
    log: aiLog,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const models = new ModelCatalogue(config, options.fetch);
  const changer = new EntryChanger({ git, index, drafts, status });
  const proposals = new ProposalStore({ stateDir, files, index, changer, status });
  await proposals.load();
  const fields = new FieldProposer({
    stateDir,
    files,
    index,
    settings,
    provider: ai,
    proposals,
    models,
    mayRead: (path) => quarantine.aiMayRead(path),
  });
  const quarantine = new Quarantine({
    stateDir,
    vaultDir,
    files,
    git,
    index,
    drafts,
    ...(options.settleMs !== undefined ? { settleMs: options.settleMs } : {}),
  });
  const search = new SearchIndex(index);
  const conversations = new Conversations(stateDir, files);
  const comments = new CommentStore(stateDir, files);
  const chronicles = new ChronicleStore({ vaultDir, git, index, drafts, changer });
  const characters = new CharacterTalk({
    index,
    search,
    provider: ai,
    settings,
    drafts,
    git,
    changer,
    chronicles,
    mayRead: (path) => quarantine.aiMayRead(path) === null,
  });
  const maps = new MapStore({
    vaultDir,
    iconFolder: config.iconFolder,
    git,
    index,
    drafts,
    changer,
  });
  const libraryFiles = new LibraryFileStore({ vaultDir, drafts });
  const folders = new FolderStore({ index, git, drafts, files: libraryFiles, changer });
  const discoverer = new Discoverer({
    stateDir,
    files,
    index,
    maps,
    chronicles,
    drafts,
    changer,
    provider: ai,
    settings,
    uploadFolder: config.uploadFolder,
    mayRead: (path) => quarantine.aiMayRead(path) === null,
  });
  const writing = new WritingHelper({
    index,
    search,
    provider: ai,
    settings,
    mayRead: (path) => quarantine.aiMayRead(path) === null,
  });
  const lore = new LoreAsker({
    index,
    search,
    provider: ai,
    settings,
    mayRead: (path) => quarantine.aiMayRead(path) === null,
  });
  await quarantine.load();
  const reportAi = async () => status.ai(await ai.ready("extraction"), ai.lastError);

  const services: Services = {
    config,
    git,
    index,
    status,
    files,
    settings,
    images,
    imageFetcher,
    drafts,
    backup,
    search,
    publisher: undefined as unknown as Publisher,
    branches: undefined as unknown as BranchInbox,
    ai,
    aiLog,
    models,
    changer,
    proposals,
    fields,
    fieldJob: new FieldJob(fields),
    quarantine,
    loginLimit: new LoginLimiter(),
    maps,
    chronicles,
    libraryFiles,
    folders,
    lore,
    writing,
    characters,
    discoverer,
    conversations,
    comments,
    async sync() {
      const result = await git.fetch();
      status.fetched(result.current);
      if (index.commit !== result.current) index.build(result.current);
      await quarantine.noteFetched(result.previous ?? result.current, result.current);
      await quarantine.refresh();
      maps.refresh();
      chronicles.refresh();
      libraryFiles.refresh();
      await services.publisher.clearPublished();
      await quarantine.prune();
      status.quarantine(quarantine.count(), [
        ...(quarantine.problem ? [quarantine.problem] : []),
        ...maps.problems.map((p) => `${p.path} is not shown as a map. ${p.message}`),
        ...chronicles.problems.map((p) => `${p.path} is not shown as a chronicle. ${p.message}`),
        ...libraryFiles.problems.map((p) => `${p.path} cannot be read. ${p.message}`),
      ]);
      await proposals.prune();
      status.inbox(await services.branches.count());
      status.indexed();
    },
  };
  services.branches = new BranchInbox({
    stateDir,
    files,
    git,
    index,
    drafts,
    sync: () => services.sync(),
  });
  await services.branches.load();
  services.publisher = new Publisher({
    vaultDir,
    git,
    index,
    drafts,
    status,
    libraryFiles,
    sync: () => services.sync(),
    reviews: {
      pendingDecisions: () => quarantine.pendingDecisions(),
      reviewFile: (ids) => quarantine.reviewFile(ids),
      reviewPath: REVIEW_FILE,
    },
    onPushed: (commit) => quarantine.notePushed(commit),
    onRenamed: async (from, to) => {
      await proposals.renamed(from, to);
      await comments.renamed(from, to);
    },
    onPublished: (paths) => {
      // Runs after the publish call has answered; a failure shows in the status area. When the
      // settings cannot be read at all, as when the server is stopping, the step is left out.
      void (async () => {
        if (!(await settings.read())?.ai.proposeOnPublish || !(await ai.ready("extraction")))
          return;
        for (const path of paths) {
          await fields.propose(path).catch(() => undefined);
        }
        await reportAi();
      })().catch(() => undefined);
    },
  });
  await reportAi();

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
  // One image per upload, up to 25 MB.
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

  app.addHook("onClose", async () => backup.stop());

  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0] ?? "";
    if (OPEN.has(path) || !path.startsWith("/api/")) return;
    if (request.session.get("user") !== "author") {
      throw new ApiError("unauthenticated", "Log in first.");
    }
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

  authRoutes(app, services);
  entryRoutes(app, services);
  graphRoutes(app, services);
  draftRoutes(app, services);
  imageRoutes(app, services);
  inboxRoutes(app, services);
  proposalRoutes(app, services);
  quarantineRoutes(app, services);
  settingsRoutes(app, services);
  passkeyRoutes(app, services);
  mapRoutes(app, services);
  chronicleRoutes(app, services);
  libraryFileRoutes(app, services);
  folderRoutes(app, services);
  loreRoutes(app, services);
  writingRoutes(app, services);
  commentRoutes(app, services);
  characterRoutes(app, services);
  discoverRoutes(app, services);
  exportRoutes(app, services);
  importRoutes(app, services);
  historyRoutes(app, services);
  searchRoutes(app, services);
  statusRoutes(app, services);
  webhookRoutes(app, services);

  return { app, services };
}
