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

export class Conversations {
  private readonly dir: string;

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
  ) {
    this.dir = join(stateDir, "conversations");
  }

  private file(id: string): string {
    if (!ID.test(id)) throw new Error("Not a conversation id.");
    return join(this.dir, `${id}.json`);
  }

  async get(id: string): Promise<Conversation | null> {
    if (!ID.test(id)) return null;
    return this.files.readJson(this.file(id), Conversation);
  }

  async list(): Promise<Conversation[]> {
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

  async save(conversation: Conversation): Promise<void> {
    await this.files.writeJson(this.file(conversation.id), Conversation.parse(conversation));
  }

  async remove(id: string): Promise<void> {
    await this.files.remove(this.file(id));
  }
}

const lastAt = (c: Conversation): string => c.turns.at(-1)?.at ?? c.at;
