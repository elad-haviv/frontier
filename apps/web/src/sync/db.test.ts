import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOCKED_MS, database, DB_VERSION, openStore, type QueueRecord } from "./db.ts";

let n = 0;
const fresh = () => `db-test-${++n}-${Math.random()}`;

afterEach(() => database.set({ closed: false, waiting: false }));

const record = (key: QueueRecord["key"], value: unknown): QueueRecord => ({
  key,
  draftId: "",
  revision: 0,
  baseBlob: "",
  value,
  op: "abcdefghijkl",
  state: "waiting",
  tries: 0,
  nextTry: 0,
  since: 1,
});

describe("the database", () => {
  it("opens a version 1 database as version 2 with its records and meta intact", async () => {
    const name = fresh();
    // Today's shape, as builds before 15b wrote it.
    const old = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore("queue");
        db.createObjectStore("meta");
      },
    });
    const entry = record("entry:02 People/Mira.md", "Mira's text");
    const map = record("map:abcd1234", { id: "abcd1234", features: [] });
    const folders = record("folders", { version: 1, folders: [] });
    for (const r of [entry, map, folders]) await old.put("queue", r, r.key);
    await old.put("meta", { id: "abcdefghijkl", name: "Chrome on Mac" }, "device");
    await old.put("meta", { until: 99 }, "signedIn");
    old.close();

    const store = await openStore(name);
    expect(DB_VERSION).toBe(2);
    expect(store.device).toBe(true);
    expect((await store.all()).map((r) => r.key).sort()).toEqual(
      [entry.key, map.key, folders.key].sort(),
    );
    expect(await store.get(entry.key)).toEqual(entry);
    expect(await store.meta("device")).toEqual({ id: "abcdefghijkl", name: "Chrome on Mac" });
    expect(await store.meta("signedIn")).toEqual({ until: 99 });
    // The new stores are there, and empty.
    expect(await store.answers()).toEqual([]);
    expect(await store.items()).toEqual([]);
    await store.clearMeta();
    expect(await store.meta("signedIn")).toBeUndefined();
    expect(await store.get(entry.key)).toEqual(entry);
  });

  it("keeps answers and items, and clears them apart from the queue", async () => {
    const store = await openStore(fresh());
    await store.update("entry:a.md", () => record("entry:a.md", "Unsent"));
    await store.putAnswer({ url: "/api/tree", at: 5, shape: 1, body: { folders: [] }, bytes: 14 });
    await store.putItem({ key: "entry:a.md", opened: 5, images: ["/api/images?path=a.png"] });
    expect((await store.answer("/api/tree"))?.body).toEqual({ folders: [] });
    expect((await store.item("entry:a.md"))?.images).toEqual(["/api/images?path=a.png"]);
    await store.clearDevice();
    expect(await store.answers()).toEqual([]);
    expect(await store.items()).toEqual([]);
    expect((await store.get("entry:a.md"))?.value).toBe("Unsent");
  });

  it("lets a newer build in another tab upgrade, and says this tab must reload", async () => {
    const name = fresh();
    const store = await openStore(name);
    expect(database.closed).toBe(false);
    // Another tab asks for a newer version: this one closes its connection at once.
    const newer = await openDB(name, DB_VERSION + 1);
    expect(database.closed).toBe(true);
    expect(newer.version).toBe(DB_VERSION + 1);
    newer.close();
    await expect(store.all()).rejects.toThrow();
  });

  it("waits for an older tab to close, and says so after a while", async () => {
    const name = fresh();
    // An older build's tab, which has no handler to let go of the database.
    const older = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore("queue");
        db.createObjectStore("meta");
      },
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const opening = openStore(name);
      await vi.waitFor(() => {
        vi.advanceTimersByTime(BLOCKED_MS);
        expect(database.waiting).toBe(true);
      });
      older.close();
      const store = await opening;
      expect(store.device).toBe(true);
      expect(database.waiting).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
