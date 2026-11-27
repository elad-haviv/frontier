/**
 * Publish: turns drafts and rename intents into one commit on `main`.
 *
 * It works in two calls. `plan` fetches, sorts every selected draft into ready, a merge to confirm,
 * or a conflict, and returns that. `confirm` publishes what the author agreed to, and refuses if
 * `main` moved in between. Nothing is ever merged without the author having seen it.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AnyLibraryFile,
  type AuthorRef,
  chronicleIdOf,
  type DraftRecord,
  LIBRARY_FILES,
  libraryFileOf,
  makeId,
  mapIdOf,
  mergeChronicles,
  mergeMaps,
  parseChronicle,
  parseMap,
  type PublishPlan,
  mergeLibraryFile,
  parseLibraryFile,
  type RenameIntent,
  serialiseChronicle,
  serialiseLibraryFile,
  serialiseMap,
} from "@frontier/schema";
import {
  isNote,
  normaliseLineEndings,
  planRename,
  readFields,
  RenameError,
  restoreLineEndings,
} from "@frontier/vault";
import { ApiError } from "../errors.js";
import { GitError, type GitGateway } from "../git/gateway.js";
import type { VaultIndex } from "../index/build.js";
import type { DraftStore } from "../state/drafts.js";
import type { StatusService } from "../status/status.js";
import type { Authors } from "./authors.js";

type Plan = PublishPlan;
type Conflict = Plan["conflicts"][number];
type Merge = Plan["merges"][number];

interface Classified {
  draft: DraftRecord;
  text: string;
  outcome: "ready" | "merge" | "conflict";
  merge?: Merge;
  conflict?: Conflict;
  /** The blob of the file on `main` when the plan was made. */
  mainBlob: string | null;
}

interface StoredPlan {
  plan: Plan;
  /** Whose plan it is: nobody else can confirm it, or even know it is there. */
  person: string;
  createdAt: number;
  classified: Map<string, Classified>;
  renameIds: string[];
  decisionIds: string[];
}

interface Assembled {
  writes: { path: string; content: Buffer }[];
  deletes: string[];
  renames: Plan["renames"];
  blocked: Conflict[];
  groups: string[][];
}

const PLAN_LIFETIME_MS = 15 * 60 * 1000;

export interface PublisherDeps {
  vaultDir: string;
  git: GitGateway;
  index: VaultIndex;
  drafts: DraftStore;
  status: StatusService;
  /** Fetches `main`, rebuilds the index and clears finished drafts. */
  sync: () => Promise<void>;
  now?: () => number;
  /** The author's decisions about quarantined notes, published in the vault's review file. */
  reviews?: {
    pendingDecisions(): {
      id: string;
      path: string;
      decision: "accepted" | "reverted";
      draftId?: string | undefined;
    }[];
    reviewFile(ids: string[]): Buffer;
    reviewPath: string;
  };
  /** Told each commit Frontier pushes. */
  onPushed?: (commit: string) => Promise<void>;
  /** Told when a rename is found published, so that what is kept by path can follow. */
  onRenamed?: (from: string, to: string) => Promise<void>;
  /** What a library item file reads as while it exists neither as a draft nor in the library. */
  libraryFiles?: { missing(name: string): unknown };
  /** Tells who made a saved version, for the compare screen (stage 27d). */
  authors?: Authors;
}

/** How many of its own commits the publisher remembers, to tell its own from outside pushes. */
const OWN_COMMITS_KEPT = 500;

/** The library files whose items name paths, and so follow a rename. */
const FOLLOWING = LIBRARY_FILES.filter((k) => k.follow !== undefined);

