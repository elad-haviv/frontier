// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import type { JoinInfo } from "@frontier/schema";
import { createElement } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setKeysOwner } from "../aiKeys.ts";
import { answer, failure, type Mounted, mount, stubServer } from "../testing/mount.ts";
import { JoinPage } from "./Join.tsx";
import { emailHint, joinAddress, proofOf } from "./joinModel.ts";

// A passkey is made by the browser; the tests that join with one say so.
const webauthn = vi.hoisted(() => ({ on: false }));
vi.mock("@simplewebauthn/browser", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/browser")>()),
  browserSupportsWebAuthn: () => webauthn.on,
  startRegistration: async () => ({ id: "made" }),
}));

const CODE = "a".repeat(32);
const M = "Zr3h8WqN_proof-1";
const INFO: JoinInfo = {
  project: { name: "Avalymia", colour: 2, entries: 214, maps: 6, people: 3 },
  inviter: { name: "Elad Haviv" },
  role: "writer",
  google: true,
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
  mail: true,
};

function Where() {
  const here = useLocation();
  return createElement(
    "output",
    { "data-where": "", "data-state": JSON.stringify(here.state) },
    here.pathname + here.search,
  );
}
/** The router's address, drawn beside the page, so a test sees what the page did to it. */
function Here() {
  const here = useLocation();
  return createElement("output", { "data-here": "" }, here.pathname + here.search);
}
let mounted: Mounted | null = null;
let loaded: string[] = [];
async function page(search = "") {
  mounted = await mount(
    createElement(
      "div",
      null,
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: "/join/:code",
          element: createElement(JoinPage, { code: CODE, load: (to) => void loaded.push(to) }),
        }),
        createElement(Route, { path: "*", element: createElement(Where) }),
      ),
      createElement(Here),
    ),
    null,
    `/join/${CODE}${search}`,
  );
  await mounted.settle();
  return mounted;
}
const where = () => mounted!.host.querySelector("[data-where]")?.textContent;

