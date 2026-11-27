/**
 * Notes that reached `main` without the author's review. The sync decides which notes those are
 * and lists them in the vault; Frontier shows them, records the author's decision and publishes
 * it. Frontier never works out who pushed, and never writes to the memory bank.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Id, type InboxQuarantined, makeId, VaultPath } from "@frontier/schema";
import { detectLineEnding, isNote, normaliseLineEndings } from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { GitGateway } from "../git/gateway.js";
import type { VaultIndex } from "../index/build.js";
import type { DraftStore } from "../state/drafts.js";
import type { StateFiles } from "../state/files.js";

export const QUARANTINE_FILE = ".frontier/quarantine.json";
export const REVIEW_FILE = ".frontier/review-state.json";

/** How long a note that just arrived from outside is kept away from AI features. */
export const SETTLE_MS = 3 * 60 * 1000;

const Listed = z.object({
  path: VaultPath,
  commit: z.string().regex(/^[0-9a-f]{7,64}$/),
  pushedBy: z.string().default("unknown"),
  at: z.string().default(""),
});
type Listed = z.infer<typeof Listed>;
const QuarantineList = z.object({ version: z.literal(1), notes: z.array(Listed) });

const Decision = z.object({
  path: VaultPath,
  commit: z.string(),
  decision: z.enum(["accepted", "reverted"]),
  at: z.string(),
});
type Decision = z.infer<typeof Decision>;
const ReviewState = z.object({ version: z.literal(1), decisions: z.array(Decision) });

const Pending = Decision.extend({ id: Id, draftId: Id.optional() });
export type PendingDecision = z.infer<typeof Pending>;

const Settling = z.array(z.object({ path: z.string(), until: z.number() }));

export interface QuarantineDeps {
  stateDir: string;
  vaultDir: string;
  files: StateFiles;
  git: GitGateway;
  index: VaultIndex;
  drafts: DraftStore;
  now?: () => number;
  /** How long a note from outside settles. Tests shorten it. */
  settleMs?: number;
}

const same = (a: { path: string; commit: string }, b: { path: string; commit: string }) =>
  a.path === b.path && a.commit === b.commit;

export class Quarantine {
  private listed: Listed[] = [];
  private published: Decision[] = [];
  private pending: PendingDecision[] = [];
  private pushed: string[] = [];
  private settling: { path: string; until: number }[] = [];
  /** Why a list file in the vault could not be read, in words. */
  problem: string | null = null;
  private readonly now: () => number;
  private readonly dir: string;

  constructor(private readonly d: QuarantineDeps) {
    this.now = d.now ?? Date.now;
    this.dir = join(d.stateDir, "quarantine");
  }

  async load(): Promise<void> {
    this.pending =
      (await this.d.files.readJson(join(this.dir, "pending.json"), z.array(Pending))) ?? [];
    this.pushed =
      (await this.d.files.readJson(join(this.d.stateDir, "pushed.json"), z.array(z.string()))) ??
      [];
    this.settling = (await this.d.files.readJson(join(this.dir, "settling.json"), Settling)) ?? [];
  }

