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
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
import { api, apiFor, ApiFailure, fromServer, setDevice } from "../api.ts";
import { keysOwner, onKeysOwner } from "../aiKeys.ts";
import { currentProject, inProject, onProjectChange, type ProjectRef } from "../project.ts";
import { hasLegacyFlags, knownProjects, loadProjects, useProjects } from "../projects.ts";
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
  /**
   * The storage that holds this device's id and name, when it is not `open`'s own: every
   * project's queue has the same device (stage 27b).
   */
  identity?: () => Promise<Store>;
  /** The Web Lock and the broadcast channel this queue uses; each project has its own. */
  names?: { lock: string; channel: string };
  /** Which project the queue's notices are about, so a notice from a background queue says so. */
  project?: ProjectRef;
  /**
   * Removes this queue's meta at `clear`. A queue that shares the device's own storage must not
   * wipe what the device keeps for others there (the hub removes its own keys by name).
   */
  clearMeta?: (store: Store) => Promise<void>;
  /**
   * The server said the project is gone for this person (deleted elsewhere, or they were taken
   * out of it): its changes can never be sent. Told once; the changes stay in the store for the
   * hub to offer as a list.
   */
  onGone?: () => void;
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
  /** The hub was told that the project is gone; once is enough. */
  private toldGone = false;
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
      this.device = await deviceOf(await this.identity(store));
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
          this.d.names?.lock ?? LOCK,
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

  /** The storage the device's id is kept in: the queue's own unless it is told another. */
  private async identity(own: Store): Promise<Store> {
    return this.d.identity ? this.d.identity() : own;
  }

  /** The project this queue belongs to, when it has one. */
  get project(): ProjectRef | undefined {
    return this.d.project;
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
    await (this.d.clearMeta ? this.d.clearMeta(store) : store.clearMeta());
    for (const key of [...this.cache.keys()]) this.changed(key, undefined, false);
    this.cache.clear();
    this.listChanged();
    this.post({ type: "cleared" });
    // A new id from here on: nothing links what comes next to what this device did before.
    this.device = await deviceOf(await this.identity(store));
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
      // A map linking a feature to an entry made on this device goes after that entry, so the
      // server finds it; the entry's send pumps again when it is done.
      if (this.waitsForEntry(r)) continue;
      if (r.nextTry <= now) void this.send(r.key);
      else next = Math.min(next, r.nextTry);
    }
    if (next < Infinity) this.timer = setTimeout(() => this.pump(), next - now);
  }

  /** Whether a record links to an entry this device is still making. */
  private waitsForEntry(r: QueueRecord): boolean {
    if (kindOf(r.key) !== "map" || !r.link) return false;
    return r.link.some((l) => {
      const made = l.path ? this.cache.get(`entry:${l.path}`) : undefined;
      return made !== undefined && made.kind === "create" && made.state !== "attention";
    });
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
    } else if (failure.code === "role_too_low") {
      // The person was made a reader while this waited: it can never be sent, so it stops here
      // and is offered to copy out or throw away (not retried).
      record = await keep(() => ({
        state: "attention",
        refused: "role_too_low" as const,
        error:
          "Your role in this project no longer lets you change it, so this was not saved. Copy the text if you want to keep it, then discard it.",
      }));
    } else {
      // The server said no to this value: it waits for Retry or Discard in the unsent list.
      record = await keep(() => ({ state: "attention", error: failure.message }));
      if (failure.code === "no_project" && !this.toldGone) {
        this.toldGone = true;
        this.d.onGone?.();
      }
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

// ---- One queue for each person and project (stage 27b) ------------------------------------------

/** The name of the database an earlier build gave a project's queue and device copy. */
export const projectDatabase = (id: string): string => `frontier-p-${id}`;

/** The database of a project for one person: nothing of it is read in another person's session. */
export const personDatabase = (person: string, id: string): string =>
  `frontier-u-${person}-p-${id}`;

/** A project the hub can make a queue for. `legacy` comes from the server's list. */
export type KnownProject = ProjectRef & { legacy?: boolean | undefined; name?: string };

/** What the hub needs to make a queue for a project. */
export interface HubDeps {
  /** The device's own storage, opened once: the legacy project's data and everything of the device. */
  main: () => Promise<Store>;
  /** Opens a database by its name. */
  openProject: (name: string) => Promise<Store>;
  /** Makes the queue of a project, for a person, over the storage `open` gives. */
  make: (
    ref: ProjectRef,
    open: () => Promise<Store>,
    person: string,
    purge: (s: Store) => Promise<void>,
  ) => Queue;
  /** The projects the person is in, as last known: whose slugs a queue left over is sent to. */
  known: () => KnownProject[];
  /** Whether the list was read in a form that says which project is the legacy one. */
  listed: () => boolean;
}

/** The changes held for one project that is gone. */
export interface StrandedProject {
  id: string;
  name: string;
  records: QueueRecord[];
  /** The person can still open the project but may no longer change it: the server refused these. */
  refused?: boolean;
}

/** Whose data this device's storage is for, decided once for the signed-in person. */
interface Scope {
  person: string;
  /** The project whose data is in the device's own database, when it is this person's. */
  legacy: string | null;
  /** True for the person who owns what an earlier build kept (the old, un-attributed databases). */
  own: boolean;
  /** Projects whose un-attributed `frontier-p-<id>` database from an earlier build is this person's. */
  old: Set<string>;
}

/**
 * The app's queue as the pages see it: the open project's. Each person has a queue for each
 * project, over a database of their own, so what is typed in one is never shown in another, and
 * a change made in project A is sent to A even when the person has since gone to B (A's queue goes
 * on sending in the background until it is empty).
 *
 * Which database is whose is decided once. What an earlier build kept (the device's own database
 * `frontier`, and any `frontier-p-<id>`) belongs to the first person who signs in and is in the
 * server's legacy project, and only the legacy project may use `frontier`. Everyone else gets
 * databases named for them. A person's session never opens another person's database, so it
 * neither shows nor sends what they left unsent.
 */
export class QueueHub {
  private queues = new Map<string, Queue>();
  /** Projects whose queue has held a change, so that it is let go once it is empty again. */
  private worked = new Set<string>();
  private active: Queue | null = null;
  private mainOpening: Promise<Store> | null = null;
  private scoped: Promise<Scope> | null = null;
  private person: string | null = null;
  private readonly listListeners = new Set<() => void>();
  private readonly noticeListeners = new Set<(notice: Notice) => void>();
  private readonly clearedListeners = new Set<() => void>();
  private readonly senderListeners = new Set<() => void>();
  private readonly personListeners = new Set<() => void>();
  private readonly none: QueueRecord[] = [];
  /** The listeners of the queue that is open, forwarded and taken off when another opens. */
  private stops: (() => void)[] = [];

  constructor(private readonly d: HubDeps) {}

  private main(): Promise<Store> {
    this.mainOpening ??= this.d.main();
    return this.mainOpening;
  }

  /** The device's own storage, where its id is kept. */
  mainStore(): Promise<Store> {
    return this.main();
  }

  /** The person whose queues these are, or null when nobody is signed in. */
  get signedInPerson(): string | null {
    return this.person;
  }

  /**
   * Says who is signed in. The queues of the person before stop (what they left unsent stays in
   * their own databases, unread), and the open project's queue is made again for the new one.
   */
  setPerson(person: string | null): void {
    if (person === this.person) return;
    for (const q of this.queues.values()) q.stop();
    this.queues.clear();
    for (const stop of this.stops.splice(0)) stop();
    this.active = null;
    this.scoped = null;
    this.person = person;
    for (const l of [...this.personListeners]) l();
    const open = currentProject();
    if (person && open) this.use(open);
    else this.listChanged();
  }

  /** Hears that another person is signed in, so what was made for the last one is let go. */
  onPerson(listener: () => void): () => void {
    this.personListeners.add(listener);
    return () => this.personListeners.delete(listener);
  }

  /** Whose data this device's storage is, for the signed-in person; decided once, and kept. */
  private scope(): Promise<Scope> {
    const person = this.person;
    if (!person) return Promise.reject(new ApiFailure(0, "no_project", "Nobody is signed in."));
    if (this.scoped) return this.scoped;
    const made = (async (): Promise<Scope> => {
      const main = await this.main();
      const owner = await main.meta<string>("legacyOwner");
      const oldIds = async () => new Set((await main.meta<string[]>("projectDatabases")) ?? []);
      if (owner === undefined) {
        // Nobody has taken the old data yet. Only the legacy project, and so only a person who is
        // in it, may; a person who is not leaves it untouched and unread.
        if (!this.d.listed()) {
          throw new ApiFailure(0, "unknown", "Your projects have not been read yet.");
        }
        const legacy = this.d.known().find((p) => p.legacy === true)?.id;
        if (!legacy) {
          // Not in the legacy project: this is not remembered, so joining it later still takes it.
          queueMicrotask(() => {
            this.scoped = null;
          });
          return { person, legacy: null, own: false, old: new Set() };
        }
        await main.setMeta("legacyProject", legacy);
        await main.setMeta("legacyOwner", person);
        return { person, legacy, own: true, old: await oldIds() };
      }
      if (owner !== person) return { person, legacy: null, own: false, old: new Set() };
      const legacy = (await main.meta<string>("legacyProject")) ?? null;
      return { person, legacy, own: true, old: await oldIds() };
    })();
    // A decision that could not be made is made again on the next ask.
    made.catch(() => {
      if (this.scoped === made) this.scoped = null;
    });
    this.scoped = made;
    return made;
  }

  /**
   * The project whose old, un-filed browser keys and database this person owns, or null when
   * there is none (they are not in the legacy project, or another person has it).
   */
  async legacyFor(): Promise<string | null> {
    return (await this.scope().catch(() => null))?.legacy ?? null;
  }

  /** Whether the device's own database is this project's, for this person. */
  async isLegacy(id: string): Promise<boolean> {
    return (await this.legacyFor()) === id;
  }

  /** The storage of a project for this person, made and listed on first use. */
  private async storeFor(id: string): Promise<Store> {
    const s = await this.scope();
    if (s.legacy === id) return this.main();
    if (s.own && s.old.has(id)) return this.d.openProject(projectDatabase(id));
    const main = await this.main();
    const listed = (await main.meta<string[]>(this.listKey(s.person))) ?? [];
    if (!listed.includes(id)) await main.setMeta(this.listKey(s.person), [...listed, id]);
    await this.rememberName(s, id);
    return this.d.openProject(personDatabase(s.person, id));
  }

  /** The project's name, kept beside its database, so its changes can still be named once it is gone. */
  private async rememberName(s: Scope, id: string): Promise<void> {
    const name = this.d.known().find((p) => p.id === id)?.name;
    if (!name) return;
    const main = await this.main();
    const key = `projectNames:${s.person}`;
    const names = (await main.meta<Record<string, string>>(key)) ?? {};
    if (names[id] !== name) await main.setMeta(key, { ...names, [id]: name });
  }

  private listKey = (person: string) => `projectDatabases:${person}`;

  /** The databases this person has (other than the device's own), by project id. */
  private async ownDatabases(s: Scope): Promise<Map<string, string>> {
    const main = await this.main();
    const out = new Map<string, string>();
    if (s.own) for (const id of s.old) out.set(id, projectDatabase(id));
    for (const id of (await main.meta<string[]>(this.listKey(s.person))) ?? []) {
      out.set(id, personDatabase(s.person, id));
    }
    return out;
  }

  /** The queue of a project, made and started on first use. */
  queueOf(ref: ProjectRef): Queue {
    let q = this.queues.get(ref.id);
    if (!q) {
      const person = this.person ?? "nobody";
      const purge = async (store: Store) => {
        // The device's own storage holds the device's id and other people's marks: not wiped whole.
        if (store !== (await this.main())) await store.clearMeta();
      };
      q = this.d.make(ref, () => this.storeFor(ref.id), person, purge);
      this.queues.set(ref.id, q);
      // A notice names where to look, in its own project: the one open may be another by now.
      q.onNotice((notice) => {
        const said = notice.href ? { ...notice, href: inProject(notice.href, ref) } : notice;
        this.noticeListeners.forEach((l) => l(said));
      });
      q.onCleared(() => this.clearedListeners.forEach((l) => l()));
      q.subscribeList(() => {
        this.settled(ref.id);
        // What a project that is not open still holds is counted in the switcher.
        if (this.queues.get(ref.id) === q && q !== this.active) this.listChanged();
      });
      // One that was only asked for (to read, or to hold a change that went at once) is let go too.
      setTimeout(() => this.settled(ref.id, true), 60_000);
      const made = q;
      void q.start().catch(() => {
        // It could not start (the list of projects was not read yet): the next ask makes it again.
        if (this.queues.get(ref.id) === made && this.active !== made) this.queues.delete(ref.id);
      });
    }
    return q;
  }

  /**
   * A queue that is not open and has nothing left to send is let go. Not before it had something
   * (`force` aside): a queue just handed out for a change to a project that is not open has not
   * been given the change yet, and letting it go now would leave the change with no one to send it.
   */
  private settled(id: string, force = false): void {
    const q = this.queues.get(id);
    if (!q || q === this.active) return;
    if (q.current().length > 0) {
      this.worked.add(id);
      return;
    }
    if (!force && !this.worked.has(id)) return;
    q.stop();
    this.queues.delete(id);
    this.worked.delete(id);
    this.listChanged();
  }

  /**
   * Opens a project's queue for the pages, or none. The one open before goes on sending what it
   * holds, and is let go once it has nothing left.
   */
  use(ref: ProjectRef | null): void {
    const before = this.active;
    this.active = ref && this.person ? this.queueOf(ref) : null;
    for (const stop of this.stops.splice(0)) stop();
    if (this.active) {
      const q = this.active;
      this.stops.push(q.subscribeList(() => this.listChanged()));
      this.stops.push(q.onSender(() => this.senderListeners.forEach((l) => l())));
    }
    if (before && before !== this.active) this.settledQueue(before);
    this.listChanged();
  }

  private settledQueue(q: Queue): void {
    const id = [...this.queues].find(([, v]) => v === q)?.[0];
    if (id !== undefined) this.settled(id, true);
  }

  private open(): Queue {
    if (!this.active) throw new ApiFailure(0, "no_project", "No project is open.");
    return this.active;
  }

  /** Starts the device's storage, the open project's queue, and the sending of leftovers of others. */
  async start(): Promise<void> {
    await this.main();
    await Promise.all([this.active?.start(), this.sendLeftovers()]);
  }

  /**
   * Changes a project's queue held back on this device (the person went to another project, or
   * closed the app, before they were sent) go on to their own project. Only this person's.
   */
  private async sendLeftovers(): Promise<void> {
    const s = await this.scope().catch(() => null);
    if (!s) return;
    const main = await this.main();
    const databases = await this.ownDatabases(s);
    for (const ref of this.d.known()) {
      if (this.queues.has(ref.id)) continue;
      const isMain = s.legacy === ref.id;
      const name = databases.get(ref.id);
      if (!isMain && !name) continue;
      const store = isMain ? main : await this.d.openProject(name!).catch(() => null);
      if (!store) continue;
      const waiting = (await store.all().catch(() => [])).length > 0;
      if (waiting) this.queueOf(ref);
    }
  }

  stop(): void {
    for (const q of this.queues.values()) q.stop();
  }

  // ---- Changes in projects that are gone --------------------------------------------------------

  /**
   * The changes this device holds for projects the person can no longer open (deleted, or they
   * were taken out): they can never be sent, and no page of theirs can be opened, so they are
   * listed on All projects for the person to copy out or throw away.
   */
  async stranded(): Promise<StrandedProject[]> {
    const s = await this.scope().catch(() => null);
    // Only against a list that was read: a project missing from an unread list is not gone.
    if (!s || !this.d.listed()) return [];
    const inList = new Set(this.d.known().map((p) => p.id));
    const main = await this.main();
    const names = (await main.meta<Record<string, string>>(`projectNames:${s.person}`)) ?? {};
    const out: StrandedProject[] = [];
    for (const [id, name] of await this.ownDatabases(s)) {
      if (inList.has(id)) continue;
      const store = await this.d.openProject(name).catch(() => null);
      const records = (await store?.all().catch(() => [])) ?? [];
      if (records.length > 0)
        out.push({ id, name: names[id] ?? "A project that is gone", records });
    }
    // Changes the server refused for want of a role (stage 27c): in a project the person is still
    // in, which they may read but no longer change.
    const databases = await this.ownDatabases(s);
    for (const ref of this.d.known()) {
      const isMain = s.legacy === ref.id;
      const name = databases.get(ref.id);
      if (!isMain && !name) continue;
      const store = isMain ? main : await this.d.openProject(name!).catch(() => null);
      const records = ((await store?.all().catch(() => [])) ?? []).filter(
        (r) => r.refused === "role_too_low",
      );
      if (records.length > 0) {
        out.push({
          id: ref.id,
          name: names[ref.id] ?? ref.name ?? ref.slug,
          records,
          refused: true,
        });
      }
    }
    return out;
  }

  /** Throws away one change held for a project that is gone, or all of them when no key is given. */
  async discardStranded(id: string, key?: QueueKey): Promise<void> {
    const s = await this.scope();
    const name = (await this.ownDatabases(s)).get(id);
    const store =
      s.legacy === id ? await this.main() : name ? await this.d.openProject(name) : null;
    if (!store) return;
    if (key) await store.update(key, () => null);
    else await store.clear();
    // Dropping a queue still held for it, so what it kept in memory is not shown again.
    const q = this.queues.get(id);
    if (q && q !== this.active) {
      q.stop();
      this.queues.delete(id);
    }
    this.listChanged();
  }

  /**
   * Removes everything this device keeps for a project that was deleted here: its queue, its
   * changes, its copy for reading offline and its database.
   */
  async dropProject(ref: ProjectRef): Promise<void> {
    const s = await this.scope().catch(() => null);
    const q = this.queues.get(ref.id);
    if (q) {
      q.stop();
      this.queues.delete(ref.id);
      this.worked.delete(ref.id);
      if (this.active === q) this.active = null;
    }
    if (s) {
      const name = (await this.ownDatabases(s)).get(ref.id);
      if (name) {
        const store = await this.d.openProject(name).catch(() => null);
        await store?.destroy().catch(() => undefined);
        const main = await this.main();
        if (s.old.has(ref.id)) {
          const rest = [...s.old].filter((x) => x !== ref.id);
          await main.setMeta("projectDatabases", rest);
          s.old.delete(ref.id);
        }
        const key = this.listKey(s.person);
        const listed = (await main.meta<string[]>(key)) ?? [];
        await main.setMeta(
          key,
          listed.filter((x) => x !== ref.id),
        );
      }
    }
    this.listChanged();
  }

  /** How many changes this device holds for one project, whether or not it is the open one. */
  async unsentIn(id: string): Promise<number> {
    const q = this.queues.get(id);
    if (q) return q.current().length;
    const s = await this.scope().catch(() => null);
    if (!s) return 0;
    if (s.legacy === id) return (await (await this.main()).all().catch(() => [])).length;
    const name = (await this.ownDatabases(s)).get(id);
    const store = name ? await this.d.openProject(name).catch(() => null) : null;
    return (await store?.all().catch(() => []))?.length ?? 0;
  }

  /** How many changes this device holds for the person in every project, gone ones too. */
  async unsentOnDevice(): Promise<number> {
    const s = await this.scope().catch(() => null);
    if (!s) return 0;
    let n = 0;
    if (s.legacy) n += (await (await this.main()).all().catch(() => [])).length;
    for (const name of (await this.ownDatabases(s)).values()) {
      const store = await this.d.openProject(name).catch(() => null);
      n += (await store?.all().catch(() => []))?.length ?? 0;
    }
    return n;
  }

  // ---- What the pages call: the open project's ------------------------------------------------

  get kept(): boolean {
    return this.active?.kept ?? true;
  }
  get isSender(): boolean {
    return this.active?.isSender ?? false;
  }
  get device(): Device | null {
    return this.active?.device ?? [...this.queues.values()].find((q) => q.device)?.device ?? null;
  }
  onSender(listener: () => void): () => void {
    this.senderListeners.add(listener);
    return () => this.senderListeners.delete(listener);
  }
  async database(): Promise<Store> {
    return this.open().database();
  }
  async put(key: QueueKey, value: unknown, meta?: PutMeta): Promise<void> {
    return this.open().put(key, value, meta);
  }
  get(key: QueueKey): Promise<QueueRecord | undefined> {
    return this.active ? this.active.get(key) : Promise.resolve(undefined);
  }
  list(): Promise<QueueRecord[]> {
    return this.active ? this.active.list() : Promise.resolve([]);
  }
  /** The open project's records as last known; none when no project is open. */
  current(): QueueRecord[] {
    return this.active ? this.active.current() : this.none;
  }
  subscribe(key: QueueKey, listener: (event: QueueEvent) => void): () => void {
    return this.open().subscribe(key, listener);
  }
  subscribeList(listener: () => void): () => void {
    this.listListeners.add(listener);
    return () => this.listListeners.delete(listener);
  }
  private listChanged(): void {
    for (const l of [...this.listListeners]) l();
  }
  async retry(key: QueueKey): Promise<void> {
    return this.open().retry(key);
  }
  async drop(key: QueueKey): Promise<void> {
    return this.open().drop(key);
  }
  async sendNow(key: QueueKey, timeoutMs?: number): Promise<void> {
    return this.open().sendNow(key, timeoutMs);
  }

  /**
   * How many changes wait on this device in every project: the open one and those still being
   * sent in the background. What logging out would lose.
   */
  total(): number {
    let n = 0;
    for (const q of this.queues.values()) n += q.current().length;
    return n;
  }

  /** The projects other than the open one that still have changes waiting, with how many. */
  waitingElsewhere(): { id: string; count: number }[] {
    return [...this.queues]
      .filter(([, q]) => q !== this.active && q.current().length > 0)
      .map(([id, q]) => ({ id, count: q.current().length }));
  }

  // ---- The device's own: not a project's -------------------------------------------------------

  /** A value this device keeps beside the queues, such as `signedIn`. */
  async meta<T>(key: string): Promise<T | undefined> {
    return (await this.main()).meta<T>(key);
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    await (await this.main()).setMeta(key, value);
  }
  async removeMeta(key: string): Promise<void> {
    await (await this.main()).removeMeta(key);
  }
  onNotice(listener: (notice: Notice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }
  onCleared(listener: () => void): () => void {
    this.clearedListeners.add(listener);
    return () => this.clearedListeners.delete(listener);
  }

  /** The copies for reading offline of this person's projects are emptied; the records are not touched. */
  async clearDevice(): Promise<void> {
    const s = await this.scope().catch(() => null);
    if (!s) return;
    // The device's own database holds the legacy project's copy, which is the owner's alone.
    if (s.own) await (await this.main()).clearDevice();
    for (const name of (await this.ownDatabases(s)).values()) {
      const store = await this.d.openProject(name).catch(() => null);
      await store?.clearDevice().catch(() => undefined);
    }
  }

  /**
   * Removes every record of this person's projects, and this device's id and name, as at logout.
   * Another person's databases, and the mark of who owns the device's old data when it is not
   * this person, are left as they are.
   */
  async clear(): Promise<void> {
    const s = await this.scope().catch(() => null);
    const main = await this.main();
    if (s) {
      for (const name of (await this.ownDatabases(s)).values()) {
        const store = await this.d.openProject(name).catch(() => null);
        if (!store) continue;
        await store.clear().catch(() => undefined);
        await store.clearMeta().catch(() => undefined);
        await store.clearDevice().catch(() => undefined);
      }
      await main.removeMeta(this.listKey(s.person)).catch(() => undefined);
    }
    for (const q of this.queues.values()) await q.clear();
    // The device's own storage, last, so the id is made anew; the records in it are the owner's.
    if (s?.own) {
      await main.clear();
      await main.clearDevice();
      for (const key of ["legacyOwner", "legacyProject", "projectDatabases"]) {
        await main.removeMeta(key).catch(() => undefined);
      }
    }
    for (const key of ["device", "persistAsked", "imageSizes", "snapshot"]) {
      await main.removeMeta(key).catch(() => undefined);
    }
    this.scoped = null;
    this.listChanged();
  }
}

/** The app's queues: one for each person and project, as the pages see the open project's. */
export const queue: QueueHub = new QueueHub({
  main: () => openStore(),
  openProject: (name) => openStore(name),
  make: (ref, open, person, purge): Queue =>
    new Queue({
      open,
      identity: (): Promise<Store> => queue.mainStore(),
      project: ref,
      clearMeta: purge,
      // Its changes are listed on All projects once the list shows the project is not there.
      onGone: () => void loadProjects(),
      names: { lock: `${LOCK}:${person}:${ref.id}`, channel: `${CHANNEL}:${person}:${ref.id}` },
      // A merge reads the server's copy, never one the device kept for reading offline; and a
      // send goes to the project the change was made in, whichever is open now.
      api: senderApiFor(ref),
      connection: appConnection,
      locks: typeof navigator !== "undefined" ? navigator.locks : undefined,
      channel: () =>
        typeof BroadcastChannel === "undefined"
          ? null
          : new BroadcastChannel(`${CHANNEL}:${person}:${ref.id}`),
      // The browser buffer of builds before the queue is moved in once, at start, and only into
      // the legacy project's: it is what that build kept for its one library.
      migrate: async (q): Promise<void> => {
        if (await queue.isLegacy(ref.id)) await migrateBuffers(q);
      },
    }),
  known: () => knownProjects()?.projects ?? [],
  listed: () => hasLegacyFlags(knownProjects()),
});

/** The sender's calls for one project's queue: its address is read when the call is made. */
function senderApiFor(ref: ProjectRef): SenderApi {
  const slug = () => queueSlug(ref);
  const p = () => apiFor(slug());
  return {
    saveDraft: (...a) => p().saveDraft(...a),
    saveMap: (...a) => p().saveMap(...a),
    saveChronicle: (...a) => p().saveChronicle(...a),
    saveLibraryFile: (...a) => p().saveLibraryFile(...a),
    map: (id) => fromServer(() => p().map(id)),
    chronicle: (id) => fromServer(() => p().chronicle(id)),
    libraryFile: (name) => fromServer(() => p().libraryFile(name)),
  };
}

/**
 * The address a project's queue sends to: the one the list has now, since the owner may have
 * renamed it since the queue was made.
 */
function queueSlug(ref: ProjectRef): string {
  return knownProjects()?.projects.find((p) => p.id === ref.id)?.slug ?? ref.slug;
}

// The pages' queue follows the project the app has open, and the person who is signed in.
onProjectChange((next) => queue.use(next));
onKeysOwner((person) => queue.setPerson(person));
queue.setPerson(keysOwner());

/**
 * The changes held for projects that are gone, read when asked for and again when the list of
 * projects or any queue changes. Empty until the first read.
 */
export function useStranded(): { stranded: StrandedProject[]; refresh: () => void } {
  const [stranded, setStranded] = useState<StrandedProject[]>([]);
  const [tick, setTick] = useState(0);
  const { list } = useProjects();
  useEffect(() => {
    let live = true;
    void queue.stranded().then((s) => live && setStranded(s));
    return () => {
      live = false;
    };
  }, [list, tick]);
  useEffect(() => queue.subscribeList(() => setTick((n) => n + 1)), []);
  return { stranded, refresh: () => setTick((n) => n + 1) };
}

/** How many changes wait for each project other than the open one, kept up to date. */
export function useWaitingElsewhere(): { id: string; count: number }[] {
  const text = useSyncExternalStore(
    (l) => queue.subscribeList(l),
    () => JSON.stringify(queue.waitingElsewhere()),
  );
  return useMemo(() => JSON.parse(text) as { id: string; count: number }[], [text]);
}

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
