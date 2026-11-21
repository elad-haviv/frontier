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
  private comments: Comment[] | null = null;

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
  ) {
    this.file = join(stateDir, "comments.json");
  }

  private async all(): Promise<Comment[]> {
    if (this.comments === null) {
      this.comments = (await this.files.readJson(this.file, File))?.comments ?? [];
    }
    return this.comments;
  }

  private async write(comments: Comment[]): Promise<void> {
    this.comments = comments;
    await this.files.writeJson(this.file, { comments });
  }

  async forPath(path: string): Promise<Comment[]> {
    return (await this.all()).filter((c) => c.path === path);
  }

  async get(id: string): Promise<Comment | null> {
    return (await this.all()).find((c) => c.id === id) ?? null;
  }

  async add(input: Omit<Comment, "id" | "at">, now = new Date()): Promise<Comment> {
    const all = await this.all();
    if (all.filter((c) => c.path === input.path).length >= MAX_COMMENTS_PER_ENTRY) {
      throw new ApiError(
        "invalid",
        `An entry can hold at most ${MAX_COMMENTS_PER_ENTRY} comments. Mark some done first.`,
      );
    }
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    const id = [...randomBytes(12)].map((b) => alphabet[b % 36]).join("");
    const comment = Comment.parse({ ...input, id, at: now.toISOString() });
    await this.write([...all, comment]);
    return comment;
  }

  async change(
    id: string,
    change: { text?: string | undefined; for?: "me" | "ai" | undefined },
  ): Promise<Comment> {
    const all = await this.all();
    const found = all.find((c) => c.id === id);
    if (!found) throw new ApiError("not_found", "That comment is not there any more.");
    const next = {
      ...found,
      ...(change.text === undefined ? {} : { text: change.text }),
      ...(change.for === undefined ? {} : { for: change.for }),
    };
    await this.write(all.map((c) => (c.id === id ? next : c)));
    return next;
  }

  async remove(id: string): Promise<void> {
    const all = await this.all();
    if (!all.some((c) => c.id === id)) return;
    await this.write(all.filter((c) => c.id !== id));
  }

  /** A saved rename: comments follow their entry, or the entries of a renamed folder. */
  async renamed(from: string, to: string): Promise<void> {
    const all = await this.all();
    let changed = false;
    const next = all.map((c) => {
      const moved = movedPath(c.path, from, to);
      if (moved === null) return c;
      changed = true;
      return { ...c, path: moved };
    });
    if (changed) await this.write(next);
  }
}
