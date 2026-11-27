/**
 * One set of services for one project, made by one factory (stage 31b). Everything that belongs
 * to a library is made here: the Git gateway, the index, drafts, the publisher, comments, pins,
 * maps, chronicles, images, the inbox, conversations, the status stream, the backup and its
 * timers. What belongs to the whole server (accounts, the AI settings and provider, the list of
 * projects) is on `Server` and only referred to.
 *
 * No service made here is given a path outside the project's folder (`layout.ts`), except the
 * first project's `state/`, which the server's own files share.
 */
import { join } from "node:path";
import type { BiomesFile, ProjectRecord } from "@frontier/schema";
import type { AiProvider } from "../ai/provider.js";
import type { AiLog } from "../ai/log.js";
import type { ModelCatalogue } from "../ai/models.js";
import type { BackupTarget } from "../backup/targets.js";
import { GitGateway } from "../git/gateway.js";
import type { ImageFetcher } from "../images/fromUrl.js";
import type { Server } from "../server.js";
import { StateFiles } from "../state/files.js";
import type { SettingsStore } from "../state/settings.js";
import { type ProjectPaths, pathsOf } from "./layout.js";
import { startPolling } from "../git/poll.js";
import { FieldProposer } from "../ai/fields.js";
import { ChronicleStore } from "../chronicles/store.js";
import { MapStore } from "../maps/store.js";
import { FolderStore } from "../folders/store.js";
import { LibraryFileStore } from "../library/files.js";
import { Conversations } from "../ai/conversations.js";
import { Talks } from "../ai/talks.js";
import { EntryPictures } from "../ai/pictures.js";
import { EntryDrafter } from "../ai/draftEntry.js";
import { LoreAsker } from "../ai/lore.js";
import { KeepGoingAi } from "../ai/keepGoing.js";
import { KeepGoingHistory } from "../keepGoing/history.js";
import { PinStore } from "../keepGoing/pins.js";
import { KeepGoing } from "../keepGoing/service.js";
import { CommentStore } from "../comments/store.js";
import { ConsultStore } from "../consults/store.js";
import { Discoverer } from "../ai/discover.js";
import { CharacterTalk } from "../ai/characters.js";
import { WritingHelper } from "../ai/writing.js";
import { EditReviewer } from "../ai/review.js";
import { Backup } from "../backup/backup.js";
import { EntryChanger } from "../entries/change.js";
import { ProposalStore } from "../proposals/store.js";
import { Quarantine, REVIEW_FILE } from "../quarantine/quarantine.js";
import type { Config } from "../config.js";
import { appTokenSource } from "../git/appAuth.js";
import { ImageServer } from "../images/serve.js";
import { BranchInbox } from "../inbox/branches.js";
import { Publisher } from "../publish/publish.js";
import { Authors } from "../publish/authors.js";
import { DraftStore } from "../state/drafts.js";
import { VaultIndex } from "../index/build.js";
import { SearchIndex } from "../index/search.js";
import { StatusService } from "../status/status.js";
import { SummaryWriter } from "./summary.js";
import { displayName } from "../members/names.js";
import { Presence } from "./presence.js";

export interface Services {
  config: Config;
  git: GitGateway;
  index: VaultIndex;
  status: StatusService;
  files: StateFiles;
  settings: SettingsStore;
  /** What is the whole server's, not this project's: the accounts, the project list, the AI. */
  server: Server;
  /** The project's record as it was when its services were made. */
  project: ProjectRecord;
  /** Where the project's files are. */
  paths: ProjectPaths;
  images: ImageServer;
  /** Takes images from web addresses, with the safeguards that keep the server's network safe. */
  imageFetcher: ImageFetcher;
  drafts: DraftStore;
  /** Who is reading which entry now; in memory only (stage 31d). */
  presence: Presence;
  publisher: Publisher;
  /** Who made each saved version: people who are or were members of this project (stage 31d). */
  authors: Authors;
  branches: BranchInbox;
  ai: AiProvider;
  aiLog: AiLog;
  models: ModelCatalogue;
  changer: EntryChanger;
  proposals: ProposalStore;
  fields: FieldProposer;
  quarantine: Quarantine;
  maps: MapStore;
  chronicles: ChronicleStore;
  /** Library item files, such as the folder file, through one store. */
  libraryFiles: LibraryFileStore;
  folders: FolderStore;
  lore: LoreAsker;
  drafter: EntryDrafter;
  /** Stage 25: the work queue, "From here", Link it, random entry and the steps after Publish. */
  keepGoing: KeepGoing;
  keepGoingHistory: KeepGoingHistory;
  keepGoingAi: KeepGoingAi;
  pins: PinStore;
  writing: WritingHelper;
  review: EditReviewer;
  characters: CharacterTalk;
  discoverer: Discoverer;
  conversations: Conversations;
  /** Each person's conversations with characters (stage 27, see `ai/talks.ts`). */
  talks: Talks;
  /** Pictures made for entries, kept as each person's tries until one is inserted. */
  pictures: EntryPictures;
  comments: CommentStore;
  consults: ConsultStore;
  backup: Backup;
  search: SearchIndex;
  /** Fetches `main`, resets the working copy and rebuilds the index. */
  sync(): Promise<void>;
  /**
   * Clones the library when it is not here yet, reads it, and starts what runs by itself: the
   * nightly backup, and the timer fetch of a library others write to. Once.
   */
  bringUp(): Promise<void>;
  /** Stops the timers and watchers. Called when the project is closed, and when the server is. */
  close(): Promise<void>;
}

