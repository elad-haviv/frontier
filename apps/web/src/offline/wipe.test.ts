// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { openStore } from "../sync/db.ts";
import { Queue } from "../sync/queue.ts";
import { SIGNED_IN } from "./start.ts";
import { wipeDevice } from "./wipe.ts";

/** Cache Storage holding caches of these names. */
function fakeCaches(names: string[]) {
  const kept = new Set(names);
  return {
    kept,
    keys: async () => [...kept],
    delete: async (name: string) => kept.delete(name),
  };
}

function queue() {
  return new Queue({
    open: () => openStore(`wipe-test-${Math.random()}`),
    api: {} as never,
    connection: { state: "offline", subscribe: () => () => undefined },
  });
}

describe("wiping the device at logout", () => {
  it("removes the app's caches, the sign-in note and the worker, and keeps display settings", async () => {
    const q = queue();
    await q.setMeta(SIGNED_IN, { until: Date.now() + 1000 });
    await q.setMeta("snapshot", { unpublished: 3 });
    await q.setMeta("device", { id: "abcdefghijkl", name: "Chrome on Mac" });
    localStorage.setItem("frontier:shell:entry", JSON.stringify({ width: 320 }));
    const caches = fakeCaches([
      "workbox-precache-v2-https://frontier.example.com/",
      "frontier-images",
      "another-app",
    ]);
    const unregister = vi.fn(async () => true);
    const container = { getRegistrations: async () => [{ unregister }, { unregister }] };

    await wipeDevice({
      store: q,
      caches,
      container: container as unknown as ServiceWorkerContainer,
    });

    expect([...caches.kept]).toEqual(["another-app"]);
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(await q.meta(SIGNED_IN)).toBeUndefined();
    expect(await q.meta("snapshot")).toBeUndefined();
    // The device id is the queue's to clear, which logout does just before.
    expect(await q.meta("device")).toEqual({ id: "abcdefghijkl", name: "Chrome on Mac" });
    expect(localStorage.getItem("frontier:shell:entry")).toBe(JSON.stringify({ width: 320 }));
    q.stop();
  });

  it("empties the device copy, and leaves the queue's records to the queue", async () => {
    const q = queue();
    const store = await q.database();
    await store.putAnswer({ url: "/api/graph", at: 1, shape: 1, body: {}, bytes: 2 });
    await store.putItem({ key: "entry:a.md", opened: 1, images: [] });
    await q.put("entry:a.md", "Unsent", { kind: "edit", draftId: "", revision: 0, delay: 60_000 });
    await wipeDevice({ store: q });
    expect(await store.answers()).toEqual([]);
    expect(await store.items()).toEqual([]);
    expect((await q.get("entry:a.md"))?.value).toBe("Unsent");
    q.stop();
  });

  it("goes on when the browser has no caches or no service workers", async () => {
    const q = queue();
    await q.setMeta(SIGNED_IN, { until: 1 });
    await expect(wipeDevice({ store: q })).resolves.toBeUndefined();
    const broken = {
      keys: async () => {
        throw new DOMException("denied", "SecurityError");
      },
      delete: async () => false,
    };
    await expect(wipeDevice({ store: q, caches: broken })).resolves.toBeUndefined();
    expect(await q.meta(SIGNED_IN)).toBeUndefined();
    q.stop();
  });
});
