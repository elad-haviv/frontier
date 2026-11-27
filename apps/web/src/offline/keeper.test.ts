// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import type { StatusSnapshot } from "@frontier/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { imageUrl } from "../api.ts";
import { openStore, type QueueRecord, type Store } from "../sync/db.ts";
import { bodyUrl, DEVICE_SCHEMA, DeviceCopy, type Shape } from "./device.ts";
import { Keeper, type KeeperReads } from "./keeper.ts";
import { setCurrentProject } from "../project.ts";

// Every test runs in one project: its calls go to `/api/p/avalymia/...`.
setCurrentProject({ id: "avalymia01", slug: "avalymia" });

let store: Store;
let records: QueueRecord[];
let device: DeviceCopy;
let clock: number;
let meta: Map<string, unknown>;
let listListeners: Set<() => void>;
let connectionListeners: Set<() => void>;
let connection: { state: "online" | "offline"; snapshot: StatusSnapshot | null };
let cached: Map<string, number>;
let reads: KeeperReads & { item: ReturnType<typeof vi.fn> };
let graph: { nodes: { path: string; v?: string }[] };
let maps: { maps: { id: string; v?: string }[] };

const record = (key: QueueRecord["key"]): QueueRecord => ({
  key,
  kind: "edit",
  draftId: "",
  revision: 0,
  baseBlob: "",
  value: "Unsent",
  op: "abcdefghijkl",
  state: "waiting",
  tries: 0,
  nextTry: 0,
  since: 1,
});

/** Puts an item on the device as opened at `opened`, with its body. */
async function put(key: string, opened: number, body: unknown) {
  const shape: Shape = key.startsWith("entry:")
    ? "entry"
    : key.startsWith("map:")
      ? "map"
      : "chronicle";
  await store.putItem({ key, opened, images: [] });
  await store.putAnswer({
    url: bodyUrl(key),
    at: opened,
    shape: DEVICE_SCHEMA[shape],
    body,
    bytes: 100,
    item: key,
  });
}

const entryBody = (path: string, blob = "aaaaaaaaaaaaaaaa", images: string[] = []) => ({
  path,
  text: "Text",
  blob,
  draft: null,
  links: images.map((target) => ({ raw: `![[${target}]]`, from: 0, to: 1, kind: "image", target })),
});

function makeKeeper() {
  return new Keeper({
    device,
    queue: {
      isSender: true,
      onSender: () => () => undefined,
      subscribeList: (l: () => void) => {
        listListeners.add(l);
        return () => listListeners.delete(l);
      },
      current: () => records,
      // The queue's `meta` is the database's, which the device copy reads too.
      meta: async <T>(key: string) => (meta.get(key) as T | undefined) ?? store.meta<T>(key),
      setMeta: async (key: string, value: unknown) => {
        meta.set(key, value);
        await store.setMeta(key, value);
      },
      onCleared: () => () => undefined,
    },
    connection: {
      get state() {
        return connection.state;
      },
      get snapshot() {
        return connection.snapshot;
      },
      subscribe: (l: () => void) => {
        connectionListeners.add(l);
        return () => connectionListeners.delete(l);
      },
    },
    reads,
    caches: {
      open: async () =>
        ({
          put: async (url: string, res: Response) => {
            cached.set(url, (await res.blob()).size);
          },
          delete: async (url: string) => cached.delete(url),
        }) as unknown as Cache,
      delete: async () => true,
    },
    fetch: vi.fn(async (url: RequestInfo | URL) => new Response("x".repeat(String(url).length))),
    now: () => clock,
  });
}

beforeEach(async () => {
  store = await openStore(`keeper-test-${Math.random()}`);
  records = [];
  clock = 1_000_000;
  meta = new Map();
  listListeners = new Set();
  connectionListeners = new Set();
  connection = { state: "online", snapshot: null };
  cached = new Map();
  graph = { nodes: [] };
  maps = { maps: [] };
  device = new DeviceCopy({
    store: async () => store,
    records: () => records,
    online: () => connection.state === "online",
    unreachable: () => undefined,
    now: () => clock,
  });
  reads = {
    graph: async () => graph,
    maps: async () => maps,
    chronicles: async () => ({ chronicles: [] }),
    others: () => [],
    item: vi.fn(async () => undefined),
  };
});