export class Publisher {
  private plans = new Map<string, StoredPlan>();
  private readonly now: () => number;
  /** The commits this server made (saved versions, imports): `main` moving by these is not an outside push. */
  private readonly own = new Set<string>();
  /** Plans and saves go one after another: two people saving at once is two turns, not a race. */
  private turn: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: PublisherDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Runs `work` when every earlier plan and save is done. A failure does not hold up the next. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.turn.then(work, work);
    this.turn = run.catch(() => undefined);
    return run;
  }

  /** Notes a commit made by this server, such as an import, so a plan made before it is not refused for it. */
  noteOwnCommit(commit: string): void {
    this.own.add(commit);
    if (this.own.size > OWN_COMMITS_KEPT) this.own.delete(this.own.values().next().value!);
  }

  // ---- Clearing finished work ------------------------------------------------------------------

  /**
   * Removes drafts and rename intents that are already on `main`. Run after every fetch, this is
   * what makes a Publish safe to interrupt at any point: whatever reached `main` is cleared, and
   * whatever did not is still a draft.
   */
  async clearPublished(): Promise<void> {
    // Renames first: once a rename is on `main`, a draft of a file it moved belongs at the new path.
    // This is for everyone's work, not one person's (stage 27d): a rename one person saved moves the
    // drafts other people have of the file, so what they wrote follows it and is never lost.
    const has = (p: string) => this.d.index.files.some((f) => f === p || f.startsWith(p + "/"));
    const applied: { intent: RenameIntent; owner: string }[] = [];
    await this.d.drafts.eachPerson(async (owner) => {
      for (const intent of this.d.drafts.listRenames()) {
        if (has(intent.from) || !has(intent.to)) continue;
        applied.push({ intent, owner });
      }
    });
    if (applied.length > 0) {
      await this.d.drafts.eachPerson(async () => {
        for (const { intent } of applied) {
          for (const draft of this.d.drafts.list()) {
            const moved = movedPath(draft.path, intent.from, intent.to);
            if (moved !== null) await this.d.drafts.movePath(draft.id, moved);
          }
          // A file that names paths, such as the folder file, names the new ones from now on.
          for (const kind of FOLLOWING) {
            const draft = this.d.drafts.byPath(kind.path);
            if (!draft || draft.kind === "delete") continue;
            const text = await this.d.drafts.text(draft.id);
            const followed = follow(kind, text, intent.from, intent.to);
            if (followed !== null && followed !== text) {
              await this.d.drafts.serverChange(draft.id, followed);
            }
          }
        }
      });
      for (const { intent, owner } of applied) {
        await this.d.onRenamed?.(intent.from, intent.to);
        await this.d.drafts.as(owner, () => this.d.drafts.removeRename(intent.id));
      }
    }
    await this.d.drafts.eachPerson(async () => {
      for (const draft of this.d.drafts.list()) {
        const file = join(this.d.vaultDir, draft.path);
        const onMain = existsSync(file) ? readFileSync(file) : null;
        if (draft.kind === "delete") {
          if (onMain === null) await this.d.drafts.discard(draft.id);
          continue;
        }
        if (onMain === null) continue;
        const bytes = draft.binary
          ? await this.d.drafts.bytes(draft.id)
          : Buffer.from(restoreLineEndings(await this.d.drafts.text(draft.id), draft.lineEnding));
        if (bytes.equals(onMain) && !this.d.drafts.hasDeviceCopies(draft.id)) {
          await this.d.drafts.discard(draft.id);
        }
      }
    });
    this.d.status.drafts(this.d.drafts.count(), 0);
  }

  // ---- Sorting one draft ---------------------------------------------------------------------

  /**
   * Who saved the version of a file that is on `main` now, and when: the last version that touched
   * it, as the compare screen says "Wren saved this at ...". Null parts when that cannot be told.
   */
  private async savedBy(path: string): Promise<{ by: AuthorRef | null; at: string | null }> {
    const last = await this.d.git.lastChange(path).catch(() => null);
    if (!last) return { by: null, at: null };
    const by = this.d.authors
      ? await this.d.authors.resolve(last.author)
      : { id: null, name: last.author.name };
    return { by, at: last.at };
  }

  private async classify(draft: DraftRecord): Promise<Classified | null> {
    const { git } = this.d;
    /** Who saved `main`'s version, asked at most once and only when there is a clash to explain. */
    let saved: ReturnType<Publisher["savedBy"]> | undefined;
    const who = async () => {
      saved ??= this.savedBy(draft.path);
      const { by, at } = await saved;
      return { theirsBy: by, theirsAt: at };
    };
    if (draft.binary) {
      // A new image: ready unless a file took its name meanwhile.
      const existing = await git.readFile(draft.path);
      if (existing === null) return { draft, text: "", outcome: "ready", mainBlob: null };
      if (existing.equals(await this.d.drafts.bytes(draft.id))) return null;
      return {
        draft,
        text: "",
        outcome: "conflict",
        mainBlob: await git.blobHash(draft.path),
        conflict: {
          draftId: draft.id,
          path: draft.path,
          reason: "created_on_main",
          mine: "",
          theirs: null,
          base: null,
          ...(await who()),
        },
      };
    }
    const text = await this.d.drafts.text(draft.id);
    const mainBlob = await git.blobHash(draft.path);
    const mainBytes = mainBlob === null ? null : await git.readFile(draft.path);
    const mainText = mainBytes === null ? null : normaliseLineEndings(mainBytes.toString("utf8"));
    const conflict = async (reason: Conflict["reason"], base: string | null): Promise<Classified> => ({
      draft,
      text,
      outcome: "conflict",
      mainBlob,
      conflict: {
        draftId: draft.id,
        path: draft.path,
        reason,
        mine: text,
        theirs: mainText,
        base,
        ...(await who()),
      },
    });
    const baseText = async () => {
      const bytes = draft.baseBlob === "" ? null : await git.readBlob(draft.baseBlob);
      return bytes === null ? null : normaliseLineEndings(bytes.toString("utf8"));
    };

    if (draft.kind === "delete") {
      if (mainBlob === null) return null;
      if (mainBlob !== draft.baseBlob) return conflict("delete_of_changed_file", await baseText());
      return { draft, text, outcome: "ready", mainBlob };
    }

    if (draft.kind === "create") {
      if (mainText === null) return { draft, text, outcome: "ready", mainBlob };
      if (mainText === text) return null;
      return conflict("created_on_main", null);
    }

    if (mainText === null) return conflict("deleted_on_main", await baseText());
    if (mainText === text) return null;
    if (mainBlob === draft.baseBlob) return { draft, text, outcome: "ready", mainBlob };

    const base = await baseText();
    // Decision C: when someone else in the project saved the version this entry was changed from,
    // this change is not folded into theirs behind their back, clean or not: both are shown to the
    // person saving second, to compare. (A version from outside, or by this person on another
    // device, is merged as before.)
    if (isNote(draft.path)) {
      const saver = (await who()).theirsBy;
      if (saver?.id && saver.id !== this.d.drafts.personId()) {
        return conflict("saved_by_other", base);
      }
    }
    if (base === null) return conflict("overlap", null);
    // A structured file is merged item by item; a note line by line.
    const kind = fileKindOf(draft.path);
    const merged = kind
      ? kind.merge(base, text, mainText)
      : await git.mergeFile(text, base, mainText);
    if (!merged.clean) return conflict(kind ? kind.conflict : "overlap", base);
    if (merged.text === mainText) return null;
    return {
      draft,
      text,
      outcome: "merge",
      mainBlob,
      merge: {
        id: `m-${draft.id}`,
        draftId: draft.id,
        path: draft.path,
        mergedText: merged.text,
        mainText,
        baseText: base,
        ...(await who()),
      },
    };
  }

  // ---- Putting the commit together -----------------------------------------------------------

  /**
   * Works out the files to write and delete for a set of drafts and renames.
   * `texts` gives the text to publish for each included draft.
   */
  private async assemble(
    included: { draft: DraftRecord; text: string }[],
    renames: RenameIntent[],
  ): Promise<Assembled> {
    const { index, git } = this.d;
    const files = new Set(index.files);
    /** New text of notes, by their path after all moves. */
    const texts = new Map<string, string>();
    /** Files moved without a change to their content: new path -> path on `main`. */
    const carried = new Map<string, string>();
    /** For each changed note, the path on `main` its line endings come from. */
    const origin = new Map<string, string>();
    const draftAt = new Map<string, DraftRecord>();
    const removed = new Set<string>();
    /** New files that are not text, by their path after all moves. */
    const images = new Map<string, DraftRecord>();

    for (const { draft, text } of included) {
      if (draft.binary) {
        files.add(draft.path);
        images.set(draft.path, draft);
      } else if (draft.kind === "delete") {
        files.delete(draft.path);
        removed.add(draft.path);
      } else {
        files.add(draft.path);
        texts.set(draft.path, text);
        draftAt.set(draft.path, draft);
      }
    }

    const textOf = (path: string): string =>
      texts.get(path) ?? index.note(carried.get(path) ?? path)?.text ?? "";

    const summaries: Plan["renames"] = [];
    const blocked: Conflict[] = [];
    const groups: string[][] = [];

    for (const intent of renames) {
      const block = (message: string) =>
        blocked.push({
          draftId: intent.id,
          path: intent.from,
          reason: "rename_blocked",
          mine: message,
          theirs: null,
          base: null,
        });
      let plan;
      try {
        plan = planRename(intent.from, intent.to, files, textOf);
      } catch (err) {
        if (!(err instanceof RenameError)) throw err;
        block(err.message);
        continue;
      }
      const mixed = plan.edits.find(
        (e) =>
          !texts.has(e.path) && index.note(carried.get(e.path) ?? e.path)?.lineEnding === "mixed",
      );
      if (mixed) {
        block(
          `"${mixed.path}" links to it and mixes two kinds of line endings, so it cannot be rewritten.`,
        );
        continue;
      }

      const touched = new Set<string>([
        ...plan.edits.map((e) => e.path),
        ...plan.moves.map((m) => m.from),
      ]);
      const group = [
        intent.id,
        ...included.filter((i) => touched.has(i.draft.path)).map((i) => i.draft.id),
      ];
      if (group.length > 1) groups.push(group);
      summaries.push({
        id: intent.id,
        from: intent.from,
        to: intent.to,
        affected: plan.edits.map((e) => e.path),
      });

      for (const edit of plan.edits) {
        if (!origin.has(edit.path)) origin.set(edit.path, carried.get(edit.path) ?? edit.path);
        texts.set(edit.path, edit.text);
        carried.delete(edit.path);
      }
      for (const move of plan.moves) {
        files.delete(move.from);
        files.add(move.to);
        if (index.hasFile(move.from)) removed.add(move.from);
        if (images.has(move.from)) {
          images.set(move.to, images.get(move.from)!);
          images.delete(move.from);
        } else if (texts.has(move.from)) {
          texts.set(move.to, texts.get(move.from)!);
          texts.delete(move.from);
          origin.set(move.to, origin.get(move.from) ?? move.from);
          origin.delete(move.from);
          const draft = draftAt.get(move.from);
          if (draft) {
            draftAt.set(move.to, draft);
            draftAt.delete(move.from);
          }
        } else {
          carried.set(move.to, carried.get(move.from) ?? move.from);
          carried.delete(move.from);
        }
      }
    }

    // A file that names paths follows the renames into the same commit: its draft when one is
    // included, else the library's copy, else the file as it reads in memory (written now).
    if (summaries.length > 0) {
      for (const kind of FOLLOWING) {
        const draft = included.find((i) => i.draft.path === kind.path && i.draft.kind !== "delete");
        const onMain = index.hasFile(kind.path) ? await git.readFile(kind.path) : null;
        const missing = this.d.libraryFiles?.missing(kind.name);
        const before =
          draft?.text ??
          onMain?.toString("utf8") ??
          (missing === undefined ? null : serialiseLibraryFile(kind, missing));
        if (before === null) continue;
        let after: string | null = before;
        for (const r of summaries)
          after = after === null ? null : follow(kind, after, r.from, r.to);
        if (after !== null && (after !== before || draft)) texts.set(kind.path, after);
      }
    }

    const writes: Assembled["writes"] = [];
    for (const [path, text] of texts) {
      const draft = draftAt.get(path);
      const from = origin.get(path) ?? path;
      const ending = draft
        ? draft.lineEnding
        : index.note(from)?.lineEnding === "crlf"
          ? "crlf"
          : "lf";
      const content = Buffer.from(restoreLineEndings(text, ending));
      const current = index.hasFile(path) && !removed.has(path) ? await git.readFile(path) : null;
      if (current === null || !current.equals(content)) writes.push({ path, content });
    }
    for (const [path, draft] of images) {
      writes.push({ path, content: await this.d.drafts.bytes(draft.id) });
    }
    for (const [to, from] of carried) {
      const content = await git.readFile(from);
      if (content !== null) writes.push({ path: to, content });
    }
    const written = new Set(writes.map((w) => w.path));
    const deletes = [...removed].filter(
      (p) => index.hasFile(p) && !written.has(p) && !files.has(p),
    );

    return { writes, deletes, renames: summaries, blocked, groups };
  }

  /**
   * The notes a rename would rewrite, given every current draft and every other rename but the
   * one it replaces, if any. Throws ApiError when it cannot be done.
   */
  async previewRename(intent: RenameIntent, replacing?: string): Promise<string[]> {
    const included = await Promise.all(
      this.d.drafts.list().map(async (draft) => ({
        draft,
        text: draft.binary ? "" : await this.d.drafts.text(draft.id),
      })),
    );
    const earlier = this.d.drafts
      .listRenames()
      .filter((r) => r.id !== intent.id && r.id !== replacing);
    const result = await this.assemble(included, [...earlier, intent]);
    const block = result.blocked.find((b) => b.draftId === intent.id);
    if (block) throw new ApiError("invalid", block.mine);
    return result.renames.find((r) => r.id === intent.id)?.affected ?? [];
  }

  // ---- The two calls -------------------------------------------------------------------------

  plan(draftIds: string[], renameIds: string[], decisionIds: string[] = []): Promise<Plan> {
    return this.serial(() => this.makePlan(draftIds, renameIds, decisionIds));
  }

  /**
   * What saving one unsaved change would do now, for a compare screen: `ready`, a `merge` to confirm,
   * a `conflict` with the other version, who saved it and when, or `none`.
   */
  compare(draftId: string): Promise<{ outcome: "ready" | "merge" | "conflict" | "none"; c: Classified | null; draft: DraftRecord }> {
    return this.serial(async () => {
      const draft = this.d.drafts.get(draftId);
      if (!draft) throw new ApiError("not_found", "There is no such draft.");
      await this.d.sync();
      // A draft cleared by the fetch is on `main` already: nothing differs.
      const now = this.d.drafts.get(draftId);
      if (!now) return { outcome: "none" as const, c: null, draft };
      const c = await this.classify(now);
      return { outcome: c === null ? ("none" as const) : c.outcome, c, draft: now };
    });
  }

  private async makePlan(
    draftIds: string[],
    renameIds: string[],
    decisionIds: string[],
  ): Promise<Plan> {
    await this.d.sync();
    const mainCommit = this.d.index.commit;
    /* c8 ignore next */
    if (mainCommit === null) throw new ApiError("git_busy", "The vault has not been read yet.");

    const classified = new Map<string, Classified>();
    for (const id of draftIds) {
      const draft = this.d.drafts.get(id);
      // A draft cleared by the fetch above is already on `main`; it simply drops out of the plan.
      if (!draft) continue;
      if (this.d.drafts.hasDeviceCopies(id)) {
        throw new ApiError(
          "invalid",
          `"${draft.path}" has texts from other devices to compare. Merge them first.`,
        );
      }
      const c = await this.classify(draft);
      if (c === null) await this.d.drafts.discard(id);
      else classified.set(id, c);
    }

    const intents = renameIds
      .map((id) => this.d.drafts.getRename(id))
      .filter((r): r is RenameIntent => r !== undefined);
    const candidates = [...classified.values()]
      .filter((c) => c.outcome !== "conflict")
      .map((c) => ({ draft: c.draft, text: c.merge?.mergedText ?? c.text }));
    const preview = await this.assemble(candidates, intents);
    // Which changes belong together is worked out over every selected draft, conflicted ones
    // included: a rename must wait for a conflicted draft of a note it would rewrite.
    const everything = [...classified.values()].map((c) => ({
      draft: c.draft,
      text: c.merge?.mergedText ?? c.text,
    }));
    const groups = (await this.assemble(everything, intents)).groups;
    // The files accepted from one agent branch go out together or not at all, selected or not.
    const byBranch = new Map<string, string[]>();
    for (const draft of this.d.drafts.list()) {
      for (const origin of draft.origins) {
        if (origin.kind !== "branch") continue;
        byBranch.set(origin.ref, [...(byBranch.get(origin.ref) ?? []), draft.id]);
      }
    }
    for (const ids of byBranch.values()) {
      if (ids.length > 1 && ids.some((id) => classified.has(id))) groups.push(ids);
    }
    // A map and the draft that writes an id its features name go out together, so a map never
    // reaches `main` pointing at an id that is not there.
    const idDrafts = new Map<string, string>();
    for (const draft of this.d.drafts.list()) {
      if (draft.binary || draft.kind === "delete" || !isNote(draft.path)) continue;
      const id = readFields(await this.d.drafts.text(draft.id)).id;
      if (id && !this.d.index.hasId(id)) idDrafts.set(id, draft.id);
    }
    if (idDrafts.size > 0) {
      for (const c of classified.values()) {
        const kind = fileKindOf(c.draft.path);
        if (!kind || c.draft.kind === "delete") continue;
        for (const entry of kind.entryIds(c.merge?.mergedText ?? c.text)) {
          const writer = idDrafts.get(entry);
          if (writer) groups.push([c.draft.id, writer]);
        }
      }
    }
    // A rename and the draft of a file that names paths go together, since the rename rewrites it.
    for (const kind of FOLLOWING) {
      const draft = this.d.drafts.byPath(kind.path);
      if (!draft) continue;
      for (const intent of intents) groups.push([intent.id, draft.id]);
    }
    // A revert and the draft that undoes the note are one change.
    // A revert that makes a draft is the unsaved change of whoever decided it: it is saved by them.
    const decisions = (this.d.reviews?.pendingDecisions() ?? []).filter(
      (d) =>
        decisionIds.includes(d.id) &&
        (!d.draftId || !this.d.drafts.existsAny(d.draftId) || this.d.drafts.get(d.draftId)),
    );
    for (const d of decisions) if (d.draftId) groups.push([d.id, d.draftId]);

    const all = [...classified.values()];
    const plan: Plan = {
      planId: makeId(randomBytes),
      mainCommit,
      ready: all.filter((c) => c.outcome === "ready").map((c) => c.draft.id),
      merges: all.flatMap((c) => (c.merge ? [c.merge] : [])),
      conflicts: [...all.flatMap((c) => (c.conflict ? [c.conflict] : [])), ...preview.blocked],
      renames: preview.renames,
      groups,
      decisions: decisions.map((d) => ({
        id: d.id,
        path: d.path,
        decision: d.decision,
        ...(d.draftId ? { draftId: d.draftId } : {}),
      })),
    };

    for (const [id, stored] of this.plans) {
      if (this.now() - stored.createdAt > PLAN_LIFETIME_MS) this.plans.delete(id);
    }
    this.plans.set(plan.planId, {
      plan,
      person: this.d.drafts.personId(),
      createdAt: this.now(),
      classified,
      renameIds: intents.map((r) => r.id),
      decisionIds: decisions.map((d) => d.id),
    });
    this.d.drafts.noteConflicts(plan.conflicts.length);
    this.d.status.drafts(this.d.drafts.count(), plan.conflicts.length);
    return plan;
  }

  /**
   * Saves the plan as one commit by `author`, or by the configured author when none is given. Plans
   * and saves go one after another, and a save is the person's own: someone else's plan is as good
   * as unknown. Entries someone else saved a newer version of since the plan was made are left out
   * (and reported); everything else in the save goes in.
   */
  confirm(
    planId: string,
    confirmedMergeIds: string[],
    message: string,
    author?: { name: string; email: string },
    /**
     * Told the notes whose own draft was just published. The caller passes it to the browser,
     * which asks for field proposals with its own AI key: the server has none (stage 27f).
     */
    onPublished?: (paths: string[]) => void,
  ): Promise<{ commit: string; conflicts: Conflict[] }> {
    return this.serial(() => this.save(planId, confirmedMergeIds, message, author, onPublished));
  }

  private async save(
    planId: string,
    confirmedMergeIds: string[],
    message: string,
    author?: { name: string; email: string },
    onPublished?: (paths: string[]) => void,
  ): Promise<{ commit: string; conflicts: Conflict[] }> {
    const stored = this.plans.get(planId);
    if (
      !stored ||
      stored.person !== this.d.drafts.personId() ||
      this.now() - stored.createdAt > PLAN_LIFETIME_MS
    ) {
      // Another person's plan is answered as one that is not there.
      if (stored && stored.person === this.d.drafts.personId()) this.plans.delete(planId);
      throw new ApiError(
        "plan_expired",
        "This publish plan is more than 15 minutes old. Start again.",
      );
    }

    await this.d.sync();
    // `main` moved since the plan. When only saves made here moved it (another person's, in a library
    // several people write to), the plan is still good for every file those saves did not touch:
    // each is checked below, and only a file that changed is held back. A push from outside is not
    // that: the author reviews again, as before.
    const moved = this.d.index.commit !== stored.plan.mainCommit;
    if (moved && !(await this.movedByUs(stored.plan.mainCommit))) {
      this.plans.delete(planId);
      throw new ApiError(
        "main_moved",
        "The vault changed on GitHub since you reviewed this. Review again.",
      );
    }

    const confirmed = new Set(confirmedMergeIds);
    const usable = (c: Classified) =>
      c.outcome === "ready" || (c.outcome === "merge" && confirmed.has(c.merge!.id));
    // A draft may have been edited or discarded since the plan was made; such drafts are left out.
    let current = [...stored.classified.values()].filter((c) => {
      const now = this.d.drafts.get(c.draft.id);
      return now !== undefined && now.revision === c.draft.revision;
    });
    // Entries whose saved version is no longer the one the plan looked at are refused and reported.
    const refused: Conflict[] = [];
    if (moved) {
      const stillGood: Classified[] = [];
      for (const c of current) {
        const blob = await this.d.git.blobHash(c.draft.path);
        if (blob === c.mainBlob) {
          stillGood.push(c);
          continue;
        }
        const again = await this.classify(c.draft);
        // Nothing differs any more: it is on `main` already, and goes away with the next sync.
        if (again === null) continue;
        if (again.outcome === "ready") {
          stored.classified.set(c.draft.id, again);
          stillGood.push(again);
          continue;
        }
        refused.push(refusal(again));
      }
      current = stillGood;
    }
    const held = new Set<string>([
      ...[...stored.classified.values()]
        .filter((c) => !current.includes(c) || !usable(c))
        .map((c) => c.draft.id),
      ...refused.map((r) => r.draftId),
      ...stored.plan.conflicts.filter((c) => c.reason === "rename_blocked").map((c) => c.draftId),
    ]);
    // A group member that was not selected for this plan holds its group back.
    for (const group of stored.plan.groups) {
      for (const id of group) {
        const known =
          stored.classified.has(id) ||
          stored.renameIds.includes(id) ||
          stored.decisionIds.includes(id);
        if (!known) held.add(id);
      }
    }
    // Changes that depend on each other are published together or not at all.
    for (let changed = true; changed;) {
      changed = false;
      for (const group of stored.plan.groups) {
        if (group.some((id) => held.has(id)) && group.some((id) => !held.has(id))) {
          for (const id of group) held.add(id);
          changed = true;
        }
      }
    }

    const included = current.filter((c) => !held.has(c.draft.id));
    const intents = stored.renameIds
      .filter((id) => !held.has(id))
      .map((id) => this.d.drafts.getRename(id))
      .filter((r): r is RenameIntent => r !== undefined);
    const decided = (this.d.reviews?.pendingDecisions() ?? []).filter(
      (d) => stored.decisionIds.includes(d.id) && !held.has(d.id),
    );
    if (included.length === 0 && intents.length === 0 && decided.length === 0) {
      const first = refused[0];
      if (first) {
        this.plans.delete(planId);
        const who = first.theirsBy?.name ?? "Someone";
        throw new ApiError(
          "saved_by_other",
          `${who} saved a newer version of "${first.path}"${refused.length > 1 ? ` and ${refused.length - 1} more` : ""} while you were looking. Nothing was saved: compare and save again.`,
        );
      }
      throw new ApiError("invalid", "Nothing in this plan can be published yet.");
    }

    // A merge the author confirmed becomes the draft itself before anything is pushed, so that a
    // stop after the push leaves a draft that equals `main` and is cleared like any other.
    const publishing: { draft: DraftRecord; text: string }[] = [];
    for (const c of included) {
      if (c.merge) {
        const rebased = await this.d.drafts.rebase(
          c.draft.id,
          c.merge.mergedText,
          c.mainBlob ?? "",
          true,
        );
        publishing.push({ draft: rebased, text: c.merge.mergedText });
      } else {
        publishing.push({ draft: c.draft, text: c.text });
      }
    }

    const result = await this.assemble(publishing, intents);
    if (result.blocked.length > 0) {
      throw new ApiError(
        "invalid",
        `A rename can no longer be carried out: ${result.blocked[0]!.mine}`,
      );
    }
    if (decided.length > 0 && this.d.reviews) {
      result.writes.push({
        path: this.d.reviews.reviewPath,
        content: this.d.reviews.reviewFile(decided.map((d) => d.id)),
      });
    }
    if (result.writes.length === 0 && result.deletes.length === 0) {
      await this.d.sync();
      throw new ApiError("invalid", "Everything in this plan is already published.");
    }

    const commit = await this.d.git.commit(
      { writes: result.writes, deletes: result.deletes },
      message + trailers(publishing.map((p) => p.draft)),
      author,
    );
    try {
      await this.d.git.push(commit);
    } catch (err) {
      if (err instanceof GitError) this.d.status.pushFailed(err.message);
      throw err;
    }
    this.noteOwnCommit(commit);
    await this.d.onPushed?.(commit);
    this.d.status.pushed(new Date(this.now()));
    this.plans.delete(planId);
    await this.d.sync();
    onPublished?.(
      publishing
        .filter((p) => !p.draft.binary && p.draft.kind !== "delete")
        .map((p) =>
          intents.reduce((path, r) => movedPath(path, r.from, r.to) ?? path, p.draft.path),
        ),
    );
    return { commit, conflicts: refused };
  }

  /** Whether every save since `from` was made by this server: `main` moved by us and nobody else. */
  private async movedByUs(from: string): Promise<boolean> {
    const between = await this.d.git.commitsBetween(from, this.d.index.commit ?? "HEAD").catch(() => null);
    return between !== null && between.length > 0 && between.every((c) => this.own.has(c.commit));
  }
}

