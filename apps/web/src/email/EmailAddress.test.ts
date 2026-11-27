// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import type { MeResponse } from "@frontier/schema";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMe, noteMe } from "../me.ts";
import { answer, failure, type Mounted, mount, stubServer } from "../testing/mount.ts";
import { buttonNames, emailInfo, person } from "../testing/email.ts";
import { EmailAddress, unconfirmedWords } from "./EmailAddress.tsx";

// The dialog for a recent login is the app's; here the form's way through it: on
// `recent_login_needed` the person is asked, and the change goes again.
const { askedToLogIn } = vi.hoisted(() => ({ askedToLogIn: vi.fn() }));
vi.mock("../components/LoginDialog.tsx", async (original) => ({
  ...(await original<typeof import("../components/LoginDialog.tsx")>()),
  withRecentLogin: async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (err) {
      if ((err as { code?: string }).code !== "recent_login_needed") throw err;
      askedToLogIn();
      return work();
    }
  },
}));

let mounted: Mounted | null = null;
beforeEach(() => askedToLogIn.mockClear());
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  clearMe();
  vi.unstubAllGlobals();
});

async function show(who: MeResponse, route: Parameters<typeof stubServer>[0] = () => answer(who)) {
  noteMe(who);
  const calls = stubServer(route);
  mounted = await mount(createElement(EmailAddress, { me: who }), null);
  await mounted.settle();
  return { m: mounted, calls };
}
const submit = (m: Mounted) =>
  act(
    async () =>
      void m.one("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );

describe("Settings → Signing in → Email address", () => {
  it("shows an unconfirmed address with its tag, what to do, Resend link and Change address", async () => {
    const { m } = await show(person());
    const block = m.one("[data-testid=email-block]");
    expect(block.textContent).toContain("yael@example.org");
    expect(block.querySelector(".tag")?.textContent).toBe("Unconfirmed");
    expect(block.textContent).toContain("Until you open it, we cannot be sure it is yours.");
    expect(buttonNames(m.host)).toEqual(["Resend link", "Change address"]);
  });

  it("offers Send a link when none was sent, and Try again when it failed", async () => {
    const unsent = await show(person({ emailInfo: emailInfo({ sent: null }) }));
    expect(unsent.m.host.textContent).toContain("We have not sent a link to this address yet.");
    expect(buttonNames(unsent.m.host)).toEqual(["Send a link", "Change address"]);
    await mounted?.unmount();
    const failed = await show(person({ emailInfo: emailInfo({ sent: { at: "t", ok: false } }) }));
    expect(buttonNames(failed.m.host)).toEqual(["Try again", "Change address"]);
    expect(unconfirmedWords("failed")).toContain("could not send");
  });

  it("says Confirmed, and Confirmed by Google with whose address it is", async () => {
    const link = await show(
      person({ emailInfo: emailInfo({ status: "confirmed", confirmedBy: "link" }) }),
    );
    expect(link.m.one(".email-confirmed").textContent).toBe("Confirmed");
    expect(link.m.host.querySelector(".tag")).toBeNull();
    expect(buttonNames(link.m.host)).toEqual(["Change address"]);
    await mounted?.unmount();
    const google = await show(
      person({ emailInfo: emailInfo({ status: "confirmed", confirmedBy: "google" }) }),
    );
    expect(google.m.one(".email-confirmed").textContent).toBe("Confirmed by Google");
    expect(google.m.host.textContent).toContain("the address of your linked Google account");
  });

  it("sends the link again and says so", async () => {
    const { m, calls } = await show(person(), (url) =>
      url === "/api/me/email/resend"
        ? answer({ ok: true, applied: false, mail: "sent" })
        : answer(person()),
    );
    await m.click(m.withText("button", "Resend link")!);
    await m.settle();
    expect(calls.some((c) => c.url === "/api/me/email/resend")).toBe(true);
    expect(m.one('[role="status"]').textContent).toBe("Sent again. Check your inbox and spam.");
  });

  it("changes the address with the current password and says the old one stays until the link is opened", async () => {
    const { m, calls } = await show(
      person({ emailInfo: emailInfo({ status: "confirmed", confirmedBy: "link" }) }),
      (url, method) =>
        url === "/api/me/email" && method === "POST"
          ? answer({ ok: true, applied: false, mail: "sent" })
          : answer(person()),
    );
    await m.click(m.withText("button", "Change address")!);
    expect(m.one("form").textContent).toContain(
      "Your address stays yael@example.org until you open the link we send to the new one. We also tell yael@example.org about the change.",
    );
    await m.change(m.one('input[type="email"]'), "new@example.org");
    await m.change(m.one('input[type="password"]'), "a long enough password");
    await submit(m);
    await m.settle();
    expect(calls.find((c) => c.url === "/api/me/email")?.body).toEqual({
      email: "new@example.org",
      password: "a long enough password",
    });
    expect(m.one('[role="status"]').textContent).toContain("We sent a link to new@example.org.");
  });

  it("asks for the password before it sends, and for a good address", async () => {
    const { m, calls } = await show(person());
    await m.click(m.withText("button", "Change address")!);
    await m.change(m.one('input[type="email"]'), "new@example.org");
    await submit(m);
    expect(m.one('[role="alert"]').textContent).toBe("Enter your password to change it.");
    expect(document.activeElement).toBe(m.one('input[type="password"]'));
    expect(calls.some((c) => c.url === "/api/me/email")).toBe(false);
  });

  it("shows a change that waits, with Resend and Cancel the change, and the old address in force", async () => {
    const waiting = person({
      emailInfo: emailInfo({
        status: "confirmed",
        confirmedBy: "link",
        pending: { address: "new@example.org", requestedAt: "t", sent: { at: "t", ok: true } },
      }),
    });
    const { m, calls } = await show(waiting, (url, method) =>
      url === "/api/me/email/pending" && method === "DELETE"
        ? answer({ ok: true })
        : answer(waiting),
    );
    const block = m.one("[data-testid=email-block]").textContent ?? "";
    expect(block).toContain("Waiting for you to confirm new@example.org.");
    expect(block).toContain("told yael@example.org about the change");
    expect(block).toContain("your address stays yael@example.org");
    expect(buttonNames(m.host)).toEqual(["Resend", "Cancel the change"]);
    await m.click(m.withText("button", "Cancel the change")!);
    await m.settle();
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/me/email/pending")).toBe(
      true,
    );
    expect(m.one('[role="status"]').textContent).toBe("The change was cancelled.");
  });

  it("asks an account with no working password for a recent login, through the dialog", async () => {
    const who = person({ passwordSet: false, method: "google" });
    let first = true;
    const { m, calls } = await show(who, (url, method) => {
      if (url === "/api/me/email" && method === "POST") {
        if (first) {
          first = false;
          return failure(403, "recent_login_needed", "Log in again.");
        }
        return answer({ ok: true, applied: false, mail: "sent" });
      }
      return answer(who);
    });
    await m.click(m.withText("button", "Change address")!);
    expect(m.host.querySelector('input[type="password"]')).toBeNull();
    await m.change(m.one('input[type="email"]'), "new@example.org");
    await submit(m);
    await m.settle();
    expect(askedToLogIn).toHaveBeenCalledTimes(1);
    // Asked again after the login, this time without a password.
    expect(calls.filter((c) => c.url === "/api/me/email")).toHaveLength(2);
    expect(calls.find((c) => c.url === "/api/me/email")?.body).toEqual({
      email: "new@example.org",
    });
  });

  it("with mail off shows the plain address and applies a change at once", async () => {
    const who = person({ emailInfo: emailInfo({ mailOn: false }) });
    const { m, calls } = await show(who, (url, method) =>
      url === "/api/me/email" && method === "POST"
        ? answer({ ok: true, applied: true, mail: "off" })
        : answer(who),
    );
    expect(m.one("[data-testid=email-block]").textContent).toContain("yael@example.org");
    expect(m.host.querySelector(".tag")).toBeNull();
    expect(m.host.textContent).not.toContain("Confirmed");
    expect(buttonNames(m.host)).toEqual(["Change address"]);
    await m.click(m.withText("button", "Change address")!);
    expect(m.one("form").textContent).toContain("The change applies at once.");
    await m.change(m.one('input[type="email"]'), "new@example.org");
    await m.change(m.one('input[type="password"]'), "a long enough password");
    expect(m.withText("button", "Change the address")).not.toBeNull();
    await submit(m);
    await m.settle();
    expect(calls.find((c) => c.url === "/api/me/email")).toBeTruthy();
    expect(m.one('[role="status"]').textContent).toBe("Your address is now new@example.org.");
  });

  it("asks a displaced account, with no address, to add one", async () => {
    const who = person({
      email: "",
      emailInfo: emailInfo({ status: "none", needsAddress: true, sent: null }),
    });
    const { m } = await show(who);
    expect(m.host.textContent).toContain("now belongs to a Google sign-in that verified it");
    expect(buttonNames(m.host)).toEqual(["Add an address"]);
    await m.click(m.withText("button", "Add an address")!);
    expect(m.one("label").textContent).toBe("Your address");
    expect(m.withText("button", "Send a link")).not.toBeNull();
  });
});
