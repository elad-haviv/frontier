import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ChronicleFile, type MapFile } from "@frontier/schema";
import { ApiFailure } from "../api.ts";
import { openStore } from "./db.ts";
import { backoff, Queue, type QueueEvent, type SenderApi, type Notice } from "./queue.ts";
import type { ConnectionState } from "./connection.ts";

let n = 0;
const queues: Queue[] = [];

/** A connection whose state the test sets. */
function fakeConnection(state: ConnectionState = "online") {
  const listeners = new Set<() => void>();
  return {
    state,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set(next: ConnectionState) {
      this.state = next;
      for (const l of listeners) l();
    },
  };
}

function fakeApi(over: Partial<SenderApi> = {}): SenderApi & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    saveDraft: vi.fn(async (d) => {
      calls.push(["draft", d]);
      return { id: d.id, revision: d.revision + 1 };
    }),
    saveMap: vi.fn(async (id, map, revision, link, sent) => {
      calls.push(["map", id, map, revision, link, sent]);
      return { map, revision: revision + 1, unlinked: [] };
    }),
    saveChronicle: vi.fn(async (id, chronicle, revision, link, sent) => {
      calls.push(["chronicle", id, chronicle, revision, link, sent]);
      return { chronicle, revision: revision + 1, unlinked: [] };
    }),
    map: vi.fn(async () => {
      throw new Error("not given");
    }),
    chronicle: vi.fn(async () => {
      throw new Error("not given");
    }),
    ...over,
  };
}

function makeQueue(
  api: SenderApi,
  connection = fakeConnection(),
  name = `queue-test-${++n}`,
): Queue & { dbName: string } {
  const q = new Queue({ open: () => openStore(name), api, connection }) as Queue & {
    dbName: string;
  };
  q.dbName = name;
  queues.push(q);
  return q;
}

afterEach(() => {
  for (const q of queues.splice(0)) q.stop();
});

const ENTRY = "entry:02 People/Mira.md" as const;