/** A plan's classification of one draft as the conflict shape the person is shown. */
function refusal(c: Classified): Conflict {
  if (c.conflict) return c.conflict;
  const m = c.merge!;
  return {
    draftId: m.draftId,
    path: m.path,
    reason: "overlap",
    mine: c.text,
    theirs: m.mainText,
    base: m.baseText,
    ...(m.theirsBy !== undefined ? { theirsBy: m.theirsBy } : {}),
    ...(m.theirsAt !== undefined ? { theirsAt: m.theirsAt } : {}),
  };
}

/**
 * A structured file kept in the library beside the notes. Each kind says which paths are its own,
 * how two versions merge, and which entry ids a text names, so that a file and the draft that
 * writes an id it names are saved together.
 */
interface FileKind {
  mine(path: string): boolean;
  conflict: Conflict["reason"];
  merge(base: string, mine: string, theirs: string): { clean: boolean; text: string };
  entryIds(text: string): string[];
}

const FILE_KINDS: FileKind[] = [
  {
    mine: (path) => mapIdOf(path) !== null,
    conflict: "map_changed_on_both",
    merge(base, mine, theirs) {
      const b = parseMap(base);
      const m = parseMap(mine);
      const t = parseMap(theirs);
      // A clash, or text that is no map, is not clean.
      if (!b.ok || !m.ok || !t.ok) return { clean: false, text: mine };
      const merged = mergeMaps(b.map, m.map, t.map);
      return { clean: merged.clashes.length === 0, text: serialiseMap(merged.map) };
    },
    entryIds(text) {
      const parsed = parseMap(text);
      return parsed.ok ? parsed.map.features.flatMap((f) => (f.entry ? [f.entry] : [])) : [];
    },
  },
  {
    mine: (path) => chronicleIdOf(path) !== null,
    conflict: "chronicle_changed_on_both",
    merge(base, mine, theirs) {
      const b = parseChronicle(base);
      const m = parseChronicle(mine);
      const t = parseChronicle(theirs);
      if (!b.ok || !m.ok || !t.ok) return { clean: false, text: mine };
      const merged = mergeChronicles(b.chronicle, m.chronicle, t.chronicle);
      return { clean: merged.clashes.length === 0, text: serialiseChronicle(merged.chronicle) };
    },
    entryIds(text) {
      const parsed = parseChronicle(text);
      return parsed.ok ? parsed.chronicle.spans.flatMap((sp) => (sp.entry ? [sp.entry] : [])) : [];
    },
  },
];

