/** Email (stage 28) on a server with no mail relay: everything is as it was before. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateInviteResponse } from "@frontier/schema";
import {
  addMember,
  addPerson,
  makeTestApp,
  PASSWORD,
  type Client,
  type TestApp,
} from "./helpers/app.js";
import { anon } from "./helpers/mail.js";

let t: TestApp;
let owner: Client;
let slug: string;
let n = 0;
const base = () => `/api/p/${slug}`;
const fresh = () => `off${++n}@example.org`;

beforeAll(async () => {
  t = await makeTestApp({ LOGIN_ATTEMPTS: "100" });
  await t.login();
  const first = (await t.server.projects.all())[0]!;
  slug = first.slug;
  owner = await addPerson(t, "Olive Owner", "owner@example.com");
  await addMember(t, first.id, owner.id, "owner");
});
afterAll(() => t.close());

describe("with no relay configured", () => {
  it("says so, and sends nothing anywhere", async () => {
    expect(t.server.mail.enabled).toBe(false);
    expect(t.server.mail.outbox).toBeNull();
    expect((await anon(t, "GET", "/api/session")).json().mail).toBe(false);
    const me = (await t.get("/api/me")).json();
    expect(me.emailInfo).toMatchObject({ mailOn: false });
    // There is no test hook either.
    expect((await t.get("/api/test/mail")).statusCode).toBe(404);
  });

  it("makes an invitation link as before, and refuses an address with mail_off", async () => {
    const plain = await owner.post(`${base()}/invites`, { role: "writer" });
    expect(plain.statusCode).toBe(201);
    expect(plain.json()).toMatchObject({ sentTo: null, mail: null });
    const before = (await owner.get(`${base()}/invites`)).json().invites.length;
    const withAddress = await owner.post(`${base()}/invites`, {
      role: "writer",
      email: "someone@example.org",
    });
    expect(withAddress.statusCode).toBe(409);
    expect(withAddress.json().error.code).toBe("mail_off");
    expect((await owner.get(`${base()}/invites`)).json().invites).toHaveLength(before);
    const resend = await owner.post(`${base()}/invites/${plain.json().id}/resend`);
    expect(resend.json().error.code).toBe("mail_off");
  });

  it("joining takes the address as typed: no mail, in at once, and nothing is marked", async () => {
    const link = (
      await owner.post(`${base()}/invites`, { role: "writer" })
    ).json() as CreateInviteResponse;
    const email = fresh();
    const res = await anon(t, "POST", `/api/join/${link.code}`, {
      name: "Nina",
      email,
      password: "a long enough password",
    });
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
    const me = (await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).json();
    expect(me.emailInfo).toMatchObject({ mailOn: false, sent: null });
    // The owners' list marks nobody.
    const rows = (await owner.get(`${base()}/members`)).json().members;
    expect(rows.every((r: { unconfirmed: boolean | null }) => r.unconfirmed === false)).toBe(true);
  });

  it("has no Forgot password, no resend and no confirm that works", async () => {
    const forgot = await anon(t, "POST", "/api/forgot-password", { email: "owner@example.com" });
    expect(forgot.statusCode).toBe(409);
    expect(forgot.json().error.code).toBe("mail_off");
    expect((await owner.post("/api/me/email/resend")).json().error.code).toBe("mail_off");
    expect((await anon(t, "POST", `/api/confirm/${"a".repeat(32)}`)).json().error.code).toBe(
      "link_invalid",
    );
    expect((await anon(t, "GET", `/api/reset/${"a".repeat(32)}`)).json().error.code).toBe(
      "link_invalid",
    );
  });

  it("changes the address at once with the current password, as before", async () => {
    const who = await addPerson(t, "Changer", fresh());
    const next = fresh();
    expect((await who.post("/api/me/email", { email: next })).json().error.code).toBe("invalid");
    expect(
      (await who.post("/api/me/email", { email: next, password: "nope nope nope" })).statusCode,
    ).toBe(400);
    const res = await who.post("/api/me/email", { email: next, password: PASSWORD });
    expect(res.json()).toEqual({ ok: true, applied: true, mail: "off" });
    expect((await who.get("/api/me")).json().email).toBe(next);
    expect(
      (await anon(t, "POST", "/api/login", { email: next, password: PASSWORD })).statusCode,
    ).toBe(200);
    // Another account's address is not available.
    expect(
      (await who.post("/api/me/email", { email: "owner@example.com", password: PASSWORD })).json()
        .error.code,
    ).toBe("email_taken");
  });

  it("the profile form changes the address at once, as before", async () => {
    const who = await addPerson(t, "Profiler", fresh());
    const next = fresh();
    const res = await who.put("/api/me", { name: "Profiler", email: next });
    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe(next);
  });

  it("the profile form sets the first address of an account that has none, and a change of case keeps the confirmation", async () => {
    const who = await addPerson(t, "Late Adder", fresh());
    await t.server.people.update(who.id, (p) => ({ ...p, email: "" }));
    const first = fresh();
    expect((await who.put("/api/me", { name: "Late Adder", email: first })).json().email).toBe(
      first,
    );
    // Confirmed some other way (Google, say); a change of case is the same address.
    await t.server.people.update(who.id, (p) => ({
      ...p,
      emailConfirmedAt: new Date().toISOString(),
      emailConfirmedBy: "google",
    }));
    const res = await who.put("/api/me", { name: "Late Adder", email: first.toUpperCase() });
    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe(first.toUpperCase());
    expect(await t.server.people.get(who.id)).toMatchObject({
      email: first.toUpperCase(),
      emailConfirmedBy: "google",
    });
    // A different address is a new one, unconfirmed.
    await who.put("/api/me", { name: "Late Adder", email: fresh() });
    expect((await t.server.people.get(who.id))!.emailConfirmedAt).toBeNull();
  });
});
