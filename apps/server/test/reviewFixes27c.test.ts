/**
 * The fixes after the review of stage 27c (members, invitations, joining, Google, the reader's saved
 * view). Each test here would have failed before its fix.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_KEYS_HEADER,
  encodeDeviceKeys,
  type CreateInviteResponse,
  type MembersResponse,
  type Person,
} from "@frontier/schema";
import { buildApp } from "../src/app.js";
import { outsideRequest } from "../src/ai/keyring.js";
import { LoginLimiter, limitKey } from "../src/auth/limit.js";
import { hashPassword } from "../src/auth/password.js";
import { InviteStore } from "../src/members/invites.js";
import { joinAsNewPerson } from "../src/members/join.js";
import { asSavedView, savedViewOnly } from "../src/projects/view.js";
import { waysIn } from "../src/routes/auth.js";
import { StatusService } from "../src/status/status.js";
import { StateFiles } from "../src/state/files.js";
import {
  addMember,
  addPerson,
  type Client,
  cookieOf,
  makeTestApp,
  PASSWORD,
  type TestApp,
} from "./helpers/app.js";

const apps: TestApp[] = [];
async function app(
  env: Record<string, string> = {},
  options: Parameters<typeof makeTestApp>[1] = {},
): Promise<TestApp> {
  const t = await makeTestApp({ LOGIN_ATTEMPTS: "1000", ...env }, options);
  apps.push(t);
  return t;
}
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

const anon = (t: TestApp, method: "GET" | "POST", url: string, payload?: unknown, cookie = "") =>
  t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const firstProject = async (t: TestApp) => (await t.server.projects.all())[0]!;

/** A second project with exactly the admin as its owner (it is a real folder, so it can be deleted). */
async function secondProject(t: TestApp, slug: string): Promise<string> {
  const res = await t.post("/api/projects", { name: slug, slug, start: "empty" });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

const invite = async (client: Client, slug: string, role: "owner" | "writer" | "reader") => {
  const res = await client.post(`/api/p/${slug}/invites`, { role });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as CreateInviteResponse;
};

describe("a change a person makes to themselves is answered over a real connection", () => {
  it("answers leaving, removing oneself and deleting the project, and still cuts their other streams", async () => {
    const t = await app();
    await t.login();
    const pid = await secondProject(t, "selfcut");
    const base = `/api/p/selfcut`;
    const second = await addPerson(t, "Olive Owner", "owner@example.com");
    const writer = await addPerson(t, "Wren Writer", "writer@example.com");
    await addMember(t, pid, second.id, "owner");
    await addMember(t, pid, writer.id, "writer");
    const address = await t.app.listen({ port: 0, host: "127.0.0.1" });
    const send = (who: { cookie: string }, method: string, path: string, body?: unknown) =>
      fetch(`${address}${path}`, {
        method,
        headers: {
          cookie: who.cookie,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    // The writer has the status stream open, then leaves with a body-less POST: the stream is cut,
    // and the answer to the leaving reaches them.
    const stream = await send(writer, "GET", `${base}/status/events`);
    expect(stream.status).toBe(200);
    const reading = stream.body!.getReader();
    await reading.read();
    const left = await send(writer, "POST", `${base}/members/leave`);
    expect(left.status).toBe(200);
    expect(await left.json()).toEqual({ ok: true });
    const ended = await Promise.race([
      reading.read().then(
        (r) => r.done,
        () => true,
      ),
      new Promise<string>((r) => setTimeout(() => r("still open"), 5000)),
    ]);
    expect(ended).toBe(true);
    expect((await t.server.projects.get(pid))!.members.some((m) => m.personId === writer.id)).toBe(
      false,
    );

    // An owner removes themselves with a body-less DELETE.
    const removed = await send(second, "DELETE", `${base}/members/${second.id}`);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
    expect((await t.server.projects.get(pid))!.members.map((m) => m.role)).toEqual(["owner"]);

    // Deleting the project is answered too.
    const gone = await send(t, "DELETE", `${base}/project`, { name: "selfcut" });
    expect(gone.status, await gone.clone().text()).toBe(200);
    expect(await t.server.projects.get(pid)).toBeNull();
  });
});

/** Stands in for a provider that starts to answer and then waits for ever. */
const hangingProvider: typeof fetch = async (input, init) => {
  if (new URL(String(input)).pathname.endsWith("/models")) return Response.json({ data: [] });
  const signal = init?.signal;
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning: "Hmm. " } }] })}\n\n`,
          ),
        );
        signal?.addEventListener("abort", () => c.error(signal.reason));
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
};

describe("a POST that streams is cut as well", () => {
  async function streaming() {
    const t = await app({}, { fetch: hangingProvider, settleMs: 0 });
    await t.login();
    t.repo.pushFromOutside({ "04 Inhabitants/Nirani.md": "# Nirani\n\nThey keep time.\n" });
    await t.services.sync();
    const first = await firstProject(t);
    const writer = await addPerson(t, "Wren Writer", "writer@example.com");
    await addMember(t, first.id, writer.id, "writer");
    const address = await t.app.listen({ port: 0, host: "127.0.0.1" });
    const headers = {
      cookie: writer.cookie,
      [AI_KEYS_HEADER]: encodeDeviceKeys({ openrouter: "sk-or-test-key-1234" }),
      "content-type": "application/json",
    };
    const model = await fetch(`${address}/api/settings/ai`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ models: { conversation: "test/talker" } }),
    });
    expect(model.status, await model.clone().text()).toBe(200);
    const res = await fetch(`${address}/api/p/${first.slug}/lore/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({ question: "How do the Nirani keep time?" }),
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    let text = "";
    while (!text.includes("event: reasoning")) {
      const { done, value } = await reader.read();
      expect(done).toBe(false);
      text += new TextDecoder().decode(value);
    }
    /** Whether the stream ends (by closing or failing) soon, as opposed to staying open. */
    const endsSoon = () =>
      Promise.race([
        (async () => {
          for (;;) if ((await reader.read()).done) return true;
        })().catch(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 5000)),
      ]);
    return { t, first, writer, address, endsSoon };
  }

  it("ends when the person is removed", async () => {
    const { t, first, writer, address, endsSoon } = await streaming();
    const res = await fetch(`${address}/api/p/${first.slug}/members/${writer.id}`, {
      method: "DELETE",
      headers: { cookie: t.cookie },
    });
    expect(res.status).toBe(200);
    expect(await endsSoon()).toBe(true);
  });

  it("ends when the person's role changes", async () => {
    const { t, first, writer, address, endsSoon } = await streaming();
    const res = await fetch(`${address}/api/p/${first.slug}/members/${writer.id}`, {
      method: "PUT",
      headers: { cookie: t.cookie, "content-type": "application/json" },
      body: JSON.stringify({ role: "reader" }),
    });
    expect(res.status).toBe(200);
    expect(await endsSoon()).toBe(true);
  });
});

