import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emailKey, initialsOf, MeResponse, type Person } from "@frontier/schema";
import { startAccounts } from "../src/auth/accounts.js";
import { LoginLimiter } from "../src/auth/limit.js";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { PeopleStore } from "../src/state/people.js";
import { StateFiles } from "../src/state/files.js";
import { SettingsStore } from "../src/state/settings.js";
import { EMAIL, makeTestApp, NAME, PASSWORD, seedAccount, type TestApp } from "./helpers/app.js";

describe("the people store", () => {
  let dir: string;
  let store: PeopleStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "frontier-people-"));
    store = new PeopleStore(dir, new StateFiles());
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("starts empty, makes the first account the admin and the next ones not", async () => {
    expect(await store.exists()).toBe(false);
    expect(await store.all()).toEqual([]);
    const first = await store.create({ name: "Elad", email: "Elad@Example.com" });
    const second = await store.create({ name: "Mira", email: "mira@example.com" });
    expect(first.admin).toBe(true);
    expect(second.admin).toBe(false);
    expect(first.id).not.toBe(second.id);
    expect(await store.exists()).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "people.json"), "utf8"))).toMatchObject({
      version: 1,
      people: [{ name: "Elad", passkeys: [], identities: [], passwordOff: false }, {}],
    });
  });

  it("finds a person by email in any case, and by passkey", async () => {
    const key = {
      id: "cred",
      publicKey: "k",
      counter: 0,
      transports: [],
      name: "Phone",
      addedAt: "2026-11-21T10:00:00Z",
    };
    const a = await store.create({ name: "A", email: "A@example.com", passkeys: [key] });
    await store.create({ name: "B", email: "b@example.com" });
    expect((await store.byEmail(" a@EXAMPLE.com "))?.id).toBe(a.id);
    expect(await store.byEmail("")).toBeNull();
    expect(await store.byEmail("nobody@example.com")).toBeNull();
    expect((await store.byPasskey("cred"))?.id).toBe(a.id);
    expect(await store.byPasskey("other")).toBeNull();
  });

  it("refuses an email another account uses, whatever its case, on create and on change", async () => {
    await store.create({ name: "A", email: "a@example.com" });
    const b = await store.create({ name: "B", email: "b@example.com" });
    await expect(store.create({ name: "C", email: "A@EXAMPLE.COM" })).rejects.toMatchObject({
      code: "email_taken",
    });
    await expect(
      store.update(b.id, (p) => ({ ...p, email: "a@Example.com" })),
    ).rejects.toMatchObject({ code: "email_taken" });
    // Its own email, in another case, is its own.
    expect((await store.update(b.id, (p) => ({ ...p, email: "B@example.com" }))).email).toBe(
      "B@example.com",
    );
    expect(await store.all()).toHaveLength(2);
  });

  it("keeps id and admin when a change tries to alter them, and refuses an unknown person", async () => {
    const a = await store.create({ name: "A" });
    const changed = await store.update(a.id, (p) => ({ ...p, id: "other", admin: false }));
    expect(changed).toMatchObject({ id: a.id, admin: true });
    await expect(store.update("nobody", (p) => p)).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("applies changes made at the same time one after another", async () => {
    const a = await store.create({ name: "A" });
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        store.update(a.id, (p) => ({ ...p, name: `${p.name}${i}` })),
      ),
    );
    expect((await store.get(a.id))!.name).toBe("A01234567");
    // A refused change does not stop the ones behind it.
    await expect(store.update("nobody", (p) => p)).rejects.toBeDefined();
    expect((await store.update(a.id, (p) => ({ ...p, name: "Z" }))).name).toBe("Z");
  });
});

