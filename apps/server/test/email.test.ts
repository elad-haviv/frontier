/**
 * Email (stage 28), mail on: emailed invitations, confirming an address, changing it, forgotten
 * passwords, and the safeguards around every link.
 */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CreateInviteResponse, MeResponse } from "@frontier/schema";
import {
  addMember,
  addPerson,
  makeTestApp,
  PASSWORD,
  type Client,
  type TestApp,
} from "./helpers/app.js";
import { anon, clearMail, codeIn, mailTo, outbox } from "./helpers/mail.js";

const LOG: string[] = [];
let t: TestApp;
let owner: Client;
let writer: Client;
let slug: string;
let pid: string;
let n = 0;
const base = () => `/api/p/${slug}`;
const fresh = () => `person${++n}@example.org`;

beforeAll(async () => {
  t = await makeTestApp(
    {
      LOGIN_ATTEMPTS: "100",
      MAIL_TEST_TRANSPORT: "memory",
      MAIL_FROM: "Frontier <noreply@haviv.pro>",
    },
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
afterEach(() => {
  vi.useRealTimers();
  t.server.mail.outbox!.failNext = 0;
  t.server.mail.outbox!.delayMs = 0;
});

const invite = async (body: Record<string, unknown> = { role: "writer" }, by: Client = owner) => {
  const res = await by.post(`${base()}/invites`, body);
  return { res, body: res.json() as CreateInviteResponse };
};
const join = (code: string, email: string, extra: Record<string, unknown> = {}) =>
  anon(t, "POST", `/api/join/${code}`, {
    name: "Nina New",
    email,
    password: "a long enough password",
    ...extra,
  });
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  String(res.headers["set-cookie"]).split(";")[0]!;
const meOf = async (cookie: string) =>
  (await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).json() as MeResponse;
const person = async (email: string) => (await t.server.people.byEmail(email))!;

/** Someone who joined with a password and an address nobody has confirmed yet. */
async function joined(email = fresh(), by = "writer" as "writer" | "reader") {
  const { body } = await invite({ role: by });
  const res = await join(body.code, email);
  expect(res.statusCode, res.body).toBe(200);
  await t.server.mail.settled();
  return { email, cookie: cookieOf(res), id: (await person(email)).id };
}

describe("the server says it sends mail", () => {
  it("in the session, and for the person in the banner's data", async () => {
    expect((await anon(t, "GET", "/api/session")).json()).toMatchObject({ mail: true });
    const { cookie } = await joined();
    const session = (
      await t.app.inject({ method: "GET", url: "/api/session", headers: { cookie } })
    ).json();
    expect(session.person.emailInfo).toMatchObject({ mailOn: true, status: "unconfirmed" });
  });
});

describe("emailing an invitation", () => {
  it("sends the link to the address, once, and still gives the link to copy", async () => {
    await clearMail(t);
    const to = fresh();
    const { res, body } = await invite({ role: "reader", email: to });
    expect(res.statusCode).toBe(201);
    expect(body).toMatchObject({ sentTo: to, mail: "sent", role: "reader" });
    expect(res.headers["cache-control"]).toBe("no-store");
    const sent = await mailTo(t, to);
    expect(sent).toHaveLength(1);
    expect(codeIn(sent[0]!, "join")).toBe(body.code);
    expect(sent[0]!.text).toContain("Olive Owner");
    expect(sent[0]!.text).toContain("read");
    expect(sent[0]!.html).toContain("noreply@haviv.pro");
    expect(sent[0]!.text).toContain("Anyone who opens it can join with it");
    // The link is built on the configured address, never the request's.
    expect(sent[0]!.text).toContain(`http://localhost:3000/join/${body.code}`);
  });

  it("builds the link from the server's own address, whatever Host the request carries", async () => {
    await clearMail(t);
    const to = fresh();
    const res = await t.app.inject({
      method: "POST",
      url: `${base()}/invites`,
      headers: { cookie: owner.cookie, host: "evil.example", "x-forwarded-host": "evil.example" },
      payload: { role: "writer", email: to },
    });
    expect(res.statusCode).toBe(201);
    const [m] = await mailTo(t, to);
    expect(m!.text).not.toContain("evil.example");
    expect(m!.html).not.toContain("evil.example");
    expect(res.json().url).toMatch(/^http:\/\/localhost:3000\/join\//);
  });

  it("is listed with where it went, and never with a code", async () => {
    const to = fresh();
    const { body } = await invite({ role: "writer", email: to });
    const list = (await owner.get(`${base()}/invites`)).json();
    const row = list.invites.find((i: { id: string }) => i.id === body.id);
    expect(row).toMatchObject({ sentTo: to, mail: "sent" });
    expect(JSON.stringify(list)).not.toContain(body.code);
    const plain = await invite({ role: "writer" });
    expect(plain.body).toMatchObject({ sentTo: null, mail: null });
    const row2 = (await owner.get(`${base()}/invites`))
      .json()
      .invites.find((i: { id: string }) => i.id === plain.body.id);
    expect(row2).toMatchObject({ sentTo: null, mail: null });
  });

  it("escapes what people typed in the HTML, and keeps the subject to one line", async () => {
    const project = (await t.server.projects.get(pid))!;
    const evil = `<img src=x onerror=alert(1)> "Q" & Co\r\nBcc: spy@example.com`;
    await t.server.projects.update(pid, (p) => ({ ...p, name: evil }));
    await t.server.people.update(owner.id, (p) => ({ ...p, name: "<b>Olive</b>" }));
    try {
      const to = fresh();
      await clearMail(t);
      expect((await invite({ role: "writer", email: to })).res.statusCode).toBe(201);
      const [m] = await mailTo(t, to);
      expect(m!.html).not.toContain("<img");
      expect(m!.html).not.toContain("<b>Olive</b>");
      expect(m!.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(m!.html).toContain("&quot;Q&quot; &amp; Co");
      expect(m!.subject).not.toMatch(/[\r\n]/);
      expect(m!.subject).toContain("Bcc: spy@example.com");
    } finally {
      await t.server.projects.update(pid, (p) => ({ ...p, name: project.name }));
      await t.server.people.update(owner.id, (p) => ({ ...p, name: "Olive Owner" }));
    }
  });

  it("refuses an address that is not one, and one that could add a header, sending nothing", async () => {
    await clearMail(t);
    for (const email of [
      "not an address",
      "a@b.co\r\nBcc: x@y.zz",
      "a@b.co,c@d.co",
      "<a@b.co>",
      "a@b",
      "",
    ]) {
      const res = await owner.post(`${base()}/invites`, { role: "writer", email });
      expect(res.statusCode, email).toBe(400);
      expect(res.json().error.code).toBe("invalid");
    }
    expect(await outbox(t)).toHaveLength(0);
  });

  it("when the relay fails, makes the link anyway and says the mail did not go; Resend tries again", async () => {
    const to = fresh();
    t.server.mail.outbox!.failNext = 1;
    const { res, body } = await invite({ role: "writer", email: to });
    expect(res.statusCode).toBe(201);
    expect(body).toMatchObject({ mail: "failed", sentTo: to });
    expect(body.code.length).toBeGreaterThan(20);
    expect(
      (await owner.get(`${base()}/invites`))
        .json()
        .invites.find((i: { id: string }) => i.id === body.id).mail,
    ).toBe("failed");
    // The link works.
    expect((await anon(t, "GET", `/api/join/${body.code}`)).statusCode).toBe(200);
    const again = await owner.post(`${base()}/invites/${body.id}/resend`);
    expect(again.statusCode).toBe(201);
    expect(again.json().mail).toBe("sent");
    expect(await mailTo(t, to)).toHaveLength(1);
  });

  it("a relay that is slow does not hold up a join or a forgotten-password answer", async () => {
    t.server.mail.outbox!.delayMs = 400;
    const { body } = await invite({ role: "writer" });
    const started = Date.now();
    const res = await join(body.code, fresh());
    expect(res.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(350);
    const forgot = Date.now();
    expect(
      (await anon(t, "POST", "/api/forgot-password", { email: "owner@example.com" })).statusCode,
    ).toBe(200);
    expect(Date.now() - forgot).toBeLessThan(350);
    await t.server.mail.settled();
  });

  it("resend cancels the old link, makes a new one for the same role and address, and emails it", async () => {
    const to = fresh();
    const first = (await invite({ role: "reader", email: to })).body;
    await clearMail(t);
    const res = await owner.post(`${base()}/invites/${first.id}/resend`);
    expect(res.statusCode).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    const again = res.json() as CreateInviteResponse;
    expect(again.id).not.toBe(first.id);
    expect(again.code).not.toBe(first.code);
    expect(again).toMatchObject({ role: "reader", sentTo: to, mail: "sent" });
    const [m] = await mailTo(t, to);
    expect(codeIn(m!, "join")).toBe(again.code);
    // The earlier link is dead; the new one works; the list has one row for the address.
    expect((await anon(t, "GET", `/api/join/${first.code}`)).json().error.code).toBe(
      "invite_cancelled",
    );
    expect((await anon(t, "GET", `/api/join/${again.code}`)).statusCode).toBe(200);
    const rows = (await owner.get(`${base()}/invites`))
      .json()
      .invites.filter((i: { sentTo: string }) => i.sentTo === to);
    expect(rows.map((r: { id: string }) => r.id)).toEqual([again.id]);
  });

  it("resend is for owners, for emailed links that still wait, and says what is wrong otherwise", async () => {
    const to = fresh();
    const sent = (await invite({ role: "writer", email: to })).body;
    expect((await writer.post(`${base()}/invites/${sent.id}/resend`)).statusCode).toBe(403);
    expect((await owner.post(`${base()}/invites/nonesuch/resend`)).json().error.code).toBe(
      "not_found",
    );
    const plain = (await invite({ role: "writer" })).body;
    expect((await owner.post(`${base()}/invites/${plain.id}/resend`)).json().error.code).toBe(
      "invalid",
    );
    // Used: cannot be resent.
    await join(sent.code, fresh());
    const used = await owner.post(`${base()}/invites/${sent.id}/resend`);
    expect(used.statusCode).toBe(410);
    expect(used.json().error.code).toBe("invite_used");
    // Cancelled: the same.
    const c = (await invite({ role: "writer", email: fresh() })).body;
    await owner.del(`${base()}/invites/${c.id}`);
    expect((await owner.post(`${base()}/invites/${c.id}/resend`)).json().error.code).toBe(
      "invite_cancelled",
    );
  });

  it("allows a few mails to one address an hour, and says so the same way for every address", async () => {
    const to = fresh();
    for (let i = 0; i < 6; i++) {
      expect((await invite({ role: "writer", email: to })).res.statusCode).toBe(201);
    }
    const res = await owner.post(`${base()}/invites`, { role: "writer", email: to });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.message).toBe("Too many requests. Try again in a few minutes.");
    // Nothing was made by the refused request.
    const rows = (await owner.get(`${base()}/invites`))
      .json()
      .invites.filter((i: { sentTo: string }) => i.sentTo === to);
    expect(rows).toHaveLength(6);
  });

  it("joining with exactly the address it was emailed to confirms it, with no second email", async () => {
    const to = fresh();
    const { body } = await invite({ role: "writer", email: to });
    await clearMail(t);
    const info = (await anon(t, "GET", `/api/join/${body.code}`)).json();
    expect(info.email).toBe(to);
    const res = await join(body.code, to.toUpperCase());
    expect(res.statusCode).toBe(200);
    expect(await outbox(t)).toHaveLength(0);
    const p = await person(to);
    expect(p.emailConfirmedAt).not.toBeNull();
    expect(p.emailConfirmedBy).toBe("invite");
    expect(await meOf(cookieOf(res))).toMatchObject({ emailInfo: { status: "confirmed" } });
  });

  it("joining with another address sends a confirm link instead", async () => {
    const to = fresh();
    const { body } = await invite({ role: "writer", email: to });
    await clearMail(t);
    const other = fresh();
    expect((await join(body.code, other)).statusCode).toBe(200);
    expect(await mailTo(t, to)).toHaveLength(0);
    expect(await mailTo(t, other)).toHaveLength(1);
    expect((await person(other)).emailConfirmedAt).toBeNull();
  });

  it("an invitation not emailed shows no address, and joining by it asks to confirm", async () => {
    const { body } = await invite({ role: "writer" });
    expect((await anon(t, "GET", `/api/join/${body.code}`)).json().email).toBeNull();
  });
});

describe("confirming an address", () => {
  it("joining with an unseen address gets in at once and is sent a confirm link", async () => {
    await clearMail(t);
    const { email, cookie } = await joined();
    const [m] = await mailTo(t, email);
    expect(m!.subject).toBe("Confirm your email address for Frontier");
    expect(m!.text).toContain(email);
    const code = codeIn(m!, "confirm");
    expect(m!.text).toContain(`http://localhost:3000/confirm/${code}`);
    expect(m!.html).toContain("Confirm my email");
    // In at once: the session works; the banner has what it needs.
    const me = await meOf(cookie);
    expect(me.emailInfo).toMatchObject({
      mailOn: true,
      status: "unconfirmed",
      sent: { ok: true },
      pending: null,
      needsAddress: false,
    });
  });

  it("keeps only a hash of the code, in the accounts file", async () => {
    const { email } = await joined();
    const [m] = await mailTo(t, email);
    const code = codeIn(m!, "confirm");
    expect(readFileSync(t.server.people.file, "utf8")).not.toContain(code);
    expect((await person(email)).emailCode!.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("opening the link confirms the address, once", async () => {
    const { email, cookie } = await joined();
    const code = codeIn((await mailTo(t, email))[0]!, "confirm");
    const res = await anon(t, "POST", `/api/confirm/${code}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: "confirmed", you: false });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect((await meOf(cookie)).emailInfo).toMatchObject({
      status: "confirmed",
      confirmedBy: "link",
    });
    const again = await anon(t, "POST", `/api/confirm/${code}`);
    expect(again.statusCode).toBe(410);
    expect(again.json().error.code).toBe("link_invalid");
  });

  it("says it is the person's own account when they are logged in as it", async () => {
    const { email, cookie } = await joined();
    const code = codeIn((await mailTo(t, email))[0]!, "confirm");
    const res = await anon(t, "POST", `/api/confirm/${code}`, undefined, { cookie });
    expect(res.json()).toMatchObject({ status: "confirmed", you: true });
  });

  it("opened by someone else who is logged in, it confirms the account it belongs to and nothing of theirs", async () => {
    const a = await joined();
    const b = await joined();
    const code = codeIn((await mailTo(t, a.email))[0]!, "confirm");
    const res = await anon(t, "POST", `/api/confirm/${code}`, undefined, { cookie: b.cookie });
    expect(res.json()).toMatchObject({ status: "confirmed", you: false });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect((await person(a.email)).emailConfirmedAt).not.toBeNull();
    expect((await person(b.email)).emailConfirmedAt).toBeNull();
    // B's session is untouched and still B's.
    expect(await meOf(b.cookie)).toMatchObject({ email: b.email });
  });

  it("answers an unknown, a malformed, a used and an expired link the same way", async () => {
    const { email } = await joined();
    const code = codeIn((await mailTo(t, email))[0]!, "confirm");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 25 * 3600_000);
    const expired = await anon(t, "POST", `/api/confirm/${code}`);
    vi.useRealTimers();
    const unknown = await anon(t, "POST", `/api/confirm/${"x".repeat(32)}`);
    const malformed = await anon(t, "POST", "/api/confirm/short");
    for (const r of [expired, unknown, malformed]) {
      expect(r.statusCode).toBe(410);
      expect(r.json()).toEqual(unknown.json());
    }
    // Run out is not used up: nothing was changed by the refused attempt.
    expect((await person(email)).emailConfirmedAt).toBeNull();
  });

  it("lasts 24 hours", async () => {
    const { email } = await joined();
    const code = codeIn((await mailTo(t, email))[0]!, "confirm");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 23 * 3600_000);
    expect((await anon(t, "POST", `/api/confirm/${code}`)).statusCode).toBe(200);
  });

  it("is used by exactly one of two requests at once", async () => {
    const { email } = await joined();
    const code = codeIn((await mailTo(t, email))[0]!, "confirm");
    const results = await Promise.all(
      Array.from({ length: 5 }, () => anon(t, "POST", `/api/confirm/${code}`)),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 410)).toHaveLength(4);
  });

  it("says already confirmed when a link outlives the confirmation (Google, an invitation, a reset)", async () => {
    const { email, id } = await joined();
    const code = codeIn((await mailTo(t, email))[0]!, "confirm");
    await t.server.people.update(id, (p) => ({
      ...p,
      emailConfirmedAt: new Date().toISOString(),
      emailConfirmedBy: "google",
    }));
    const res = await anon(t, "POST", `/api/confirm/${code}`);
    expect(res.json()).toMatchObject({ status: "already_confirmed" });
    expect((await person(email)).emailConfirmedBy).toBe("google");
  });

  it("resend makes a new link and kills the old one", async () => {
    const { email, cookie } = await joined();
    const first = codeIn((await mailTo(t, email))[0]!, "confirm");
    await clearMail(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/me/email/resend",
      headers: { cookie },
    });
    expect(res.json()).toEqual({ ok: true, applied: false, mail: "sent" });
    const second = codeIn((await mailTo(t, email))[0]!, "confirm");
    expect(second).not.toBe(first);
    expect((await anon(t, "POST", `/api/confirm/${first}`)).json().error.code).toBe("link_invalid");
    expect((await anon(t, "POST", `/api/confirm/${second}`)).statusCode).toBe(200);
    // Confirmed: nothing more to send.
    const done = await t.app.inject({
      method: "POST",
      url: "/api/me/email/resend",
      headers: { cookie },
    });
    expect(done.statusCode).toBe(409);
    expect(done.json().error.code).toBe("already_confirmed");
  });

  it("resend is for the person logged in, limited per account", async () => {
    const { cookie } = await joined();
    expect((await anon(t, "POST", "/api/me/email/resend")).statusCode, "needs a session").toBe(401);
    const post = () =>
      t.app.inject({ method: "POST", url: "/api/me/email/resend", headers: { cookie } });
    for (let i = 0; i < 5; i++) expect((await post()).statusCode).toBe(200);
    const sixth = await post();
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.message).toBe("Too many requests. Try again in a few minutes.");
  });

  it("resend is limited per address too, whichever accounts ask", async () => {
    // Several accounts cannot share an address, so the allowance is drawn by one account's
    // invitation and join mails and its resends together: 6 in all.
    const { email, cookie } = await joined();
    const post = () =>
      t.app.inject({ method: "POST", url: "/api/me/email/resend", headers: { cookie } });
    // One mail was sent by the join; five resends more reach the sixth, which is refused.
    const codes = [];
    for (let i = 0; i < 5; i++) {
      expect((await post()).statusCode).toBe(200);
      codes.push(i);
    }
    expect((await mailTo(t, email)).length).toBe(6);
    t.server.resendLimit.attempt("someone else"); // does not matter
    expect((await post()).statusCode).toBe(429);
  });

  it("with a failing relay, the join works, the banner says it was not sent, and Resend can go", async () => {
    const { body } = await invite({ role: "writer" });
    const email = fresh();
    t.server.mail.outbox!.failNext = 1;
    const res = await join(body.code, email);
    expect(res.statusCode).toBe(200);
    await t.server.mail.settled();
    const cookie = cookieOf(res);
    expect((await meOf(cookie)).emailInfo?.sent).toMatchObject({ ok: false });
    const resend = await t.app.inject({
      method: "POST",
      url: "/api/me/email/resend",
      headers: { cookie },
    });
    expect(resend.json().mail).toBe("sent");
    expect((await meOf(cookie)).emailInfo?.sent).toMatchObject({ ok: true });
  });

  it("with a failing relay on Resend, the action still answers and says it failed", async () => {
    const { cookie } = await joined();
    t.server.mail.outbox!.failNext = 1;
    const res = await t.app.inject({
      method: "POST",
      url: "/api/me/email/resend",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, mail: "failed" });
  });

  it("shows owners, and only owners, who is unconfirmed", async () => {
    const a = await joined();
    const rows = (await owner.get(`${base()}/members`)).json().members as {
      email: string | null;
      unconfirmed: boolean | null;
    }[];
    expect(rows.find((r) => r.email === a.email)!.unconfirmed).toBe(true);
    await anon(t, "POST", `/api/confirm/${codeIn((await mailTo(t, a.email))[0]!, "confirm")}`);
    const after = (await owner.get(`${base()}/members`)).json().members as typeof rows;
    expect(after.find((r) => r.email === a.email)!.unconfirmed).toBe(false);
    const forWriter = (await writer.get(`${base()}/members`)).json().members as typeof rows;
    expect(forWriter.every((r) => r.unconfirmed === null && r.email === null)).toBe(true);
  });

  it("a code that is not a confirm code cannot be used as one (an invitation, a reset)", async () => {
    const { body } = await invite({ role: "writer" });
    expect((await anon(t, "POST", `/api/confirm/${body.code}`)).json().error.code).toBe(
      "link_invalid",
    );
    expect(
      (await anon(t, "POST", `/api/reset/${body.code}`, { password: "x".repeat(14) })).json().error
        .code,
    ).toBe("link_invalid");
  });
});

describe("changing the address", () => {
  const change = (cookie: string, body: Record<string, unknown>, headers = {}) =>
    t.app.inject({
      method: "POST",
      url: "/api/me/email",
      headers: { cookie, ...headers },
      payload: body,
    });

  it("needs the current password", async () => {
    const { cookie } = await joined();
    expect((await change(cookie, { email: fresh() })).json().error.code).toBe("invalid");
    expect(
      (await change(cookie, { email: fresh(), password: "wrong wrong wrong" })).statusCode,
    ).toBe(400);
    expect((await anon(t, "POST", "/api/me/email", { email: fresh() })).statusCode).toBe(401);
  });

  it("the old address stays in force until the new one is confirmed; the old one is told", async () => {
    const a = await joined();
    const next = fresh();
    await clearMail(t);
    const res = await change(a.cookie, { email: next, password: "a long enough password" });
    expect(res.json()).toEqual({ ok: true, applied: false, mail: "sent" });
    // The new address got a confirm link; the old one got the heads-up, with the new one masked.
    const toNew = await mailTo(t, next);
    expect(toNew).toHaveLength(1);
    expect(toNew[0]!.subject).toBe("Confirm your email address for Frontier");
    const toOld = await mailTo(t, a.email);
    expect(toOld).toHaveLength(1);
    expect(toOld[0]!.subject).toBe("Your Frontier email address is being changed");
    expect(toOld[0]!.text).not.toContain(next);
    expect(toOld[0]!.text).toContain(`${next[0]}•••@example.org`);
    // Still the old address: the old one logs in, the new one does not, and the state says why.
    const me = await meOf(a.cookie);
    expect(me.email).toBe(a.email);
    expect(me.emailInfo?.pending).toMatchObject({ address: next, sent: { ok: true } });
    expect(
      (await anon(t, "POST", "/api/login", { email: a.email, password: "a long enough password" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await anon(t, "POST", "/api/login", { email: next, password: "a long enough password" }))
        .statusCode,
    ).toBe(401);
  });

  it("opening the new address's link puts it in force, confirmed, and tells the old address", async () => {
    const a = await joined();
    const next = fresh();
    await change(a.cookie, { email: next, password: "a long enough password" });
    const code = codeIn((await mailTo(t, next))[0]!, "confirm");
    await clearMail(t);
    const res = await anon(t, "POST", `/api/confirm/${code}`);
    expect(res.json()).toMatchObject({ status: "changed" });
    const me = await meOf(a.cookie);
    expect(me.email).toBe(next);
    expect(me.emailInfo).toMatchObject({ status: "confirmed", pending: null });
    expect(
      (await anon(t, "POST", "/api/login", { email: next, password: "a long enough password" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await anon(t, "POST", "/api/login", { email: a.email, password: "a long enough password" }))
        .statusCode,
    ).toBe(401);
    const told = await mailTo(t, a.email);
    expect(told.map((m) => m.subject)).toEqual(["Your Frontier email address has been changed"]);
    expect(told[0]!.text).not.toContain(next);
  });

  it("can be cancelled, and then its link is dead", async () => {
    const a = await joined();
    const next = fresh();
    await change(a.cookie, { email: next, password: "a long enough password" });
    const code = codeIn((await mailTo(t, next))[0]!, "confirm");
    const del = await t.app.inject({
      method: "DELETE",
      url: "/api/me/email/pending",
      headers: { cookie: a.cookie },
    });
    expect(del.json()).toEqual({ ok: true });
    expect((await meOf(a.cookie)).emailInfo?.pending).toBeNull();
    expect((await anon(t, "POST", `/api/confirm/${code}`)).json().error.code).toBe("link_invalid");
    expect((await meOf(a.cookie)).email).toBe(a.email);
    const none = await t.app.inject({
      method: "DELETE",
      url: "/api/me/email/pending",
      headers: { cookie: a.cookie },
    });
    expect(none.statusCode).toBe(404);
  });

  it("while it waits, Resend goes to the new address", async () => {
    const a = await joined();
    const next = fresh();
    await change(a.cookie, { email: next, password: "a long enough password" });
    await clearMail(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/me/email/resend",
      headers: { cookie: a.cookie },
    });
    expect(res.json().mail).toBe("sent");
    expect(await mailTo(t, next)).toHaveLength(1);
    expect(await mailTo(t, a.email)).toHaveLength(0);
  });

  it("refuses an address another account has, the same address, and a badly formed one", async () => {
    const a = await joined();
    const pw = "a long enough password";
    expect(
      (await change(a.cookie, { email: "owner@example.com", password: pw })).json().error.code,
    ).toBe("email_taken");
    expect(
      (await change(a.cookie, { email: a.email.toUpperCase(), password: pw })).json().error.message,
    ).toBe("That is already your address.");
    for (const email of ["nope", "a@b.co\r\nBcc: x@y.zz"]) {
      const res = await change(a.cookie, { email, password: pw });
      expect(res.statusCode).toBe(400);
    }
  });

  it("the link fails like a dead one when another account took the address meanwhile", async () => {
    const a = await joined();
    const next = fresh();
    await change(a.cookie, { email: next, password: "a long enough password" });
    const code = codeIn((await mailTo(t, next))[0]!, "confirm");
    await t.server.people.create({ name: "Squatter", email: next });
    const res = await anon(t, "POST", `/api/confirm/${code}`);
    expect(res.statusCode).toBe(410);
    expect((await meOf(a.cookie)).email).toBe(a.email);
  });

  it("kills a reset link sent to the old address when the change completes", async () => {
    const a = await joined();
    const next = fresh();
    await clearMail(t);
    await anon(t, "POST", "/api/forgot-password", { email: a.email });
    const reset = codeIn((await mailTo(t, a.email))[0]!, "reset");
    await change(a.cookie, { email: next, password: "a long enough password" });
    await anon(t, "POST", `/api/confirm/${codeIn((await mailTo(t, next))[0]!, "confirm")}`);
    expect((await anon(t, "GET", `/api/reset/${reset}`)).statusCode).toBe(410);
  });

  it("with a failing relay it still asks, and says the mail did not go", async () => {
    const a = await joined();
    t.server.mail.outbox!.failNext = 1;
    const res = await change(a.cookie, { email: fresh(), password: "a long enough password" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ applied: false, mail: "failed" });
    expect((await meOf(a.cookie)).emailInfo?.pending?.sent).toMatchObject({ ok: false });
  });

  it("an account whose password does not work needs a recent login instead", async () => {
    const a = await joined();
    await t.server.people.update(a.id, (p) => ({
      ...p,
      passwordHash: "",
      passkeys: [
        {
          id: "k1",
          publicKey: "AA",
          counter: 0,
          transports: [],
          name: "k",
          addedAt: new Date().toISOString(),
        },
      ],
    }));
    const next = fresh();
    expect((await change(a.cookie, { email: next })).statusCode).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10 * 60_000);
    const late = await change(a.cookie, { email: fresh() });
    expect(late.statusCode).toBe(403);
    expect(late.json().error.code).toBe("recent_login_needed");
  });

  it("the profile form: the same address with a new name is fine; another address is not, with mail on", async () => {
    const a = await joined();
    const put = (body: unknown) =>
      t.app.inject({
        method: "PUT",
        url: "/api/me",
        headers: { cookie: a.cookie },
        payload: body as object,
      });
    const ok = await put({ name: "New Name", email: a.email.toUpperCase() });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ name: "New Name", email: a.email });
    const res = await put({ name: "New Name", email: fresh() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("use_change_address");
    expect((await meOf(a.cookie)).email).toBe(a.email);
  });
});

describe("the first address of an account that has none (the profile form)", () => {
  it("is set at once, unconfirmed, and sent a link", async () => {
    // An account from before emails were asked for: a password, no address; it logs in with a
    // blank email while it is the only one like that.
    const lone = await makeTestApp({
      LOGIN_ATTEMPTS: "100",
      MAIL_TEST_TRANSPORT: "memory",
    });
    try {
      const only = (await lone.server.people.all())[0]!;
      await lone.server.people.update(only.id, (p) => ({ ...p, email: "" }));
      expect((await lone.login(PASSWORD, "")).statusCode).toBe(200);
      const res = await lone.put("/api/me", { name: "Late Adder", email: "late@example.org" });
      expect(res.statusCode).toBe(200);
      expect(res.json().emailInfo).toMatchObject({ status: "unconfirmed" });
      await lone.server.mail.settled();
      expect(lone.server.mail.outbox!.messages.map((m) => m.to)).toEqual(["late@example.org"]);
      expect((await lone.get("/api/me")).json().emailInfo.sent).toMatchObject({ ok: true });
      // And through Change address, for an account in the same state.
      await lone.server.people.update(only.id, (p) => ({ ...p, email: "", emailCode: null }));
      const via = await lone.post("/api/me/email", {
        email: "again@example.org",
        password: PASSWORD,
      });
      expect(via.json()).toMatchObject({ applied: true, mail: "sent" });
      expect((await lone.get("/api/me")).json().email).toBe("again@example.org");
    } finally {
      await lone.close();
    }
  });
});

describe("forgot password", () => {
  const forgot = (email: string, headers: Record<string, string> = {}) =>
    anon(t, "POST", "/api/forgot-password", { email }, headers);

  async function account(opts: { password?: boolean; passkey?: boolean; off?: boolean } = {}) {
    const email = fresh();
    const { hashPassword } = await import("../src/auth/password.js");
    const p = await t.server.people.create({
      name: "Ada Forgetful",
      email,
      passwordHash: opts.password === false ? "" : await hashPassword("the old password!"),
      passwordOff: opts.off ?? false,
      passkeys: opts.passkey
        ? [
            {
              id: `k-${email}`,
              publicKey: "AA",
              counter: 0,
              transports: [],
              name: "k",
              addedAt: new Date().toISOString(),
            },
          ]
        : [],
    });
    return { email, id: p.id };
  }
  const loginAs = (email: string, password: string) =>
    anon(t, "POST", "/api/login", { email, password });

  it("gives every address the same answer, whether or not it has an account", async () => {
    const withPassword = await account();
    const passkeyOnly = await account({ password: false, passkey: true });
    const answers = [];
    for (const email of [withPassword.email, passkeyOnly.email, "nobody@nowhere.example"]) {
      const res = await forgot(email);
      answers.push({ status: res.statusCode, body: res.body, set: res.headers["set-cookie"] });
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]).toEqual(answers[2]);
    expect(answers[0]).toMatchObject({ status: 200, body: JSON.stringify({ ok: true }) });
  });

  it("does the lookup and the sending after the answer, so a slow relay changes nothing about it", async () => {
    const a = await account();
    t.server.mail.outbox!.delayMs = 500;
    const start = Date.now();
    await forgot(a.email);
    const known = Date.now() - start;
    const start2 = Date.now();
    await forgot("ghost@nowhere.example");
    const unknown = Date.now() - start2;
    expect(known).toBeLessThan(300);
    expect(unknown).toBeLessThan(300);
    await t.server.mail.settled();
    expect(await mailTo(t, a.email)).toHaveLength(1);
  });

  it("sends a reset link to an account with a working password, and nothing to an unknown address", async () => {
    const a = await account();
    await clearMail(t);
    await forgot(a.email.toUpperCase());
    await forgot("ghost@nowhere.example");
    const all = await outbox(t);
    expect(all).toHaveLength(1);
    expect(all[0]!.to).toBe(a.email);
    expect(all[0]!.subject).toBe("Reset your Frontier password");
    const code = codeIn(all[0]!, "reset");
    expect(all[0]!.text).toContain(`http://localhost:3000/reset/${code}`);
    expect(readFileSync(t.server.people.file, "utf8")).not.toContain(code);
    expect((await t.server.people.get(a.id))!.resetCode!.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sends the explanatory email, with no link to reset, to an account with no password", async () => {
    const a = await account({ password: false, passkey: true });
    await clearMail(t);
    await forgot(a.email);
    const [m] = await outbox(t);
    expect(m!.subject).toBe("About your Frontier password");
    expect(m!.text).toContain("passkey");
    expect(m!.text).not.toMatch(/\/reset\//);
    expect(m!.text).toContain("http://localhost:3000/login");
    expect((await t.server.people.get(a.id))!.resetCode).toBeNull();
  });

  it("does the same for a password the person switched off, and never re-enables it", async () => {
    const a = await account({ passkey: true, off: true });
    await clearMail(t);
    await forgot(a.email);
    const [m] = await outbox(t);
    expect(m!.text).toContain("switched off");
    expect(m!.text).not.toMatch(/\/reset\//);
    const p = (await t.server.people.get(a.id))!;
    expect(p.resetCode).toBeNull();
    expect(p.passwordOff).toBe(true);
    expect(p.passwordHash).not.toBe("");
  });

  it("a password switched off after the link was sent kills the link", async () => {
    const a = await account({ passkey: true });
    await clearMail(t);
    await forgot(a.email);
    const code = codeIn((await outbox(t))[0]!, "reset");
    await t.server.people.update(a.id, (p) => ({ ...p, passwordOff: true }));
    expect((await anon(t, "GET", `/api/reset/${code}`)).statusCode).toBe(410);
    const res = await anon(t, "POST", `/api/reset/${code}`, { password: "a brand new password" });
    expect(res.statusCode).toBe(410);
    expect((await t.server.people.get(a.id))!.passwordOff).toBe(true);
  });

  it("works for an address nobody confirmed, and opening the link confirms it", async () => {
    const a = await account();
    expect((await t.server.people.get(a.id))!.emailConfirmedAt).toBeNull();
    await clearMail(t);
    await forgot(a.email);
    const code = codeIn((await outbox(t))[0]!, "reset");
    expect(
      (await anon(t, "POST", `/api/reset/${code}`, { password: "a brand new password" }))
        .statusCode,
    ).toBe(200);
    const p = (await t.server.people.get(a.id))!;
    expect(p.emailConfirmedAt).not.toBeNull();
    expect(p.emailConfirmedBy).toBe("reset");
  });

  it("a reset sets the password, ends every session, logs nobody in, and works once", async () => {
    const a = await account();
    const first = await loginAs(a.email, "the old password!");
    const cookie = cookieOf(first);
    expect(
      (await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).statusCode,
    ).toBe(200);
    await clearMail(t);
    await forgot(a.email);
    const code = codeIn((await outbox(t))[0]!, "reset");
    expect((await anon(t, "GET", `/api/reset/${code}`)).json()).toEqual({ ok: true });
    const res = await anon(t, "POST", `/api/reset/${code}`, { password: "a brand new password" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(res.headers["set-cookie"]).toBeUndefined();
    // Every earlier session is over, even this browser's.
    expect(
      (await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).statusCode,
    ).toBe(401);
    expect((await loginAs(a.email, "the old password!")).statusCode).toBe(401);
    expect((await loginAs(a.email, "a brand new password")).statusCode).toBe(200);
    // Used.
    const again = await anon(t, "POST", `/api/reset/${code}`, { password: "yet another password" });
    expect(again.statusCode).toBe(410);
    expect(again.json().error.code).toBe("link_invalid");
    expect((await anon(t, "GET", `/api/reset/${code}`)).statusCode).toBe(410);
  });

  it("a link opened by someone else who is logged in changes only the account it belongs to", async () => {
    const a = await account();
    const other = await joined();
    await clearMail(t);
    await forgot(a.email);
    const code = codeIn((await outbox(t))[0]!, "reset");
    const res = await anon(
      t,
      "POST",
      `/api/reset/${code}`,
      { password: "a brand new password" },
      { cookie: other.cookie },
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(await meOf(other.cookie)).toMatchObject({ email: other.email });
    expect((await loginAs(other.email, "a long enough password")).statusCode).toBe(200);
  });

  it("asks for 12 to 500 characters", async () => {
    const a = await account();
    await clearMail(t);
    await forgot(a.email);
    const code = codeIn((await outbox(t))[0]!, "reset");
    for (const password of [
      "short",
      "x".repeat(11),
      "x".repeat(501),
      12 as unknown as string,
      undefined,
    ]) {
      const res = await anon(t, "POST", `/api/reset/${code}`, { password });
      expect(res.statusCode).toBe(400);
    }
    // None of them used the link.
    expect(
      (await anon(t, "POST", `/api/reset/${code}`, { password: "x".repeat(12) })).statusCode,
    ).toBe(200);
    const b = await account();
    await clearMail(t);
    await forgot(b.email);
    const code2 = codeIn((await outbox(t))[0]!, "reset");
    expect(
      (await anon(t, "POST", `/api/reset/${code2}`, { password: "y".repeat(500) })).statusCode,
    ).toBe(200);
  });

  it("lasts 30 minutes and is the same dead answer as an unknown or malformed link", async () => {
    const a = await account();
    await clearMail(t);
    await forgot(a.email);
    const code = codeIn((await outbox(t))[0]!, "reset");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    const late = await anon(t, "GET", `/api/reset/${code}`);
    const latePost = await anon(t, "POST", `/api/reset/${code}`, {
      password: "a brand new password",
    });
    vi.useRealTimers();
    const unknown = await anon(t, "GET", `/api/reset/${"z".repeat(32)}`);
    const malformed = await anon(t, "GET", "/api/reset/short");
    for (const r of [late, unknown, malformed]) {
      expect(r.statusCode).toBe(410);
      expect(r.json()).toEqual(unknown.json());
    }
    expect(latePost.statusCode).toBe(410);
    expect(await loginAs(a.email, "the old password!")).toMatchObject({ statusCode: 200 });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 29 * 60_000);
    expect((await anon(t, "GET", `/api/reset/${code}`)).statusCode).toBe(200);
  });

  it("is used by exactly one of several requests at once", async () => {
    const a = await account();
    await clearMail(t);
    await forgot(a.email);
    const code = codeIn((await outbox(t))[0]!, "reset");
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        anon(t, "POST", `/api/reset/${code}`, { password: `a brand new password ${i}` }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 410)).toHaveLength(3);
  });

  it("a newer link replaces the older, and a password change kills a link still out", async () => {
    const a = await account();
    await clearMail(t);
    await forgot(a.email);
    const first = codeIn((await outbox(t))[0]!, "reset");
    await clearMail(t);
    await forgot(a.email);
    const second = codeIn((await outbox(t))[0]!, "reset");
    expect(second).not.toBe(first);
    expect((await anon(t, "GET", `/api/reset/${first}`)).statusCode).toBe(410);
    expect((await anon(t, "GET", `/api/reset/${second}`)).statusCode).toBe(200);
    const cookie = cookieOf(await loginAs(a.email, "the old password!"));
    const put = await t.app.inject({
      method: "PUT",
      url: "/api/me/password",
      headers: { cookie },
      payload: { current: "the old password!", password: "changed it myself!" },
    });
    expect(put.statusCode).toBe(200);
    expect((await anon(t, "GET", `/api/reset/${second}`)).statusCode).toBe(410);
  });

  it("a badly formed address is refused as such, and sends nothing", async () => {
    await clearMail(t);
    for (const email of ["nope", "", "a@b.co\r\nBcc: x@y.zz"]) {
      const res = await forgot(email);
      expect(res.statusCode).toBe(400);
    }
    expect((await anon(t, "POST", "/api/forgot-password", {})).statusCode).toBe(400);
    expect(await outbox(t)).toHaveLength(0);
  });

  it("allows 3 requests an hour per address, counted whether or not the address has an account", async () => {
    const real = await account();
    for (const email of [real.email, "ghost.limit@nowhere.example"]) {
      const results = [];
      for (let i = 0; i < 4; i++) results.push(await forgot(email));
      expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 429]);
      expect(results[3]!.json().error.message).toBe(
        "Too many requests. Try again in a few minutes.",
      );
    }
    // Other addresses are not held back by it.
    expect((await forgot(fresh())).statusCode).toBe(200);
  });

  it("allows 10 requests an hour from one network address", async () => {
    const results = [];
    for (let i = 0; i < 11; i++)
      results.push(await forgot(fresh(), { "x-forwarded-for": "172.16.9.9" }));
    expect(results.map((r) => r.statusCode)).toEqual([...Array(10).fill(200), 429]);
    expect((await forgot(fresh(), { "x-forwarded-for": "172.16.9.10" })).statusCode).toBe(200);
  });

  it("when the relay fails the answer is the same", async () => {
    const a = await account();
    t.server.mail.outbox!.failNext = 1;
    const res = await forgot(a.email);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(JSON.stringify({ ok: true }));
    await t.server.mail.settled();
  });
});

describe("the log", () => {
  it("never holds a code, a link or a message", async () => {
    const a = await joined();
    const code = codeIn((await mailTo(t, a.email))[0]!, "confirm");
    await anon(t, "POST", `/api/confirm/${code}`);
    await anon(t, "GET", `/api/reset/${code}`);
    await anon(t, "POST", `/api/reset/${code}`, { password: "a long enough password" });
    await anon(t, "POST", "/api/forgot-password", { email: a.email });
    await t.server.mail.settled();
    const log = LOG.join("");
    expect(log).toContain("/api/confirm/:code");
    expect(log).toContain("/api/reset/:code");
    expect(log).not.toContain(code);
    expect(log).not.toContain("a long enough password");
    expect(log).not.toContain("Confirm my email");
    expect(log).not.toContain(a.email);
  });

  it("a relay failure is logged by its code only", async () => {
    const before = LOG.length;
    const { email } = await joined();
    void email;
    t.server.mail.outbox!.failNext = 1;
    const { body } = await invite({ role: "writer", email: "logged.failure@example.org" });
    expect(body.mail).toBe("failed");
    const text = LOG.slice(before).join("");
    expect(text).not.toContain("logged.failure@example.org");
  });
});

describe("the request check", () => {
  it("refuses the new POST routes from another site, as the rest", async () => {
    const { cookie } = await joined();
    for (const url of [
      "/api/me/email",
      "/api/me/email/resend",
      "/api/forgot-password",
      "/api/confirm/x",
      "/api/reset/x",
    ]) {
      const res = await t.app.inject({
        method: "POST",
        url,
        headers: { cookie, "sec-fetch-site": "cross-site" },
        payload: { email: "a@b.co", password: "x".repeat(12) },
      });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code).toBe("not_allowed");
    }
    const del = await t.app.inject({
      method: "DELETE",
      url: "/api/me/email/pending",
      headers: { cookie, "sec-fetch-site": "cross-site" },
    });
    expect(del.statusCode).toBe(403);
  });
});

describe("the test hook", () => {
  it("shows what the memory transport kept, and clears it", async () => {
    await joined();
    const res = await anon(t, "GET", "/api/test/mail");
    expect(res.json().messages.length).toBeGreaterThan(0);
    expect((await anon(t, "DELETE", "/api/test/mail")).json()).toEqual({ ok: true });
    expect((await anon(t, "GET", "/api/test/mail")).json().messages).toEqual([]);
  });
});
