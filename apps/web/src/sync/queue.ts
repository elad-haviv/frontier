/**
 * The save queue: every change to entry text, maps and chronicles goes through here.
 *
 * Pages put a file's new value and subscribe to its key. The record is written to the device's
 * storage at once and stays there until the server confirms it, so it survives a reload. One tab
 * per browser sends, while it holds the Web Lock `frontier-sender`; the others hand their changes
 * to it through the storage and a broadcast channel, and hear its answers the same way.
 *
 * Records for different files are independent: each has its own back-off, and one that is waiting
 * or needs attention does not hold up the others. Sending pauses only while the connection service
 * says offline or signed out.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  type AnyLibraryFile,
  type ChronicleFile,
  type DraftKind,
  type LibraryFileName,
  libraryFileNamed,
  type MapFile,
  mergeChronicles,
  mergeLibraryFile,
  mergeMaps,
  unionClashes,
} from "@frontier/schema";
import { api, ApiFailure, fromServer, setDevice } from "../api.ts";
import { type Connection, connection as appConnection } from "./connection.ts";
import { migrateBuffers } from "./migrate.ts";
import {
  type Device,
  deviceOf,
  type LinkItem,
  openStore,
  type QueueKey,
  type QueueRecord,
  randomId,
  type Store,
} from "./db.ts";

export type { LinkItem, QueueKey, QueueRecord } from "./db.ts";

/** What a new record starts from, and what a page should start its next record from. */
export interface Known {
  draftId: string;
  revision: number;
  baseBlob?: string | undefined;
  /** Item files: the value the server last confirmed. */
  base?: unknown;
}

export interface PutMeta extends Partial<Known> {
  /** Entries: `edit`, `create` or `delete`. Each put may change it. */
  kind?: DraftKind;
  /** Features or spans to link; combined with what the record already carries, by id. */
  link?: LinkItem[];
  /** How long to wait for more changes before sending, in milliseconds. */
  delay?: number;
}

export type QueueEvent =
  /** The record changed: put, sent, failed, or gone (undefined). */
  | { type: "record"; key: QueueKey; record: QueueRecord | undefined }
  /** The server confirmed a send. `value` is what it stored; it may differ from `sent`. */
  | {
      type: "saved";
      key: QueueKey;
      sent: unknown;
      value: unknown;
      /** The links the send carried. */
      link: { id: string; path: string }[];
      unlinked: { id: string; reason: string }[];
      known: Known;
    }
  /** Another device saved the item file first; the two were merged and the result is on its way. */
  | { type: "merged"; key: QueueKey; value: unknown; clashes: string[]; known: Known }
  /** An entry started from older text: the server kept it beside the draft `draftId`. */
  | { type: "stale"; key: QueueKey; draftId: string };

/** A message for the author about a file, such as two texts to compare. */
export interface Notice {
  key: QueueKey;
  message: string;
  /** Where to look, when there is a page for it. */
  href?: string;
  /** What the way to `href` is called, such as "Compare"; "Open" when not given. */
  label?: string;
  /** Said even when the file's page is open, which does not say it itself. */
  always?: boolean;
  /** True when a page subscribed to the file is open in this tab and shows it itself. */
  watched: boolean;
}

/** The server calls the queue makes. Tests give their own. */
export interface SenderApi {
  saveDraft: typeof api.saveDraft;
  saveMap: typeof api.saveMap;
  saveChronicle: typeof api.saveChronicle;
  map: (id: string) => Promise<{ map: MapFile; revision: number; blob: string }>;
  chronicle: (id: string) => Promise<{ chronicle: ChronicleFile; revision: number; blob: string }>;
  saveLibraryFile: typeof api.saveLibraryFile;
  libraryFile: (
    name: LibraryFileName,
  ) => Promise<{ file: unknown; revision: number; blob: string }>;
}

export interface QueueDeps {
  open: () => Promise<Store>;
  api: SenderApi;
  connection: Pick<Connection, "state" | "subscribe">;
  locks?: LockManager | undefined;
  channel?: () => BroadcastChannel | null;
  now?: () => number;
  /**
   * Run once the storage is open and before any page reads the queue, as to move in what an
   * earlier build kept elsewhere. It reads and puts through what it is given.
   */
  migrate?: (queue: Pick<Queue, "get" | "put">) => Promise<unknown>;
}

