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
import { type DraftRecord, makeId, type PublishPlan, type RenameIntent } from "@frontier/schema";
import {
  isNote,
  normaliseLineEndings,
  planRename,
  RenameError,
  restoreLineEndings,
} from "@frontier/vault";
import { ApiError } from "../errors.js";
import { GitError, type GitGateway } from "../git/gateway.js";
import type { VaultIndex } from "../index/build.js";
import type { DraftStore } from "../state/drafts.js";
import type { StatusService } from "../status/status.js";

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
  createdAt: number;
  classified: Map<string, Classified>;
  renameIds: string[];
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
}

export class Publisher {
  private plans = new Map<string, StoredPlan>();
  private readonly now: () => number;

  constructor(private readonly d: PublisherDeps) {
    this.now = d.now ?? Date.now;
  }

  // ---- Clearing finished work ------------------------------------------------------------------

  /**
   * Removes drafts and rename intents that are already on `main`. Run after every fetch, this is
   * what makes a Publish safe to interrupt at any point: whatever reached `main` is cleared, and
   * whatever did not is still a draft.
   */
  async clearPublished(): Promise<void> {
    // Renames first: once a rename is on `main`, a draft of a file it moved belongs at the new path.
    const has = (p: string) => this.d.index.files.some((f) => f === p || f.startsWith(p + "/"));
    for (const intent of this.d.drafts.listRenames()) {
      if (has(intent.from) || !has(intent.to)) continue;
      for (const draft of this.d.drafts.list()) {
        const moved = movedPath(draft.path, intent.from, intent.to);
        if (moved !== null) await this.d.drafts.movePath(draft.id, moved);
      }
      await this.d.drafts.removeRename(intent.id);
    }
    for (const draft of this.d.drafts.list()) {
      const file = join(this.d.vaultDir, draft.path);
      const onMain = existsSync(file) ? readFileSync(file) : null;
      if (draft.kind === "delete") {
        if (onMain === null) await this.d.drafts.discard(draft.id);
        continue;
      }
      if (onMain === null) continue;
      const bytes = Buffer.from(
        restoreLineEndings(await this.d.drafts.text(draft.id), draft.lineEnding),
      );
      if (bytes.equals(onMain) && !this.d.drafts.hasSecondVersion(draft.id)) {
        await this.d.drafts.discard(draft.id);
      }
    }
    this.d.status.drafts(this.d.drafts.count(), 0);
  }

  // ---- Sorting one draft ---------------------------------------------------------------------

  private async classify(draft: DraftRecord): Promise<Classified | null> {
    const { git } = this.d;
    const text = await this.d.drafts.text(draft.id);
    const mainBlob = await git.blobHash(draft.path);
    const mainBytes = mainBlob === null ? null : await git.readFile(draft.path);
    const mainText = mainBytes === null ? null : normaliseLineEndings(mainBytes.toString("utf8"));
    const conflict = (reason: Conflict["reason"], base: string | null): Classified => ({
      draft,
      text,
      outcome: "conflict",
      mainBlob,
      conflict: { draftId: draft.id, path: draft.path, reason, mine: text, theirs: mainText, base },
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
    if (base === null) return conflict("overlap", null);
    const merged = await git.mergeFile(text, base, mainText);
    if (!merged.clean) return conflict("overlap", base);
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

    for (const { draft, text } of included) {
      if (draft.kind === "delete") {
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
        if (texts.has(move.from)) {
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

  /** The notes a rename would rewrite, given every current draft. Throws ApiError when it cannot be done. */
  async previewRename(intent: RenameIntent): Promise<string[]> {
    const included = await Promise.all(
      this.d.drafts
        .list()
        .map(async (draft) => ({ draft, text: await this.d.drafts.text(draft.id) })),
    );
    const earlier = this.d.drafts.listRenames().filter((r) => r.id !== intent.id);
    const result = await this.assemble(included, [...earlier, intent]);
    const block = result.blocked.find((b) => b.draftId === intent.id);
    if (block) throw new ApiError("invalid", block.mine);
    return result.renames.find((r) => r.id === intent.id)?.affected ?? [];
  }

  // ---- The two calls -------------------------------------------------------------------------

  async plan(draftIds: string[], renameIds: string[]): Promise<Plan> {
    await this.d.sync();
    const mainCommit = this.d.index.commit;
    /* c8 ignore next */
    if (mainCommit === null) throw new ApiError("git_busy", "The vault has not been read yet.");

    const classified = new Map<string, Classified>();
    for (const id of draftIds) {
      const draft = this.d.drafts.get(id);
      // A draft cleared by the fetch above is already on `main`; it simply drops out of the plan.
      if (!draft) continue;
      if (this.d.drafts.hasSecondVersion(id)) {
        throw new ApiError(
          "invalid",
          `"${draft.path}" has two versions from two devices. Merge them first.`,
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

    const all = [...classified.values()];
    const plan: Plan = {
      planId: makeId(randomBytes),
      mainCommit,
      ready: all.filter((c) => c.outcome === "ready").map((c) => c.draft.id),
      merges: all.flatMap((c) => (c.merge ? [c.merge] : [])),
      conflicts: [...all.flatMap((c) => (c.conflict ? [c.conflict] : [])), ...preview.blocked],
      renames: preview.renames,
      groups,
    };

    for (const [id, stored] of this.plans) {
      if (this.now() - stored.createdAt > PLAN_LIFETIME_MS) this.plans.delete(id);
    }
    this.plans.set(plan.planId, {
      plan,
      createdAt: this.now(),
      classified,
      renameIds: intents.map((r) => r.id),
    });
    this.d.status.drafts(this.d.drafts.count(), plan.conflicts.length);
    return plan;
  }

  async confirm(planId: string, confirmedMergeIds: string[], message: string): Promise<string> {
    const stored = this.plans.get(planId);
    if (!stored || this.now() - stored.createdAt > PLAN_LIFETIME_MS) {
      this.plans.delete(planId);
      throw new ApiError(
        "plan_expired",
        "This publish plan is more than 15 minutes old. Start again.",
      );
    }

    await this.d.sync();
    if (this.d.index.commit !== stored.plan.mainCommit) {
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
    const current = [...stored.classified.values()].filter((c) => {
      const now = this.d.drafts.get(c.draft.id);
      return now !== undefined && now.revision === c.draft.revision;
    });
    const held = new Set<string>([
      ...[...stored.classified.values()]
        .filter((c) => !current.includes(c) || !usable(c))
        .map((c) => c.draft.id),
      ...stored.plan.conflicts.filter((c) => c.reason === "rename_blocked").map((c) => c.draftId),
    ]);
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
    if (included.length === 0 && intents.length === 0) {
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
    if (result.writes.length === 0 && result.deletes.length === 0) {
      await this.d.sync();
      throw new ApiError("invalid", "Everything in this plan is already published.");
    }

    const commit = await this.d.git.commit(
      { writes: result.writes, deletes: result.deletes },
      message,
    );
    try {
      await this.d.git.push(commit);
    } catch (err) {
      if (err instanceof GitError) this.d.status.pushFailed(err.message);
      throw err;
    }
    this.d.status.pushed(new Date(this.now()));
    this.plans.delete(planId);
    await this.d.sync();
    return commit;
  }
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
