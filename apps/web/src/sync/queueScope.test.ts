import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openStore } from "./db.ts";
import { type KnownProject, Queue, QueueHub, type SenderApi } from "./queue.ts";
import type { ConnectionState } from "./connection.ts";

const A: KnownProject = { id: "projecta01", slug: "alpha", legacy: true };
const B: KnownProject = { id: "projectb01", slug: "beta", legacy: false };

let n = 0;
const hubs: QueueHub[] = [];

/** A hub over databases of its own, whose queues send nowhere but into `sent`. */
function makeHub(projects: () => KnownProject[]) {
  const prefix = `scope-${++n}-`;
  const sent: string[] = [];
  const state = { current: "offline" as ConnectionState };
  const listeners = new Set<() => void>();
  const connection = {
    get state() {
      return state.current;
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const go = (next: ConnectionState) => {
    state.current = next;
    for (const l of [...listeners]) l();
  };
  const hub: QueueHub = new QueueHub({
    main: () => openStore(`${prefix}frontier`),
    openProject: (name) => openStore(`${prefix}${name}`),
    make: (ref, open, person, purge) => {
      const api = {
        saveDraft: vi.fn(async (d: { id: string; revision: number }) => {
          sent.push(`${person}:${ref.id}`);
          return { id: d.id, revision: d.revision + 1 };
        }),
      } as unknown as SenderApi;
      return new Queue({
        open,
        api,
        connection,
        identity: () => hub.mainStore(),
        clearMeta: purge,
      });
    },
    known: projects,
    listed: () => true,
  });
  hubs.push(hub);
  /** The device's own database, read directly: what an earlier build left there. */
  const raw = (name = "frontier") => openStore(`${prefix}${name}`);
  return { hub, sent, go, raw };
}

afterEach(() => {
  for (const h of hubs.splice(0)) h.stop();
});

const put = (hub: QueueHub, key: `entry:${string}`, text: string) =>
  hub.put(key, text, { delay: 0, kind: "create" });

describe("whose the device's old database is", () => {
  it("is taken only by the legacy project, and only by a person who is in it", async () => {
    let projects = [B];
    const { hub, sent, go, raw } = makeHub(() => projects);
    // What a build from before projects left: a change in the device's own database.
    const old = await raw();
    await old.update("entry:Old.md", () => ({
      key: "entry:Old.md",
      value: "kept from before",
      state: "waiting",
      kind: "create",
      draftId: "draft0000001",
      op: "op0000000001",
      revision: 0,
      tries: 0,
      nextTry: 0,
      since: 1,
    }));

    // A person in project B only: B is not the legacy project and takes nothing of it.
    hub.setPerson("newcomer");
    hub.use(B);
    await hub.start();
    expect(hub.current()).toEqual([]);
    await put(hub, "entry:Beta.md", "written in beta");
    expect(hub.current().map((r) => r.key)).toEqual(["entry:Beta.md"]);
    expect((await old.all()).map((r) => r.key)).toEqual(["entry:Old.md"]);
    expect(await hub.meta("legacyOwner")).toBeUndefined();
    expect((await (await raw(`frontier-u-newcomer-p-${B.id}`)).all()).map((r) => r.key)).toEqual([
      "entry:Beta.md",
    ]);

    // The person in project A takes the old data, once they sign in; nobody sends it before.
    expect(sent).toEqual([]);
    projects = [A, B];
    hub.setPerson("owner");
    hub.use(A);
    await hub.start();
    expect(hub.current().map((r) => r.key)).toEqual(["entry:Old.md"]);
    expect(await hub.meta("legacyOwner")).toBe("owner");
    expect(await hub.meta("legacyProject")).toBe(A.id);
    // Project B of the same person has a database of its own, not the device's.
    hub.use(B);
    expect(hub.current()).toEqual([]);
    go("online");
  });

  it("never gives a fallback project the old data when the list has no legacy project", async () => {
    // The legacy project is not in this person's list: the first listed project must not take it.
    const { hub, raw } = makeHub(() => [B]);
    const old = await raw();
    await old.update("entry:Old.md", () => ({
      key: "entry:Old.md",
      value: "A's text",
      state: "waiting",
      kind: "create",
      draftId: "draft0000002",
      op: "op0000000001",
      revision: 0,
      tries: 0,
      nextTry: 0,
      since: 1,
    }));
    hub.setPerson("someone");
    hub.use(B);
    await hub.start();
    expect(await hub.legacyFor()).toBeNull();
    expect(hub.current()).toEqual([]);
    expect(await hub.get("entry:Old.md")).toBeUndefined();
    expect(hub.total()).toBe(0);
  });
});

describe("one browser, two people", () => {
  it("never shows or sends the first person's unsent changes in the second person's session", async () => {
    const { hub, sent, go } = makeHub(() => [A, B]);
    hub.setPerson("first");
    hub.use(A);
    await hub.start();
    await put(hub, "entry:Harbor.md", "first person's unsent text");
    expect(hub.total()).toBe(1);

    // The second person signs in on the same browser, with the connection up.
    hub.setPerson("second");
    hub.use(A);
    go("online");
    await hub.start();
    expect(hub.current()).toEqual([]);
    expect(await hub.get("entry:Harbor.md")).toBeUndefined();
    // The logout warning counts only their own.
    expect(hub.total()).toBe(0);
    expect(hub.waitingElsewhere()).toEqual([]);
    await put(hub, "entry:Salt.md", "second person's text");
    await vi.waitFor(() => expect(sent).toEqual([`second:${A.id}`]));

    // Back to the first person: theirs is still there, and was never sent as someone else's.
    go("offline");
    hub.setPerson("first");
    hub.use(A);
    await hub.start();
    expect(hub.current().map((r) => r.key)).toEqual(["entry:Harbor.md"]);
    expect(sent).toEqual([`second:${A.id}`]);
  });

  it("logs the second person out without touching the first person's old data", async () => {
    const { hub, raw } = makeHub(() => [A, B]);
    hub.setPerson("first");
    hub.use(A);
    await hub.start();
    await put(hub, "entry:Harbor.md", "first person's unsent text");
    hub.setPerson("second");
    hub.use(A);
    await hub.start();
    await put(hub, "entry:Salt.md", "second person's text");
    await hub.clear();
    expect((await (await raw()).all()).map((r) => r.key)).toEqual(["entry:Harbor.md"]);
    expect(await hub.meta("legacyOwner")).toBe("first");
    expect(await (await raw(`frontier-u-second-p-${A.id}`)).all()).toEqual([]);
  });
});