/** How long a page's changes wait for more before they are sent. */
export const PAUSE_MS = 1000;
/** Back-off after a failed send: 2, 4, 8 … up to 60 seconds. */
export const backoff = (tries: number): number => Math.min(60, 2 ** tries) * 1000;

const CHANNEL = "frontier-queue";
const LOCK = "frontier-sender";

type Message =
  | { type: "changed"; key: QueueKey }
  | { type: "cleared" }
  | { type: "event"; event: QueueEvent }
  | { type: "notice"; notice: Omit<Notice, "watched"> }
  | { type: "send"; key: QueueKey };

/** What a send's answer gives, whatever the kind of file. */
interface Answer {
  value: unknown;
  unlinked: { id: string; reason: string }[];
  known: Known;
  /** The draft the server kept the other side of the record's clashes beside (stage 15c). */
  kept?: string | undefined;
}

/** The library item file a key names, such as the folder file; undefined for any other key. */
export const libraryKindOf = (key: QueueKey): AnyLibraryFile | undefined =>
  key.includes(":") ? undefined : libraryFileNamed(key);

/** The kind of file a key names. A key of no known kind is a mistake in the code. */
export function kindOf(key: QueueKey): "entry" | "map" | "chronicle" | "library" {
  if (key.startsWith("entry:")) return "entry";
  if (key.startsWith("map:")) return "map";
  if (key.startsWith("chronicle:")) return "chronicle";
  if (libraryKindOf(key)) return "library";
  throw new Error(`"${key}" is not a key of the save queue.`);
}

/** The part of the key after its kind: the path of an entry, the id of a map or a chronicle. */
export const subject = (key: QueueKey): string => key.slice(key.indexOf(":") + 1);

/** A file's name for the author: an entry's name, a map's or chronicle's title, a file's label. */
export function nameOf(record: Pick<QueueRecord, "key" | "value">): string {
  const library = libraryKindOf(record.key);
  if (library) return library.label;
  if (kindOf(record.key) === "entry") {
    return (subject(record.key).split("/").pop() ?? "").replace(/\.md$/i, "");
  }
  const title = (record.value as { title?: unknown } | null)?.title;
  return typeof title === "string" && title ? title : subject(record.key);
}

/** The items a map or chronicle keeps in lists, by id, for naming what clashed. */
function itemsOf(value: unknown): { id: string; label?: unknown; name?: unknown }[] {
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap((v) =>
    Array.isArray(v) ? (v as { id: string; label?: unknown; name?: unknown }[]) : [],
  );
}

/**
 * Names what clashed in a merge: an item's label or name, or the property's own name. A library
 * file's items are named by their key, such as a folder's path.
 */
export function clashNames(value: unknown, clashes: string[]): string[] {
  const items = itemsOf(value);
  return clashes.map((c) => {
    const item = items.find((i) => i?.id === c);
    const name = item?.label ?? item?.name;
    return typeof name === "string" && name ? name : c;
  });
}

/** Names the clashing items of a sent record: by this side's item, else by the other side's. */
function sentClashNames(record: QueueRecord): string[] {
  return (record.clashes ?? []).map((c) => {
    const mine = clashNames(record.value, [c])[0]!;
    return mine !== c ? mine : clashNames(record.base, [c])[0]!;
  });
}

/** Where this device's side of a clash now is, for the notice: "the map", "the folder list". */
function whereKept(key: QueueKey): string {
  const library = libraryKindOf(key);
  if (library) return library.noun === "folders" ? "the folder list" : `the ${library.noun}`;
  return kindOf(key) === "map" ? "the map" : "the chronicle";
}

/** Puts the entries the server wrote for linked features or spans into `value`. */
function withLinked(key: QueueKey, value: unknown, saved: unknown, ids: Set<string>): unknown {
  if (ids.size === 0) return value;
  const list = kindOf(key) === "map" ? "features" : "spans";
  const from = new Map(
    ((saved as Record<string, { id: string; entry: string | null }[]>)[list] ?? []).map((i) => [
      i.id,
      i.entry,
    ]),
  );
  const v = value as Record<string, { id: string; entry: string | null }[]>;
  return {
    ...v,
    [list]: (v[list] ?? []).map((i) =>
      ids.has(i.id) && from.has(i.id) ? { ...i, entry: from.get(i.id)! } : i,
    ),
  };
}

