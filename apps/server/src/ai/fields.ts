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
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { VaultIndex } from "../index/build.js";
import { collapse, type NewOperation, type ProposalStore } from "../proposals/store.js";
import type { StateFiles } from "../state/files.js";
import type { SettingsStore } from "../state/settings.js";
import type { ModelCatalogue } from "./models.js";
import type { AiProvider, AnswerSchema } from "./provider.js";

/** Changing the instructions changes this, so cached answers to the old ones are not reused. */
export const PROMPT_VERSION = 1;

const Answer = z.object({
  type: z.string().nullable(),
  time: z.array(z.object({ what: z.string(), when: z.string(), quote: z.string() })),
});
type Answer = z.infer<typeof Answer>;

const ANSWER: AnswerSchema<Answer> = {
  name: "entry_fields",
  check: Answer,
  json: {
    type: "object",
    additionalProperties: false,
    required: ["type", "time"],
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
    },
  },
};

function instructions(types: string[], what: string[]): string {
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
    if (!info) return null;
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

    const hash = createHash("sha256")
      .update(JSON.stringify([model, PROMPT_VERSION, this.d.index.schemaText, body]))
      .digest("hex");
    const cacheFile = join(this.d.stateDir, "ai-cache", `${hash}.json`);
    let answer = await this.d.files.readJson(cacheFile, Answer);
    if (!answer) {
      answer = await this.d.provider.complete({
        task: "extraction",
        system: instructions(types, what),
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
    return this.d.proposals.add(path, operations, model);
  }
}
