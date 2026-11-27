// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import type { ConfirmResponse } from "@frontier/schema";
import { act, createElement, StrictMode } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMe } from "../me.ts";
import { clearProjects, loadProjects } from "../projects.ts";
import { answer, failure, type Mounted, mount, stubServer } from "../testing/mount.ts";
import { buttonNames, person } from "../testing/email.ts";
import { ConfirmPage, confirmOnce } from "./ConfirmPage.tsx";

let mounted: Mounted | null = null;
let n = 0;
/** A code of its own for each test: the page keeps what it asked for a few seconds. */
const code = () => `code${++n}`.padEnd(32, "x");
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  clearMe();
  clearProjects();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

function Where() {
  return createElement("output", { "data-where": "" }, useLocation().pathname);
}

async function open(
  c: string,
  loggedIn: boolean,
  route: Parameters<typeof stubServer>[0],
  strict = false,
) {
  const calls = stubServer(route);
  const page = createElement(
    Routes,
    null,
    createElement(Route, {
      path: "/confirm/:code",
      element: createElement(ConfirmPage, { code: c, loggedIn }),
    }),
    createElement(Route, { path: "*", element: createElement(Where) }),
  );
  mounted = await mount(
    strict ? createElement(StrictMode, null, page) : page,
    null,
    `/confirm/${c}`,
  );
  await mounted.settle();
  return { m: mounted, calls };
}
const done = (status: ConfirmResponse["status"], you: boolean) =>
  answer({ ok: true, status, you } satisfies ConfirmResponse);
const where = () => mounted!.host.querySelector("[data-where]")?.textContent;

describe("the confirm page", () => {
  it("uses the link once when it loads, and says the address is confirmed", async () => {
    const c = code();
    const { m, calls } = await open(c, false, () => done("confirmed", false));
    const posts = calls.filter((x) => x.method === "POST");
    expect(posts.map((x) => x.url)).toEqual([`/api/confirm/${c}`]);
    expect(m.one("h1").textContent).toBe("Your email address is confirmed");
    expect(document.activeElement).toBe(m.one("h1"));
    expect(document.title).toBe("Email confirmed · Frontier");
  });

  it("offers Log in when nobody is logged in", async () => {
    const { m } = await open(code(), false, () => done("confirmed", false));
    expect(buttonNames(m.host)).toEqual(["Log in"]);
    await m.click(m.withText("button", "Log in")!);
    expect(where()).toBe("/login");
  });

  it("offers to open the project when the person is logged in as that account", async () => {
    const { m } = await open(code(), true, (url) =>
      url.startsWith("/api/confirm/") ? done("confirmed", true) : answer(person()),
    );
    expect(buttonNames(m.host)).toEqual(["Open Frontier"]);
    await m.click(m.withText("button", "Open Frontier")!);
    expect(where()).toBe("/");
  });

  it("names the account's project on the button when it is known", async () => {
    const { m } = await open(code(), true, (url) =>
      url.startsWith("/api/confirm/")
        ? done("confirmed", true)
        : url === "/api/projects"
          ? answer({
              last: "avalymia",
              canCreate: false,
              projects: [
                {
                  id: "projecta01",
                  slug: "avalymia",
                  name: "Avalymia",
                  description: "",
                  colour: 1,
                  role: "writer",
                },
              ],
            })
          : answer(person()),
    );
    await act(async () => void (await loadProjects()));
    await m.settle();
    expect(buttonNames(m.host)).toEqual(["Open Avalymia"]);
  });

  it("says a link opened by another person's browser changed their account, not the one logged in", async () => {
    const { m } = await open(code(), true, (url) =>
      url.startsWith("/api/confirm/") ? done("confirmed", false) : answer(person()),
    );
    expect(m.one("h1").textContent).toBe("Your email address is confirmed");
    expect(buttonNames(m.host)).toEqual(["Open Frontier"]);
  });

  it("says a change of address is done", async () => {
    const { m } = await open(code(), false, () => done("changed", false));
    expect(m.one("h1").textContent).toBe("Your email address was changed");
  });

  it("says already confirmed for a link used before", async () => {
    const { m } = await open(code(), false, () => done("already_confirmed", false));
    expect(m.one("h1").textContent).toBe("This address is already confirmed");
  });

  it("sends the first answer to both runs of the effect, so 'confirmed' is never replaced", async () => {
    // In development React runs the effect twice. The second ask would be answered "already
    // confirmed"; the page asks once and both runs read the same answer.
    const c = code();
    let asked = 0;
    const { m, calls } = await open(
      c,
      false,
      () => (++asked === 1 ? done("confirmed", false) : done("already_confirmed", false)),
      true,
    );
    expect(calls.filter((x) => x.method === "POST")).toHaveLength(1);
    expect(m.one("h1").textContent).toBe("Your email address is confirmed");
  });

  it("shares one request between two askers for the same code, and asks again after a failure", async () => {
    const c = code();
    const call = vi.fn(async () => ({
      ok: true as const,
      status: "confirmed" as const,
      you: false,
    }));
    const [a, b] = [confirmOnce(c, call), confirmOnce(c, call)];
    expect(a).toBe(b);
    expect(call).toHaveBeenCalledTimes(1);
    const d = code();
    const bad = vi.fn(async () => {
      throw new Error("lost");
    });
    await confirmOnce(d, bad).catch(() => undefined);
    await confirmOnce(d, bad).catch(() => undefined);
    expect(bad).toHaveBeenCalledTimes(2);
  });

  it("says a dead link has run out, and for a logged-out person offers Log in and says where Resend is", async () => {
    const { m } = await open(code(), false, () => failure(410, "link_invalid", "x"));
    expect(m.one("h1").textContent).toBe("This link has expired or was already used");
    expect(buttonNames(m.host)).toEqual(["Log in"]);
    expect(m.host.textContent).toContain("press Resend in the banner");
    // It does not promise that logging in sends a new link.
    expect(m.host.textContent).not.toContain("Frontier will send you a new one");
  });

  it("offers a logged-in person a new link right there, and says what happened", async () => {
    let reply = () => answer({ ok: true, applied: false, mail: "sent" });
    const { m, calls } = await open(code(), true, (url) =>
      url.startsWith("/api/confirm/")
        ? failure(410, "link_invalid", "x")
        : url === "/api/me/email/resend"
          ? reply()
          : answer(person()),
    );
    expect(buttonNames(m.host)).toEqual(["Send a new link", "Open Frontier"]);
    await m.click(m.withText("button", "Send a new link")!);
    await m.settle();
    expect(calls.some((x) => x.url === "/api/me/email/resend")).toBe(true);
    expect(m.host.textContent).toContain("Sent. Check your inbox and spam.");
    reply = () => failure(409, "already_confirmed", "x") as never;
    await m.click(m.withText("button", "Send a new link")!);
    await m.settle();
    expect(m.host.textContent).toContain("That address is already confirmed.");
  });

  it("says when the link could not be checked, and tries again", async () => {
    let up = false;
    const { m } = await open(code(), false, () => (up ? done("confirmed", false) : undefined));
    expect(m.one("h1").textContent).toBe("The link could not be checked");
    expect(m.one('[role="alert"]').textContent).toContain("connection");
    up = true;
    await m.click(m.withText("button", "Try again")!);
    await m.settle();
    expect(m.one("h1").textContent).toBe("Your email address is confirmed");
  });

  it("keeps the code out of storage", async () => {
    const c = code();
    await open(c, false, () => done("confirmed", false));
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        expect(store.getItem(store.key(i)!)).not.toContain(c);
        expect(store.key(i)).not.toContain(c);
      }
    }
  });
});
