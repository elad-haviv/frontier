// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { answer, failure, type Mounted, mount, stubServer } from "../testing/mount.ts";
import { buttonNames } from "../testing/email.ts";
import { takeInvitation } from "./emailModel.ts";
import { ForgotPage } from "./ForgotPage.tsx";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  localStorage.clear();
  vi.unstubAllGlobals();
});

const SESSION = {
  loggedIn: false,
  person: null,
  passkeys: false,
  password: true,
  google: false,
  mail: true,
};
function Where() {
  return createElement("output", { "data-where": "" }, useLocation().pathname);
}

async function ask(
  route: Parameters<typeof stubServer>[0] = (url) =>
    url === "/api/forgot-password" ? answer({ ok: true }) : answer(SESSION),
  state?: unknown,
) {
  const calls = stubServer(route);
  mounted = await mount(
    createElement(
      Routes,
      null,
      createElement(Route, { path: "/forgot-password", element: createElement(ForgotPage) }),
      createElement(Route, { path: "*", element: createElement(Where) }),
    ),
    null,
    // A router entry can carry state, as a link from the invitation's login form does.
    state ? ({ pathname: "/forgot-password", state } as never) : "/forgot-password",
  );
  await mounted.settle();
  return { m: mounted, calls };
}
const submit = (m: Mounted) =>
  act(
    async () =>
      void m.one("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );

describe("the forgot password page", () => {
  it("has one field with the first focus, and asks for an email", async () => {
    const { m } = await ask();
    const field = m.one<HTMLInputElement>('input[type="email"]');
    expect(document.activeElement).toBe(field);
    expect(field.autocomplete).toBe("email");
    expect(m.one("label").textContent).toBe("Email");
    expect(buttonNames(m.host)).toEqual(["Send the link"]);
  });

  it("says a badly formed address does not look like one and sends nothing", async () => {
    const { m, calls } = await ask();
    await m.change(m.one('input[type="email"]'), "nope");
    await submit(m);
    expect(m.one('[role="alert"]').textContent).toBe("That doesn't look like an email address.");
    expect(m.one('input[type="email"]').getAttribute("aria-invalid")).toBe("true");
    expect(calls.some((c) => c.url === "/api/forgot-password")).toBe(false);
  });

  it("gives the same answer for every address, and does not say whether it has an account", async () => {
    const { m, calls } = await ask();
    await m.change(m.one('input[type="email"]'), "stranger@example.org");
    await submit(m);
    await m.settle();
    expect(calls.find((c) => c.url === "/api/forgot-password")?.body).toEqual({
      email: "stranger@example.org",
    });
    expect(m.one("h1").textContent).toBe("If that address has an account, we sent a link");
    expect(m.host.textContent).toContain("It works once and for 30 minutes.");
    expect(m.host.textContent).not.toContain("stranger@example.org");
    expect(m.withText("a", "Back to log in")).not.toBeNull();
  });

  it("can go back and use another address", async () => {
    const { m } = await ask();
    await m.change(m.one('input[type="email"]'), "a@example.org");
    await submit(m);
    await m.settle();
    await m.click(m.withText("button", "Use another address")!);
    expect(m.one<HTMLInputElement>('input[type="email"]').value).toBe("");
    expect(document.activeElement).toBe(m.one('input[type="email"]'));
  });

  it("says too many requests for the rate limit, whatever the address", async () => {
    const { m } = await ask((url) =>
      url === "/api/forgot-password"
        ? failure(429, "rate_limited", "Too many requests. Try again later.")
        : answer(SESSION),
    );
    await m.change(m.one('input[type="email"]'), "a@example.org");
    await submit(m);
    await m.settle();
    expect(m.one('[role="alert"]').textContent).toBe("Too many requests. Try again later.");
    // Still the form: nothing was sent, and the person can try again.
    expect(m.host.querySelector("form")).not.toBeNull();
  });

  it("fills in the address a login form had typed, and remembers the invitation it came from", async () => {
    const { m } = await ask(undefined, { from: "/join/abc?m=Zz9", email: "yael@example.org" });
    expect(m.one<HTMLInputElement>('input[type="email"]').value).toBe("yael@example.org");
    await submit(m);
    await m.settle();
    // Only the invite page is kept: the emailed link's proof stays out of storage.
    expect(takeInvitation()).toBe("/join/abc");
    expect(localStorage.getItem("frontier.afterReset")).toBeNull();
  });

  it("remembers nothing that is not an invite page of the app", async () => {
    const { m } = await ask(undefined, {
      from: "https://evil.example/join/abc",
      email: "a@example.org",
    });
    await submit(m);
    await m.settle();
    expect(takeInvitation()).toBeNull();
  });

  it("says a server with no mail cannot reset a password, and asks no address", async () => {
    const { m } = await ask(() => answer({ ...SESSION, mail: false }));
    expect(m.one("h1").textContent).toBe("This server cannot send email");
    expect(m.host.querySelector("form")).toBeNull();
  });
});
