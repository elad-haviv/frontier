import type { Health, StatusSnapshot } from "@frontier/schema";
import type { VaultIndex } from "../index/build.js";
import { outsideSavedView } from "../projects/view.js";

type Listener = (snapshot: StatusSnapshot) => void;

/**
 * What the snapshot says about one person (stage 31d): their own unsaved changes, and what they
 * may know of other people's work in progress. A snapshot is the project's; each person's stream
 * lays this over it.
 */
export type PersonalStatus = Pick<
  StatusSnapshot,
  "unpublished" | "conflicts" | "drafts" | "serverDraftChanges"
> & {
  keptCopies: number;
  othersUnsaved: NonNullable<StatusSnapshot["othersUnsaved"]>;
};

/** Holds the facts shown in the status area and tells listeners when one changes. */
export class StatusService {
  private lastFetchAt: string | null = null;
  private lastPushAt: string | null = null;
  private failedPush: string | null = null;
  private remoteCommit: string | null = null;
  private lastBackupAt: string | null = null;
  private backupError: string | null = null;
  private unpublished = 0;
  private conflicts = 0;
  private branches = 0;
  private operations = 0;
  private quarantined = 0;
  private fileProblems: string[] = [];
  private keysRemoved: { at: string; providers: string[]; environment: string[] } | null = null;
  private serverDraftChanges = 0;
  private commentChanges = 0;
  private commentPath: string | null = null;
  private listeners = new Set<Listener>();

  constructor(
    private readonly index: VaultIndex,
    private readonly facts: {
      library: StatusSnapshot["library"];
      backupOutside: boolean;
      /** How many drafts have texts kept from other devices. */
      keptCopies?: () => number;
      /** The draft store's count of draft writes and discards. */
      draftChanges?: () => number;
      /** What the snapshot says of one person's own work, and of other people's (stage 31d). */
      person?: (personId: string) => PersonalStatus;
      /** Who else is reading what, as this person is told. Asked for each time: it changes with every announcement. */
      presence?: (personId: string) => NonNullable<StatusSnapshot["presence"]>;
      /**
       * Changes whenever what `person` answers for anyone could: someone's unsaved changes, who the
       * members and their roles and names are, the library. Cheap to ask; with it a person's part is
       * worked out once for all their streams, and again only when this changes.
       */
      personVersion?: () => string;
    } = { library: "github", backupOutside: true },
  ) {}

  /** Rises when a fact of the project's own changes, so the part of the snapshot made of them is made again. */
  private rev = 0;
  /** The part of the snapshot that is the same for everyone, for the `rev` and build it was made at. */
  private shared: { key: string; value: StatusSnapshot } | null = null;
  /** Each person's part, for the version it was made at: many tabs of one person share it. */
  private personal = new Map<string, { version: string; value: PersonalStatus }>();

  snapshot(): StatusSnapshot {
    const key = `${this.rev}|${this.index.generation}|${this.index.commit}`;
    if (this.shared?.key !== key) this.shared = { key, value: this.makeShared() };
    const shared = this.shared.value;
    // What the person being served has of their own is asked for each time: it is cheap.
    return {
      ...shared,
      drafts: this.facts.draftChanges?.() ?? 0,
      attention: { ...shared.attention, keptCopies: this.facts.keptCopies?.() ?? 0 },
    };
  }

  private makeShared(): StatusSnapshot {
    const a = this.index.attention();
    return {
      library: this.facts.library,
      backupOutside: this.facts.backupOutside,
      lastFetchAt: this.lastFetchAt,
      lastPushAt: this.lastPushAt,
      failedPush: this.failedPush,
      unpublished: this.unpublished,
      conflicts: this.conflicts,
      indexCommit: this.index.commit,
      indexStale: this.remoteCommit !== null && this.index.commit !== this.remoteCommit,
      lastBackupAt: this.lastBackupAt,
      backupError: this.backupError,
      inbox: {
        branches: this.branches,
        operations: this.operations,
        quarantined: this.quarantined,
      },
      notices: { keysRemoved: this.keysRemoved },
      serverDraftChanges: this.serverDraftChanges,
      comments: { changes: this.commentChanges, path: this.commentPath },
      drafts: this.facts.draftChanges?.() ?? 0,
      problems: [
        ...(this.index.schemaProblem ? [this.index.schemaProblem] : []),
        ...(this.index.schemaNote ? [this.index.schemaNote] : []),
        ...this.fileProblems,
      ],
      attention: {
        ambiguousLinks: a.ambiguousLinks.length,
        duplicateImages: a.duplicateImages.length,
        mixedEndings: a.mixedEndings.length,
        brokenAppendixLinks: a.brokenAppendixLinks.length,
        nearFolderNotes: a.nearFolderNotes.length,
        unreadableFields: a.unreadableFields.length,
        duplicateIds: a.duplicateIds.length,
        keptCopies: this.facts.keptCopies?.() ?? 0,
      },
    };
  }

