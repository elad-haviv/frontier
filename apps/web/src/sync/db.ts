/**
 * The device's own storage for the save queue: one IndexedDB database with a `queue` store (one
 * record per file) and a `meta` store (this device's id and name). When IndexedDB cannot be opened,
 * as in some private windows, the queue runs in memory and only the device id is kept, in
 * `localStorage`, so a reload does not make a new device.
 */
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { DraftKind } from "@frontier/schema";

/** An entry, a map, a chronicle, or the folder file. */
export type QueueKey = `entry:${string}` | `map:${string}` | `chronicle:${string}` | "folders";

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

interface Schema extends DBSchema {
  queue: { key: string; value: QueueRecord };
  meta: { key: string; value: unknown };
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
  clearMeta(): Promise<void>;
}

export const DB_NAME = "frontier";
const DEVICE_KEY = "frontier:device";

class IdbStore implements Store {
  readonly kept = true;
  constructor(private readonly db: IDBPDatabase<Schema>) {}

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
  clearMeta() {
    return this.db.clear("meta");
  }
}

class MemoryStore implements Store {
  readonly kept = false;
  private records = new Map<string, QueueRecord>();
  private values = new Map<string, unknown>();

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
  async clearMeta() {
    this.values.clear();
    try {
      localStorage.removeItem(DEVICE_KEY);
    } catch {
      /* nothing to clear */
    }
  }
}

/** Opens the database, or falls back to memory when IndexedDB cannot be used. */
export async function openStore(name = DB_NAME): Promise<Store> {
  try {
    if (typeof indexedDB === "undefined") throw new Error("no IndexedDB");
    const db = await openDB<Schema>(name, 1, {
      upgrade(db) {
        db.createObjectStore("queue");
        db.createObjectStore("meta");
      },
    });
    return new IdbStore(db);
  } catch {
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