describe("the save queue", () => {
  it("writes every put at once, and keeps it across a reopen", async () => {
    const offline = fakeConnection("offline");
    const first = makeQueue(fakeApi(), offline);
    await first.put(ENTRY, "typed", {
      kind: "edit",
      draftId: "draft0000001",
      revision: 2,
      baseBlob: "b0",
    });
    first.stop();
    const again = makeQueue(fakeApi(), offline, first.dbName);
    expect(await again.get(ENTRY)).toMatchObject({
      key: ENTRY,
      value: "typed",
      draftId: "draft0000001",
      revision: 2,
      baseBlob: "b0",
      state: "waiting",
    });
    // The device's id is made once and kept.
    expect(again.device?.id).toMatch(/^[a-z0-9]{12}$/);
    expect(again.device?.id).toBe(first.device?.id);
  });

  it("keeps one record per file: a later change keeps its base and gets a new op", async () => {
    const q = makeQueue(fakeApi(), fakeConnection("offline"));
    await q.put(ENTRY, "one", {
      kind: "edit",
      draftId: "draft0000001",
      revision: 1,
      baseBlob: "b0",
    });
    const first = (await q.get(ENTRY))!;
    await q.put(ENTRY, "two", {
      kind: "edit",
      draftId: "otherdraft01",
      revision: 7,
      baseBlob: "b9",
    });
    const second = (await q.get(ENTRY))!;
    expect(await q.list()).toHaveLength(1);
    expect(second).toMatchObject({
      value: "two",
      draftId: "draft0000001",
      revision: 1,
      baseBlob: "b0",
    });
    expect(second.op).not.toBe(first.op);
    expect(second.since).toBe(first.since);
  });

  it("sends, and removes the record once the server has its value", async () => {
    const api = fakeApi();
    const q = makeQueue(api);
    const events: QueueEvent[] = [];
    q.subscribe(ENTRY, (e) => events.push(e));
    await q.put(ENTRY, "text", {
      kind: "edit",
      draftId: "draft0000001",
      revision: 0,
      baseBlob: "b0",
    });
    await q.sendNow(ENTRY);
    expect(await q.get(ENTRY)).toBeUndefined();
    const [, sent] = api.calls[0] as [string, Record<string, unknown>];
    expect(sent).toMatchObject({
      id: "draft0000001",
      path: "02 People/Mira.md",
      kind: "edit",
      text: "text",
      revision: 0,
      baseBlob: "b0",
    });
    expect(sent.op).toMatch(/^[a-z0-9]{12}$/);
    expect(events.find((e) => e.type === "saved")).toMatchObject({
      known: { draftId: "draft0000001", revision: 1 },
    });
  });

  it("sends again with the new revision when the value changed while it was on its way", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    const api = fakeApi();
    const plain = api.saveDraft;
    api.saveDraft = vi.fn(async (d) => {
      if (api.calls.length === 0) await held;
      return plain(d);
    });
    const q = makeQueue(api);
    await q.put(ENTRY, "one", {
      kind: "edit",
      draftId: "draft0000001",
      revision: 0,
      baseBlob: "b0",
    });
    const sending = q.sendNow(ENTRY);
    await vi.waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1));
    await q.put(ENTRY, "two", { kind: "edit", delay: 0 });
    release();
    await sending;
    await vi.waitFor(() => expect(api.calls).toHaveLength(2));
    expect(api.calls[1]![1]).toMatchObject({ text: "two", revision: 1 });
    await vi.waitFor(async () => expect(await q.get(ENTRY)).toBeUndefined());
  });

  it("backs off one record at a time, and does not hold up the others", async () => {
    const api = fakeApi();
    const plain = api.saveDraft;
    api.saveDraft = vi.fn(async (d) => {
      if (d.path === "02 People/Mira.md") {
        throw new ApiFailure(0, "offline", "The server could not be reached.");
      }
      return plain(d);
    });
    const q = makeQueue(api);
    await q.put(ENTRY, "mira", {
      kind: "edit",
      draftId: "draft0000001",
      revision: 0,
      baseBlob: "",
    });
    await q.put("entry:02 People/Shade.md", "shade", {
      kind: "edit",
      draftId: "draft0000002",
      revision: 0,
      baseBlob: "",
    });
    const before = Date.now();
    await Promise.all([q.sendNow(ENTRY), q.sendNow("entry:02 People/Shade.md")]);
    const mira = (await q.get(ENTRY))!;
    expect(mira).toMatchObject({ state: "waiting", tries: 1, error: "Not sent: no connection." });
    expect(mira.nextTry).toBeGreaterThanOrEqual(before + backoff(1));
    expect(await q.get("entry:02 People/Shade.md")).toBeUndefined();
    expect([1, 2, 3, 6, 10].map(backoff)).toEqual([2000, 4000, 8000, 60_000, 60_000]);
  });

  it("pauses while signed out, keeps the record, and sends it after login", async () => {
    const api = fakeApi();
    const plain = api.saveDraft;
    let signedIn = false;
    api.saveDraft = vi.fn(async (d) => {
      if (!signedIn) throw new ApiFailure(401, "unauthenticated", "Log in first.");
      return plain(d);
    });
    const connection = fakeConnection();
    const q = makeQueue(api, connection);
    await q.put(ENTRY, "kept", {
      kind: "edit",
      draftId: "draft0000001",
      revision: 0,
      baseBlob: "",
    });
    await q.sendNow(ENTRY, 500);
    // The connection service hears the 401 and says signed out; sending stops.
    connection.set("signed-out");
    expect(await q.get(ENTRY)).toMatchObject({ value: "kept", state: "waiting", tries: 0 });
    await q.put(ENTRY, "kept, and more", { delay: 0 });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.saveDraft).toHaveBeenCalledTimes(1);

    signedIn = true;
    connection.set("online");
    await vi.waitFor(async () => expect(await q.get(ENTRY)).toBeUndefined());
    expect(api.calls.at(-1)![1]).toMatchObject({ text: "kept, and more" });
  });

  it("removes a stale entry record, since the server kept its text, and says where to compare", async () => {
    const api = fakeApi({
      saveDraft: vi.fn(async () => {
        const failure = new ApiFailure(409, "stale_revision", "Changed from another device.");
        failure.draftId = "serverdraft1";
        throw failure;
      }),
    });
    const q = makeQueue(api);
    const events: QueueEvent[] = [];
    const notices: Notice[] = [];
    q.subscribe(ENTRY, (e) => events.push(e));
    q.onNotice((notice) => notices.push(notice));
    await q.put(ENTRY, "phone", {
      kind: "edit",
      draftId: "draft0000001",
      revision: 1,
      baseBlob: "b0",
    });
    await q.sendNow(ENTRY);
    expect(await q.get(ENTRY)).toBeUndefined();
    expect(events.filter((e) => e.type === "stale")).toEqual([
      { type: "stale", key: ENTRY, draftId: "serverdraft1" },
    ]);
    expect(notices).toEqual([
      {
        key: ENTRY,
        message: "Mira: two texts to compare",
        href: "/versions/serverdraft1",
        watched: true,
      },
    ]);
  });

  it("marks a record the server refuses as needing attention, and sends it again on Retry", async () => {
    let refuse = true;
    const api = fakeApi();
    const plain = api.saveDraft;
    api.saveDraft = vi.fn(async (d) => {
      if (refuse)
        throw new ApiFailure(403, "append_only", "Files under 99 Appendices are append-only.");
      return plain(d);
    });
    const q = makeQueue(api);
    await q.put(ENTRY, "x", { kind: "edit", draftId: "draft0000001", revision: 0, baseBlob: "" });
    await q.sendNow(ENTRY);
    expect(await q.get(ENTRY)).toMatchObject({
      state: "attention",
      error: "Files under 99 Appendices are append-only.",
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    refuse = false;
    await q.retry(ENTRY);
    await vi.waitFor(async () => expect(await q.get(ENTRY)).toBeUndefined());
    // Discard throws a record away without sending it.
    await q.put(ENTRY, "y", { kind: "edit", draftId: "draft0000001", revision: 1, baseBlob: "" });
    await q.drop(ENTRY);
    expect(await q.list()).toEqual([]);
  });
});