  /**
   * The snapshot as one person gets it: the project's, with their own unsaved changes in place of
   * whatever the last change left in the project's. A reader has none and sees nobody's: the caller
   * zeroes the lot (`routes/status.ts`).
   */
  snapshotFor(personId: string): StatusSnapshot {
    const base = this.snapshot();
    const mine = this.personalFor(personId);
    if (!mine) return base;
    const { keptCopies, ...rest } = mine;
    return {
      ...base,
      ...rest,
      presence: this.facts.presence?.(personId) ?? [],
      attention: { ...base.attention, keptCopies },
    };
  }

  /**
   * A person's own part of the snapshot, from the cache while nothing it is made of has changed.
   * Who is reading is not in it (it is cheap, and changes with every announcement), so it is asked
   * for each time.
   */
  private personalFor(personId: string): PersonalStatus | null {
    const person = this.facts.person;
    if (!person) return null;
    const version = this.facts.personVersion?.();
    if (version === undefined) return person(personId);
    const held = this.personal.get(personId);
    if (held?.version === version) return held.value;
    const value = person(personId);
    this.personal.set(personId, { version, value });
    return value;
  }

  /** Who is reading what changed: listeners are told, and nothing else is worked out again. */
  presenceChanged(): void {
    this.tell();
  }

  health(): Health {
    return {
      ok: this.index.commit !== null,
      indexCommit: this.index.commit,
      lastFetchAt: this.lastFetchAt,
      lastBackupAt: this.lastBackupAt,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.rev++;
    this.tell();
  }

  private tell(): void {
    if (this.listeners.size === 0) return;
    // The snapshot is shared by every listener, so it is never computed as a reader sees it, even
    // when a reader's request is what made the change.
    const snapshot = outsideSavedView(() => this.snapshot());
    for (const l of this.listeners) l(snapshot);
  }

  /** Records a fetch that reached the remote and found `main` at this commit. */
  fetched(commit: string, at = new Date()): void {
    this.lastFetchAt = at.toISOString();
    this.remoteCommit = commit;
    this.changed();
  }

  /** Called after the index was rebuilt. */
  indexed(): void {
    this.changed();
  }

  pushed(at = new Date()): void {
    this.lastPushAt = at.toISOString();
    this.failedPush = null;
    this.changed();
  }

  pushFailed(message: string): void {
    this.failedPush = message;
    this.changed();
  }

  backedUp(at: string | null, error: string | null): void {
    this.lastBackupAt = at ?? this.lastBackupAt;
    this.backupError = error;
    this.changed();
  }

  /** The number of agent branches waiting for the author. */
  inbox(branches: number): void {
    if (this.branches === branches) return;
    this.branches = branches;
    this.changed();
  }

  /** The number of quarantined notes waiting, and any trouble reading the list. */
  quarantine(count: number, problems: string[]): void {
    this.quarantined = count;
    this.fileProblems = problems;
    this.changed();
  }

  /** The number of AI-proposed operations waiting for the author. */
  proposals(operations: number): void {
    if (this.operations === operations) return;
    this.operations = operations;
    this.changed();
  }

  /** The notice that keys stored on the server were deleted, or null once it has been seen. */
  keysWereRemoved(notice: { at: string; providers: string[]; environment: string[] } | null): void {
    if (this.keysRemoved?.at === notice?.at) return;
    this.keysRemoved = notice;
    this.changed();
  }

  /** The server changed a draft itself, such as by accepting a proposed field into it. */
  serverChangedDraft(): void {
    this.serverDraftChanges++;
    this.changed();
  }

  /** An entry's shared comments changed: open pages read them again. The event says where, never what. */
  commentsChanged(path: string): void {
    this.commentChanges++;
    this.commentPath = path;
    this.changed();
  }

  drafts(unpublished: number, conflicts: number): void {
    this.unpublished = unpublished;
    this.conflicts = conflicts;
    this.changed();
  }
}
