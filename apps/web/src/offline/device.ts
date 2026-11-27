/**
 * The device copy (stage 15b): reads served from the device when the server cannot be reached.
 *
 * Every GET goes through `read` (`api.ts`). For the routes below, a successful answer is kept in
 * the database's `answers` store; when the server cannot be reached (status 0, which `api.ts` also
 * gives a gateway's page or one that is not JSON), the kept answer is returned instead, marked
 * with the time it was stored. While the connection service is not online, the kept answer comes
 * at once and the server is asked in the background; online, a read with a kept answer waits at
 * most 6 seconds. Any other failure the server answers with is shown as it is.
 *
 * Unsent changes from the save queue are laid over what the device answers for the tree and the
 * graph, and an entry with a record shows the record's text, as the editor does.
 *
 * Loaded on its own once signed in (`copy.ts`), so the first page of the app comes up sooner.
 */
import type {
  EntryLink,
  EntryResponse,
  GraphNode,
  GraphResponse,
  StatusSnapshot,
  TreeFolder,
  TreeResponse,
} from "@frontier/schema";
import {
  createResolver,
  dirname,
  extractHeadings,
  findLinks,
  isImage,
  rankNames,
  type Resolution,
  stem,
} from "@frontier/vault";
import { ApiFailure, projectUrl, type ReadThrough, setReadThrough } from "../api.ts";
import { currentProject, onProjectChange, type ProjectRef } from "../project.ts";
import { knownProjects, markOffDevice, markOnDevice, projectAt } from "../projects.ts";
import { connection } from "../sync/connection.ts";
import type { DeviceAnswer, DeviceItem, QueueRecord, Store } from "../sync/db.ts";
import { queue } from "../sync/queue.ts";
import {
  announceFresh,
  FIRST_ITEM,
  markServed,
  markUnsent,
  NOT_ON_DEVICE,
  servedFromDevice,
} from "./copy.ts";
import { Keeper } from "./keeper.ts";

/**
 * One number per route shape, stored with each answer. An answer whose number differs from the
 * running app's is not served (it counts as absent) and is replaced when the next read of its
 * address succeeds; answers are never dropped in bulk, so an update made offline does not empty
 * the device. Raise a route's number when its answer changes in a way the pages cannot read;
 * adding an optional field needs no raise.
 */
export const DEVICE_SCHEMA = {
  graph: 1,
  tree: 1,
  maps: 1,
  map: 1,
  chronicles: 1,
  chronicle: 1,
  entry: 1,
  markerSets: 1,
  schema: 1,
  libraryFile: 1,
  pins: 1,
} as const;
export type Shape = keyof typeof DEVICE_SCHEMA;

/** How long a read with an answer on the device waits for the server while online. */
export const SLOW_MS = 6000;

export type ItemKey = `entry:${string}` | `map:${string}` | `chronicle:${string}`;

export type Route =
  | { kind: "stored"; shape: Shape; item?: ItemKey }
  | { kind: "switcher"; query: string }
  | { kind: "findImage"; name: string; from: string };

/** The address of the compact index. */
export const INDEX_URL = "/api/graph";

/** What the device does with a read of this address; null for the routes it leaves alone. */
export function routeOf(url: string): Route | null {
  const [path = "", search = ""] = url.split("?");
  const q = new URLSearchParams(search);
  if (path === INDEX_URL) return { kind: "stored", shape: "graph" };
  if (path === "/api/tree") return { kind: "stored", shape: "tree" };
  if (path === "/api/maps") return { kind: "stored", shape: "maps" };
  if (path === "/api/chronicles") return { kind: "stored", shape: "chronicles" };
  if (path === "/api/marker-sets") return { kind: "stored", shape: "markerSets" };
  if (path === "/api/schema") return { kind: "stored", shape: "schema" };
  if (path === "/api/pins") return { kind: "stored", shape: "pins" };
  if (/^\/api\/library-files\/[a-z-]+$/.test(path)) return { kind: "stored", shape: "libraryFile" };
  const map = /^\/api\/maps\/([a-z0-9]{8})$/.exec(path);
  if (map) return { kind: "stored", shape: "map", item: `map:${map[1]}` };
  const chronicle = /^\/api\/chronicles\/([a-z0-9]{8})$/.exec(path);
  if (chronicle) return { kind: "stored", shape: "chronicle", item: `chronicle:${chronicle[1]}` };
  if (path === "/api/entries" && q.has("path")) {
    return { kind: "stored", shape: "entry", item: `entry:${q.get("path")}` };
  }
  if (path === "/api/switcher") return { kind: "switcher", query: q.get("q") ?? "" };
  if (path === "/api/images/find" && q.has("name") && q.has("from")) {
    return { kind: "findImage", name: q.get("name")!, from: q.get("from")! };
  }
  return null;
}

