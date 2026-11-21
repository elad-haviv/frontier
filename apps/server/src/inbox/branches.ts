/**
 * Agents' proposal branches, shown as files the author accepts or rejects one by one. An accepted
 * file becomes a draft; nothing here writes to `main`.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { type BranchFile, type InboxBranch, makeId } from "@frontier/schema";
import {
  basename,
  detectLineEnding,
  isEditable,
  isExcluded,
  isImage,
  isNote,
  normaliseLineEndings,
} from "@frontier/vault";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { GitGateway } from "../git/gateway.js";
import type { VaultIndex } from "../index/build.js";
import type { DraftStore } from "../state/drafts.js";
import type { StateFiles } from "../state/files.js";

const MAX_FILES = 200;

const Records = z.record(
  z.object({
    tip: z.string(),
    files: z.record(z.object({ decision: z.enum(["accepted", "rejected"]), blob: z.string() })),
    /** Set when every file is decided and removing the branch failed. */
    removeFailed: z.boolean().optional(),
  }),
);
type Records = z.infer<typeof Records>;

export interface BranchInboxDeps {
  stateDir: string;
  files: StateFiles;
  git: GitGateway;
  index: VaultIndex;
  drafts: DraftStore;
  /** Fetches `main` and the proposal branches. */
  sync(): Promise<void>;
}

