/**
 * Stage 25, keep going: what the routes ask for. Each answer is worked out from the published
 * index (see `derived.ts`); Link it changes an entry through the entry changer, so it is an
 * ordinary unpublished draft, and a device that started from older text is told as for any save.
 */
import {
  type AfterPublishResponse,
  type AfterPublishStep,
  type FromHereResponse,
  isStub,
  type LinkItRequest,
  type LinkItResponse,
  type LinkItUndo,
  NeedsLoveRules,
  type QueueResponse,
  type RandomQuery,
  type RandomResponse,
} from "@frontier/schema";
import { bodyWords } from "@frontier/vault";
import type { EntryChanger } from "../entries/change.js";
import { ApiError } from "../errors.js";
import type { VaultIndex } from "../index/build.js";
import type { CommentStore } from "../comments/store.js";
import type { FolderStore } from "../folders/store.js";
import type { DraftStore } from "../state/drafts.js";
import type { SettingsStore } from "../state/settings.js";
import type { StatusService } from "../status/status.js";
import { derive, factsOf, listable, wantedKey } from "./derived.js";
import { fromHereParts } from "./fromHere.js";
import type { KeepGoingHistory } from "./history.js";
import { linkFirstMention, unlinkedMentions } from "./mentions.js";
import { buildQueue, wantedRow } from "./queue.js";

export interface KeepGoingDeps {
  index: VaultIndex;
  drafts: DraftStore;
  comments: CommentStore;
  settings: SettingsStore;
  folders: FolderStore;
  changer: EntryChanger;
  status: StatusService;
  history: KeepGoingHistory;
  random?: () => number;
}

export class KeepGoing {
  constructor(private readonly d: KeepGoingDeps) {}

  private random(): number {
    return this.d.random?.() ?? Math.random();
  }

  /** The needs-love rules in force; all on until the author switches one off. */
  async rules(): Promise<NeedsLoveRules> {
    return (await this.d.settings.read())?.keepGoing.needsLove ?? NeedsLoveRules.parse({});
  }

  async queue(): Promise<QueueResponse> {
    return buildQueue(
      derive(this.d.index),
      await this.rules(),
      await this.d.comments.counts(),
      this.d.folders.file(),
    );
  }

  /** Words of body text of an entry, published or only a draft; 0 when there is none. */
  wordsOf(path: string): number {
    const note = this.d.index.note(path);
    if (note) return factsOf(note).words;
    const draft = this.d.drafts.byPath(path);
    return draft && !draft.binary && draft.kind !== "delete"
      ? bodyWords(this.d.drafts.textNow(draft.id))
      : 0;
  }

  titleOf(path: string): string {
    return this.d.index.note(path)?.title ?? (path.split("/").pop() ?? path).replace(/\.md$/i, "");
  }

  async fromHere(path: string): Promise<FromHereResponse> {
    const note = this.d.index.note(path);
    const draft = this.d.drafts.byPath(path);
    if (!note && (!draft || draft.kind === "delete")) {
      throw new ApiError("not_found", `There is no note at "${path}".`);
    }
    if (!note) {
      // An entry that is only a draft has no links in the library and no neighbours yet.
      return {
        path,
        missing: [],
        unlinked: [],
        unlinkedMore: false,
        thin: [],
        related: [],
        previous: null,
        next: null,
      };
    }
    const d = derive(this.d.index);
    const { mentions, more } = unlinkedMentions(this.d.index, note);
    return {
      path,
      ...fromHereParts(this.d.index, d, note, await this.rules(), await this.d.comments.counts()),
      unlinked: mentions,
      unlinkedMore: more,
    };
  }

  // ---- Link it ----------------------------------------------------------------------------

  /** Links the first mention of `target` in `path`, saved as an ordinary draft of that entry. */
  async linkIt(input: LinkItRequest): Promise<LinkItResponse> {
    const to = this.d.index.note(input.target);
    if (!to) throw new ApiError("not_found", `There is no entry at "${input.target}".`);
    const text = await this.d.changer.text(input.path);
    if (text === null) throw new ApiError("not_found", `There is no note at "${input.path}".`);
    const linked = linkFirstMention(this.d.index, input.path, text, to);
    if (!linked) {
      throw new ApiError(
        "not_found",
        `"${to.title}" is not named without a link in "${this.titleOf(input.path)}" any more.`,
      );
    }
    const hadDraft = this.d.drafts.byPath(input.path) !== undefined;
    const record = await this.d.changer.apply(input.path, () => linked.text);
    return {
      path: input.path,
      before: linked.before,
      after: linked.after,
      undo: {
        path: input.path,
        draftId: record!.id,
        revision: record!.revision,
        previousText: hadDraft ? text : null,
      },
    };
  }