const layer = { id: "layer001", name: "Places", visible: true, color: "#000000" };
const marker = (id: string, label: string, at: [number, number] = [1, 1]) => ({
  id,
  kind: "marker" as const,
  layer: "layer001",
  at,
  entry: null as string | null,
  label,
  icon: null,
  child: null,
});
const baseMap: MapFile = {
  version: 1,
  id: "mapid001",
  title: "Ezob",
  space: { kind: "flat", width: 10, height: 10, scale: null, unit: "km" },
  images: [],
  markerSets: [],
  layers: [layer],
  features: [marker("f1", "Harbor"), marker("f2", "Quay")],
};
const MAP = "map:mapid001" as const;

describe("maps and chronicles in the queue", () => {
  it("merges a stale map with the server's copy from the stored base, with no page open", async () => {
    // Another device moved the quay and added a marker; this one renamed the harbor.
    const theirs: MapFile = {
      ...baseMap,
      features: [marker("f1", "Harbor"), marker("f2", "Quay", [5, 5]), marker("f3", "Tower")],
    };
    let stale = true;
    const api = fakeApi();
    const plain = api.saveMap;
    api.saveMap = vi.fn(async (...args: Parameters<SenderApi["saveMap"]>) => {
      if (stale) {
        stale = false;
        throw new ApiFailure(409, "stale_revision", "Changed from another device.");
      }
      return plain(...args);
    });
    api.map = vi.fn(async () => ({ map: theirs, revision: 4, blob: "theirblob" }));
    const q = makeQueue(api);
    const notices: Notice[] = [];
    q.onNotice((notice) => notices.push(notice));
    const mine: MapFile = {
      ...baseMap,
      features: [marker("f1", "Old Harbor"), marker("f2", "Quay")],
    };
    await q.put(MAP, mine, { base: baseMap, revision: 2, baseBlob: "b0" });
    await q.sendNow(MAP);
    await vi.waitFor(async () => expect(await q.get(MAP)).toBeUndefined());
    const [, , sent, revision, , meta] = api.calls.at(-1) as [
      string,
      string,
      MapFile,
      number,
      unknown,
      { baseBlob: string },
    ];
    expect(sent.features.map((f) => [f.id, f.label, (f as { at: unknown }).at])).toEqual([
      ["f1", "Old Harbor", [1, 1]],
      ["f2", "Quay", [5, 5]],
      ["f3", "Tower", [1, 1]],
    ]);
    expect(revision).toBe(4);
    expect(meta.baseBlob).toBe("theirblob");
    expect(notices[0]).toMatchObject({
      key: MAP,
      message: "Ezob: changes from another device were merged in.",
      watched: false,
    });
  });

  it("names what both changed, and keeps this device's side", async () => {
    const theirs: MapFile = {
      ...baseMap,
      features: [marker("f1", "Their Harbor"), marker("f2", "Quay")],
    };
    let stale = true;
    const api = fakeApi();
    const plain = api.saveMap;
    api.saveMap = vi.fn(async (...args: Parameters<SenderApi["saveMap"]>) => {
      if (stale) {
        stale = false;
        throw new ApiFailure(409, "stale_revision", "Changed.");
      }
      return plain(...args);
    });
    api.map = vi.fn(async () => ({ map: theirs, revision: 3, blob: "b1" }));
    const q = makeQueue(api);
    const events: QueueEvent[] = [];
    q.subscribe(MAP, (e) => events.push(e));
    await q.put(
      MAP,
      { ...baseMap, features: [marker("f1", "My Harbor"), marker("f2", "Quay")] },
      {
        base: baseMap,
        revision: 1,
        baseBlob: "b0",
      },
    );
    const notices: Notice[] = [];
    q.onNotice((notice) => notices.push(notice));
    await q.sendNow(MAP);
    const merged = events.find((e) => e.type === "merged");
    expect(merged).toMatchObject({ clashes: ["f1"], known: { revision: 3, baseBlob: "b1" } });
    expect(notices[0]!.message).toBe(
      "Ezob: changes from another device were merged in. Changed in both places, yours kept: My Harbor.",
    );
  });

  it("combines the links of two changes by feature, and takes an unlinked one back", async () => {
    const api = fakeApi();
    const q = makeQueue(api, fakeConnection("offline"));
    await q.put(MAP, baseMap, {
      base: baseMap,
      revision: 1,
      baseBlob: "",
      link: [{ id: "f1", path: "a.md" }],
    });
    await q.put(MAP, baseMap, { link: [{ id: "f2", path: "b.md" }] });
    await q.put(MAP, baseMap, { link: [{ id: "f1", path: "c.md" }] });
    expect((await q.get(MAP))!.link).toEqual([
      { id: "f1", path: "c.md" },
      { id: "f2", path: "b.md" },
    ]);
    await q.put(MAP, baseMap, { link: [{ id: "f2", path: null }] });
    expect((await q.get(MAP))!.link).toEqual([
      { id: "f1", path: "c.md" },
      { id: "f2", path: null },
    ]);
  });

  it("sends only real links, and lays the server's entry over what changed meanwhile", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    const api = fakeApi();
    api.saveChronicle = vi.fn(async (...args: Parameters<SenderApi["saveChronicle"]>) => {
      const [id, chronicle, revision, link = [], sent] = args;
      api.calls.push(["chronicle", id, chronicle, revision, link, sent]);
      if (api.calls.length === 1) await held;
      // The server writes the entry's id into each linked span.
      return {
        chronicle: {
          ...chronicle,
          spans: chronicle.spans.map((s) =>
            link.some((l) => l.span === s.id) ? { ...s, entry: "entryid1" } : s,
          ),
        },
        revision: revision + 1,
        unlinked: [],
      };
    });
    const q = makeQueue(api);
    const span = {
      id: "s1",
      lane: "l1",
      name: "Years",
      point: false,
      start: null,
      end: null,
      length: null,
      entry: null,
      note: "",
    };
    const chronicle = { id: "chron001", title: "Ezob", spans: [span] } as unknown as ChronicleFile;
    const KEY = "chronicle:chron001" as const;
    await q.put(KEY, chronicle, {
      base: chronicle,
      revision: 1,
      baseBlob: "",
      link: [
        { id: "s1", path: "02 People/Shade.md" },
        { id: "s2", path: null },
      ],
    });
    const sending = q.sendNow(KEY);
    await vi.waitFor(() => expect(api.calls).toHaveLength(1));
    expect(api.calls[0]![4]).toEqual([{ span: "s1", path: "02 People/Shade.md" }]);
    // A note is typed into the span while its link is on its way.
    await q.put(
      KEY,
      { ...chronicle, spans: [{ ...span, note: "Written during the save" }] },
      { delay: 0 },
    );
    release();
    await sending;
    await vi.waitFor(() => expect(api.calls).toHaveLength(2));
    const second = api.calls[1]![2] as ChronicleFile;
    expect(second.spans[0]).toMatchObject({ note: "Written during the save", entry: "entryid1" });
    expect(api.calls[1]![4]).toEqual([]);
    expect(api.calls[1]![3]).toBe(2);
  });
});