describe("the move from author", () => {
  let dir: string;
  let people: PeopleStore;
  let settings: SettingsStore;
  const said: string[] = [];
  const start = (env: Record<string, string>) =>
    startAccounts({ people, settings, env, say: (m) => said.push(m) });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "frontier-move-"));
    const files = new StateFiles();
    people = new PeopleStore(dir, files);
    settings = new SettingsStore(dir, files);
    said.length = 0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const KEY = {
    id: "cred",
    publicKey: "k",
    counter: 3,
    transports: ["internal"],
    name: "Phone",
    addedAt: "2026-11-21T10:00:00Z",
  };
  const AUTHOR = { COMMIT_AUTHOR_NAME: "Elad", COMMIT_AUTHOR_EMAIL: "elad@example.com" };

  it("makes the first person from the old password and passkeys and leaves the settings alone", async () => {
    const hash = await hashPassword(PASSWORD);
    await settings.write({ passwordHash: hash, passkeys: [KEY], passwordOff: true });
    const before = readFileSync(join(dir, "settings.json"), "utf8");
    await start(AUTHOR);
    const [person, ...rest] = await people.all();
    expect(rest).toEqual([]);
    // The commit author's email is not taken as the account's: see `startAccounts`.
    expect(person).toMatchObject({
      name: "Elad",
      email: "",
      admin: true,
      passwordHash: hash,
      passwordOff: true,
      passkeys: [KEY],
    });
    // The old fields stay as they were; the file only gains the note that the move was made.
    expect(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"))).toEqual({
      ...JSON.parse(before),
      migratedToPeople: true,
    });
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/Moved the password and passkeys.*Elad.*no email yet/);
    // It runs once: a person made since is not overwritten.
    await people.update(person!.id, (p) => ({ ...p, name: "Changed" }));
    await start(AUTHOR);
    expect((await people.all())[0]!.name).toBe("Changed");
  });

  it("moves passkeys alone, and a password without a name or email", async () => {
    await settings.write({ passwordHash: "", passkeys: [KEY] });
    await start({});
    expect(await people.all()).toMatchObject([{ name: "", email: "", passkeys: [KEY] }]);
  });

  it("makes the first person from the initial password, name and email", async () => {
    await start({
      FRONTIER_INITIAL_PASSWORD: " a long enough password ",
      FRONTIER_INITIAL_EMAIL: "me@example.com",
      FRONTIER_INITIAL_NAME: "Me",
      ...AUTHOR,
    });
    const [person] = await people.all();
    expect(person).toMatchObject({ name: "Me", email: "me@example.com", admin: true });
    expect(await verifyPassword(person!.passwordHash, "a long enough password")).toBe(true);
    // The settings file exists for what else the server keeps there.
    expect(await settings.read()).not.toBeNull();
  });

  it("falls back to the commit author for the initial name and email", async () => {
    await start({ FRONTIER_INITIAL_PASSWORD: "a long enough password", ...AUTHOR });
    expect(await people.all()).toMatchObject([{ name: "Elad", email: "elad@example.com" }]);
  });

  it("does not take the stand-in author of a library with none configured as the person", async () => {
    await settings.write({ passwordHash: await hashPassword(PASSWORD) });
    await start({
      COMMIT_AUTHOR_NAME: "Author",
      COMMIT_AUTHOR_EMAIL: "author@frontier.invalid",
    });
    // No email yet, so the password alone logs in, and Settings → Profile asks for one.
    expect(await people.all()).toMatchObject([{ name: "", email: "" }]);
  });

  it("makes nobody when there is nothing to make one from", async () => {
    await start(AUTHOR);
    expect(await people.exists()).toBe(false);
    await settings.write({ passwordHash: "" });
    await start(AUTHOR);
    expect(await people.exists()).toBe(false);
  });

  it("does not use the initial password once there are accounts", async () => {
    await people.create({ name: "Old" });
    await start({ FRONTIER_INITIAL_PASSWORD: "a long enough password" });
    expect(await people.all()).toMatchObject([{ name: "Old", passwordHash: "" }]);
  });
});