  /**
   * Takes a Link it back: the draft goes back to its text before, or goes away when the entry had
   * none. Refused when the draft has changed since, so nothing typed meanwhile is lost.
   */
  async undoLinkIt(undo: LinkItUndo): Promise<void> {
    const draft = this.d.drafts.get(undo.draftId);
    if (!draft || draft.path !== undo.path) {
      throw new ApiError("not_found", "That change is not there any more.");
    }
    if (draft.revision !== undo.revision) {
      throw new ApiError(
        "not_allowed",
        "This entry was changed after the link was made. Undo it in the editor.",
      );
    }
    if (undo.previousText === null) await this.d.drafts.discard(draft.id);
    else await this.d.drafts.serverChange(draft.id, undo.previousText);
    this.d.status.drafts(this.d.drafts.count(), 0);
    this.d.status.serverChangedDraft();
  }

  // ---- Random entry and after Publish --------------------------------------------------------

  private pick<T>(list: readonly T[]): T | undefined {
    return list.length === 0 ? undefined : list[Math.floor(this.random() * list.length)];
  }

  async randomEntry(query: RandomQuery): Promise<RandomResponse> {
    const kind = query.kind ?? "any";
    const d = derive(this.d.index);
    let pool = d.entries.filter((n) => n.path !== query.not);
    if (kind === "stub") pool = pool.filter((n) => isStub(factsOf(n).words));
    if (kind === "folder") {
      const folder = (query.folder ?? "").replace(/^\/+|\/+$/g, "");
      if (folder === "") throw new ApiError("invalid", "Say which folder to pick from.");
      pool = pool.filter((n) => n.path.startsWith(`${folder}/`));
    }
    if (kind === "old") {
      const old = await this.d.history.untouched();
      pool = pool.filter((n) => old.has(n.path));
    }
    const note = this.pick(pool);
    return {
      entry: note ? { path: note.path, title: note.title, words: factsOf(note).words } : null,
    };
  }

  /** Up to three next steps after publishing `paths`. */
  async afterPublish(paths: string[]): Promise<AfterPublishResponse> {
    const d = derive(this.d.index);
    const published = paths.map((p) => d.byPath.get(p)).filter((n) => n !== undefined);
    const ref = (n: { path: string; title: string }) => ({ path: n.path, title: n.title });
    const steps: AfterPublishStep[] = [];

    // A stub one of them links to, the most linked first.
    const stubs = new Map<string, string>();
    for (const note of published) {
      for (const to of d.outbound.get(note.path) ?? []) {
        const target = d.byPath.get(to);
        if (target && listable(to) && isStub(factsOf(target).words) && !stubs.has(to)) {
          stubs.set(to, note.path);
        }
      }
    }
    const stub = [...stubs]
      .map(([path, from]) => ({ note: d.byPath.get(path)!, from: d.byPath.get(from)! }))
      .sort(
        (a, b) =>
          (d.inbound.get(b.note.path)?.length ?? 0) - (d.inbound.get(a.note.path)?.length ?? 0) ||
          a.note.title.localeCompare(b.note.title),
      )[0];
    if (stub) {
      steps.push({
        kind: "stub",
        ...ref(stub.note),
        words: factsOf(stub.note).words,
        from: ref(stub.from),
      });
    }

    // A link in one of them that has no entry, the most mentioned first.
    const missing = new Map<string, { key: string; from: (typeof published)[number] }>();
    for (const note of published) {
      for (const { link, resolution } of note.links) {
        if (resolution.kind !== "unresolved" || link.kind !== "wikilink" || link.embed) continue;
        const key = wantedKey(link.target);
        if (d.wanted.has(key) && !missing.has(key)) missing.set(key, { key, from: note });
      }
    }
    const wanted = [...missing.values()]
      .map(({ key, from }) => ({ row: wantedRow(d, d.wanted.get(key)!), from }))
      .sort((a, b) => b.row.mentions - a.row.mentions || a.row.name.localeCompare(b.row.name))[0];
    if (wanted) {
      steps.push({
        kind: "missing",
        name: wanted.row.name,
        mentions: wanted.row.mentions,
        folder: wanted.row.folder,
        from: ref(wanted.from),
      });
    }

    // An entry nobody has touched for six months, not one just published.
    const old = await this.d.history.untouched();
    const note = this.pick(d.entries.filter((n) => old.has(n.path) && !paths.includes(n.path)));
    if (note) steps.push({ kind: "old", ...ref(note) });
    return { steps };
  }
}
