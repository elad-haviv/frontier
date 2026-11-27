// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import type { MeResponse } from "@frontier/schema";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMe, noteMe } from "../../me.ts";
import { answer, failure, type Mounted, mount, stubServer } from "../../testing/mount.ts";
import { Account, GOOGLE_LAST_WAY } from "./Account.tsx";

// The dialog is the app's; here only whether the page asks for it.
const { askForRecentLogin } = vi.hoisted(() => ({ askForRecentLogin: vi.fn(async () => false) }));
vi.mock("../../components/LoginDialog.tsx", async (original) => ({
  ...(await original<typeof import("../../components/LoginDialog.tsx")>()),
  askForRecentLogin,
}));

const me = (
  over: Partial<MeResponse> & { google?: boolean; available?: boolean } = {},
): MeResponse => {
  const { google = true, available = true, ...rest } = over;
  const passkeys = rest.passkeys ?? [];
  return {
    id: "p1",
    name: "Olive Owner",
    email: "olive@example.com",
    admin: true,
    needsProfile: false,
    passkeys,
    passwordSet: false,
    passwordOff: false,
    method: "google",
    suggestedEmail: "",
    signingIn: {
      password: { set: rest.passwordSet ?? false, off: false },
      passkeys,
      google: google ? { email: "gwen@example.com", addedAt: "2026-11-20T10:00:00.000Z" } : null,
      googleAvailable: available,
    },
    ...rest,
  };
};

let mounted: Mounted | null = null;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  askForRecentLogin.mockClear();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  clearMe();
  vi.unstubAllGlobals();
});

async function show(who: MeResponse, at = "/settings/account") {
  noteMe(who);
  mounted = await mount(createElement(Account), null, at);
  await mounted.settle();
  return mounted;
}

describe("Settings → Signing in, and Google", () => {
  it("shows the linked address and lets it be unlinked when another way in remains", async () => {
    const calls = stubServer((url, method) =>
      method === "DELETE" && url === "/api/me/google"
        ? answer({ ok: true })
        : answer(me({ google: false, passwordSet: true })),
    );
    const m = await show(me({ passwordSet: true }));
    expect(m.host.textContent).toContain("gwen@example.com");
    const unlink = m.withText<HTMLButtonElement>("button", "Unlink Google")!;
    expect(unlink.disabled).toBe(false);
    await m.click(unlink);
    // Asked first, in a dialog, and the other ways are said to stay.
    expect(m.one("[role=dialog]").textContent).toContain(
      "Your other ways of logging in stay as they are",
    );
    await m.click(m.withText("[role=dialog] button", "Unlink")!);
    await m.settle();
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/me/google")).toBe(true);
    expect(m.host.textContent).toContain("Google was unlinked.");
  });

  it("does not offer to unlink the last way in, and says why", async () => {
    const m = await show(me({ passwordSet: false, passkeys: [] }));
    expect(m.withText<HTMLButtonElement>("button", "Unlink Google")!.disabled).toBe(true);
    expect(m.host.textContent).toContain(GOOGLE_LAST_WAY);
  });

  it("puts the server's refusal in the same words", async () => {
    stubServer((url, method) =>
      method === "DELETE" && url === "/api/me/google"
        ? failure(403, "not_allowed", "That is the last way to log in.")
        : answer({}),
    );
    const m = await show(me({ passwordSet: true }));
    await m.click(m.withText("button", "Unlink Google")!);
    await m.click(m.withText("[role=dialog] button", "Unlink")!);
    await m.settle();
    expect(m.one("[role=alert]").textContent).toBe(GOOGLE_LAST_WAY);
  });

  it("offers to link Google, and sends the browser to the server to do it", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    stubServer(() => answer({}));
    const m = await show(me({ google: false, passwordSet: true }));
    await m.click(m.withText("button", "Link a Google account")!);
    expect(assign).toHaveBeenCalledWith(
      "/api/auth/google/start?link=1&returnTo=%2Fsettings%2Faccount",
    );
  });

  it("shows nothing about Google where the server does not offer it, unless one is linked", async () => {
    stubServer(() => answer({}));
    const none = await show(me({ google: false, available: false, passwordSet: true }));
    expect(none.host.textContent).not.toContain("Google");
    await none.unmount();
    mounted = null;
    clearMe();
    const linked = await show(me({ google: true, available: false, passwordSet: true }));
    expect(linked.host.textContent).toContain("gwen@example.com");
    // Where the server does not offer Google, a linked identity is no way in: unlinking is allowed.
    expect(linked.withText<HTMLButtonElement>("button", "Unlink Google")!.disabled).toBe(false);
  });

  it("explains a Google trip that failed, and cleans the address", async () => {
    stubServer(() => answer({}));
    const m = await show(
      me({ google: false, passwordSet: true }),
      "/settings/account?problem=google_taken",
    );
    expect(m.one("[role=alert]").textContent).toContain("belongs to another person");
  });

  it("does not open the login dialog by itself for an address that says a recent login is needed", async () => {
    stubServer(() => answer({}));
    const m = await show(
      me({ google: false, passwordSet: true }),
      "/settings/account?problem=recent_login_needed",
    );
    expect(m.one("[role=alert]").textContent).toContain(
      "asks for a login from the last few minutes",
    );
    expect(askForRecentLogin).not.toHaveBeenCalled();
    // The person starts it, by pressing the button.
    expect(m.withText("button", "Log in again and link Google")).not.toBeNull();
    await m.click(m.withText("button", "Log in again and link Google")!);
    await m.settle();
    expect(askForRecentLogin).toHaveBeenCalledTimes(1);
  });

  it("goes on by itself only when this page started the link trip", async () => {
    stubServer(() => answer({}));
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    // Pressing "Link a Google account" marks the trip, in this tab.
    const first = await show(me({ google: false, passwordSet: true }));
    await first.click(first.withText("button", "Link a Google account")!);
    expect(sessionStorage.getItem("frontier.linkGoogleTrip")).toBe("1");
    await first.unmount();
    mounted = null;
    clearMe();
    // Back from it: the login is asked for, and the mark is gone for the next time.
    const m = await show(
      me({ google: false, passwordSet: true }),
      "/settings/account?problem=recent_login_needed",
    );
    await m.settle();
    expect(askForRecentLogin).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("frontier.linkGoogleTrip")).toBeNull();
    expect(m.withText("button", "Log in again and link Google")).toBeNull();
  });
});
