/**
 * What Frontier's own AI proposes, kept as short lists of operations per entry until the author
 * decides each one. Accepting an operation changes a draft; nothing here publishes.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type InboxProposal,
  makeId,
  Proposal,
  type ProposalOperation,
  RejectedOperation,
} from "@frontier/schema";
import { readFields, setTime, setType, splitFrontmatter } from "@frontier/vault";
import { z } from "zod";
import type { EntryChanger } from "../entries/change.js";
import { ApiError } from "../errors.js";
import type { VaultIndex } from "../index/build.js";
import { movedPath } from "../publish/publish.js";
import type { StateFiles } from "../state/files.js";
import type { StatusService } from "../status/status.js";

/** Text with every run of white space made one space, for comparing quotes with entries. */
export const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

export const quoteHashOf = (quote: string): string =>
  createHash("sha256").update(collapse(quote)).digest("hex");

/** An operation as the proposer hands it over, before it has an id. */
export type NewOperation =
  { op: "add_time"; what: string; when: string; quote: string } | { op: "set_type"; type: string };

export interface ProposalStoreDeps {
  stateDir: string;
  files: StateFiles;
  index: VaultIndex;
  changer: EntryChanger;
  status: StatusService;
}

export class ProposalStore {
  private readonly dir: string;
  private proposals = new Map<string, Proposal>();
  private rejected: RejectedOperation[] = [];

  constructor(private readonly d: ProposalStoreDeps) {
    this.dir = join(d.stateDir, "proposals");
  }

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private get rejectedFile(): string {
    return join(this.dir, "rejected.json");
  }

  async load(): Promise<void> {
    this.proposals.clear();
    if (existsSync(this.dir)) {
      for (const name of readdirSync(this.dir)) {
        if (name === "rejected.json" || !name.endsWith(".json")) continue;
        const p = await this.d.files.readJson(join(this.dir, name), Proposal);
        if (p) this.proposals.set(p.id, p);
      }
    }
    this.rejected =
      (await this.d.files.readJson(this.rejectedFile, z.array(RejectedOperation))) ?? [];
    this.report();
  }

  private report(): void {
    this.d.status.proposals(this.count());
  }

  /** How many operations wait for the author. */
  count(): number {
    let n = 0;
    for (const p of this.proposals.values()) n += p.operations.length;
    return n;
  }

  forPath(path: string): Proposal | undefined {
    return [...this.proposals.values()].find((p) => p.path === path);
  }

  private async write(p: Proposal): Promise<void> {
    if (p.operations.length === 0) {
      this.proposals.delete(p.id);
      await this.d.files.remove(this.file(p.id));
    } else {
      this.proposals.set(p.id, p);
      await this.d.files.writeJson(this.file(p.id), p);
    }
    this.report();
  }

  /** Whether the author already turned this down for this entry. */
  isRejected(path: string, op: NewOperation): boolean {
    return this.rejected.some((r) =>
      r.path !== path || r.op !== op.op
        ? false
        : r.op === "set_type"
          ? op.op === "set_type" && r.type === op.type
          : op.op === "add_time" && r.what === op.what && r.quoteHash === quoteHashOf(op.quote),
    );
  }

  /** Whether the same operation already waits for a decision. */
  isPending(path: string, op: NewOperation): boolean {
    return (this.forPath(path)?.operations ?? []).some((o) =>
      o.op === "set_type"
        ? op.op === "set_type" && o.type === op.type
        : op.op === "add_time" && o.what === op.what && o.quoteHash === quoteHashOf(op.quote),
    );
  }

  /** Adds operations to the entry's proposal, making it when needed. Returns how many were added. */
  async add(
    path: string,
    operations: NewOperation[],
    model: string,
    now = new Date(),
  ): Promise<number> {
    const fresh = operations.filter((o) => !this.isPending(path, o) && !this.isRejected(path, o));
    if (fresh.length === 0) return 0;
    const proposal: Proposal = this.forPath(path) ?? {
      id: makeId(randomBytes),
      source: "fields",
      path,
      createdAt: now.toISOString(),
      operations: [],
    };
    const made: ProposalOperation[] = fresh.map((o) => {
      const id = makeId(randomBytes);
      return o.op === "add_time"
        ? { ...o, id, quoteHash: quoteHashOf(o.quote), model }
        : { ...o, id, model };
    });
    await this.write({ ...proposal, operations: [...proposal.operations, ...made] });
    return made.length;
  }

