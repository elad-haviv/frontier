// @vitest-environment happy-dom
import { createElement } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { answer, type Mounted, mount, stubServer } from "../testing/mount.ts";
import { Login } from "./Login.tsx";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const session = (over = {}) => ({
  loggedIn: false,
  person: null,
  emailless: false,
  passkeys: true,
  password: true,
  google: false,
  ...over,
});

async function login(over = {}, at = "/login") {
  stubServer(() => answer(session(over)));
  mounted = await mount(createElement(Login, { onLoggedIn: () => undefined }), null, at);
  await mounted.settle();
  return mounted;
}

describe("the login page", () => {
  it("offers the passkey first, then the password, and Google only when the server does", async () => {
    const m = await login();
    const names = [...m.host.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(names).toEqual(["Use a passkey", "Log in"]);
    expect(m.withText("button", "Continue with Google")).toBeNull();
  });

  it("shows Continue with Google between the passkey and the password when it is offered", async () => {
    const m = await login({ google: true });
    const names = [...m.host.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(names).toEqual(["Use a passkey", "GContinue with Google", "Log in"]);
  });

  it("works with only Google and the password, without a passkey", async () => {
    const m = await login({ google: true, passkeys: false });
    expect(m.withText("button", "Use a passkey")).toBeNull();
    expect(m.withText("button", "Continue with Google")).not.toBeNull();
  });

  it("says why a Google trip did not work, from the address, and keeps the other ways", async () => {
    const m = await login({ google: true }, "/login?problem=google_no_account");
    const alert = m.one("[role=alert]").textContent ?? "";
    expect(alert).toContain("no Frontier account yet");
    expect(alert).toContain("invite link");
    expect(m.one("form")).toBeTruthy();
  });

  it("takes the problem off the address once it is said, so a reload does not repeat it", async () => {
    stubServer(() => answer(session({ google: true })));
    const Where = () => createElement("output", { id: "where" }, useLocation().search);
    mounted = await mount(
      createElement(
        "div",
        null,
        createElement(Where),
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: "/login",
            element: createElement(Login, { onLoggedIn: () => undefined }),
          }),
        ),
      ),
      null,
      "/login?problem=google_denied",
    );
    await mounted.settle();
    expect(mounted.one("[role=alert]").textContent).toContain("cancelled");
    expect(mounted.one("#where").textContent).toBe("");
  });

  it("says nothing for a problem it does not know", async () => {
    const m = await login({}, "/login?problem=something_new");
    expect(m.host.querySelector("[role=alert]")).toBeNull();
  });

  it("sends the browser to the server's Google start, carrying where it was going", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    stubServer(() => answer(session({ google: true })));
    mounted = await mount(createElement(Login, { onLoggedIn: () => undefined }), null, "/login");
    await mounted.settle();
    await mounted.click(mounted.withText("button", "Continue with Google")!);
    expect(assign).toHaveBeenCalledWith("/api/auth/google/start");
  });

  it("keeps the blank-email hint for the one account that has no email", async () => {
    const m = await login({ emailless: true, passkeys: false });
    expect(m.host.textContent).toContain("This account has no email yet. Leave this empty.");
    await m.unmount();
    mounted = null;
    const other = await login({ emailless: false, passkeys: false });
    expect(other.host.textContent).not.toContain("has no email yet");
  });
});

describe("the login page and forgot password (stage 32)", () => {
  it("offers Forgot password only when the server sends mail and passwords are in use", async () => {
    const on = await login({ mail: true });
    const link = on.withText<HTMLAnchorElement>("a", "Forgot password?");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/forgot-password");
    await on.unmount();
    mounted = null;
    const off = await login({ mail: false });
    expect(off.withText("a", "Forgot password?")).toBeNull();
    await off.unmount();
    mounted = null;
    // The password is switched off: there is nothing to reset, and no form to put the link in.
    const noPassword = await login({ mail: true, password: false });
    expect(noPassword.withText("a", "Forgot password?")).toBeNull();
  });

  it("keeps the buttons as they were, the link being a link", async () => {
    const m = await login({ mail: true });
    const names = [...m.host.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(names).toEqual(["Use a passkey", "Log in"]);
  });
});
