/**
 * The device keeper (stage 15b): keeps the items on this device, their images and the answers
 * always kept up to date while online, and removes what goes beyond the counts.
 *
 * It runs in one tab, the one holding the save queue's sender lock, so two tabs do not fetch the
 * same things; other tabs tell it through a broadcast when they open an item.
 *
 * - The device keeps the last 30 entries, 5 maps and 5 chronicles opened; there is no budget.
 * - Never removed: the queue's records, the answers always kept, and any item with a record.
 * - An image goes when no item lists it.
 * - Refresh while online: at start, on each status snapshot whose `indexCommit`, `unpublished` or
 *   `drafts` differs from the last one, when the queue's list changes and when the connection
 *   comes back. It reads the compact index and the lists again, then each item whose version mark
 *   changed, one at a time, skipping any with a record (the editor's own state is newer).
 */
import {
  LIBRARY_FILES,
  type LibraryFileName,
  type MapFile,
  type StatusSnapshot,
  versionMark,
} from "@frontier/schema";
import { apiFor, ApiFailure, fromServer, imageUrl, mapImageUrl, requireSlug } from "../api.ts";
import type { Connection } from "../sync/connection.ts";
import type { Queue, QueueRecord } from "../sync/queue.ts";
import { bodyUrl, type DeviceCopy, IMAGES, isFull } from "./device.ts";
import type { DeviceAnswer, DeviceItem } from "../sync/db.ts";

/** How many of each kind the device keeps. */
export const COUNTS = { entry: 30, map: 5, chronicle: 5 } as const;
/** An answer read for an item whose opening is not recorded yet is kept this long. */
const GRACE_MS = 60_000;

type Kind = keyof typeof COUNTS;
const kindOf = (key: string): Kind => key.slice(0, key.indexOf(":")) as Kind;

/** The server reads the keeper makes; each goes to the server only and is kept on the device. */
export interface KeeperReads {
  graph(): Promise<{ nodes: { path: string; v?: string | undefined }[] }>;
  maps(): Promise<{ maps: { id: string; v?: string | undefined }[] }>;
  chronicles(): Promise<{ chronicles: { id: string; v?: string | undefined }[] }>;
  /** The other answers always kept: the tree, the marker sets, the schema, the library files. */
  others(): Promise<unknown>[];
  item(key: string): Promise<unknown>;
}

export interface KeeperDeps {
  device: Pick<
    DeviceCopy,
    "items" | "forget" | "removeOldest" | "answer" | "answers" | "removeAnswer" | "setImages"
  >;
  queue: Pick<
    Queue,
    "isSender" | "onSender" | "subscribeList" | "current" | "meta" | "setMeta" | "onCleared"
  >;
  connection: Pick<Connection, "state" | "snapshot" | "subscribe">;
  reads?: KeeperReads;
  /** The address of the project this keeper looks after, as it is now. */
  slug?: () => string;
  caches?: Pick<CacheStorage, "open" | "delete"> | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  /** `navigator.storage.persist`, asked once. */
  persist?: (() => Promise<boolean>) | undefined;
  /** True in the installed app. */
  standalone?: () => boolean;
  /** The first item kept on this device. */
  onFirstItem?: () => void;
  /** The width map images are read at on this device, as the map page asks for them. */
  mapSize?: () => 2560 | 4096;
  channel?: () => BroadcastChannel | null;
}

/** The reads of one project, by its address as it is now. */
const appReads = (slug: () => string): KeeperReads => {
  const p = () => apiFor(slug());
  return {
    graph: () => fromServer(() => p().graph()),
    maps: () => fromServer(() => p().maps()),
    chronicles: () => fromServer(() => p().chronicles()),
    others: () => [
      fromServer(() => p().tree()),
      fromServer(() => p().markerSets()),
      fromServer(() => p().schema()),
      fromServer(() => p().pins()),
      ...LIBRARY_FILES.map((k) => fromServer(() => p().libraryFile(k.name as LibraryFileName))),
    ],
    item: (key) => {
      const id = key.slice(key.indexOf(":") + 1);
      if (key.startsWith("entry:")) return fromServer(() => p().entry(id));
      if (key.startsWith("map:")) return fromServer(() => p().map(id));
      return fromServer(() => p().chronicle(id));
    },
  };
};

/** The parts of a snapshot that say the stored copies may be out of date. */
const markOf = (s: StatusSnapshot | null | undefined) =>
  s ? `${s.indexCommit}|${s.unpublished}|${s.drafts ?? 0}` : null;

/**
 * The snapshot as the device keeps it for an offline start: without who has unsaved changes and
 * who is reading (stage 31d). Those are true only while the stream says so, so a stored one would
 * show as current when the app opens with no connection, and storing them on every change of
 * who reads would write to the device for nothing.
 */
export function snapshotForDevice(s: StatusSnapshot): StatusSnapshot {
  const rest = { ...s };
  delete rest.othersUnsaved;
  delete rest.presence;
  return rest;
}