  /** Every proposal, each operation marked with whether it still applies to the entry. */
  async list(): Promise<InboxProposal[]> {
    const out: InboxProposal[] = [];
    for (const p of [...this.proposals.values()].sort((a, b) => a.path.localeCompare(b.path))) {
      const text = await this.d.changer.text(p.path);
      const body = text === null ? null : collapse(splitFrontmatter(text).body);
      out.push({
        id: p.id,
        path: p.path,
        operations: p.operations.map((operation) => ({
          operation,
          applies:
            body !== null &&
            (operation.op !== "add_time" || body.includes(collapse(operation.quote))),
        })),
      });
    }
    return out;
  }

  /** The pending operations of an entry, for showing them in the reader as proposed. */
  pendingFor(path: string): ProposalOperation[] {
    return this.forPath(path)?.operations ?? [];
  }

  async decide(
    id: string,
    operationId: string,
    decision: "accept" | "reject" | "dismiss",
    edits: { what?: string | undefined; when?: string | undefined; type?: string | undefined } = {},
  ): Promise<{ draftId?: string }> {
    const proposal = this.proposals.get(id);
    const operation = proposal?.operations.find((o) => o.id === operationId);
    if (!proposal || !operation) {
      throw new ApiError("not_found", "This proposal is no longer waiting.");
    }
    let draftId: string | undefined;

    if (decision === "accept") {
      const shown = (await this.list())
        .find((p) => p.id === id)!
        .operations.find((o) => o.operation.id === operationId)!;
      if (!shown.applies) {
        throw new ApiError(
          "not_allowed",
          "The sentence this was taken from is no longer in the entry. Dismiss it.",
        );
      }
      const origin = { kind: "fields" as const, ref: proposal.id, model: operation.model };
      const draft = await this.d.changer.apply(
        proposal.path,
        (text) => {
          if (operation.op === "set_type") return setType(text, edits.type ?? operation.type);
          const fields = readFields(text);
          if (fields.problems.some((p) => p.includes("`time`"))) {
            throw new ApiError(
              "not_allowed",
              "The dates of this entry cannot be read. Correct them in the text first.",
            );
          }
          const item = { what: edits.what ?? operation.what, when: edits.when ?? operation.when };
          if (fields.time.some((t) => t.what === item.what && t.when === item.when)) return text;
          return setTime(text, [...fields.time, item]);
        },
        origin,
      );
      draftId = draft?.id;
    } else if (decision === "reject") {
      this.rejected.push(
        operation.op === "set_type"
          ? { path: proposal.path, op: "set_type", type: operation.type }
          : {
              path: proposal.path,
              op: "add_time",
              what: operation.what,
              quoteHash: operation.quoteHash,
            },
      );
      await this.d.files.writeJson(this.rejectedFile, this.rejected);
    }

    await this.write({
      ...proposal,
      operations: proposal.operations.filter((o) => o.id !== operationId),
    });
    return draftId ? { draftId } : {};
  }

  /** Follows a rename that Frontier published. */
  async renamed(from: string, to: string): Promise<void> {
    for (const p of [...this.proposals.values()]) {
      const moved = movedPath(p.path, from, to);
      if (moved !== null) await this.write({ ...p, path: moved });
    }
    let changed = false;
    this.rejected = this.rejected.map((r) => {
      const moved = movedPath(r.path, from, to);
      if (moved === null) return r;
      changed = true;
      return { ...r, path: moved };
    });
    if (changed) await this.d.files.writeJson(this.rejectedFile, this.rejected);
  }

  /** Drops the proposals of entries that no longer exist. */
  async prune(): Promise<void> {
    for (const p of [...this.proposals.values()]) {
      if ((await this.d.changer.text(p.path)) === null && !this.d.index.note(p.path)) {
        await this.write({ ...p, operations: [] });
      }
    }
  }
}
