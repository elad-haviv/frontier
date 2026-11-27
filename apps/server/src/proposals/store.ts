/**
 * What Frontier's own AI proposes, kept as short lists of operations per entry until the author
 * decides each one. Accepting an operation changes a draft; nothing here publishes.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  findKind,
  type InboxProposal,
  type RelKind,
  makeId,
  Proposal,
  type ProposalOperation,
  RejectedOperation,
} from "@frontier/schema";
import {
  readFields,
  readRelations,
  type RelationItem,
  setRelations,
  setTime,
  setType,
  splitFrontmatter,
  stem,
} from "@frontier/vault";
import type { RelationOp } from "../ai/relationProposals.js";
import { currentPersonId } from "../projects/view.js";
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
  | { op: "add_time"; what: string; when: string; quote: string }
  | { op: "set_type"; type: string }
  | RelationOp;

type RelationOperation = Extract<ProposalOperation, { op: "add_relation" }>;

/** The edits an Accept may carry for a relation. */
export interface RelationEdits {
  what?: string | undefined;
  who?: string | undefined;
  with?: string | null | undefined;
  how?: string | null | undefined;
  when?: string | null | undefined;
  saveOn?: string | undefined;
}

/** What the last Accept of relations changed, for Undo. */
interface LastAccept {
  path: string;
  before: string;
  after: string;
  /** The draft the Accept made, when the entry had none before. */
  madeDraft: string | null;
  proposal: Proposal;
  ops: ProposalOperation[];
}

export interface ProposalStoreDeps {
  stateDir: string;
  files: StateFiles;
  index: VaultIndex;
  changer: EntryChanger;
  status: StatusService;
  /** Removes a draft the store made, for Undo. */
  discard?: (draftId: string) => Promise<void>;
}

export class ProposalStore {
  private readonly dir: string;
  private proposals = new Map<string, Proposal>();
  private rejected: RejectedOperation[] = [];
  /** Entries read for relations at least once (stage 33). */
  private readForRelations = new Set<string>();
  /** The last Accept of relations, by the person who made it. */
  private lastAccept = new Map<string, LastAccept>();
  /** What accepting a relation would break; set once the relations can be read. */
  warnFor: (path: string, op: RelationOperation) => string | null = () => null;

  constructor(private readonly d: ProposalStoreDeps) {
    this.dir = join(d.stateDir, "proposals");
  }

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private get rejectedFile(): string {
    return join(this.dir, "rejected.json");
  }

  private get readFile(): string {
    return join(this.dir, "read-for-relations.json");
  }

  async load(): Promise<void> {
    this.proposals.clear();
    if (existsSync(this.dir)) {
      for (const name of readdirSync(this.dir)) {
        if (
          name === "rejected.json" ||
          name === "read-for-relations.json" ||
          !name.endsWith(".json")
        )
          continue;
        const p = await this.d.files.readJson(join(this.dir, name), Proposal);
        if (p) this.proposals.set(p.id, p);
      }
    }
    this.rejected =
      (await this.d.files.readJson(this.rejectedFile, z.array(RejectedOperation))) ?? [];
    this.readForRelations = new Set(
      (await this.d.files.readJson(this.readFile, z.array(z.string()))) ?? [],
    );
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
    return this.rejected.some((r) => {
      if (r.path !== path || r.op !== op.op) return false;
      if (r.op === "set_type") return op.op === "set_type" && r.type === op.type;
      if (r.op === "add_relation")
        return (
          op.op === "add_relation" &&
          r.what === op.what &&
          r.who === op.who &&
          r.quoteHash === quoteHashOf(op.quote)
        );
      return op.op === "add_time" && r.what === op.what && r.quoteHash === quoteHashOf(op.quote);
    });
  }

  /** Whether the same operation already waits for a decision. */
  isPending(path: string, op: NewOperation): boolean {
    return (this.forPath(path)?.operations ?? []).some((o) => {
      if (o.op === "set_type") return op.op === "set_type" && o.type === op.type;
      if (o.op === "add_relation")
        return op.op === "add_relation" && o.what === op.what && o.who === op.who;
      return op.op === "add_time" && o.what === op.what && o.quoteHash === quoteHashOf(op.quote);
    });
  }

