// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import type { InviteSummary, MembersResponse } from "@frontier/schema";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAccess } from "../../access.ts";
import { setKeysOwner } from "../../aiKeys.ts";
import { clearMe, noteMe } from "../../me.ts";
import { setCurrentProject } from "../../project.ts";
import { answer, failure, type Mounted, mount, stubServer } from "../../testing/mount.ts";
import { emailInfo, person } from "../../testing/email.ts";
import { ALPHA } from "../../testing/switchProject.ts";
import { Members } from "./Members.tsx";
import { inviteFailure, inviteNote, resentWords, sentLine } from "./membersModel.ts";

const NOW = new Date().toISOString();
const row = (id: string, name: string, role: "owner" | "writer" | "reader", over = {}) => ({
  id,
  name,
  email: `${name.split(" ")[0]!.toLowerCase()}@example.com`,
  role,
  addedAt: NOW,
  lastActiveAt: NOW,
  you: false,
  unconfirmed: false,
  ...over,
});
const OWNERS: MembersResponse = {
  canManage: true,
  members: [
    row("p1", "Olive Owner", "owner", { you: true }),
    row("p2", "Yael Stern", "writer", { unconfirmed: true }),
    row("p3", "Noam Peretz", "reader"),
  ],
};
const invite = (over: Partial<InviteSummary> = {}): InviteSummary => ({
  id: "i1",
  role: "writer",
  createdBy: { id: "p1", name: "Olive Owner" },
  createdAt: NOW,
  expiresAt: NOW,
  secondsLeft: 6 * 86400,
  sentTo: null,
  mail: null,
  ...over,
});
const made = (over = {}) => ({
  id: "i2",
  code: "c".repeat(32),
  path: `/join/${"c".repeat(32)}`,
  url: `http://localhost/join/${"c".repeat(32)}`,
  role: "writer",
  expiresAt: NOW,
  sentTo: null,
  mail: null,
  ...over,
});

let mounted: Mounted | null = null;
beforeEach(() => {
  setKeysOwner("p1");
  setCurrentProject(ALPHA);
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
  resetAccess();
  clearMe();
  setCurrentProject(null);
  setKeysOwner(null);
});

async function owners(
  mail: boolean | null,
  waiting: InviteSummary[] = [],
  extra: Parameters<typeof stubServer>[0] = () => undefined,
) {
  if (mail !== null) noteMe(person({ emailInfo: emailInfo({ mailOn: mail }) }));
  const calls = stubServer(async (url, method, body) => {
    const reply = await extra(url, method, body);
    if (reply) return reply;
    if (url.endsWith("/members")) return answer(OWNERS);
    if (url.endsWith("/invites") && method === "GET") return answer({ invites: waiting });
    return answer({ ok: true });
  });
  mounted = await mount(createElement(Members));
  await mounted.settle();
  return { m: mounted, calls };
}
const submit = (m: Mounted) =>
  act(
    async () =>
      void m
        .one("form.invite-form")
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );

describe("Members: the unconfirmed mark", () => {
  it("is a dashed tag beside the address of a person nobody confirmed, for an owner", async () => {
    const { m } = await owners(true);
    const yael = m.one('[data-member="p2"]');
    expect(yael.querySelector(".tag-unconfirmed")?.textContent).toBe("Unconfirmed");
    expect(yael.querySelector(".tag-unconfirmed")?.getAttribute("title")).toBe(
      "yael@example.com has not been confirmed yet",
    );
    // Confirmed people show nothing, and the address stays where it was.
    expect(m.one('[data-member="p3"]').querySelector(".tag-unconfirmed")).toBeNull();
    expect(yael.textContent).toContain("yael@example.com");
  });

  it("is not drawn for a reader or writer, who see no addresses and so no marks", async () => {
    noteMe(person());
    stubServer((url) =>
      url.endsWith("/members")
        ? answer({
            canManage: false,
            members: [
              row("p1", "Olive Owner", "owner", { email: null, unconfirmed: null }),
              row("p2", "Yael Stern", "writer", { email: null, unconfirmed: null, you: true }),
            ],
          } satisfies MembersResponse)
        : answer({ invites: [] }),
    );
    mounted = await mount(createElement(Members), {
      ...(await import("../../testing/mount.ts")).projectInfo({ role: "writer" }),
    });
    await mounted.settle();
    expect(mounted.host.querySelector(".tag-unconfirmed")).toBeNull();
  });
});

