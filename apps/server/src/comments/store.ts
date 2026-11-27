/**
 * Comments on a passage, kept as a working file in `/data/state/comments.json`. They are not lore:
 * not in the library, its history or any export. A comment holds its passage's words and a little
 * of the text on each side, not a position, so it stays with the passage while the text changes;
 * the editor finds it again.
 *
 * Stage 31e: comments are between people. Each comment and each reply has an author (a person id,
 * with the name as it was when it was written, for the day the account is gone) and times; a
 * thread can be resolved and reopened. This store only keeps and changes them: who may do what is
 * decided by the routes (`routes/comments.ts`) from `rules.ts`.
 *
 * A comment from before people has no author. It is read as the project's first owner's, and the
 * first load that can name one writes that into the file, so a project that had no owner yet when
 * 31e arrived is finished later; running it again changes nothing.
 *
 * Such a comment is also marked `legacy`: before 31e only the writers and the owner could read
 * comments, so a legacy comment stays for writers and owners only until its author or an owner
 * shares it with everyone (`share`). The first 31e build gave these comments to the first owner
 * without a mark, so a file that does not carry `version: 2` is corrected once, on the first start
 * of this build: every comment in it that has no author, or whose author is the first owner (or
 * when no owner can be named yet), is marked legacy. That can only hide more than was shared
 * (a comment the first owner really wrote under 31e is hidden from readers until they share it),
 * never show more than before. The file is then written with `version: 2` and this runs no more.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { movedPath } from "../publish/publish.js";
import { currentPersonId } from "../projects/view.js";
import type { StateFiles } from "../state/files.js";

/** Open shared comments on one entry. */
export const MAX_COMMENTS_PER_ENTRY = 300;
/** Open comments (shared or for the AI) one person has in a project. */
export const MAX_OPEN_PER_PERSON = 200;
export const MAX_REPLIES_PER_COMMENT = 100;

const Id = z.string().regex(/^[a-z0-9]{12}$/);

export const Reply = z.object({
  id: Id,
  /** Who wrote it; absent only in a file from before people (read as the first owner). */
  person: z.string().optional(),
  /** Their name when they wrote it. */
  name: z.string().optional(),
  text: z.string(),
  at: z.string(),
  editedAt: z.string().optional(),
});
export type Reply = z.infer<typeof Reply>;

export const Comment = z.object({
  id: Id,
  path: z.string(),
  /** The passage's words, as they were when the comment was made; empty for a comment on the entry. */
  quote: z.string(),
  /** Up to about forty characters before and after the passage, to tell repeats apart. */
  prefix: z.string(),
  suffix: z.string(),
  text: z.string(),
  /** "me": shared with the people of the project. "ai": its author's own, for the writing help. */
  for: z.enum(["me", "ai"]),
  /** From before people: only writers and owners read it until it is shared (see the file's note). */
  legacy: z.boolean().optional(),
  at: z.string(),
  person: z.string().optional(),
  name: z.string().optional(),
  editedAt: z.string().optional(),
  resolved: z
    .object({ person: z.string(), name: z.string().optional(), at: z.string() })
    .optional(),
  replies: z.array(Reply).default([]),
});
export type Comment = z.infer<typeof Comment>;

/** `version` 2 marks a file that has been through the legacy correction. */
const File = z.object({ version: z.number().optional(), comments: z.array(Comment) });
const VERSION = 2;

/** What the store asks of the project to know people: kept apart so it can be tested alone. */
export interface CommentPeople {
  /** The first owner (the author of what has none), or null when the project has none yet. */
  legacyOwner?: () => string | null;
  /** A person's name, as shown to everyone (never an email). */
  nameOf?: (personId: string) => string;
  /** Told that an entry's shared comments changed (never what they say). */
  onChange?: (path: string) => void;
}

/** A new comment, before it has an id, an author and a time. */
export type NewComment = Pick<Comment, "path" | "quote" | "prefix" | "suffix" | "text" | "for">;

const newId = (): string => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return [...randomBytes(12)].map((b) => alphabet[b % 36]).join("");
};

/** A comment is shared with the whole project while it is not for the AI and not a legacy one. */
export const isShared = (c: Pick<Comment, "for" | "legacy">): boolean =>
  c.for !== "ai" && !c.legacy;