export class Keeper {
  private active = false;
  private stops: (() => void)[] = [];
  private refreshing: Promise<void> | null = null;
  private again = false;
  private tidying: Promise<void> | null = null;
  private tidyAgain = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private channel: BroadcastChannel | null = null;
  private readonly reads: KeeperReads;
  private readonly now: () => number;

  constructor(private readonly d: KeeperDeps) {
    this.reads = d.reads ?? appReads(() => this.slug());
    this.now = d.now ?? Date.now;
  }

  private slug(): string {
    return (this.d.slug ?? requireSlug)();
  }

  start(): void {
    this.channel = this.d.channel?.() ?? null;
    if (this.channel) {
      this.channel.onmessage = () => {
        if (this.active) this.schedule();
      };
    }
    if (this.d.queue.isSender) this.run();
    else this.stops.push(this.d.queue.onSender(() => this.run()));
    this.stops.push(this.d.queue.onCleared(() => this.stop()));
  }

  stop(): void {
    this.active = false;
    clearTimeout(this.timer);
    for (const s of this.stops.splice(0)) s();
    this.channel?.close();
    this.channel = null;
  }

  /** An item was opened or its body kept, in this tab: its images are stored, the rest tidied. */
  changed(): void {
    if (this.active) this.schedule();
    else this.channel?.postMessage("changed");
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tidy(), 200);
  }

  private run(): void {
    if (this.active) return;
    this.active = true;
    let mark = markOf(this.d.connection.snapshot);
    let online = this.d.connection.state === "online";
    let stored = "";
    this.stops.push(
      this.d.connection.subscribe(() => {
        const snapshot = this.d.connection.snapshot;
        if (snapshot) {
          const kept = snapshotForDevice(snapshot);
          const text = JSON.stringify(kept);
          // Only a change that the device keeps is written: a person starting or stopping to read
          // changes none of it.
          if (text !== stored) {
            stored = text;
            void this.d.queue.setMeta("snapshot", kept).catch(() => undefined);
          }
        }
        const now = markOf(snapshot);
        const back = this.d.connection.state === "online" && !online;
        online = this.d.connection.state === "online";
        if (back || (now !== null && now !== mark)) {
          mark = now;
          void this.refresh();
        }
      }),
    );
    let records = this.recordKeys();
    this.stops.push(
      this.d.queue.subscribeList(() => {
        // A record sent or dropped: what it changed is read again.
        const now = this.recordKeys();
        if (now !== records) {
          records = now;
          void this.refresh();
        }
      }),
    );
    if (this.d.standalone?.()) void this.persist();
    void this.refresh();
  }

  private recordKeys(): string {
    return this.d.queue
      .current()
      .map((r) => `${r.key}:${r.state}`)
      .sort()
      .join("|");
  }

  private online(): boolean {
    return this.active && this.d.connection.state === "online";
  }

  /** Reads the compact index and the lists again, then each item whose version changed. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.again = false;
        if (!this.online()) break;
        await this.refreshOnce().catch(() => undefined);
      } while (this.again);
      this.refreshing = null;
    })();
    return this.refreshing;
  }

  private async refreshOnce(): Promise<void> {
    const [graph, maps, chronicles] = await Promise.all([
      this.reads.graph(),
      this.reads.maps().catch(() => null),
      this.reads.chronicles().catch(() => null),
    ]);
    await Promise.allSettled(this.reads.others());
    const marks = new Map<string, string | undefined>([
      ...graph.nodes.map((n) => [`entry:${n.path}`, n.v] as const),
      ...(maps?.maps ?? []).map((m) => [`map:${m.id}`, m.v] as const),
      ...(chronicles?.chronicles ?? []).map((c) => [`chronicle:${c.id}`, c.v] as const),
    ]);
    const held = new Set<string>(this.d.queue.current().map((r: QueueRecord) => r.key));
    for (const item of await this.d.device.items()) {
      if (!this.online()) return;
      if (held.has(item.key)) continue;
      const answer = await this.d.device.answer(bodyUrl(item.key));
      const kind = kindOf(item.key);
      // Without its list nothing is known about the item; it stays as it is.
      if (answer && kind !== "entry" && (kind === "map" ? maps : chronicles) === null) continue;
      if (answer && marks.has(item.key)) {
        const listed = marks.get(item.key);
        // An older server's lists carry no marks: then nothing is known to have changed.
        if (listed === undefined || listed === markOfAnswer(item.key, answer)) continue;
      }
      // Changed, missing from its list (a 404 then removes it), or not on the device yet.
      await this.reads.item(item.key).catch((err: unknown) => {
        // Gone from the server: gone from here too.
        if (err instanceof ApiFailure && err.status === 404) return this.d.device.forget(item.key);
      });
    }
    await this.tidy();
  }

  /** Removes what goes beyond the counts, stores the images still missing, drops unused ones. */
  tidy(): Promise<void> {
    if (this.tidying) {
      this.tidyAgain = true;
      return this.tidying;
    }
    this.tidying = (async () => {
      do {
        this.tidyAgain = false;
        await this.tidyOnce().catch(() => undefined);
      } while (this.tidyAgain);
      this.tidying = null;
    })();
    return this.tidying;
  }

  private async tidyOnce(): Promise<void> {
    const held = new Set<string>(this.d.queue.current().map((r) => r.key));
    let items = await this.d.device.items();
    if (items.length > 0 && !(await this.d.queue.meta("persistAsked"))) {
      await this.d.queue.setMeta("persistAsked", true);
      void this.persist();
      this.d.onFirstItem?.();
    }
    // Beyond its count, the least recently opened goes; one with a record never does.
    for (const kind of Object.keys(COUNTS) as Kind[]) {
      const ofKind = items
        .filter((i) => kindOf(i.key) === kind && !held.has(i.key))
        .sort((a, b) => b.opened - a.opened);
      for (const old of ofKind.slice(COUNTS[kind])) await this.d.device.forget(old.key);
    }
    items = await this.d.device.items();
    const keys = new Set(items.map((i) => i.key));
    // A body read for an item that was never opened, as by the history page, is not kept.
    for (const a of await this.d.device.answers()) {
      if (a.item && !keys.has(a.item) && this.now() - a.at > GRACE_MS) {
        await this.d.device.removeAnswer(a.url);
      }
    }
    await this.storeImages(items);
  }

  /** The images an item's body shows, at the size this device shows them. */
  private async imagesOf(item: DeviceItem): Promise<string[]> {
    const answer = await this.d.device.answer(bodyUrl(item.key));
    if (!answer) return [];
    if (item.key.startsWith("entry:")) {
      const links = (answer.body as { links?: { kind: string; target?: string }[] }).links ?? [];
      return [
        ...new Set(
          links
            .filter((l) => l.kind === "image" && l.target)
            .map((l) => imageUrl(l.target!, 1280, this.slug())),
        ),
      ];
    }
    if (item.key.startsWith("map:")) {
      const map = (answer.body as { map: MapFile }).map;
      const size = this.d.mapSize?.() ?? 4096;
      const icons = new Set(
        map.features.flatMap((f) => (f.kind === "marker" && f.icon ? [f.icon] : [])),
      );
      const sets = (await this.d.device.answer("/api/marker-sets"))?.body as
        { sets: { name: string; icons: { name: string; path: string }[] }[] } | undefined;
      const iconPaths = [...icons].flatMap((icon) => {
        const path = sets?.sets
          .find((s) => s.name === icon.set)
          ?.icons.find((i) => i.name === icon.name)?.path;
        return path ? [imageUrl(path, undefined, this.slug())] : [];
      });
      return [
        ...new Set([
          ...map.images.map((i) => mapImageUrl(i.path, size, this.slug())),
          ...iconPaths,
        ]),
      ];
    }
    // Chronicles carry no images.
    return [];
  }

  private async storeImages(items: DeviceItem[]): Promise<void> {
    const caches = this.d.caches;
    if (!caches) return;
    const cache = await caches.open(IMAGES);
    const sizes = (await this.d.queue.meta<Record<string, number>>("imageSizes")) ?? {};
    const wanted = new Set<string>();
    for (const item of items) {
      const want = await this.imagesOf(item);
      for (const url of want) wanted.add(url);
      const have = item.images.filter((u) => want.includes(u));
      for (const url of want) {
        if (have.includes(url)) continue;
        if (!this.online()) break;
        const size = await this.storeImage(cache, url);
        if (size === null) continue;
        sizes[url] = size;
        have.push(url);
      }
      if (have.length !== item.images.length || have.some((u, i) => u !== item.images[i])) {
        await this.d.device.setImages(item.key, have);
      }
    }
    // An image no item lists goes.
    for (const url of Object.keys(sizes)) {
      if (wanted.has(url)) continue;
      await cache.delete(url).catch(() => false);
      delete sizes[url];
    }
    await this.d.queue.setMeta("imageSizes", sizes);
  }

  /** Stores one image; its size, or null when it could not be fetched or stored. */
  private async storeImage(cache: Cache, url: string): Promise<number | null> {
    try {
      const res = await (this.d.fetch ?? fetch)(url, { credentials: "same-origin" });
      if (!res.ok) return null;
      const size = (await res.clone().blob()).size;
      try {
        await cache.put(url, res.clone());
      } catch (err) {
        if (!isFull(err) || !(await this.d.device.removeOldest())) return null;
        await cache.put(url, res);
      }
      return size;
    } catch {
      return null;
    }
  }

  private async persist(): Promise<void> {
    await this.d.persist?.().catch(() => false);
  }
}

/** The version mark of an item's body as the device holds it, to compare with the lists'. */
export function markOfAnswer(key: string, answer: DeviceAnswer): string {
  const body = answer.body as {
    blob?: string;
    revision?: number;
    draft?: { revision: number } | null;
  };
  return key.startsWith("entry:")
    ? versionMark(body.blob, body.draft?.revision)
    : versionMark(body.blob, body.revision);
}
