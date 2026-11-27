import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  AddRelationRequest,
  kindsOf,
  makeId,
  type RelationsResponse,
  RemoveRelationRequest,
  type TreesFile,
} from "@frontier/schema";
import {
  createResolver,
  dirname,
  findLinks,
  isNote,
  readRelations,
  setRelations,
  stem,
} from "@frontier/vault";
import type { Services } from "../app.js";
import { overlay } from "../entries/overlay.js";
import { ApiError } from "../errors.js";
import { collectRelations } from "../relations/collect.js";

const UNREADABLE =
  "The relations of this entry cannot be read. Correct them in the text first, under Properties.";

/**
 * Relations between entries (stage 30): every entry's `relations` gathered into facts, and the
 * two changes a tree or the Relations tab makes, each to one entry only: add an item, or take one
 * off. A new name can also be made an entry, in the folder of the entry it is written on.
 */
export function relationRoutes(app: FastifyInstance, s: Services): void {
  const changed = () => s.status.drafts(s.drafts.count(), 0);
  const madeKinds = () => (s.libraryFiles.current("trees").file as TreesFile).kinds;

  /** Every note's path and the text the author sees, with the file list links resolve against. */
  async function library() {
    const { added, removed } = overlay(s);
    const notes: { path: string; text: string }[] = [];
    for (const note of s.index.allNotes()) {
      if (removed.includes(note.path)) continue;
      notes.push({ path: note.path, text: note.text });
    }
    const drafted = new Map<string, string>();
    for (const d of s.drafts.list()) {
      if (d.kind !== "delete" && !d.binary && isNote(d.path))
        drafted.set(d.path, await s.drafts.text(d.id));
    }
    for (const n of notes) if (drafted.has(n.path)) n.text = drafted.get(n.path)!;
    for (const path of added)
      if (isNote(path) && drafted.has(path)) notes.push({ path, text: drafted.get(path)! });
    const files = [...s.index.files.filter((f) => !removed.includes(f)), ...added];
    return { notes, files };
  }

  app.get("/api/relations", async (): Promise<RelationsResponse> => {
    const { notes, files } = await library();
    return collectRelations({ notes, files, schema: s.index.schema, kinds: kindsOf(madeKinds()) });
  });

  /** How the entry at `target` is best linked from `from`: by its title, or by its path when the title is not enough. */
  function linkTo(target: string, from: string, files: string[]): string {
    const resolver = createResolver(files);
    const byTitle = `[[${stem(target)}]]`;
    const r = resolver.resolve(findLinks(byTitle)[0]!, from);
    return r.kind === "note" && r.path === target ? byTitle : `[[${target.replace(/\.md$/i, "")}]]`;
  }

  app.post("/api/relations", async (request) => {
    const input = AddRelationRequest.parse(request.body);
    const { files } = await library();
    const known = new Set(files);
    /** A path of an existing entry becomes a link; a title or a link is written as a link. */
    const asLink = (who: string) =>
      known.has(who) && isNote(who)
        ? linkTo(who, input.path, files)
        : who.includes("[[")
          ? who
          : `[[${who.replace(/[[\]|#^]/g, "").trim()}]]`;
    let made: string | null = null;
    if (input.create && !known.has(input.who)) {
      const title = input.who.replace(/[[\]|#^\\/:"*?<>]/g, "").trim();
      if (title === "") throw new ApiError("invalid", "The new entry needs a name.");
      const folder = dirname(input.path);
      const path = folder ? `${folder}/${title}.md` : `${title}.md`;
      if (s.index.note(path) || s.drafts.byPath(path) || known.has(path)) {
        throw new ApiError(
          "not_allowed",
          `An entry called "${title}" exists. Pick it from the list.`,
        );
      }
      await s.drafts.saveFrom({
        id: makeId(randomBytes),
        path,
        kind: "create",
        content: `# ${title}\n\n`,
        baseBlob: "",
        lineEnding: "lf",
      });
      made = path;
    }
    const item = {
      what: input.what,
      who: made ? `[[${stem(made)}]]` : asLink(input.who),
      ...(input.with ? { with: asLink(input.with) } : {}),
      ...(input.how ? { how: input.how } : {}),
      ...(input.when ? { when: input.when } : {}),
    };
    const draft = await s.changer.apply(input.path, (text) => {
      const now = readRelations(text);
      if (now.problems.length > 0) throw new ApiError("not_allowed", UNREADABLE);
      const same = now.items.some(
        (i) => i.what.toLowerCase() === item.what.toLowerCase() && i.who === item.who,
      );
      return same ? text : setRelations(text, [...now.items, item]);
    });
    changed();
    return { ok: true as const, draft: draft?.id ?? null, made, item };
  });

  app.post("/api/relations/remove", async (request) => {
    const input = RemoveRelationRequest.parse(request.body);
    await s.changer.apply(input.path, (text) => {
      const now = readRelations(text);
      if (now.problems.length > 0) throw new ApiError("not_allowed", UNREADABLE);
      const item = now.items[input.index];
      if (!item || item.what !== input.what || item.who !== input.who) {
        throw new ApiError("changed", "This entry's relations changed meanwhile. Look again.");
      }
      return setRelations(
        text,
        now.items.filter((_, i) => i !== input.index),
      );
    });
    changed();
    return { ok: true as const };
  });
}