/** Two link lists combined: a later link for the same feature or span replaces the earlier. */
function combine(earlier: LinkItem[] = [], later: LinkItem[] = []): LinkItem[] {
  const out = new Map(earlier.map((l) => [l.id, l]));
  for (const l of later) out.set(l.id, l);
  return [...out.values()];
}

export class Queue {
  private store: Store | null = null;
  private starting: Promise<void> | null = null;
  private cache = new Map<QueueKey, QueueRecord>();
  private subs = new Map<QueueKey, Set<(event: QueueEvent) => void>>();
  private listListeners = new Set<() => void>();
  private noticeListeners = new Set<(notice: Notice) => void>();
  private clearedListeners = new Set<() => void>();
  private opening: Promise<Store> | null = null;
  private inFlight = new Set<QueueKey>();
  /** Calls waiting for a key to be sent, by key. */
  private waiting = new Map<QueueKey, (() => void)[]>();
  private sender = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private channel: BroadcastChannel | null = null;
  private releaseLock: (() => void) | null = null;
  private stopConnection: (() => void) | null = null;
  private records: QueueRecord[] = [];
  private readonly now: () => number;
  device: Device | null = null;

  constructor(private readonly d: QueueDeps) {
    this.now = d.now ?? Date.now;
  }

  /** False when the records live only as long as this page. */
  get kept(): boolean {
    return this.store?.kept ?? true;
  }

  /** Opens the storage, reads what is unsent, and starts sending if this tab holds the lock. */
  start(): Promise<void> {
    this.starting ??= (async () => {
      const store = await this.storage();
      this.store = store;
      this.device = await deviceOf(store);
      setDevice(this.device);
      for (const r of await store.all()) {
        // A send cut off by a reload is sent again with the same op.
        this.cache.set(r.key, r.state === "sending" ? { ...r, state: "waiting" } : r);
      }
      this.listChanged();
      await this.d
        .migrate?.({
          get: async (key) => this.cache.get(key),
          put: (key, value, meta = {}) => this.putIn(store, key, value, meta),
        })
        .catch(() => undefined);
      this.channel = store.kept ? (this.d.channel?.() ?? null) : null;
      if (this.channel) this.channel.onmessage = (e) => void this.heard(e.data as Message);
      let online = this.d.connection.state === "online";
      this.stopConnection = this.d.connection.subscribe(() => {
        const now = this.d.connection.state === "online";
        // The connection is back: what waited for it goes at once.
        if (now && !online) this.resume();
        online = now;
      });
      // In memory each tab keeps its own records, so each tab sends them.
      if (!store.kept || !this.d.locks) this.becomeSender();
      else {
        void this.d.locks.request(
          LOCK,
          () =>
            new Promise<void>((release) => {
              this.releaseLock = release;
              this.becomeSender();
            }),
        );
      }
    })();
    return this.starting;
  }

  /** Stops sending and listening; for tests and logout. */
  stop(): void {
    clearTimeout(this.timer);
    this.sender = false;
    this.releaseLock?.();
    this.releaseLock = null;
    this.channel?.close();
    this.channel = null;
    this.stopConnection?.();
    this.stopConnection = null;
    this.starting = null;
  }

  private becomeSender(): void {
    this.sender = true;
    this.resume();
    for (const l of [...this.senderListeners]) l();
  }

  private senderListeners = new Set<() => void>();

  /** True in the one tab that sends, which also runs the device keeper (`offline/keeper.ts`). */
  get isSender(): boolean {
    return this.sender;
  }

  /** Hears that this tab became the one that sends. */
  onSender(listener: () => void): () => void {
    this.senderListeners.add(listener);
    return () => this.senderListeners.delete(listener);
  }

  /** The database the queue opened, which the device copy shares (`offline/device.ts`). */
  database(): Promise<Store> {
    return this.ready();
  }

  private async ready(): Promise<Store> {
    await this.start();
    return this.store!;
  }

