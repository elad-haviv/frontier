import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionResponse, SettingsResponse } from "@frontier/schema";
import { makeTestApp, PASSWORD, type TestApp } from "./helpers/app.js";

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(() => t.close());

const KEY = {
  id: "Y3JlZGVudGlhbA",
  publicKey: "cHVibGlj",
  counter: 0,
  transports: ["internal"],
  name: "Phone",
  addedAt: "2026-11-21T10:00:00Z",
};
const withKey = (passwordOff = false) =>
  t.services.settings.update((s) => ({ ...s, passkeys: [KEY], passwordOff }));
const session = async () => SessionResponse.parse((await t.get("/api/session")).json());

describe("passkeys", () => {
  it("offers a passkey on the login page only when one exists", async () => {
    expect(await session()).toEqual({ loggedIn: false, passkeys: false, password: true });
    expect((await t.post("/api/passkeys/login/options")).statusCode).toBe(404);
    await withKey();
    expect(await session()).toMatchObject({ passkeys: true, password: true });
    const options = await t.post("/api/passkeys/login/options");
    expect(options.statusCode).toBe(200);
    expect(options.json()).toMatchObject({
      rpId: "localhost",
      userVerification: "required",
      allowCredentials: [{ id: KEY.id }],
    });
    expect(options.json().challenge.length).toBeGreaterThan(20);
  });

  it("needs a session to register, and asks the device to verify the user", async () => {
    expect((await t.post("/api/passkeys/register/options")).statusCode).toBe(401);
    await t.login();
    const options = (await t.post("/api/passkeys/register/options")).json();
    expect(options.rp).toEqual({ name: "Frontier", id: "localhost" });
    expect(options.authenticatorSelection.userVerification).toBe("required");
    // A response that was never asked for, or that does not check out, adds nothing.
    const bad = await t.post("/api/passkeys/register/verify", {
      name: "Fake",
      response: { id: "x" },
    });
    expect(bad.statusCode).toBe(400);
    const settings = SettingsResponse.parse((await t.get("/api/settings")).json());
    expect(settings.signIn).toEqual({ passkeys: [], passwordOff: false, method: "password" });
  });

  it("refuses a login response without a challenge or from an unknown passkey", async () => {
    await withKey();
    const cold = await t.post("/api/passkeys/login/verify", { response: { id: KEY.id } });
    expect(cold.statusCode).toBe(400);
    expect((await session()).loggedIn).toBe(false);
  });

  it("counts passkey and password attempts against one limit", async () => {
    await withKey();
    for (let i = 0; i < 3; i++) {
      await t.post("/api/passkeys/login/verify", { response: { id: KEY.id } });
    }
    expect((await t.login("wrong password 1")).statusCode).toBe(401);
    expect((await t.login("wrong password 2")).statusCode).toBe(401);
    expect((await t.login(PASSWORD)).statusCode).toBe(429);
    expect(
      (await t.post("/api/passkeys/login/verify", { response: { id: KEY.id } })).statusCode,
    ).toBe(429);
  });

  it("switches the password off only from a passkey session, and then the password is refused", async () => {
    await withKey();
    await t.login();
    const res = await t.put("/api/settings/password-off", { off: true });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/Log in with a passkey first/);

    await withKey(true);
    expect(await session()).toMatchObject({ password: false });
    t.cookie = "";
    const refused = await t.login();
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error.message).toMatch(/switched off/);
  });

  it("keeps the last passkey while the password is off, and removes one otherwise", async () => {
    await withKey();
    await t.login();
    await withKey(true);
    const kept = await t.del(`/api/passkeys/${KEY.id}`);
    expect(kept.statusCode).toBe(403);
    // Switching the password back on needs no passkey session.
    expect((await t.put("/api/settings/password-off", { off: false })).statusCode).toBe(200);
    expect((await t.del(`/api/passkeys/${KEY.id}`)).statusCode).toBe(200);
    expect((await session()).passkeys).toBe(false);
    // The AI settings and the password are untouched by all of this.
    const stored = await t.services.settings.read();
    expect(stored!.passwordHash).toMatch(/^\$argon2/);
    expect(stored!.ai.proposeOnPublish).toBe(false);
  });
});
