// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import type { MembersResponse } from "@frontier/schema";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setKeysOwner } from "../../aiKeys.ts";
import { setCurrentProject } from "../../project.ts";
import { ALPHA } from "../../testing/switchProject.ts";
import {
  answer,
  failure,
  type Mounted,
  mount,
  projectInfo,
  stubServer,
} from "../../testing/mount.ts";
import { Members } from "./Members.tsx";
import { LAST_OWNER } from "./membersModel.ts";

const NOW = new Date().toISOString();
const row = (id: string, name: string, role: "owner" | "writer" | "reader", you = false) => ({
  id,
  name,
  email: `${name.split(" ")[0]!.toLowerCase()}@example.com`,
  role,
  addedAt: NOW,
  lastActiveAt: NOW,
  you,
});
const OWNERS: MembersResponse = {
  canManage: true,
  members: [row("p1", "Olive Owner", "owner", true), row("p2", "Wren Writer", "writer")],
};

let mounted: Mounted | null = null;
beforeEach(() => {
  setKeysOwner("p1");
  setCurrentProject(ALPHA);
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
  setCurrentProject(null);
  setKeysOwner(null);
});

describe("Settings → Members", () => {
  it("shows an owner everyone with their email and a role to change, and the only owner's cannot change", async () => {
    stubServer((url) =>
      url.endsWith("/members")
        ? answer(OWNERS)
        : url.endsWith("/invites")
          ? answer({ invites: [] })
          : answer({}),
    );
    mounted = await mount(createElement(Members));
    await mounted.settle();
    const text = mounted.host.textContent ?? "";
    expect(text).toContain("2 people can open Alpha.");
    expect(text).toContain("olive@example.com");
    expect(text).toContain("wren@example.com");
    const own = mounted.one<HTMLSelectElement>('select[aria-label="Role of Olive Owner"]');
    expect(own.disabled).toBe(true);
    expect(own.title).toBe(LAST_OWNER);
    expect(mounted.host.textContent).toContain("the only owner");
    const other = mounted.one<HTMLSelectElement>('select[aria-label="Role of Wren Writer"]');
    expect(other.disabled).toBe(false);
    expect([...other.options].map((o) => o.value)).toEqual(["reader", "writer", "owner"]);
    // The way out is there, and says why it cannot be taken while one is the only owner.
    const leave = mounted.withText<HTMLButtonElement>("button", "Leave this project")!;
    expect(leave.disabled).toBe(true);
    expect(mounted.host.textContent).toContain("You are the only owner.");
  });

  it("changes a role through the server and says so", async () => {
    const calls = stubServer((url, method) =>
      url.endsWith("/members") && method === "GET"
        ? answer(OWNERS)
        : url.endsWith("/invites")
          ? answer({ invites: [] })
          : answer({ ok: true }),
    );
    mounted = await mount(createElement(Members));
    await mounted.settle();
    await mounted.change(
      mounted.one<HTMLSelectElement>('select[aria-label="Role of Wren Writer"]'),
      "reader",
    );
    await mounted.settle();
    expect(calls.find((c) => c.method === "PUT")).toMatchObject({
      url: "/api/p/alpha/members/p2",
      body: { role: "reader" },
    });
    expect(mounted.host.textContent).toContain("Wren Writer is now a Reader.");
  });

  it("asks in the row before it removes someone, and keeps them on Keep", async () => {
    const calls = stubServer((url, method) =>
      url.endsWith("/members") && method === "GET"
        ? answer(OWNERS)
        : url.endsWith("/invites")
          ? answer({ invites: [] })
          : answer({ ok: true }),
    );
    mounted = await mount(createElement(Members));
    await mounted.settle();
    await mounted.click(mounted.one('button[aria-label="Remove Wren Writer"]'));
    expect(mounted.host.textContent).toContain("Remove Wren?");
    // The safe answer has the focus.
    expect(document.activeElement?.textContent).toBe("Keep");
    await mounted.click(mounted.withText("button", "Keep")!);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await mounted.click(mounted.one('button[aria-label="Remove Wren Writer"]'));
    await mounted.click(mounted.withText("button", "Remove")!);
    await mounted.settle();
    expect(calls.find((c) => c.method === "DELETE")?.url).toBe("/api/p/alpha/members/p2");
    expect(mounted.host.textContent).toContain("Wren Writer was removed.");
  });

  it("says the last owner rule in words when the server refuses a change", async () => {
    stubServer((url, method) =>
      url.endsWith("/members") && method === "GET"
        ? answer(OWNERS)
        : url.endsWith("/invites")
          ? answer({ invites: [] })
          : failure(409, "last_owner", "The project needs at least one owner."),
    );
    mounted = await mount(createElement(Members));
    await mounted.settle();
    await mounted.change(
      mounted.one<HTMLSelectElement>('select[aria-label="Role of Wren Writer"]'),
      "owner",
    );
    await mounted.settle();
    expect(mounted.host.textContent).toContain(LAST_OWNER);
  });

  it("makes a link for a Writer by default, shows it once with what it does, and lists it as waiting", async () => {
    let made = false;
    const calls = stubServer((url, method) => {
      if (url.endsWith("/members")) return answer(OWNERS);
      if (url.endsWith("/invites") && method === "POST") {
        made = true;
        return answer(
          {
            id: "i1",
            code: "c".repeat(32),
            path: `/join/${"c".repeat(32)}`,
            url: `https://frontier.example/join/${"c".repeat(32)}`,
            role: "writer",
            expiresAt: NOW,
          },
          201,
        );
      }
      if (url.endsWith("/invites")) {
        return answer({
          invites: made
            ? [
                {
                  id: "i1",
                  role: "writer",
                  createdBy: { id: "p1", name: "Olive Owner" },
                  createdAt: NOW,
                  expiresAt: NOW,
                  secondsLeft: 6 * 86400 + 3600,
                },
              ]
            : [],
        });
      }
      return answer({});
    });
    mounted = await mount(createElement(Members));
    await mounted.settle();
    expect(mounted.host.textContent).toContain("No invitations are waiting.");
    expect(
      mounted.one<HTMLSelectElement>("#" + CSS.escape(mounted.one("select.member-role[id]").id))
        .value,
    ).toBe("writer");
    await mounted.click(mounted.withText("button", "Make an invite link")!);
    await mounted.settle();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ role: "writer" });
    const link = mounted.one("[data-testid=invite-link]");
    expect(link.textContent).toBe(`https://frontier.example/join/${"c".repeat(32)}`);
    const said = mounted.one(".invite-once").textContent ?? "";
    expect(said).toContain("It works once, for 7 days");
    expect(said).toContain("it will not show this link again");
    expect(mounted.host.textContent).toContain("A link for one writer");
    expect(mounted.host.textContent).toContain("Made by Olive Owner");
    expect(mounted.host.textContent).toContain("6 days left");
  });

  it("shows a writer the list with no emails and no controls, and a way out", async () => {
    stubServer((url) =>
      url.endsWith("/members")
        ? answer({
            canManage: false,
            members: [
              { ...row("p1", "Olive Owner", "owner"), email: null },
              { ...row("p2", "Wren Writer", "writer", true), email: null },
            ],
          })
        : answer({}),
    );
    mounted = await mount(createElement(Members), projectInfo({ role: "writer" }));
    await mounted.settle();
    expect(mounted.host.querySelectorAll("select")).toHaveLength(0);
    expect(mounted.host.textContent).not.toContain("@example.com");
    expect(mounted.host.textContent).not.toContain("Invite someone");
    expect(mounted.host.textContent).toContain("Only an owner of the project can change roles");
    expect(mounted.withText<HTMLButtonElement>("button", "Leave this project")!.disabled).toBe(
      false,
    );
  });
});
