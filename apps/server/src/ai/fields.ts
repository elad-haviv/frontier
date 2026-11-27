/**
 * Proposes structured fields for an entry: its type and the dates its text states. The model
 * must give the sentence each date came from, and a date whose sentence is not in the entry is
 * dropped before the author ever sees it.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  isExcluded,
  isInAppendix,
  isNote,
  readFields,
  splitFrontmatter,
  typeFromFolder,
} from "@frontier/vault";
import type { RelKind } from "@frontier/schema";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { VaultIndex } from "../index/build.js";
import { collapse, type NewOperation, type ProposalStore } from "../proposals/store.js";
import type { StateFiles } from "../state/files.js";
import type { SettingsStore } from "../state/settings.js";
import type { ModelCatalogue } from "./models.js";
import type { AiProvider, AnswerSchema } from "./provider.js";
import { checkRelations, type PendingRelation, type ReadRelation } from "./relationProposals.js";

/**
 * Changing the instructions changes this, so cached answers to the old ones are not reused.
 * Version 2 (stage 31) also reads relations.
 */
export const PROMPT_VERSION = 2;

const Answer = z.object({
  type: z.string().nullable(),
  time: z.array(z.object({ what: z.string(), when: z.string(), quote: z.string() })),
  relations: z
    .array(
      z.object({
        what: z.string(),
        who: z.string(),
        with: z.string().nullable(),
        how: z.string().nullable(),
        when: z.string().nullable(),
        quote: z.string(),
        words: z.string(),
        stated: z.boolean(),
      }),
    )
    .default([]),
});
type Answer = z.infer<typeof Answer>;

const ANSWER: AnswerSchema<Answer> = {
  name: "entry_fields",
  check: Answer,
  json: {
    type: "object",
    additionalProperties: false,
    required: ["type", "time", "relations"],
    properties: {
      type: { type: ["string", "null"], description: "One of the listed types, or null." },
      time: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["what", "when", "quote"],
          properties: {
            what: { type: "string", description: "One of the listed names." },
            when: {
              type: "string",
              description: "The date or time relation, in the entry's own words.",
            },
            quote: {
              type: "string",
              description: "The exact sentence of the entry it comes from.",
            },
          },
        },
      },
      relations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["what", "who", "with", "how", "when", "quote", "words", "stated"],
          properties: {
            what: {
              type: "string",
              description: "One of the listed words, as seen from this entry.",
            },
            who: { type: "string", description: "The other one, named as the text names them." },
            with: {
              type: ["string", "null"],
              description: "For a child: the other parent, if named.",
            },
            how: {
              type: ["string", "null"],
              description: "Such as adopted or ended, only if said.",
            },
            when: {
              type: ["string", "null"],
              description: "When, in the text's words, only if said.",
            },
            quote: { type: "string", description: "The exact sentence it comes from." },
            words: {
              type: "string",
              description: "The exact words of that sentence that state it, with the name.",
            },
            stated: {
              type: "boolean",
              description: "True when the sentence says it; false when it can only be worked out.",
            },
          },
        },
      },
    },
  },
};

/** The kinds of relation in words for the model: each with its other way round and other words. */
function kindLines(kinds: RelKind[]): string[] {
  return kinds.map((k) => {
    const also = k.also?.length ? ` (also: ${k.also.join(", ")})` : "";
    if (!k.reverse) return `- "${k.name}"${also}: the same both ways.`;
    const back = k.reverseAlso?.length ? ` (also: ${k.reverseAlso.join(", ")})` : "";
    return `- "${k.name}"${also}: names the one above this entry. The other way round, "${k.reverse}"${back}: names the one below.`;
  });
}

function instructions(types: string[], what: string[], kinds: RelKind[]): string {
  return [
    "You read one entry from an author's fictional world and list what it states about time.",
    "",
    `Types of entry: ${types.join(", ")}.`,
    `Kinds of dated fact ("what"): ${what.join(", ")}.`,
    "",
    "Rules:",
    "- Take dates and time relations only from the text you are given. Invent nothing and infer nothing.",
    '- "when" repeats the entry\'s own words for the date or relation, such as "c. 340 EM" or',
    '  "a generation after the Exodus". Keep [[links]] as written. Never convert or calculate.',
    '- "quote" is the exact sentence of the entry that states it, copied character for character.',
    '- Use only the listed names for "what". If none fits, leave the fact out.',
    '- "type" is the listed type that fits the entry, or null when unsure.',
    "- Most entries state no dates. An empty list is a good answer.",
    "",
    "Relations: how the subject of this entry relates to others the text names. Words to use, as",
    "seen from this entry:",
    ...kindLines(kinds),
    "- Give each relation from this entry's side: in Wren's entry, \"daughter of Corin\" is",
    '  "parent" with who "Corin". Use only the listed words; if none fits, leave it out.',
    '- "who" names the other one as the text does. "with" is the other parent of a child, only',
    "  when the text names them.",
    '- "words" are the exact words of the quote that state the relation, holding both the word',
    '  for the relation and the name, such as "daughter of Corin Vane".',
    '- "how" (adopted, ended) and "when" only when the text says them in those words.',
    '- "stated" is true when the sentence says it outright, false when it can only be worked',
    "  out. Never guess a relation the text does not support.",
    "- Most entries state no relations. An empty list is a good answer.",
  ].join("\n");
}

