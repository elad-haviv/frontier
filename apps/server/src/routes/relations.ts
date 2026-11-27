import { randomBytes } from "node:crypto";
import type { RouteApp } from "../projects/facade.js";
import {
  AddRelationRequest,
  findKind,
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
export function relationRoutes(app: RouteApp, s: Services): void {
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
    const kinds = kindsOf(madeKinds());
    const r = collectRelations({ notes, files, schema: s.index.schema, kinds });
    // Stage 33: what the AI proposed, as facts with where to decide them.
    const people = new Map(r.people.map((p) => [p.key, p]));
    const texts = new Map(notes.map((n) => [n.path, n.text]));
    const person = (key: string) => {
      if (people.has(key)) return;
      const p = collectRelations({
        notes: key.startsWith("?") ? [] : [{ path: key, text: texts.get(key) ?? "" }],
        files,
        schema: s.index.schema,
        kinds,
      });
      people.set(
        key,
        p.people.find((x) => x.key === key) ?? {
          key,
          title: key.startsWith("?") ? key.slice(1) : stem(key),
          path: key.startsWith("?") ? null : key,
          type: null,
          born: null,
          died: null,
          dates: null,
        },
      );
    };
    const proposed: NonNullable<RelationsResponse["proposed"]> = [];
    for (const op of s.proposals.pendingRelations()) {
      const found = findKind(kinds, op.what);
      if (!found) continue;
      const whoKey = op.whoPath ?? `?${op.who}`;
      const [a, b] = found.kind.reverse
        ? found.reversed
          ? [op.path, whoKey]
          : [whoKey, op.path]
        : op.path < whoKey
          ? [op.path, whoKey]
          : [whoKey, op.path];
      person(a);
      person(b);
      const withKey = op.withPath ?? (op.with ? `?${op.with}` : null);
      if (withKey) person(withKey);
      proposed.push({
        kind: found.kind.name,
        a,
        b,
        with: withKey,
        how: op.how,
        when: op.when,
        proposal: op.proposal,
        op: op.id,
        path: op.path,
        word: op.what,
        who: op.who,
        whoPath: op.whoPath,
        quote: op.quote,
        words: op.words,
        stated: op.stated,
        also: op.also,
        match: op.match,
        maybe: op.maybe,
        warning: s.proposals.warnFor(op.path, op),
      });
    }
    return {
      ...r,
      people: [...people.values()].sort((x, y) => x.title.localeCompare(y.title)),
      proposed,
      unread: s.proposals.unreadCount(s.fields.candidates("")),
    };
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
