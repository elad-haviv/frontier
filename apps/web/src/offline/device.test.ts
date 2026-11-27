// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import type { GraphResponse, TreeResponse } from "@frontier/schema";
import { rankNames } from "@frontier/vault";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiFailure, bareUrl, fromServer, setReadThrough } from "../api.ts";
import { openStore, type QueueRecord, type Store } from "../sync/db.ts";
import { NOT_ON_DEVICE, notSentYet, onFresh, servedFromDevice } from "./copy.ts";
import { DEVICE_SCHEMA, DeviceCopy, overlayGraph, overlayTree, splitProjectUrl } from "./device.ts";
import { setCurrentProject } from "../project.ts";

// Every test runs in one project: its calls go to `/api/p/avalymia/...`.
setCurrentProject({ id: "avalymia01", slug: "avalymia" });

const HARBOR = "01 Places/Harbor/Harbor.md";
const QUAY = "01 Places/Harbor/Old Quay.md";
const MIRA = "02 People/Mira.md";
const SHADE = "02 People/Shade.md";

const INDEX: GraphResponse = {
  nodes: [
    { path: HARBOR, title: "Harbor", type: "place", aliases: ["The Port"], v: "aaaaaaaaaaaa" },
    { path: QUAY, title: "Old Quay", type: "place", v: "bbbbbbbbbbbb" },
    { path: MIRA, title: "Mira", type: "person", v: "cccccccccccc.2" },
    { path: SHADE, title: "Shade", type: null, v: "dddddddddddd" },
  ],
  // Quay → Harbor, Mira → Harbor, Mira → Quay, Shade → Mira
  edges: [
    [1, 0],
    [2, 0],
    [2, 1],
    [3, 2],
  ],
  folders: [],
  nested: [],
  files: ["99 Appendices/Images/lamp.png"],
};

const TREE: TreeResponse = {
  folders: [
    {
      path: "02 People",
      folders: [],
      notes: [{ path: MIRA, title: "Mira", state: "published" }],
    },
  ],
  notes: [],
};

let store: Store;
let records: QueueRecord[];
let online: boolean;
let unreachable: ReturnType<typeof vi.fn>;
let device: DeviceCopy;
/** What the server answers, by address; a function may throw to fail the request. */
let answers: Map<string, () => Response | Promise<Response>>;
let clock: number;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const down = () => {
  throw new TypeError("Failed to fetch");
};

function record(
  key: QueueRecord["key"],
  kind: "edit" | "create" | "delete",
  value: string,
): QueueRecord {
  return {
    key,
    kind,
    draftId: "",
    revision: 0,
    baseBlob: "",
    value,
    op: "abcdefghijkl",
    state: "waiting",
    tries: 0,
    nextTry: 0,
    since: 1,
  };
}

beforeEach(async () => {
  store = await openStore(`device-test-${Math.random()}`);
  records = [];
  online = true;
  unreachable = vi.fn();
  clock = 1_000_000;
  answers = new Map();
  device = new DeviceCopy({
    store: async () => store,
    records: () => records,
    online: () => online,
    unreachable,
    now: () => clock,
  });
  // As the app's device hub does: a read of the project's address is the copy's own address.
  setReadThrough(
    Promise.resolve({
      read: (url, network, direct) => {
        const parts = splitProjectUrl(url);
        return parts ? device.read(parts.bare, network, direct) : null;
      },
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = bareUrl(String(input));
      const answer = answers.get(url);
      if (url === "/api/status") return json({}, 200);
      if (!answer) return json({ error: { code: "not_found", message: "Nothing here." } }, 404);
      return answer();
    }),
  );
});

afterEach(() => {
  setReadThrough(null);
  vi.unstubAllGlobals();
});

