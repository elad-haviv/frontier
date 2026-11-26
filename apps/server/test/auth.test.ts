import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { validSignature } from "../src/routes/webhook.js";
import { EMAIL, makeTestApp, NAME, PASSWORD, type TestApp } from "./helpers/app.js";

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp({ WEBHOOK_SECRET: "hook-secret" });
});
afterEach(() => t.close());

describe("passwords", () => {
  it("verifies the right password only, and survives a damaged hash", async () => {
    const hash = await hashPassword("a long enough password");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "a long enough password")).toBe(true);
    expect(await verifyPassword(hash, "another password")).toBe(false);
    expect(await verifyPassword("not a hash", "anything")).toBe(false);
  });
});

describe("session", () => {
  it("refuses every API route without a session", async () => {
    for (const url of [
      "/api/tree",
      "/api/entries?path=README.md",
      "/api/status",
      "/api/attention",
      "/api/status/events",
    ]) {
      const res = await t.get(url);
      expect(res.statusCode, url).toBe(401);
      expect(res.json().error.code).toBe("unauthenticated");
    }
    expect((await t.post("/api/logout")).statusCode).toBe(401);
  });

  it("answers the open routes without a session", async () => {
    expect((await t.get("/api/session")).json()).toMatchObject({ loggedIn: false });
    expect((await t.get("/health")).statusCode).toBe(200);
  });

  it("logs in with the right password and out again", async () => {
    const wrong = await t.login("wrong password");
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe("Wrong email or password.");
    expect(t.cookie).toBe("");

    const ok = await t.login();
    expect(ok.json()).toEqual({ ok: true });
    const cookie = String(ok.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect((await t.get("/api/session")).json()).toMatchObject({ loggedIn: true });
    expect((await t.get("/api/tree")).statusCode).toBe(200);

    const out = await t.post("/api/logout");
    expect(out.statusCode).toBe(200);
    const cleared = String(out.headers["set-cookie"]).split(";")[0]!;
    t.cookie = cleared;
    expect((await t.get("/api/tree")).statusCode).toBe(401);
  });

  it("says the same for a wrong email as for a wrong password", async () => {
    const wrongEmail = await t.login(PASSWORD, "someone@example.com");
    const wrongPassword = await t.login("not the password");
    expect(wrongEmail.statusCode).toBe(401);
    expect(wrongEmail.json()).toEqual(wrongPassword.json());
    // An empty email matches only an account that has none.
    expect((await t.login(PASSWORD, "")).statusCode).toBe(401);
  });

  it("takes the email in any case and with spaces around it", async () => {
    expect((await t.login(PASSWORD, `  ${EMAIL.toUpperCase()} `)).statusCode).toBe(200);
  });

  it("treats a session from before accounts, which said author, as logged out", async () => {
    const old = t.app.createSecureSession({ user: "author", method: "password" });
    t.cookie = `frontier_session=${encodeURIComponent(t.app.encodeSecureSession(old))}`;
    const res = await t.get("/api/tree");
    expect(res.statusCode).toBe(401);
    expect((await t.get("/api/session")).json()).toMatchObject({ loggedIn: false, person: null });
    // Logging in again makes it a session of the person.
    await t.login();
    expect((await t.get("/api/session")).json()).toMatchObject({
      loggedIn: true,
      person: { name: NAME, email: EMAIL },
    });
  });

  it("ends the session of a person who is no longer there", async () => {
    await t.login();
    const [person] = await t.services.people.all();
    await t.services.files.remove(`${t.services.config.dataDir}/state/people.json`);
    await t.services.people.create({ name: "Someone else", email: "else@example.com" });
    expect(person!.id).not.toBe((await t.services.people.all())[0]!.id);
    expect((await t.get("/api/tree")).statusCode).toBe(401);
  });

  it("rejects a tampered cookie", async () => {
    await t.login();
    t.cookie = t.cookie.slice(0, -6) + "AAAAAA";
    expect((await t.get("/api/tree")).statusCode).toBe(401);
  });

  it("refuses a login with no password set, and a malformed body", async () => {
    await t.services.files.remove(`${t.services.config.dataDir}/state/people.json`);
    const none = await t.login();
    expect(none.statusCode).toBe(401);
    expect(none.json().error.message).toMatch(/No account has been made/);
    const bad = await t.post("/api/login", { pass: "x" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("invalid");
    const notJson = await t.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(notJson.statusCode).toBe(400);
  });

  it("refuses the sixth login attempt within 15 minutes", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await t.login("wrong password")).statusCode);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
    const sixth = await t.login();
    expect(sixth.json().error.code).toBe("rate_limited");
  });

  it("sets the security headers on every reply", async () => {
    const res = await t.get("/health");
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("answers an unknown address with not_found", async () => {
    await t.login();
    const res = await t.get("/api/nothing-here");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });
});

describe("webhook", () => {
  const sign = (body: string, secret = "hook-secret") =>
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const send = (body: string, headers: Record<string, string>) =>
    t.app.inject({
      method: "POST",
      url: "/api/github/webhook",
      headers: { "content-type": "application/json", ...headers },
      payload: body,
    });

  it("checks signatures", () => {
    const body = Buffer.from("{}");
    expect(validSignature("s", body, sign("{}", "s"))).toBe(true);
    expect(validSignature("s", body, sign("{}", "other"))).toBe(false);
    expect(validSignature("s", body, "sha256=abcd")).toBe(false);
    expect(validSignature("s", body, "sha1=abcd")).toBe(false);
    expect(validSignature("s", body, undefined)).toBe(false);
  });

  it("rejects a missing or wrong signature", async () => {
    const body = JSON.stringify({ ref: "refs/heads/main" });
    expect((await send(body, { "x-github-event": "push" })).statusCode).toBe(401);
    expect(
      (await send(body, { "x-github-event": "push", "x-hub-signature-256": sign(body, "wrong") }))
        .statusCode,
    ).toBe(401);
    expect((await send("", { "x-github-event": "push" })).statusCode).toBe(401);
  });

  it("fetches and reindexes on a valid push to main", async () => {
    const commit = t.repo.pushFromOutside({
      "02 People/New Person.md": "# New Person\n\nKnows [[Mira]].\n",
    });
    expect(t.services.index.note("02 People/New Person.md")).toBeUndefined();
    const body = JSON.stringify({ ref: "refs/heads/main" });
    const res = await send(body, { "x-github-event": "push", "x-hub-signature-256": sign(body) });
    expect(res.json()).toEqual({ ok: true });
    expect(t.services.index.commit).toBe(commit);
    expect(t.services.index.note("02 People/New Person.md")?.title).toBe("New Person");
    expect(t.services.index.backlinks("02 People/Mira.md").map((b) => b.path)).toContain(
      "02 People/New Person.md",
    );
  });

  it("ignores a push to another branch and other events", async () => {
    t.repo.pushFromOutside({ "x.md": "# X\n" });
    const before = t.services.index.commit;
    const branch = JSON.stringify({ ref: "refs/heads/proposal/agent/topic" });
    expect(
      (await send(branch, { "x-github-event": "push", "x-hub-signature-256": sign(branch) }))
        .statusCode,
    ).toBe(200);
    const ping = JSON.stringify({ zen: "hello" });
    expect(
      (await send(ping, { "x-github-event": "ping", "x-hub-signature-256": sign(ping) }))
        .statusCode,
    ).toBe(200);
    expect(t.services.index.commit).toBe(before);
  });

  it("does not exist when no secret is configured", async () => {
    const local = await makeTestApp();
    try {
      const res = await local.app.inject({
        method: "POST",
        url: "/api/github/webhook",
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await local.close();
    }
  });
});
