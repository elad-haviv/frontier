/**
 * Stage 25, keep going: what the routes ask for. Each answer is worked out from the published
 * index (see `derived.ts`); Link it changes an entry through the entry changer, so it is an
 * ordinary unpublished draft, and a device that started from older text is told as for any save.
 */
import { randomBytes } from "node:crypto";
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
import { savedViewOnly } from "../projects/view.js";

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
  now?: () => Date;
}

/** How long a Link it can be taken back, and how many are remembered at once. */
export const UNDO_MINUTES = 15;
const UNDO_KEPT = 200;

/** What the server remembers of a Link it, so that Undo does not rely on what a page sends back. */
interface UndoRecord {
  path: string;
  draftId: string;
  revision: number;
  /** The draft's text before the change; null when the entry had no draft. */
  previousText: string | null;
  expires: number;
}

export class KeepGoing {
  private readonly undos = new Map<string, UndoRecord>();

  constructor(private readonly d: KeepGoingDeps) {}

  private clock(): number {
    return (this.d.now?.() ?? new Date()).getTime();
  }

  private random(): number {
    return this.d.random?.() ?? Math.random();
  }

  /** The needs-love rules in force; all on until the author switches one off. */
  async rules(): Promise<NeedsLoveRules> {
    return (await this.d.settings.current()).keepGoing.needsLove;
  }

  /**
   * Open comments per entry. Comments are writers' (stage 27e makes them shared), so a reader,
   * whose requests run in the saved view, is told there are none: not even their number.
   */
  private async commentCounts(): Promise<ReadonlyMap<string, number>> {
    return savedViewOnly() ? new Map<string, number>() : this.d.comments.counts();
  }

  async queue(): Promise<QueueResponse> {
    return buildQueue(
      derive(this.d.index),
      await this.rules(),
      await this.commentCounts(),
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
      ...fromHereParts(this.d.index, d, note, await this.rules(), await this.commentCounts()),
      unlinked: mentions,
      unlinkedMore: more,
    };
  }

  // ---- Link it ----------------------------------------------------------------------------

  /** Links the first mention of `target` in `path`, saved as an ordinary draft of that entry. */
  async linkIt(input: LinkItRequest): Promise<LinkItResponse> {
    const to = this.d.index.note(input.target);
    if (!to) throw new ApiError("not_found", `There is no entry at "${input.target}".`);
    // The work is done on the text the changer hands over when it applies the change, so a save
    // that landed since an earlier read is part of it and is never overwritten.
    let made: { linked: NonNullable<ReturnType<typeof linkFirstMention>>; text: string } | null =
      null;
    let hadDraft = false;
    const record = await this.d.changer.apply(input.path, (text, had) => {
      const linked = linkFirstMention(this.d.index, input.path, text, to);
      if (!linked) {
        throw new ApiError(
          "not_found",
          `"${to.title}" is not named without a link in "${this.titleOf(input.path)}" any more.`,
        );
      }
      made = { linked, text };
      hadDraft = had;
      return linked.text;
    });
    const { linked, text } = made!;
    return {
      path: input.path,
      before: linked.before,
      after: linked.after,
      undo: this.rememberUndo({
        path: input.path,
        draftId: record!.id,
        revision: record!.revision,
        previousText: hadDraft ? text : null,
      }),
    };
  }

  /** Keeps what Undo needs for a while, under a token nobody can guess. */
  private rememberUndo(record: Omit<UndoRecord, "expires">): LinkItUndo {
    const now = this.clock();
    for (const [token, kept] of this.undos) if (kept.expires <= now) this.undos.delete(token);
    // The oldest go first when too many are kept (a Map lists in the order it was added).
    for (const token of this.undos.keys()) {
      if (this.undos.size < UNDO_KEPT) break;
      this.undos.delete(token);
    }
    const token = randomBytes(24).toString("base64url");
    this.undos.set(token, { ...record, expires: now + UNDO_MINUTES * 60_000 });
    return { token };
  }

  /**
   * Takes a Link it back: the draft goes back to its text before, or goes away when the entry had
   * none. Refused when the draft has changed since, so nothing typed meanwhile is lost.
   */
  async undoLinkIt(undo: LinkItUndo): Promise<void> {
    const kept = this.undos.get(undo.token);
    if (!kept || kept.expires <= this.clock()) {
      this.undos.delete(undo.token);
      throw new ApiError(
        "not_found",
        `This link can be taken back for ${UNDO_MINUTES} minutes only, and it is not there any more. Undo it in the editor.`,
      );
    }
    const draft = this.d.drafts.get(kept.draftId);
    if (!draft || draft.path !== kept.path) {
      this.undos.delete(undo.token);
      throw new ApiError("not_found", "That change is not there any more.");
    }
    if (draft.revision !== kept.revision) {
      throw new ApiError(
        "not_allowed",
        "This entry was changed after the link was made. Undo it in the editor.",
      );
    }
    this.undos.delete(undo.token);
    if (kept.previousText === null) await this.d.drafts.discard(draft.id);
    else await this.d.drafts.serverChange(draft.id, kept.previousText);
    this.d.status.drafts(this.d.drafts.count(), 0);
    this.d.drafts.noteServerChange();
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
