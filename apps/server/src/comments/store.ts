/**
 * Comments on a passage, kept as a working file in `/data/state/comments.json`. They are not lore:
 * not in the library, its history or any export. A comment holds its passage's words and a little
 * of the text on each side, not a position, so it stays with the passage while the text changes;
 * the editor finds it again.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { movedPath } from "../publish/publish.js";
import type { StateFiles } from "../state/files.js";

export const MAX_COMMENTS_PER_ENTRY = 300;

export const Comment = z.object({
  id: z.string().regex(/^[a-z0-9]{12}$/),
  path: z.string(),
  /** The passage's words, as they were when the comment was made. */
  quote: z.string(),
  /** Up to about forty characters before and after the passage, to tell repeats apart. */
  prefix: z.string(),
  suffix: z.string(),
  text: z.string(),
  for: z.enum(["me", "ai"]),
  at: z.string(),
});
export type Comment = z.infer<typeof Comment>;

const File = z.object({ comments: z.array(Comment) });

export class CommentStore {
  private readonly file: string;
  /** The comments, read once; every change goes through `queue`, one after another. */
  private loaded: Promise<Comment[]> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
  ) {
    this.file = join(stateDir, "comments.json");
  }

  private all(): Promise<Comment[]> {
    this.loaded ??= this.files.readJson(this.file, File).then((f) => f?.comments ?? []);
    return this.loaded;
  }

  /** Runs a change after every earlier one, so two at once cannot undo each other. */
  private apply<T>(work: (all: Comment[]) => Promise<{ next: Comment[] | null; value: T }>) {
    const run = this.queue.then(async () => {
      const { next, value } = await work(await this.all());
      if (next) {
        this.loaded = Promise.resolve(next);
        await this.files.writeJson(this.file, { comments: next });
      }
      return value;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async forPath(path: string): Promise<Comment[]> {
    return (await this.all()).filter((c) => c.path === path);
  }

  /** How many comments each entry has, for the entries that have any. */
  async counts(): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const c of await this.all()) out.set(c.path, (out.get(c.path) ?? 0) + 1);
    return out;
  }

  async get(id: string): Promise<Comment | null> {
    return (await this.all()).find((c) => c.id === id) ?? null;
  }

  add(input: Omit<Comment, "id" | "at">, now = new Date()): Promise<Comment> {
    return this.apply(async (all) => {
      if (all.filter((c) => c.path === input.path).length >= MAX_COMMENTS_PER_ENTRY) {
        throw new ApiError(
          "invalid",
          `An entry can hold at most ${MAX_COMMENTS_PER_ENTRY} comments. Mark some done first.`,
        );
      }
      const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
      const id = [...randomBytes(12)].map((b) => alphabet[b % 36]).join("");
      const comment = Comment.parse({ ...input, id, at: now.toISOString() });
      return { next: [...all, comment], value: comment };
    });
  }

  async change(
    id: string,
    change: { text?: string | undefined; for?: "me" | "ai" | undefined },
  ): Promise<Comment> {
    return this.apply(async (all) => {
      const found = all.find((c) => c.id === id);
      if (!found) throw new ApiError("not_found", "That comment is not there any more.");
      const next = {
        ...found,
        ...(change.text === undefined ? {} : { text: change.text }),
        ...(change.for === undefined ? {} : { for: change.for }),
      };
      return { next: all.map((c) => (c.id === id ? next : c)), value: next };
    });
  }

  async remove(id: string): Promise<void> {
    await this.apply(async (all) => ({
      next: all.some((c) => c.id === id) ? all.filter((c) => c.id !== id) : null,
      value: undefined,
    }));
  }

  /** A saved rename: comments follow their entry, or the entries of a renamed folder. */
  async renamed(from: string, to: string): Promise<void> {
    await this.apply(async (all) => {
      let changed = false;
      const next = all.map((c) => {
        const moved = movedPath(c.path, from, to);
        if (moved === null) return c;
        changed = true;
        return { ...c, path: moved };
      });
      return { next: changed ? next : null, value: undefined };
    });
  }
}
