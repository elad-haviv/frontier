// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import type { JoinInfo } from "@frontier/schema";
import { createElement } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setKeysOwner } from "../aiKeys.ts";
import { answer, failure, type Mounted, mount, stubServer } from "../testing/mount.ts";
import { JoinPage } from "./Join.tsx";

const CODE = "a".repeat(32);
const INFO: JoinInfo = {
  project: { name: "Avalymia", colour: 2, entries: 214, maps: 6, people: 3 },
  inviter: { name: "Elad Haviv" },
  role: "writer",
  google: false,
  alreadyMember: false,
};
const OUT = {
  loggedIn: false,
  person: null,
  emailless: false,
  passkeys: false,
  password: true,
  google: false,
};

/** Shows where the router is, so a test can see where joining went. */
function Where() {
  return createElement("output", { "data-where": "" }, useLocation().pathname);
}

let mounted: Mounted | null = null;
let signedIn = 0;
async function page(code = CODE) {
  mounted = await mount(
    createElement(
      Routes,
      null,
      createElement(Route, {
        path: "/join/:code",
        element: createElement(JoinPage, { code, onSignedIn: () => void signedIn++ }),
      }),
      createElement(Route, { path: "*", element: createElement(Where) }),
    ),
    null,
    `/join/${code}`,
  );
  await mounted.settle();
  return mounted;
}
const where = () => mounted!.host.querySelector("[data-where]")?.textContent;

