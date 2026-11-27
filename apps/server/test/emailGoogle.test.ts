/**
 * Google and addresses nobody confirmed (stage 28): a Google-verified person wins an address that
 * an account only typed, when that account can still log in without it; a confirmed address, an
 * account that could be shut out, and the server's first account are never touched.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CreateInviteResponse, MeResponse } from "@frontier/schema";
import {
  addMember,
  addPerson,
  cookieOf,
  makeTestApp,
  PASSWORD,
  type Client,
  type TestApp,
} from "./helpers/app.js";
import { clearMail, outbox } from "./helpers/mail.js";
import { CLIENT_ID, CLIENT_SECRET, FakeProvider, type Grant } from "./helpers/oidc.js";

let provider: FakeProvider;
let t: TestApp;
let off: TestApp;
let owner: Client;
let slug: string;
let pid: string;
let n = 0;
const key = () => ({
  id: `k${++n}`,
  publicKey: "AA",
  counter: 0,
  transports: [],
  name: "Phone",
  addedAt: new Date().toISOString(),
});

const env = (extra: Record<string, string>) => ({
  LOGIN_ATTEMPTS: "100",
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
  GOOGLE_ISSUER: provider.issuer,
  ...extra,
});

beforeAll(async () => {
  provider = await new FakeProvider().start();
  t = await makeTestApp(env({ MAIL_TEST_TRANSPORT: "memory" }));
  await t.login();
  const first = (await t.server.projects.all())[0]!;
  pid = first.id;
  slug = first.slug;
  owner = await addPerson(t, "Olive Owner", "owner@example.com");
  await addMember(t, pid, owner.id, "owner");
  off = await makeTestApp(env({}));
  await off.login();
});
afterAll(async () => {
  await t.close();
  await off.close();
  await provider.stop();
});

const invite = async (app: TestApp, by: Client | null, role = "writer") => {
  const res = by
    ? await by.post(`/api/p/${slug}/invites`, { role })
    : await app.post(`/api/p/${slug}/invites`, { role });
  return res.json() as CreateInviteResponse;
};

async function trip(app: TestApp, query: string, grant: Grant, cookie = "") {
  const started = await app.app.inject({
    method: "GET",
    url: `/api/auth/google/start?${query}`,
    ...(cookie ? { headers: { cookie } } : {}),
  });
  const location = String(started.headers.location);
  const request = provider.parseAuthRequest(location);
  const code = provider.allow(request, grant);
  const res = await app.app.inject({
    method: "GET",
    url: `/api/auth/google/callback?code=${code}&state=${request.state}`,
    headers: { cookie: cookieOf(started, cookie) },
  });
  return {
    res,
    to: String(res.headers.location ?? ""),
    cookie: cookieOf(res, cookieOf(started, cookie)),
  };
}

const typed = async (
  app: TestApp,
  email: string,
  extra: Record<string, unknown> = {},
  opts: { confirmed?: boolean } = {},
) =>
  app.server.people.create({
    name: "Typed Address",
    email,
    passwordHash: "",
    ...(opts.confirmed
      ? { emailConfirmedAt: new Date().toISOString(), emailConfirmedBy: "link" as const }
      : {}),
    ...extra,
  });

describe("a Google-verified person and an address someone else only typed", () => {
  it("wins it: a new, confirmed account; the other is asked to add another address", async () => {
    const email = "shared.one@example.org";
    const { hashPassword } = await import("../src/auth/password.js");
    const old = await typed(t, email, {
      passkeys: [key()],
      passwordHash: await hashPassword(PASSWORD),
    });
    // The old account is logged in somewhere; that session carries on.
    const login = await t.app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email, password: PASSWORD },
    });
    const oldCookie = cookieOf(login);
    const link = await invite(t, owner);
    await clearMail(t);
    const { to, cookie } = await trip(t, `invite=${link.code}`, {
      sub: "g-shared-1",
      email: email.toUpperCase(),
      name: "Gabi Google",
    });
    expect(to).toBe(`/p/${slug}`);
    const winner = (await t.server.people.all()).find(
      (p) => p.identities[0]?.subject === "g-shared-1",
    )!;
    expect(winner.email.toLowerCase()).toBe(email);
    expect(winner.emailConfirmedBy).toBe("google");
    expect(winner.emailConfirmedAt).not.toBeNull();
    expect(winner.id).not.toBe(old.id);
    // Confirmed by Google: no confirm mail, and the project has them.
    expect(await outbox(t)).toHaveLength(0);
    expect(
      (
        (
          await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie } })
        ).json() as MeResponse
      ).emailInfo,
    ).toMatchObject({ status: "confirmed", confirmedBy: "google" });
    // The other account gave the address up and is asked for another; it keeps its passkey and
    // its session.
    const left = (await t.server.people.get(old.id))!;
    expect(left.email).toBe("");
    expect(left.emailDisplaced).toBe(true);
    expect(left.passkeys).toHaveLength(1);
    expect(left.emailCode).toBeNull();
    const me = await t.app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: oldCookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      needsProfile: true,
      emailInfo: { needsAddress: true, status: "none" },
    });
    // The address is the Google person's alone: the old password no longer logs in with it.
    const again = await t.app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email, password: PASSWORD },
    });
    expect(again.statusCode).toBe(401);
  });

  it("kills the displaced account's links for that address (confirm, change, reset)", async () => {
    const email = "shared.two@example.org";
    const old = await typed(t, email, { passkeys: [key()] });
    await t.server.people.update(old.id, (p) => ({
      ...p,
      emailCode: {
        codeHash: "a".repeat(64),
        address: email,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        mail: "sent",
      },
      emailPending: { address: "other@example.org", requestedAt: new Date().toISOString() },
      resetCode: {
        codeHash: "b".repeat(64),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    }));
    const link = await invite(t, owner);
    await trip(t, `invite=${link.code}`, { sub: "g-shared-2", email, name: "G Two" });
    const left = (await t.server.people.get(old.id))!;
    expect(left).toMatchObject({ email: "", emailCode: null, emailPending: null, resetCode: null });
  });

  it("is still account_exists for a CONFIRMED address, and nothing is changed", async () => {
    const email = "confirmed.one@example.org";
    const old = await typed(t, email, { passkeys: [key()] }, { confirmed: true });
    const link = await invite(t, owner);
    const { to } = await trip(t, `invite=${link.code}`, { sub: "g-c-1", email, name: "G C" });
    expect(to).toBe(`/join/${link.code}?problem=account_exists`);
    expect((await t.server.people.get(old.id))!.email).toBe(email);
    expect((await t.server.people.all()).some((p) => p.identities[0]?.subject === "g-c-1")).toBe(
      false,
    );
    // The link was not used up.
    expect((await t.app.inject({ method: "GET", url: `/api/join/${link.code}` })).statusCode).toBe(
      200,
    );
  });

  it("is account_exists when email and password are the only way in (it would be shut out)", async () => {
    const email = "pw.only@example.org";
    const { hashPassword } = await import("../src/auth/password.js");
    const old = await typed(t, email, { passwordHash: await hashPassword(PASSWORD) });
    const link = await invite(t, owner);
    const { to } = await trip(t, `invite=${link.code}`, { sub: "g-pw", email, name: "G P" });
    expect(to).toBe(`/join/${link.code}?problem=account_exists`);
    const kept = (await t.server.people.get(old.id))!;
    expect(kept.email).toBe(email);
    expect(kept.emailDisplaced).toBe(false);
    // It can still log in.
    expect(
      (
        await t.app.inject({
          method: "POST",
          url: "/api/login",
          payload: { email, password: PASSWORD },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("is account_exists for the server's first account, whatever it has", async () => {
    const admin = (await t.server.people.all()).find((p) => p.admin)!;
    await t.server.people.update(admin.id, (p) => ({ ...p, passkeys: [key()] }));
    const link = await invite(t, owner);
    const { to } = await trip(t, `invite=${link.code}`, {
      sub: "g-admin",
      email: admin.email,
      name: "Not The Admin",
    });
    expect(to).toBe(`/join/${link.code}?problem=account_exists`);
    expect((await t.server.people.get(admin.id))!.email).toBe(admin.email);
    expect((await t.login()).statusCode).toBe(200);
  });

  it("is account_exists for an account that already has a Google link", async () => {
    const email = "linked.one@example.org";
    const old = await typed(t, email, {
      passkeys: [key()],
      identities: [
        {
          provider: "google",
          subject: "g-other-sub",
          email: "x@y.zz",
          addedAt: new Date().toISOString(),
        },
      ],
    });
    const link = await invite(t, owner);
    const { to } = await trip(t, `invite=${link.code}`, { sub: "g-new-sub", email, name: "G L" });
    expect(to).toBe(`/join/${link.code}?problem=account_exists`);
    expect((await t.server.people.get(old.id))!.email).toBe(email);
  });

  it("never links Google to the account by its address", async () => {
    const email = "no.link@example.org";
    const old = await typed(t, email, { passkeys: [key()] });
    const link = await invite(t, owner);
    await trip(t, `invite=${link.code}`, { sub: "g-nolink", email, name: "G N" });
    expect((await t.server.people.get(old.id))!.identities).toEqual([]);
  });

  it("with no invitation Google makes no account and displaces nothing", async () => {
    const email = "no.invite@example.org";
    const old = await typed(t, email, { passkeys: [key()] });
    const { to } = await trip(t, "", { sub: "g-noinvite", email, name: "G I" });
    expect(to).toBe("/login?problem=google_no_account");
    expect((await t.server.people.get(old.id))!.email).toBe(email);
  });

  it("does not break the blank-email login of an account from before emails were asked for", async () => {
    // The first account has no address yet: a blank email at login means it (stage 27c).
    const { hashPassword } = await import("../src/auth/password.js");
    const only = await makeTestApp(env({ MAIL_TEST_TRANSPORT: "memory" }));
    try {
      const first = (await only.server.people.all())[0]!;
      await only.server.people.update(first.id, (p) => ({ ...p, email: "" }));
      const o = await addPerson(only, "Owen", "owen@example.com");
      const sl = (await only.server.projects.all())[0]!;
      await addMember(only, sl.id, o.id, "owner");
      const email = "legacy.rule@example.org";
      const victim = await only.server.people.create({
        name: "Typed",
        email,
        passwordHash: await hashPassword(PASSWORD),
        passkeys: [key()],
      });
      const link = (await o.post(`/api/p/${sl.slug}/invites`, { role: "writer" })).json();
      await trip(only, `invite=${link.code}`, { sub: "g-legacy", email, name: "G Legacy" });
      expect((await only.server.people.get(victim.id))!.emailDisplaced).toBe(true);
      // Two accounts now have no address, but only one of them is "the account with none".
      const session = (await only.app.inject({ method: "GET", url: "/api/session" })).json();
      expect(session.emailless).toBe(true);
      expect((await only.login(PASSWORD, "")).statusCode).toBe(200);
      expect((await only.get("/api/me")).json().id).toBe(first.id);
      // The displaced account is not reachable by a blank email, with its own password.
      const blank = await only.app.inject({
        method: "POST",
        url: "/api/login",
        payload: { email: "", password: PASSWORD },
      });
      expect(
        (
          await only.app.inject({
            method: "GET",
            url: "/api/me",
            headers: { cookie: cookieOf(blank) },
          })
        ).json().id,
      ).toBe(first.id);
    } finally {
      await only.close();
    }
  });

  it("is all or nothing: when joining fails, the other account has its address back", async () => {
    const email = "rollback@example.org";
    const old = await typed(t, email, { passkeys: [key()] });
    const link = await invite(t, owner);
    const spy = vi
      .spyOn(t.server.projects, "addMember")
      .mockRejectedValueOnce(new Error("disk full"));
    try {
      // The failure is the server's, not the person's: no redirect, and everything is put back.
      const { res } = await trip(t, `invite=${link.code}`, {
        sub: "g-rollback",
        email,
        name: "G R",
      });
      expect(res.statusCode).toBe(500);
    } finally {
      spy.mockRestore();
    }
    const back = (await t.server.people.get(old.id))!;
    expect(back.email).toBe(email);
    expect(back.emailDisplaced).toBe(false);
    expect(
      (await t.server.people.all()).some((p) => p.identities[0]?.subject === "g-rollback"),
    ).toBe(false);
    // The link was given back, and works.
    expect((await t.app.inject({ method: "GET", url: `/api/join/${link.code}` })).statusCode).toBe(
      200,
    );
  });

  it("the displaced account adds another address like anyone with none, and is no longer displaced", async () => {
    const email = "shared.three@example.org";
    const { hashPassword } = await import("../src/auth/password.js");
    const old = await typed(t, email, {
      passkeys: [key()],
      passwordHash: await hashPassword(PASSWORD),
    });
    const cookie = cookieOf(
      await t.app.inject({
        method: "POST",
        url: "/api/login",
        payload: { email, password: PASSWORD },
      }),
    );
    const link = await invite(t, owner);
    await trip(t, `invite=${link.code}`, { sub: "g-shared-3", email, name: "G Three" });
    await clearMail(t);
    const res = await t.app.inject({
      method: "PUT",
      url: "/api/me",
      headers: { cookie },
      payload: { name: "Typed Address", email: "replacement@example.org" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().emailInfo).toMatchObject({ needsAddress: false, status: "unconfirmed" });
    expect((await t.server.people.get(old.id))!.emailDisplaced).toBe(false);
    expect((await outbox(t)).map((m) => m.to)).toEqual(["replacement@example.org"]);
  });
});

describe("Google verifies an address", () => {
  it("linking Google from Settings with the account's own address confirms it", async () => {
    const email = "link.same@example.org";
    const { hashPassword } = await import("../src/auth/password.js");
    await typed(t, email, { passwordHash: await hashPassword(PASSWORD) });
    const login = await t.app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email, password: PASSWORD },
    });
    const { to } = await trip(
      t,
      "link=1",
      { sub: "g-link-same", email, name: "G" },
      cookieOf(login),
    );
    expect(to).toBe("/settings/you/signing-in");
    const p = (await t.server.people.byEmail(email))!;
    expect(p.emailConfirmedBy).toBe("google");
  });

  it("linking Google with another address leaves the address as it was", async () => {
    const email = "link.other@example.org";
    const { hashPassword } = await import("../src/auth/password.js");
    await typed(t, email, { passwordHash: await hashPassword(PASSWORD) });
    const login = await t.app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email, password: PASSWORD },
    });
    await trip(
      t,
      "link=1",
      { sub: "g-link-other", email: "different@example.org", name: "G" },
      cookieOf(login),
    );
    expect((await t.server.people.byEmail(email))!.emailConfirmedAt).toBeNull();
  });
});

describe("with no mail relay", () => {
  it("a Google-verified person never takes an address from anyone: it is account_exists as before", async () => {
    const email = "off.shared@example.org";
    const old = await off.server.people.create({ name: "Typed", email, passkeys: [key()] });
    const link = await invite(off, null);
    const { to } = await trip(off, `invite=${link.code}`, { sub: "g-off", email, name: "G O" });
    expect(to).toBe(`/join/${link.code}?problem=account_exists`);
    expect((await off.server.people.get(old.id))!.email).toBe(email);
    expect((await off.server.people.get(old.id))!.emailDisplaced).toBe(false);
  });
});
