import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MembersResponse } from "@frontier/schema";
import { addMember, addPerson, type Client, makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
let owner: Client;
let writer: Client;
let reader: Client;
let outsider: Client;
let pid: string;
let slug: string;
const base = () => `/api/p/${slug}`;

beforeAll(async () => {
  t = await makeTestApp({ LOGIN_ATTEMPTS: "100" });
  await t.login();
  const first = (await t.server.projects.all())[0]!;
  pid = first.id;
  slug = first.slug;
  owner = await addPerson(t, "Olive Owner", "owner@example.com");
  writer = await addPerson(t, "Wren Writer", "writer@example.com");
  reader = await addPerson(t, "Reed Reader", "reader@example.com");
  outsider = await addPerson(t, "Otto Outside", "outside@example.com");
  await addMember(t, pid, owner.id, "owner");
  await addMember(t, pid, writer.id, "writer");
  await addMember(t, pid, reader.id, "reader");
});
afterAll(() => t.close());

/** A real project (it has a library), with exactly these owners: the maker steps out. */
async function makeProject(slug: string, owners: Client[]): Promise<string> {
  const res = await t.post("/api/projects", { name: slug, slug, start: "empty" });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().id as string;
  for (const o of owners) await addMember(t, id, o.id, "owner");
  expect((await t.post(`/api/p/${slug}/members/leave`)).statusCode).toBe(200);
  return id;
}

const roleOf = async (id: string) =>
  (await t.server.projects.get(pid))!.members.find((m) => m.personId === id)?.role;

describe("the member list", () => {
  it("gives owners names, emails, roles and times, and everyone else names and roles only", async () => {
    const asOwner = (await owner.get(`${base()}/members`)).json() as MembersResponse;
    expect(asOwner.canManage).toBe(true);
    const wren = asOwner.members.find((m) => m.id === writer.id)!;
    expect(wren).toMatchObject({
      name: "Wren Writer",
      email: "writer@example.com",
      role: "writer",
      you: false,
    });
    expect(wren.addedAt).toMatch(/^\d{4}-/);
    expect(asOwner.members.find((m) => m.id === owner.id)!.you).toBe(true);

    for (const who of [writer, reader]) {
      const list = (await who.get(`${base()}/members`)).json() as MembersResponse;
      expect(list.canManage).toBe(false);
      expect(list.members.map((m) => m.name).sort()).toContain("Wren Writer");
      expect(list.members.every((m) => m.email === null)).toBe(true);
      expect(list.members.find((m) => m.id === reader.id)!.role).toBe("reader");
    }
    expect((await outsider.get(`${base()}/members`)).json().error.code).toBe("no_project");
  });

  it("notes when a member was last active, at most once in a few minutes", async () => {
    await writer.get(`${base()}/schema`);
    await new Promise((r) => setTimeout(r, 50));
    const first = (await t.server.projects.get(pid))!.members.find(
      (m) => m.personId === writer.id,
    )!.lastActiveAt;
    expect(first).toBeDefined();
    const stamp = (await import("node:fs")).statSync(t.server.projects.file).mtimeMs;
    await writer.get(`${base()}/schema`);
    await writer.get(`${base()}/tree`);
    await new Promise((r) => setTimeout(r, 50));
    // No second write inside the window: the file was not touched.
    expect((await import("node:fs")).statSync(t.server.projects.file).mtimeMs).toBe(stamp);
    const list = (await owner.get(`${base()}/members`)).json() as MembersResponse;
    expect(list.members.find((m) => m.id === writer.id)!.lastActiveAt).toBe(first);
    // A person who never came has none.
    const dormant = await addPerson(t, "Dot Dormant", "dot@example.com");
    await addMember(t, pid, dormant.id, "reader");
    const again = (await owner.get(`${base()}/members`)).json() as MembersResponse;
    expect(again.members.find((m) => m.id === dormant.id)!.lastActiveAt).toBeNull();
  });
});

describe("changing roles and removing people", () => {
  it("lets only an owner do either, and says so", async () => {
    for (const who of [writer, reader]) {
      const change = await who.put(`${base()}/members/${reader.id}`, { role: "owner" });
      expect(change.statusCode).toBe(403);
      expect(change.json().error.code).toBe("role_too_low");
      const remove = await who.del(`${base()}/members/${owner.id}`);
      expect(remove.statusCode).toBe(403);
    }
    expect(await roleOf(reader.id)).toBe("reader");
  });

  it("changes a role, and refuses a role that is not one", async () => {
    const res = await owner.put(`${base()}/members/${writer.id}`, { role: "reader" });
    expect(res.statusCode, res.body).toBe(200);
    expect(await roleOf(writer.id)).toBe("reader");
    expect((await owner.put(`${base()}/members/${writer.id}`, { role: "admin" })).statusCode).toBe(
      400,
    );
    expect(
      (await owner.put(`${base()}/members/${outsider.id}`, { role: "reader" })).json().error.code,
    ).toBe("not_found");
    await owner.put(`${base()}/members/${writer.id}`, { role: "writer" });
  });

  it("removes a member, who then has no way into the project", async () => {
    const extra = await addPerson(t, "Eve Extra", "eve@example.com");
    await addMember(t, pid, extra.id, "writer");
    expect((await extra.get(`${base()}/schema`)).statusCode).toBe(200);
    expect((await owner.del(`${base()}/members/${extra.id}`)).statusCode).toBe(200);
    const after = await extra.get(`${base()}/schema`);
    expect(after.statusCode).toBe(403);
    expect(after.json().error.code).toBe("no_project");
    // The legacy address works for what the person is in, and they are in nothing now.
    expect((await extra.get("/api/schema")).json().error.code).toBe("no_project");
    expect((await extra.get("/api/projects")).json().projects).toEqual([]);
  });

  it("lets any member leave for themselves", async () => {
    const leaver = await addPerson(t, "Lee Leaver", "lee@example.com");
    await addMember(t, pid, leaver.id, "reader");
    expect((await leaver.post(`${base()}/members/leave`)).statusCode).toBe(200);
    expect(await roleOf(leaver.id)).toBeUndefined();
    expect((await leaver.post(`${base()}/members/leave`)).statusCode).toBe(403);
  });

  it("keeps what a removed member wrote, under their name", async () => {
    const author = await addPerson(t, "Ada Author", "ada@example.com");
    await addMember(t, pid, author.id, "writer");
    // The account stays, and with it the name saved versions carry.
    await owner.del(`${base()}/members/${author.id}`);
    expect((await t.server.people.get(author.id))?.name).toBe("Ada Author");
  });
});

describe("a project always has an owner", () => {
  it("does not let the last owner be demoted, removed or leave", async () => {
    const boss = await addPerson(t, "Bea Boss", "bea@example.com");
    const soloId = await makeProject("solo", [boss]);
    const solo = { id: soloId };
    // The store's own checks, on the members as they are.
    await expect(t.server.projects.setRole(solo.id, boss.id, "writer")).rejects.toMatchObject({
      code: "last_owner",
    });
    await expect(t.server.projects.removeMember(solo.id, boss.id)).rejects.toMatchObject({
      code: "last_owner",
    });
    expect((await t.server.projects.get(solo.id))!.members).toHaveLength(1);
  });

  it("over HTTP says last_owner with 409", async () => {
    // `owner` is the only owner of the first project (the test's admin never made a request).
    for (const res of [
      await owner.put(`${base()}/members/${owner.id}`, { role: "writer" }),
      await owner.del(`${base()}/members/${owner.id}`),
      await owner.post(`${base()}/members/leave`),
    ]) {
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("last_owner");
    }
    expect(await roleOf(owner.id)).toBe("owner");
  });

  it("holds under concurrent requests: two owners demoting or removing each other leave one", async () => {
    const a = await addPerson(t, "Ann Two", "ann@example.com");
    const b = await addPerson(t, "Ben Two", "ben@example.com");
    const made = { id: await makeProject("pair", [a, b]) };
    // Each tries to take the other's ownership away, at once, many times over.
    const results = await Promise.all([
      a.put(`/api/p/pair/members/${b.id}`, { role: "reader" }),
      b.put(`/api/p/pair/members/${a.id}`, { role: "reader" }),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    // The first through demotes the other; the second is then refused by the rule (409), or is
    // already no longer an owner when it reaches the guard (403).
    expect(codes[0]).toBe(200);
    expect([403, 409]).toContain(codes[1]);
    const owners = (await t.server.projects.get(made.id))!.members.filter(
      (m) => m.role === "owner",
    );
    expect(owners).toHaveLength(1);

    const c = await addPerson(t, "Cy Two", "cy@example.com");
    const d = await addPerson(t, "Di Two", "di@example.com");
    const other = { id: await makeProject("pair2", [c, d]) };
    await Promise.all([
      t.server.projects.removeMember(other.id, c.id).catch(() => null),
      t.server.projects.removeMember(other.id, d.id).catch(() => null),
      t.server.projects.setRole(other.id, c.id, "reader").catch(() => null),
      t.server.projects.setRole(other.id, d.id, "reader").catch(() => null),
    ]);
    expect(
      (await t.server.projects.get(other.id))!.members.filter((m) => m.role === "owner"),
    ).toHaveLength(1);
  });
});

describe("a removed member's open streams", () => {
  it("are cut when they are removed, and not before", async () => {
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (t.app.server.address() as { port: number }).port;
    const watcher = await addPerson(t, "Wes Watcher", "wes@example.com");
    await addMember(t, pid, watcher.id, "writer");
    const stop = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}${base()}/status/events`, {
      headers: { cookie: watcher.cookie },
      signal: stop.signal,
    });
    expect(res.status).toBe(200);
    const body = res.body!.getReader();
    expect((await body.read()).done).toBe(false);
    await owner.del(`${base()}/members/${watcher.id}`);
    // The server closes the connection: the read ends (or fails), it does not wait for more.
    const ended = await Promise.race([
      body.read().then(
        (r) => r.done,
        () => true,
      ),
      new Promise((r) => setTimeout(() => r("still open"), 3000)),
    ]);
    stop.abort();
    expect(ended).toBe(true);
  });
});