describe("invitations outlive their maker no longer", () => {
  it("cancels an owner's waiting links when they are removed or demoted, and refuses them at use", async () => {
    const t = await app();
    await t.login();
    const first = await firstProject(t);
    const slug = first.slug;
    const olive = await addPerson(t, "Olive Owner", "olive@example.com");
    const otto = await addPerson(t, "Otto Owner", "otto@example.com");
    const ola = await addPerson(t, "Ola Owner", "ola@example.com");
    for (const who of [olive, otto, ola]) await addMember(t, first.id, who.id, "owner");
    const fromOlive = await invite(olive, slug, "owner");
    const fromOtto = await invite(otto, slug, "owner");

    // Removed: every link they made is dead at once, and the other owner's stays.
    expect((await ola.del(`/api/p/${slug}/members/${olive.id}`)).statusCode).toBe(200);
    const listed = (await otto.get(`/api/p/${slug}/invites`)).json().invites as { id: string }[];
    expect(listed.map((i) => i.id)).toEqual([fromOtto.id]);
    const join = (code: string, email: string) =>
      anon(t, "POST", `/api/join/${code}`, {
        name: "Nina New",
        email,
        password: "a long enough password",
      });
    const refused = await join(fromOlive.code, "nina@example.com");
    expect(refused.statusCode).toBe(410);
    expect(refused.json().error.code).toBe("invite_cancelled");
    expect(await t.server.people.byEmail("nina@example.com")).toBeNull();
    // By an account that exists, too.
    const nora = await addPerson(t, "Nora Nobody", "nora@example.com");
    const accepted = await nora.post(`/api/join/${fromOlive.code}/accept`);
    expect(accepted.json().error.code).toBe("invite_cancelled");

    // Demoted below owner: the same.
    expect(
      (await ola.put(`/api/p/${slug}/members/${otto.id}`, { role: "writer" })).statusCode,
    ).toBe(200);
    expect((await join(fromOtto.code, "nina2@example.com")).json().error.code).toBe(
      "invite_cancelled",
    );
    // Still an owner: a change of role that leaves them one cancels nothing.
    const kept = await invite(ola, slug, "reader");
    expect((await ola.put(`/api/p/${slug}/members/${ola.id}`, { role: "owner" })).statusCode).toBe(
      200,
    );
    expect((await anon(t, "GET", `/api/join/${kept.code}`)).statusCode).toBe(200);
  });

  it("refuses at use a link whose maker stopped being an owner by any other way", async () => {
    const t = await app();
    await t.login();
    const first = await firstProject(t);
    const olive = await addPerson(t, "Olive Owner", "olive@example.com");
    await addMember(t, first.id, olive.id, "owner");
    const made = await invite(olive, first.slug, "owner");
    // Changed behind the routes' back, as a restored file or a crash between steps might leave it.
    await addMember(t, first.id, olive.id, "writer");
    const res = await anon(t, "POST", `/api/join/${made.code}`, {
      name: "Nina New",
      email: "nina@example.com",
      password: "a long enough password",
    });
    expect(res.json().error.code).toBe("invite_cancelled");
    expect(await t.server.people.byEmail("nina@example.com")).toBeNull();
  });
});