function decodeUtf8(bytes: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export class BranchInbox {
  private records: Records = {};
  private readonly file: string;

  constructor(private readonly d: BranchInboxDeps) {
    this.file = join(d.stateDir, "inbox", "branches.json");
  }

  async load(): Promise<void> {
    this.records = (await this.d.files.readJson(this.file, Records)) ?? {};
  }

  private save(): Promise<void> {
    return this.d.files.writeJson(this.file, this.records);
  }

  /** Why a file can only be rejected, or null when it can be accepted. */
  private async blocked(
    path: string,
    kind: BranchFile["kind"],
    tip: string,
  ): Promise<string | null> {
    if (isExcluded(path)) return "Agents do not change these folders.";
    const note = isNote(path);
    if (!note && !(isImage(path) && kind === "added")) {
      return "Frontier takes notes and new images from agents.";
    }
    if (kind !== "added" && !isEditable(path)) return "Appendices are append-only.";
    if (this.d.drafts.byPath(path)) return "Publish or discard your own change to this file first.";
    const renamed = this.d.drafts
      .listRenames()
      .some(
        (r) =>
          path === r.from ||
          path === r.to ||
          path.startsWith(r.from + "/") ||
          path.startsWith(r.to + "/"),
      );
    if (renamed) return "Publish or cancel your rename of this file first.";
    if (!note) {
      const name = basename(path).toLowerCase();
      const clash = this.d.index.files.some((f) => basename(f).toLowerCase() === name);
      return clash ? "An image of this name exists." : null;
    }
    if (this.d.index.note(path)?.lineEnding === "mixed") {
      return "This file mixes two kinds of line endings and is read-only.";
    }
    if (kind !== "removed") {
      const bytes = await this.d.git.readFile(path, tip);
      const text = bytes ? decodeUtf8(bytes) : null;
      if (text === null) return "This file is not readable as text.";
      if (detectLineEnding(text) === "mixed") {
        return "On the branch this file mixes two kinds of line endings.";
      }
    }
    return null;
  }

  /** Every proposal branch with its files, as of the last fetch. */
  async list(): Promise<InboxBranch[]> {
    const branches = await this.d.git.proposalBranches();
    const out: InboxBranch[] = [];
    let dirty = false;

    for (const name of Object.keys(this.records)) {
      // A branch removed on the remote takes its decisions with it.
      if (!branches.some((b) => b.name === name)) {
        delete this.records[name];
        dirty = true;
      }
    }

    for (const { name, tip } of branches) {
      const fork = await this.d.git.forkPoint(tip);
      if (fork === null) {
        out.push({ name, tip, commits: [], state: "no_fork", files: [] });
        continue;
      }
      const commits = await this.d.git.subjects(fork, tip);
      const changed = await this.d.git.diffFiles(fork, tip);
      if (changed.length === 0) {
        out.push({ name, tip, commits, state: "empty", files: [] });
        continue;
      }
      if (changed.length > MAX_FILES) {
        out.push({ name, tip, commits, state: "too_many", files: [] });
        continue;
      }

      const record = this.records[name];
      if (record && record.tip !== tip) {
        record.tip = tip;
        delete record.removeFailed;
        dirty = true;
      }
      const files: BranchFile[] = [];
      for (const c of changed) {
        const kind =
          c.status === "added" ? "added" : c.status === "deleted" ? "removed" : "changed";
        const blob = kind === "removed" ? "" : ((await this.d.git.blobHash(c.path, tip)) ?? "");
        const decided = record?.files[c.path];
        if (decided && decided.blob !== blob) {
          // The agent changed this file after the decision: it is to be decided again.
          delete record!.files[c.path];
          dirty = true;
        }
        const decision = record?.files[c.path]?.decision;
        const file: BranchFile = { path: c.path, kind, binary: !isNote(c.path), blob };
        if (decision) file.decision = decision;
        else {
          const reason = await this.blocked(c.path, kind, tip);
          if (reason) file.blocked = reason;
        }
        files.push(file);
      }
      const allDecided = files.every((f) => f.decision !== undefined);
      out.push({ name, tip, commits, state: allDecided ? "decided" : "open", files });
    }
    if (dirty) await this.save();
    return out;
  }

  private async find(name: string): Promise<InboxBranch> {
    const branch = (await this.list()).find((b) => b.name === name);
    if (!branch) {
      throw new ApiError(
        "proposal_moved",
        "This branch is no longer there. The inbox was reloaded.",
      );
    }
    return branch;
  }

  /** The file before (at the fork point) and after (on the branch), as text. */
  async texts(
    name: string,
    path: string,
  ): Promise<{ before: string | null; after: string | null }> {
    const branch = await this.find(name);
    if (!branch.files.some((f) => f.path === path && !f.binary)) {
      throw new ApiError("not_found", "This branch does not change that note.");
    }
    const fork = (await this.d.git.forkPoint(branch.tip))!;
    const read = async (commit: string) => {
      const bytes = await this.d.git.readFile(path, commit);
      return bytes ? (decodeUtf8(bytes) ?? "") : null;
    };
    return { before: await read(fork), after: await read(branch.tip) };
  }

  /** The bytes of a new image on a branch. */
  async image(name: string, path: string): Promise<Buffer> {
    const branch = await this.find(name);
    const file = branch.files.find((f) => f.path === path && f.binary && f.kind === "added");
    const bytes = file && isImage(path) ? await this.d.git.readFile(path, branch.tip) : null;
    if (!bytes) throw new ApiError("not_found", "This branch adds no such image.");
    return bytes;
  }

  /** Records a decision on one file. Returns the draft made by an accept. */
  async decide(
    name: string,
    path: string,
    blob: string,
    decision: "accept" | "reject",
  ): Promise<{ draftId?: string; branchRemoved: boolean }> {
    const branch = await this.find(name);
    const file = branch.files.find((f) => f.path === path);
    if (!file || file.blob !== blob) {
      throw new ApiError(
        "proposal_moved",
        "The agent changed this branch after you opened it. The inbox was reloaded.",
      );
    }
    if (file.decision) throw new ApiError("invalid", "This file is already decided.");

    let draftId: string | undefined;
    if (decision === "accept") {
      if (file.blocked) throw new ApiError("not_allowed", file.blocked);
      const origin = { kind: "branch" as const, ref: name, tip: branch.tip };
      const fork = (await this.d.git.forkPoint(branch.tip))!;
      const id = makeId(randomBytes);
      if (file.kind === "removed") {
        await this.d.drafts.saveFrom({
          id,
          path,
          kind: "delete",
          content: "",
          baseBlob: (await this.d.git.blobHash(path, fork)) ?? "",
          lineEnding: "lf",
          origin,
        });
      } else {
        const bytes = (await this.d.git.readFile(path, branch.tip))!;
        if (file.binary) {
          await this.d.drafts.saveFrom({
            id,
            path,
            kind: "create",
            content: bytes,
            baseBlob: "",
            lineEnding: "lf",
            origin,
          });
        } else {
          const text = decodeUtf8(bytes)!;
          await this.d.drafts.saveFrom({
            id,
            path,
            kind: file.kind === "added" ? "create" : "edit",
            content: normaliseLineEndings(text),
            baseBlob: file.kind === "added" ? "" : ((await this.d.git.blobHash(path, fork)) ?? ""),
            lineEnding: detectLineEnding(text) === "crlf" ? "crlf" : "lf",
            origin,
          });
        }
      }
      draftId = id;
    }

    const record = (this.records[name] ??= { tip: branch.tip, files: {} });
    record.files[path] = { decision: decision === "accept" ? "accepted" : "rejected", blob };
    await this.save();

    const left = branch.files.filter((f) => f.path !== path && f.decision === undefined);
    const branchRemoved = left.length === 0 ? await this.remove(name, branch.tip) : false;
    return { ...(draftId ? { draftId } : {}), branchRemoved };
  }

  /** Rejects every undecided file of a branch, or removes a branch with nothing left to decide. */
  async decideBranch(
    name: string,
    tip: string,
    decision: "reject" | "remove",
  ): Promise<{ branchRemoved: boolean }> {
    const branch = await this.find(name);
    if (branch.tip !== tip) {
      throw new ApiError(
        "proposal_moved",
        "The agent changed this branch after you opened it. The inbox was reloaded.",
      );
    }
    if (decision === "remove" && branch.state === "open") {
      throw new ApiError("invalid", "This branch still has files to decide.");
    }
    if (decision === "reject") {
      const record = (this.records[name] ??= { tip, files: {} });
      for (const f of branch.files) {
        if (!f.decision) record.files[f.path] = { decision: "rejected", blob: f.blob };
      }
      await this.save();
    }
    return { branchRemoved: await this.remove(name, tip) };
  }

  /**
   * Removes a fully decided branch from the remote, but only when a fresh fetch still finds it at
   * the commit the author decided on.
   */
  private async remove(name: string, tip: string): Promise<boolean> {
    try {
      await this.d.sync();
      const now = (await this.d.git.proposalBranches()).find((b) => b.name === name);
      if (now && now.tip !== tip) return false;
      if (now) await this.d.git.deleteProposalBranch(name);
      delete this.records[name];
      await this.save();
      return true;
    } catch {
      const record = this.records[name];
      if (record) {
        record.removeFailed = true;
        await this.save();
      }
      return false;
    }
  }

  /** How many branches wait for the author. */
  async count(): Promise<number> {
    return (await this.d.git.proposalBranches()).length;
  }
}
