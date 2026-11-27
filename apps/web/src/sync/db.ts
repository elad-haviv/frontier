/**
 * The device's own storage for the save queue: one IndexedDB database with a `queue` store (one
 * record per file) and a `meta` store (this device's id and name). When IndexedDB cannot be opened,
 * as in some private windows, the queue runs in memory and only the device id is kept, in
 * `localStorage`, so a reload does not make a new device.
 *
 * From version 2 (stage 15b) the same database holds the device copy for reading offline:
 * `answers` (successful reads, by address) and `items` (the entries, maps and chronicles opened
 * lately). In memory the device copy is off: nothing is kept.
 */
import { type DBSchema, deleteDB, type IDBPDatabase, openDB } from "idb";
import type { DraftKind, LibraryFileName } from "@frontier/schema";

/** An entry, a map, a chronicle, or a library item file (such as the folder file) by its name. */
export type QueueKey =
  `entry:${string}` | `map:${string}` | `chronicle:${string}` | LibraryFileName;

/** A feature or span to link to the entry at `path`; a null path takes back an earlier link. */
export interface LinkItem {
  id: string;
  path: string | null;
}

/** One file's change that the server has not confirmed yet. */
export interface QueueRecord {
  key: QueueKey;
  /** Entries only. */
  kind?: DraftKind;
  /** The draft this device last knew of ("" for item files, which the server finds by path). */
  draftId: string;
  /** Its revision; 0 for none. */
  revision: number;
  /** The blob of the library file this device started from; "" for a new file. */
  baseBlob?: string;
  /** Item files only: the value the server last confirmed, for a three-way merge. */
  base?: unknown;
  /** The text, or the file, to send. */
  value: unknown;
  /** Maps and chronicles only: what to link, combined by feature or span id. */
  link?: LinkItem[];
  /**
   * Item files only (stage 15c): the keys of the items a merge found changed on both sides, whose
   * other side the server keeps when this record is saved. Each merge adds its own; a successful
   * save clears them.
   */
  clashes?: string[];
  /** Made on this device for this send; a retry sends the same one. */
  op: string;
  /** `attention` waits for the author's Retry or Discard. */
  state: "waiting" | "sending" | "attention";
  /** Why the last send failed, in words. */
  error?: string;
  tries: number;
  /** When it may be sent next, in milliseconds since 1970. */
  nextTry: number;
  /** When it was first put, for the unsent list. */
  since: number;
}

export interface Device {
  id: string;
  name: string;
}

/** A successful read kept for reading offline (`offline/device.ts`). */
export interface DeviceAnswer {
  /** The request's address, as `api.ts` makes it, such as `/api/entries?path=…`. */
  url: string;
  /** When it was read, in milliseconds since 1970. */
  at: number;
  /** Its route's `DEVICE_SCHEMA` number when it was stored. */
  shape: number;
  body: unknown;
  /** Its size as JSON, in bytes. */
  bytes: number;
  /** The item it is the body of, such as `entry:<path>`; none for the answers always kept. */
  item?: string;
}

/** An entry, map or chronicle on this device, because it was opened lately. */
export interface DeviceItem {
  /** `entry:<path>`, `map:<id>` or `chronicle:<id>`, as the queue's keys. */
  key: string;
  /** When it was last opened. */
  opened: number;
  /** The image addresses stored for it in Cache Storage. */
  images: string[];
}

interface Schema extends DBSchema {
  queue: { key: string; value: QueueRecord };
  meta: { key: string; value: unknown };
  answers: { key: string; value: DeviceAnswer };
  items: { key: string; value: DeviceItem };
}