  private readVaultJson<T>(file: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T | null {
    const full = join(this.d.vaultDir, file);
    if (!existsSync(full)) return null;
    try {
      return schema.parse(JSON.parse(readFileSync(full, "utf8")));
    } catch {
      this.problem = `${file} cannot be read, so it is treated as empty.`;
      return null;
    }
  }

  /** Reads the two list files from the working copy. Called after every fetch. */
  async refresh(): Promise<void> {
    this.problem = null;
    this.listed = this.readVaultJson(QUARANTINE_FILE, QuarantineList)?.notes ?? [];
    this.published = this.readVaultJson(REVIEW_FILE, ReviewState)?.decisions ?? [];
    // A decision that is on `main` now is no longer waiting to be published.
    const left = this.pending.filter((p) => !this.published.some((d) => same(d, p)));
    if (left.length !== this.pending.length) {
      this.pending = left;
      await this.savePending();
    }
  }

  private savePending(): Promise<void> {
    return this.d.files.writeJson(join(this.dir, "pending.json"), this.pending);
  }

  private decisionFor(entry: Listed): Decision | PendingDecision | undefined {
    return this.pending.find((p) => same(p, entry)) ?? this.published.find((p) => same(p, entry));
  }

  /** The quarantine entry of a note that still waits for the author, if any. */
  waiting(path: string): Listed | undefined {
    return this.listed.find((e) => e.path === path && !this.decisionFor(e));
  }

  /** How many notes wait for a decision. */
  count(): number {
    return this.listed.filter((e) => !this.decisionFor(e)).length;
  }

  pendingDecisions(): PendingDecision[] {
    return [...this.pending];
  }

  // ---- What AI features may read -------------------------------------------------------------

  /** Why AI features may not read this note right now, or null when they may. */
  aiMayRead(path: string): string | null {
    const entry = this.listed.find((e) => e.path === path);
    if (entry) {
      const released = this.published.some((d) => same(d, entry) && d.decision === "accepted");
      if (!released) return "This note arrived unreviewed. Accept or revert it in the inbox first.";
    }
    if (this.settling.some((s) => s.path === path && s.until > this.now())) {
      return "This note just arrived. Try again in a few minutes.";
    }
    return null;
  }

  /** Records a commit Frontier pushed itself, so its notes do not settle. */
  async notePushed(commit: string): Promise<void> {
    this.pushed = [...this.pushed, commit].slice(-200);
    await this.d.files.writeJson(join(this.d.stateDir, "pushed.json"), this.pushed);
  }

  /** After a fetch that moved `main`: notes changed by commits from outside settle for a while. */
  async noteFetched(previous: string, current: string): Promise<void> {
    const now = this.now();
    const before = this.settling.length;
    this.settling = this.settling.filter((s) => s.until > now);
    let changed = this.settling.length !== before;
    if (previous !== current) {
      for (const { commit, paths } of await this.d.git.commitsBetween(previous, current)) {
        if (this.pushed.includes(commit)) continue;
        for (const path of paths) {
          if (!isNote(path)) continue;
          this.settling = this.settling.filter((s) => s.path !== path);
          this.settling.push({ path, until: now + (this.d.settleMs ?? SETTLE_MS) });
          changed = true;
        }
      }
    }
    if (changed) await this.d.files.writeJson(join(this.dir, "settling.json"), this.settling);
  }

  // ---- Showing and deciding ------------------------------------------------------------------

  private async texts(entry: Listed): Promise<{ before: string | null; after: string | null }> {
    const read = async (commit: string) => {
      const bytes = await this.d.git.readFile(entry.path, commit).catch(() => null);
      return bytes ? normaliseLineEndings(bytes.toString("utf8")) : null;
    };
    return { before: await read(`${entry.commit}^`), after: await read(entry.commit) };
  }

  /** Why a note can only be accepted, or null when it can also be reverted. */
  private async revertBlocked(entry: Listed, after: string | null): Promise<string | null> {
    if (this.d.drafts.byPath(entry.path)) {
      return "You have an unpublished change to this note. Publish or discard it first.";
    }
    const onMain = this.d.index.note(entry.path);
    if (after !== null && !onMain) return "This note is no longer at this path.";
    if (after === null && onMain) return "A note was written at this path since.";
    if (onMain?.lineEnding === "mixed") return "This file mixes two kinds of line endings.";
    return null;
  }

  /** Every listed note that the sync has not released, with what the author can do. */
  async list(): Promise<InboxQuarantined[]> {
    const out: InboxQuarantined[] = [];
    for (const entry of this.listed) {
      const decided = this.decisionFor(entry);
      // Published decisions wait only for the sync to shorten its list; nothing is left to do.
      if (decided && !("id" in decided)) continue;
      const { before, after } = await this.texts(entry).catch(() => ({
        before: null,
        after: null,
      }));
      const blocked = await this.revertBlocked(entry, after);
      out.push({
        path: entry.path,
        commit: entry.commit,
        pushedBy: entry.pushedBy,
        at: entry.at,
        kind: before === null ? "added" : after === null ? "removed" : "changed",
        before,
        after,
        ...(blocked ? { revertBlocked: blocked } : {}),
        ...(decided && "id" in decided
          ? { pending: { id: decided.id, decision: decided.decision } }
          : {}),
      });
    }
    return out;
  }

  async decide(
    path: string,
    commit: string,
    decision: "accepted" | "reverted",
  ): Promise<PendingDecision> {
    const entry = this.listed.find((e) => same(e, { path, commit }));
    if (!entry || this.decisionFor(entry)) {
      throw new ApiError("not_found", "This note is not waiting for a decision.");
    }
    const record: PendingDecision = {
      id: makeId(randomBytes),
      path,
      commit,
      decision,
      at: new Date(this.now()).toISOString(),
    };

    if (decision === "reverted") {
      const { before, after } = await this.texts(entry);
      const blocked = await this.revertBlocked(entry, after);
      if (blocked) throw new ApiError("not_allowed", blocked);
      const raw = (await this.d.git.readFile(path, `${commit}^`))?.toString("utf8") ?? "";
      const draftId = makeId(randomBytes);
      // The base is the note as the unreviewed commit left it, so Publish merges the undo with
      // whatever was done to the note since.
      const baseBlob = after === null ? "" : ((await this.d.git.blobHash(path, commit)) ?? "");
      await this.d.drafts.saveFrom({
        id: draftId,
        path,
        kind: before === null ? "delete" : after === null ? "create" : "edit",
        content: before ?? "",
        baseBlob,
        lineEnding: detectLineEnding(raw) === "crlf" ? "crlf" : "lf",
      });
      record.draftId = draftId;
    }
    this.pending.push(record);
    await this.savePending();
    return record;
  }

  /** Takes a decision back before it is published, with the draft a revert made. */
  async withdraw(id: string): Promise<void> {
    const record = this.pending.find((p) => p.id === id);
    if (!record) throw new ApiError("not_found", "This decision is not waiting to be published.");
    // A revert's unsaved text is the person's who decided it (stage 31d): nobody else withdraws it.
    if (
      record.draftId &&
      this.d.drafts.existsAny(record.draftId) &&
      !this.d.drafts.get(record.draftId)
    ) {
      throw new ApiError("not_found", "This decision is not waiting to be published.");
    }
    if (record.draftId && this.d.drafts.get(record.draftId)) {
      await this.d.drafts.discard(record.draftId);
    }
    this.pending = this.pending.filter((p) => p.id !== id);
    await this.savePending();
  }

  /** A revert whose draft was discarded on its own is no revert any more. */
  async prune(): Promise<void> {
    const left = this.pending.filter(
      // Whoever's it is: this runs for the whole project, not for a person (stage 31d).
      (p) => p.decision !== "reverted" || !p.draftId || this.d.drafts.existsAny(p.draftId),
    );
    if (left.length !== this.pending.length) {
      this.pending = left;
      await this.savePending();
    }
  }

  /** The review file as it should be on `main` once these pending decisions are published. */
  reviewFile(ids: string[]): Buffer {
    const chosen = this.pending.filter((p) => ids.includes(p.id));
    const decisions = [
      ...this.published,
      ...chosen.map(({ path, commit, decision, at }) => ({
        path,
        commit,
        decision,
        at,
      })),
    ]
      // Once the sync has dropped a note from its list, the decision has done its work.
      .filter((d) => this.listed.some((e) => same(e, d)));
    return Buffer.from(JSON.stringify({ version: 1, decisions }, null, 2) + "\n");
  }
}
