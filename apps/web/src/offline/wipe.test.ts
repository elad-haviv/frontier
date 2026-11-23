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