describe("the log", () => {
  it("never holds a code from the address of the join page", async () => {
    const lines: string[] = [];
    const t = await app({}, { logger: true, logStream: { write: (l) => lines.push(l) } });
    await t.login();
    const first = await firstProject(t);
    const made = await invite(
      await addPerson(t, "Olive Owner", "olive@example.com").then(async (c) => {
        await addMember(t, first.id, c.id, "owner");
        return c;
      }),
      first.slug,
      "reader",
    );
    for (const url of [
      `/join/${made.code}`,
      `/join/${made.code}?x=1`,
      `/%61pi/join/${made.code}`,
    ]) {
      await anon(t, "GET", url);
    }
    expect(lines.some((l) => l.includes("/join/:code"))).toBe(true);
    expect(lines.join("")).not.toContain(made.code);
  });
});

describe("an email for every account", () => {
  it("refuses a passkey join without one, and keeps blank-email login for the one account that has none", async () => {
    const t = await app();
    await t.login();
    const first = await firstProject(t);
    const owner = await addPerson(t, "Olive Owner", "olive@example.com");
    await addMember(t, first.id, owner.id, "owner");
    const made = await invite(owner, first.slug, "writer");
    for (const body of [
      { name: "Pia" },
      { name: "Pia", email: "" },
      { name: "Pia", email: "  " },
    ]) {
      const res = await anon(t, "POST", `/api/join/${made.code}/passkey/options`, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await anon(t, "GET", `/api/join/${made.code}`)).statusCode).toBe(200);

    // A legacy owner with no email, next to other accounts: the hint is for exactly one account.
    const legacy = await t.server.people.create({
      name: "Lee Legacy",
      email: "",
      passwordHash: await hashPassword("legacy password here"),
    });
    const hint = async () => (await anon(t, "GET", "/api/session")).json().emailless;
    expect(await hint()).toBe(true);
    const login = await t.login("legacy password here", "");
    expect(login.statusCode, login.body).toBe(200);
    expect((await t.get("/api/me")).json()).toMatchObject({ id: legacy.id, needsProfile: true });
    // A second account without an email (made by hand, as no route does) turns the hint off, and a
    // blank email then names no one.
    await t.server.people.create({ name: "Two", email: "", passwordHash: "" });
    expect(await hint()).toBe(false);
    expect((await t.login("legacy password here", "")).statusCode).toBe(401);
  });
});

