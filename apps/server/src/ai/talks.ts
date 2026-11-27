/**
 * Conversations with characters (stage 27, numbered 27 on main), kept as working files in
 * `/data/state/talks/<person id>/`, one file each. They are not lore: not in the library, its
 * history or any export. A conversation belongs to a character by the entry's id, so it follows
 * the entry when it is renamed or moved. All are kept until the person who had it deletes it.
 *
 * Each person's conversations are theirs alone, like lore conversations (stage 31): no route
 * answers with another person's, and a conversation id of someone else is `not_found`. A server
 * from before projects kept them straight in `talks/`; those belong to the project's first owner
 * (`legacyOwner`), read from there until the conversation is saved again, which moves it to their
 * folder.
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
    private readonly legacyOwner: () => string | null = () => null,
  ) {
    this.dir = join(stateDir, "talks");
  }

  private file(person: string, id: string): string {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(person)) throw new Error("Not a person id.");
    return join(this.dir, person, `${id}.json`);
  }

  private legacyFile(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async get(person: string, id: string): Promise<Talk | null> {
    if (!ID.test(id)) return null;
    const own = await this.files.readJson(this.file(person, id), Talk);
    if (own || person !== this.legacyOwner()) return own;
    return this.files.readJson(this.legacyFile(id), Talk);
  }

  /** A character's conversations of one person, the latest spoken in first. */
  async forEntry(person: string, entry: string): Promise<Talk[]> {
    const names = async (dir: string) => {
      try {
        return (await readdir(dir)).filter((n) => n.endsWith(".json") && ID.test(n.slice(0, -5)));
      } catch {
        return [];
      }
    };
    const ids = new Set((await names(join(this.dir, person))).map((n) => n.slice(0, -5)));
    if (person === this.legacyOwner()) {
      for (const n of await names(this.dir)) ids.add(n.slice(0, -5));
    }
    const all = await Promise.all([...ids].map((id) => this.get(person, id)));
    return all
      .filter((t): t is Talk => t !== null && t.entry === entry)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Changes a conversation of `person`, or starts one when `id` is null. `work` gets the
   * conversation as it is and answers it as it should be.
   */
  change(
    person: string,
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
        const found = await this.get(person, id);
        if (!found || found.entry !== start.entry) {
          throw new ApiError("not_found", "That conversation is not there any more.");
        }
        talk = found;
      }
      const next = Talk.parse(work(talk));
      await this.files.writeJson(this.file(person, next.id), next);
      if (person === this.legacyOwner()) await this.files.remove(this.legacyFile(next.id));
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async remove(person: string, id: string): Promise<void> {
    if (!ID.test(id)) return;
    await this.files.remove(this.file(person, id));
    if (person === this.legacyOwner()) await this.files.remove(this.legacyFile(id));
  }
}