/** The address an item's body is read from, as `api.ts` makes it. */
export function bodyUrl(key: string): string {
  if (key.startsWith("entry:")) return `/api/entries?path=${encodeURIComponent(key.slice(6))}`;
  if (key.startsWith("map:")) return `/api/maps/${key.slice(4)}`;
  return `/api/chronicles/${key.slice(10)}`;
}

const nameOfPath = (path: string) => stem(path);

export interface DeviceDeps {
  store: () => Promise<Store>;
  /** The save queue's records, kept up to date. */
  records: () => QueueRecord[];
  online: () => boolean;
  /** Asks the connection service to look again, as after a read that did not come back in time. */
  unreachable: () => void;
  now?: () => number;
  slowMs?: number;
  /** Told that an item was opened or kept, so the keeper can store its images and tidy up. */
  onChange?: () => void;
  caches?: Pick<CacheStorage, "open"> | undefined;
  /**
   * The front of the addresses of this project's images in Cache Storage, which is shared by all
   * projects: clearing this device copy removes only these.
   */
  imagePrefix?: () => string;
  /** Told when the copy starts to exist (its compact index was kept) and when it is emptied. */
  onDevice?: (on: boolean) => void;
  /** Tells the pages a late answer replaced the device's; defaults to `announceFresh`. */
  fresh?: (url: string) => void;
}

/** The Cache Storage cache of the images on this device, which the service worker reads. */
export const IMAGES = "frontier-images";

const SLOW = Symbol("slow");

/** A failed write for want of space, in IndexedDB or Cache Storage. */
export const isFull = (err: unknown): boolean =>
  err instanceof DOMException
    ? err.name === "QuotaExceededError"
    : (err as { name?: string } | null)?.name === "QuotaExceededError";

export class DeviceCopy implements ReadThrough {
  private readonly now: () => number;
  /** Writes on their way, for tests and for the keeper to wait on. */
  private writes = new Set<Promise<unknown>>();

  constructor(readonly d: DeviceDeps) {
    this.now = d.now ?? Date.now;
  }

  read(url: string, network: () => Promise<unknown>, direct: boolean): Promise<unknown> | null {
    const route = routeOf(url);
    if (!route) return null;
    if (direct) {
      return network().then((body) => {
        if (route.kind === "stored") this.track(this.keep(url, route, body));
        return body;
      });
    }
    return this.through(url, route, network);
  }

  /** Resolves once every write started so far has finished. */
  async settled(): Promise<void> {
    while (this.writes.size > 0) await Promise.allSettled([...this.writes]);
  }

  private track(write: Promise<unknown>): void {
    const p = write.catch(() => undefined).finally(() => this.writes.delete(p));
    this.writes.add(p);
  }