describe("accounts in the server", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeTestApp();
  });
  afterEach(() => t.close());
  const me = async () => MeResponse.parse((await t.get("/api/me")).json());

  it("needs a login for the profile and says who is logged in", async () => {
    expect((await t.get("/api/me")).statusCode).toBe(401);
    await t.login();
    expect(await me()).toMatchObject({
      name: NAME,
      email: EMAIL,
      admin: true,
      needsProfile: false,
      passwordSet: true,
      passwordOff: false,
      passkeys: [],
      method: "password",
    });
    expect(JSON.stringify(await me())).not.toContain("argon2");
  });

  it("changes the name and email, and refuses ones that are not valid or are taken", async () => {
    await t.login();
    await t.services.server.people.create({ name: "Mira", email: "mira@example.com" });
    const ok = await t.put("/api/me", { name: " Elad Z ", email: "elad@new.example.com" });
    expect(ok.statusCode).toBe(200);
    expect(await me()).toMatchObject({ name: "Elad Z", email: "elad@new.example.com" });
    for (const bad of [
      { name: "", email: "a@b.co" },
      { name: "A", email: "not an email" },
      { name: "A", email: "" },
    ]) {
      expect((await t.put("/api/me", bad)).statusCode).toBe(400);
    }
    const taken = await t.put("/api/me", { name: "Elad", email: "MIRA@example.com" });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe("email_taken");
    // The login now takes the new email, and not the old one.
    t.cookie = "";
    expect((await t.login(PASSWORD, EMAIL)).statusCode).toBe(401);
    expect((await t.login(PASSWORD, "elad@new.example.com")).statusCode).toBe(200);
  });

  it("changes the password only with the current one, and sets one for an account without", async () => {
    await t.login();
    // Changing the password draws on the login allowance; this test makes more tries than that.
    t.services.server.loginLimit = new LoginLimiter(100);
    const short = await t.put("/api/me/password", { current: PASSWORD, password: "short" });
    expect(short.statusCode).toBe(400);
    const wrong = await t.put("/api/me/password", {
      current: "nope",
      password: "a new long password",
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.message).toMatch(/current password/);
    const missing = await t.put("/api/me/password", { password: "a new long password" });
    expect(missing.statusCode).toBe(400);
    const ok = await t.put("/api/me/password", {
      current: PASSWORD,
      password: "a new long password",
    });
    expect(ok.statusCode).toBe(200);
    t.cookie = "";
    expect((await t.login(PASSWORD)).statusCode).toBe(401);
    expect((await t.login("a new long password")).statusCode).toBe(200);

    // An account with no password sets one without a current password.
    const [person] = await t.services.server.people.all();
    await t.services.server.people.update(person!.id, (p) => ({
      ...p,
      passwordHash: "",
      passwordOff: true,
      passkeys: [],
    }));
    expect((await me()).passwordSet).toBe(false);
    expect(
      (await t.put("/api/me/password", { password: "another long password" })).statusCode,
    ).toBe(200);
    expect(await me()).toMatchObject({ passwordSet: true, passwordOff: false });
  });

  it("cannot switch the password off without a passkey, or on without a password", async () => {
    await t.login();
    const none = await t.put("/api/settings/password-off", { off: true });
    expect(none.statusCode).toBe(403);
    const [person] = await t.services.server.people.all();
    await t.services.server.people.update(person!.id, (p) => ({ ...p, passwordHash: "" }));
    const on = await t.put("/api/settings/password-off", { off: false });
    expect(on.statusCode).toBe(403);
    expect(on.json().error.message).toMatch(/no password/);
  });

  it("keeps the last way to log in: a passkey cannot go when there is no password", async () => {
    await t.login();
    const [person] = await t.services.server.people.all();
    const key = {
      id: "cred",
      publicKey: "k",
      counter: 0,
      transports: [],
      name: "Phone",
      addedAt: "2026-11-21T10:00:00Z",
    };
    await t.services.server.people.update(person!.id, (p) => ({
      ...p,
      passwordHash: "",
      passkeys: [key],
    }));
    const refused = await t.del("/api/passkeys/cred");
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toMatch(/only way to log in/);
    expect((await t.del("/api/passkeys/unknown")).statusCode).toBe(404);
    expect((await me()).passkeys).toHaveLength(1);
  });

  it("does not take a passkey that another account holds", async () => {
    const [mine] = await t.services.server.people.all();
    const other = await t.services.server.people.create({
      name: "Mira",
      email: "mira@example.com",
      passkeys: [
        {
          id: "cred",
          publicKey: "k",
          counter: 0,
          transports: [],
          name: "Hers",
          addedAt: "2026-11-21T10:00:00Z",
        },
      ],
    });
    expect((await t.services.server.people.byPasskey("cred"))?.id).toBe(other.id);
    expect(mine!.passkeys).toEqual([]);
    // Removing a passkey takes it from the logged-in person only: this one is not theirs.
    await t.login();
    expect((await t.del("/api/passkeys/cred")).statusCode).toBe(404);
    expect((await t.services.server.people.byPasskey("cred"))?.id).toBe(other.id);
  });

  it("registers a passkey for the logged-in person, under their own name", async () => {
    await t.login();
    const options = (await t.post("/api/passkeys/register/options")).json();
    expect(options.user.name).toBe(EMAIL);
    expect(options.user.displayName).toBe(NAME);
    const [person] = await t.services.server.people.all();
    expect(Buffer.from(options.user.id, "base64url").toString()).toBe(person!.id);
  });

  it("offers every person's passkeys at the passkey login", async () => {
    const key = (id: string) => ({
      id,
      publicKey: "k",
      counter: 0,
      transports: [],
      name: "Phone",
      addedAt: "2026-11-21T10:00:00Z",
    });
    const [mine] = await t.services.server.people.all();
    await t.services.server.people.update(mine!.id, (p) => ({ ...p, passkeys: [key("one")] }));
    await t.services.server.people.create({
      name: "Mira",
      email: "mira@example.com",
      passkeys: [key("two")],
    });
    const options = (await t.post("/api/passkeys/login/options")).json();
    expect(options.allowCredentials.map((c: { id: string }) => c.id).sort()).toEqual([
      "one",
      "two",
    ]);
    // A credential no one holds is refused the same way as a wrong one.
    const refused = await t.post("/api/passkeys/login/verify", { response: { id: "nobody" } });
    expect(refused.statusCode).toBe(401);
  });
});

