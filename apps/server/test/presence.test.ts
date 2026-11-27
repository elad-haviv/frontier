/**
 * Stage 27d: who is reading which entry. In memory only, per project, told to writers and owners
 * through the status stream, cleared on leave, on timeout and when the person's stream ends.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusSnapshot } from "@frontier/schema";
import { Presence } from "../src/projects/presence.js";
import { addMember, addPerson, type Client, makeTestApp, type TestApp } from "./helpers/app.js";

describe("Presence", () => {
  let clock: number;
  let told: number;
  let roles: Record<string, "owner" | "writer" | "reader" | null>;
  let p: Presence;
  beforeEach(() => {
    clock = Date.parse("2026-12-01T10:00:00Z");
    told = 0;
    roles = { ann: "writer", bob: "writer", cat: "reader", gone: null };
    p = new Presence({
      roleOf: (id) => roles[id] ?? null,
      nameOf: (id) => id.toUpperCase(),
      onChange: () => told++,
      now: () => clock,
      ttlMs: 60_000,
    });
  });
  afterEach(() => p.close());

  it("lists others reading, with the time they began, never the person asking", () => {
    p.announce("ann", "t1", "A.md");
    clock += 5000;
    p.announce("bob", "t1", "A.md");
    expect(p.readingFor("ann")).toEqual([
      { id: "bob", name: "BOB", path: "A.md", since: new Date(clock).toISOString() },
    ]);
    expect(p.readingFor("bob").map((r) => r.id)).toEqual(["ann"]);
    expect(p.readingFor("cat").map((r) => r.id)).toEqual(["ann", "bob"]);
  });

  it("tells listeners only when who-reads-what changes, not for a repeat", () => {
    p.announce("ann", "t1", "A.md");
    expect(told).toBe(1);
    clock += 25_000;
    p.announce("ann", "t1", "A.md");
    expect(told).toBe(1);
    p.announce("ann", "t1", "B.md");
    expect(told).toBe(2);
    p.announce("ann", "t1", null);
    expect(told).toBe(3);
    p.announce("ann", "t1", null);
    expect(told).toBe(3);
  });

  it("keeps the earliest time a person began reading an entry across their tabs, and each entry apart", () => {
    p.announce("ann", "t1", "A.md");
    clock += 1000;
    p.announce("ann", "t2", "A.md");
    p.announce("ann", "t3", "B.md");
    const rows = p.readingFor("bob");
    expect(rows.map((r) => [r.path, r.since])).toEqual([
      ["A.md", "2026-12-01T10:00:00.000Z"],
      ["B.md", "2026-12-01T10:00:01.000Z"],
    ]);
    // Closing one tab leaves the other.
    p.leave("ann", "t1");
    expect(p.readingFor("bob").map((r) => r.path)).toEqual(["A.md", "B.md"]);
    p.leave("ann", "t2");
    expect(p.readingFor("bob").map((r) => r.path)).toEqual(["B.md"]);
  });

  it("lets an announcement lapse when it is not repeated, and tells the listeners", () => {
    vi.useFakeTimers();
    try {
      const fast = new Presence({
        roleOf: () => "writer",
        nameOf: (i) => i,
        onChange: () => told++,
        ttlMs: 60_000,
      });
      fast.announce("ann", undefined, "A.md");
      expect(fast.size()).toBe(1);
      vi.advanceTimersByTime(59_000);
      expect(fast.readingFor("bob")).toHaveLength(1);
      const before = told;
      vi.advanceTimersByTime(2_000);
      expect(fast.size()).toBe(0);
      expect(told).toBe(before + 1);
      fast.close();
    } finally {
      vi.useRealTimers();
    }
    // Without the timer too: asking after the time shows nothing.
    p.announce("ann", "t1", "A.md");
    clock += 61_000;
    expect(p.readingFor("bob")).toEqual([]);
  });

  it("forgets a person whose last stream ended, but not while another is open", () => {
    p.streamOpened("ann");
    p.streamOpened("ann");
    p.announce("ann", "t1", "A.md");
    p.streamClosed("ann");
    expect(p.readingFor("bob")).toHaveLength(1);
    p.streamClosed("ann");
    expect(p.readingFor("bob")).toEqual([]);
    // A stream that was never counted closing is harmless.
    p.streamClosed("bob");
  });

  it("does not list someone who is not in the project, and forgets a person on demand", () => {
    p.announce("gone", "t1", "A.md");
    p.announce("ann", "t1", "A.md");
    expect(p.readingFor("bob").map((r) => r.id)).toEqual(["ann"]);
    p.forget("ann");
    expect(p.size()).toBe(1);
  });

  it("holds a few devices for each person and no more", () => {
    for (let i = 0; i < 12; i++) {
      clock += 1;
      p.announce("ann", `t${i}`, `E${i}.md`);
    }
    expect(p.size()).toBe(8);
    expect(p.readingFor("bob").map((r) => r.path)).toEqual([
      "E4.md",
      "E5.md",
      "E6.md",
      "E7.md",
      "E8.md",
      "E9.md",
      "E10.md",
      "E11.md",
    ]);
  });
});

describe("who is reading, through the server", () => {
  let t: TestApp;
  let base: string;
  let projectId: string;
  let wren: Client;
  let rex: Client;
  let reed: Client;
  const MIRA = "02 People/Mira.md";
  beforeEach(async () => {
    t = await makeTestApp({ LOGIN_ATTEMPTS: "1000" });
    await t.login();
    const first = (await t.server.projects.all())[0]!;
    projectId = first.id;
    base = `/api/p/${first.slug}`;
    wren = await addPerson(t, "Wren Writer", "wren@example.com");
    rex = await addPerson(t, "Rex Writer", "rex@example.com");
    reed = await addPerson(t, "Reed Reader", "reed@example.com");
    await addMember(t, projectId, wren.id, "writer");
    await addMember(t, projectId, rex.id, "writer");
    await addMember(t, projectId, reed.id, "reader");
  });
  afterEach(() => t.close());

  const announce = (c: Client | TestApp, path: string | null, client = "tab1") =>
    c.put(`${base}/presence`, { path, client });
  const status = async (c: { get: Client["get"] }) =>
    (await c.get(`${base}/status`)).json() as StatusSnapshot;

  async function stream(who: Client | TestApp) {
    const address = await t.app
      .listen({ port: 0, host: "127.0.0.1" })
      .catch(() => `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`);
    const res = await fetch(`${address}${base}/status/events`, { headers: { cookie: who.cookie } });
    const reader = res.body!.getReader();
    let buffer = "";
    const seen: StatusSnapshot[] = [];
    return {
      async until(ok: (s: StatusSnapshot) => boolean, ms = 5000) {
        const stop = Date.now() + ms;
        for (;;) {
          const found = seen.find(ok);
          if (found) return found;
          if (Date.now() > stop)
            throw new Error(`no matching event; last: ${JSON.stringify(seen.at(-1))}`);
          const got = await Promise.race([
            reader.read(),
            new Promise<null>((r) => setTimeout(() => r(null), 100)),
          ]);
          if (got === null || got.done) continue;
          buffer += new TextDecoder().decode(got.value);
          for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
            const line = buffer
              .slice(0, end)
              .split("\n")
              .find((l) => l.startsWith("data: "));
            buffer = buffer.slice(end + 2);
            if (line) seen.push(JSON.parse(line.slice(6)) as StatusSnapshot);
          }
        }
      },
      close: () => reader.cancel().catch(() => undefined),
    };
  }

  it("tells writers and owners who else is reading what, and nobody about themselves", async () => {
    expect((await announce(wren, MIRA)).json()).toEqual({ ok: true });
    for (const who of [rex, t]) {
      const s = await status(who);
      expect(s.presence).toEqual([
        { id: wren.id, name: "Wren Writer", path: MIRA, since: expect.any(String) },
      ]);
    }
    expect((await status(wren)).presence).toEqual([]);
    // A reader reading is told to writers; a reader is told nothing.
    await announce(reed, MIRA);
    expect((await status(rex)).presence!.map((r) => r.name).sort()).toEqual([
      "Reed Reader",
      "Wren Writer",
    ]);
    expect((await status(reed)).presence).toEqual([]);
    // Leaving.
    await announce(wren, null);
    expect((await status(rex)).presence!.map((r) => r.name)).toEqual(["Reed Reader"]);
    expect((await wren.post(`${base}/presence/leave`, { client: "tab1" })).json()).toEqual({
      ok: true,
    });
    await t.post(`${base}/presence/leave`);
  });

  it("puts it on the stream as it changes, and clears it when the person's stream ends", async () => {
    const rexStream = await stream(rex);
    await rexStream.until(() => true);
    const wrenStream = await stream(wren);
    await wrenStream.until(() => true);
    await announce(wren, MIRA);
    await rexStream.until((s) => (s.presence ?? []).some((r) => r.path === MIRA));
    await announce(wren, "02 People/Shade.md");
    await rexStream.until(
      (s) =>
        (s.presence ?? []).some((r) => r.path === "02 People/Shade.md") &&
        !(s.presence ?? []).some((r) => r.path === MIRA),
    );
    // Their stream ends (the tab closes, the phone sleeps): they are no longer reading.
    await wrenStream.close();
    await rexStream.until((s) => (s.presence ?? []).length === 0 && s !== undefined);
    await rexStream.close();
  });

  it("is a project's own: the same person reading in another project is not told here", async () => {
    const res = await t.post("/api/projects", {
      name: "Northwind",
      slug: "northwind",
      start: "empty",
    });
    expect(res.statusCode, res.body).toBe(201);
    await addMember(t, res.json().id, wren.id, "writer");
    await addMember(t, res.json().id, rex.id, "writer");
    await wren.put("/api/p/northwind/presence", { path: "Welcome.md", client: "tab1" });
    expect((await status(rex)).presence).toEqual([]);
    expect(
      ((await rex.get("/api/p/northwind/status")).json() as StatusSnapshot).presence!.map(
        (r) => r.path,
      ),
    ).toEqual(["Welcome.md"]);
  });

  it("is never written to disk, and never in a log", async () => {
    const secret = "03 Things/Presence Marker Entry.md";
    await announce(wren, secret);
    await announce(wren, secret, "tab2");
    const hit: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = join(dir, name);
        if (statSync(file).isDirectory()) {
          if (name !== "vault" && name !== "library.git") walk(file);
        } else if (
          statSync(file).size < 5_000_000 &&
          readFileSync(file).includes("Presence Marker")
        )
          hit.push(file);
      }
    };
    walk(t.services.config.dataDir);
    expect(hit).toEqual([]);
    expect(existsSync(t.services.config.dataDir)).toBe(true);
  });

  it("is not in the log of requests either", async () => {
    const lines: string[] = [];
    const logged = await makeTestApp(
      { LOGIN_ATTEMPTS: "1000" },
      { logger: true, logStream: { write: (l) => void lines.push(l) } },
    );
    try {
      await logged.login();
      const slug = (await logged.server.projects.all())[0]!.slug;
      const res = await logged.put(`/api/p/${slug}/presence`, {
        path: "03 Things/Logged Marker.md",
        client: "tab1",
      });
      expect(res.statusCode).toBe(200);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("")).not.toContain("Logged Marker");
    } finally {
      await logged.close();
    }
  });

  it("refuses what is not a path, and a person who is not in the project", async () => {
    for (const body of [
      { path: "../etc/passwd" },
      { path: "/abs.md" },
      {},
      { path: "A.md", client: "bad client!" },
    ]) {
      const res = await wren.put(`${base}/presence`, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    const stranger = await addPerson(t, "Stranger", "stranger@example.com");
    const res = await stranger.put(`${base}/presence`, { path: MIRA });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("no_project");
  });

  it("stops telling when a person is removed", async () => {
    await announce(wren, MIRA);
    expect((await status(rex)).presence).toHaveLength(1);
    expect((await t.del(`${base}/members/${wren.id}`)).statusCode).toBe(200);
    expect((await status(rex)).presence).toEqual([]);
  });
});