/** What the queue reads and writes, in IndexedDB or in memory. */
export interface Store {
  /** False when changes live only as long as this page. */
  readonly kept: boolean;
  all(): Promise<QueueRecord[]>;
  get(key: string): Promise<QueueRecord | undefined>;
  /**
   * Reads one record, changes it and writes it back as one step, so two tabs cannot interleave.
   * `change` returns the new record, or null to remove it; it must not wait on anything.
   */
  update(
    key: string,
    change: (record: QueueRecord | undefined) => QueueRecord | null,
  ): Promise<QueueRecord | null>;
  clear(): Promise<void>;
  meta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  removeMeta(key: string): Promise<void>;
  clearMeta(): Promise<void>;
  /** False when nothing can be kept for reading offline. */
  readonly device: boolean;
  answer(url: string): Promise<DeviceAnswer | undefined>;
  answers(): Promise<DeviceAnswer[]>;
  putAnswer(answer: DeviceAnswer): Promise<void>;
  removeAnswer(url: string): Promise<void>;
  item(key: string): Promise<DeviceItem | undefined>;
  items(): Promise<DeviceItem[]>;
  putItem(item: DeviceItem): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Empties `answers` and `items`; the queue and `meta` stay. */
  clearDevice(): Promise<void>;
  /** Removes the whole database (a project's own one, once the project is gone). */
  destroy(): Promise<void>;
}

export const DB_NAME = "frontier";
/** 1: the queue and `meta` (11a-2). 2: `answers` and `items`, the device copy (15b). */
export const DB_VERSION = 2;
const DEVICE_KEY = "frontier:device";

class IdbStore implements Store {
  readonly kept = true;
  readonly device = true;
  constructor(private readonly db: IDBPDatabase<Schema>) {}

  answer(url: string) {
    return this.db.get("answers", url);
  }
  answers() {
    return this.db.getAll("answers");
  }
  async putAnswer(answer: DeviceAnswer) {
    await this.db.put("answers", answer, answer.url);
  }
  removeAnswer(url: string) {
    return this.db.delete("answers", url);
  }
  item(key: string) {
    return this.db.get("items", key);
  }
  items() {
    return this.db.getAll("items");
  }
  async putItem(item: DeviceItem) {
    await this.db.put("items", item, item.key);
  }
  removeItem(key: string) {
    return this.db.delete("items", key);
  }
  async clearDevice() {
    const tx = this.db.transaction(["answers", "items"], "readwrite");
    await Promise.all([
      tx.objectStore("answers").clear(),
      tx.objectStore("items").clear(),
      tx.done,
    ]);
  }

  all() {
    return this.db.getAll("queue");
  }
  get(key: string) {
    return this.db.get("queue", key);
  }
  async update(key: string, change: (r: QueueRecord | undefined) => QueueRecord | null) {
    const tx = this.db.transaction("queue", "readwrite");
    const next = change(await tx.store.get(key));
    if (next === null) await tx.store.delete(key);
    else await tx.store.put(next, key);
    await tx.done;
    return next;
  }
  clear() {
    return this.db.clear("queue");
  }
  async meta<T>(key: string) {
    return (await this.db.get("meta", key)) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    await this.db.put("meta", value, key);
  }
  removeMeta(key: string) {
    return this.db.delete("meta", key);
  }
  clearMeta() {
    return this.db.clear("meta");
  }
  async destroy() {
    const name = this.db.name;
    this.db.close();
    await deleteDB(name);
  }
}

class MemoryStore implements Store {
  readonly kept = false;
  readonly device = false;
  private records = new Map<string, QueueRecord>();
  private values = new Map<string, unknown>();

  // The device copy is off in memory: nothing is kept, so reads behave as without it.
  async answer() {
    return undefined;
  }
  async answers() {
    return [];
  }
  async putAnswer() {}
  async removeAnswer() {}
  async item() {
    return undefined;
  }
  async items() {
    return [];
  }
  async putItem() {}
  async removeItem() {}
  async clearDevice() {}

  async all() {
    return [...this.records.values()].map((r) => structuredClone(r));
  }
  async get(key: string) {
    const r = this.records.get(key);
    return r && structuredClone(r);
  }
  async update(key: string, change: (r: QueueRecord | undefined) => QueueRecord | null) {
    const next = change(await this.get(key));
    if (next === null) this.records.delete(key);
    else this.records.set(key, structuredClone(next));
    return next;
  }
  async clear() {
    this.records.clear();
  }
  async meta<T>(key: string) {
    if (key === "device") {
      try {
        const raw = localStorage.getItem(DEVICE_KEY);
        if (raw) return JSON.parse(raw) as T;
      } catch {
        /* storage is switched off: the id lasts for this page */
      }
    }
    return this.values.get(key) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    this.values.set(key, value);
    if (key === "device") {
      try {
        localStorage.setItem(DEVICE_KEY, JSON.stringify(value));
      } catch {
        /* as above */
      }
    }
  }
  async removeMeta(key: string) {
    this.values.delete(key);
    if (key === "device") {
      try {
        localStorage.removeItem(DEVICE_KEY);
      } catch {
        /* nothing to remove */
      }
    }
  }
  async destroy() {
    this.records.clear();
    this.values.clear();
  }
  async clearMeta() {
    this.values.clear();
    try {
      localStorage.removeItem(DEVICE_KEY);
    } catch {
      /* nothing to clear */
    }
  }
}