describe("an account with no email yet", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeTestApp();
    await t.services.files.remove(`${t.services.config.dataDir}/state/people.json`);
    await seedAccount(t.services, PASSWORD, { email: "", name: "" });
  });
  afterEach(() => t.close());

  it("logs in with the password alone, and is asked for a name and email", async () => {
    expect((await t.get("/api/session")).json()).toMatchObject({ emailless: true });
    expect((await t.login(PASSWORD, "")).statusCode).toBe(200);
    expect((await t.get("/api/me")).json()).toMatchObject({ needsProfile: true, email: "" });
    // Another email does not match it.
    t.cookie = "";
    expect((await t.login(PASSWORD, "me@example.com")).statusCode).toBe(401);
    // Giving an email ends the nudge, and the login then needs it.
    await t.login(PASSWORD, "");
    await t.put("/api/me", { name: "Elad", email: "elad@example.com" });
    expect((await t.get("/api/me")).json()).toMatchObject({ needsProfile: false });
    t.cookie = "";
    expect((await t.login(PASSWORD, "")).statusCode).toBe(401);
    expect((await t.get("/api/session")).json()).toMatchObject({ emailless: false });
  });

  it("does not guess between two accounts that have no email", async () => {
    await t.services.server.people.create({ name: "", email: "" });
    expect((await t.login(PASSWORD, "")).statusCode).toBe(401);
  });
});