describe("the last-active note", () => {
  it("writes the file once for a burst of requests, and does not arm the backup", async () => {
    const t = await app();
    await t.login();
    const first = await firstProject(t);
    const writer = await addPerson(t, "Wren Writer", "writer@example.com");
    await addMember(t, first.id, writer.id, "writer");
    await t.server.projects.settled();
    const writes = vi.spyOn(t.server.files, "writeJson");
    let changes = 0;
    t.server.files.onChange(() => changes++);
    const burst = await Promise.all(
      Array.from({ length: 10 }, () => writer.get(`/api/p/${first.slug}/schema`)),
    );
    expect(burst.every((r) => r.statusCode === 200)).toBe(true);
    await t.server.projects.settled();
    const ofProjects = writes.mock.calls.filter(([path]) => path === t.server.projects.file);
    expect(ofProjects).toHaveLength(1);
    // A last-active note alone does not start the backup's timer.
    expect(ofProjects[0]![2]).toBe(true);
    expect(changes).toBe(0);
    expect(
      (await t.server.projects.get(first.id))!.members.find((m) => m.personId === writer.id)!
        .lastActiveAt,
    ).toBeDefined();
    // And later requests in the window write nothing.
    await writer.get(`/api/p/${first.slug}/schema`);
    await t.server.projects.settled();
    expect(writes.mock.calls.filter(([path]) => path === t.server.projects.file)).toHaveLength(1);
  });

  it("writes nothing for a note the file already holds, as after a restart", async () => {
    const t = await app();
    await t.login();
    const first = await firstProject(t);
    const writer = await addPerson(t, "Wren Writer", "writer@example.com");
    await addMember(t, first.id, writer.id, "writer");
    await t.server.projects.touchMember(first.id, writer.id);
    await t.server.projects.settled();
    const writes = vi.spyOn(t.server.files, "writeJson");
    // A store that has noted no one yet, over the same file.
    const { ProjectStore } = await import("../src/projects/store.js");
    const fresh = new ProjectStore(join(t.server.config.dataDir, "state"), t.server.files);
    await fresh.touchMember(first.id, writer.id);
    await fresh.settled();
    expect(writes).not.toHaveBeenCalled();
  });
});