describe("the device copy", () => {
  it("keeps a good answer and gives it back, marked, when the server cannot be reached", async () => {
    answers.set("/api/tree", () => json(TREE));
    const first = await api.tree();
    expect(first).toEqual(TREE);
    expect(servedFromDevice(first)).toBeNull();
    await device.settled();

    answers.set("/api/tree", down);
    const again = await api.tree();
    expect(again).toEqual(TREE);
    expect(servedFromDevice(again)).toBe(clock);
  });

  it("keeps the pins for Home to show offline, and not the rest of the keep-going answers", async () => {
    const PINS = { pins: [{ path: MIRA, title: "Mira", words: 12 }] };
    answers.set("/api/pins", () => json(PINS));
    answers.set("/api/keep-going/queue", () => json({ entries: 1 }));
    await api.pins();
    await api.keepGoingQueue();
    await device.settled();
    answers.set("/api/pins", down);
    answers.set("/api/keep-going/queue", down);
    expect(await api.pins()).toEqual(PINS);
    await expect(api.keepGoingQueue()).rejects.toMatchObject({ status: 0, code: "offline" });
  });

  it("never puts the device's copy over a refusal the server answered with", async () => {
    answers.set("/api/tree", () => json(TREE));
    await api.tree();
    await device.settled();
    answers.set("/api/tree", () => json({ error: { code: "not_allowed", message: "No." } }, 403));
    await expect(api.tree()).rejects.toMatchObject({ status: 403 });
    answers.set("/api/tree", () => json({ error: { code: "x", message: "Broken." } }, 500));
    await expect(api.tree()).rejects.toMatchObject({ status: 500 });
  });

  it("forgets an item the server says is gone", async () => {
    const url = `/api/entries?path=${encodeURIComponent(MIRA)}`;
    answers.set(url, () => json({ path: MIRA, text: "Mira", blob: "c", draft: null, links: [] }));
    await api.entry(MIRA);
    await device.opened(`entry:${MIRA}`);
    await device.settled();
    answers.delete(url);
    await expect(api.entry(MIRA)).rejects.toMatchObject({ status: 404 });
    await device.settled();
    expect(await store.answer(url)).toBeUndefined();
    expect(await store.item(`entry:${MIRA}`)).toBeUndefined();
  });

  it("answers from the device for a gateway's 503 and a page that is not JSON", async () => {
    answers.set("/api/tree", () => json(TREE));
    await api.tree();
    await device.settled();
    answers.set("/api/tree", () => new Response("<h1>Bad gateway</h1>", { status: 503 }));
    expect(servedFromDevice(await api.tree())).toBe(clock);
    answers.set(
      "/api/tree",
      () => new Response("<html>Sign in to the Wi-Fi</html>", { status: 200 }),
    );
    expect(servedFromDevice(await api.tree())).toBe(clock);
  });

  it("offline, answers at once, and takes in a late answer when one comes", async () => {
    answers.set("/api/tree", () => json(TREE));
    await api.tree();
    await device.settled();
    online = false;
    let release!: () => void;
    const later: TreeResponse = {
      folders: [],
      notes: [{ path: "A.md", title: "A", state: "published" }],
    };
    answers.set(
      "/api/tree",
      () => new Promise<Response>((resolve) => (release = () => resolve(json(later)))),
    );
    const fresh = vi.fn();
    const stop = onFresh(fresh);
    clock += 5000;
    const shown = await api.tree();
    expect(shown).toEqual(TREE);
    expect(servedFromDevice(shown)).toBe(1_000_000);
    release();
    await vi.waitFor(() => expect(fresh).toHaveBeenCalledWith("/api/tree"));
    expect((await store.answer("/api/tree"))?.body).toEqual(later);
    stop();
  });

  it("online but slow, gives the device's answer after 6 seconds and asks the server once", async () => {
    answers.set("/api/tree", () => json(TREE));
    await api.tree();
    await device.settled();
    answers.set("/api/tree", () => new Promise<Response>(() => undefined));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let shown: unknown = null;
      void api.tree().then((t) => (shown = t));
      await vi.waitFor(() => {
        vi.advanceTimersByTime(1000);
        expect(shown).not.toBeNull();
      });
      expect(servedFromDevice(shown)).toBe(clock);
      expect(unreachable).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not serve an answer of another shape, and replaces it on the next good read", async () => {
    await store.putAnswer({
      url: "/api/tree",
      at: 1,
      shape: DEVICE_SCHEMA.tree + 1,
      body: { old: true },
      bytes: 12,
    });
    answers.set("/api/tree", down);
    await expect(api.tree()).rejects.toMatchObject({ status: 0 });
    answers.set("/api/tree", () => json(TREE));
    await api.tree();
    await device.settled();
    expect(await store.answer("/api/tree")).toMatchObject({
      shape: DEVICE_SCHEMA.tree,
      body: TREE,
    });
  });

  it("says an entry that is not on the device is not, with no server", async () => {
    answers.set(`/api/entries?path=${encodeURIComponent(SHADE)}`, down);
    const failure = await api.entry(SHADE).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure).toMatchObject({
      status: 0,
      code: NOT_ON_DEVICE,
      message: "Shade is not on this device. It opens when you are connected.",
    });
  });

  it("keeps what a read straight from the server says, and never falls back for it", async () => {
    answers.set("/api/graph", () => json(INDEX));
    await fromServer(() => api.graph());
    await device.settled();
    expect((await store.answer("/api/graph"))?.body).toEqual(INDEX);
    answers.set("/api/graph", down);
    await expect(fromServer(() => api.graph())).rejects.toMatchObject({ status: 0 });
  });
});