describe("who saves a version", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeTestApp();
  });
  afterEach(() => t.close());

  const lastAuthor = () =>
    execFileSync("git", ["log", "-1", "--format=%an <%ae>", "refs/heads/main"], {
      cwd: t.repo.remote,
      encoding: "utf8",
    }).trim();

  async function save() {
    await t.put("/api/drafts", {
      id: "draftpeople1",
      path: "02 People/Mira.md",
      kind: "edit",
      text: "# Mira\n\nChanged by a person.\n",
      revision: 0,
    });
    const plan = (
      await t.post("/api/publish/plan", { draftIds: ["draftpeople1"], renameIds: [] })
    ).json();
    return t.post("/api/publish/confirm", {
      planId: plan.planId,
      confirmedMergeIds: [],
      message: "A change",
    });
  }

  it("is the logged-in person, by their own name and email", async () => {
    await t.login();
    await t.put("/api/me", { name: "Elad Z", email: "elad@new.example.com" });
    expect((await save()).statusCode).toBe(200);
    expect(lastAuthor()).toBe("Elad Z <elad@new.example.com>");
  });

  it("falls back to the configured author for what the person has not given", async () => {
    const [person] = await t.services.server.people.all();
    await t.services.server.people.update(person!.id, (p) => ({ ...p, name: "", email: "" }));
    // The login needs no email while it is the only account without one.
    expect((await t.login(PASSWORD, "")).statusCode).toBe(200);
    expect((await save()).statusCode).toBe(200);
    expect(lastAuthor()).toBe("The Author <author@example.com>");
  });
});

describe("initials", () => {
  it("takes the first and last name, or the email", () => {
    expect(initialsOf("Elad Zohar")).toBe("EZ");
    expect(initialsOf("  mira   van der Berg ")).toBe("MB");
    expect(initialsOf("Mira")).toBe("M");
    expect(initialsOf("", "elad@example.com")).toBe("E");
    expect(initialsOf("", "")).toBe("?");
  });
});

describe("sessions after a change to how the account is logged into", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeTestApp();
    t.services.server.loginLimit = new LoginLimiter(100);
  });
  afterEach(() => t.close());

  const KEY = {
    id: "cred",
    publicKey: "k",
    counter: 0,
    transports: [],
    name: "Phone",
    addedAt: "2026-11-21T10:00:00Z",
  };
  const NEW = "a new long password";

  /** Another device: a second login, which gets a cookie of its own. */
  async function otherDevice() {
    const mine = t.cookie;
    await t.login();
    const other = t.cookie;
    t.cookie = mine;
    return other;
  }
  const status = async (cookie: string) => {
    const mine = t.cookie;
    t.cookie = cookie;
    const code = (await t.get("/api/me")).statusCode;
    t.cookie = mine;
    return code;
  };
  const update = async (change: (p: Person) => Person) =>
    t.services.server.people.update((await t.services.server.people.all())[0]!.id, change);

  it("ends the other sessions when the password changes, and keeps this one", async () => {
    await t.login();
    const other = await otherDevice();
    expect(await status(other)).toBe(200);
    const ok = await t.put("/api/me/password", { current: PASSWORD, password: NEW });
    expect(ok.statusCode).toBe(200);
    expect(await status(other)).toBe(401);
    expect((await t.get("/api/me")).statusCode).toBe(200);
  });

  it("ends the other sessions when a passkey is removed, or the password switched off or on", async () => {
    await t.login();
    await update((p) => ({ ...p, passkeys: [KEY] }));
    let other = await otherDevice();
    // A passkey session may switch the password off; this session is made to look like one.
    const [person] = await t.services.server.people.all();
    const passkeySession = t.app.createSecureSession({
      user: person!.id,
      method: "passkey",
      epoch: person!.sessionEpoch,
      loginAt: Date.now(),
    });
    t.cookie = `frontier_session=${encodeURIComponent(t.app.encodeSecureSession(passkeySession))}`;
    expect((await t.put("/api/settings/password-off", { off: true })).statusCode).toBe(200);
    expect(await status(other)).toBe(401);
    expect((await t.get("/api/me")).statusCode).toBe(200);

    // The password is off, so another session can only be made from the store.
    const now = (await t.services.server.people.all())[0]!;
    const made = t.app.createSecureSession({
      user: now.id,
      method: "passkey",
      epoch: now.sessionEpoch,
      loginAt: Date.now(),
    });
    other = `frontier_session=${encodeURIComponent(t.app.encodeSecureSession(made))}`;
    expect((await t.put("/api/settings/password-off", { off: false })).statusCode).toBe(200);
    expect(await status(other)).toBe(401);

    other = await otherDevice();
    expect((await t.del(`/api/passkeys/${KEY.id}`)).statusCode).toBe(200);
    expect(await status(other)).toBe(401);
    expect((await t.get("/api/me")).statusCode).toBe(200);
  });

  it("treats a session that never had an epoch as the first one, so a change still ends it", async () => {
    const [person] = await t.services.server.people.all();
    const old = t.app.createSecureSession({ user: person!.id, method: "password" });
    const cookie = `frontier_session=${encodeURIComponent(t.app.encodeSecureSession(old))}`;
    expect(await status(cookie)).toBe(200);
    await t.login();
    await t.put("/api/me/password", { current: PASSWORD, password: NEW });
    expect(await status(cookie)).toBe(401);
  });

  it("keeps two removals at once from taking away the last way in", async () => {
    await t.login();
    const second = { ...KEY, id: "cred2", name: "Laptop" };
    await update((p) => ({ ...p, passwordHash: "", passkeys: [KEY, second] }));
    const results = await Promise.all([t.del("/api/passkeys/cred"), t.del("/api/passkeys/cred2")]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    expect((await t.services.server.people.all())[0]!.passkeys).toHaveLength(1);
  });

  it("checks the last way in against the account as it is when a change is made", async () => {
    await t.login();
    // The password is switched off while the request is in flight: the one passkey must stay.
    await update((p) => ({ ...p, passkeys: [KEY] }));
    const pending = t.del(`/api/passkeys/${KEY.id}`);
    await update((p) => ({ ...p, passwordOff: true }));
    const res = await pending;
    // Whichever came first, the account is never left with no way in.
    const [now] = await t.services.server.people.all();
    expect(now!.passkeys.length + (now!.passwordOff ? 0 : 1)).toBeGreaterThan(0);
    expect([200, 403]).toContain(res.statusCode);
  });
});