  /** The storage, opened once and shared by everything that reads it. */
  private storage(): Promise<Store> {
    this.opening ??= this.d.open();
    return this.opening;
  }

  // ---- What pages call ---------------------------------------------------------------------

  /**
   * Puts a file's new value. A record already waiting for the file keeps its base, draft and
   * revision, takes the new value and gets a new op; otherwise `meta` says what it starts from.
   */
  async put(key: QueueKey, value: unknown, meta: PutMeta = {}): Promise<void> {
    // Pages hear at once that a change waits, before the storage has answered, so a save state
    // never says "saved" over a change that is on its way to the storage.
    const known = this.cache.get(key);
    this.deliver({
      type: "record",
      key,
      record: {
        key,
        draftId: meta.draftId ?? "",
        revision: meta.revision ?? 0,
        op: "",
        tries: 0,
        nextTry: this.now(),
        since: this.now(),
        ...known,
        value,
        state: known?.state === "sending" ? "sending" : "waiting",
      },
    });
    await this.putIn(await this.ready(), key, value, meta);
  }

  private async putIn(store: Store, key: QueueKey, value: unknown, meta: PutMeta): Promise<void> {
    const now = this.now();
    const delay = meta.delay ?? PAUSE_MS;
    const record = await store.update(key, (r) => {
      const link = combine(r?.link, meta.link);
      const next: QueueRecord = r
        ? {
            ...r,
            value,
            op: randomId(),
            ...(meta.kind ? { kind: meta.kind } : {}),
            state: r.state === "attention" ? "waiting" : r.state,
            nextTry: r.tries > 0 ? Math.max(r.nextTry, now + delay) : now + delay,
          }
        : {
            key,
            ...(meta.kind ? { kind: meta.kind } : {}),
            draftId: meta.draftId ?? "",
            revision: meta.revision ?? 0,
            ...(meta.baseBlob !== undefined ? { baseBlob: meta.baseBlob } : {}),
            ...(meta.base !== undefined ? { base: meta.base } : {}),
            value,
            op: randomId(),
            state: "waiting",
            tries: 0,
            nextTry: now + delay,
            since: now,
          };
      if (link.length > 0) next.link = link;
      if (next.state === "waiting") delete next.error;
      return next;
    });
    this.changed(key, record ?? undefined);
  }

  /** The record waiting for a file, if any. */
  async get(key: QueueKey): Promise<QueueRecord | undefined> {
    await this.ready();
    return this.cache.get(key);
  }

  /** Every record still on this device. */
  async list(): Promise<QueueRecord[]> {
    await this.ready();
    return [...this.cache.values()];
  }

  /** The records as last known, without waiting; for rendering. */
  current(): QueueRecord[] {
    return this.records;
  }

  /** Hears what happens to one file. Returns the function that stops listening. */
  subscribe(key: QueueKey, listener: (event: QueueEvent) => void): () => void {
    const set = this.subs.get(key) ?? new Set();
    set.add(listener);
    this.subs.set(key, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.subs.delete(key);
    };
  }

  /** Hears every change to the list of records. */
  subscribeList(listener: () => void): () => void {
    this.listListeners.add(listener);
    return () => this.listListeners.delete(listener);
  }

  /**
   * A value this device keeps beside the queue, such as `signedIn`. Read before the queue starts,
   * as at the app's start, it opens the storage without sending anything.
   */
  async meta<T>(key: string): Promise<T | undefined> {
    return (await this.storage()).meta<T>(key);
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await (await this.storage()).setMeta(key, value);
  }

  /** Empties the device copy, as at logout; the queue's own records are not touched. */
  async clearDevice(): Promise<void> {
    await (await this.ready()).clearDevice();
  }

  async removeMeta(key: string): Promise<void> {
    await (await this.storage()).removeMeta(key);
  }

  /** Hears that another tab cleared the queue, as at logout. */
  onCleared(listener: () => void): () => void {
    this.clearedListeners.add(listener);
    return () => this.clearedListeners.delete(listener);
  }

