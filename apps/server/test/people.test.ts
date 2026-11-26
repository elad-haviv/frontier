import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initialsOf, MeResponse } from "@frontier/schema";
import { startAccounts } from "../src/auth/accounts.js";
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
    expect(person).toMatchObject({
      name: "Elad",
      email: "elad@example.com",
      admin: true,
      passwordHash: hash,
      passwordOff: true,
      passkeys: [KEY],
    });
    expect(readFileSync(join(dir, "settings.json"), "utf8")).toBe(before);
    expect(said).toEqual(["Moved the password and passkeys into the first account."]);
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
    await t.services.people.create({ name: "Mira", email: "mira@example.com" });
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
    const [person] = await t.services.people.all();
    await t.services.people.update(person!.id, (p) => ({
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
    const [person] = await t.services.people.all();
    await t.services.people.update(person!.id, (p) => ({ ...p, passwordHash: "" }));
    const on = await t.put("/api/settings/password-off", { off: false });
    expect(on.statusCode).toBe(403);
    expect(on.json().error.message).toMatch(/no password/);
  });

  it("keeps the last way to log in: a passkey cannot go when there is no password", async () => {
    await t.login();
    const [person] = await t.services.people.all();
    const key = {
      id: "cred",
      publicKey: "k",
      counter: 0,
      transports: [],
      name: "Phone",
      addedAt: "2026-11-21T10:00:00Z",
    };
    await t.services.people.update(person!.id, (p) => ({
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
    const [mine] = await t.services.people.all();
    const other = await t.services.people.create({
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
    expect((await t.services.people.byPasskey("cred"))?.id).toBe(other.id);
    expect(mine!.passkeys).toEqual([]);
    // Removing a passkey takes it from the logged-in person only: this one is not theirs.
    await t.login();
    expect((await t.del("/api/passkeys/cred")).statusCode).toBe(404);
    expect((await t.services.people.byPasskey("cred"))?.id).toBe(other.id);
  });

  it("registers a passkey for the logged-in person, under their own name", async () => {
    await t.login();
    const options = (await t.post("/api/passkeys/register/options")).json();
    expect(options.user.name).toBe(EMAIL);
    expect(options.user.displayName).toBe(NAME);
    const [person] = await t.services.people.all();
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
    const [mine] = await t.services.people.all();
    await t.services.people.update(mine!.id, (p) => ({ ...p, passkeys: [key("one")] }));
    await t.services.people.create({
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
    expect(refused.statusCode).toBe(400);
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
    await t.services.people.create({ name: "", email: "" });
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
    const [person] = await t.services.people.all();
    await t.services.people.update(person!.id, (p) => ({ ...p, name: "", email: "" }));
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