/** What another tab's newer or older build does to this tab's database, for the shell to say. */
export const database = {
  /** Another tab asked for a newer version: this tab closed its connection and must reload. */
  closed: false,
  /** This tab's open waits for older tabs to close. */
  waiting: false,
  listeners: new Set<() => void>(),
  set(change: Partial<{ closed: boolean; waiting: boolean }>): void {
    Object.assign(this, change);
    for (const l of [...this.listeners]) l();
  },
};

/** How long an open blocked by another tab waits before saying so. */
export const BLOCKED_MS = 5000;

/**
 * Opens the database, or falls back to memory when IndexedDB cannot be used. The upgrade
 * branches on the version found, so the queue's records and `meta` are kept as they are.
 */
export async function openStore(name = DB_NAME, version = DB_VERSION): Promise<Store> {
  let waiting: ReturnType<typeof setTimeout> | undefined;
  try {
    if (typeof indexedDB === "undefined") throw new Error("no IndexedDB");
    const db = await openDB<Schema>(name, version, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("queue");
          db.createObjectStore("meta");
        }
        if (oldVersion < 2 && version >= 2) {
          db.createObjectStore("answers");
          db.createObjectStore("items");
        }
      },
      // An older tab holds the database open: say so after a while, and go on once it closes.
      blocked() {
        clearTimeout(waiting);
        waiting = setTimeout(() => database.set({ waiting: true }), BLOCKED_MS);
      },
      // A newer build in another tab wants to upgrade: let it, and ask for a reload here.
      blocking() {
        db.close();
        database.set({ closed: true });
      },
    });
    clearTimeout(waiting);
    if (database.waiting) database.set({ waiting: false });
    return new IdbStore(db);
  } catch {
    clearTimeout(waiting);
    return new MemoryStore();
  }
}

/** The same alphabet and rule as `makeId` in the schema, so the server accepts the id. */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomId(): string {
  let out = "";
  while (out.length < 12) {
    for (const byte of crypto.getRandomValues(new Uint8Array(12))) {
      if (byte < 252 && out.length < 12) out += ALPHABET[byte % 36];
    }
  }
  return out;
}

/** A short name for this browser, such as "Safari on iPhone", shown beside its kept copies. */
export function deviceName(agent: string): string {
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\/|FxiOS\//.test(agent)
      ? "Firefox"
      : /OPR\//.test(agent)
        ? "Opera"
        : /Chrome\/|CriOS\//.test(agent)
          ? "Chrome"
          : /Safari\//.test(agent)
            ? "Safari"
            : "A browser";
  const system = /iPhone/.test(agent)
    ? "iPhone"
    : /iPad/.test(agent)
      ? "iPad"
      : /Android/.test(agent)
        ? "Android"
        : /Mac OS X|Macintosh/.test(agent)
          ? "Mac"
          : /Windows/.test(agent)
            ? "Windows"
            : /Linux|CrOS/.test(agent)
              ? "Linux"
              : null;
  return system ? `${browser} on ${system}` : browser;
}

/** This device's id and name, made once and kept in `meta`. */
export async function deviceOf(store: Store): Promise<Device> {
  const known = await store.meta<Device>("device");
  if (known?.id && /^[a-z0-9]{12}$/.test(known.id)) return known;
  const made = {
    id: randomId(),
    name: deviceName(typeof navigator === "undefined" ? "" : navigator.userAgent),
  };
  await store.setMeta("device", made);
  return made;
}