/** Every library item file merges the same way, item by item, through its kind's key. */
for (const kind of LIBRARY_FILES) {
  FILE_KINDS.push({
    mine: (path) => libraryFileOf(path) === kind,
    conflict: kind.conflict,
    merge(base, mine, theirs) {
      const b = parseLibraryFile(kind, base);
      const m = parseLibraryFile(kind, mine);
      const t = parseLibraryFile(kind, theirs);
      if (!b.ok || !m.ok || !t.ok) return { clean: false, text: mine };
      const merged = mergeLibraryFile(kind, b.file, m.file, t.file);
      return { clean: merged.clashes.length === 0, text: serialiseLibraryFile(kind, merged.file) };
    },
    // Library files name no entries.
    entryIds: () => [],
  });
}

const fileKindOf = (path: string): FileKind | undefined => FILE_KINDS.find((k) => k.mine(path));

/** A library file's text after a rename, or null when the text is not such a file. */
function follow(kind: AnyLibraryFile, text: string, from: string, to: string): string | null {
  const parsed = parseLibraryFile(kind, text);
  if (!parsed.ok) return null;
  return serialiseLibraryFile(kind, kind.follow!(parsed.file, from, to));
}

/**
 * Lines at the end of the commit message that name where accepted content came from: the agent's
 * branch, or the proposal and model of Frontier's own AI.
 */
export function trailers(drafts: DraftRecord[]): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    for (const origin of draft.origins) {
      const key = `${origin.kind}:${origin.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`Frontier-Proposal: ${origin.ref}`);
      if (origin.kind === "fields" || origin.kind === "lore") {
        lines.push(`Frontier-Model: ${origin.model}`);
      }
    }
  }
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

/** Where a path ends up after a rename of `from` to `to`, or null when the rename does not move it. */
export function movedPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  if (!path.startsWith(from + "/")) return null;
  const rest = path.slice(from.length + 1);
  const oldName = from.split("/").pop()!;
  const newName = to.split("/").pop()!;
  // A folder note follows its folder's name.
  return `${to}/${rest === `${oldName}.md` ? `${newName}.md` : rest}`;
}

export { isNote };
