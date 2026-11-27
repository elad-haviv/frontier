// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMe, noteMe } from "../me.ts";
import { answer, failure, type Mounted, mount, stubServer } from "../testing/mount.ts";
import { buttonNames, emailInfo, person } from "../testing/email.ts";
import { ConfirmBanner } from "./ConfirmBanner.tsx";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  clearMe();
  vi.unstubAllGlobals();
});

async function banner(who = person(), route: Parameters<typeof stubServer>[0] = () => answer(who)) {
  noteMe(who);
  const calls = stubServer(route);
  mounted = await mount(createElement(ConfirmBanner), null);
  await mounted.settle();
  return { m: mounted, calls };
}

describe("the confirm banner", () => {
  it("says a link was sent to the address, with Resend and Change address, and no way to close it", async () => {
    const { m } = await banner();
    const region = m.one("aside");
    expect(region.textContent).toContain("Confirm your email: we sent a link to yael@example.org.");
    expect(buttonNames(m.host)).toEqual(["Resend", "Change address"]);
    expect(m.host.querySelector('button[aria-label*="lose"]')).toBeNull();
    // Its status line is announced politely, and is empty until something is said.
    const said = m.one('[role="status"]');
    expect(said.getAttribute("aria-live")).toBe("polite");
    expect(said.textContent).toBe("");
  });

  it("is not there with mail off, for a confirmed address, or with nobody read yet", async () => {
    const off = await banner(person({ emailInfo: emailInfo({ mailOn: false }) }));
    expect(off.m.host.querySelector("aside")).toBeNull();
    await mounted?.unmount();
    const confirmed = await banner(
      person({ emailInfo: emailInfo({ status: "confirmed", confirmedBy: "invite" }) }),
    );
    expect(confirmed.m.host.querySelector("aside")).toBeNull();
    await mounted?.unmount();
    mounted = await mount(createElement(ConfirmBanner), null);
    expect(mounted.host.querySelector("aside")).toBeNull();
  });

  it("offers to send a link when none was sent, and to try again when it failed", async () => {
    const unsent = await banner(person({ emailInfo: emailInfo({ sent: null }) }));
    expect(unsent.m.one("aside").textContent).toContain(
      "we have not sent a link to yael@example.org yet.",
    );
    expect(buttonNames(unsent.m.host)).toEqual(["Send a link", "Change address"]);
    await mounted?.unmount();
    const failed = await banner(person({ emailInfo: emailInfo({ sent: { at: "t", ok: false } }) }));
    expect(failed.m.one("aside").textContent).toContain(
      "we could not send the link to yael@example.org.",
    );
    expect(buttonNames(failed.m.host)).toEqual(["Try again", "Change address"]);
  });

  it("sends the link again and says so, then reads the person again", async () => {
    const { m, calls } = await banner(person(), (url) =>
      url === "/api/me/email/resend"
        ? answer({ ok: true, applied: false, mail: "sent" })
        : answer(person()),
    );
    await m.click(m.withText("button", "Resend")!);
    await m.settle();
    expect(calls.some((c) => c.url === "/api/me/email/resend" && c.method === "POST")).toBe(true);
    expect(m.one('[role="status"]').textContent).toBe("Sent again. Check your inbox and spam.");
    expect(calls.some((c) => c.url === "/api/me" && c.method === "GET")).toBe(true);
  });

  it("says when the send failed, when it was the limit, and when it is already confirmed", async () => {
    let reply = () => answer({ ok: true, applied: false, mail: "failed" });
    const { m } = await banner(person(), (url) =>
      url === "/api/me/email/resend" ? reply() : answer(person()),
    );
    await m.click(m.withText("button", "Resend")!);
    await m.settle();
    expect(m.one('[role="status"]').textContent).toBe(
      "We could not send it. Try again in a minute.",
    );
    reply = () => failure(429, "rate_limited", "Too many requests. Try again later.") as never;
    await m.click(m.withText("button", "Resend")!);
    await m.settle();
    expect(m.one('[role="status"]').textContent).toBe("Too many requests. Try again later.");
    reply = () =>
      failure(409, "already_confirmed", "Your email address is already confirmed.") as never;
    await m.click(m.withText("button", "Resend")!);
    await m.settle();
    expect(m.one('[role="status"]').textContent).toBe("That address is already confirmed.");
  });

  it("changes the address with the password, takes focus to the new address, and Escape closes it", async () => {
    const { m, calls } = await banner(person(), (url, method) =>
      url === "/api/me/email" && method === "POST"
        ? answer({ ok: true, applied: false, mail: "sent" })
        : answer(person()),
    );
    await m.click(m.withText("button", "Change address")!);
    const field = m.one<HTMLInputElement>('input[type="email"]');
    expect(document.activeElement).toBe(field);
    expect(field.autocomplete).toBe("email");
    expect(m.one<HTMLInputElement>('input[type="password"]').autocomplete).toBe("current-password");
    // A badly formed address says so and sends nothing.
    await m.change(field, "nope");
    await m.change(m.one('input[type="password"]'), "a long enough password");
    await act(async () =>
      m.one("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(m.one('[role="alert"]').textContent).toBe("That doesn't look like an email address.");
    expect(calls.some((c) => c.url === "/api/me/email")).toBe(false);
    await m.change(field, "new@example.org");
    await act(async () =>
      m.one("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await m.settle();
    const sent = calls.find((c) => c.url === "/api/me/email");
    expect(sent?.body).toEqual({ email: "new@example.org", password: "a long enough password" });
    expect(m.one('[role="status"]').textContent).toBe(
      "We sent a link to new@example.org. Your address stays yael@example.org until you open it.",
    );
    // The form closed, and the focus is back on the button that opened it.
    expect(m.host.querySelector("form")).toBeNull();
    expect(document.activeElement?.textContent).toBe("Change address");
    // Escape closes the form without sending.
    await m.click(m.withText("button", "Change address")!);
    await act(async () =>
      m.one("form").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(m.host.querySelector("form")).toBeNull();
  });

  it("does not ask for a password from an account without a working one", async () => {
    const { m } = await banner(person({ passwordSet: false }));
    await m.click(m.withText("button", "Change address")!);
    expect(m.host.querySelector('input[type="password"]')).toBeNull();
  });

  it("says a wrong password under the password, and a taken address under the address", async () => {
    let reply = () => failure(400, "invalid", "The current password is not right.");
    const { m } = await banner(person(), (url, method) =>
      url === "/api/me/email" && method === "POST" ? reply() : answer(person()),
    );
    await m.click(m.withText("button", "Change address")!);
    await m.change(m.one('input[type="email"]'), "new@example.org");
    await m.change(m.one('input[type="password"]'), "wrong password here");
    await act(async () =>
      m.one("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await m.settle();
    expect(m.one('[role="alert"]').textContent).toBe("The current password is not right.");
    expect(m.one('input[type="password"]').getAttribute("aria-invalid")).toBe("true");
    reply = () => failure(409, "email_taken", "Another account already uses this email.");
    await act(async () =>
      m.one("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await m.settle();
    expect(m.one('[role="alert"]').textContent).toBe("Another account already uses that address.");
  });

  it("is about the new address while a change waits, and offers to cancel it", async () => {
    const waiting = person({
      emailInfo: emailInfo({
        pending: { address: "new@example.org", requestedAt: "t", sent: { at: "t", ok: true } },
      }),
    });
    const { m, calls } = await banner(waiting, (url, method) =>
      url === "/api/me/email/pending" && method === "DELETE"
        ? answer({ ok: true })
        : answer(waiting),
    );
    expect(m.one("aside").textContent).toContain(
      "Confirm your new address: we sent a link to new@example.org. Your address stays yael@example.org until you open it.",
    );
    expect(buttonNames(m.host)).toEqual(["Resend", "Cancel the change"]);
    await m.click(m.withText("button", "Cancel the change")!);
    await m.settle();
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/me/email/pending")).toBe(
      true,
    );
    expect(m.one('[role="status"]').textContent).toBe("The change was cancelled.");
  });

  it("asks an account whose address was taken by Google to add one", async () => {
    const { m } = await banner(
      person({
        email: "",
        emailInfo: emailInfo({ status: "none", needsAddress: true, sent: null }),
      }),
    );
    expect(m.one("aside").textContent).toContain("Add an email address:");
    expect(buttonNames(m.host)).toEqual(["Add an address"]);
    await m.click(m.withText("button", "Add an address")!);
    expect(m.withText("button", "Send a link")).not.toBeNull();
  });

  it("goes by itself once the address is confirmed somewhere else, learned when the tab is focused", async () => {
    const confirmed = person({
      emailInfo: emailInfo({ status: "confirmed", confirmedBy: "link" }),
    });
    let now = person();
    const { m } = await banner(person(), () => answer(now));
    expect(m.host.querySelector("aside")).not.toBeNull();
    now = confirmed;
    await act(async () => void window.dispatchEvent(new Event("focus")));
    await m.settle();
    expect(m.host.querySelector("aside")).toBeNull();
  });
});

describe("the banner's half-minute poll", () => {
  afterEach(() => vi.useRealTimers());

  /** Mounts the banner, then lets 65 seconds pass and counts the reads of the person. */
  async function reads(who: ReturnType<typeof person>): Promise<number> {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { calls } = await banner(who);
    calls.length = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    return calls.filter((c) => c.url === "/api/me" && c.method === "GET").length;
  }

  it("runs while a link was sent or is on its way", async () => {
    expect(await reads(person())).toBeGreaterThan(0);
    await mounted?.unmount();
    expect(
      await reads(person({ emailInfo: emailInfo({ sent: { at: "t", ok: null } }) })),
    ).toBeGreaterThan(0);
  });

  it("does not run when no link was sent, when it failed, or when an address is to be added", async () => {
    expect(await reads(person({ emailInfo: emailInfo({ sent: null }) }))).toBe(0);
    await mounted?.unmount();
    expect(await reads(person({ emailInfo: emailInfo({ sent: { at: "t", ok: false } }) }))).toBe(0);
    await mounted?.unmount();
    expect(await reads(person({ emailInfo: emailInfo({ needsAddress: true }) }))).toBe(0);
  });

  it("still reads again on focus when it does not poll", async () => {
    const { calls } = await banner(person({ emailInfo: emailInfo({ sent: null }) }));
    calls.length = 0;
    await act(async () => void window.dispatchEvent(new Event("focus")));
    await mounted!.settle();
    expect(calls.filter((c) => c.url === "/api/me" && c.method === "GET").length).toBe(1);
  });
});