/** What the factory is given besides the project and the server. */
export interface ServicesOptions {
  /** Where backups go; each project writes under its own prefix. */
  target: BackupTarget;
  /** Used by tests to watch Git commands. */
  onGitCommand?: (args: readonly string[]) => void;
  /** How long after a change the backup runs. Tests shorten it. */
  backupDelayMs?: number;
  /** How long a note from outside is kept from AI features. Tests shorten it. */
  settleMs?: number;
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

/**
 * The folders of a project to back up, each under a name, and the prefix they go under in the
 * target. The first project is the old layout and its backup keeps the old keys (`latest/state`,
 * `latest/library`), which also hold the server's own files; a project made since goes under
 * `projects/<id>/`.
 */
export function backupPlan(
  dataDir: string,
  record: Pick<ProjectRecord, "id" | "layout">,
  own: boolean,
): { sources: Record<string, string>; prefix: string } {
  if (record.layout === "legacy") return { sources: backupSources(dataDir, own), prefix: "" };
  const paths = pathsOf(dataDir, record);
  return {
    sources: {
      state: paths.state,
      generated: join(paths.assets, "generated"),
      library: paths.library,
    },
    prefix: `projects/${record.id}/`,
  };
}

/** A target that keeps everything under a prefix, so two projects' backups never meet. */
export class PrefixedTarget implements BackupTarget {
  constructor(
    private readonly inner: BackupTarget,
    private readonly prefix: string,
  ) {}
  put(key: string, data: Buffer): Promise<void> {
    return this.inner.put(this.prefix + key, data);
  }
  get(key: string): Promise<Buffer | null> {
    return this.inner.get(this.prefix + key);
  }
  async list(prefix: string): Promise<string[]> {
    return (await this.inner.list(this.prefix + prefix)).map((k) => k.slice(this.prefix.length));
  }
  remove(key: string): Promise<void> {
    return this.inner.remove(this.prefix + key);
  }
}

/**
 * Makes the services of one project. The caller decides when to clone and sync (`bringUp`); the
 * first project of a test is brought up by hand.
 */
export async function buildServices(
  server: Server,
  record: ProjectRecord,
  options: ServicesOptions,
): Promise<Services> {
  const dataDir = server.config.dataDir;
  const paths = pathsOf(dataDir, record);
  const legacy = record.layout === "legacy";
  // A project made since projects are always an own library; the first one is the server's
  // configured way to run, with the repository and credentials it was configured with.
  const kind = legacy ? server.config.library : "own";
  const config: Config = legacy
    ? { ...server.config, library: kind }
    : {
        ...server.config,
        library: kind,
        remoteUrl: paths.library,
        githubApp: null,
        githubToken: null,
        iconFolder: record.iconFolder ?? server.config.iconFolder,
      };
  const vaultDir = paths.vault;
  const stateDir = paths.state;

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
  const roleOf = (personId: string) => server.projects.roleOfSync(record.id, personId);
  const nameOf = (personId: string) => displayName(server.people.getSync(personId));
  const status = new StatusService(index, {
    library: config.library,
    backupOutside: config.backup.kind === "s3",
    // Read only when a snapshot is made, after the draft store below exists.
    keptCopies: () => drafts.keptCount(),
    draftChanges: () => drafts.changes,
    // Each person's stream is told their own unsaved changes, and what others have in progress.
    person: (personId) =>
      drafts.as(personId, () => ({
        unpublished: drafts.count(),
        conflicts: drafts.conflictCount(),
        drafts: drafts.changes,
        serverDraftChanges: drafts.serverChanges(),
        keptCopies: drafts.keptCount(),
        // Only entries the person can see: published ones, and ones they have a draft of. The path
        // of someone's unsaved new entry is theirs to tell.
        othersUnsaved: [...drafts.othersUnsaved()]
          .filter(([path]) => index.hasFile(path) || drafts.byPath(path) !== undefined)
          .map(([path, people]) => ({ path, people })),
      })),
    presence: (personId) => presence.readingFor(personId),
    // Everything a person's part is made of, as one number: it is worked out again only when this changes.
    personVersion: () =>
      `${drafts.generation}|${index.generation}|${index.commit}|${server.projects
        .membersSync(record.id)
        .map((m) => `${m.personId}:${m.role}:${nameOf(m.personId)}`)
        .join(",")}`,
  });
  const presence = new Presence({ roleOf, nameOf, onChange: () => status.presenceChanged() });
  const files = new StateFiles();
  const { settings, ai, aiLog, models, imageFetcher } = server;
  const images = new ImageServer(vaultDir, paths.root);
  // The accounts and the project's members are read before anything asks who the first owner is (see
  // `firstOwner`): an empty list of members that is only not read yet must never name anyone.
  await server.people.all();
  await server.projects.all();
  /**
   * Whose a draft or rename without an owner is, and whom a call outside any request speaks for: the
   * server's first account when it is an owner of the project, else the project's earliest owner by
   * date joined. A project with no owner to name (no member yet, before the first request claims it)
   * has none, and what needs one waits.
   */
  const firstOwner = (): string | null => {
    const owners = server.projects
      .membersSync(record.id)
      .filter((m) => m.role === "owner")
      .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
    const admin = server.people.adminIdSync();
    if (admin && owners.some((m) => m.personId === admin)) return admin;
    return owners[0]?.personId ?? null;
  };
  const drafts = new DraftStore(stateDir, files, { legacyOwner: firstOwner, roleOf, nameOf });
  await drafts.load();
  const plan = backupPlan(dataDir, record, kind === "own");
  const backup = new Backup({
    sources: plan.sources,
    target: plan.prefix ? new PrefixedTarget(options.target, plan.prefix) : options.target,
    stateFile: join(stateDir, "backup.json"),
    ...(options.backupDelayMs !== undefined ? { delayMs: options.backupDelayMs } : {}),
    onResult: (state) => status.backedUp(state.lastSuccessAt, state.lastError),
  });
  files.onChange(() => backup.noteChange());
  // The first project's backup also holds the server's own files (accounts, settings, the project
  // list, the spending log), which live in the same folder.
  const unwatchServer = legacy ? server.files.onChange(() => backup.noteChange()) : () => undefined;
  const last = await backup.lastState();
  status.backedUp(last.lastSuccessAt, last.lastError);
  status.keysWereRemoved(server.keysRemoved);

  // Only the first project has data from before projects, and it belongs to the first account.
  const legacyOwner = legacy ? () => server.people.adminIdSync() : () => null;
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
  const conversations = new Conversations(stateDir, files, legacyOwner);
  const talks = new Talks(stateDir, files, legacyOwner);
  const comments = new CommentStore(stateDir, files, {
    legacyOwner: firstOwner,
    nameOf,
    // Open pages are told that an entry's comments changed, never what they say.
    onChange: (path) => status.commentsChanged(path),
  });
  await comments.load();
  const consults = new ConsultStore(stateDir, files);
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
    biomes: () => {
      try {
        return (libraryFiles.current("biomes").file as BiomesFile).biomes;
      } catch {
        return [];
      }
    },
  });
  const pictures = new EntryPictures({
    dir: join(paths.assets, "generated", "entries"),
    files,
    settings,
    log: aiLog,
    provider: ai,
    saving: { index, drafts, config, status },
  });
  const writing = new WritingHelper({
    index,
    search,
    provider: ai,
    settings,
    mayRead: (path) => quarantine.aiMayRead(path) === null,
  });
  const review = new EditReviewer({
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
  const drafter = new EntryDrafter({
    index,
    search,
    provider: ai,
    settings,
    mayRead: (path) => quarantine.aiMayRead(path) === null,
  });
  const keepGoingHistory = new KeepGoingHistory({ git, index });
  const keepGoing = new KeepGoing({
    index,
    drafts,
    comments,
    settings,
    folders,
    changer,
    status,
    history: keepGoingHistory,
  });
  const keepGoingAi = new KeepGoingAi({
    index,
    provider: ai,
    drafts,
    drafter,
    files,
    stateDir,
    legacyOwner,
    textOf: (path) => changer.text(path),
    mayRead: (path) => quarantine.aiMayRead(path) === null,
  });
  const pins = new PinStore({
    index,
    drafts,
    files: libraryFiles,
    state: files,
    stateDir,
    legacyOwner,
  });
  await quarantine.load();

  const summary = new SummaryWriter(stateDir);
  let brought: Promise<void> | undefined;
  let stopPolling: () => void = () => undefined;
  let sweep: NodeJS.Timeout | null = null;
  const isMember = (personId: string) => roleOf(personId) !== null;
  const tidyAway = () =>
    drafts
      .tidyAway(isMember)
      .catch((err: unknown) => console.error("Sweep of unsaved changes failed", err));
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  /** Fetches `main`, rebuilds the index and clears what reached it: see `services.sync`. */
  const runSync = async (): Promise<void> => {
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
    // The project list counts from this small file, so it never has to open the project.
    await summary.noteIndexed(services);
  };
  const services: Services = {
    config,
    git,
    index,
    status,
    files,
    settings,
    server,
    project: record,
    paths,
    images,
    imageFetcher,
    drafts,
    presence,
    backup,
    search,
    publisher: undefined as unknown as Publisher,
    authors: new Authors(server.people, (personId) =>
      server.projects.everMemberSync(record.id, personId),
    ),
    branches: undefined as unknown as BranchInbox,
    ai,
    aiLog,
    models,
    changer,
    proposals,
    fields,
    quarantine,
    maps,
    chronicles,
    libraryFiles,
    folders,
    lore,
    drafter,
    keepGoing,
    keepGoingHistory,
    keepGoingAi,
    pins,
    writing,
    review,
    characters,
    discoverer,
    conversations,
    talks,
    pictures,
    comments,
    consults,
    async bringUp() {
      brought ??= (async () => {
        await git.ensureClone();
        await services.sync();
        // The unsaved changes of people who left more than 30 days ago go now and every few hours.
        await tidyAway();
        sweep = setInterval(() => void tidyAway(), 6 * 60 * 60 * 1000);
        sweep.unref();
        backup.startNightly();
        // Only a library that others write to has anything new to fetch.
        if (config.library === "github") {
          stopPolling = startPolling(services.sync, (err) =>
            console.error("Timer fetch failed", err),
          );
        }
      })();
      return brought;
    },
    async close() {
      // First of all: a request still running must not write into a folder about to be moved.
      files.close();
      images.close();
      backup.retire();
      stopPolling();
      if (sweep) clearInterval(sweep);
      presence.close();
      unwatchServer();
      summary.close();
    },
    sync() {
      // One at a time: the clearing of finished work and the rebuild of the index must not run twice
      // at once (polling, a webhook, an import and a save all ask). A call made while one is running
      // waits for a run that starts after the call, since the running one may have fetched before
      // whatever made the call (a push) happened; calls that arrive together share that one run.
      if (!running) {
        running = runSync().finally(() => (running = null));
        return running;
      }
      queued ??= running
        .catch(() => undefined)
        .then(() => {
          queued = null;
          running = runSync().finally(() => (running = null));
          return running;
        });
      return queued;
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
    authors: services.authors,
    sync: () => services.sync(),
    reviews: {
      pendingDecisions: () => quarantine.pendingDecisions(),
      reviewFile: (ids) => quarantine.reviewFile(ids),
      reviewPath: REVIEW_FILE,
    },
    onPushed: (commit) => quarantine.notePushed(commit),
    onRenamed: async (from, to) => {
      // A device still holding the old path is told where its changes go (stage 15c).
      await drafts.noteRenamed(from, to);
      await proposals.renamed(from, to);
      await comments.renamed(from, to);
      await consults.renamed(from, to);
      await pins.renamed(from, to);
    },
  });

  return services;
}
