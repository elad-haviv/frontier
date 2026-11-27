import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ProjectRole, ROLE_RANK } from "@frontier/schema";
import { ROUTE_ROLES } from "../src/projects/roles.js";
import { addMember, addPerson, type Client, makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
const people = {} as Record<ProjectRole, Client>;

beforeAll(async () => {
  t = await makeTestApp();
  // A route registered behind the facade's back, as a mistake would (before the server starts).
  t.app.get("/api/p/:project/stray", async () => ({ leaked: true }));
  await t.login();
  const first = (await t.server.projects.all())[0]!;
  people.owner = await addPerson(t, "Olive Owner", "owner@example.com");
  people.writer = await addPerson(t, "Wren Writer", "writer@example.com");
  people.reader = await addPerson(t, "Reed Reader", "reader@example.com");
  for (const role of ["owner", "writer", "reader"] as const) {
    await addMember(t, first.id, people[role].id, role);
  }
  await t.app.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(() => t.close());

/** A concrete address for a route pattern: its parameters filled with something of the right shape. */
const concrete = (pattern: string) =>
  pattern
    .replace(":id", "abcdefghij12")
    .replace(":name", "folders")
    .replace(":run", "run")
    .replace(":n", "0")
    .replace(":d", "d")
    .replace(":finding", "f")
    .replace(":op", "op");

/**
 * The answer's status and error code. A route that streams for ever is read only as far as its
 * headers, over a real connection.
 */
async function probe(role: ProjectRole, method: string, url: string) {
  if (url.endsWith("/status/events")) {
    const port = (t.app.server.address() as { port: number }).port;
    const stop = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      headers: { cookie: people[role].cookie },
      signal: stop.signal,
    });
    const code =
      res.status === 200
        ? undefined
        : ((await res.json()) as { error: { code: string } }).error.code;
    stop.abort();
    return { status: res.status, code };
  }
  const res = await t.app.inject({
    method: method as "GET",
    url,
    headers: { cookie: people[role].cookie },
    ...(method === "GET" || method === "DELETE" ? {} : { payload: {} }),
  });
  const json = String(res.headers["content-type"]).startsWith("application/json");
  return {
    status: res.statusCode,
    code: json ? (res.json() as { error?: { code: string } } | null)?.error?.code : undefined,
  };
}

describe("the role table", () => {
  it("has an entry for every registered project route, and no entry for a route that is not there", () => {
    const registered = new Set(t.routes.map((r) => `${r.method} ${r.pattern}`));
    // Project routes plus the project's own three.
    expect([...registered].sort()).toEqual(Object.keys(ROUTE_ROLES).sort());
    expect(t.routes.length).toBeGreaterThan(100);
    for (const r of t.routes) expect(ROUTE_ROLES[`${r.method} ${r.pattern}`]).toBe(r.role);
  });

  it("lets a reader do only what is read, asked or kept for themselves", () => {
    const readerWrites = t.routes
      .filter((r) => r.role === "reader" && r.method !== "GET")
      .map((r) => `${r.method} ${r.pattern}`)
      .sort();
    expect(readerWrites).toEqual(
      [
        "DELETE /lore/:id",
        "DELETE /pins",
        "POST /characters/say",
        "POST /export/docx",
        "POST /export/json",
        "POST /export/markdown",
        "POST /export/pdf",
        "POST /export/preview",
        "POST /export/site",
        "POST /export/slides",
        "POST /keep-going/question",
        "POST /lore",
        "POST /lore/runs/:run/stop",
        "POST /lore/stream",
        "POST /members/leave",
        "POST /pins",
        // Stage 27d: a reader reads, and says which entry they have open for the writers to see.
        "POST /presence/leave",
        "PUT /pins",
        "PUT /presence",
      ].sort(),
    );
    // Only an owner changes the project itself, its members and its invitation links.
    expect(
      t.routes
        .filter((r) => r.role === "owner")
        .map((r) => `${r.method} ${r.pattern}`)
        .sort(),
    ).toEqual([
      "DELETE /invites/:id",
      "DELETE /members/:id",
      "DELETE /project",
      "GET /invites",
      "POST /invites",
      "POST /invites/:id/resend",
      "PUT /members/:id",
      "PUT /project",
    ]);
  });
});

describe("every project route, as owner, writer and reader", () => {
  const routes = () => t.routes;
  it("lets in the roles the table names and refuses the rest with a typed error, on both addresses", async () => {
    let checked = 0;
    for (const route of routes()) {
      // Leaving takes the caller out of the project, which would end this walk; it is tried in
      // members.test.ts, as each role, instead.
      if (route.pattern === "/members/leave") continue;
      const pattern = concrete(route.pattern);
      // The old, unprefixed address of the same route works on the same rule (not the project's
      // own: the record, the members and the invitations have no alias).
      const addresses = /^\/(project|members|invites)/.test(route.pattern)
        ? [`/api/p/avalymia${pattern}`]
        : [`/api/p/avalymia${pattern}`, `/api/${pattern.slice(1)}`];
      for (const url of addresses) {
        for (const role of ["owner", "writer", "reader"] as const) {
          const answer = await probe(role, route.method, url);
          const allowed = ROLE_RANK[role] >= ROLE_RANK[route.role];
          const where = `${role} ${route.method} ${url}`;
          if (allowed) {
            expect(answer.code, where).not.toBe("role_too_low");
            expect(answer.code, where).not.toBe("no_project");
          } else {
            expect(answer.status, where).toBe(403);
            expect(answer.code, where).toBe("role_too_low");
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(600);
  }, 120_000);

  it("refuses a route that has no entry in the table, instead of letting it through", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/api/p/avalymia/stray",
      headers: { cookie: people.owner.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("not_allowed");
    // An address with no route at all is the ordinary not-found answer, for a member.
    const none = await t.app.inject({
      method: "GET",
      url: "/api/p/avalymia/nothing-here",
      headers: { cookie: people.reader.cookie },
    });
    expect(none.statusCode).toBe(404);
  });

  it("stops a route from being registered without an entry, so the server does not start", async () => {
    const { projectApp, RouteBook } = await import("../src/projects/facade.js");
    const fake = projectApp(t.app, new RouteBook());
    expect(() => fake.get("/api/not-in-the-table", async () => ({}))).toThrow(
      /no entry in the role table/,
    );
  });
});
