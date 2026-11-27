/** Invite links and joining (stage 27c): one project, one role, one use, seven days. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CreateInviteResponse, JoinInfo } from "@frontier/schema";
import { registerPasskey } from "./helpers/authenticator.js";
import {
  addMember,
  addPerson,
  cookieOf,
  makeTestApp,
  PASSWORD,
  type Client,
  type TestApp,
} from "./helpers/app.js";

let t: TestApp;
let owner: Client;
let writer: Client;
let slug: string;
let pid: string;
let n = 0;
const base = () => `/api/p/${slug}`;
const fresh = () => `new${++n}.person@example.com`;
const LOG: string[] = [];

beforeAll(async () => {
  t = await makeTestApp(
    { LOGIN_ATTEMPTS: "100" },
    { logger: true, logStream: { write: (l) => LOG.push(l) } },
  );
  await t.login();
  const first = (await t.server.projects.all())[0]!;
  pid = first.id;
  slug = first.slug;
  owner = await addPerson(t, "Olive Owner", "owner@example.com");
  writer = await addPerson(t, "Wren Writer", "writer@example.com");
  await addMember(t, pid, owner.id, "owner");
  await addMember(t, pid, writer.id, "writer");
});
afterAll(() => t.close());
afterEach(() => vi.useRealTimers());

const invite = async (role: "owner" | "writer" | "reader" = "writer", by: Client = owner) => {
  const res = await by.post(`${base()}/invites`, { role });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as CreateInviteResponse;
};
const anon = (method: "GET" | "POST", url: string, payload?: unknown, cookie = "") =>
  t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const join = (code: string, body: Record<string, unknown> = {}) =>
  anon("POST", `/api/join/${code}`, {
    name: "Nina New",
    email: fresh(),
    password: "a long enough password",
    ...body,
  });
const rolesOf = async (personId: string) =>
  (await t.server.projects.get(pid))!.members.find((m) => m.personId === personId)?.role;

describe("making invitation links", () => {
  it("shows the code once, stores only a hash, and lists the waiting links without it", async () => {
    const made = await invite("reader");
    expect(made.code).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    // At least 128 bits: 32 base64url characters carry 192.
    expect(Buffer.from(made.code, "base64url").length).toBeGreaterThanOrEqual(16);
    expect(made.path).toBe(`/join/${made.code}`);
    expect(made.url).toBe(`http://localhost:3000/join/${made.code}`);
    expect(made.role).toBe("reader");
    const days = (Date.parse(made.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);

    const stored = readFileSync(t.server.invites.file, "utf8");
    expect(stored).not.toContain(made.code);
    expect(stored).toContain(createHash("sha256").update(made.code).digest("hex"));

    const list = await owner.get(`${base()}/invites`);
    expect(list.body).not.toContain(made.code);
    const row = list.json().invites.find((i: { id: string }) => i.id === made.id);
    expect(row).toMatchObject({ role: "reader", createdBy: { name: "Olive Owner" } });
    expect(row.secondsLeft).toBeGreaterThan(7 * 86_400 - 60);
  });

  it("is for owners only, and for no role but the three", async () => {
    for (const who of [writer]) {
      expect((await who.post(`${base()}/invites`, { role: "writer" })).statusCode).toBe(403);
      expect((await who.get(`${base()}/invites`)).statusCode).toBe(403);
    }
    expect((await owner.post(`${base()}/invites`, { role: "admin" })).statusCode).toBe(400);
    expect((await owner.post(`${base()}/invites`, {})).statusCode).toBe(400);
  });

  it("can be made for an owner, a writer or a reader, and gives exactly that role", async () => {
    for (const role of ["owner", "writer", "reader"] as const) {
      const { code } = await invite(role);
      const res = await join(code);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, project: slug, role });
    }
  });

  it("cancels a waiting link, which is then dead at once", async () => {
    const made = await invite();
    expect((await owner.del(`${base()}/invites/${made.id}`)).statusCode).toBe(200);
    expect(
      (await owner.get(`${base()}/invites`)).json().invites.map((i: { id: string }) => i.id),
    ).not.toContain(made.id);
    const res = await anon("GET", `/api/join/${made.code}`);
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toMatchObject({ code: "invite_cancelled", inviter: "Olive Owner" });
    expect((await join(made.code)).json().error.code).toBe("invite_cancelled");
    // Another project's owner (or a writer here) cannot cancel it.
    expect((await writer.del(`${base()}/invites/${made.id}`)).statusCode).toBe(403);
    expect((await owner.del(`${base()}/invites/nothing`)).json().error.code).toBe("not_found");
  });
});

describe("what the join page is told", () => {
  it("says which project, who invited, as what, and how big it is, to someone with no account", async () => {
    const { code } = await invite("writer");
    const res = await anon("GET", `/api/join/${code}`);
    expect(res.statusCode).toBe(200);
    const info = res.json() as JoinInfo;
    expect(info.role).toBe("writer");
    expect(info.inviter).toEqual({ name: "Olive Owner" });
    expect(info.project.name).toBe("Avalymia");
    expect(info.project.entries).toBeGreaterThan(0);
    expect(info.project.people).toBeGreaterThanOrEqual(2);
    expect(info.google).toBe(false);
    expect(info.alreadyMember).toBe(false);
    // No secret and no id of anything.
    expect(res.body).not.toContain(pid);
    // A member who looks is told so.
    const mine = await t.app.inject({
      method: "GET",
      url: `/api/join/${code}`,
      headers: { cookie: writer.cookie },
    });
    expect(mine.json().alreadyMember).toBe(true);
  });

  it("answers an unknown code and a malformed one alike, naming no one", async () => {
    const shaped = await anon("GET", `/api/join/${"a".repeat(32)}`);
    const short = await anon("GET", "/api/join/abc");
    const odd = await anon("GET", `/api/join/${"%20".repeat(30)}`);
    for (const res of [shaped, short, odd]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("invite_unknown");
      expect(res.json().error.inviter).toBeUndefined();
    }
    expect(shaped.json()).toEqual(short.json());
    expect(
      (
        await anon("POST", `/api/join/${"b".repeat(32)}`, {
          name: "x",
          email: "x@y.zz",
          password: "twelve chars!!",
        })
      ).json().error.code,
    ).toBe("invite_unknown");
  });

  it("says a used link is used, and names whom to ask", async () => {
    const { code } = await invite();
    expect((await join(code)).statusCode).toBe(200);
    for (const res of [await anon("GET", `/api/join/${code}`), await join(code)]) {
      expect(res.statusCode).toBe(410);
      expect(res.json().error).toMatchObject({ code: "invite_used", inviter: "Olive Owner" });
      expect(res.json().error.message).toContain("Olive Owner");
    }
  });

  it("says an expired link has run out, by the server's clock", async () => {
    const made = await invite();
    const { code } = made;
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 7 * 86_400_000 + 1000 });
    const res = await anon("GET", `/api/join/${code}`);
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toMatchObject({ code: "invite_expired", inviter: "Olive Owner" });
    expect((await join(code)).json().error.code).toBe("invite_expired");
    // An expired link is not in the owner's list of waiting links.
    expect(
      (await owner.get(`${base()}/invites`)).json().invites.map((i: { id: string }) => i.id),
    ).not.toContain(made.id);
    vi.useRealTimers();
    // Just inside the week it still works.
    const fresher = await invite();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 7 * 86_400_000 - 60_000 });
    expect((await anon("GET", `/api/join/${fresher.code}`)).statusCode).toBe(200);
  });

  it("is dead once the project is gone", async () => {
    const made = await t.post("/api/projects", {
      name: "Short lived",
      slug: "short-lived",
      start: "empty",
    });
    const id = made.json().id as string;
    await addMember(t, id, owner.id, "owner");
    const res = await owner.post("/api/p/short-lived/invites", { role: "reader" });
    const { code } = res.json() as CreateInviteResponse;
    await t.app.inject({
      method: "DELETE",
      url: "/api/p/short-lived/project",
      headers: t.base(),
      payload: { name: "Short lived" },
    });
    expect((await anon("GET", `/api/join/${code}`)).json().error.code).toBe("invite_cancelled");
  });
});

describe("joining as someone new", () => {
  it("with an email and a password: makes the account, the membership, uses the link, starts a session", async () => {
    const { code } = await invite("reader");
    const email = fresh();
    const res = await join(code, { email, name: "Rita Reader" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, project: slug, role: "reader" });
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/^frontier_session=/);
    const me = await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.json()).toMatchObject({
      name: "Rita Reader",
      email,
      admin: false,
      method: "password",
    });
    const person = (await t.server.people.byEmail(email))!;
    expect(await rolesOf(person.id)).toBe("reader");
    // Not an admin, and the password they chose logs them in.
    expect(person.admin).toBe(false);
    const again = await t.app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email, password: "a long enough password" },
    });
    expect(again.statusCode).toBe(200);
    // And they can read the project, but not write it.
    expect(
      (await t.app.inject({ method: "GET", url: `${base()}/tree`, headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await t.app.inject({
          method: "PUT",
          url: `${base()}/drafts`,
          headers: { cookie },
          payload: {},
        })
      ).json().error.code,
    ).toBe("role_too_low");
  });

  it("takes no role, project or admin flag from the body", async () => {
    const { code } = await invite("reader");
    const email = fresh();
    const res = await join(code, {
      email,
      role: "owner",
      admin: true,
      project: "elsewhere",
      projectId: "x",
      slug: "other",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().role).toBe("reader");
    const person = (await t.server.people.byEmail(email))!;
    expect(person.admin).toBe(false);
    expect(await rolesOf(person.id)).toBe("reader");
  });

  it("holds a link for one project to that project", async () => {
    const other = await t.post("/api/projects", { name: "Other", slug: "other", start: "empty" });
    expect(other.statusCode).toBe(201);
    const { code } = await invite("writer");
    const email = fresh();
    expect((await join(code, { email })).statusCode).toBe(200);
    const person = (await t.server.people.byEmail(email))!;
    const projects = await t.server.projects.of(person.id);
    expect(projects.map((p) => p.slug)).toEqual([slug]);
  });

  it("uses the same password rules as elsewhere", async () => {
    const { code } = await invite();
    expect((await join(code, { password: "short" })).statusCode).toBe(400);
    expect((await join(code, { email: "not an email" })).statusCode).toBe(400);
    expect((await join(code, { name: "  " })).statusCode).toBe(400);
    // A refused attempt leaves the link as it was.
    expect((await anon("GET", `/api/join/${code}`)).statusCode).toBe(200);
  });

  it("refuses an email that has an account, without using the link, and lets the page say to log in", async () => {
    const { code } = await invite();
    for (const email of ["owner@example.com", "OWNER@Example.COM ", "author@example.com"]) {
      const res = await join(code, { email });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("account_exists");
      expect(res.json().error.message).toMatch(/log in/i);
      // Nothing about whose account it is.
      expect(res.body).not.toMatch(/Olive|Author/);
    }
    expect((await anon("GET", `/api/join/${code}`)).statusCode).toBe(200);
    expect(await t.server.people.byEmail("owner@example.com")).not.toBeNull();
  });

  it("lets exactly one of two simultaneous uses succeed", async () => {
    const { code } = await invite("writer");
    const before = (await t.server.projects.get(pid))!.members.length;
    const results = await Promise.all(Array.from({ length: 6 }, () => join(code)));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 410)).toHaveLength(5);
    // Only the one person was added by this link, and the link names them.
    const members = (await t.server.projects.get(pid))!.members;
    expect(members).toHaveLength(before + 1);
    const used = (await t.server.invites.byCode(code))!;
    expect(members.filter((m) => m.personId === used.usedBy)).toHaveLength(1);
  });

  it("cancelled while a use is under way: either the use wins or the cancel does, never both", async () => {
    for (let i = 0; i < 4; i++) {
      const made = await invite();
      const [joined, cancelled] = await Promise.all([
        join(made.code),
        owner.del(`${base()}/invites/${made.id}`),
      ]);
      const record = (await t.server.invites.all()).find((x) => x.id === made.id)!;
      if (joined.statusCode === 200) {
        // The use got there first; the cancel is then refused as the link was used.
        expect(cancelled.statusCode).toBe(410);
        expect(record.usedAt).toBeDefined();
      } else {
        expect(joined.statusCode).toBe(410);
        expect(record.usedAt).toBeUndefined();
      }
    }
  });

  it("with a passkey on this device: options and verify bound to the invitation", async () => {
    const { code } = await invite("writer");
    const optionsRes = await anon("POST", `/api/join/${code}/passkey/options`, {
      name: "Pia Passkey",
    });
    expect(optionsRes.statusCode, optionsRes.body).toBe(200);
    const options = optionsRes.json();
    expect(options.rp.id).toBe("localhost");
    expect(options.authenticatorSelection.userVerification).toBe("required");
    const cookie = cookieOf(optionsRes);

    // Another link's challenge cannot finish this one, and a wrong answer is refused.
    const other = await invite();
    const { response } = registerPasskey(options, "http://localhost:3000");
    const crossed = await anon(
      "POST",
      `/api/join/${other.code}/passkey/verify`,
      { response },
      cookie,
    );
    expect(crossed.statusCode).toBe(400);

    // The challenge is single use: it was spent by that attempt, so start again.
    const second = await anon("POST", `/api/join/${code}/passkey/options`, { name: "Pia Passkey" });
    const cookie2 = cookieOf(second);
    const registered = registerPasskey(second.json(), "http://localhost:3000");
    const done = await anon(
      "POST",
      `/api/join/${code}/passkey/verify`,
      { response: registered.response, passkeyName: "My phone" },
      cookie2,
    );
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toEqual({ ok: true, project: slug, role: "writer" });
    const me = await t.app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookieOf(done, cookie2) },
    });
    expect(me.json()).toMatchObject({ name: "Pia Passkey", method: "passkey", passwordSet: false });
    expect(me.json().passkeys.map((k: { name: string }) => k.name)).toEqual(["My phone"]);
    expect((await t.server.people.byPasskey(registered.id))?.name).toBe("Pia Passkey");
    // The link is spent.
    expect((await anon("GET", `/api/join/${code}`)).json().error.code).toBe("invite_used");
  });

  it("a passkey join with a stale challenge or none is refused, and leaves the link alone", async () => {
    const { code } = await invite();
    const options = await anon("POST", `/api/join/${code}/passkey/options`, { name: "Quin" });
    const { response } = registerPasskey(options.json(), "http://localhost:3000");
    // No cookie: no challenge.
    expect((await anon("POST", `/api/join/${code}/passkey/verify`, { response })).statusCode).toBe(
      400,
    );
    // A response made for another origin fails verification.
    const wrong = registerPasskey(options.json(), "http://evil.example");
    expect(
      (
        await anon(
          "POST",
          `/api/join/${code}/passkey/verify`,
          { response: wrong.response },
          cookieOf(options),
        )
      ).statusCode,
    ).toBe(400);
    expect((await anon("GET", `/api/join/${code}`)).statusCode).toBe(200);
    // An email that has an account is refused at the options already.
    const exists = await anon("POST", `/api/join/${code}/passkey/options`, {
      name: "Quin",
      email: "owner@example.com",
    });
    expect(exists.json().error.code).toBe("account_exists");
  });
});

describe("joining with an account that exists", () => {
  it("needs a login, adds the membership with the link's role, and uses the link", async () => {
    const { code } = await invite("writer");
    expect((await anon("POST", `/api/join/${code}/accept`)).statusCode).toBe(401);
    const stranger = await addPerson(t, "Sam Stranger", "sam@example.com");
    const res = await stranger.post(`/api/join/${code}/accept`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, project: slug, role: "writer" });
    expect(await rolesOf(stranger.id)).toBe("writer");
    expect((await stranger.get(`${base()}/tree`)).statusCode).toBe(200);
    const again = await stranger.post(`/api/join/${code}/accept`);
    expect(again.statusCode).toBe(410);
  });

  it("tells a member they are already in, and keeps the link for someone else", async () => {
    const { code } = await invite("owner");
    const res = await writer.post(`/api/join/${code}/accept`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: "already_member", project: slug });
    // The role is untouched: a writer is not made an owner by their own link, nor demoted.
    expect(await rolesOf(writer.id)).toBe("writer");
    const info = await anon("GET", `/api/join/${code}`);
    expect(info.statusCode).toBe(200);
    // The owner can give it to someone else, who gets it.
    const next = await addPerson(t, "Nell Next", "nell@example.com");
    expect((await next.post(`/api/join/${code}/accept`)).statusCode).toBe(200);
    expect(await rolesOf(next.id)).toBe("owner");
  });

  it("lets only one of two people who accept at once have it", async () => {
    const { code } = await invite("reader");
    const a = await addPerson(t, "Al Accept", "al@example.com");
    const b = await addPerson(t, "Bo Accept", "bo@example.com");
    const results = await Promise.all([
      a.post(`/api/join/${code}/accept`),
      b.post(`/api/join/${code}/accept`),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 410]);
  });

  it("uses an invitation for a project other than the person's first", async () => {
    const made = await t.post("/api/projects", { name: "Second", slug: "second", start: "empty" });
    await addMember(t, made.json().id, owner.id, "owner");
    const res = await owner.post("/api/p/second/invites", { role: "writer" });
    const mover = await addPerson(t, "Max Mover", "max@example.com");
    const joined = await mover.post(`/api/join/${res.json().code}/accept`);
    expect(joined.json().project).toBe("second");
    expect(
      (await mover.get("/api/projects")).json().projects.map((p: { slug: string }) => p.slug),
    ).toEqual(["second"]);
  });
});

describe("what is kept out of the log and the open", () => {
  it("never logs an invitation code, in the address or the body", async () => {
    const { code } = await invite();
    await anon("GET", `/api/join/${code}`);
    await join(code);
    await anon("GET", `/api/auth/google/start?invite=${code}`);
    expect(LOG.some((l) => l.includes("/api/join/"))).toBe(true);
    expect(LOG.join("")).not.toContain(code);
  });

  it("counts the public routes against an allowance by address, with a 429 after it", async () => {
    const { LoginLimiter } = await import("../src/auth/limit.js");
    const routes: [string, string][] = [
      ["GET", `/api/join/${"c".repeat(32)}`],
      ["POST", `/api/join/${"c".repeat(32)}`],
      ["POST", `/api/join/${"c".repeat(32)}/passkey/options`],
      ["POST", `/api/join/${"c".repeat(32)}/passkey/verify`],
      ["GET", "/api/auth/google/start"],
      ["GET", "/api/auth/google/callback"],
    ];
    // The default allowance is a few times the login one (5 here is 100 in these tests, so 600).
    expect(t.server.joinLimit).toBeInstanceOf(LoginLimiter);
    for (const [method, url] of routes) {
      t.server.joinLimit = new LoginLimiter(3);
      const answers = [];
      for (let i = 0; i < 5; i++) {
        answers.push(
          (await anon(method as "GET", url, method === "POST" ? {} : undefined)).statusCode,
        );
      }
      expect(answers.slice(0, 3), `${method} ${url}`).not.toContain(429);
      expect(answers.slice(3), `${method} ${url}`).toEqual([429, 429]);
    }
  });

  it("does not let a request for another address use up this one's allowance", async () => {
    const { LoginLimiter } = await import("../src/auth/limit.js");
    t.server.joinLimit = new LoginLimiter(1);
    const code = "d".repeat(32);
    const from = (ip: string) =>
      t.app.inject({ method: "GET", url: `/api/join/${code}`, remoteAddress: ip });
    expect((await from("10.0.0.1")).statusCode).toBe(404);
    expect((await from("10.0.0.1")).statusCode).toBe(429);
    expect((await from("10.0.0.2")).statusCode).toBe(404);
  });
});

describe("login is not changed by any of it", () => {
  it("still logs in a joined person with their password", async () => {
    const { code } = await invite();
    const email = fresh();
    await join(code, { email });
    const res = await t.app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email, password: "a long enough password" },
    });
    expect(res.statusCode).toBe(200);
    expect(PASSWORD).toBeDefined();
  });
});