describe("answers made from the compact index", () => {
  beforeEach(async () => {
    answers.set("/api/graph", () => json(INDEX));
    await api.graph();
    await device.settled();
    online = false;
    for (const url of ["/api/graph"]) answers.set(url, down);
  });

  it("finds names as the server's switcher ranks them", async () => {
    answers.set("/api/switcher?q=h", down);
    const { results } = await api.names("h");
    expect(results).toEqual(
      rankNames(
        INDEX.nodes.map((n) => ({ path: n.path, title: n.title, aliases: n.aliases ?? [] })),
        "h",
      ),
    );
    expect(results.map((r) => r.alias ?? r.title)).toEqual(["Harbor", "Shade", "The Port"]);
  });

  it("finds an image an embed names", async () => {
    answers.set(`/api/images/find?name=lamp.png&from=${encodeURIComponent(MIRA)}`, down);
    expect(await api.findImage("lamp.png", MIRA)).toEqual({
      path: "99 Appendices/Images/lamp.png",
    });
  });

  it("shows an entry's unsent text with its links resolved over the index", async () => {
    const url = `/api/entries?path=${encodeURIComponent(MIRA)}`;
    online = true;
    answers.set(url, () =>
      json({ path: MIRA, text: "Old.", blob: "c", draft: null, links: [], state: "published" }),
    );
    records = [record(`entry:${MIRA}`, "edit", "New. See [[Old Quay]] and [[Nowhere]].")];
    const shown = await api.entry(MIRA);
    expect(shown.text).toBe("New. See [[Old Quay]] and [[Nowhere]].");
    expect(shown.links.map((l) => [l.raw, l.kind, l.target])).toEqual([
      ["[[Old Quay]]", "resolved", QUAY],
      ["[[Nowhere]]", "unresolved", undefined],
    ]);
    expect(notSentYet(shown)).toBe(true);
    // What is kept is the server's answer, not the unsent text.
    await device.settled();
    expect(((await store.answer(url))?.body as { text: string }).text).toBe("Old.");
  });

  it("opens an entry made on this device from its record", async () => {
    records = [record("entry:02 People/Gull.md", "create", "# Gull\n\nSister of [[Mira]].")];
    answers.set(`/api/entries?path=${encodeURIComponent("02 People/Gull.md")}`, down);
    const shown = await api.entry("02 People/Gull.md");
    expect(shown).toMatchObject({ path: "02 People/Gull.md", state: "unpublished" });
    expect(shown.links[0]).toMatchObject({ kind: "resolved", target: MIRA });
    expect(notSentYet(shown)).toBe(true);
  });
});