  /** Hears the messages the sender has for the author. */
  onNotice(listener: (notice: Notice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  /** Sends a record that needs attention again. */
  async retry(key: QueueKey): Promise<void> {
    const store = await this.ready();
    const record = await store.update(key, (r) =>
      r ? { ...r, state: "waiting", tries: 0, nextTry: this.now() } : null,
    );
    this.changed(key, record ?? undefined);
  }

  /**
   * Throws a record away. A send of it already on its way is waited for first, so what the page
   * does next (such as discarding the draft) comes after it.
   */
  async drop(key: QueueKey): Promise<void> {
    const store = await this.ready();
    await this.settled(key);
    await store.update(key, () => null);
    this.changed(key, undefined);
  }

  /**
   * Sends a file's record now rather than after the pause, and resolves once it has been sent,
   * or could not be, or there is no connection to send it on.
   */
  async sendNow(key: QueueKey, timeoutMs = 15_000): Promise<void> {
    const store = await this.ready();
    const record = await store.update(key, (r) => (r ? { ...r, nextTry: this.now() } : null));
    if (!record) return;
    this.cache.set(key, record);
    const done = new Promise<void>((resolve) => {
      const list = this.waiting.get(key) ?? [];
      list.push(resolve);
      this.waiting.set(key, list);
      setTimeout(resolve, timeoutMs);
    });
    if (this.d.connection.state !== "online") this.release(key);
    else if (this.sender) this.pump();
    else this.post({ type: "send", key });
    await done;
  }

  /** Removes every record and this device's id and name, as at logout; a new id is made. */
  async clear(): Promise<void> {
    const store = await this.ready();
    await store.clear();
    await store.clearMeta();
    for (const key of [...this.cache.keys()]) this.changed(key, undefined, false);
    this.cache.clear();
    this.listChanged();
    this.post({ type: "cleared" });
    // A new id from here on: nothing links what comes next to what this device did before.
    this.device = await deviceOf(store);
    setDevice(this.device);
  }

  // ---- Sending -----------------------------------------------------------------------------

  /** Everything waiting is due now: for when the connection comes back. */
  private resume(): void {
    if (!this.sender) return;
    const now = this.now();
    for (const [key, r] of this.cache) {
      if (r.state === "waiting" && r.nextTry > now) this.cache.set(key, { ...r, nextTry: now });
    }
    this.pump();
  }

  private pump(): void {
    clearTimeout(this.timer);
    if (!this.sender || !this.store) return;
    if (this.d.connection.state !== "online") {
      // Nothing can be sent; whoever waits for a send hears so now.
      for (const key of [...this.waiting.keys()]) this.release(key);
      return;
    }
    const now = this.now();
    let next = Infinity;
    for (const r of this.cache.values()) {
      if (r.state === "attention" || this.inFlight.has(r.key)) continue;
      if (r.nextTry <= now) void this.send(r.key);
      else next = Math.min(next, r.nextTry);
    }
    if (next < Infinity) this.timer = setTimeout(() => this.pump(), next - now);
  }

  private async send(key: QueueKey): Promise<void> {
    const store = this.store!;
    this.inFlight.add(key);
    try {
      const sent = await store.update(key, (r) =>
        r && r.state === "waiting" ? { ...r, state: "sending" } : (r ?? null),
      );
      if (!sent || sent.state !== "sending") return;
      this.changed(key, sent);
      let answer: Answer;
      try {
        answer = await this.call(sent);
      } catch (err) {
        await this.failed(sent, err);
        return;
      }
      await this.answered(sent, answer);
    } finally {
      this.inFlight.delete(key);
      const r = this.cache.get(key);
      // Whoever waits for this key hears once it is gone, failed, or must wait.
      if (!r || r.state === "attention" || r.tries > 0 || r.nextTry > this.now()) this.release(key);
      this.pump();
    }
  }

  /** Sends one record to the server, by the kind of its file. */
  private async call(r: QueueRecord): Promise<Answer> {
    const id = subject(r.key);
    const sent = { ...(r.baseBlob !== undefined ? { baseBlob: r.baseBlob } : {}), op: r.op };
    // Item files carry the keys of the items a merge kept from this side (stage 15c).
    const items = { ...sent, ...(r.clashes?.length ? { clashes: r.clashes } : {}) };
    const links = (r.link ?? []).filter((l): l is { id: string; path: string } => l.path !== null);
    switch (kindOf(r.key)) {
      case "entry": {
        const res = await this.d.api.saveDraft({
          id: r.draftId,
          path: id,
          kind: r.kind ?? "edit",
          text: r.kind === "delete" ? "" : String(r.value),
          revision: r.revision,
          ...sent,
        });
        return {
          value: res,
          unlinked: [],
          known: { draftId: res.id, revision: res.revision, baseBlob: r.baseBlob },
        };
      }
      case "map": {
        const res = await this.d.api.saveMap(
          id,
          r.value as MapFile,
          r.revision,
          links.map((l) => ({ feature: l.id, path: l.path })),
          items,
        );
        return {
          value: res.map,
          unlinked: res.unlinked.map((u) => ({ id: u.feature, reason: u.reason })),
          known: { draftId: "", revision: res.revision, baseBlob: r.baseBlob, base: res.map },
          kept: res.kept,
        };
      }
      case "chronicle": {
        const res = await this.d.api.saveChronicle(
          id,
          r.value as ChronicleFile,
          r.revision,
          links.map((l) => ({ span: l.id, path: l.path })),
          items,
        );
        return {
          value: res.chronicle,
          unlinked: res.unlinked.map((u) => ({ id: u.span, reason: u.reason })),
          known: { draftId: "", revision: res.revision, baseBlob: r.baseBlob, base: res.chronicle },
          kept: res.kept,
        };
      }
      case "library": {
        const res = await this.d.api.saveLibraryFile(
          r.key as LibraryFileName,
          r.value,
          r.revision,
          items,
        );
        return {
          value: res.file,
          unlinked: [],
          known: { draftId: "", revision: res.revision, baseBlob: r.baseBlob, base: res.file },
          kept: res.kept,
        };
      }
    }
  }

  /** Saved: the record goes, unless it changed meanwhile; then it carries on from the answer. */
  private async answered(sent: QueueRecord, answer: Answer): Promise<void> {
    const key = sent.key;
    const sentLinks = (sent.link ?? []).filter(
      (l): l is { id: string; path: string } => l.path !== null,
    );
    const record = await this.store!.update(key, (now) => {
      if (!now || now.op === sent.op) return null;
      const next: QueueRecord = {
        ...now,
        draftId: answer.known.draftId,
        revision: answer.known.revision,
        state: "waiting",
        tries: 0,
        nextTry: Math.min(now.nextTry, this.now() + PAUSE_MS),
      };
      delete next.error;
      // The server has the clashes this send carried; a later merge brings its own.
      delete next.clashes;
      if (kindOf(key) !== "entry") {
        // The entries the server wrote are laid over what was changed since, unless the feature
        // or span was linked again or unlinked meanwhile.
        const still = new Set(
          sentLinks
            .filter((l) => now.link?.some((m) => m.id === l.id && m.path === l.path))
            .map((l) => l.id),
        );
        next.value = withLinked(key, now.value, answer.value, still);
        next.base = answer.value;
        const link = (now.link ?? []).filter((l) => l.path !== null && !still.has(l.id));
        if (link.length > 0) next.link = link;
        else delete next.link;
      }
      return next;
    });
    this.changed(key, record ?? undefined);
    this.emit({
      type: "saved",
      key,
      sent: sent.value,
      value: answer.value,
      link: sentLinks,
      unlinked: answer.unlinked,
      known: answer.known,
    });
    if (sent.clashes?.length) {
      const names = sentClashNames(sent).join(", ");
      this.notify(
        answer.kept
          ? {
              key,
              message: `${nameOf(sent)}: changed in both places: ${names}. Yours is in ${whereKept(key)}; the other version is kept.`,
              href: `/versions/${answer.kept}`,
              label: "Compare",
              always: true,
            }
          : // An older server keeps nothing: the notice says whose side is left.
            {
              key,
              message: `${nameOf(sent)}: changed in both places, yours kept: ${names}.`,
              always: true,
            },
      );
    }
  }

  /** The answer table for everything but a save. */
  private async failed(sent: QueueRecord, err: unknown): Promise<void> {
    const key = sent.key;
    const store = this.store!;
    const failure =
      err instanceof ApiFailure ? err : new ApiFailure(0, "offline", "No answer from the server.");
    const keep = (change: (r: QueueRecord) => Partial<QueueRecord>) =>
      store.update(key, (r) => (r ? { ...r, ...change(r) } : null));

    let record: QueueRecord | null;
    if (failure.status === 0 || failure.status >= 500) {
      // No connection, or the server is in trouble: try again later, waiting longer each time.
      record = await keep((r) => ({
        state: "waiting",
        tries: r.tries + 1,
        nextTry: this.now() + backoff(r.tries + 1),
        error: failure.status === 0 ? "Not sent: no connection." : failure.message,
      }));
    } else if (failure.status === 401) {
      // Sending pauses once the connection service hears of it, until the author logs in again.
      // Nothing is cleared.
      record = await keep(() => ({ state: "waiting", nextTry: this.now() + backoff(1) }));
    } else if (failure.code === "stale_revision" && kindOf(key) === "entry") {
      const draftId = failure.draftId ?? sent.draftId;
      // The server stored the kept copy. Text typed since goes to the same copy: revision 0 is
      // older than any draft, so it is never built on.
      record = await store.update(key, (r) =>
        !r || r.op === sent.op
          ? null
          : { ...r, draftId, revision: 0, state: "waiting", tries: 0, nextTry: this.now() },
      );
      this.emit({ type: "stale", key, draftId });
      this.notify({
        key,
        message: `${nameOf(sent)}: two texts to compare`,
        href: `/versions/${draftId}`,
      });
    } else if (failure.code === "stale_revision") {
      record = await this.merge(sent);
      if (!record) return;
    } else {
      // The server said no to this value: it waits for Retry or Discard in the unsent list.
      record = await keep(() => ({ state: "attention", error: failure.message }));
    }
    this.changed(key, record ?? undefined);
  }

  /**
   * Another device saved this map or chronicle first: its copy is loaded and merged with this
   * one, item by item from the stored base, and the result is sent. No page needs to be open.
   */
  private async merge(sent: QueueRecord): Promise<QueueRecord | null> {
    const key = sent.key;
    const id = subject(key);
    let theirs: { value: unknown; revision: number; blob: string };
    try {
      if (kindOf(key) === "map") {
        const t = await this.d.api.map(id);
        theirs = { value: t.map, revision: t.revision, blob: t.blob };
      } else if (kindOf(key) === "library") {
        const t = await this.d.api.libraryFile(key as LibraryFileName);
        theirs = { value: t.file, revision: t.revision, blob: t.blob };
      } else {
        const t = await this.d.api.chronicle(id);
        theirs = { value: t.chronicle, revision: t.revision, blob: t.blob };
      }
    } catch (err) {
      await this.failed(sent, err);
      return null;
    }
    let clashes: string[] = [];
    let merged: unknown = null;
    const record = await this.store!.update(key, (r) => {
      if (!r) return null;
      const base = r.base ?? theirs.value;
      const library = libraryKindOf(key);
      if (library) {
        const m = mergeLibraryFile(library, base, r.value, theirs.value);
        merged = m.file;
        clashes = m.clashes;
      } else if (kindOf(key) === "map") {
        const m = mergeMaps(base as MapFile, r.value as MapFile, theirs.value as MapFile);
        merged = m.map;
        clashes = m.clashes;
      } else {
        const m = mergeChronicles(
          base as ChronicleFile,
          r.value as ChronicleFile,
          theirs.value as ChronicleFile,
        );
        merged = m.chronicle;
        clashes = m.clashes;
      }
      const next: QueueRecord = {
        ...r,
        value: merged,
        base: theirs.value,
        baseBlob: theirs.blob,
        revision: theirs.revision,
        op: randomId(),
        state: "waiting",
        tries: r.tries + 1,
        nextTry: this.now(),
      };
      delete next.error;
      // The items kept from this side, with those of a merge before whose send failed.
      const all = unionClashes(r.clashes, clashes);
      if (all.length > 0) next.clashes = all;
      return next;
    });
    if (!record) return null;
    const known = {
      draftId: "",
      revision: theirs.revision,
      baseBlob: theirs.blob,
      base: theirs.value,
    };
    this.emit({ type: "merged", key, value: merged, clashes, known });
    // What clashed is said once the save answers, with the other side kept on the server.
    this.notify({ key, message: `${nameOf(record)}: changes from another device were merged in.` });
    return record;
  }

  // ---- Telling everyone --------------------------------------------------------------------

  /** Resolves those waiting for a key to be sent. */
  private release(key: QueueKey): void {
    const list = this.waiting.get(key);
    if (!list) return;
    this.waiting.delete(key);
    for (const resolve of list) resolve();
  }

  /** Waits until no send of this key is on its way in this tab. */
  private async settled(key: QueueKey): Promise<void> {
    while (this.inFlight.has(key)) await new Promise((r) => setTimeout(r, 50));
  }

  private changed(key: QueueKey, record: QueueRecord | undefined, broadcast = true): void {
    if (record) this.cache.set(key, record);
    else this.cache.delete(key);
    this.deliver({ type: "record", key, record });
    this.listChanged();
    if (broadcast) this.post({ type: "changed", key });
    // Whoever waits for this key to be sent hears once it is gone, or cannot go now.
    if (!record || record.state === "attention" || record.tries > 0) this.release(key);
    if (record?.state === "waiting" && this.sender) this.pump();
  }

  private emit(event: QueueEvent): void {
    this.deliver(event);
    this.post({ type: "event", event });
  }

  private deliver(event: QueueEvent): void {
    for (const l of [...(this.subs.get(event.key) ?? [])]) l(event);
  }

  private notify(notice: Omit<Notice, "watched">): void {
    this.post({ type: "notice", notice });
    this.announce(notice);
  }

  private announce(notice: Omit<Notice, "watched">): void {
    const watched = (this.subs.get(notice.key)?.size ?? 0) > 0;
    for (const l of [...this.noticeListeners]) l({ ...notice, watched });
  }

  private listChanged(): void {
    this.records = [...this.cache.values()].sort((a, b) => a.since - b.since);
    for (const l of [...this.listListeners]) l();
  }

  private post(message: Message): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      /* the channel is closed; the other tabs read the storage when they start */
    }
  }