  private async through(url: string, route: Route, network: () => Promise<unknown>) {
    let kept: Promise<unknown> = Promise.resolve();
    const fromNetwork = network().then((body) => {
      if (route.kind === "stored") {
        kept = this.keep(url, route, body).catch(() => undefined);
        this.track(kept);
      }
      return body;
    });
    // Its failure is handled below, wherever the read goes; it must not count as unhandled first.
    fromNetwork.catch(() => undefined);
    /** A late answer after the device answered: kept above, and announced. */
    const later = () =>
      void fromNetwork.then(
        () => kept.then(() => (this.d.fresh ?? announceFresh)(url)),
        (err: unknown) => this.gone(route, err),
      );
    const here = await this.fallback(url, route).catch(() => undefined);

    if (here !== undefined && !this.d.online()) {
      later();
      return this.shown(route, here);
    }
    if (here === undefined) {
      try {
        return await this.shown(route, await fromNetwork);
      } catch (err) {
        this.gone(route, err);
        if (!(err instanceof ApiFailure) || err.status !== 0) throw err;
        return this.missing(route, err);
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<typeof SLOW>((resolve) => {
      timer = setTimeout(() => resolve(SLOW), this.d.slowMs ?? SLOW_MS);
    });
    try {
      const first = await Promise.race([fromNetwork, slow]);
      if (first === SLOW) {
        this.d.unreachable();
        later();
        return this.shown(route, here);
      }
      return this.shown(route, first);
    } catch (err) {
      this.gone(route, err);
      // The server answered, and said no: that is shown, never the device's copy.
      if (!(err instanceof ApiFailure) || err.status !== 0) throw err;
      return this.shown(route, here);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The server said an item is gone: so is its copy here. */
  private gone(route: Route, err: unknown): void {
    if (route.kind === "stored" && route.item && err instanceof ApiFailure && err.status === 404) {
      this.track(this.forget(route.item));
    }
  }

  /** Nothing on the device, and no server: an item says so; anything else fails as before. */
  private async missing(route: Route, err: ApiFailure): Promise<unknown> {
    if (route.kind !== "stored" || !route.item) throw err;
    if (route.shape === "entry") {
      const record = this.record(route.item);
      if (record) return this.fromRecord(route.item.slice(6), record);
    }
    const name =
      route.shape === "entry"
        ? nameOfPath(route.item.slice(6))
        : route.shape === "map"
          ? "This map"
          : "This chronicle";
    throw new ApiFailure(
      0,
      NOT_ON_DEVICE,
      `${name} is not on this device. It opens when you are connected.`,
    );
  }

  private record(key: string): QueueRecord | undefined {
    return this.d.records().find((r) => r.key === key);
  }

  /** What is shown for an answer: an entry with a change not sent yet shows that change's text. */
  private async shown(route: Route, body: unknown): Promise<unknown> {
    if (route.kind !== "stored" || route.shape !== "entry" || !route.item) return body;
    const record = this.record(route.item);
    const entry = body as EntryResponse;
    if (!record || record.kind === "delete" || typeof record.value !== "string") return body;
    if (record.value === entry.text) return body;
    const shown: EntryResponse = {
      ...entry,
      text: record.value,
      state: "unpublished",
      links: await this.linksOf(entry.path, record.value),
      headings: extractHeadings(record.value),
    };
    const at = servedFromDevice(body);
    if (at !== null) markServed(shown, at);
    markUnsent(shown);
    return shown;
  }

  /** An entry this device has a record of and no answer for, as one made offline. */
  private async fromRecord(path: string, record: QueueRecord): Promise<EntryResponse> {
    const text = typeof record.value === "string" ? record.value : "";
    const entry: EntryResponse = {
      path,
      text,
      lineEnding: "lf",
      readOnly: false,
      state: "unpublished",
      links: await this.linksOf(path, text),
      backlinks: [],
      headings: extractHeadings(text),
      draft:
        record.kind === "delete"
          ? null
          : { id: record.draftId, revision: record.revision, kind: record.kind ?? "create" },
      id: null,
      fields: {
        type: null,
        typeFrom: "none",
        typeKnown: true,
        time: [],
        problems: [],
        proposed: [],
      },
      maps: [],
      chronicles: [],
      blob: record.baseBlob ?? "",
      rename: null,
    };
    markUnsent(entry);
    return entry;
  }

  /** A text's links, resolved over the compact index as the server resolves a draft's. */
  private async linksOf(from: string, text: string): Promise<EntryLink[]> {
    const index = await this.index();
    const resolver = createResolver(index ? pathsOf(index) : []);
    return findLinks(text).map((link) => ({
      raw: link.raw,
      from: link.start,
      to: link.end,
      ...linkOf(resolver.resolve(link, from)),
    }));
  }

  // ---- What the device answers ------------------------------------------------------------

  /** The kept answer for an address, if its shape is the running app's. */
  private async stored(url: string, shape: Shape): Promise<DeviceAnswer | undefined> {
    const answer = await (await this.d.store()).answer(url);
    return answer && answer.shape === DEVICE_SCHEMA[shape] ? answer : undefined;
  }

  /** The compact index on the device with the unsent changes laid over it; undefined without one. */
  async index(): Promise<GraphResponse | undefined> {
    const answer = await this.stored(INDEX_URL, "graph");
    return answer ? overlayGraph(answer.body as GraphResponse, this.d.records()) : undefined;
  }

  /** What the device answers for an address; undefined when it has nothing. */
  private async fallback(url: string, route: Route): Promise<unknown> {
    if (route.kind === "switcher") {
      const index = await this.index();
      if (!index) return undefined;
      return { results: rankNames(index.nodes.map(nameSource), route.query) };
    }
    if (route.kind === "findImage") {
      const index = await this.index();
      if (!index) return undefined;
      const link = findLinks(`![[${route.name}]]`)[0];
      const r = link ? createResolver(pathsOf(index)).resolve(link, route.from) : null;
      return { path: r?.kind === "file" && isImage(r.path) ? r.path : null };
    }
    const answer = await this.stored(url, route.shape);
    if (!answer) return undefined;
    const records = this.d.records();
    const body =
      route.shape === "graph"
        ? overlayGraph(answer.body as GraphResponse, records)
        : route.shape === "tree"
          ? overlayTree(answer.body as TreeResponse, records)
          : answer.body;
    markServed(body, answer.at);
    return body;
  }

  // ---- Keeping -----------------------------------------------------------------------------

  /**
   * Keeps an answer. A write that fails for want of space removes the least recently opened item
   * (never one with a record) and tries once more; if it still fails, the answer is not kept.
   */
  async keep(url: string, route: Route & { kind: "stored" }, body: unknown): Promise<void> {
    const store = await this.d.store();
    if (!store.device) return;
    const text = JSON.stringify(body);
    const answer: DeviceAnswer = {
      url,
      at: this.now(),
      shape: DEVICE_SCHEMA[route.shape],
      body,
      bytes: new Blob([text]).size,
      ...(route.item ? { item: route.item } : {}),
    };
    try {
      await store.putAnswer(answer);
    } catch (err) {
      if (!isFull(err) || !(await this.removeOldest())) return;
      await store.putAnswer(answer).catch(() => undefined);
    }
    if (route.shape === "graph") this.d.onDevice?.(true);
    if (route.item) this.d.onChange?.();
  }

  /** Marks an item opened now, so it is among the recent ones the device keeps. */
  async opened(key: ItemKey): Promise<void> {
    const store = await this.d.store();
    if (!store.device) return;
    const known = await store.item(key);
    await store.putItem({ key, opened: this.now(), images: known?.images ?? [] });
    this.d.onChange?.();
  }

  /** Removes an item's body and its entry in `items`; its images go once no item lists them. */
  async forget(key: string): Promise<void> {
    const store = await this.d.store();
    await store.removeItem(key);
    for (const a of await store.answers()) if (a.item === key) await store.removeAnswer(a.url);
  }

  /** Removes the least recently opened item without a record; false when there is none. */
  async removeOldest(): Promise<boolean> {
    const store = await this.d.store();
    const held = new Set<string>(this.d.records().map((r) => r.key));
    const oldest = (await store.items())
      .filter((i) => !held.has(i.key))
      .sort((a, b) => a.opened - b.opened)[0];
    if (!oldest) return false;
    await this.forget(oldest.key);
    return true;
  }

  async items(): Promise<DeviceItem[]> {
    return (await this.d.store()).items();
  }

  /** An item body's answer as kept, if it is of the running app's shape. */
  async answer(url: string): Promise<DeviceAnswer | undefined> {
    const route = routeOf(url);
    return route?.kind === "stored" ? this.stored(url, route.shape) : undefined;
  }

  async answers(): Promise<DeviceAnswer[]> {
    return (await this.d.store()).answers();
  }

  async removeAnswer(url: string): Promise<void> {
    await (await this.d.store()).removeAnswer(url);
  }

  /** Records the image addresses stored for an item. */
  async setImages(key: string, images: string[]): Promise<void> {
    const store = await this.d.store();
    const item = await store.item(key);
    if (item) await store.putItem({ ...item, images });
  }

  /**
   * The space the device copy takes: the items' bodies and their images, an image two items
   * share counted once, and the answers always kept. Null when nothing can be kept.
   */
  async space(): Promise<number | null> {
    const store = await this.d.store();
    if (!store.device) return null;
    const sizes = (await store.meta<Record<string, number>>("imageSizes")) ?? {};
    const images = new Set((await store.items()).flatMap((i) => i.images));
    let bytes = 0;
    for (const a of await store.answers()) bytes += a.bytes;
    for (const url of images) bytes += sizes[url] ?? 0;
    return bytes;
  }

  /** Empties `answers`, `items` and the images on this device; changes not sent yet stay. */
  async clear(): Promise<void> {
    const store = await this.d.store();
    await store.clearDevice();
    await store.removeMeta("imageSizes");
    this.d.onDevice?.(false);
    // The images of the other projects stay: the cache is shared, and each has its own addresses.
    try {
      const cache = await this.d.caches?.open(IMAGES);
      const prefix = this.d.imagePrefix?.();
      for (const request of (await cache?.keys()) ?? []) {
        if (prefix === undefined || new URL(request.url).pathname.startsWith(prefix)) {
          await cache!.delete(request);
        }
      }
    } catch {
      /* Cache Storage is switched off: there is nothing in it */
    }
  }
}

function linkOf(r: Resolution): Pick<EntryLink, "kind" | "target" | "candidates"> {
  if (r.kind === "note") return { kind: "resolved", target: r.path };
  if (r.kind === "file") return { kind: isImage(r.path) ? "image" : "resolved", target: r.path };
  if (r.kind === "ambiguous") return { kind: "ambiguous", candidates: r.candidates };
  return { kind: r.kind };
}

const nameSource = (n: GraphNode) => ({ path: n.path, title: n.title, aliases: n.aliases ?? [] });

/** Every path the compact index knows: the entries and the library's other files. */
export const pathsOf = (index: GraphResponse): string[] => [
  ...index.nodes.map((n) => n.path),
  ...(index.files ?? []),
];

/** The entry records of the queue: creates and deletes, and texts to take links from. */
function entryRecords(records: QueueRecord[]) {
  return records
    .filter((r) => r.key.startsWith("entry:"))
    .map((r) => ({ path: r.key.slice(6), record: r }));
}

/**
 * The compact index with this device's unsent changes laid over it: a create adds a node, drawn as
 * unpublished; a delete removes it with its edges; an edit's or create's text gives that node its
 * own outgoing edges, resolved as the server resolves a draft's. No other node changes.
 */
export function overlayGraph(index: GraphResponse, records: QueueRecord[]): GraphResponse {
  const changes = entryRecords(records);
  if (changes.length === 0) return index;
  const nodes = new Map(index.nodes.map((n) => [n.path, n]));
  const edges = new Map<string, Set<string>>();
  index.edges.forEach(([a, b]) => {
    const from = index.nodes[a]!.path;
    edges.set(from, (edges.get(from) ?? new Set()).add(index.nodes[b]!.path));
  });
  for (const { path, record } of changes) {
    if (record.kind === "delete") {
      nodes.delete(path);
      edges.delete(path);
    } else if (record.kind === "create" && !nodes.has(path)) {
      nodes.set(path, { path, title: stem(path), type: null, unpublished: true });
    }
  }
  const resolver = createResolver([...nodes.keys(), ...(index.files ?? [])]);
  for (const { path, record } of changes) {
    if (record.kind === "delete" || typeof record.value !== "string" || !nodes.has(path)) continue;
    const out = new Set<string>();
    for (const link of findLinks(record.value)) {
      const r = resolver.resolve(link, path);
      if (r.kind === "note" && r.path !== path) out.add(r.path);
    }
    edges.set(path, out);
  }
  const paths = [...nodes.keys()].sort();
  const at = new Map(paths.map((p, i) => [p, i]));
  const list: [number, number][] = [];
  paths.forEach((path, from) => {
    for (const to of edges.get(path) ?? []) {
      const i = at.get(to);
      if (i !== undefined && i !== from) list.push([from, i]);
    }
  });
  return { ...index, nodes: paths.map((p) => nodes.get(p)!), edges: list };
}

/** The tree with this device's unsent creates added, as unpublished, and its deletes removed. */
export function overlayTree(tree: TreeResponse, records: QueueRecord[]): TreeResponse {
  const changes = entryRecords(records).filter(
    ({ record }) => record.kind === "create" || record.kind === "delete",
  );
  if (changes.length === 0) return tree;
  const root: TreeFolder = structuredClone({ path: "", folders: tree.folders, notes: tree.notes });
  const folderAt = (path: string): TreeFolder => {
    if (path === "") return root;
    const parent = folderAt(dirname(path));
    let folder = parent.folders.find((f) => f.path === path);
    if (!folder) {
      folder = { path, folders: [], notes: [] };
      parent.folders.push(folder);
    }
    return folder;
  };
  const without = (folder: TreeFolder, path: string): void => {
    folder.notes = folder.notes.filter((n) => n.path !== path);
    for (const f of folder.folders) without(f, path);
  };
  for (const { path, record } of changes) {
    if (record.kind === "delete") without(root, path);
    else {
      const folder = folderAt(dirname(path));
      if (!folder.notes.some((n) => n.path === path)) {
        folder.notes.push({ path, title: stem(path), state: "unpublished" });
      }
    }
  }
  return { folders: root.folders, notes: root.notes };
}

// ---- One device copy for each project ---------------------------------------------------------

const cacheStorage = typeof caches === "undefined" ? undefined : caches;

const standalone = () =>
  (navigator as { standalone?: boolean }).standalone === true ||
  (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);

/** The address of a project's call as the device copy keys it: `/api/p/<slug>/x` is `/api/x`. */
export function splitProjectUrl(url: string): { slug: string; bare: string } | null {
  const m = /^\/api\/p\/([^/?]+)(.*)$/.exec(url);
  if (!m) return null;
  let slug = m[1]!;
  try {
    slug = decodeURIComponent(slug);
  } catch {
    /* used as it is */
  }
  return { slug, bare: `/api${m[2] ?? ""}` };
}

/** The address a project has now: the owner may have renamed it since the copy was made. */
const slugOf = (ref: ProjectRef): string =>
  knownProjects()?.projects.find((p) => p.id === ref.id)?.slug ?? ref.slug;

interface Held {
  ref: ProjectRef;
  copy: DeviceCopy;
  keeper: Keeper | null;
}

/**
 * The device copies of every project, answering each read from its own project's copy (a read's
 * address names the project). Only the open project has a keeper that refreshes it; the others
 * keep what they have, and are still read when the server cannot be reached.
 */
export class DeviceHub implements ReadThrough {
  private held = new Map<string, Held>();
  private activeId: string | null = null;

  /** The copy of a project, made on first use over that project's queue's database. */
  forRef(ref: ProjectRef): Held {
    let h = this.held.get(ref.id);
    if (!h) {
      const q = queue.queueOf(ref);
      const slug = () => slugOf(ref);
      const copy = new DeviceCopy({
        store: () => q.database(),
        records: () => q.current(),
        online: () => connection.state === "online",
        unreachable: () => connection.unreachable(),
        onChange: () => this.held.get(ref.id)?.keeper?.changed(),
        caches: cacheStorage,
        imagePrefix: () => projectUrl("/images", slug()),
        onDevice: (on) => (on ? markOnDevice(ref.id) : markOffDevice(ref.id)),
        // A late answer is told to the pages only while its project is the open one.
        fresh: (url) => {
          if (currentProject()?.id === ref.id) announceFresh(url);
        },
      });
      h = { ref, copy, keeper: null };
      this.held.set(ref.id, h);
    }
    return h;
  }

  /** The project a read's address names: the open one, or one the person is in. */
  private refOf(slug: string): ProjectRef | null {
    const open = currentProject();
    if (open?.slug === slug) return open;
    const known = projectAt(slug);
    return known ? { id: known.id, slug: known.slug } : null;
  }

  read(url: string, network: () => Promise<unknown>, direct: boolean): Promise<unknown> | null {
    const parts = splitProjectUrl(url);
    if (!parts) return null;
    const ref = this.refOf(parts.slug);
    return ref ? this.forRef(ref).copy.read(parts.bare, network, direct) : null;
  }

  /** The open project's copy gets a keeper; the one before loses its. */
  activate(ref: ProjectRef | null): void {
    const before = this.activeId ? this.held.get(this.activeId) : undefined;
    before?.keeper?.stop();
    if (before) before.keeper = null;
    this.activeId = ref?.id ?? null;
    if (!ref) return;
    const h = this.forRef(ref);
    const q = queue.queueOf(ref);
    h.keeper = new Keeper({
      device: h.copy,
      queue: q,
      connection,
      caches: cacheStorage,
      slug: () => slugOf(ref),
      persist:
        typeof navigator !== "undefined" && navigator.storage?.persist
          ? () => navigator.storage.persist()
          : undefined,
      standalone,
      onFirstItem: () => window.dispatchEvent(new Event(FIRST_ITEM)),
      mapSize: () => (window.innerWidth < 700 ? 2560 : 4096),
      channel: () =>
        typeof BroadcastChannel === "undefined"
          ? null
          : new BroadcastChannel(`frontier-device:${ref.id}`),
    });
    h.keeper.start();
  }

  private active(): Held | null {
    const open = currentProject();
    return open ? this.forRef(open) : null;
  }

  /** Marks an item of the open project opened now, so it is among the recent ones kept. */
  async opened(key: ItemKey): Promise<void> {
    await this.active()?.copy.opened(key);
  }

  /** The space the open project's copy takes; null when nothing can be kept. */
  async space(): Promise<number | null> {
    return (await this.active()?.copy.space()) ?? null;
  }

  /** Empties the open project's copy. */
  async clear(): Promise<void> {
    await this.active()?.copy.clear();
  }

  /** The projects with a copy on this device, and the space each takes. */
  async spaces(refs: ProjectRef[]): Promise<{ id: string; bytes: number | null }[]> {
    return Promise.all(
      refs.map(async (ref) => ({ id: ref.id, bytes: await this.forRef(ref).copy.space() })),
    );
  }

  /** Empties one project's copy, whether or not it is the open one. */
  async clearProject(ref: ProjectRef): Promise<void> {
    await this.forRef(ref).copy.clear();
  }
}

/** The app's device copies. */
export const device = new DeviceHub();

let started: Promise<ReadThrough> | null = null;

/** Puts the device copies in front of the app's reads and starts the open project's keeper. */
export function startDevice(): Promise<ReadThrough> {
  started ??= (async () => {
    await queue.start();
    // The keeper follows the project that is open.
    onProjectChange((next) => device.activate(next));
    const open = currentProject();
    if (open) {
      // An offline start shows the last counts the server sent for this project.
      const last = await queue
        .queueOf(open)
        .meta<StatusSnapshot>("snapshot")
        .catch(() => undefined);
      if (last) connection.remember(last);
      device.activate(open);
    }
    // Logout in another tab: nothing more is fetched or kept here.
    queue.onCleared(() => {
      device.activate(null);
      setReadThrough(null);
    });
    return device;
  })();
  return started;
}
