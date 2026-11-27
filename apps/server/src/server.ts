import { join } from "node:path";
import type { Config } from "./config.js";
import { AiLog } from "./ai/log.js";
import { ModelCatalogue } from "./ai/models.js";
import { AiProvider } from "./ai/provider.js";
import { GoogleSignOn } from "./auth/google.js";
import { LoginLimiter } from "./auth/limit.js";
import { Mail } from "./mail/mailer.js";
import { InviteStore } from "./members/invites.js";
import { Turn } from "./members/join.js";
import { ImageFetcher, type FetchLimits, type Resolve } from "./images/fromUrl.js";
import { LiveRequests } from "./projects/live.js";
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
  /** Sign-on with Google; null when it is not configured (the buttons are then hidden). */
  google: GoogleSignOn | null;
  /** Invitation links, kept as hashes (stage 27c). */
  invites: InviteStore;
  /** Sending mail; `mail.enabled` is false when no relay is configured (stage 28). */
  mail: Mail;
  /** Mails per recipient address (confirm, invite, resend): a few an hour. */
  mailLimit: LoginLimiter;
  /** Resends of the confirm link, per account. */
  resendLimit: LoginLimiter;
  /** "Forgot password" requests, per network address and per typed address. */
  forgotIpLimit: LoginLimiter;
  forgotAddressLimit: LoginLimiter;
  /** Joins one after another: an invitation is used by one person even when two arrive together. */
  joins: Turn;
  /** The allowance of the public join and Google routes, counted by address, apart from logging in. */
  joinLimit: LoginLimiter;
  /** The requests each member has open in each project, cut when they are removed (stage 27c). */
  live: LiveRequests;
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

const HOUR = 60 * 60 * 1000;
/** An allowance per hour whose refusal reads the same for every address. */
const mailLimiter = (max: number) =>
  new LoginLimiter(
    max,
    HOUR,
    Date.now,
    undefined,
    "Too many requests. Try again in a few minutes.",
  );

/** Makes what is the server's. `registry` is set by the caller, which knows how a project is built. */
export function makeServer(config: Config, options: ServerOptions = {}): Server {
  const stateDir = join(config.dataDir, "state");
  const files = new StateFiles();
  const people = new PeopleStore(stateDir, files);
  const settings = new SettingsStore(
    stateDir,
    files,
    async (id) => (await people.get(id))?.admin === true,
  );
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
    people,
    loginLimit: new LoginLimiter(config.loginAttempts),
    projects: new ProjectStore(stateDir, files),
    google: config.google ? new GoogleSignOn(config.google, config.publicUrl) : null,
    invites: new InviteStore(stateDir, files),
    joins: new Turn(),
    mail: Mail.from(config.mail),
    mailLimit: mailLimiter(6),
    resendLimit: mailLimiter(5),
    forgotIpLimit: mailLimiter(10),
    forgotAddressLimit: mailLimiter(3),
    joinLimit: new LoginLimiter(config.loginAttempts * 6),
    live: new LiveRequests(),
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
