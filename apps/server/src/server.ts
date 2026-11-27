import { join } from "node:path";
import type { Config } from "./config.js";
import { AiLog } from "./ai/log.js";
import { ModelCatalogue } from "./ai/models.js";
import { AiProvider } from "./ai/provider.js";
import { LoginLimiter } from "./auth/limit.js";
import { ImageFetcher, type FetchLimits, type Resolve } from "./images/fromUrl.js";
import { ProjectStore } from "./projects/store.js";
import { StateFiles } from "./state/files.js";
import { PeopleStore } from "./state/people.js";
import { SettingsStore } from "./state/settings.js";
import type { ProjectRegistry } from "./projects/registry.js";

/**
 * What belongs to the whole server rather than to one project: who has an account, how many login
 * attempts an address has used, the list of projects, the AI settings and the AI provider (which
 * hold no project's data: a key and a model go with each call), and the one-time notice about
 * keys. A project's services refer to it, and each is made by the registry.
 */
export interface Server {
  config: Config;
  /** The files of `/data/state` that are the server's (see `projects/layout.ts`). */
  files: StateFiles;
  /** Everyone who has an account (stage 27a). */
  people: PeopleStore;
  loginLimit: LoginLimiter;
  /** Every project and its members (stage 27b). */
  projects: ProjectStore;
  /** Per-person AI choices and the rules for Keep going. */
  settings: SettingsStore;
  ai: AiProvider;
  aiLog: AiLog;
  models: ModelCatalogue;
  /** Takes images from web addresses, with the safeguards that keep the server's network safe. */
  imageFetcher: ImageFetcher;
  /** Opens a project's services when first used, and closes them. Set once the server is built. */
  registry: ProjectRegistry;
  /** The notice that stored keys were deleted, until someone clears it. */
  keysRemoved: { at: string; providers: string[]; environment: string[] } | null;
}

export interface ServerOptions {
  /** Stands in for the network in tests of the AI provider. */
  fetch?: typeof fetch;
  /** Stands in for DNS when tests take an image from a web address. */
  resolveHost?: Resolve;
  /** Shorter limits for taking an image from a web address, for tests. */
  imageFetchLimits?: Partial<FetchLimits>;
}

/** Makes what is the server's. `registry` is set by the caller, which knows how a project is built. */
export function makeServer(config: Config, options: ServerOptions = {}): Server {
  const stateDir = join(config.dataDir, "state");
  const files = new StateFiles();
  const settings = new SettingsStore(stateDir, files);
  // The spending log is written by many requests; the backup of the folder it lives in is told.
  const aiLog = new AiLog(stateDir, () => files.touch());
  const ai = new AiProvider({
    config,
    settings,
    log: aiLog,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const models = new ModelCatalogue({
    connections: ai.connections,
    settings,
    openrouterUrl: config.openrouterUrl,
  });
  ai.useCatalog(models);
  return {
    config,
    files,
    people: new PeopleStore(stateDir, files),
    loginLimit: new LoginLimiter(config.loginAttempts),
    projects: new ProjectStore(stateDir, files),
    settings,
    ai,
    aiLog,
    models,
    imageFetcher: new ImageFetcher({
      publicUrl: config.publicUrl,
      allowLoopback: config.imageFetchAllowLoopback,
      ...(options.resolveHost ? { resolve: options.resolveHost } : {}),
      ...(options.imageFetchLimits ? { limits: options.imageFetchLimits } : {}),
    }),
    registry: undefined as unknown as ProjectRegistry,
    keysRemoved: null,
  };
}
