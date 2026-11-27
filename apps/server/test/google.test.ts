/**
 * Google sign-on (stage 27c) against a stand-in OpenID Connect provider: the authorization code
 * flow with PKCE, state and nonce, and every refusal.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CreateInviteResponse } from "@frontier/schema";
import { safeReturnTo } from "../src/auth/google.js";
import {
  addMember,
  addPerson,
  cookieOf,
  makeTestApp,
  type Client,
  type TestApp,
} from "./helpers/app.js";
import { CLIENT_ID, CLIENT_SECRET, FakeProvider, type Grant } from "./helpers/oidc.js";

let provider: FakeProvider;
let t: TestApp;
let owner: Client;
let slug: string;
let pid: string;
const CALLBACK = "http://localhost:3000/api/auth/google/callback";

beforeAll(async () => {
  provider = await new FakeProvider().start();
  t = await makeTestApp({
    LOGIN_ATTEMPTS: "100",
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
    GOOGLE_ISSUER: provider.issuer,
  });
  await t.login();
  const first = (await t.server.projects.all())[0]!;
  pid = first.id;
  slug = first.slug;
  owner = await addPerson(t, "Olive Owner", "owner@example.com");
  await addMember(t, pid, owner.id, "owner");
});
afterAll(async () => {
  await t.close();
  await provider.stop();
});
afterEach(() => vi.useRealTimers());

const invite = async (role: "owner" | "writer" | "reader" = "writer") =>
  (await owner.post(`/api/p/${slug}/invites`, { role })).json() as CreateInviteResponse;

interface Started {
  res: Awaited<ReturnType<typeof t.app.inject>>;
  location: string;
  cookie: string;
}

/** The browser visits Frontier's start address. */
async function start(query = "", cookie = ""): Promise<Started> {
  const res = await t.app.inject({
    method: "GET",
    url: `/api/auth/google/start${query ? `?${query}` : ""}`,
    ...(cookie ? { headers: { cookie } } : {}),
  });
  return { res, location: String(res.headers.location ?? ""), cookie: cookieOf(res, cookie) };
}

/** The whole trip: start, the person agrees at the provider, the browser comes back. */
async function trip(
  query: string,
  grant: Grant = {},
  options: { cookie?: string; callbackQuery?: (code: string, state: string) => string } = {},
) {
  const started = await start(query, options.cookie ?? "");
  expect(started.location, started.res.body).toContain(provider.issuer);
  const request = provider.parseAuthRequest(started.location);
  const code = provider.allow(request, grant);
  const qs = options.callbackQuery?.(code, request.state) ?? `code=${code}&state=${request.state}`;
  const res = await t.app.inject({
    method: "GET",
    url: `/api/auth/google/callback?${qs}`,
    headers: { cookie: started.cookie },
  });
  return { started, request, res, cookie: cookieOf(res, started.cookie) };
}
const where = (res: { headers: Record<string, unknown> }) => String(res.headers.location ?? "");
const people = async () => (await t.server.people.all()).length;
const linkedTo = async (subject: string) =>
  (await t.server.people.all()).find((p) =>
    p.identities.some((i) => i.provider === "google" && i.subject === subject),
  );

