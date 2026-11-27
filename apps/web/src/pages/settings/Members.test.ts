// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import type { MembersResponse } from "@frontier/schema";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAccess } from "../../access.ts";
import { setKeysOwner } from "../../aiKeys.ts";
import { connection } from "../../sync/connection.ts";
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
  unconfirmed: false,
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
  vi.useRealTimers();
  resetAccess();
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

const INVITE = (id: string, secondsLeft: number) => ({
  id,
  role: "writer",
  createdBy: { id: "p1", name: "Olive Owner" },
  createdAt: NOW,
  expiresAt: NOW,
  secondsLeft,
});
const MADE = (id: string) => ({
  id,
  code: "c".repeat(32),
  path: `/join/${"c".repeat(32)}`,
  url: `https://frontier.example/join/${id}`,
  role: "writer",
  expiresAt: NOW,
});
const setClipboard = (clipboard: unknown) =>
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });

describe("Settings → Members, after the review (stage 27c)", () => {
  /** A server with the owners' list and a set of invitations the test can change. */
  function serve(state: { invites: unknown[]; role?: Response }) {
    return stubServer((url, method) => {
      if (url.endsWith("/members") && method === "GET") return answer(OWNERS);
      if (url.includes("/members/") && method === "PUT") return state.role ?? answer({ ok: true });
      if (url.endsWith("/invites") && method === "POST") {
        const made = MADE(`i${state.invites.length + 1}`);
        state.invites = [...state.invites, INVITE(made.id, 3600)];
        return answer(made, 201);
      }
      if (url.endsWith("/invites")) return answer({ invites: state.invites });
      if (url.includes("/invites/") && method === "DELETE") {
        state.invites = state.invites.filter((i) => !url.endsWith(`/${(i as { id: string }).id}`));
        return answer({ ok: true });
      }
      return answer({});
    });
  }
  const makeLink = async (m: Mounted) => {
    await m.click(m.withText("button", "Make an invite link")!);
    await m.settle();
  };
  const confirmDialog = async (m: Mounted, action: string) => {
    await m.click(m.withText("[role=dialog] button", action)!);
    await m.settle();
  };

  it("returns the focus to the row's Remove button on Keep, and Escape cancels the question", async () => {
    serve({ invites: [] });
    mounted = await mount(createElement(Members));
    await mounted.settle();
    await mounted.click(mounted.one('button[aria-label="Remove Wren Writer"]'));
    await mounted.click(mounted.withText("button", "Keep")!);
    expect(document.activeElement).toBe(mounted.one('button[aria-label="Remove Wren Writer"]'));
    // Escape does the same.
    await mounted.click(mounted.one('button[aria-label="Remove Wren Writer"]'));
    const group = mounted.one('[role=group][aria-label="Remove Wren Writer?"]');
    await act(async () => {
      group.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(mounted.host.querySelector('[role=group][aria-label="Remove Wren Writer?"]')).toBeNull();
    expect(document.activeElement).toBe(mounted.one('button[aria-label="Remove Wren Writer"]'));
  });

  it("shows the chosen role and Saving… while the server is asked, not the old role", async () => {
    let release: (r: Response) => void = () => undefined;
    stubServer((url, method) => {
      if (url.endsWith("/members") && method === "GET") return answer(OWNERS);
      if (url.includes("/members/") && method === "PUT") {
        return new Promise<Response>((r) => (release = r)) as never;
      }
      return url.endsWith("/invites") ? answer({ invites: [] }) : answer({});
    });
    mounted = await mount(createElement(Members));
    await mounted.settle();
    const select = mounted.one<HTMLSelectElement>('select[aria-label="Role of Wren Writer"]');
    await mounted.change(select, "reader");
    expect(select.value).toBe("reader");
    expect(select.disabled).toBe(true);
    expect(mounted.host.textContent).toContain("Saving…");
    await act(async () => release(answer({ ok: true })));
    await mounted.settle();
    expect(mounted.host.textContent).not.toContain("Saving…");
  });

  it("does not say an owner's own step down twice: the page's notice says it, not the list", async () => {
    const two: MembersResponse = {
      canManage: true,
      members: [row("p1", "Olive Owner", "owner", true), row("p2", "Omar Owner", "owner")],
    };
    stubServer((url, method) =>
      url.endsWith("/members") && method === "GET"
        ? answer(two)
        : url.endsWith("/invites")
          ? answer({ invites: [] })
          : answer({ ok: true }),
    );
    mounted = await mount(createElement(Members));
    await mounted.settle();
    await mounted.change(
      mounted.one<HTMLSelectElement>('select[aria-label="Role of Olive Owner"]'),
      "writer",
    );
    await confirmDialog(mounted, "Become a Writer");
    expect(mounted.one(".said").textContent).toBe("");
  });

  it("reads the list again when the tab is focused or access may have changed", async () => {
    const calls = serve({ invites: [] });
    mounted = await mount(createElement(Members));
    await mounted.settle();
    const reads = () =>
      calls.filter((c) => c.url.endsWith("/members") && c.method === "GET").length;
    const before = reads();
    await act(async () => void window.dispatchEvent(new Event("focus")));
    await mounted.settle();
    expect(reads()).toBe(before + 1);
    await act(async () => connection.accessMayHaveChanged());
    await mounted.settle();
    expect(reads()).toBe(before + 2);
  });

  it("keeps the link just made while moving about Settings, and asks before replacing it", async () => {
    const state = { invites: [] as unknown[] };
    serve(state);
    mounted = await mount(createElement(Members));
    await mounted.settle();
    await makeLink(mounted);
    expect(mounted.one("[data-testid=invite-link]").textContent).toContain("/join/i1");
    // Another section, and back: the link is still there.
    await mounted.unmount();
    mounted = await mount(createElement(Members));
    await mounted.settle();
    expect(mounted.one("[data-testid=invite-link]").textContent).toContain("/join/i1");
    // A second link asks first; refusing keeps the first.
    await makeLink(mounted);
    expect(mounted.one("[role=dialog]").textContent).toContain("Make another link?");
    await mounted.click(mounted.withText("[role=dialog] button", "Cancel")!);
    await mounted.settle();
    expect(state.invites).toHaveLength(1);
    expect(mounted.one("[data-testid=invite-link]").textContent).toContain("/join/i1");
    await makeLink(mounted);
    await confirmDialog(mounted, "Make another link");
    expect(mounted.one("[data-testid=invite-link]").textContent).toContain("/join/i2");
  });

  it("forgets the link at logout", async () => {
    serve({ invites: [] });
    mounted = await mount(createElement(Members));
    await mounted.settle();
    await makeLink(mounted);
    await mounted.unmount();
    resetAccess();
    mounted = await mount(createElement(Members));
    await mounted.settle();
    expect(mounted.host.querySelector("[data-testid=invite-link]")).toBeNull();
  });

  it("takes the link just made off the screen when it is cancelled, with a busy state on the way", async () => {
    const state = { invites: [] as unknown[] };
    serve(state);
    mounted = await mount(createElement(Members));
    await mounted.settle();
    await makeLink(mounted);
    await mounted.click(mounted.withText("button", "Cancel it")!);
    await mounted.settle();
    expect(mounted.host.querySelector("[data-testid=invite-link]")).toBeNull();
    expect(mounted.host.textContent).toContain("No invitations are waiting.");
    expect(mounted.host.textContent).toContain("The invitation was cancelled.");
  });

  it("shows Cancelling… on the button while the server is asked", async () => {
    let release: (r: Response) => void = () => undefined;
    stubServer((url, method) => {
      if (url.endsWith("/members")) return answer(OWNERS);
      if (url.endsWith("/invites") && method === "GET") {
        return answer({ invites: [INVITE("i1", 3600)] });
      }
      if (method === "DELETE") return new Promise<Response>((r) => (release = r)) as never;
      return answer({});
    });
    mounted = await mount(createElement(Members));
    await mounted.settle();
    await mounted.click(mounted.withText("button", "Cancel it")!);
    expect(mounted.host.textContent).toContain("Cancelling…");
    expect(mounted.withText<HTMLButtonElement>("button", "Cancelling…")!.disabled).toBe(true);
    await act(async () => release(answer({ ok: true })));
    await mounted.settle();
  });

  it("counts the time left down each minute, and drops a link that has run out", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    serve({ invites: [INVITE("i1", 150)] });
    mounted = await mount(createElement(Members));
    await mounted.settle();
    expect(mounted.host.textContent).toContain("2 minutes left");
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(mounted.host.textContent).toContain("1 minute left");
    await act(async () => void vi.advanceTimersByTime(120_000));
    expect(mounted.host.textContent).not.toContain("Cancel it");
    expect(mounted.host.textContent).toContain("No invitations are waiting.");
  });

  it("says a failed read of the waiting links, with Try again, instead of Loading… for ever", async () => {
    let fail = true;
    stubServer((url, method) => {
      if (url.endsWith("/members") && method === "GET") return answer(OWNERS);
      if (url.endsWith("/invites") && method === "GET") {
        return fail
          ? failure(500, "internal", "The server could not read the links.")
          : answer({ invites: [] });
      }
      return answer({});
    });
    mounted = await mount(createElement(Members));
    await mounted.settle();
    expect(mounted.host.textContent).not.toContain("Loading…");
    expect(mounted.host.textContent).toContain("The server could not read the links.");
    fail = false;
    await mounted.click(mounted.withText("button", "Try again")!);
    await mounted.settle();
    expect(mounted.host.textContent).toContain("No invitations are waiting.");
  });

  it("shows the link in a box, selected, when the clipboard is refused", async () => {
    serve({ invites: [] });
    setClipboard({
      writeText: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    });
    mounted = await mount(createElement(Members));
    await mounted.settle();
    await makeLink(mounted);
    await mounted.click(mounted.withText("button", "Copy")!);
    await mounted.settle();
    const box = mounted.one<HTMLTextAreaElement>("textarea[data-testid=invite-link]");
    expect(box.readOnly).toBe(true);
    expect(document.activeElement).toBe(box);
    expect(box.selectionEnd - box.selectionStart).toBe(box.value.length);
  });
});