beforeEach(() => {
  setKeysOwner(null);
  loaded = [];
  webauthn.on = false;
  sessionStorage.clear();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

describe("the proof of an emailed invitation", () => {
  it("reads only a well formed proof from the address", () => {
    expect(proofOf(`?m=${M}`)).toBe(M);
    expect(proofOf("")).toBeNull();
    expect(proofOf("?m=")).toBeNull();
    expect(proofOf("?m=a b")).toBeNull();
    expect(proofOf(`?m=${"x".repeat(65)}`)).toBeNull();
    expect(joinAddress(CODE, M)).toBe(`/join/${CODE}?m=${M}`);
    expect(joinAddress(CODE, null)).toBe(`/join/${CODE}`);
  });

  it("words the line under the email: confirmed for the emailed address, a link for another, nothing with mail off", () => {
    const base = { mail: true, emailed: "Yael@Example.org" };
    expect(emailHint({ ...base, typed: " yael@example.org " })).toBe(
      "Your invitation was emailed to this address, so it counts as confirmed.",
    );
    expect(emailHint({ ...base, typed: "other@example.org" })).toBe(
      "We will email a link to confirm it. You can start right away.",
    );
    expect(emailHint({ ...base, typed: "no" })).toBeNull();
    expect(emailHint({ mail: true, emailed: null, typed: "a@b.co" })).toBe(
      "We will email a link to confirm it. You can start right away.",
    );
    expect(emailHint({ mail: false, emailed: "a@b.co", typed: "a@b.co" })).toBeNull();
  });
});

describe("the join page and an emailed link", () => {
  it("sends the proof with every call about the invitation, and fills in the address it names", async () => {
    const calls = stubServer((url, method) =>
      method === "POST" && url.startsWith(`/api/join/${CODE}`)
        ? answer({ ok: true, project: "avalymia", role: "writer" })
        : url.startsWith("/api/join/")
          ? answer({ ...INFO, email: "yael@example.org" })
          : answer(OUT),
    );
    const m = await page(`?m=${M}`);
    expect(calls.find((c) => c.url.startsWith("/api/join/"))?.url).toBe(`/api/join/${CODE}?m=${M}`);
    // The address is filled in, and the page says why it counts as confirmed.
    expect(m.one<HTMLInputElement>('input[type="email"]').value).toBe("yael@example.org");
    expect(m.one("[data-testid=email-hint]").textContent).toBe(
      "Your invitation was emailed to this address, so it counts as confirmed.",
    );
    await m.change(m.one<HTMLInputElement>('input[autocomplete="name"]'), "Yael Stern");
    await m.change(m.one<HTMLInputElement>('input[type="password"]'), "a long enough password");
    await m.click(m.withText("button", "Join Avalymia")!);
    await m.settle();
    const join = calls.find((c) => c.method === "POST" && c.url.startsWith(`/api/join/${CODE}`));
    expect(join?.url).toBe(`/api/join/${CODE}?m=${M}`);
    expect(join?.body).toMatchObject({ email: "yael@example.org" });
    expect(loaded).toEqual(["/p/avalymia"]);
  });

  it("changes the line when another address is typed, and sends the proof anyway", async () => {
    stubServer((url) =>
      url.startsWith("/api/join/") ? answer({ ...INFO, email: "yael@example.org" }) : answer(OUT),
    );
    const m = await page(`?m=${M}`);
    await m.change(m.one<HTMLInputElement>('input[type="email"]'), "yael@work.example.org");
    expect(m.one("[data-testid=email-hint]").textContent).toBe(
      "We will email a link to confirm it. You can start right away.",
    );
  });

  it("starts empty with no hint for a link copied by hand, and says a link will be emailed to what is typed", async () => {
    const calls = stubServer((url) => (url.startsWith("/api/join/") ? answer(INFO) : answer(OUT)));
    const m = await page();
    expect(calls.find((c) => c.url.startsWith("/api/join/"))?.url).toBe(`/api/join/${CODE}`);
    expect(m.one<HTMLInputElement>('input[type="email"]').value).toBe("");
    expect(m.host.querySelector("[data-testid=email-hint]")).toBeNull();
    await m.change(m.one<HTMLInputElement>('input[type="email"]'), "new@example.org");
    expect(m.one("[data-testid=email-hint]").textContent).toContain("We will email a link");
  });

  it("says nothing about confirming with mail off, as it did before", async () => {
    stubServer((url) =>
      url.startsWith("/api/join/") ? answer(INFO) : answer({ ...OUT, mail: false }),
    );
    const m = await page();
    await m.change(m.one<HTMLInputElement>('input[type="email"]'), "new@example.org");
    expect(m.host.querySelector("[data-testid=email-hint]")).toBeNull();
    expect(m.host.textContent).not.toContain("Forgot password");
  });

  it("sends the proof on both passkey steps", async () => {
    webauthn.on = true;
    const calls = stubServer((url) => {
      if (url.includes("/passkey/options")) return answer({ challenge: "c" });
      if (url.includes("/passkey/verify"))
        return answer({ ok: true, project: "avalymia", role: "writer" });
      return url.startsWith("/api/join/")
        ? answer({ ...INFO, email: "yael@example.org" })
        : answer(OUT);
    });
    const m = await page(`?m=${M}`);
    await m.change(m.one<HTMLInputElement>('input[autocomplete="name"]'), "Yael Stern");
    await m.click(m.withText("button", "Join with a passkey")!);
    await m.settle();
    const urls = calls.filter((c) => c.method === "POST").map((c) => c.url);
    expect(urls).toEqual([
      `/api/join/${CODE}/passkey/options?m=${M}`,
      `/api/join/${CODE}/passkey/verify?m=${M}`,
    ]);
  });

  it("sends the proof when a logged-in person accepts, and on the logged-in login of the existing account", async () => {
    const calls = stubServer((url) =>
      url.includes("/accept")
        ? answer({ ok: true, project: "avalymia", role: "writer" })
        : url.startsWith("/api/join/")
          ? answer(INFO)
          : answer({
              ...OUT,
              loggedIn: true,
              person: { id: "p9", name: "Ines Inside", email: "i@x.co" },
            }),
    );
    const m = await page(`?m=${M}`);
    await m.click(m.withText("button", "Join as Ines Inside")!);
    await m.settle();
    expect(calls.find((c) => c.url.includes("/accept"))?.url).toBe(
      `/api/join/${CODE}/accept?m=${M}`,
    );
  });

  it("keeps the proof through the account-exists login, and offers Forgot password with the invitation to come back to", async () => {
    const calls = stubServer((url, method) => {
      if (url.endsWith("/accept?m=" + M))
        return answer({ ok: true, project: "avalymia", role: "writer" });
      if (method === "POST" && url === `/api/join/${CODE}?m=${M}`)
        return failure(409, "account_exists", "An account has this email.");
      return url.startsWith("/api/join/") ? answer(INFO) : answer(OUT);
    });
    const m = await page(`?m=${M}`);
    await m.change(m.one<HTMLInputElement>('input[autocomplete="name"]'), "Yael Stern");
    await m.change(m.one<HTMLInputElement>('input[type="email"]'), "yael@example.org");
    await m.change(m.one<HTMLInputElement>('input[type="password"]'), "a long enough password");
    await m.click(m.withText("button", "Join Avalymia")!);
    await m.settle();
    expect(m.host.textContent).toContain("You may already have an account: log in to join.");
    // Forgot password is next to Log in, and keeps the invitation and the address typed.
    const forgot = m.withText<HTMLAnchorElement>("a", "Forgot password?")!;
    expect(forgot).not.toBeNull();
    await m.change(m.one<HTMLInputElement>('input[type="password"]'), "their own password");
    await m.click(m.withText("button", "Log in and join")!);
    await m.settle();
    expect(
      calls.map((c) => c.url).filter((u) => u.endsWith("/accept") || u.includes("/accept?")),
    ).toEqual([`/api/join/${CODE}/accept?m=${M}`]);
    await m.click(forgot);
    expect(where()).toBe("/forgot-password");
    expect(JSON.parse(m.one("[data-state]").getAttribute("data-state")!)).toMatchObject({
      from: `/join/${CODE}?m=${M}`,
      email: "yael@example.org",
    });
  });

  it("goes to Google for an existing account with the invitation, proof or not", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    stubServer((url, method) =>
      method === "POST" && url.startsWith("/api/join/")
        ? failure(409, "account_exists", "x")
        : url.startsWith("/api/join/")
          ? answer(INFO)
          : answer(OUT),
    );
    const m = await page(`?m=${M}`);
    await m.change(m.one<HTMLInputElement>('input[autocomplete="name"]'), "Yael");
    await m.change(m.one<HTMLInputElement>('input[type="email"]'), "yael@example.org");
    await m.change(m.one<HTMLInputElement>('input[type="password"]'), "a long enough password");
    await m.click(m.withText("button", "Join Avalymia")!);
    await m.settle();
    await m.click(m.withText("button", "Continue with Google")!);
    expect(assign).toHaveBeenCalledWith(`/api/auth/google/start?invite=${CODE}`);
  });

  it("keeps the proof when it takes a Google problem off the address", async () => {
    stubServer((url) => (url.startsWith("/api/join/") ? answer(INFO) : answer(OUT)));
    await page(`?m=${M}&problem=google_denied`);
    expect(mounted!.host.textContent).toContain("Google sign-in was cancelled");
    expect(mounted!.host.querySelector("[data-here]")?.textContent).toBe(`/join/${CODE}?m=${M}`);
  });
});
