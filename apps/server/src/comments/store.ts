/**
 * Comments on a passage, kept as a working file in `/data/state/comments.json`. They are not lore:
 * not in the library, its history or any export. A comment holds its passage's words and a little
 * of the text on each side, not a position, so it stays with the passage while the text changes;
 * the editor finds it again.
 *
 * Stage 27e: comments are between people. Each comment and each reply has an author (a person id,
 * with the name as it was when it was written, for the day the account is gone) and times; a
 * thread can be resolved and reopened. This store only keeps and changes them: who may do what is
 * decided by the routes (`routes/comments.ts`) from `rules.ts`.
 *
 * A comment from before people has no author. It is read as the project's first owner's, and the
 * first load that can name one writes that into the file, so a project that had no owner yet when
 * 27e arrived is finished later; running it again changes nothing.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { movedPath } from "../publish/publish.js";
import { currentPersonId } from "../projects/view.js";
import type { StateFiles } from "../state/files.js";

export const MAX_COMMENTS_PER_ENTRY = 300;
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

const File = z.object({ comments: z.array(Comment) });

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

/** A comment is shared with the project while it is not for the AI. */
export const isShared = (c: Pick<Comment, "for">): boolean => c.for !== "ai";

export class CommentStore {
  private readonly file: string;
  /** The comments, read once; every change goes through `queue`, one after another. */
  private loaded: Promise<Comment[]> | null = null;
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
    this.loaded ??= this.files.readJson(this.file, File).then((f) => f?.comments ?? []);
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
      const { all: next, changed } = this.stamped(all);
      return { next: changed ? next : null, value: undefined };
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
        await this.files.writeJson(this.file, { comments: whole });
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
      if (all.filter((c) => c.path === input.path).length >= MAX_COMMENTS_PER_ENTRY) {
        throw new ApiError(
          "invalid",
          `An entry can hold at most ${MAX_COMMENTS_PER_ENTRY} comments. Resolve or delete some first.`,
        );
      }
      const who = this.actor();
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
        ...(change.text !== undefined && change.edited ? { editedAt: now.toISOString() } : {}),
      };
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
