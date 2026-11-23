import type { Health, StatusSnapshot } from "@frontier/schema";
import type { VaultIndex } from "../index/build.js";

type Listener = (snapshot: StatusSnapshot) => void;

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
  private aiOn = false;
  private aiError: string | null = null;
  private serverDraftChanges = 0;
  private listeners = new Set<Listener>();

  constructor(
    private readonly index: VaultIndex,
    private readonly facts: {
      library: StatusSnapshot["library"];
      backupOutside: boolean;
      /** How many drafts have texts kept from other devices. */
      keptCopies?: () => number;
    } = { library: "github", backupOutside: true },
  ) {}

  snapshot(): StatusSnapshot {
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
      ai: { on: this.aiOn, lastError: this.aiError },
      serverDraftChanges: this.serverDraftChanges,
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
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
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

  ai(on: boolean, lastError: string | null): void {
    if (this.aiOn === on && this.aiError === lastError) return;
    this.aiOn = on;
    this.aiError = lastError;
    this.changed();
  }

  /** The server changed a draft itself, such as by accepting a proposed field into it. */
  serverChangedDraft(): void {
    this.serverDraftChanges++;
    this.changed();
  }

  drafts(unpublished: number, conflicts: number): void {
    this.unpublished = unpublished;
    this.conflicts = conflicts;
    this.changed();
  }
}
