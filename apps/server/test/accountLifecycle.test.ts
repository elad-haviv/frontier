/** A person in no project (stage 27c): they still have an account, and every path copes. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, addPerson, type Client, makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
let owner: Client;
let slug: string;
let pid: string;

beforeAll(async () => {
  t = await makeTestApp({ LOGIN_ATTEMPTS: "100" });
  await t.login();
  const first = (await t.server.projects.all())[0]!;
  pid = first.id;
  slug = first.slug;
  owner = await addPerson(t, "Olive Owner", "owner@example.com");
  await addMember(t, pid, owner.id, "owner");
});
afterAll(() => t.close());

/** Someone who was in the project, used it last, and is now out of it. */
async function removed(name: string, email: string, how: "removed" | "left") {
  const person = await addPerson(t, name, email);
  await addMember(t, pid, person.id, "writer");
  await person.put("/api/projects/last", { slug });
  expect((await t.server.people.get(person.id))!.lastProject).toBe(pid);
  if (how === "removed") await owner.del(`/api/p/${slug}/members/${person.id}`);
  else await person.post(`/api/p/${slug}/members/leave`);
  return person;
}

describe("a person who is in no project", () => {
  for (const how of ["removed", "left"] as const) {
    it(`(${how}) is still logged in, with an account, and told there is no project`, async () => {
      const p = await removed(`Pat ${how}`, `pat-${how}@example.com`, how);
      const session = (await p.get("/api/session")).json();
      expect(session).toMatchObject({ loggedIn: true, lastProject: null });
      expect(session.person.name).toBe(`Pat ${how}`);
      const me = (await p.get("/api/me")).json();
      expect(me).toMatchObject({ name: `Pat ${how}`, lastProject: null });
      const list = (await p.get("/api/projects")).json();
      expect(list).toEqual({ projects: [], last: null, canCreate: false });
    });

    it(`(${how}) is refused by every project address, with one answer`, async () => {
      const p = await removed(`Quin ${how}`, `quin-${how}@example.com`, how);
      for (const [method, url] of [
        ["GET", `/api/p/${slug}/tree`],
        ["GET", `/api/p/${slug}/members`],
        ["GET", `/api/p/${slug}/status`],
        ["GET", `/api/p/nowhere/tree`],
        // The old unprefixed addresses, which look for the last project and then the first.
        ["GET", "/api/tree"],
        ["GET", "/api/entries?path=x.md"],
        ["PUT", "/api/drafts"],
        ["GET", "/api/status"],
      ] as const) {
        const res = await t.app.inject({
          method,
          url,
          headers: { cookie: p.cookie },
          ...(method === "PUT" ? { payload: {} } : {}),
        });
        expect(res.statusCode, `${method} ${url}`).toBe(403);
        expect(res.json().error.code, `${method} ${url}`).toBe("no_project");
      }
      expect((await p.put("/api/projects/last", { slug })).json().error.code).toBe("no_project");
    });
  }

  it("can still use what is theirs: settings, models, logging out and in", async () => {
    const p = await removed("Rae Settings", "rae@example.com", "left");
    expect((await p.get("/api/settings")).statusCode).toBe(200);
    expect((await p.get("/api/ai/models")).statusCode).toBeLessThan(500);
    expect((await p.put("/api/me", { name: "Rae New", email: "rae@example.com" })).statusCode).toBe(
      200,
    );
    expect((await p.post("/api/logout")).statusCode).toBe(200);
    const again = await t.app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email: "rae@example.com", password: "correct horse battery" },
    });
    expect(again.statusCode).toBe(200);
  });

  it("cannot make a project (only the server's first account can), and can take an invitation", async () => {
    const p = await removed("Sid Stuck", "sid@example.com", "left");
    expect(
      (await p.post("/api/projects", { name: "Mine", slug: "mine", start: "empty" })).json().error
        .code,
    ).toBe("not_allowed");
    const { code } = (await owner.post(`/api/p/${slug}/invites`, { role: "reader" })).json();
    expect((await p.post(`/api/join/${code}/accept`)).statusCode).toBe(200);
    const list = (await p.get("/api/projects")).json();
    expect(list.projects.map((x: { slug: string }) => x.slug)).toEqual([slug]);
    expect(list.projects[0].role).toBe("reader");
    expect((await p.get(`/api/p/${slug}/tree`)).statusCode).toBe(200);
  });

  it("is the same for the server's first account, who can make a project and is not given the old one back", async () => {
    // Make the admin an owner by hand, then let them leave: another owner remains.
    const admin = (await t.server.people.all()).find((p) => p.admin)!;
    await addMember(t, pid, admin.id, "owner");
    expect((await t.post(`/api/p/${slug}/members/leave`)).statusCode).toBe(200);
    const list = (await t.get("/api/projects")).json();
    expect(list.projects).toEqual([]);
    expect(list.canCreate).toBe(true);
    expect((await t.get("/api/tree")).json().error.code).toBe("no_project");
    // The project has an owner, so the admin is not made its owner again.
    expect((await t.server.projects.get(pid))!.members.some((m) => m.personId === admin.id)).toBe(
      false,
    );
    const made = await t.post("/api/projects", { name: "Fresh", slug: "fresh", start: "empty" });
    expect(made.statusCode).toBe(201);
    expect(
      (await t.get("/api/projects")).json().projects.map((x: { slug: string }) => x.slug),
    ).toEqual(["fresh"]);
  });
});
