import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openStore } from "./db.ts";
import { ApiFailure } from "../api.ts";
import { type KnownProject, Queue, QueueHub, type SenderApi } from "./queue.ts";
import type { ConnectionState } from "./connection.ts";

const A: KnownProject = { id: "projecta01", slug: "alpha", legacy: true, name: "Alpha" };
const B: KnownProject = { id: "projectb01", slug: "beta", legacy: false, name: "Beta" };

let n = 0;
const hubs: QueueHub[] = [];

/** A hub over databases of its own, whose queues send nowhere but into `sent`. */
function makeHub(projects: () => KnownProject[]) {
  const prefix = `scope-${++n}-`;
  const sent: string[] = [];
  const state = { current: "offline" as ConnectionState };
  /** Projects the server now says are gone. */
  const gone = new Set<string>();
  /** Projects where the person's role no longer allows a change (stage 27c). */
  const denied = new Set<string>();
  const told: string[] = [];
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
          if (gone.has(ref.id)) {
            throw new ApiFailure(403, "no_project", "There is no project here that you can open.");
          }
          if (denied.has(ref.id)) {
            throw new ApiFailure(403, "role_too_low", "Your role does not allow this.");
          }
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
        onGone: () => told.push(ref.id),
      });
    },
    known: projects,
    listed: () => true,
  });
  hubs.push(hub);
  /** The device's own database, read directly: what an earlier build left there. */
  const raw = (name = "frontier") => openStore(`${prefix}${name}`);
  return { hub, sent, go, raw, gone, denied, told };
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

describe("the count of unsent changes in other projects", () => {
  it("tells the list's listeners when another project's queue changes", async () => {
    const { hub } = makeHub(() => [A, B]);
    hub.setPerson("first");
    hub.use(A);
    await hub.start();
    await put(hub, "entry:Harbor.md", "unsent in alpha");
    hub.use(B);
    expect(hub.waitingElsewhere()).toEqual([{ id: A.id, count: 1 }]);
    // Alpha's change goes while beta is open: the switcher is told, and the count goes.
    let heard = 0;
    const stop = hub.subscribeList(() => heard++);
    await hub.queueOf(A).drop("entry:Harbor.md");
    expect(heard).toBeGreaterThan(0);
    expect(hub.waitingElsewhere()).toEqual([]);
    stop();
  });
});

describe("changes in a project that turns out to be gone", () => {
  it("are listed with the project's name, counted, and thrown away one by one", async () => {
    let projects = [A, B];
    const { hub, go, gone, told, raw } = makeHub(() => projects);
    hub.setPerson("first");
    hub.use(B);
    await hub.start();
    await put(hub, "entry:Salt.md", "kept only here");
    await put(hub, "entry:Pepper.md", "also only here");
    hub.use(A);
    expect(await hub.stranded()).toEqual([]);

    // The server now says beta is not there for this person: the queued save is refused.
    gone.add(B.id);
    go("online");
    await vi.waitFor(() => expect(told).toEqual([B.id]));
    // The person's list no longer has it.
    projects = [A];
    const stranded = await hub.stranded();
    expect(stranded.map((p) => [p.id, p.name, p.records.map((r) => r.key).sort()])).toEqual([
      [B.id, "Beta", ["entry:Pepper.md", "entry:Salt.md"]],
    ]);
    // They are counted for the logout warning, not left unseen.
    expect(await hub.unsentOnDevice()).toBe(2);

    await hub.discardStranded(B.id, "entry:Salt.md");
    expect((await hub.stranded())[0]!.records.map((r) => r.key)).toEqual(["entry:Pepper.md"]);
    await hub.discardStranded(B.id);
    expect(await hub.stranded()).toEqual([]);
    expect(await hub.unsentOnDevice()).toBe(0);
    void raw;
  });

  it("does not call a project gone because the list was not read", async () => {
    const { hub } = makeHub(() => []);
    hub.setPerson("first");
    // No project is known and nothing says which is legacy: nothing is stranded.
    expect(await hub.stranded()).toEqual([]);
  });
});

describe("changes refused for want of a role (stage 27c)", () => {
  it("are listed with the project, which stays open to read, and thrown away one by one", async () => {
    const { hub, go, denied, sent } = makeHub(() => [A, B]);
    hub.setPerson("first");
    hub.use(B);
    await hub.start();
    // Changes the person made as a writer in beta, who is then made a reader there.
    await put(hub, "entry:Salt.md", "typed as a writer");
    await put(hub, "entry:Pepper.md", "also");
    denied.add(B.id);
    go("online");
    await vi.waitFor(async () =>
      expect((await hub.queueOf(B).list()).map((r) => r.state)).toEqual(["attention", "attention"]),
    );
    hub.use(A);
    const stranded = await hub.stranded();
    // The project is not called gone: it is listed as one the person can still read.
    expect(
      stranded.map((p) => [p.id, p.name, p.refused, p.records.map((r) => r.key).sort()]),
    ).toEqual([[B.id, "Beta", true, ["entry:Pepper.md", "entry:Salt.md"]]]);
    expect(stranded[0]!.records.every((r) => r.refused === "role_too_low")).toBe(true);
    // Nothing was sent, and no retry sends it.
    expect(sent).toEqual([]);
    await hub.discardStranded(B.id, "entry:Salt.md");
    expect((await hub.stranded())[0]!.records.map((r) => r.key)).toEqual(["entry:Pepper.md"]);
    await hub.discardStranded(B.id);
    expect(await hub.stranded()).toEqual([]);
  });

  it("include the legacy project's, which lives in the device's own database", async () => {
    const { hub, go, denied } = makeHub(() => [A, B]);
    hub.setPerson("first");
    hub.use(A);
    await hub.start();
    await put(hub, "entry:Harbor.md", "typed");
    denied.add(A.id);
    go("online");
    await vi.waitFor(async () =>
      expect((await hub.queueOf(A).list()).map((r) => r.state)).toEqual(["attention"]),
    );
    hub.use(B);
    const stranded = await hub.stranded();
    expect(stranded.map((p) => [p.id, p.name, p.refused])).toEqual([[A.id, "Alpha", true]]);
    await hub.discardStranded(A.id, "entry:Harbor.md");
    expect(await hub.stranded()).toEqual([]);
  });

  it("do not list a project whose changes were refused for another reason", async () => {
    const { hub } = makeHub(() => [A, B]);
    hub.setPerson("first");
    hub.use(B);
    await hub.start();
    await put(hub, "entry:Salt.md", "waiting, as any change waits");
    hub.use(A);
    expect(await hub.stranded()).toEqual([]);
  });
});

describe("deleting a project", () => {
  it("counts its unsent changes, then removes its queue and its database", async () => {
    const { hub, raw } = makeHub(() => [A, B]);
    hub.setPerson("first");
    hub.use(B);
    await hub.start();
    await put(hub, "entry:Salt.md", "unsent in beta");
    expect(await hub.unsentIn(B.id)).toBe(1);
    expect(await hub.unsentIn(A.id)).toBe(0);

    await hub.dropProject(B);
    expect(await hub.unsentIn(B.id)).toBe(0);
    expect(hub.total()).toBe(0);
    // Its database is gone: opened again, it is empty and has nothing of the old record.
    expect(await (await raw(`frontier-u-first-p-${B.id}`)).all()).toEqual([]);
    expect(await hub.unsentOnDevice()).toBe(0);
  });
});
