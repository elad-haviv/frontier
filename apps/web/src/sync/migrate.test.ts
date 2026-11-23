import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { openStore } from "./db.ts";
import { migrateBuffers } from "./migrate.ts";
import { Queue } from "./queue.ts";

const offline = { state: "offline" as const, subscribe: () => () => undefined };
const queues: Queue[] = [];
afterEach(() => {
  for (const q of queues.splice(0)) q.stop();
  localStorage.clear();
});

function makeQueue(name: string): Queue {
  const q = new Queue({
    open: () => openStore(name),
    api: {} as never,
    connection: offline,
  });
  queues.push(q);
  return q;
}

describe("moving the old browser buffer into the queue", () => {
  it("moves each frontier:draft key into the queue once, and deletes it", async () => {
    localStorage.setItem(
      "frontier:draft:02 People/Mira.md",
      JSON.stringify({ id: "draft0000001", text: "typed before the queue", revision: 3 }),
    );
    localStorage.setItem("frontier:draft:02 People/Shade.md", "{not json");
    localStorage.setItem("frontier.preview", "0");
    const q = makeQueue("migrate-1");
    expect(await migrateBuffers(q)).toBe(1);
    expect(await q.get("entry:02 People/Mira.md")).toMatchObject({
      kind: "edit",
      draftId: "draft0000001",
      revision: 3,
      value: "typed before the queue",
    });
    // Without a base the server treats the save as it treated such saves before.
    expect((await q.get("entry:02 People/Mira.md"))!.baseBlob).toBeUndefined();
    expect(Object.keys(localStorage).filter((k) => k.startsWith("frontier:draft:"))).toEqual([]);
    expect(localStorage.getItem("frontier.preview")).toBe("0");
    // A second start finds nothing more to move.
    expect(await migrateBuffers(q)).toBe(0);
  });

  it("keeps a record the queue already holds, which is newer", async () => {
    const q = makeQueue("migrate-2");
    await q.put("entry:02 People/Mira.md", "newer", { kind: "edit", draftId: "draft0000002" });
    localStorage.setItem(
      "frontier:draft:02 People/Mira.md",
      JSON.stringify({ id: "draft0000001", text: "older", revision: 1 }),
    );
    expect(await migrateBuffers(q)).toBe(0);
    expect((await q.get("entry:02 People/Mira.md"))!.value).toBe("newer");
    expect(localStorage.getItem("frontier:draft:02 People/Mira.md")).toBeNull();
  });

  it("runs at start, before a page can read the queue", async () => {
    localStorage.setItem(
      "frontier:draft:02 People/Shade.md",
      JSON.stringify({ id: "draft0000003", text: "moved at start", revision: 0 }),
    );
    const q = new Queue({
      open: () => openStore("migrate-3"),
      api: {} as never,
      connection: offline,
      migrate: (queue) => migrateBuffers(queue),
    });
    queues.push(q);
    // The first read waits for the move.
    expect((await q.get("entry:02 People/Shade.md"))?.value).toBe("moved at start");
  });
});