export class CommentStore {
  private readonly file: string;
  /** The comments, read once; every change goes through `queue`, one after another. */
  private loaded: Promise<Comment[]> | null = null;
  /** The file was there but from before `version: 2`: its legacy comments are still to be marked. */
  private unmarked = false;
  private queue: Promise<unknown> = Promise.resolve();
  /** The entries whose shared comments the change being made touches, told when it is kept. */
  private readonly pending = new Set<string>();

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
    private readonly people: CommentPeople = {},
  ) {
    this.file = join(stateDir, "comments.json");
  }

  private all(): Promise<Comment[]> {
    this.loaded ??= this.files.readJson(this.file, File).then((f) => {
      this.unmarked = !!f && f.version !== VERSION;
      return f?.comments ?? [];
    });
    return this.loaded;
  }

  /** Who the writer of a change is: the person whose request this is, else the first owner. */
  private actor(): string | null {
    return currentPersonId() ?? this.people.legacyOwner?.() ?? null;
  }

  private nameFor(personId: string | null): string | undefined {
    return personId && this.people.nameOf ? this.people.nameOf(personId) : undefined;
  }

  /** The comments with the first owner's name on what has none, and whether any was changed. */
  private stamped(all: Comment[]): { all: Comment[]; changed: boolean } {
    const owner = this.people.legacyOwner?.() ?? null;
    if (!owner) return { all, changed: false };
    let changed = false;
    const name = this.nameFor(owner);
    const stamp = <T extends { person?: string | undefined; name?: string | undefined }>(
      x: T,
    ): T => {
      if (x.person) return x;
      changed = true;
      return { ...x, person: owner, ...(name ? { name } : {}) };
    };
    const next = all.map((c) => ({ ...stamp(c), replies: c.replies.map(stamp) }));
    return { all: changed ? next : all, changed };
  }

  /**
   * Gives the comments of before people to the first owner, in the file. Safe to run again, and at
   * every start: it writes only when something is still without an author and an owner can be named.
   */
  load(): Promise<void> {
    return this.apply(async (all) => {
      const { all: stamped, changed } = this.stamped(all);
      if (!this.unmarked) return { next: changed ? stamped : null, value: undefined };
      // Decided before stamping: what had no author, or the first owner's (whoever stamped it).
      const owner = this.people.legacyOwner?.() ?? null;
      const old = new Set(
        all.filter((c) => !owner || !c.person || c.person === owner).map((c) => c.id),
      );
      const next = stamped.map((c) => (old.has(c.id) ? { ...c, legacy: true } : c));
      return { next, value: undefined };
    });
  }

  /** Runs a change after every earlier one, so two at once cannot undo each other. */
  private apply<T>(work: (all: Comment[]) => Promise<{ next: Comment[] | null; value: T }>) {
    const run = this.queue.then(async () => {
      const current = await this.all();
      const { next, value } = await work(current);
      if (next) {
        // What could not be given to anyone before is given now that an owner can be named.
        const { all: whole } = this.stamped(next);
        this.loaded = Promise.resolve(whole);
        this.unmarked = false;
        await this.files.writeJson(this.file, { version: VERSION, comments: whole });
      }
      // Told after the change is kept, so whoever reads at once finds it.
      const paths = [...this.pending];
      this.pending.clear();
      for (const p of paths) this.people.onChange?.(p);
      return value;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** A comment as it is read: its author is the first owner when it has none yet. */
  private read(c: Comment): Comment {
    const owner = this.people.legacyOwner?.() ?? null;
    if (!owner) return c;
    const name = this.nameFor(owner);
    const fill = <T extends { person?: string | undefined; name?: string | undefined }>(x: T): T =>
      x.person ? x : { ...x, person: owner, ...(name ? { name } : {}) };
    return { ...fill(c), replies: c.replies.map(fill) };
  }

  /** Refuses another open shared comment on an entry that already holds the most. */
  private checkEntryRoom(all: Comment[], path: string): void {
    const open = all.filter((c) => c.path === path && isShared(c) && !c.resolved).length;
    if (open >= MAX_COMMENTS_PER_ENTRY) {
      throw new ApiError(
        "invalid",
        `An entry can hold at most ${MAX_COMMENTS_PER_ENTRY} open comments. Resolve or delete some first.`,
      );
    }
  }

  /** Every comment on the entry, shared or not; the route says which the caller may see. */
  async forPath(path: string): Promise<Comment[]> {
    return (await this.all()).filter((c) => c.path === path).map((c) => this.read(c));
  }

  /** How many open shared comments each entry has, for the entries that have any. */
  async counts(): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const c of await this.all()) {
      if (c.resolved || !isShared(c)) continue;
      out.set(c.path, (out.get(c.path) ?? 0) + 1);
    }
    return out;
  }

  async get(id: string): Promise<Comment | null> {
    const found = (await this.all()).find((c) => c.id === id);
    return found ? this.read(found) : null;
  }

  private tell(...cs: (Comment | undefined)[]): void {
    const shown = cs.filter((c): c is Comment => !!c && isShared(c));
    // One change tells once, and a change to what only its author sees tells nobody.
    for (const c of shown) this.pending.add(c.path);
  }

  add(input: NewComment, now = new Date()): Promise<Comment> {
    return this.apply(async (all) => {
      const who = this.actor();
      if (input.for !== "ai") this.checkEntryRoom(all, input.path);
      if (who && all.filter((c) => c.person === who && !c.resolved).length >= MAX_OPEN_PER_PERSON) {
        throw new ApiError(
          "invalid",
          `You can have at most ${MAX_OPEN_PER_PERSON} open comments in a project. Resolve or delete some first.`,
        );
      }
      const name = this.nameFor(who);
      const comment = Comment.parse({
        ...input,
        id: newId(),
        at: now.toISOString(),
        ...(who ? { person: who } : {}),
        ...(name ? { name } : {}),
      });
      this.tell(comment);
      return { next: [...all, comment], value: this.read(comment) };
    });
  }

  /** Changes a comment: its words, who it is for, or whether it is resolved. */
  change(
    id: string,
    change: {
      text?: string | undefined;
      for?: "me" | "ai" | undefined;
      /** Where the passage is in the saved text, when the comment becomes shared. */
      anchor?: { prefix: string; suffix: string } | undefined;
      /** Set when the words are edited by their author, to mark the comment "edited". */
      edited?: boolean | undefined;
    },
    now = new Date(),
  ): Promise<Comment> {
    return this.apply(async (all) => {
      const found = all.find((c) => c.id === id);
      if (!found) throw new ApiError("not_found", "That comment is not there any more.");
      const next: Comment = {
        ...found,
        ...(change.text === undefined ? {} : { text: change.text }),
        ...(change.for === undefined ? {} : { for: change.for }),
        ...(change.anchor ?? {}),
        ...(change.text !== undefined && change.edited ? { editedAt: now.toISOString() } : {}),
      };
      // Giving a comment to everyone (for "me") ends its being a legacy, writers-only note.
      if (change.for === "me") delete next.legacy;
      if (isShared(next) && !isShared(found) && !found.resolved)
        this.checkEntryRoom(all, next.path);
      this.tell(found, next);
      return { next: all.map((c) => (c.id === id ? next : c)), value: this.read(next) };
    });
  }

  /** Resolves or reopens a thread, as the person whose request this is. */
  resolve(id: string, resolved: boolean, now = new Date()): Promise<Comment> {
    return this.apply(async (all) => {
      const found = all.find((c) => c.id === id);
      if (!found) throw new ApiError("not_found", "That comment is not there any more.");
      const next: Comment = { ...found };
      delete next.resolved;
      const who = this.actor();
      if (resolved && who) {
        const name = this.nameFor(who);
        next.resolved = { person: who, ...(name ? { name } : {}), at: now.toISOString() };
      }
      this.tell(found);
      return { next: all.map((c) => (c.id === id ? next : c)), value: this.read(next) };
    });
  }

  async remove(id: string): Promise<void> {
    await this.apply(async (all) => {
      const found = all.find((c) => c.id === id);
      this.tell(found);
      return { next: found ? all.filter((c) => c.id !== id) : null, value: undefined };
    });
  }

  addReply(id: string, text: string, now = new Date()): Promise<Comment> {
    return this.apply(async (all) => {
      const found = all.find((c) => c.id === id);
      if (!found) throw new ApiError("not_found", "That comment is not there any more.");
      if (found.replies.length >= MAX_REPLIES_PER_COMMENT) {
        throw new ApiError(
          "invalid",
          `A comment can hold at most ${MAX_REPLIES_PER_COMMENT} replies. Start a new comment.`,
        );
      }
      const who = this.actor();
      const name = this.nameFor(who);
      const reply = Reply.parse({
        id: newId(),
        text,
        at: now.toISOString(),
        ...(who ? { person: who } : {}),
        ...(name ? { name } : {}),
      });
      const next = { ...found, replies: [...found.replies, reply] };
      this.tell(found);
      return { next: all.map((c) => (c.id === id ? next : c)), value: this.read(next) };
    });
  }

  editReply(id: string, replyId: string, text: string, now = new Date()): Promise<Comment> {
    return this.changeReply(id, replyId, (r) => ({ ...r, text, editedAt: now.toISOString() }));
  }

  removeReply(id: string, replyId: string): Promise<Comment> {
    return this.changeReply(id, replyId, null);
  }

  private changeReply(
    id: string,
    replyId: string,
    to: ((r: Reply) => Reply) | null,
  ): Promise<Comment> {
    return this.apply(async (all) => {
      const found = all.find((c) => c.id === id);
      if (!found) throw new ApiError("not_found", "That comment is not there any more.");
      if (!found.replies.some((r) => r.id === replyId)) {
        throw new ApiError("not_found", "That reply is not there any more.");
      }
      const replies = to
        ? found.replies.map((r) => (r.id === replyId ? to(r) : r))
        : found.replies.filter((r) => r.id !== replyId);
      const next = { ...found, replies };
      this.tell(found);
      return { next: all.map((c) => (c.id === id ? next : c)), value: this.read(next) };
    });
  }

  /** A saved rename: comments follow their entry, or the entries of a renamed folder. */
  async renamed(from: string, to: string): Promise<void> {
    await this.apply(async (all) => {
      let changed = false;
      const next = all.map((c) => {
        const moved = movedPath(c.path, from, to);
        if (moved === null) return c;
        changed = true;
        const at = { ...c, path: moved };
        this.tell(at);
        return at;
      });
      return { next: changed ? next : null, value: undefined };
    });
  }
}