describe("Members: the invite box with mail on", () => {
  it("has an optional address, and a button that says what it does", async () => {
    const { m } = await owners(true);
    const field = m.one<HTMLInputElement>('input[type="email"]');
    expect(m.one("label[for]:has(+ input[type=email])").textContent).toContain("Send it to");
    expect(field.autocomplete).toBe("off");
    expect(m.host.textContent).toContain("We email the link, and you still get it here to copy.");
    expect(m.host.textContent).toContain("Anyone who opens it can join with it");
    expect(m.host.textContent).toContain("The link works once and for 7 days.");
    expect(m.one('button[type="submit"]').textContent?.trim()).toBe("Make the link");
    await m.change(field, "yael@example.org");
    expect(m.one('button[type="submit"]').textContent?.trim()).toBe("Send the invite");
    await m.change(field, "");
    expect(m.one('button[type="submit"]').textContent?.trim()).toBe("Make the link");
  });

  it("sends the role and the address, and says it was sent, with the link still shown", async () => {
    const link = made({ sentTo: "yael@example.org", mail: "sent" });
    const { m, calls } = await owners(true, [], (url, method) =>
      url.endsWith("/invites") && method === "POST" ? answer(link, 201) : undefined,
    );
    await m.change(m.one('input[type="email"]'), " yael@example.org ");
    await submit(m);
    await m.settle();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      role: "writer",
      email: "yael@example.org",
    });
    const group = m.one('[role="group"][aria-label="The invite link"]');
    expect(group.textContent).toContain("Sent to yael@example.org.");
    expect(m.one("[data-testid=invite-link]").textContent).toBe(link.url);
    expect(group.textContent).toContain(
      "Anyone who opens it can join with it, whoever you send it to.",
    );
    expect(group.textContent).not.toContain("Frontier sends no mail");
    // The field is emptied, so the next invitation starts clean.
    expect(m.one<HTMLInputElement>('input[type="email"]').value).toBe("");
  });

  it("makes only a link when no address is given, with nothing about mail in the answer", async () => {
    const { m, calls } = await owners(true, [], (url, method) =>
      url.endsWith("/invites") && method === "POST" ? answer(made(), 201) : undefined,
    );
    await submit(m);
    await m.settle();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ role: "writer" });
    expect(m.one('[role="group"]').textContent).not.toContain("Sent to");
  });

  it("says the email failed and still shows the link", async () => {
    const link = made({ sentTo: "yael@example.org", mail: "failed" });
    const { m } = await owners(true, [], (url, method) =>
      url.endsWith("/invites") && method === "POST" ? answer(link, 201) : undefined,
    );
    await m.change(m.one('input[type="email"]'), "yael@example.org");
    await submit(m);
    await m.settle();
    const group = m.one('[role="group"]');
    expect(group.textContent).toContain(
      "We made the link but could not send the email to yael@example.org.",
    );
    expect(m.one("[data-testid=invite-link]").textContent).toBe(link.url);
  });

  it("says a badly formed address does not look like one, sends nothing, and puts the focus there", async () => {
    const { m, calls } = await owners(true);
    await m.change(m.one('input[type="email"]'), "nope");
    await submit(m);
    expect(m.one('[role="alert"]').textContent).toBe("That doesn't look like an email address.");
    expect(document.activeElement).toBe(m.one('input[type="email"]'));
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("submits on Enter in the address field, which is a form", async () => {
    const { m } = await owners(true);
    expect(m.one('input[type="email"]').closest("form")).toBe(m.one("form.invite-form"));
  });

  it("says try again later when too many invitations were emailed", async () => {
    const { m } = await owners(true, [], (url, method) =>
      url.endsWith("/invites") && method === "POST"
        ? failure(429, "rate_limited", "Too many requests. Try again later.")
        : undefined,
    );
    await m.change(m.one('input[type="email"]'), "yael@example.org");
    await submit(m);
    await m.settle();
    expect(m.one('[role="alert"]').textContent).toBe(
      "Too many invitations were emailed this hour. Try again later.",
    );
  });

  it("lists where an invitation was emailed, with Resend, and a link made by hand with none", async () => {
    const { m } = await owners(true, [
      invite({ id: "a", sentTo: "yael@example.org", mail: "sent" }),
      invite({ id: "b", sentTo: "noam@example.org", mail: "failed" }),
      invite({ id: "c", sentTo: "dana@example.org", mail: null }),
      invite({ id: "d" }),
    ]);
    const rows = [...m.host.querySelectorAll(".invite-row")];
    expect(rows[0]!.textContent).toContain("Sent to yael@example.org · Made by Olive Owner");
    expect(rows[1]!.textContent).toContain("Could not send to noam@example.org");
    expect(rows[2]!.textContent).toContain("Sending to dana@example.org…");
    expect(rows[3]!.textContent).toContain("Made by Olive Owner · not used yet");
    expect(rows[3]!.textContent).not.toContain("Sent to");
    const names = rows.map((r) =>
      [...r.querySelectorAll("button")].map((b) => b.textContent?.trim()),
    );
    expect(names).toEqual([
      ["Resend", "Cancel it"],
      ["Resend", "Cancel it"],
      ["Resend", "Cancel it"],
      ["Cancel it"],
    ]);
  });

  it("resends by making a new link, and says so", async () => {
    const fresh = made({ id: "i9", sentTo: "yael@example.org", mail: "sent" });
    const { m, calls } = await owners(
      true,
      [invite({ id: "a", sentTo: "yael@example.org", mail: "sent" })],
      (url, method) =>
        url.endsWith("/invites/a/resend") && method === "POST" ? answer(fresh, 201) : undefined,
    );
    await m.click(m.withText("button", "Resend")!);
    await m.settle();
    expect(calls.some((c) => c.url.endsWith("/invites/a/resend"))).toBe(true);
    expect(m.one('[aria-labelledby="waiting-h"] .said').textContent).toBe(
      "Sent again to yael@example.org. The earlier link no longer works; this one lasts 7 days.",
    );
  });

  it("does not take away a link on the screen for an invitation that was emailed and sent again", async () => {
    const own = made({ id: "i2" });
    const fresh = made({
      id: "i9",
      url: "http://localhost/join/fresh",
      sentTo: "yael@example.org",
      mail: "sent",
    });
    const { m } = await owners(
      true,
      [invite({ id: "a", sentTo: "yael@example.org", mail: "sent" })],
      (url, method) =>
        url.endsWith("/resend") && method === "POST"
          ? answer(fresh, 201)
          : url.endsWith("/invites") && method === "POST"
            ? answer(own, 201)
            : undefined,
    );
    await submit(m);
    await m.settle();
    await m.click(m.withText("button", "Resend")!);
    await m.settle();
    // The link made by hand is still the one shown; the emailed one went to its address.
    expect(m.one("[data-testid=invite-link]").textContent).toBe(own.url);
  });

  it("shows the new link when a resend could not be emailed, so it can be copied", async () => {
    const fresh = made({ id: "i9", sentTo: "yael@example.org", mail: "failed" });
    const { m } = await owners(
      true,
      [invite({ id: "a", sentTo: "yael@example.org", mail: "sent" })],
      (url, method) =>
        url.endsWith("/resend") && method === "POST" ? answer(fresh, 201) : undefined,
    );
    await m.click(m.withText("button", "Resend")!);
    await m.settle();
    expect(m.one("[data-testid=invite-link]").textContent).toBe(fresh.url);
    expect(m.host.textContent).toContain("We made a new link but could not send the email");
  });

  it("shows the new link in its own row when a resend could not be emailed and another link is on the screen", async () => {
    const own = made({ id: "i2" });
    const fresh = made({
      id: "i9",
      url: "http://localhost/join/fresh",
      sentTo: "yael@example.org",
      mail: "failed",
    });
    let resent = false;
    const { m } = await owners(
      true,
      [invite({ id: "a", sentTo: "yael@example.org", mail: "sent" })],
      (url, method) =>
        url.endsWith("/resend") && method === "POST"
          ? ((resent = true), answer(fresh, 201))
          : url.endsWith("/invites") && method === "POST"
            ? answer(own, 201)
            : url.endsWith("/invites") && method === "GET" && resent
              ? answer({
                  invites: [invite({ id: "i9", sentTo: "yael@example.org", mail: "failed" })],
                })
              : undefined,
    );
    await submit(m);
    await m.settle();
    await m.click(m.withText("button", "Resend")!);
    await m.settle();
    // Nothing was asked and nothing replaced: the link made by hand is still the one above...
    expect(document.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull();
    expect(m.one("[data-testid=invite-link]").textContent).toBe(own.url);
    // ...and the new one, which could not be emailed, is with the invitation it belongs to.
    const rowLink = m.one(".invite-row [data-testid=invite-row-link]");
    expect(rowLink.textContent).toBe(fresh.url);
    expect(rowLink.closest(".invite-row")!.textContent).toContain("could not send the email");
  });

  it("says try again later when a resend meets the limit", async () => {
    const { m } = await owners(
      true,
      [invite({ id: "a", sentTo: "yael@example.org", mail: "sent" })],
      (url, method) =>
        url.endsWith("/resend") && method === "POST"
          ? failure(429, "rate_limited", "x")
          : undefined,
    );
    await m.click(m.withText("button", "Resend")!);
    await m.settle();
    expect(m.host.textContent).toContain("Try again later.");
  });
});

describe("Members: the invite box with mail off, or not known yet", () => {
  it("says the server cannot send email, has no address field, and keeps today's button and note", async () => {
    const { m, calls } = await owners(false, [invite({ id: "a", sentTo: null })], (url, method) =>
      url.endsWith("/invites") && method === "POST" ? answer(made(), 201) : undefined,
    );
    expect(m.host.textContent).toContain(
      "This server cannot send email, so copy the link and send it yourself.",
    );
    expect(m.host.querySelector('input[type="email"]')).toBeNull();
    const button = m.withText("button", "Make an invite link")!;
    expect(button).not.toBeNull();
    await m.click(button);
    await m.settle();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ role: "writer" });
    expect(m.one('[role="group"]').textContent).toContain("Frontier sends no mail");
    expect(m.host.textContent).not.toContain("Resend");
  });

  it("draws nothing about mail until it is known", async () => {
    const { m } = await owners(null);
    expect(m.host.textContent).not.toContain("cannot send email");
    expect(m.host.querySelector('input[type="email"]')).toBeNull();
    expect(m.withText("button", "Make an invite link")).not.toBeNull();
  });
});