export interface FieldProposerDeps {
  stateDir: string;
  files: StateFiles;
  index: VaultIndex;
  settings: SettingsStore;
  provider: AiProvider;
  proposals: ProposalStore;
  models: ModelCatalogue;
  /** Says why AI features may not read a note right now, or null when they may. */
  mayRead?: (path: string) => string | null;
  /** The kinds of relation in use (stage 31). */
  kinds?: () => RelKind[];
  /** The keys of every relation already written (`factKey`). */
  written?: () => Promise<Set<string>>;
}

export class FieldProposer {
  constructor(private readonly d: FieldProposerDeps) {}

  /** Why fields are never proposed for this path, or null. */
  private refusal(path: string): string | null {
    if (!isNote(path) || isExcluded(path)) return "Fields are proposed for notes only.";
    if (isInAppendix(path)) return "Fields are not proposed for appendix files.";
    if (!this.d.index.note(path)) return "This entry is not published yet. Publish it first.";
    return this.d.mayRead?.(path) ?? null;
  }

  /** The notes under a folder that a run would read. */
  candidates(folder: string): string[] {
    const prefix = folder.replace(/\/+$/, "") + "/";
    return this.d.index
      .allNotes()
      .map((n) => n.path)
      .filter((p) => (folder === "" || p.startsWith(prefix)) && this.refusal(p) === null);
  }

  /** A rough cost for a run over these notes, in US dollars, or null when the price is unknown. */
  async estimate(paths: string[]): Promise<number | null> {
    const model = (await this.d.settings.read())?.ai.models.extraction;
    const info = model ? await this.d.models.find(model) : undefined;
    if (!info || info.promptPrice === null) return null;
    let chars = 0;
    for (const p of paths) chars += splitFrontmatter(this.d.index.note(p)!.text).body.length;
    // About four characters to a token; the answer is taken as a fifth of what is sent.
    return ((chars / 4) * info.promptPrice * 1.2) / 1e6;
  }

  /**
   * Reads the published text of one entry and stores what is proposed for it. Returns the number
   * of new operations.
   */
  async propose(path: string): Promise<number> {
    const refused = this.refusal(path);
    if (refused) throw new ApiError("not_allowed", refused);
    const note = this.d.index.note(path)!;
    const body = splitFrontmatter(note.text).body;
    if (body.trim() === "") return 0;

    const settings = await this.d.settings.read();
    const model = settings?.ai.models.extraction;
    if (!model) {
      throw new ApiError(
        "ai_off",
        "No model is chosen for proposing fields. Choose one on the settings page.",
      );
    }
    const schema = this.d.index.schema;
    const types = Object.keys(schema.types);
    const what = Object.keys(schema.what);

    const kinds = this.d.kinds?.() ?? [];
    const hash = createHash("sha256")
      // OpenRouter ids were bare before stage 18; hashing them the same keeps earlier answers.
      .update(
        JSON.stringify([
          model.replace(/^openrouter:/, ""),
          PROMPT_VERSION,
          this.d.index.schemaText,
          body,
          kinds,
        ]),
      )
      .digest("hex");
    const cacheFile = join(this.d.stateDir, "ai-cache", `${hash}.json`);
    let answer = await this.d.files.readJson(cacheFile, Answer);
    if (!answer) {
      answer = await this.d.provider.complete({
        task: "extraction",
        system: instructions(types, what, kinds),
        user: `Entry: ${note.title}\n\n${body}`,
        schema: ANSWER,
        entry: path,
      });
      await this.d.files.writeJson(cacheFile, answer);
    }

    const existing = readFields(note.text);
    const flat = collapse(body);
    const operations: NewOperation[] = [];
    const seen = new Set<string>();
    for (const item of answer.time) {
      const when = item.when.trim();
      const quote = item.quote.trim();
      if (when === "" || quote === "" || !(item.what in schema.what)) continue;
      if (!flat.includes(collapse(quote))) continue;
      if (existing.time.some((t) => t.what === item.what && t.when === when)) continue;
      const key = `${item.what}\n${collapse(quote)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      operations.push({ op: "add_time", what: item.what, when, quote });
    }
    if (
      answer.type &&
      answer.type in schema.types &&
      existing.type === null &&
      answer.type !== typeFromFolder(schema, path)
    ) {
      operations.push({ op: "set_type", type: answer.type });
    }
    // Relations (stage 31): checked, matched, and merged with the other entry's proposal.
    const { ops, merges } = checkRelations({
      path,
      body,
      read: answer.relations as ReadRelation[],
      kinds,
      entries: this.d.index
        .allNotes()
        .map((n) => ({ path: n.path, title: n.title, aliases: n.aliases })),
      written: (await this.d.written?.()) ?? new Set(),
      pending: this.d.proposals.pendingRelations() as PendingRelation[],
    });
    operations.push(...ops);
    for (const m of merges) await this.d.proposals.addEvidence(m.proposal, m.op, m.also);
    await this.d.proposals.markRead(path);
    return (await this.d.proposals.add(path, operations, model)) + merges.length;
  }
}