  /** Every relation waiting for a decision, with its entry. */
  pendingRelations(): (RelationOperation & {
    proposal: string;
    path: string;
    also: { path: string; quote: string; words: string }[];
  })[] {
    const out: ReturnType<ProposalStore["pendingRelations"]> = [];
    for (const p of this.proposals.values())
      for (const o of p.operations)
        if (o.op === "add_relation")
          out.push({ ...o, proposal: p.id, path: p.path, also: o.also ?? [] });
    return out;
  }

  /** Adds another entry's sentence to a waiting relation that it also states. */
  async addEvidence(
    proposalId: string,
    opId: string,
    also: { path: string; quote: string; words: string },
  ): Promise<void> {
    const p = this.proposals.get(proposalId);
    if (!p) return;
    await this.write({
      ...p,
      operations: p.operations.map((o) =>
        o.id === opId && o.op === "add_relation"
          ? { ...o, also: [...(o.also ?? []).filter((a) => a.path !== also.path), also] }
          : o,
      ),
    });
  }

  /** Notes that an entry has been read for relations. */
  async markRead(path: string): Promise<void> {
    if (this.readForRelations.has(path)) return;
    this.readForRelations.add(path);
    await this.d.files.writeJson(this.readFile, [...this.readForRelations].sort());
  }

