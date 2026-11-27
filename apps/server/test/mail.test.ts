/** Sending mail (stage 28): the configuration, the relay, the five emails, and what is never logged. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, loadConfig, parseSender } from "../src/config.js";
import {
  Mail,
  mailable,
  MailError,
  MemoryTransport,
  oneLine,
  smtpTransport,
} from "../src/mail/mailer.js";
import {
  addressChangedMail,
  confirmMail,
  escapeHtml,
  inviteMail,
  maskAddress,
  noPasswordMail,
  resetMail,
} from "../src/mail/templates.js";
import { redactAddress } from "../src/app.js";
import { testEnv } from "./helpers/app.js";
import { makeTestRepo } from "./helpers/repo.js";
import { FakeRelay } from "./helpers/smtp.js";

const from = { name: "Frontier", address: "noreply@haviv.pro" };
afterEach(() => vi.useRealTimers());

describe("configuration", () => {
  const load = (extra: Record<string, string>) => {
    const repo = makeTestRepo();
    try {
      return loadConfig(testEnv(repo, extra)).mail;
    } finally {
      repo.cleanup();
    }
  };

  it("is off unless both SMTP_HOST and MAIL_FROM are given", () => {
    expect(load({})).toBeNull();
    expect(() => load({ SMTP_HOST: "relay" })).toThrow(/both SMTP_HOST and MAIL_FROM/);
    expect(() => load({ MAIL_FROM: "a@b.co" })).toThrow(/both SMTP_HOST and MAIL_FROM/);
  });

  it("reads a private relay: port 587, opportunistic STARTTLS, no login", () => {
    expect(load({ SMTP_HOST: "mail-relay", MAIL_FROM: "Frontier <noreply@haviv.pro>" })).toEqual({
      kind: "smtp",
      host: "mail-relay",
      port: 587,
      security: "starttls",
      user: null,
      password: null,
      from: { name: "Frontier", address: "noreply@haviv.pro" },
    });
  });

  it("reads the port, the security setting and a login", () => {
    expect(
      load({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "465",
        SMTP_SECURE: "TLS",
        SMTP_USER: "u",
        SMTP_PASSWORD: "p",
        MAIL_FROM: "noreply@example.com",
      }),
    ).toMatchObject({
      port: 465,
      security: "tls",
      user: "u",
      password: "p",
      from: { name: "Frontier" },
    });
  });

  it("says what is wrong with each setting", () => {
    const ok = { SMTP_HOST: "r", MAIL_FROM: "a@b.co" };
    expect(() => load({ ...ok, MAIL_FROM: "not an address" })).toThrow(/MAIL_FROM must look like/);
    expect(() => load({ ...ok, SMTP_PORT: "0" })).toThrow(/SMTP_PORT/);
    expect(() => load({ ...ok, SMTP_PORT: "abc" })).toThrow(/SMTP_PORT/);
    expect(() => load({ ...ok, SMTP_SECURE: "maybe" })).toThrow(/SMTP_SECURE/);
    expect(() => load({ ...ok, SMTP_USER: "u" })).toThrow(/go together/);
    expect(() => load({ ...ok, SMTP_PASSWORD: "p" })).toThrow(/go together/);
    expect(() => load({ ...ok, SMTP_HOST: "a b" })).toThrow(/SMTP_HOST/);
    expect(() => load({ ...ok, SMTP_HOST: "smtp://x" })).toThrow(ConfigError);
  });

  it("the memory transport is for tests and cannot exist in production", () => {
    expect(load({ MAIL_TEST_TRANSPORT: "memory" })).toEqual({
      kind: "memory",
      from: { name: "Frontier", address: "noreply@frontier.test" },
    });
    expect(load({ MAIL_TEST_TRANSPORT: "memory", MAIL_FROM: "X <x@y.zz>" })).toMatchObject({
      from: { name: "X", address: "x@y.zz" },
    });
    expect(load({ MAIL_TEST_TRANSPORT: "memory", MAIL_FROM: "nonsense" })).toMatchObject({
      from: { address: "noreply@frontier.test" },
    });
    expect(() => load({ MAIL_TEST_TRANSPORT: "memory", NODE_ENV: "production" })).toThrow(
      /cannot be set in production/,
    );
    expect(() => load({ MAIL_TEST_TRANSPORT: "file" })).toThrow(/memory/);
  });

  it("parses a sender, and refuses one that could end a header line", () => {
    expect(parseSender("Frontier <noreply@haviv.pro>")).toEqual(from);
    expect(parseSender('"Quoted Name" <a@b.co>')).toEqual({
      name: "Quoted Name",
      address: "a@b.co",
    });
    expect(parseSender("a@b.co")).toEqual({ name: "Frontier", address: "a@b.co" });
    expect(parseSender("A\r\nBcc: x@y.zz <a@b.co>")).toBeNull();
    expect(parseSender("Frontier <a@b.co>, <c@d.co>")).toBeNull();
    expect(parseSender("")).toBeNull();
  });
});

describe("addresses and subjects", () => {
  it("lets one plain address through and nothing that could add a recipient or a header", () => {
    expect(mailable("a.b+c@example.org")).toBe(true);
    for (const bad of [
      "a@b",
      "a b@c.co",
      "a@b.co\r\nBcc: x@y.zz",
      "a@b.co,c@d.co",
      "<a@b.co>",
      '"a"@b.co',
      "a@b@c.co",
      "",
      `${"a".repeat(250)}@b.co`,
    ]) {
      expect(mailable(bad), bad).toBe(false);
    }
  });

  it("puts a subject on one line, without control characters, and not too long", () => {
    expect(oneLine("Hi\r\nBcc: x y\u0000z")).toBe("Hi Bcc: x y z");
    expect(oneLine("x".repeat(500))).toHaveLength(150);
  });

  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("masks an address to its first letter and its domain", () => {
    expect(maskAddress("yael@example.net")).toBe("y•••@example.net");
    expect(maskAddress("nonsense")).toBe("•••");
  });
});

describe("the five emails", () => {
  const url = "https://frontier.example/confirm/abc";
  const all = () => [
    inviteMail({
      from,
      inviter: "Elad Haviv",
      project: "Avalymia",
      role: "writer",
      url: "https://frontier.example/join/abc",
      expiresAt: "2026-12-04T10:00:00.000Z",
    }),
    confirmMail({ from, name: "Yael Cohen", address: "yael@example.org", url }),
    resetMail({ from, url: "https://frontier.example/reset/abc" }),
    noPasswordMail({
      from,
      loginUrl: "https://frontier.example/login",
      ways: { google: true, passkey: true, passwordOff: false },
    }),
    addressChangedMail({
      from,
      phase: "asked",
      oldAddress: "yael@example.org",
      newAddress: "yael@example.net",
      openUrl: "https://frontier.example/",
    }),
  ];

  it("each has plain text, simple HTML with one button and the link as text, and who sent it", () => {
    for (const m of all()) {
      expect(m.text.length).toBeGreaterThan(50);
      expect(m.html).toContain("<a href=");
      expect(m.html.match(/<a /g)).toHaveLength(1);
      expect(m.html).not.toMatch(/<img|<script|<link|<iframe|tracking|pixel/i);
      expect(m.text).toContain("Sent by Frontier (noreply@haviv.pro)");
      expect(m.text).toMatch(/ignore this email|If this was not you/);
      expect(m.subject).not.toMatch(/[\r\n]/);
    }
  });

  it("the invite says who, where, for how long, and that the link goes with whoever holds it", () => {
    const m = all()[0]!;
    expect(m.subject).toBe("Elad Haviv invited you to Avalymia on Frontier");
    expect(m.text).toContain("Elad Haviv invited you to write in Avalymia, a project on Frontier.");
    expect(m.text).toContain("stops working on 4 December");
    expect(m.text).toContain("Anyone who opens it can join with it");
    expect(m.text).toContain("ask Elad Haviv directly");
  });

  it("the invite words each role, and escapes the names it was given", () => {
    const role = (r: "owner" | "writer" | "reader") =>
      inviteMail({
        from,
        inviter: "E",
        project: "P",
        role: r,
        url,
        expiresAt: "2026-12-04T00:00:00Z",
      }).text;
    expect(role("owner")).toContain("help look after");
    expect(role("reader")).toContain("read P");
    const evil = inviteMail({
      from,
      inviter: `<script>alert(1)</script>`,
      project: `A "B" & C`,
      role: "writer",
      url,
      expiresAt: "2026-12-04T00:00:00Z",
    });
    expect(evil.html).not.toContain("<script>");
    expect(evil.html).toContain("&lt;script&gt;");
    expect(evil.html).toContain("A &quot;B&quot; &amp; C");
  });

  it("the confirm email greets by first name, or not at all", () => {
    expect(confirmMail({ from, name: "Yael Cohen", address: "y@e.co", url }).text).toContain(
      "Hello Yael, please confirm",
    );
    expect(confirmMail({ from, name: "", address: "y@e.co", url }).text).toContain(
      "Please confirm that y@e.co",
    );
  });

  it("the no-password email says how the account does log in", () => {
    const text = (ways: { google: boolean; passkey: boolean; passwordOff: boolean }) =>
      noPasswordMail({ from, loginUrl: url, ways }).text;
    expect(text({ google: true, passkey: false, passwordOff: false })).toContain(
      "log in with Google.",
    );
    expect(text({ google: false, passkey: true, passwordOff: false })).toContain(
      "log in with a passkey.",
    );
    expect(text({ google: true, passkey: true, passwordOff: false })).toContain(
      "Google or a passkey",
    );
    expect(text({ google: false, passkey: false, passwordOff: false })).toContain("another way");
    expect(text({ google: false, passkey: true, passwordOff: true })).toContain("switched off");
    expect(text({ google: false, passkey: true, passwordOff: true })).toContain("switch it on");
  });

  it("the address-changed email masks the new address, when asked and when done", () => {
    const asked = all()[4]!;
    expect(asked.subject).toBe("Your Frontier email address is being changed");
    expect(asked.text).toContain("y•••@example.net");
    expect(asked.text).not.toContain("yael@example.net");
    expect(asked.text).toContain("Nothing changes until the new address is confirmed");
    const done = addressChangedMail({
      from,
      phase: "done",
      oldAddress: "yael@example.org",
      newAddress: "yael@example.net",
      openUrl: url,
    });
    expect(done.subject).toBe("Your Frontier email address has been changed");
    expect(done.text).toContain("was changed from yael@example.org to y•••@example.net");
    expect(done.text).not.toContain("yael@example.net");
  });
});

describe("the mail service", () => {
  const message = { to: "a@example.org", subject: "S", text: "t", html: "<p>t</p>" };

  it("with no relay says it is off and sends nothing", async () => {
    const mail = Mail.from(null);
    expect(mail.enabled).toBe(false);
    expect(mail.outbox).toBeNull();
    await expect(mail.send(message)).rejects.toMatchObject({ reason: "off" });
  });

  it("refuses an address mail cannot go to, before the relay is asked", async () => {
    const mail = Mail.from({ kind: "memory", from });
    await expect(mail.send({ ...message, to: "a@b.co\r\nBcc: x@y.zz" })).rejects.toMatchObject({
      reason: "address",
    });
    expect(mail.outbox!.messages).toHaveLength(0);
  });

  it("keeps a message, with its subject on one line", async () => {
    const mail = Mail.from({ kind: "memory", from });
    await mail.send({ ...message, subject: "One\r\nTwo" });
    expect(mail.outbox!.messages[0]).toMatchObject({
      to: "a@example.org",
      subject: "One Two",
      from,
    });
  });

  it("turns a relay failure into one error, logging its code and never the message", async () => {
    const warn = vi.fn();
    const mail = new Mail(
      {
        deliver: async () => {
          throw Object.assign(new Error("550 <a@example.org> rejected: SECRET BODY"), {
            code: "EENVELOPE",
            responseCode: 550,
          });
        },
      },
      from,
    );
    mail.logTo({ warn });
    await expect(mail.send(message)).rejects.toMatchObject({
      reason: "relay",
      message: "The mail relay did not take the message.",
    });
    expect(warn).toHaveBeenCalledWith({ code: "EENVELOPE", responseCode: 550 }, expect.any(String));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("example.org");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET");
    // With no logger set it is silent, and with an error that has no code it still says so.
    const quiet = new Mail({ deliver: async () => Promise.reject("nope") }, from);
    await expect(quiet.send(message)).rejects.toBeInstanceOf(MailError);
  });

  it("gives up on a relay that does not answer", async () => {
    vi.useFakeTimers();
    const mail = new Mail({ deliver: () => new Promise(() => undefined) }, from);
    const sent = mail.send(message);
    const result = expect(sent).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(21_000);
    await result;
  });

  it("runs background work, logs a failure by its code, and says when it is all done", async () => {
    const warn = vi.fn();
    const mail = Mail.from({ kind: "memory", from });
    mail.logTo({ warn });
    let done = false;
    mail.background(async () => {
      await new Promise((r) => setTimeout(r, 30));
      done = true;
    });
    mail.background(() => Promise.reject(Object.assign(new Error("x"), { code: "BOOM" })));
    mail.background(() => Promise.reject(new Error("no code")));
    expect(done).toBe(false);
    await mail.settled();
    expect(done).toBe(true);
    expect(warn).toHaveBeenCalledWith({ code: "BOOM" }, "Mail work failed");
    expect(warn).toHaveBeenCalledWith({ code: "" }, "Mail work failed");
    // Without a logger, a failure is simply dropped.
    const silent = Mail.from(null);
    silent.background(() => Promise.reject(new Error("x")));
    await silent.settled();
  });

  it("the memory transport can fail on demand and be slow", async () => {
    const memory = new MemoryTransport();
    memory.failNext = 1;
    await expect(memory.deliver(from, message)).rejects.toThrow();
    memory.delayMs = 20;
    await memory.deliver(from, message);
    expect(memory.messages).toHaveLength(1);
  });
});

describe("a relay over SMTP", () => {
  const config = (port: number, extra: object = {}) => ({
    kind: "smtp" as const,
    host: "127.0.0.1",
    port,
    security: "starttls" as const,
    user: null,
    password: null,
    from,
    ...extra,
  });

  it("takes a message from a private relay that offers no encryption (opportunistic STARTTLS)", async () => {
    const relay = await new FakeRelay().start();
    try {
      const mail = new Mail(smtpTransport(config(relay.port)), from);
      await mail.send({
        to: "yael@example.org",
        subject: "Confirm your email address for Frontier",
        text: "Plain text body",
        html: "<p>Html body</p>",
      });
      const got = relay.received[0]!;
      expect(got.from).toBe("noreply@haviv.pro");
      expect(got.to).toEqual(["yael@example.org"]);
      expect(got.data).toContain("Subject: Confirm your email address for Frontier");
      expect(got.data).toContain("From: Frontier <noreply@haviv.pro>");
      expect(got.data).toContain("Auto-Submitted: auto-generated");
      expect(got.data).toContain("Plain text body");
      expect(got.data).toContain("Html body");
      expect(got.authenticated).toBeNull();
    } finally {
      await relay.stop();
    }
  });

  it("logs in when it has a user and password", async () => {
    const relay = await new FakeRelay({ user: "frontier", pass: "s3cret" }).start();
    try {
      const good = new Mail(
        smtpTransport(config(relay.port, { user: "frontier", password: "s3cret" })),
        from,
      );
      await good.send({ to: "a@example.org", subject: "S", text: "t", html: "<p>t</p>" });
      expect(relay.received[0]!.authenticated).toBe("frontier");
      const bad = new Mail(
        smtpTransport(config(relay.port, { user: "frontier", password: "wrong" })),
        from,
      );
      await expect(
        bad.send({ to: "a@example.org", subject: "S", text: "t", html: "<p>t</p>" }),
      ).rejects.toMatchObject({ reason: "relay" });
    } finally {
      await relay.stop();
    }
  });

  it("is refused by `required` when the relay offers no encryption, and works with `none`", async () => {
    const relay = await new FakeRelay().start();
    try {
      const message = { to: "a@example.org", subject: "S", text: "t", html: "<p>t</p>" };
      await expect(
        new Mail(smtpTransport(config(relay.port, { security: "required" }), 400), from).send(
          message,
        ),
      ).rejects.toMatchObject({ reason: "relay" });
      await new Mail(smtpTransport(config(relay.port, { security: "none" })), from).send(message);
      expect(relay.received).toHaveLength(1);
    } finally {
      await relay.stop();
    }
  });

  it("a relay that refuses the recipient, or is not there, is a failure and not a crash", async () => {
    const relay = await new FakeRelay().start();
    relay.refuse = true;
    const message = { to: "a@example.org", subject: "S", text: "t", html: "<p>t</p>" };
    await expect(
      new Mail(smtpTransport(config(relay.port)), from).send(message),
    ).rejects.toMatchObject({ reason: "relay" });
    await relay.stop();
    await expect(
      new Mail(smtpTransport(config(relay.port)), from).send(message),
    ).rejects.toMatchObject({ reason: "relay" });
  });

  it("builds the transport for implicit TLS without connecting", () => {
    expect(smtpTransport({ ...config(465), security: "tls" })).toHaveProperty("deliver");
  });
});

describe("the log", () => {
  it("writes no code in a confirm, reset or join address, nor in a query", () => {
    expect(redactAddress("/confirm/abcDEF123_-xyz")).toBe("/confirm/:code");
    expect(redactAddress("/api/confirm/abcDEF123_-xyz")).toBe("/api/confirm/:code");
    expect(redactAddress("/reset/abcDEF123_-xyz?x=1")).toBe("/reset/:code?x=1");
    expect(redactAddress("/api/reset/abcDEF123_-xyz")).toBe("/api/reset/:code");
    expect(redactAddress("/api/join/abcDEF123_-xyz/passkey/options")).toBe(
      "/api/join/:code/passkey/options",
    );
    expect(redactAddress("/%61pi/reset/abcDEF123_-xyz")).toBe("/%61pi/reset/:code");
    expect(redactAddress("/api/me/email")).toBe("/api/me/email");
  });
});
