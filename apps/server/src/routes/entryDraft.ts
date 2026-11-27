import { randomBytes } from "node:crypto";
import type { RouteApp } from "../projects/facade.js";
import { makeId } from "@frontier/schema";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { cleanTitle, DRAFT_LIMITS } from "../ai/draftEntry.js";
import type { Services } from "../app.js";
import { whileAsked } from "./writing.js";

const Paragraphs = z
  .array(z.string().trim().min(1).max(DRAFT_LIMITS.paragraphChars))
  .min(1)
  .max(DRAFT_LIMITS.paragraphs);

const Said = z.object({ said: z.string().trim().min(1).max(DRAFT_LIMITS.said) });
const Check = z.object({
  title: z.string().max(200),
  paragraphs: Paragraphs,
  changed: z
    .number()
    .int()
    .min(0)
    .max(DRAFT_LIMITS.paragraphs - 1),
});
const Keep = z.object({
  title: z.string().max(200),
  folder: z.string().min(1).max(300),
  paragraphs: Paragraphs,
  /** Lines the author kept although an entry says otherwise, with the entry. */
  againstLore: z
    .array(z.object({ paragraph: z.number().int().min(0), path: z.string().max(500) }))
    .max(DRAFT_LIMITS.paragraphs)
    .default([]),
});

/** A note in the draft that no reader sees but the next person reading the file. */
const marker = (title: string) => `<!-- kept against the lore: ${title.replace(/[<>-]/g, " ")} -->`;

export function entryDraftRoutes(app: RouteApp, s: Services): void {
  /** A new entry drafted from what the author said. Nothing is saved. */
  app.post("/api/lore/draft", async (request, reply) => {
    const { said } = Said.parse(request.body);
    return { draft: await s.drafter.propose(said, { signal: whileAsked(reply) }) };
  });

  /** One changed paragraph checked against the lore again. Nothing is saved. */
  app.post("/api/lore/draft/check", async (request, reply) => {
    const input = Check.parse(request.body);
    return s.drafter.check(input, { signal: whileAsked(reply) });
  });

  /** Keeps the draft as an unsaved change: a new entry that waits to be published. */
  app.post("/api/lore/draft/keep", async (request) => {
    const input = Keep.parse(request.body);
    const title = cleanTitle(input.title);
    if (title === "") throw new ApiError("invalid", "Give the entry a title first.");
    const folder = input.folder.replace(/^\/+|\/+$/g, "");
    const inKnownFolder = s.index
      .allNotes()
      .some((n) => n.path.split("/").slice(0, -1).join("/") === folder);
    if (!s.drafter.okFolder(folder) || !inKnownFolder) {
      throw new ApiError("not_allowed", "An entry cannot go in that folder.");
    }
    const path = `${folder}/${title}.md`;
    if (s.drafter.existing(title) || s.index.note(path) || s.drafts.byPath(path)) {
      throw new ApiError("not_allowed", `An entry called "${title}" exists. Choose another title.`);
    }
    const lines = [...input.paragraphs];
    for (const a of input.againstLore) {
      const note = s.index.note(a.path);
      if (!note || a.paragraph >= lines.length) {
        throw new ApiError("invalid", "A line was kept against an entry that does not exist.");
      }
      lines[a.paragraph] = `${lines[a.paragraph]} ${marker(note.title)}`;
    }
    const content = `# ${title}\n\n${lines.join("\n\n")}\n`;
    const id = makeId(randomBytes);
    const model = await s.drafter.model();
    const draft = await s.drafts.saveFrom({
      id,
      path,
      kind: "create",
      content,
      baseBlob: "",
      lineEnding: "lf",
      origin: { kind: "lore", ref: `voice/${id}`, model },
    });
    s.status.drafts(s.drafts.count(), 0);
    return { draft: draft?.id ?? id, path };
  });
}