describe("a login from the last few minutes", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeTestApp();
  });
  afterEach(() => t.close());

  /** A session that logged in this long ago. */
  async function sessionFrom(msAgo: number) {
    const [person] = await t.services.server.people.all();
    const s = t.app.createSecureSession({
      user: person!.id,
      method: "password",
      epoch: person!.sessionEpoch,
      loginAt: Date.now() - msAgo,
    });
    t.cookie = `frontier_session=${encodeURIComponent(t.app.encodeSecureSession(s))}`;
  }
  const withoutPassword = async () => {
    const [person] = await t.services.server.people.all();
    await t.services.server.people.update(person!.id, (p) => ({
      ...p,
      passwordHash: "",
      passwordOff: true,
      passkeys: [
        {
          id: "cred",
          publicKey: "k",
          counter: 0,
          transports: [],
          name: "Phone",
          addedAt: "2026-11-21T10:00:00Z",
        },
      ],
    }));
  };

  it("is needed to set a first password, and not to change an existing one", async () => {
    await withoutPassword();
    await sessionFrom(6 * 60 * 1000);
    const refused = await t.put("/api/me/password", { password: "a new long password" });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("recent_login_needed");
    expect((await t.services.server.people.all())[0]!.passwordHash).toBe("");
    await sessionFrom(60 * 1000);
    expect((await t.put("/api/me/password", { password: "a new long password" })).statusCode).toBe(
      200,
    );

    // With a password to ask for, the session's age does not matter.
    await sessionFrom(24 * 60 * 60 * 1000);
    const changed = await t.put("/api/me/password", {
      current: "a new long password",
      password: "another long password",
    });
    expect(changed.statusCode).toBe(200);
  });

  it("is needed to add a passkey, at both steps", async () => {
    await sessionFrom(6 * 60 * 1000);
    for (const url of ["/api/passkeys/register/options", "/api/passkeys/register/verify"]) {
      const res = await t.post(url, { name: "Phone", response: { id: "x" } });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("recent_login_needed");
    }
    await sessionFrom(60 * 1000);
    expect((await t.post("/api/passkeys/register/options")).statusCode).toBe(200);
  });

  it("is there after a fresh login, so the first passkey can be added at once", async () => {
    await t.login();
    expect((await t.post("/api/passkeys/register/options")).statusCode).toBe(200);
  });

  it("counts a password change against the login allowance", async () => {
    await t.login();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push(
        (await t.put("/api/me/password", { current: "wrong", password: "a new long password" }))
          .statusCode,
      );
    }
    // The login took the first of the five.
    expect(codes).toEqual([400, 400, 400, 400, 429, 429]);
  });
});