describe("unsent changes laid over the index and the tree", () => {
  const paths = (g: GraphResponse) => g.nodes.map((n) => n.path);
  const edges = (g: GraphResponse) =>
    g.edges.map(([a, b]) => `${g.nodes[a]!.path} → ${g.nodes[b]!.path}`).sort();

  it("adds a create, removes a delete, and replaces only an edited note's own edges", () => {
    const g = overlayGraph(INDEX, [
      record("entry:02 People/Gull.md", "create", "Sister of [[Mira]]."),
      record(`entry:${SHADE}`, "delete", ""),
      record(`entry:${QUAY}`, "edit", "Now only [[Mira]]."),
    ]);
    expect(paths(g)).toEqual([QUAY, HARBOR, "02 People/Gull.md", MIRA].sort());
    expect(g.nodes.find((n) => n.path === "02 People/Gull.md")).toMatchObject({
      title: "Gull",
      unpublished: true,
    });
    expect(edges(g)).toEqual(
      [
        `02 People/Gull.md → ${MIRA}`,
        `${MIRA} → ${HARBOR}`,
        `${MIRA} → ${QUAY}`,
        `${QUAY} → ${MIRA}`,
      ].sort(),
    );
    // Nothing to lay over: the index as it is.
    expect(overlayGraph(INDEX, [])).toBe(INDEX);
  });

  it("puts a create in its folder in the tree, and takes a delete out", () => {
    const t = overlayTree(TREE, [
      record("entry:02 People/Gull.md", "create", ""),
      record(`entry:${MIRA}`, "delete", ""),
      record("entry:05 New/Deep/Note.md", "create", ""),
    ]);
    expect(t.folders[0]!.notes).toEqual([
      { path: "02 People/Gull.md", title: "Gull", state: "unpublished" },
    ]);
    const added = t.folders.find((f) => f.path === "05 New")!;
    expect(added.folders[0]).toMatchObject({
      path: "05 New/Deep",
      notes: [{ path: "05 New/Deep/Note.md", title: "Note", state: "unpublished" }],
    });
    // The stored tree itself is not changed.
    expect(TREE.folders[0]!.notes).toHaveLength(1);
  });

  it("is laid over the tree the device answers with", async () => {
    answers.set("/api/tree", () => json(TREE));
    await api.tree();
    await device.settled();
    online = false;
    answers.set("/api/tree", down);
    records = [record("entry:02 People/Gull.md", "create", "")];
    const t = await api.tree();
    expect(t.folders[0]!.notes.map((n) => n.title)).toEqual(["Mira", "Gull"]);
    expect(servedFromDevice(t)).toBe(clock);
  });
});

describe("one device copy for each project", () => {
  it("reads a project's address as the copy's own, and nothing else", () => {
    expect(splitProjectUrl("/api/p/avalymia/entries?path=A.md")).toEqual({
      slug: "avalymia",
      bare: "/api/entries?path=A.md",
    });
    expect(splitProjectUrl("/api/p/a%20b/tree")).toEqual({ slug: "a b", bare: "/api/tree" });
    expect(splitProjectUrl("/api/projects")).toBeNull();
    expect(splitProjectUrl("/api/entries?path=A.md")).toBeNull();
  });

  it("empties only its own project's images from the cache they all share", async () => {
    const mine = new Request("https://x.example/api/p/avalymia/images?path=a.png");
    const other = new Request("https://x.example/api/p/other/images?path=a.png");
    const kept = new Map([mine, other].map((r) => [r.url, r]));
    const cache = {
      keys: async () => [...kept.values()],
      delete: async (r: Request) => kept.delete(r.url),
    };
    const copy = new DeviceCopy({
      store: async () => store,
      records: () => [],
      online: () => true,
      unreachable: () => undefined,
      caches: { open: async () => cache as unknown as Cache },
      imagePrefix: "/api/p/avalymia/images",
    });
    await copy.clear();
    expect([...kept.keys()]).toEqual([other.url]);
  });

  it("says when its copy starts and when it is emptied, for the switcher's mark", async () => {
    const told: boolean[] = [];
    const copy = new DeviceCopy({
      store: async () => store,
      records: () => [],
      online: () => true,
      unreachable: () => undefined,
      onDevice: (on) => told.push(on),
    });
    await copy.keep("/api/graph", { kind: "stored", shape: "graph" }, INDEX);
    await copy.keep("/api/tree", { kind: "stored", shape: "tree" }, TREE);
    expect(told).toEqual([true]);
    await copy.clear();
    expect(told).toEqual([true, false]);
  });
});
