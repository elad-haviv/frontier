import { createHash, randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  INVITE_CODE_PATTERN,
  INVITE_DAYS,
  InvitesFile,
  type InviteRecord,
  type ProjectRole,
} from "@frontier/schema";
import { ApiError } from "../errors.js";
import type { StateFiles } from "../state/files.js";

/** How long after an invitation stopped working its record is kept, so the page can still say why. */
const KEEP_DEAD_DAYS = 30;

/** A new code: 192 random bits as 32 URL-safe characters. Shown once, never stored. */
export const newInviteCode = (): string => randomBytes(24).toString("base64url");

/** What is stored in place of a code. A fast hash is enough: the code is random, not chosen. */
const hashOf = (code: string): Buffer => createHash("sha256").update(code, "utf8").digest();

export type InviteState = "waiting" | "used" | "cancelled" | "expired";

/** Where an invitation stands now. A used link is used even when it has also run out. */
export function stateOf(invite: InviteRecord, now: Date): InviteState {
  if (invite.usedAt) return "used";
  if (invite.cancelledAt) return "cancelled";
  if (Date.parse(invite.expiresAt) <= now.getTime()) return "expired";
  return "waiting";
}

/**
 * The invitations, in `/data/state/invites.json` (server-wide, in the backup). Only a hash of each
 * code is kept. Made like the project store: one process is the only writer, changes run one
 * after another, and what is held is checked against the file's stamp on each read.
 */
export class InviteStore {
  readonly file: string;
  private turn: Promise<unknown> = Promise.resolve();
  private held: { stamp: string | null; invites: InviteRecord[] } | null = null;

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
    readonly now: () => Date = () => new Date(),
  ) {
    this.file = join(stateDir, "invites.json");
  }

  private async stamp(): Promise<string | null> {
    try {
      const s = await stat(this.file);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return null;
    }
  }

  async all(): Promise<InviteRecord[]> {
    const stamp = await this.stamp();
    if (this.held && this.held.stamp === stamp) return this.held.invites;
    const invites = (await this.files.readJson(this.file, InvitesFile))?.invites ?? [];
    this.held = { stamp, invites };
    return invites;
  }

  /**
   * The invitation a code belongs to, or null. Every stored hash is compared, in constant time and
   * without stopping at the first match, so how long it takes says nothing about whether, or where,
   * a code is. A string that is not shaped like a code is no invitation, with the same answer.
   */
  async byCode(code: string): Promise<InviteRecord | null> {
    const wanted = hashOf(INVITE_CODE_PATTERN.test(code) ? code : "");
    let found: InviteRecord | null = null;
    for (const invite of await this.all()) {
      const same = timingSafeEqual(Buffer.from(invite.codeHash, "hex"), wanted);
      if (same && INVITE_CODE_PATTERN.test(code)) found = invite;
    }
    return found;
  }

  /** The invitations of a project that can still be used, soonest to run out first. */
  async waiting(projectId: string): Promise<InviteRecord[]> {
    const at = this.now();
    return (await this.all())
      .filter((i) => i.projectId === projectId && stateOf(i, at) === "waiting")
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  }

  /** Makes an invitation and returns it with the code, which this is the only time anyone has. */
  create(input: {
    projectId: string;
    role: ProjectRole;
    createdBy: string;
  }): Promise<{ invite: InviteRecord; code: string }> {
    const code = newInviteCode();
    return this.change(async (invites) => {
      const at = this.now();
      const invite: InviteRecord = {
        id: randomUUID(),
        projectId: input.projectId,
        role: input.role,
        codeHash: hashOf(code).toString("hex"),
        createdBy: input.createdBy,
        createdAt: at.toISOString(),
        expiresAt: new Date(at.getTime() + INVITE_DAYS * 86_400_000).toISOString(),
      };
      // Old dead links are dropped as new ones are made, so the file does not grow for ever.
      const cutoff = at.getTime() - KEEP_DEAD_DAYS * 86_400_000;
      const kept = invites.filter(
        (i) => stateOf(i, at) === "waiting" || Date.parse(i.expiresAt) > cutoff,
      );
      return { invites: [...kept, invite], result: { invite, code } };
    });
  }

  /** Cancels a waiting invitation of this project. A used one cannot be cancelled. */
  cancel(projectId: string, id: string): Promise<void> {
    return this.change(async (invites) => {
      const now = invites.find((i) => i.id === id && i.projectId === projectId);
      if (!now) throw new ApiError("not_found", "There is no such invitation.");
      if (now.usedAt) throw new ApiError("invite_used", "This invitation has already been used.");
      if (now.cancelledAt) return { invites, result: undefined };
      const at = this.now().toISOString();
      return {
        invites: invites.map((i) => (i.id === id ? { ...i, cancelledAt: at } : i)),
        result: undefined,
      };
    });
  }

  /**
   * Takes the invitation for one person: marks it used, and fails when it is no longer waiting.
   * Runs inside the store's turn, so of two uses at once exactly one gets it. `release` gives it
   * back when what the use was for could not be done.
   */
  claim(id: string): Promise<InviteRecord> {
    return this.change(async (invites) => {
      const now = invites.find((i) => i.id === id);
      const at = this.now();
      const state = now ? stateOf(now, at) : null;
      if (!now) throw new ApiError("invite_unknown", "This invitation link is not valid.");
      if (state !== "waiting") throw new ApiError(`invite_${state}` as "invite_used", "Not valid.");
      const claimed = { ...now, usedAt: at.toISOString(), usedBy: "" };
      return { invites: invites.map((i) => (i.id === id ? claimed : i)), result: claimed };
    });
  }

  /** Records who the claimed invitation went to. */
  settle(id: string, personId: string): Promise<void> {
    return this.change(async (invites) => ({
      invites: invites.map((i) => (i.id === id ? { ...i, usedBy: personId } : i)),
      result: undefined,
    }));
  }

  /** Gives a claimed invitation back, for a use that failed after it was claimed. */
  release(id: string): Promise<void> {
    return this.change(async (invites) => ({
      invites: invites.map((i) => {
        if (i.id !== id) return i;
        const rest = { ...i };
        delete rest.usedAt;
        delete rest.usedBy;
        return rest;
      }),
      result: undefined,
    }));
  }

  private change<T>(
    work: (invites: InviteRecord[]) => Promise<{ invites: InviteRecord[]; result: T }>,
  ): Promise<T> {
    const run = this.turn.then(async () => {
      const before = await this.all();
      const { invites, result } = await work(before);
      if (invites === before) return result;
      const file = InvitesFile.parse({ version: 1, invites });
      await this.files.writeJson(this.file, file);
      this.held = { stamp: await this.stamp(), invites: file.invites };
      return result;
    });
    this.turn = run.catch(() => undefined);
    return run;
  }
}
