/**
 * Lore conversations, kept as working files in `/data/state/conversations/`. They are not lore:
 * not in the library, its history or its export.
 */
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { StateFiles } from "../state/files.js";

export const LoreAnswer = z.object({
  paragraphs: z.array(
    z.object({
      text: z.string(),
      sources: z.array(z.string()),
      /** Passages of its own sources, checked word for word. */
      quotes: z.array(z.object({ path: z.string(), text: z.string() })),
      /** True when at least one quote was found in one of its sources. */
      grounded: z.boolean(),
    }),
  ),
  related: z.array(z.object({ path: z.string(), why: z.string() })),
  missing: z.string(),
  /** How many quotes the model gave that were not in their entries, and were dropped. */
  droppedQuotes: z.number().int().min(0),
});
export type LoreAnswer = z.infer<typeof LoreAnswer>;

export const Turn = z.object({
  question: z.string(),
  answer: LoreAnswer,
  /** The entries the model was given, by path, in order. */
  given: z.array(z.string()),
  model: z.string(),
  costUsd: z.number(),
  at: z.string(),
  /** An addition drafted from this turn, kept here so asking again costs nothing. */
  addition: z
    .object({
      text: z.string(),
      /** A new entry's path the model proposed, when it passed the checks; null otherwise. */
      newPath: z.string().nullable(),
      model: z.string(),
      at: z.string(),
    })
    .nullable()
    .default(null),
  /** Set when that addition was kept as a draft. */
  kept: z.object({ path: z.string(), at: z.string() }).nullable().default(null),
  /** What was done to answer, as the page showed it while it worked; null on older turns. */
  trace: z
    .object({
      steps: z.array(
        z.object({
          kind: z.string(),
          text: z.string(),
          detail: z.string().optional(),
          entries: z.array(z.string()).optional(),
        }),
      ),
      /** The model's reasoning, for models that reason; empty for others. */
      reasoning: z.string(),
      /** How long the answer took, in milliseconds. */
      ms: z.number(),
    })
    .nullable()
    .default(null),
});
export type Turn = z.infer<typeof Turn>;

export const Conversation = z.object({
  id: z.string().regex(/^[a-z0-9]{12}$/),
  title: z.string(),
  at: z.string(),
  turns: z.array(Turn),
});
export type Conversation = z.infer<typeof Conversation>;

const ID = /^[a-z0-9]{12}$/;

/**
 * Each person's conversations are theirs alone: `conversations/<person id>/<id>.json`. A server
 * from before projects kept them straight in `conversations/`; those belong to the project's
 * first owner (`legacyOwner`), who is read from there until a conversation is saved again, which
 * moves it to their folder. Nothing is moved at start.
 */
export class Conversations {
  private readonly dir: string;

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
    private readonly legacyOwner: () => string | null = () => null,
  ) {
    this.dir = join(stateDir, "conversations");
  }

  private file(person: string, id: string): string {
    if (!ID.test(id)) throw new Error("Not a conversation id.");
    if (!/^[A-Za-z0-9-]{1,64}$/.test(person)) throw new Error("Not a person id.");
    return join(this.dir, person, `${id}.json`);
  }

  private legacyFile(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async get(person: string, id: string): Promise<Conversation | null> {
    if (!ID.test(id)) return null;
    const own = await this.files.readJson(this.file(person, id), Conversation);
    if (own || person !== this.legacyOwner()) return own;
    return this.files.readJson(this.legacyFile(id), Conversation);
  }

  async list(person: string): Promise<Conversation[]> {
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
      .filter((c): c is Conversation => c !== null)
      .sort((a, b) => (lastAt(b) < lastAt(a) ? -1 : 1));
  }

  async create(question: string, now = new Date()): Promise<Conversation> {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    const id = [...randomBytes(12)].map((b) => alphabet[b % 36]).join("");
    const title = question.trim().replace(/\s+/g, " ");
    return {
      id,
      title: title.length > 80 ? `${title.slice(0, title.lastIndexOf(" ", 79))} …` : title,
      at: now.toISOString(),
      turns: [],
    };
  }

  async save(person: string, conversation: Conversation): Promise<void> {
    await this.files.writeJson(
      this.file(person, conversation.id),
      Conversation.parse(conversation),
    );
    if (person === this.legacyOwner()) await this.files.remove(this.legacyFile(conversation.id));
  }

  async remove(person: string, id: string): Promise<void> {
    await this.files.remove(this.file(person, id));
    if (person === this.legacyOwner()) await this.files.remove(this.legacyFile(id));
  }
}

const lastAt = (c: Conversation): string => c.turns.at(-1)?.at ?? c.at;