describe("the device keeper", () => {
  it("keeps the last 30 entries opened: the 31st removes the oldest", async () => {
    for (let i = 0; i < 31; i++) await put(`entry:e${i}.md`, 100 + i, entryBody(`e${i}.md`));
    await makeKeeper().tidy();
    const keys = (await store.items()).map((i) => i.key);
    expect(keys).toHaveLength(30);
    expect(keys).not.toContain("entry:e0.md");
    expect(await store.answer(bodyUrl("entry:e0.md"))).toBeUndefined();
    expect(await store.answer(bodyUrl("entry:e1.md"))).toBeDefined();
  });

  it("keeps 5 maps, and never removes an item with a record in the queue", async () => {
    for (let i = 0; i < 7; i++) {
      await put(`map:map0000${i}`, 100 + i, { map: { images: [], features: [] }, revision: 0 });
    }
    records = [record("map:map00000")];
    await makeKeeper().tidy();
    const keys = (await store.items()).map((i) => i.key).sort();
    // Five without a record, and the oldest, which has one.
    expect(keys).toEqual([
      "map:map00000",
      "map:map00002",
      "map:map00003",
      "map:map00004",
      "map:map00005",
      "map:map00006",
    ]);
  });

  it("stores an item's images, keeps one two items share until both go, and counts it once", async () => {
    const lamp = imageUrl("lamp.png", 1280);
    await put("entry:a.md", 100, entryBody("a.md", "a", ["lamp.png"]));
    await put("entry:b.md", 101, entryBody("b.md", "b", ["lamp.png", "bell.png"]));
    const keeper = makeKeeper();
    // Only the sending tab's keeper, once started, fetches anything.
    keeper.start();
    await keeper.refresh();
    await keeper.tidy();
    expect([...cached.keys()].sort()).toEqual([imageUrl("bell.png", 1280), lamp].sort());
    expect((await store.item("entry:a.md"))?.images).toEqual([lamp]);
    // Two bodies of 100 bytes, and each image once.
    const images = [...cached.values()].reduce((a, b) => a + b, 0);
    expect(await device.space()).toBe(200 + images);

    await device.forget("entry:b.md");
    await keeper.tidy();
    expect([...cached.keys()]).toEqual([lamp]);
    await device.forget("entry:a.md");
    await keeper.tidy();
    expect([...cached.keys()]).toEqual([]);
  });

  it("removes the oldest item and tries once more when the store is full", async () => {
    await put("entry:old.md", 1, entryBody("old.md"));
    await put("entry:held.md", 0, entryBody("held.md"));
    records = [record("entry:held.md")];
    const real = store.putAnswer.bind(store);
    let refused = 0;
    store.putAnswer = async (a) => {
      if (refused++ === 0) throw new DOMException("Full", "QuotaExceededError");
      return real(a);
    };
    await device.keep("/api/tree", { kind: "stored", shape: "tree" }, { folders: [], notes: [] });
    expect(refused).toBe(2);
    expect(await store.item("entry:old.md")).toBeUndefined();
    expect(await store.item("entry:held.md")).toBeDefined();
    expect((await store.answer("/api/tree"))?.body).toEqual({ folders: [], notes: [] });
  });

  it("reads again only the entries and maps whose version changed, skipping those with a record", async () => {
    await put("entry:same.md", 1, entryBody("same.md", "aaaaaaaaaaaa1111"));
    await put("entry:changed.md", 2, entryBody("changed.md", "bbbbbbbbbbbb1111"));
    await put("entry:held.md", 3, entryBody("held.md", "cccccccccccc1111"));
    await put("map:samemap1", 4, {
      map: { images: [], features: [] },
      revision: 0,
      blob: "dddddddddddd",
    });
    await put("map:newermap", 5, {
      map: { images: [], features: [] },
      revision: 0,
      blob: "eeeeeeeeeeee",
    });
    records = [record("entry:held.md")];
    graph = {
      nodes: [
        { path: "same.md", v: "aaaaaaaaaaaa" },
        { path: "changed.md", v: "bbbbbbbbbbbb.1" },
        { path: "held.md", v: "ffffffffffff" },
      ],
    };
    maps = {
      maps: [
        { id: "samemap1", v: "dddddddddddd" },
        { id: "newermap", v: "eeeeeeeeeeee.3" },
      ],
    };
    const keeper = makeKeeper();
    keeper.start();
    await keeper.refresh();
    expect([...new Set(reads.item.mock.calls.map(([key]) => key))].sort()).toEqual([
      "entry:changed.md",
      "map:newermap",
    ]);
    keeper.stop();
  });

  it("refreshes when the drafts count of a snapshot changes, though nothing else did", async () => {
    const snapshot = { indexCommit: "c1", unpublished: 2, drafts: 7 } as StatusSnapshot;
    connection.snapshot = snapshot;
    const graphRead = vi.fn(async () => graph);
    reads.graph = graphRead;
    const keeper = makeKeeper();
    keeper.start();
    await vi.waitFor(() => expect(graphRead).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The same counts again: nothing to read.
    connection.snapshot = { ...snapshot };
    for (const l of connectionListeners) l();
    expect(graphRead).toHaveBeenCalledTimes(1);
    connection.snapshot = { ...snapshot, drafts: 8 };
    for (const l of connectionListeners) l();
    await vi.waitFor(() => expect(graphRead).toHaveBeenCalledTimes(2));
    expect(meta.get("snapshot")).toEqual({ ...snapshot, drafts: 8 });
    keeper.stop();
  });

  it("reads nothing while offline", async () => {
    connection.state = "offline";
    const graphRead = vi.fn(async () => graph);
    reads.graph = graphRead;
    await makeKeeper().refresh();
    expect(graphRead).not.toHaveBeenCalled();
  });
});
