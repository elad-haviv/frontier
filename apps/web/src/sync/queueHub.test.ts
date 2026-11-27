// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setKeysOwner } from "../aiKeys.ts";
import { setCurrentProject } from "../project.ts";
import { loadProjects } from "../projects.ts";
import { queue } from "./queue.ts";

const A = { id: "projecta01", slug: "alpha" };
const B = { id: "projectb01", slug: "beta" };

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

// The person is signed in and their list says alpha is the library from before projects.
beforeAll(async () => {
  setKeysOwner("person1");
  const summary = (p: { id: string; slug: string }, legacy: boolean) => ({
    ...p,
    name: p.slug,
    description: "",
    colour: 0,
    kind: "own",
    role: "owner",
    entries: null,
    maps: null,
    members: [],
    lastVersion: null,
    legacy,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({ projects: [summary(A, true), summary(B, false)], last: null, canCreate: true }),
    ),
  );
  await loadProjects();
  vi.unstubAllGlobals();
});

afterAll(() => {
  setKeysOwner(null);
  queue.stop();
  setCurrentProject(null);
});

describe("a save queue for each project", () => {
  it("keeps what is waiting in one project out of another, and sends it to its own", async () => {
    const asked: { url: string; method: string }[] = [];
    let release: (() => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        asked.push({ url, method: init?.method ?? "GET" });
        // The first save is held on its way, so the person can move to another project meanwhile.
        if (url.endsWith("/drafts") && release === null) {
          await new Promise<void>((resolve) => (release = resolve));
        }
        return json({ id: "d00000000001", revision: 1 });
      }),
    );

    setCurrentProject(A);
    await queue.start();
    await queue.put("entry:Harbor.md", "Written in alpha", { delay: 0, kind: "create" });
    expect(queue.current().map((r) => r.key)).toEqual(["entry:Harbor.md"]);
    await vi.waitFor(() => expect(asked.some((a) => a.method === "PUT")).toBe(true));

    // Now in beta: nothing of alpha shows, and what beta is asked is beta's.
    setCurrentProject(B);
    expect(queue.current()).toEqual([]);
    expect(await queue.get("entry:Harbor.md")).toBeUndefined();
    expect(queue.total()).toBe(1);
    expect(queue.waitingElsewhere()).toEqual([{ id: A.id, count: 1 }]);

    // The held save of alpha goes through, to alpha's address, and alpha's queue lets go.
    release!();
    await vi.waitFor(() => expect(queue.total()).toBe(0));
    const puts = asked.filter((a) => a.method === "PUT").map((a) => a.url);
    expect(puts).toEqual(["/api/p/alpha/drafts"]);
    expect(queue.waitingElsewhere()).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("keeps a change that could not be sent with its project, until it can", async () => {
    let up = false;
    const puts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PUT") puts.push(url);
        if (!up) throw new TypeError("Failed to fetch");
        return json({ id: "d00000000002", revision: 1 });
      }),
    );
    setCurrentProject(A);
    await queue.put("entry:Salt.md", "Offline in alpha", { delay: 0, kind: "create" });
    await vi.waitFor(() => expect(puts.length).toBeGreaterThan(0));
    setCurrentProject(B);
    // Beta sees none of it, and the person is told alpha still holds a change.
    expect(queue.current()).toEqual([]);
    expect(queue.waitingElsewhere()).toEqual([{ id: A.id, count: 1 }]);
    // Back in alpha, it is there to be seen.
    setCurrentProject(A);
    expect(queue.current().map((r) => r.key)).toEqual(["entry:Salt.md"]);
    expect(puts.every((u) => u === "/api/p/alpha/drafts")).toBe(true);
    await queue.drop("entry:Salt.md");
    expect(queue.total()).toBe(0);
    up = true;
    vi.unstubAllGlobals();
  });

  it("refuses a put when no project is open, so no change is filed under none", async () => {
    setCurrentProject(null);
    await expect(queue.put("entry:X.md", "x")).rejects.toMatchObject({ code: "no_project" });
    expect(queue.current()).toEqual([]);
  });
});