describe("joining is all or nothing", () => {
  it("removes the new account and gives the link back when the membership fails, whatever else fails", async () => {
    const t = await app();
    await t.login();
    const first = await firstProject(t);
    const owner = await addPerson(t, "Olive Owner", "olive@example.com");
    await addMember(t, first.id, owner.id, "owner");
    const made = await invite(owner, first.slug, "writer");
    const account = { name: "Nina New", email: "nina@example.com", passwordHash: "x" };

    vi.spyOn(t.server.projects, "addMember").mockRejectedValueOnce(new Error("disk full"));
    await expect(joinAsNewPerson(t.server, made.code, account)).rejects.toThrow("disk full");
    expect(await t.server.people.byEmail("nina@example.com")).toBeNull();
    expect((await anon(t, "GET", `/api/join/${made.code}`)).statusCode).toBe(200);

    // A release that fails too does not hide what went wrong first.
    vi.spyOn(t.server.projects, "addMember").mockRejectedValueOnce(new Error("disk full"));
    vi.spyOn(t.server.invites, "release").mockRejectedValueOnce(new Error("release failed"));
    await expect(joinAsNewPerson(t.server, made.code, account)).rejects.toThrow("disk full");
    expect(await t.server.people.byEmail("nina@example.com")).toBeNull();

    // The link whose release failed stays claimed until startup gives it back (see the next test).
    vi.restoreAllMocks();
    expect((await anon(t, "GET", `/api/join/${made.code}`)).json().error.code).toBe("invite_used");
  });

  it("gives back a claim that was never settled, at startup and when the list is read", async () => {
    const t = await app();
    await t.login();
    const first = await firstProject(t);
    const owner = await addPerson(t, "Olive Owner", "olive@example.com");
    await addMember(t, first.id, owner.id, "owner");
    const stale = await invite(owner, first.slug, "reader");
    const fresh = await invite(owner, first.slug, "reader");
    const joinedLate = await invite(owner, first.slug, "reader");
    const record = (code: string) => t.server.invites.byCode(code);
    const ids = {
      stale: (await record(stale.code))!.id,
      fresh: (await record(fresh.code))!.id,
      late: (await record(joinedLate.code))!.id,
    };
    await t.server.invites.claim(ids.stale);
    await t.server.invites.claim(ids.fresh);
    await t.server.invites.claim(ids.late);
    // Someone did join with the third one, after it was claimed, and the server stopped before
    // it was recorded.
    const stranger = await t.server.people.create({ name: "Sam", email: "sam@example.com" });
    const claimedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const claimedLater = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const file = t.server.invites.file;
    const stored = JSON.parse(readFileSync(file, "utf8")) as {
      invites: { id: string; usedAt?: string }[];
    };
    for (const i of stored.invites) {
      if (i.id === ids.stale) i.usedAt = claimedLater;
      if (i.id === ids.late) i.usedAt = claimedAt;
    }
    writeFileSync(file, JSON.stringify(stored));
    await t.server.projects.update(first.id, (p) => ({
      ...p,
      members: [
        ...p.members,
        {
          personId: stranger.id,
          role: "reader",
          addedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        },
      ],
    }));

    // Startup: a server built over the same files.
    const second = await buildApp(t.server.config);
    await second.app.close();
    const after = async (id: string) => (await t.server.invites.all()).find((i) => i.id === id)!;
    expect((await after(ids.stale)).usedAt).toBeUndefined();
    expect((await after(ids.stale)).usedBy).toBeUndefined();
    // Too young to be a failure: it may be a use in progress.
    expect((await after(ids.fresh)).usedAt).toBeDefined();
    expect((await after(ids.late)).usedBy).toBe(stranger.id);
    expect((await anon(t, "GET", `/api/join/${stale.code}`)).statusCode).toBe(200);

    // The list does the same housekeeping.
    const again = await invite(owner, first.slug, "reader");
    const againId = (await record(again.code))!.id;
    await t.server.invites.claim(againId);
    const rewritten = JSON.parse(readFileSync(file, "utf8")) as typeof stored;
    for (const i of rewritten.invites) if (i.id === againId) i.usedAt = claimedLater;
    writeFileSync(file, JSON.stringify(rewritten));
    await owner.get(`/api/p/${first.slug}/invites`);
    expect((await after(againId)).usedAt).toBeUndefined();
  });

  it("drops long dead links and cancels the waiting ones of someone no longer an owner, in the store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "frontier-invites-"));
    try {
      let now = new Date("2026-01-01T00:00:00Z");
      const store = new InviteStore(dir, new StateFiles(), () => now);
      const made = await store.create({ projectId: "p1", role: "reader", createdBy: "gone" });
      const other = await store.create({ projectId: "p1", role: "reader", createdBy: "kept" });
      await store.tidy({
        isOwner: (_p, person) => person === "kept",
        memberSince: () => null,
      });
      const all = await store.all();
      expect(all.find((i) => i.id === made.invite.id)!.cancelledAt).toBeDefined();
      expect(all.find((i) => i.id === other.invite.id)!.cancelledAt).toBeUndefined();
      now = new Date("2026-03-01T00:00:00Z");
      await store.tidy({ isOwner: () => true, memberSince: () => null });
      expect((await store.all()).map((i) => i.id)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the reader's saved view does not leak into what everyone shares", () => {
  it("leaves the saved view when a timer is armed from a reader's request", () => {
    expect(asSavedView(() => outsideRequest(() => savedViewOnly()))).toBe(false);
    expect(asSavedView(() => savedViewOnly())).toBe(true);
  });

  it("builds the status snapshot for everyone as a writer sees it, even from a reader's request", () => {
    const index = { attention: () => ({}), commit: "abc", schemaProblem: null, schemaNote: null };
    const status = new StatusService(index as never, {
      library: "github",
      backupOutside: true,
      keptCopies: () => (savedViewOnly() ? 0 : 3),
    });
    const seen: number[] = [];
    // `attention()` of the stand-in index has no lists; the service reads them with `.length`.
    const empty = {
      ambiguousLinks: [],
      duplicateImages: [],
      mixedEndings: [],
      brokenAppendixLinks: [],
      nearFolderNotes: [],
      unreadableFields: [],
      duplicateIds: [],
    };
    (index as { attention: () => unknown }).attention = () => empty;
    status.subscribe((s) => seen.push(s.attention.keptCopies));
    asSavedView(() => status.fetched("abc"));
    expect(seen).toEqual([3]);
  });
});

describe("ways in", () => {
  it("counts Google only where the server offers it", () => {
    const person = {
      passwordHash: "",
      passwordOff: false,
      passkeys: [{ id: "k" }],
      identities: [{ provider: "google" }],
    } as unknown as Person;
    expect(waysIn(person, true)).toBe(2);
    expect(waysIn(person, false)).toBe(1);
  });

  async function withForgetfulSession() {
    const t = await makeTestApp({ LOGIN_ATTEMPTS: "1000" });
    apps.push(t);
    // A route only for this test (before the server is ready): sets how the session says it was started.
    t.app.post("/api/test/method", async (request) => {
      const { method } = request.query as { method?: string };
      request.session.set("method", method as "password" | undefined);
      return { ok: true };
    });
    await t.login();
    return t;
  }

  it("treats a session with no method as a password one when switching the password off", async () => {
    const t = await withForgetfulSession();
    await t.server.people.update((await t.server.people.all())[0]!.id, (p) => ({
      ...p,
      passkeys: [
        {
          id: "k1",
          publicKey: "x",
          counter: 0,
          transports: [],
          name: "Key",
          addedAt: new Date().toISOString(),
        },
      ],
    }));
    expect((await t.post("/api/test/method")).statusCode).toBe(200);
    const res = await t.put("/api/settings/password-off", { off: true });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain("passkey first");
  });

  it("does not count an unused Google link as a way in when switching the password off", async () => {
    const t = await withForgetfulSession();
    await t.server.people.update((await t.server.people.all())[0]!.id, (p) => ({
      ...p,
      identities: [{ provider: "google", subject: "s", addedAt: new Date().toISOString() }],
    }));
    expect((await t.post("/api/test/method?method=passkey")).statusCode).toBe(200);
    const res = await t.put("/api/settings/password-off", { off: true });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain("Add a passkey first");
    // And unlinking it loses nothing, so it is allowed.
    expect((await t.del("/api/me/google")).statusCode).toBe(200);
  });
});

describe("names", () => {
  it("gives an email as a name only to an owner, and never on a public page", async () => {
    const t = await app();
    await t.login();
    const first = await firstProject(t);
    const slug = first.slug;
    const owner = await addPerson(t, "Olive Owner", "olive@example.com");
    const writer = await addPerson(t, "Wren Writer", "writer@example.com");
    const nameless = await addPerson(t, "", "nameless@example.com");
    await addMember(t, first.id, owner.id, "owner");
    await addMember(t, first.id, writer.id, "writer");
    await addMember(t, first.id, nameless.id, "writer");
    const names = async (who: Client) =>
      ((await who.get(`/api/p/${slug}/members`)).json() as MembersResponse).members
        .filter((m) => m.id === nameless.id)
        .map((m) => m.name);
    expect(await names(owner)).toEqual(["nameless@example.com"]);
    expect(await names(writer)).toEqual(["Someone"]);
    const listed = async (who: Client) =>
      (
        (await who.get(`/api/p/${slug}/project`)).json() as {
          members: { id: string; name: string }[];
        }
      ).members.find((m) => m.id === nameless.id)!.name;
    expect(await listed(owner)).toBe("nameless@example.com");
    expect(await listed(writer)).toBe("Someone");

    // A link made by someone with no name: the public page and the errors say "Someone".
    await addMember(t, first.id, nameless.id, "owner");
    const made = await invite(nameless, slug, "reader");
    const info = await anon(t, "GET", `/api/join/${made.code}`);
    expect(info.json().inviter).toEqual({ name: "Someone" });
    expect(info.body).not.toContain("nameless@example.com");
    expect((await owner.del(`/api/p/${slug}/invites/${made.id}`)).statusCode).toBe(200);
    const dead = await anon(t, "GET", `/api/join/${made.code}`);
    expect(dead.json().error.inviter).toBe("Someone");
    expect(dead.body).not.toContain("nameless@example.com");
  });
});

describe("the history of a library", () => {
  it("does not read a file at a commit that is not published", async () => {
    const t = await app();
    await t.login();
    const first = await firstProject(t);
    const reader = await addPerson(t, "Reed Reader", "reader@example.com");
    await addMember(t, first.id, reader.id, "reader");
    const path = "02 People/Mira.md";
    const secret = t.repo.pushBranch("proposal/secret", { [path]: "# Mira\n\nNot published.\n" });
    const vault = t.services.paths.vault;
    execFileSync("git", ["fetch", "origin"], { cwd: vault, stdio: "ignore" });
    // The commit is in the clone (so this is the check, not a missing object).
    execFileSync("git", ["cat-file", "-e", secret], { cwd: vault });
    const url = (commit: string) =>
      `/api/p/${first.slug}/history/version?path=${encodeURIComponent(path)}&commit=${commit}`;
    const refused = await reader.get(url(secret));
    expect(refused.statusCode).toBe(404);
    expect(refused.body).not.toContain("Not published");
    // A published version is read as ever.
    const versions = (
      await reader.get(`/api/p/${first.slug}/history?path=${encodeURIComponent(path)}`)
    ).json().versions as { commit: string }[];
    expect(versions.length).toBeGreaterThan(0);
    const ok = await reader.get(url(versions[0]!.commit));
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

describe("what a reader is told of comments", () => {
  it("is nothing: the work queue and from-here count none for a reader", async () => {
    const t = await app();
    await t.login();
    const first = await firstProject(t);
    const reader = await addPerson(t, "Reed Reader", "reader@example.com");
    await addMember(t, first.id, reader.id, "reader");
    const path = "02 People/Mira.md";
    const text = (
      await t.get(`/api/p/${first.slug}/entries?path=${encodeURIComponent(path)}`)
    ).json().text as string;
    const quote = text
      .split("\n")
      .find((l) => l.trim().length > 10 && !l.startsWith("#"))!
      .trim();
    const made = await t.post(`/api/p/${first.slug}/comments`, {
      path,
      quote,
      prefix: "",
      suffix: "",
      text: "Check this",
      for: "me",
    });
    expect(made.statusCode, made.body).toBe(200);
    const reasons = async (who: { get: Client["get"] }) =>
      (
        (await who.get(`/api/p/${first.slug}/keep-going/queue`)).json() as {
          needsLove: { rows: { path: string; reasons: { rule: string }[] }[] };
        }
      ).needsLove.rows
        .filter((r) => r.path === path)
        .flatMap((r) => r.reasons.map((x) => x.rule));
    expect(await reasons(t)).toContain("openComments");
    expect(await reasons(reader)).not.toContain("openComments");
    const fromHere = async (who: { get: Client["get"] }) =>
      (await who.get(`/api/p/${first.slug}/keep-going/from-here?path=${encodeURIComponent(path)}`))
        .body;
    expect(await fromHere(reader)).not.toContain("openComments");
  });
});

describe("the rate limiter", () => {
  it("counts an IPv6 network by its /64, and a mapped IPv4 address as the IPv4 one", () => {
    expect(limitKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(limitKey("2001:db8:1:2::1"));
    expect(limitKey("2001:db8:1:2::1")).not.toBe(limitKey("2001:db8:1:3::1"));
    expect(limitKey("::ffff:10.0.0.7")).toBe("10.0.0.7");
    expect(limitKey("10.0.0.7")).toBe("10.0.0.7");
    const limiter = new LoginLimiter(2);
    limiter.attempt("2001:db8:1:2::1");
    limiter.attempt("2001:db8:1:2:ffff::9");
    expect(() => limiter.attempt("2001:db8:1:2::77")).toThrow();
    expect(() => limiter.attempt("2001:db8:1:3::1")).not.toThrow();
  });

  it("forgets what is past its window, and never holds more than its capacity", () => {
    let now = 0;
    const limiter = new LoginLimiter(5, 1000, () => now, 3);
    for (const a of ["a", "b", "c", "d", "e"]) limiter.attempt(a);
    expect(limiter.size).toBe(3);
    now = 5000;
    limiter.attempt("f");
    expect(limiter.size).toBe(1);
    // An address that comes back after its window starts afresh.
    const strict = new LoginLimiter(1, 1000, () => now);
    strict.attempt("x");
    expect(() => strict.attempt("x")).toThrow();
    now += 1001;
    expect(() => strict.attempt("x")).not.toThrow();
  });

  it("does not look through every address on every attempt", () => {
    let now = 0;
    const limiter = new LoginLimiter(5, 1000, () => now);
    const sweep = vi.spyOn(limiter as unknown as { sweep(): void }, "sweep");
    limiter.attempt("old");
    now = 1500;
    limiter.attempt("a");
    // "old" went with the first attempt after its window.
    expect(limiter.size).toBe(1);
    sweep.mockClear();
    for (let i = 0; i < 50; i++) limiter.attempt(`b${i}`);
    expect(sweep).not.toHaveBeenCalled();
    expect(limiter.size).toBe(51);
  });
});

describe("a request from another site", () => {
  it("is refused when it changes something, by what the browser says; others go on", async () => {
    const t = await app();
    const post = (headers: Record<string, string>) =>
      t.app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { email: "author@example.com", password: PASSWORD },
      });
    const cross = await post({ "sec-fetch-site": "cross-site" });
    expect(cross.statusCode).toBe(403);
    expect(cross.json().error.code).toBe("not_allowed");
    expect((await post({ "sec-fetch-site": "same-site" })).statusCode).toBe(403);
    expect(
      (await post({ "sec-fetch-site": "same-site", origin: "http://evil.localhost:3000" }))
        .statusCode,
    ).toBe(403);
    expect(
      (await post({ "sec-fetch-site": "same-site", origin: "http://localhost:3000" })).statusCode,
    ).toBe(200);
    expect((await post({ "sec-fetch-site": "same-origin" })).statusCode).toBe(200);
    expect((await post({ "sec-fetch-site": "none" })).statusCode).toBe(200);
    expect((await post({})).statusCode).toBe(200);
    // Reading is never refused for this, so the Google callback (a GET) and links from other sites work.
    const read = await t.app.inject({
      method: "GET",
      url: "/api/session",
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(read.statusCode).toBe(200);
    const logout = await t.app.inject({
      method: "POST",
      url: "/api/logout",
      headers: { "sec-fetch-site": "cross-site", cookie: cookieOf(await post({})) },
    });
    expect(logout.statusCode).toBe(403);
  });
});

describe("setting the same role", () => {
  it("writes nothing and cuts nothing", async () => {
    const t = await app();
    await t.login();
    const first = await firstProject(t);
    const writer = await addPerson(t, "Wren Writer", "writer@example.com");
    const boss = await addPerson(t, "Olive Owner", "olive@example.com");
    await addMember(t, first.id, writer.id, "writer");
    await addMember(t, first.id, boss.id, "owner");
    // The caller has been noted already, so only a change of role could write.
    await boss.get(`/api/p/${first.slug}/members`);
    await t.server.projects.settled();
    const writes = vi.spyOn(t.server.files, "writeJson");
    const cut = vi.spyOn(t.server.live, "cut");
    const res = await boss.put(`/api/p/${first.slug}/members/${writer.id}`, { role: "writer" });
    expect(res.statusCode).toBe(200);
    expect(writes.mock.calls.filter(([p]) => p === t.server.projects.file)).toHaveLength(0);
    expect(cut).not.toHaveBeenCalled();
    expect(
      (await boss.put(`/api/p/${first.slug}/members/${writer.id}`, { role: "reader" })).statusCode,
    ).toBe(200);
    expect(cut).toHaveBeenCalledTimes(1);
  });
});