describe("the move happens once", () => {
  let dir: string;
  let people: PeopleStore;
  let settings: SettingsStore;
  const start = (env: Record<string, string> = {}) =>
    startAccounts({ people, settings, env, say: () => undefined });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "frontier-once-"));
    const files = new StateFiles();
    people = new PeopleStore(dir, files);
    settings = new SettingsStore(dir, files);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("does not bring the old password back when the people file is gone", async () => {
    await settings.write({ passwordHash: await hashPassword(PASSWORD) });
    await start();
    expect((await settings.read())!.migratedToPeople).toBe(true);
    rmSync(join(dir, "people.json"));
    const refusal = start({ FRONTIER_INITIAL_PASSWORD: "a long enough password" });
    await expect(refusal).rejects.toThrow(/people\.json/);
    await expect(start()).rejects.toThrow(/npm run restore/);
    expect(await people.exists()).toBe(false);
  });

  it("makes the account from FRONTIER_INITIAL_PASSWORD only when none has ever existed", async () => {
    await start({ FRONTIER_INITIAL_PASSWORD: "a long enough password" });
    expect((await settings.read())!.migratedToPeople).toBe(true);
    rmSync(join(dir, "people.json"));
    await expect(start({ FRONTIER_INITIAL_PASSWORD: "a long enough password" })).rejects.toThrow(
      /restore/,
    );
    expect(await people.exists()).toBe(false);
  });

  it("notes the move for a server that made its accounts before the note existed", async () => {
    await settings.write({ passwordHash: "" });
    await people.create({ name: "Old" });
    await start();
    expect((await settings.read())!.migratedToPeople).toBe(true);
    rmSync(join(dir, "people.json"));
    await expect(start()).rejects.toThrow(/restore/);
  });

  it("starts as usual on a server that never had an account", async () => {
    await expect(start()).resolves.toBeUndefined();
  });
});

describe("the email of an account", () => {
  it("is the same under compatibility forms, case and spaces", () => {
    expect(emailKey("  ＡＢ＠Example.COM ")).toBe(emailKey("ab@example.com"));
    expect(emailKey("ﬀ@example.com")).toBe("ff@example.com");
  });
});

describe("the first account after the move", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeTestApp();
  });
  afterEach(() => t.close());

  it("suggests the commit author's email for an account with none, but not a stand-in or no-reply one", async () => {
    const [person] = await t.services.server.people.all();
    await t.services.server.people.update(person!.id, (p) => ({ ...p, email: "" }));
    await t.login(PASSWORD, "");
    expect((await t.get("/api/me")).json()).toMatchObject({
      email: "",
      suggestedEmail: "author@example.com",
    });
    // Saving is the person's own act.
    expect((await t.services.server.people.all())[0]!.email).toBe("");
    for (const bad of ["author@frontier.invalid", "123+name@users.noreply.github.com"]) {
      t.services.config.commitAuthor.email = bad;
      expect((await t.get("/api/me")).json().suggestedEmail).toBe("");
    }
  });

  it("keeps a sign-in field in the settings for devices on the previous build", async () => {
    await t.login();
    expect((await t.get("/api/settings")).json().signIn).toMatchObject({
      passkeys: [],
      passwordOff: false,
      method: "password",
    });
  });

  it("is seen from the file when another process, like the set-password command, changes it", async () => {
    await t.login();
    const [person] = await t.services.server.people.all();
    // A second store on the same file stands for the other process.
    const other = new PeopleStore(`${t.services.config.dataDir}/state`, new StateFiles());
    await other.update(person!.id, (p) => ({ ...p, sessionEpoch: p.sessionEpoch + 1 }));
    expect((await t.get("/api/me")).statusCode).toBe(401);
  });
});