  /** A message from another tab. */
  private async heard(message: Message): Promise<void> {
    switch (message.type) {
      case "changed": {
        const record = await this.store!.get(message.key);
        this.changed(message.key, record, false);
        break;
      }
      case "cleared":
        for (const key of [...this.cache.keys()]) this.changed(key, undefined, false);
        for (const l of [...this.clearedListeners]) l();
        break;
      case "event":
        this.deliver(message.event);
        break;
      case "notice":
        this.announce(message.notice);
        break;
      case "send":
        if (this.sender) {
          const r = this.cache.get(message.key);
          if (r) this.cache.set(message.key, { ...r, nextTry: this.now() });
          this.pump();
        }
        break;
    }
  }
}

/** The app's one queue. */
export const queue = new Queue({
  open: () => openStore(),
  // A merge reads the server's copy, never one the device kept for reading offline.
  api: {
    ...api,
    map: (id) => fromServer(() => api.map(id)),
    chronicle: (id) => fromServer(() => api.chronicle(id)),
    libraryFile: (name) => fromServer(() => api.libraryFile(name)),
  },
  connection: appConnection,
  locks: typeof navigator !== "undefined" ? navigator.locks : undefined,
  channel: () => (typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL)),
  // The browser buffer of builds before the queue is moved in once, at start.
  migrate: (q) => migrateBuffers(q),
});

/** Every record still on this device, kept up to date. */
export function useUnsent(): QueueRecord[] {
  return useSyncExternalStore(
    (l) => queue.subscribeList(l),
    () => queue.current(),
  );
}

/** The record waiting for one file, kept up to date; undefined when there is none. */
export function useRecord(key: QueueKey | null): QueueRecord | undefined {
  const [record, setRecord] = useState<QueueRecord | undefined>(undefined);
  useEffect(() => {
    if (key === null) return;
    let live = true;
    void queue.get(key).then((r) => live && setRecord(r));
    const stop = queue.subscribe(key, (e) => {
      if (e.type === "record") setRecord(e.record);
    });
    return () => {
      live = false;
      stop();
    };
  }, [key]);
  return record;
}
