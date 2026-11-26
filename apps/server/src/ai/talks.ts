/**
 * Conversations with characters (stage 27), kept as working files in `/data/state/talks/`, one
 * file each. They are not lore: not in the library, its history or any export. A conversation
 * belongs to a character by the entry's id, so it follows the entry when it is renamed or moved.
 * All are kept until the author deletes them.
 */
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { StateFiles } from "../state/files.js";

const Quote = z.object({ path: z.string(), text: z.string() });
export const TalkLine = z.discriminatedUnion("who", [
  z.object({ who: z.literal("author"), text: z.string() }),
  z.object({
    who: z.literal("character"),
    text: z.string(),
    sources: z.array(z.string()),
    quotes: z.array(Quote),
    improvised: z.boolean(),
    /** Set once the author added the line to the character's entry. */
    kept: z.boolean().default(false),
  }),
]);
export type TalkLine = z.infer<typeof TalkLine>;

export const Talk = z.object({
  id: z.string().regex(/^[a-z0-9]{12}$/),
  /** The id of the character's entry. */
  entry: z.string(),
  at: z.string(),
  updatedAt: z.string(),
  /** The moment the character last spoke from in this conversation. */
  moment: z.object({ words: z.string(), year: z.number().nullable() }),
  lines: z.array(TalkLine),
});
export type Talk = z.infer<typeof Talk>;

/** What the list of a character's conversations shows of one. */
export interface TalkSummary {
  id: string;
  at: string;
  updatedAt: string;
  moment: Talk["moment"];
  /** The first thing the author said. */
  title: string;
  lines: number;
  kept: number;
}

export const summaryOf = (t: Talk): TalkSummary => ({
  id: t.id,
  at: t.at,
  updatedAt: t.updatedAt,
  moment: t.moment,
  title:
    t.lines
      .find((l) => l.who === "author")
      ?.text.replace(/\s+/g, " ")
      .slice(0, 120) ?? "",
  lines: t.lines.length,
  kept: t.lines.filter((l) => l.who === "character" && l.kept).length,
});

const ID = /^[a-z0-9]{12}$/;

export class Talks {
  private readonly dir: string;
  /** Every change goes through here, one after another, so two at once cannot undo each other. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
  ) {
    this.dir = join(stateDir, "talks");
  }

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async get(id: string): Promise<Talk | null> {
    if (!ID.test(id)) return null;
    return this.files.readJson(this.file(id), Talk);
  }

  /** A character's conversations, the latest spoken in first. */
  async forEntry(entry: string): Promise<Talk[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const all = await Promise.all(
      names
        .filter((n) => n.endsWith(".json") && ID.test(n.slice(0, -5)))
        .map((n) => this.get(n.slice(0, -5))),
    );
    return all
      .filter((t): t is Talk => t !== null && t.entry === entry)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Changes a conversation, or starts one when `id` is null. `work` gets the conversation as it
   * is and answers it as it should be.
   */
  change(
    id: string | null,
    start: { entry: string; moment: Talk["moment"] },
    work: (talk: Talk) => Talk,
    now = new Date(),
  ): Promise<Talk> {
    const run = this.queue.then(async () => {
      let talk: Talk;
      if (id === null) {
        const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
        const at = now.toISOString();
        talk = {
          id: [...randomBytes(12)].map((b) => alphabet[b % 36]).join(""),
          entry: start.entry,
          at,
          updatedAt: at,
          moment: start.moment,
          lines: [],
        };
      } else {
        const found = await this.get(id);
        if (!found || found.entry !== start.entry) {
          throw new ApiError("not_found", "That conversation is not there any more.");
        }
        talk = found;
      }
      const next = Talk.parse(work(talk));
      await this.files.writeJson(this.file(next.id), next);
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async remove(id: string): Promise<void> {
    if (ID.test(id)) await this.files.remove(this.file(id));
  }
}