  /** How many of these entries were never read for relations. */
  unreadCount(paths: string[]): number {
    return paths.filter((p) => !this.readForRelations.has(p)).length;
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
      if (o.op === "add_relation") return { ...o, id, quoteHash: quoteHashOf(o.quote), model };
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
            (operation.op === "set_type" || body.includes(collapse(operation.quote))),
          ...(operation.op === "add_relation" ? { warning: this.warnFor(p.path, operation) } : {}),
        })),
      });
    }
    return out;
  }

  /** The pending operations of an entry, for showing them in the reader as proposed. */
  pendingFor(path: string): ProposalOperation[] {
    return this.forPath(path)?.operations ?? [];
  }

  /**
   * Accepts relations of one entry's proposal in one change of one entry each, and remembers it
   * for Undo. Each relation is written on its entry (or on the other one, with `saveOn`), in that
   * entry's direction.
   */
  async acceptRelations(
    id: string,
    accepted: { op: string; edits?: RelationEdits }[],
    kindsOf: () => RelKind[],
  ): Promise<{ draftId?: string; saved: { path: string; item: RelationItem }[] }> {
    const proposal = this.proposals.get(id);
    if (!proposal) throw new ApiError("not_found", "This proposal is no longer waiting.");
    const ops = accepted.map((a) => {
      const op = proposal.operations.find((o) => o.id === a.op);
      if (!op || op.op !== "add_relation")
        throw new ApiError("not_found", "This proposal is no longer waiting.");
      return { op, edits: a.edits ?? {} };
    });
    const shown = (await this.list()).find((p) => p.id === id)!;
    for (const { op } of ops) {
      if (!shown.operations.find((o) => o.operation.id === op.id)?.applies) {
        throw new ApiError(
          "not_allowed",
          "The sentence this was taken from is no longer in the entry. Dismiss it.",
        );
      }
    }
    const link = (p: string) => `[[${stem(p)}]]`;
    const asWho = (who: string) =>
      who.endsWith(".md") ? link(who) : who.includes("[[") ? who : `[[${who}]]`;
    // Group by the entry each is saved on.
    const byPath = new Map<string, RelationItem[]>();
    for (const { op, edits } of ops) {
      const what = edits.what ?? op.what;
      const who = edits.who ?? op.whoPath ?? op.who;
      const saveOn = edits.saveOn ?? proposal.path;
      let item: RelationItem;
      if (saveOn === proposal.path) {
        const withWho = edits.with === undefined ? (op.withPath ?? op.with) : edits.with;
        const how = edits.how === undefined ? op.how : edits.how;
        const when = edits.when === undefined ? op.when : edits.when;
        item = {
          what,
          who: asWho(who),
          ...(withWho ? { with: asWho(withWho) } : {}),
          ...(how ? { how } : {}),
          ...(when ? { when } : {}),
        };
      } else {
        // Saved on the other entry: the word the other way round, naming this entry.
        if (!who.endsWith(".md") || saveOn !== who) {
          throw new ApiError("invalid", "A relation is saved on one of its two entries.");
        }
        const found = findKind(kindsOf(), what);
        const back = found?.kind.reverse
          ? found.reversed
            ? found.kind.name
            : found.kind.reverse
          : what;
        const how = edits.how === undefined ? op.how : edits.how;
        const when = edits.when === undefined ? op.when : edits.when;
        item = {
          what: back,
          who: link(proposal.path),
          ...(how ? { how } : {}),
          ...(when ? { when } : {}),
        };
      }
      byPath.set(saveOn, [...(byPath.get(saveOn) ?? []), item]);
    }
    if (byPath.size > 1 && ops.length > 1) {
      throw new ApiError("invalid", "Accept relations saved on different entries one at a time.");
    }
    const [path, items] = [...byPath][0]!;
    const before = await this.d.changer.text(path);
    if (before === null) throw new ApiError("not_found", `There is no note at "${path}".`);
    const hadDraft = this.d.changer.hasDraft(path);
    const origin = { kind: "fields" as const, ref: proposal.id, model: ops[0]!.op.model };
    const draft = await this.d.changer.apply(
      path,
      (text) => {
        const now = readRelations(text);
        if (now.problems.length > 0) {
          throw new ApiError(
            "not_allowed",
            "The relations of this entry cannot be read. Correct them in the text first.",
          );
        }
        const fresh = items.filter(
          (i) =>
            !now.items.some(
              (n) => n.what.toLowerCase() === i.what.toLowerCase() && n.who === i.who,
            ),
        );
        return fresh.length ? setRelations(text, [...now.items, ...fresh]) : text;
      },
      origin,
    );
    const after = await this.d.changer.text(path);
    const decided = new Set(ops.map((o) => o.op.id));
    this.lastAccept.set(currentPersonId() ?? "", {
      path,
      before,
      after: after ?? before,
      madeDraft: hadDraft ? null : (draft?.id ?? null),
      proposal,
      ops: proposal.operations.filter((o) => decided.has(o.id)),
    });
    await this.write({
      ...proposal,
      operations: proposal.operations.filter((o) => !decided.has(o.id)),
    });
    return {
      ...(draft ? { draftId: draft.id } : {}),
      saved: items.map((item) => ({ path, item })),
    };
  }

  /** Takes back the last Accept of relations, if the entry has not changed since. */
  async undoAccept(): Promise<{ undone: boolean }> {
    const who = currentPersonId() ?? "";
    const last = this.lastAccept.get(who);
    this.lastAccept.delete(who);
    if (!last) return { undone: false };
    if ((await this.d.changer.text(last.path)) !== last.after) return { undone: false };
    if (last.madeDraft && this.d.discard) await this.d.discard(last.madeDraft);
    else await this.d.changer.apply(last.path, () => last.before);
    const now = this.proposals.get(last.proposal.id) ?? { ...last.proposal, operations: [] };
    const back = last.ops.filter((o) => !now.operations.some((n) => n.id === o.id));
    await this.write({ ...now, operations: [...now.operations, ...back] });
    return { undone: true };
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
    if (operation.op === "add_relation" && decision === "accept") {
      throw new ApiError("invalid", "A relation is accepted with acceptRelations.");
    }

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
          if (operation.op === "add_relation") return text;
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
          : operation.op === "add_relation"
            ? {
                path: proposal.path,
                op: "add_relation",
                what: operation.what,
                who: operation.who,
                quoteHash: operation.quoteHash,
              }
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