describe("the words of emailed invitations", () => {
  it("names the sent state of a waiting invitation", () => {
    expect(sentLine({ sentTo: null, mail: null })).toBeNull();
    expect(sentLine({ sentTo: "a@b.co", mail: "sent" })).toBe("Sent to a@b.co");
    expect(sentLine({ sentTo: "a@b.co", mail: "failed" })).toBe("Could not send to a@b.co");
    expect(sentLine({ sentTo: "a@b.co", mail: null })).toBe("Sending to a@b.co…");
  });

  it("words each refusal", () => {
    expect(inviteFailure("mail_off", "")).toContain("cannot send email");
    expect(inviteFailure("invite_used", "")).toContain("already used");
    expect(inviteFailure("invite_expired", "")).toContain("run out");
    expect(inviteFailure("not_found", "")).toContain("gone");
    expect(inviteFailure("other", "Their words.")).toBe("Their words.");
  });

  it("says what a resend did, and what the note under a link says in each mode", () => {
    expect(resentWords("a@b.co", "sent")).toContain("Sent again to a@b.co.");
    expect(resentWords("a@b.co", "failed")).toContain("could not send");
    expect(inviteNote("owner", true)).toContain("joins as an Owner");
    expect(inviteNote("owner", true)).toContain("whoever you send it to");
    expect(inviteNote("reader", false)).toContain("Frontier sends no mail");
  });
});
