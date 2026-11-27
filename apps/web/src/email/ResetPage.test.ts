// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { answer, failure, type Mounted, mount, stubServer } from "../testing/mount.ts";
import { buttonNames } from "../testing/email.ts";
import { rememberInvitation } from "./emailModel.ts";
import { ResetPage } from "./ResetPage.tsx";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

const CODE = "r".repeat(32);
function Where() {
  const here = useLocation();
  return createElement(
    "output",
    { "data-where": "", "data-from": (here.state as { from?: string } | null)?.from ?? "" },
    here.pathname + here.search,
  );
}
const where = () => mounted!.host.querySelector("[data-where]")?.textContent;
const submit = (m: Mounted) =>
  act(
    async () =>
      void m.one("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );

async function open(route: Parameters<typeof stubServer>[0], loggedIn = false) {
  const calls = stubServer(route);
  mounted = await mount(
    createElement(
      Routes,
      null,
      createElement(Route, {
        path: "/reset/:code",
        element: createElement(ResetPage, { code: CODE, loggedIn }),
      }),
      createElement(Route, { path: "*", element: createElement(Where) }),
    ),
    null,
    `/reset/${CODE}`,
  );
  await mounted.settle();
  return { m: mounted, calls };
}
const good = (url: string, method: string) =>
  method === "GET" && url === `/api/reset/${CODE}`
    ? answer({ ok: true })
    : method === "POST" && url === `/api/reset/${CODE}`
      ? answer({ ok: true })
      : answer({});

describe("the reset page", () => {
  it("checks the link when it loads, with a GET that uses nothing up", async () => {
    const { calls } = await open(good);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET /api/reset/${CODE}`]);
  });

  it("asks for a new password with a live count, disabled until there are 12 characters", async () => {
    const { m } = await open(good);
    const field = m.one<HTMLInputElement>('input[autocomplete="new-password"]');
    expect(document.activeElement).toBe(field);
    expect(field.type).toBe("password");
    const button = m.one<HTMLButtonElement>('button[type="submit"]');
    expect(button.disabled).toBe(true);
    expect(m.one("[data-testid=password-count]").textContent).toBe("12 or more characters.");
    await m.change(field, "short");
    expect(m.one("[data-testid=password-count]").textContent).toBe("7 more characters needed.");
    expect(button.disabled).toBe(true);
    await m.change(field, "a long enough password");
    expect(m.one("[data-testid=password-count]").textContent).toBe("Good.");
    expect(button.disabled).toBe(false);
  });

  it("shows the password only when asked", async () => {
    const { m } = await open(good);
    const field = m.one<HTMLInputElement>('input[autocomplete="new-password"]');
    await m.click(m.one('input[type="checkbox"]'));
    expect(field.type).toBe("text");
    expect(m.one("label.mail-show").textContent).toBe("Show the password");
  });

  it("sets the password, says other devices were logged out, and sends nobody in", async () => {
    const { m, calls } = await open(good);
    await m.change(m.one('input[autocomplete="new-password"]'), "a long enough password");
    await submit(m);
    await m.settle();
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      url: `/api/reset/${CODE}`,
      body: { password: "a long enough password" },
    });
    expect(m.one("h1").textContent).toBe("Your password is changed");
    expect(m.host.textContent).toContain("We logged you out everywhere else.");
    expect(buttonNames(m.host)).toEqual(["Log in"]);
    // The password is not left on the page.
    expect(m.host.querySelector("input")).toBeNull();
    await m.click(m.withText("button", "Log in")!);
    expect(where()).toBe("/login");
  });

  it("goes back to the invitation after logging in, when this browser asked from one", async () => {
    rememberInvitation("/join/abc?m=Zz9");
    const { m } = await open(good);
    await m.change(m.one('input[autocomplete="new-password"]'), "a long enough password");
    await submit(m);
    await m.settle();
    await m.click(m.withText("button", "Log in")!);
    // The login page the router went to carries where to go on from.
    expect(where()).toBe("/login");
    expect(mounted!.host.querySelector("[data-from]")?.getAttribute("data-from")).toBe(
      "/join/abc?m=Zz9",
    );
    expect(localStorage.getItem("frontier.afterReset")).toBeNull();
  });

  it("says an expired or used link has run out, and offers a new one", async () => {
    const { m } = await open(() => failure(410, "link_invalid", "x"));
    expect(m.one("h1").textContent).toBe("This link has expired or was already used");
    expect(m.host.textContent).toContain("Reset links work once and for 30 minutes.");
    await m.click(m.withText("button", "Ask for a new link")!);
    expect(where()).toBe("/forgot-password");
  });

  it("shows the expired page when the link dies between the check and the submit", async () => {
    const { m } = await open((url, method) =>
      method === "POST" ? failure(410, "link_invalid", "x") : good(url, method),
    );
    await m.change(m.one('input[autocomplete="new-password"]'), "a long enough password");
    await submit(m);
    await m.settle();
    expect(m.one("h1").textContent).toBe("This link has expired or was already used");
  });

  it("says why a password was refused and keeps the form", async () => {
    const { m } = await open((url, method) =>
      method === "POST"
        ? failure(400, "invalid", "Use at least 12 characters.")
        : good(url, method),
    );
    await m.change(m.one('input[autocomplete="new-password"]'), "a long enough password");
    await submit(m);
    await m.settle();
    expect(m.one('[role="alert"]').textContent).toBe("Use at least 12 characters.");
    expect(m.host.querySelector("form")).not.toBeNull();
  });

  it("does not submit under 12 characters, even on Enter", async () => {
    const { m, calls } = await open(good);
    await m.change(m.one('input[autocomplete="new-password"]'), "short");
    await submit(m);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("says when the link could not be checked, and tries again", async () => {
    let up = false;
    const { m } = await open((url, method) => (up ? good(url, method) : undefined));
    expect(m.one("h1").textContent).toBe("The link could not be checked");
    up = true;
    await m.click(m.withText("button", "Try again")!);
    await m.settle();
    expect(m.one("h1").textContent).toBe("Choose a new password");
  });
});
