// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import type { JoinInfo } from "@frontier/schema";
import { act, createElement } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setKeysOwner } from "../aiKeys.ts";
import { answer, failure, type Mounted, mount, stubServer } from "../testing/mount.ts";
import { JoinPage } from "./Join.tsx";
import { takeJoined } from "../access.ts";

// Whether the browser can make a passkey is the browser's; a test says.
const webauthn = vi.hoisted(() => ({ on: true }));
vi.mock("@simplewebauthn/browser", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/browser")>()),
  browserSupportsWebAuthn: () => webauthn.on,
}));

const CODE = "a".repeat(32);
const INFO: JoinInfo = {
  project: { name: "Avalymia", colour: 2, entries: 214, maps: 6, people: 3 },
  inviter: { name: "Elad Haviv" },
  role: "writer",
  google: false,
  alreadyMember: false,
  email: null,
  pendingGoogle: null,
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
/** The addresses the page loaded afresh (the whole app again), in order. */
let loaded: string[] = [];
async function page(code = CODE) {
  mounted = await mount(
    createElement(
      Routes,
      null,
      createElement(Route, {
        path: "/join/:code",
        element: createElement(JoinPage, { code, load: (to) => void loaded.push(to) }),
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
  loaded = [];
  webauthn.on = true;
  sessionStorage.clear();
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

  it("back from Google, offers a click and makes nothing until it", async () => {
    const calls = stubServer((url, method) =>
      method === "POST" && url === `/api/join/${CODE}/google`
        ? answer({ ok: true, project: "avalymia", role: "writer" })
        : url.includes("/api/join/")
          ? answer({
              ...INFO,
              google: true,
              pendingGoogle: { name: "Yael Stern", email: "yael@example.org" },
            })
          : answer(OUT),
    );
    const m = await page();
    // The page shows who Google says it is, and no form to fill in.
    expect(m.host.textContent).toContain("yael@example.org");
    expect(m.host.querySelector('input[type="password"]')).toBeNull();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    await m.click(m.withText("button", "Join as Yael Stern with Google")!);
    await m.settle();
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      url: `/api/join/${CODE}/google`,
    });
    expect(loaded).toEqual(["/p/avalymia"]);
  });

  it("lets the person drop the Google profile, and then shows the other ways", async () => {
    const calls = stubServer((url, method) =>
      method === "DELETE" && url === `/api/join/${CODE}/google`
        ? answer({ ok: true })
        : url.includes("/api/join/")
          ? answer({
              ...INFO,
              google: true,
              pendingGoogle: { name: "Yael Stern", email: "yael@example.org" },
            })
          : answer(OUT),
    );
    const m = await page();
    await m.click(m.withText("button", "Use another way to join")!);
    await m.settle();
    expect(calls.find((c) => c.method === "DELETE")).toBeDefined();
    expect(m.withText("button", "Join as Yael Stern with Google")).toBeNull();
    expect(m.withText("button", "Continue with Google")).not.toBeNull();
    expect(m.host.querySelector('input[type="password"]')).not.toBeNull();
  });

  it("turns into the login form when the Google email has an account", async () => {
    stubServer((url, method) =>
      method === "POST" && url === `/api/join/${CODE}/google`
        ? failure(409, "account_exists", "An account already has that email.")
        : url.includes("/api/join/")
          ? answer({
              ...INFO,
              google: true,
              pendingGoogle: { name: "Yael Stern", email: "yael@example.org" },
            })
          : answer(OUT),
    );
    const m = await page();
    await m.click(m.withText("button", "Join as Yael Stern with Google")!);
    await m.settle();
    expect(m.host.textContent).toContain("You may already have an account: log in to join.");
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

  it("joins with a password, and loads the project afresh so no earlier person's shell is used", async () => {
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
    // A session was started here: the whole app is loaded again, not moved inside this one.
    expect(loaded).toEqual(["/p/avalymia"]);
    expect(where()).toBeUndefined();
    expect(takeJoined()).toBe("You joined Avalymia as a writer.");
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
    // It says why the page changed, and not that anything about Google is kept.
    expect(m.one("[role=status].join-switched").textContent).toBe(
      "You may already have an account: log in to join.",
    );
    // The focus is on the login form's first field.
    expect(document.activeElement).toBe(m.one('input[type="email"]'));
    // Their email is kept in the login form, and the passkey is offered as on the login page.
    expect(m.one<HTMLInputElement>('input[type="email"]').value).toBe("yael@example.org");
    expect(m.withText("button", "Use a passkey")).not.toBeNull();
    await m.change(m.one<HTMLInputElement>('input[type="password"]'), "their own password");
    await m.click(m.withText("button", "Log in and join")!);
    await m.settle();
    expect(
      calls.map((c) => c.url).filter((u) => u === "/api/login" || u.endsWith("/accept")),
    ).toEqual(["/api/login", `/api/join/${CODE}/accept`]);
    expect(loaded).toEqual(["/p/avalymia"]);
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
    expect(loaded).toEqual([]);
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

describe("the join page, after the review (stage 27c)", () => {
  const typeAll = async (m: Mounted, password = "") => {
    await m.change(m.one<HTMLInputElement>('input[autocomplete="name"]'), "Yael Stern");
    await m.change(m.one<HTMLInputElement>('input[type="email"]'), "yael@example.org");
    if (password) await m.change(m.one<HTMLInputElement>('input[type="password"]'), password);
  };
  const accountExists = (over: Record<string, unknown> = {}) =>
    stubServer((url, method) => {
      if (method === "POST" && url === `/api/join/${CODE}`) {
        return failure(409, "account_exists", "An account has this email.");
      }
      if (url === "/api/login") return answer({ ok: true });
      if (url === `/api/join/${CODE}/accept`) {
        return over.accept
          ? (over.accept as Response)
          : answer({ ok: true, project: "avalymia", role: "writer" });
      }
      return url.includes("/api/join/") ? answer(INFO) : answer(OUT);
    });

  it("lets an existing account that is not in the project log in on the page and accept", async () => {
    const calls = accountExists();
    const m = await page();
    await m.click(m.withText("button", "Log in to join")!);
    await m.change(m.one<HTMLInputElement>('input[type="email"]'), "ines@example.org");
    await m.change(m.one<HTMLInputElement>('input[type="password"]'), "their own password");
    await m.click(m.withText("button", "Log in and join")!);
    await m.settle();
    expect(calls.filter((c) => c.url === "/api/login")[0]!.body).toEqual({
      email: "ines@example.org",
      password: "their own password",
    });
    expect(calls.some((c) => c.url === `/api/join/${CODE}/accept`)).toBe(true);
    expect(loaded).toEqual(["/p/avalymia"]);
  });

  it("loads the page again, which shows a dead link as one, when the link died after the login", async () => {
    accountExists({ accept: failure(410, "invite_used", "Used.", { inviter: "Elad Haviv" }) });
    const m = await page();
    await m.click(m.withText("button", "Log in to join")!);
    await m.change(m.one<HTMLInputElement>('input[type="email"]'), "ines@example.org");
    await m.change(m.one<HTMLInputElement>('input[type="password"]'), "their own password");
    await m.click(m.withText("button", "Log in and join")!);
    await m.settle();
    // The login worked, so the app has to know: it is loaded again, not left as it was.
    expect(loaded).toEqual([`/join/${CODE}`]);
  });

  it("shows the dead-link page when the link died while the form was open", async () => {
    stubServer((url, method) =>
      method === "POST" && url === `/api/join/${CODE}`
        ? failure(410, "invite_used", "Used.", { inviter: "Elad Haviv" })
        : url.includes("/api/join/")
          ? answer(INFO)
          : answer(OUT),
    );
    const m = await page();
    await typeAll(m, "a long enough password");
    await m.click(m.withText("button", "Join Avalymia")!);
    await m.settle();
    expect(m.one("h1").textContent).toBe("This invite link was already used");
  });

  it("shows the dead-link page to a logged-in person who accepts a link that has died", async () => {
    stubServer((url) => {
      if (url === `/api/join/${CODE}/accept`) {
        return failure(410, "invite_cancelled", "Cancelled.", { inviter: "Elad Haviv" });
      }
      return url.includes("/api/join/")
        ? answer(INFO)
        : answer({ ...OUT, loggedIn: true, person: { id: "p9", name: "Ines", email: "i@e.org" } });
    });
    const m = await page();
    await m.click(m.withText("button", "Join as Ines")!);
    await m.settle();
    expect(m.one("h1").textContent).toBe("This invitation was cancelled");
  });

  it("loads the project afresh for a logged-in person who is not the one the app is set up for", async () => {
    setKeysOwner("someone-else");
    stubServer((url) =>
      url === `/api/join/${CODE}/accept`
        ? answer({ ok: true, project: "avalymia", role: "writer" })
        : url.includes("/api/join/")
          ? answer(INFO)
          : answer({
              ...OUT,
              loggedIn: true,
              person: { id: "p9", name: "Ines", email: "i@e.org" },
            }),
    );
    const m = await page();
    await m.click(m.withText("button", "Join as Ines")!);
    await m.settle();
    expect(loaded).toEqual(["/p/avalymia"]);
    expect(where()).toBeUndefined();
  });

  it("puts Google, then the passkey, then the password, after the name and the email", async () => {
    stubServer((url) =>
      url.includes("/api/join/") ? answer({ ...INFO, google: true }) : answer(OUT),
    );
    const m = await page();
    const order = [...m.host.querySelectorAll("input, button, .login-or")].map(
      (e) => e.getAttribute("autocomplete") ?? e.textContent?.trim(),
    );
    expect(order.slice(0, 7)).toEqual([
      "name",
      "email",
      "GContinue with Google",
      "Join with a passkey on this device",
      "or with a password",
      "new-password",
      "Join Avalymia",
    ]);
  });

  it("hides the passkey button where the browser cannot make a passkey", async () => {
    webauthn.on = false;
    stubServer((url) => (url.includes("/api/join/") ? answer(INFO) : answer(OUT)));
    const m = await page();
    expect(m.withText("button", "passkey")).toBeNull();
    // The login form hides it too.
    accountExists();
    await m.click(m.withText("button", "Log in to join")!);
    await m.settle();
    expect(m.withText("button", "Use a passkey")).toBeNull();
  });

  it("does not join with a password nobody typed when Enter is pressed in the name or the email", async () => {
    const calls = stubServer((url) => (url.includes("/api/join/") ? answer(INFO) : answer(OUT)));
    const m = await page();
    await typeAll(m);
    const press = (el: Element) =>
      act(async () => {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
    await press(m.one('input[type="email"]'));
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(document.activeElement).toBe(m.one('input[type="password"]'));
    // With nothing typed, it goes to the first empty field instead.
    await m.change(m.one<HTMLInputElement>('input[autocomplete="name"]'), "");
    await press(m.one('input[type="email"]'));
    expect(document.activeElement).toBe(m.one('input[autocomplete="name"]'));
  });

  it("announces a field's error and puts the focus on the first field that is not right", async () => {
    stubServer((url) => (url.includes("/api/join/") ? answer(INFO) : answer(OUT)));
    const m = await page();
    await m.click(m.withText("button", "Join Avalymia")!);
    const alerts = [...m.host.querySelectorAll("em[role=alert]")].map((e) => e.textContent);
    expect(alerts).toEqual(["Give your name.", "Give your email.", "Use at least 12 characters."]);
    expect(document.activeElement).toBe(m.one('input[autocomplete="name"]'));
    await typeAll(m);
    await m.click(m.withText("button", "Join Avalymia")!);
    expect(document.activeElement).toBe(m.one('input[type="password"]'));
  });

  it("names the page for the project, and takes the problem off the address", async () => {
    stubServer((url) => (url.includes("/api/join/") ? answer(INFO) : answer(OUT)));
    const Where = () => createElement("output", { id: "search" }, useLocation().search);
    mounted = await mount(
      createElement(
        "div",
        null,
        createElement(Where),
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: "/join/:code",
            element: createElement(JoinPage, { code: CODE }),
          }),
        ),
      ),
      null,
      `/join/${CODE}?problem=google_denied`,
    );
    await mounted.settle();
    expect(document.title).toBe("Join Avalymia · Frontier");
    expect(mounted.one("[role=alert]").textContent).toContain("Google sign-in was cancelled");
    expect(mounted.one("#search").textContent).toBe("");
  });

  it("says, after Google, that the person may have an account, without saying anything is kept", async () => {
    stubServer((url) => (url.includes("/api/join/") ? answer(INFO) : answer(OUT)));
    mounted = await mount(
      createElement(JoinPage, { code: CODE }),
      null,
      `/join/${CODE}?problem=account_exists`,
    );
    await mounted.settle();
    expect(mounted.one(".join-switched").textContent).toBe(
      "You may already have an account: log in to join.",
    );
    expect(mounted.host.textContent).not.toContain("kept");
  });
});