beforeEach(() => {
  setKeysOwner(null);
  signedIn = 0;
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

describe("the join page", () => {
  it("says who invited you, to what, as what and how big it is, with the AI key note", async () => {
    stubServer((url) => (url.includes("/api/join/") ? answer(INFO) : answer(OUT)));
    const m = await page();
    expect(m.one("h1").textContent).toBe("Elad Haviv invited you to write in Avalymia");
    const card = m.one(".join-project").textContent ?? "";
    expect(card).toContain("214 entries · 6 maps · 3 people");
    expect(card).toContain("Writer");
    expect(m.host.textContent).toContain("As a writer you can read and change entries");
    expect(m.host.textContent).toContain("runs on your own AI key");
    // The passkey comes first, then the password; no Google while the server does not offer it.
    expect(m.withText("button", "Join with a passkey on this device")).not.toBeNull();
    expect(m.withText("button", "Continue with Google")).toBeNull();
    expect(m.withText("button", "Join Avalymia")).not.toBeNull();
  });

  it("offers Google when the server does", async () => {
    stubServer((url) =>
      url.includes("/api/join/") ? answer({ ...INFO, google: true }) : answer(OUT),
    );
    const m = await page();
    expect(m.withText("button", "Continue with Google")).not.toBeNull();
  });

  it("asks for a name, an email and a password before it asks the server", async () => {
    const calls = stubServer((url) => (url.includes("/api/join/") ? answer(INFO) : answer(OUT)));
    const m = await page();
    await m.click(m.withText("button", "Join Avalymia")!);
    expect(m.host.textContent).toContain("Give your name.");
    expect(m.host.textContent).toContain("Give your email.");
    expect(m.host.textContent).toContain("Use at least 12 characters.");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("joins with a password, tells the app a session started, and opens the project", async () => {
    const calls = stubServer((url, method) =>
      method === "POST" && url === `/api/join/${CODE}`
        ? answer({ ok: true, project: "avalymia", role: "writer" })
        : url.includes("/api/join/")
          ? answer(INFO)
          : answer(OUT),
    );
    const m = await page();
    await m.change(m.one<HTMLInputElement>('input[autocomplete="name"]'), "Yael Stern");
    await m.change(m.one<HTMLInputElement>('input[type="email"]'), "yael@example.org");
    await m.change(m.one<HTMLInputElement>('input[type="password"]'), "a long enough password");
    await m.click(m.withText("button", "Join Avalymia")!);
    await m.settle();
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      url: `/api/join/${CODE}`,
      body: { name: "Yael Stern", email: "yael@example.org", password: "a long enough password" },
    });
    expect(signedIn).toBe(1);
    expect(where()).toBe("/p/avalymia");
  });

  it("sends an email that has an account to log in, and takes the link into that account", async () => {
    const calls = stubServer((url, method) => {
      if (method === "POST" && url === `/api/join/${CODE}`) {
        return failure(409, "account_exists", "An account has this email.");
      }
      if (url === "/api/login") return answer({ ok: true });
      if (url === `/api/join/${CODE}/accept`) {
        return answer({ ok: true, project: "avalymia", role: "writer" });
      }
      return url.includes("/api/join/") ? answer(INFO) : answer({ ...OUT, passkeys: true });
    });
    const m = await page();
    await m.change(m.one<HTMLInputElement>('input[autocomplete="name"]'), "Yael Stern");
    await m.change(m.one<HTMLInputElement>('input[type="email"]'), "yael@example.org");
    await m.change(m.one<HTMLInputElement>('input[type="password"]'), "a long enough password");
    await m.click(m.withText("button", "Join Avalymia")!);
    await m.settle();
    expect(m.host.textContent).toContain(
      "Log in with your account, and this invitation goes into it.",
    );
    // Their email is kept in the login form, and the passkey is offered as on the login page.
    expect(m.one<HTMLInputElement>('input[type="email"]').value).toBe("yael@example.org");
    expect(m.withText("button", "Use a passkey")).not.toBeNull();
    await m.change(m.one<HTMLInputElement>('input[type="password"]'), "their own password");
    await m.click(m.withText("button", "Log in and join")!);
    await m.settle();
    expect(
      calls.map((c) => c.url).filter((u) => u === "/api/login" || u.endsWith("/accept")),
    ).toEqual(["/api/login", `/api/join/${CODE}/accept`]);
    expect(signedIn).toBe(1);
    expect(where()).toBe("/p/avalymia");
  });

  it("offers a person who is logged in to join as themselves", async () => {
    const calls = stubServer((url) => {
      if (url === `/api/join/${CODE}/accept`) {
        return answer({ ok: true, project: "avalymia", role: "writer" });
      }
      return url.includes("/api/join/")
        ? answer(INFO)
        : answer({
            ...OUT,
            loggedIn: true,
            person: { id: "p9", name: "Ines Inside", email: "ines@example.org" },
          });
    });
    const m = await page();
    expect(m.host.textContent).toContain("You are logged in as Ines Inside.");
    // No form to make an account while there is one logged in.
    expect(m.host.querySelector('input[type="password"]')).toBeNull();
    await m.click(m.withText("button", "Join as Ines Inside")!);
    await m.settle();
    expect(calls.some((c) => c.url.endsWith("/accept") && c.method === "POST")).toBe(true);
    // They were already in a session: the app has nothing new to learn.
    expect(signedIn).toBe(0);
    expect(where()).toBe("/p/avalymia");
  });

  it("takes someone who is in the project already to it, without using the link", async () => {
    stubServer((url) => {
      if (url === `/api/join/${CODE}/accept`) {
        return failure(409, "already_member", "You are in this project.", { project: "avalymia" });
      }
      return url.includes("/api/join/")
        ? answer({ ...INFO, alreadyMember: true })
        : answer({ ...OUT, loggedIn: true, person: { id: "p9", name: "Ines Inside", email: "" } });
    });
    await page();
    await mounted!.settle();
    expect(where()).toBe("/p/avalymia");
  });

  it("keeps a message for each way a link can be dead, with the name of whom to ask", async () => {
    for (const [code, status, title, ask] of [
      ["invite_used", 410, "This invite link was already used", "ask Elad Haviv for a new one"],
      ["invite_cancelled", 410, "This invitation was cancelled", "Ask Elad Haviv for a new link"],
      ["invite_expired", 410, "This invite link has run out", "Ask Elad Haviv for a new one"],
      ["invite_unknown", 404, "This link does not work", "cut short"],
    ] as const) {
      stubServer((url) =>
        url.includes("/api/join/")
          ? failure(status, code, "", code === "invite_unknown" ? {} : { inviter: "Elad Haviv" })
          : answer(OUT),
      );
      const m = await page();
      expect(m.one("h1").textContent, code).toBe(title);
      expect(m.host.textContent, code).toContain(ask);
      // No way to join a dead link.
      expect(m.withText("button", "Join"), code).toBeNull();
      await m.unmount();
      mounted = null;
    }
  });

  it("says plainly that there were too many tries", async () => {
    stubServer((url) =>
      url.includes("/api/join/") ? failure(429, "rate_limited", "Too many attempts.") : answer(OUT),
    );
    const m = await page();
    expect(m.one("h1").textContent).toBe("The invitation could not be opened");
    expect(m.host.textContent).toContain("Too many tries from this address.");
    expect(m.withText("button", "Try again")).not.toBeNull();
  });

  it("says a Google trip that did not work, from the address", async () => {
    stubServer((url) => (url.includes("/api/join/") ? answer(INFO) : answer(OUT)));
    mounted = await mount(
      createElement(JoinPage, { code: CODE }),
      null,
      `/join/${CODE}?problem=google_denied`,
    );
    await mounted.settle();
    expect(mounted.one("[role=alert]").textContent).toContain("Google sign-in was cancelled");
  });
});