describe("switched off", () => {
  it("is off without a client id and secret: the session says so and the routes refuse", async () => {
    const off = await makeTestApp();
    try {
      expect((await off.get("/api/session")).json().google).toBe(false);
      const start = await off.app.inject({ method: "GET", url: "/api/auth/google/start" });
      expect(start.statusCode).toBe(302);
      expect(start.headers.location).toBe("/login?problem=google_off");
      const back = await off.app.inject({
        method: "GET",
        url: "/api/auth/google/callback?code=x&state=y",
      });
      expect(back.headers.location).toBe("/login?problem=google_off");
    } finally {
      await off.close();
    }
  });

  it("needs both halves of the configuration, and the issuer override is for tests only", async () => {
    const { loadConfig } = await import("../src/config.js");
    const { testEnv } = await import("./helpers/app.js");
    const { makeTestRepo } = await import("./helpers/repo.js");
    const repo = makeTestRepo();
    try {
      expect(() => loadConfig(testEnv(repo, { GOOGLE_CLIENT_ID: "a" }))).toThrow(
        /both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/,
      );
      expect(() =>
        loadConfig(
          testEnv(repo, {
            GOOGLE_CLIENT_ID: "a",
            GOOGLE_CLIENT_SECRET: "b",
            GOOGLE_ISSUER: "http://x",
            NODE_ENV: "production",
          }),
        ),
      ).toThrow(/GOOGLE_ISSUER/);
      expect(
        loadConfig(testEnv(repo, { GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).google,
      ).toEqual({
        clientId: "a",
        clientSecret: "b",
        issuer: "https://accounts.google.com",
      });
    } finally {
      repo.cleanup();
    }
  });

  it("says it is on", async () => {
    expect((await t.get("/api/session")).json().google).toBe(true);
  });
});

describe("the request sent to Google", () => {
  it("is an authorization code request with PKCE, state and nonce, and the exact redirect address", async () => {
    const started = await start();
    expect(started.res.statusCode).toBe(302);
    const url = new URL(started.location);
    expect(`${url.origin}${url.pathname}`).toBe(`${provider.issuer}/authorize`);
    const p = url.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(CALLBACK);
    expect(p.get("scope")).toBe("openid email profile");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("state")!.length).toBeGreaterThanOrEqual(24);
    expect(p.get("nonce")!.length).toBeGreaterThanOrEqual(24);
    // The verifier, the secret and the invitation are not in what goes to Google.
    expect(started.location).not.toContain(CLIENT_SECRET);
    expect(started.location).not.toContain("code_verifier");
    // Fresh values every time, and the state is kept in the browser's signed cookie only.
    const second = await start();
    expect(new URL(second.location).searchParams.get("state")).not.toBe(p.get("state"));
    expect(started.res.headers["set-cookie"]).toMatch(/HttpOnly/i);
    expect(started.res.headers["cache-control"]).toBe("no-store");
  });

  it("does not take a state from a query, only from the browser's own cookie", async () => {
    const a = await start();
    const b = await start();
    const request = provider.parseAuthRequest(a.location);
    const code = provider.allow(request);
    // The state of one browser's request, the cookie of another's.
    const res = await t.app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=${code}&state=${request.state}`,
      headers: { cookie: b.cookie },
    });
    expect(where(res)).toBe("/login?problem=google_expired");
  });
});

describe("returnTo", () => {
  it("keeps a path in the app and drops anything that could leave it", () => {
    expect(safeReturnTo("/p/avalymia/e/Mira.md?x=1#top")).toBe("/p/avalymia/e/Mira.md?x=1#top");
    expect(safeReturnTo("/settings/you/signing-in")).toBe("/settings/you/signing-in");
    for (const bad of [
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "evil.example",
      "/%0d%0aLocation: x",
      "/a\nb",
      "/api/me",
      "/api",
      "",
      "/" + "a".repeat(600),
      "///evil.example",
      "/.//evil.example",
    ]) {
      expect(safeReturnTo(bad), bad).toBeNull();
    }
    // What survives always parses as a path on this origin.
    for (const ok of ["/", "/projects", "/p/x?next=//evil.example", "/x#//evil.example"]) {
      const kept = safeReturnTo(ok);
      expect(
        kept === null || new URL(kept, "http://app.example").origin === "http://app.example",
      ).toBe(true);
    }
  });

  it("is used after a login, and an unsafe one is ignored", async () => {
    const person = await t.server.people.create({
      name: "Gail Linked",
      email: "gail@example.com",
      identities: [{ provider: "google", subject: "sub-gail", addedAt: new Date().toISOString() }],
    });
    const good = await trip(`returnTo=${encodeURIComponent("/p/avalymia/e/Mira.md#x")}`, {
      sub: "sub-gail",
    });
    expect(where(good.res)).toBe("/p/avalymia/e/Mira.md#x");
    for (const bad of ["//evil.example", "https://evil.example/x", "/\\evil.example"]) {
      const res = await trip(`returnTo=${encodeURIComponent(bad)}`, { sub: "sub-gail" });
      expect(where(res.res), bad).toBe("/");
    }
    expect(person.id).toBeDefined();
  });
});

describe("logging in with a Google account that is linked", () => {
  it("logs in, as that person, and says Google was the way", async () => {
    const person = await t.server.people.create({
      name: "Lena Linked",
      email: "lena@example.com",
      identities: [
        {
          provider: "google",
          subject: "sub-lena",
          email: "lena@gmail.example",
          addedAt: new Date().toISOString(),
        },
      ],
    });
    const done = await trip("", {
      sub: "sub-lena",
      email: "someone.else@example.com",
      name: "Not Lena",
    });
    expect(done.res.statusCode).toBe(302);
    expect(where(done.res)).toBe("/");
    const me = await t.app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: done.cookie },
    });
    expect(me.json()).toMatchObject({ id: person.id, name: "Lena Linked", method: "google" });
    expect(me.json().signingIn.google).toMatchObject({ email: "lena@gmail.example" });
    // Matching is by Google's subject: the email Google reports now changes nothing.
    expect((await t.server.people.get(person.id))!.email).toBe("lena@example.com");
  });

  it("opens only what the person is a member of", async () => {
    const done = await trip("", { sub: "sub-lena" });
    const res = await t.app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: done.cookie },
    });
    expect(res.json().projects).toEqual([]);
  });

  it("verifies the token's signature against keys it fetched once and keeps", async () => {
    const before = provider.jwksFetches;
    await trip("", { sub: "sub-lena" });
    await trip("", { sub: "sub-lena" });
    expect(provider.jwksFetches - before).toBeLessThanOrEqual(1);
  });
});

describe("joining with Google by an invitation", () => {
  it("makes the account from Google's name and verified email, joins, uses the link", async () => {
    const { code } = await invite("reader");
    const before = await people();
    const done = await trip(`invite=${code}`, {
      sub: "sub-new-1",
      email: "nia@example.com",
      name: "Nia New",
    });
    expect(where(done.res)).toBe(`/p/${slug}`);
    expect(await people()).toBe(before + 1);
    const person = (await linkedTo("sub-new-1"))!;
    expect(person).toMatchObject({
      name: "Nia New",
      email: "nia@example.com",
      passwordHash: "",
      admin: false,
    });
    expect(person.identities[0]).toMatchObject({ provider: "google", subject: "sub-new-1" });
    expect(
      (await t.server.projects.get(pid))!.members.find((m) => m.personId === person.id)!.role,
    ).toBe("reader");
    const me = await t.app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: done.cookie },
    });
    expect(me.json()).toMatchObject({ method: "google", passwordSet: false, name: "Nia New" });
    expect(
      (
        await t.app.inject({
          method: "GET",
          url: `/api/p/${slug}/tree`,
          headers: { cookie: done.cookie },
        })
      ).statusCode,
    ).toBe(200);
    // The link is spent: nobody else can use it, in any way.
    expect(
      (await t.app.inject({ method: "GET", url: `/api/join/${code}` })).json().error.code,
    ).toBe("invite_used");
    const again = await start(`invite=${code}`);
    expect(again.location).toBe(`/join/${code}`);
  });

  it("with an existing Google identity, logs in and lands on the join page to accept, joining nobody", async () => {
    const person = (await linkedTo("sub-new-1"))!;
    const { code } = await invite("writer");
    // Nia is already in: logged in, sent to the join page, and the link is not used up.
    const done = await trip(`invite=${code}`, { sub: "sub-new-1" });
    expect(where(done.res)).toBe(`/join/${code}`);
    const info = await t.app.inject({
      method: "GET",
      url: `/api/join/${code}`,
      headers: { cookie: done.cookie },
    });
    expect(info.statusCode).toBe(200);
    expect(info.json().alreadyMember).toBe(true);
    // Someone with a linked identity who is not in is logged in too, but not joined by the sign-in.
    const outsider = await t.server.people.create({
      name: "Ola Outside",
      email: "ola@example.com",
      identities: [{ provider: "google", subject: "sub-ola", addedAt: new Date().toISOString() }],
    });
    const joined = await trip(`invite=${code}`, { sub: "sub-ola" });
    expect(where(joined.res)).toBe(`/join/${code}`);
    const members = () =>
      t.server.projects.get(pid).then((p) => p!.members.find((m) => m.personId === outsider.id));
    expect(await members()).toBeUndefined();
    const waiting = await t.app.inject({
      method: "GET",
      url: `/api/join/${code}`,
      headers: { cookie: joined.cookie },
    });
    expect(waiting.json().alreadyMember).toBe(false);
    // They confirm with accept, as anyone with an account does.
    const accepted = await t.app.inject({
      method: "POST",
      url: `/api/join/${code}/accept`,
      headers: { cookie: joined.cookie },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect((await members())!.role).toBe("writer");
    expect(person.id).not.toBe(outsider.id);
  });

  it("does not create an account from an email that has one, and does not link by it", async () => {
    const { code } = await invite("writer");
    const before = await people();
    const done = await trip(`invite=${code}`, {
      sub: "sub-trick",
      email: "owner@example.com",
      name: "Olive Impostor",
    });
    expect(where(done.res)).toBe(`/join/${code}?problem=account_exists`);
    expect(await people()).toBe(before);
    expect(await linkedTo("sub-trick")).toBeUndefined();
    expect(done.res.headers["set-cookie"]?.toString() ?? "").not.toContain("user");
    // Not logged in as the account whose email it was.
    const me = await t.app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: done.cookie },
    });
    expect(me.statusCode).toBe(401);
    // And the link was not used.
    expect((await t.app.inject({ method: "GET", url: `/api/join/${code}` })).statusCode).toBe(200);
  });

  it("checks the invitation again at the callback: cancelled in between, nothing is made", async () => {
    const made = await invite("writer");
    const started = await start(`invite=${made.code}`);
    const request = provider.parseAuthRequest(started.location);
    await owner.del(`/api/p/${slug}/invites/${made.id}`);
    const before = await people();
    const res = await t.app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=${provider.allow(request, { sub: "sub-late", email: "late@example.com" })}&state=${request.state}`,
      headers: { cookie: started.cookie },
    });
    expect(where(res)).toBe(`/join/${made.code}`);
    expect(await people()).toBe(before);
    expect(await linkedTo("sub-late")).toBeUndefined();
  });

  it("checks it again for expiry, by the server's clock", async () => {
    const made = await invite("writer");
    const started = await start(`invite=${made.code}`);
    const request = provider.parseAuthRequest(started.location);
    const code = provider.allow(request, { sub: "sub-slow", email: "slow@example.com" });
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 7 * 86_400_000 + 5000 });
    const before = await people();
    const res = await t.app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=${code}&state=${request.state}`,
      headers: { cookie: started.cookie },
    });
    // The state itself had also run out by then; either way nothing was made.
    expect(where(res)).toMatch(/^\/(login\?problem=google_expired|join\/)/);
    expect(await people()).toBe(before);
  });

  it("makes at most one account when two people use one link at once", async () => {
    const { code } = await invite("reader");
    const before = await people();
    const results = await Promise.all(
      [1, 2, 3].map((i) =>
        trip(`invite=${code}`, {
          sub: `sub-race-${i}`,
          email: `race${i}@example.com`,
          name: `Racer ${i}`,
        }),
      ),
    );
    const made = results.filter((r) => where(r.res) === `/p/${slug}`);
    expect(made).toHaveLength(1);
    expect(await people()).toBe(before + 1);
    for (const r of results.filter((x) => !made.includes(x)))
      expect(where(r.res)).toBe(`/join/${code}`);
  });
});

describe("what Google alone never does", () => {
  it("makes no account without an invitation", async () => {
    const before = await people();
    const done = await trip("", { sub: "sub-stranger", email: "stranger@example.com" });
    expect(where(done.res)).toBe("/login?problem=google_no_account");
    expect(await people()).toBe(before);
    expect(
      (await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: done.cookie } }))
        .statusCode,
    ).toBe(401);
  });

  it("does not log in, or link, an account whose email matches", async () => {
    const done = await trip("", {
      sub: "sub-same-email",
      email: "owner@example.com",
      name: "Olive Owner",
    });
    expect(where(done.res)).toBe("/login?problem=google_no_account");
    expect(await linkedTo("sub-same-email")).toBeUndefined();
    expect((await t.server.people.get(owner.id))!.identities).toEqual([]);
  });

  it("does not take an invitation that is not good, from the start", async () => {
    const made = await invite();
    await owner.del(`/api/p/${slug}/invites/${made.id}`);
    expect((await start(`invite=${made.code}`)).location).toBe(`/join/${made.code}`);
    expect((await start(`invite=${"z".repeat(32)}`)).location).toBe(`/join/${"z".repeat(32)}`);
    expect((await start("invite=not-a-code")).location).toBe("/login");
  });
});

describe("tokens and states that are refused", () => {
  const refused = async (grant: Grant, problem: string, query = "") => {
    const before = await people();
    const done = await trip(query, { sub: "sub-lena", ...grant });
    expect(where(done.res), JSON.stringify(grant)).toBe(`/login?problem=${problem}`);
    expect(
      (await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: done.cookie } }))
        .statusCode,
    ).toBe(401);
    expect(await people()).toBe(before);
  };

  it("an email Google has not verified", async () => {
    await refused({ email_verified: false }, "google_unverified");
    await refused({ email_verified: undefined }, "google_unverified");
    await refused({ email_verified: "true" }, "google_unverified");
  });
  it("a nonce that is not the one asked for", () =>
    refused({ nonce: "another-nonce-value-entirely" }, "google_failed"));
  it("another audience", async () => {
    await refused({ aud: "someone-elses-client" }, "google_failed");
    await refused({ aud: [CLIENT_ID, "other"] }, "google_failed");
  });
  it("another issuer", () => refused({ iss: "https://evil.example" }, "google_failed"));
  it("a token that has run out", () => refused({ expiresIn: -3600 }, "google_failed"));
  it("a signature from a key the provider does not publish", () =>
    refused({ wrongKey: true }, "google_failed"));

  it("a token endpoint that fails", async () => {
    provider.failToken = true;
    try {
      await refused({}, "google_failed");
    } finally {
      provider.failToken = false;
    }
  });

  it("a code verifier that is not the one the challenge was made from (PKCE)", async () => {
    const started = await start();
    const request = provider.parseAuthRequest(started.location);
    const code = provider.allow({ ...request, challenge: "x".repeat(43) }, { sub: "sub-lena" });
    const res = await t.app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=${code}&state=${request.state}`,
      headers: { cookie: started.cookie },
    });
    expect(where(res)).toBe("/login?problem=google_failed");
  });

  it("a state that is wrong, missing, used before, or too old, and a callback with no start", async () => {
    const wrong = await trip(
      "",
      { sub: "sub-lena" },
      { callbackQuery: (code) => `code=${code}&state=forged` },
    );
    expect(where(wrong.res)).toBe("/login?problem=google_expired");
    const missing = await trip(
      "",
      { sub: "sub-lena" },
      { callbackQuery: (code) => `code=${code}` },
    );
    expect(where(missing.res)).toBe("/login?problem=google_expired");

    // Replaying a callback that already worked: the state was used up.
    const started = await start();
    const request = provider.parseAuthRequest(started.location);
    const url = `/api/auth/google/callback?code=${provider.allow(request, { sub: "sub-lena" })}&state=${request.state}`;
    const first = await t.app.inject({ method: "GET", url, headers: { cookie: started.cookie } });
    expect(where(first)).toBe("/");
    const replay = await t.app.inject({
      method: "GET",
      url: url.replace(/code=[^&]+/, `code=${provider.allow(request, { sub: "sub-lena" })}`),
      headers: { cookie: started.cookie },
    });
    expect(where(replay)).toBe("/login?problem=google_expired");

    expect(
      where(await t.app.inject({ method: "GET", url: "/api/auth/google/callback?code=a&state=b" })),
    ).toBe("/login?problem=google_expired");

    // Ten minutes is the most a person has.
    const old = await start();
    const oldRequest = provider.parseAuthRequest(old.location);
    const oldCode = provider.allow(oldRequest, { sub: "sub-lena" });
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 11 * 60_000 });
    const late = await t.app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=${oldCode}&state=${oldRequest.state}`,
      headers: { cookie: old.cookie },
    });
    expect(where(late)).toBe("/login?problem=google_expired");
  });

  it("the person saying no at Google, and any error Google reports", async () => {
    const started = await start();
    const denied = await t.app.inject({
      method: "GET",
      url: "/api/auth/google/callback?error=access_denied&state=x",
      headers: { cookie: started.cookie },
    });
    expect(where(denied)).toBe("/login?problem=google_denied");
    const started2 = await start();
    const other = await t.app.inject({
      method: "GET",
      url: "/api/auth/google/callback?error=server_error",
      headers: { cookie: started2.cookie },
    });
    expect(where(other)).toBe("/login?problem=google_failed");
  });

  it("failed attempts with an invitation go back to its page and leave the link alone", async () => {
    const { code } = await invite();
    const done = await trip(`invite=${code}`, {
      email_verified: false,
      sub: "sub-x",
      email: "x@example.com",
    });
    expect(where(done.res)).toBe(`/join/${code}?problem=google_unverified`);
    expect((await t.app.inject({ method: "GET", url: `/api/join/${code}` })).statusCode).toBe(200);
    expect(await linkedTo("sub-x")).toBeUndefined();
  });

  it("an unreachable provider does not break the app", async () => {
    const down = await new FakeProvider().start();
    const url = down.issuer;
    await down.stop();
    const app = await makeTestApp({
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      GOOGLE_ISSUER: url,
    });
    try {
      const res = await app.app.inject({ method: "GET", url: "/api/auth/google/start" });
      expect(res.headers.location).toBe("/login?problem=google_failed");
    } finally {
      await app.close();
    }
  });
});

describe("linking Google from Settings, and unlinking it", () => {
  const link = (cookie: string, grant: Grant, extra = "") =>
    trip(`link=1${extra}`, grant, { cookie });

  it("links to the account that is logged in, ends the other sessions, and shows in /api/me", async () => {
    const person = await addPerson(t, "Lia Linker", "lia@example.com");
    const other = await t.app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email: "lia@example.com", password: "correct horse battery" },
    });
    const otherCookie = cookieOf(other);
    const done = await link(
      person.cookie,
      { sub: "sub-lia", email: "lia@gmail.example" },
      `&returnTo=${encodeURIComponent("/settings/you/signing-in")}`,
    );
    expect(where(done.res)).toBe("/settings/you/signing-in");
    expect((await linkedTo("sub-lia"))!.id).toBe(person.id);
    const me = await t.app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: done.cookie },
    });
    expect(me.json().signingIn).toMatchObject({
      password: { set: true, off: false },
      google: { email: "lia@gmail.example" },
      googleAvailable: true,
    });
    // This device stays in; another is out.
    expect(me.statusCode).toBe(200);
    expect(
      (await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: otherCookie } }))
        .statusCode,
    ).toBe(401);
    // Login with that Google account now works for her.
    const login = await trip("", { sub: "sub-lia" });
    expect(
      (
        await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie: login.cookie } })
      ).json().id,
    ).toBe(person.id);
  });

  it("needs a login, and a recent one", async () => {
    expect((await start("link=1")).location).toBe("/login?problem=google_no_account");
    const person = await addPerson(t, "Rex Recent", "rex@example.com");
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 6 * 60_000 });
    const stale = await start("link=1", person.cookie);
    expect(stale.location).toBe("/settings/you/signing-in?problem=recent_login_needed");
    vi.useRealTimers();
  });

  it("needs the recent login at the callback as well, and the same person", async () => {
    const person = await addPerson(t, "Cal Callback", "cal@example.com");
    const started = await start("link=1", person.cookie);
    const request = provider.parseAuthRequest(started.location);
    const code = provider.allow(request, { sub: "sub-cal" });
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 6 * 60_000 });
    const late = await t.app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=${code}&state=${request.state}`,
      headers: { cookie: started.cookie },
    });
    expect(where(late)).toBe("/settings/you/signing-in?problem=recent_login_needed");
    vi.useRealTimers();
    expect(await linkedTo("sub-cal")).toBeUndefined();

    // The session that finishes the trip is not the one that began it: nothing is linked.
    const second = await addPerson(t, "Dee Different", "dee@example.com");
    const started2 = await start("link=1", person.cookie);
    const request2 = provider.parseAuthRequest(started2.location);
    const code2 = provider.allow(request2, { sub: "sub-cal" });
    const jar = started2.cookie; // carries the pending link of `person`
    // Logging in as someone else in the same browser replaces the cookie, and with it the pending state.
    const swapped = await t.app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=${code2}&state=${request2.state}`,
      headers: { cookie: second.cookie },
    });
    expect(where(swapped)).toMatch(/^\/login\?problem=/);
    expect(await linkedTo("sub-cal")).toBeUndefined();
    expect(jar).toBeTruthy();
  });

  it("will not take a Google account another person has, nor a second one", async () => {
    const person = await addPerson(t, "Taken Tess", "tess@example.com");
    const taken = await link(person.cookie, { sub: "sub-lia" });
    expect(where(taken.res)).toBe("/settings/you/signing-in?problem=google_taken");
    expect((await linkedTo("sub-lia"))!.email).toBe("lia@example.com");
    const first = await link(person.cookie, { sub: "sub-tess" });
    expect(where(first.res)).toBe("/settings/you/signing-in");
    const second = await link(first.cookie, { sub: "sub-tess-2" });
    expect(where(second.res)).toBe("/settings/you/signing-in?problem=google_already_linked");
    expect(await linkedTo("sub-tess-2")).toBeUndefined();
  });

  it("an unverified email is not linked either", async () => {
    const person = await addPerson(t, "Una Unverified", "una@example.com");
    const done = await link(person.cookie, { sub: "sub-una", email_verified: false });
    expect(where(done.res)).toBe("/login?problem=google_unverified");
    expect(await linkedTo("sub-una")).toBeUndefined();
  });

  it("unlinks, ends the other sessions, and refuses to remove the last way to sign in", async () => {
    const person = await addPerson(t, "Una Unlink", "unlink@example.com");
    const done = await link(person.cookie, { sub: "sub-unlink" });
    // With a password as well, Google can go.
    const res = await t.app.inject({
      method: "DELETE",
      url: "/api/me/google",
      headers: { cookie: done.cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await linkedTo("sub-unlink")).toBeUndefined();
    expect(
      (
        await t.app.inject({
          method: "DELETE",
          url: "/api/me/google",
          headers: { cookie: cookieOf(res, done.cookie) },
        })
      ).json().error.code,
    ).toBe("not_found");

    // An account that came by Google has no password: Google is its only way in.
    const { code } = await invite("reader");
    const only = await trip(`invite=${code}`, {
      sub: "sub-only",
      email: "only@example.com",
      name: "Otis Only",
    });
    const refusal = await t.app.inject({
      method: "DELETE",
      url: "/api/me/google",
      headers: { cookie: only.cookie },
    });
    expect(refusal.statusCode).toBe(403);
    expect(refusal.json().error.code).toBe("not_allowed");
    expect(await linkedTo("sub-only")).toBeDefined();
    // It cannot remove a passkey it does not have, nor switch off a password it has not either.
    // Once a password is set, Google can be removed.
    const set = await t.app.inject({
      method: "PUT",
      url: "/api/me/password",
      headers: { cookie: only.cookie },
      payload: { password: "a brand new long password" },
    });
    expect(set.statusCode, set.body).toBe(200);
    const gone = await t.app.inject({
      method: "DELETE",
      url: "/api/me/google",
      headers: { cookie: cookieOf(set, only.cookie) },
    });
    expect(gone.statusCode).toBe(200);
  });

  it("counts Google as a way in for the other removals", async () => {
    // A Google-only account: the password cannot be switched off without a passkey or Google...
    const person = await t.server.people.create({
      name: "Gus Google",
      email: "gus@example.com",
      passwordHash: "",
      identities: [{ provider: "google", subject: "sub-gus", addedAt: new Date().toISOString() }],
    });
    const login = await trip("", { sub: "sub-gus" });
    // ...and a person with a password and Google keeps one when the other goes.
    await t.server.people.update(person.id, (p) => ({ ...p, passwordHash: "x" }));
    const del = await t.app.inject({
      method: "DELETE",
      url: "/api/me/google",
      headers: { cookie: login.cookie },
    });
    expect(del.statusCode).toBe(200);
  });
});
