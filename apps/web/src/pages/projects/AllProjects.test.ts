// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAccessNotice, noteAccessLost } from "../../access.ts";
import { setKeysOwner } from "../../aiKeys.ts";
import { clearMe, noteMe } from "../../me.ts";
import { clearProjects } from "../../projects.ts";
import { emailInfo, person } from "../../testing/email.ts";
import { answer, type Mounted, mount, stubServer } from "../../testing/mount.ts";
import { AllProjects } from "./AllProjects.tsx";

let mounted: Mounted | null = null;
beforeEach(() => setKeysOwner("p1"));
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  clearAccessNotice();
  clearProjects();
  clearMe();
  setKeysOwner(null);
  vi.unstubAllGlobals();
});

async function open(list: { projects: unknown[]; canCreate: boolean }) {
  stubServer(() => answer({ last: null, ...list }));
  mounted = await mount(createElement(AllProjects), null, "/projects");
  await mounted.settle();
  return mounted;
}

describe("All projects for a person who is in none", () => {
  it("explains the invite link, and offers no new project to someone who may not make one", async () => {
    const m = await open({ projects: [], canCreate: false });
    const text = m.one(".all-projects-empty").textContent ?? "";
    expect(text).toContain("You're not in a project yet.");
    expect(text).toContain("invite link from one of its owners");
    expect(text).toContain("Frontier sends no mail");
    expect(m.withText("button", "New project")).toBeNull();
  });

  it("says an owner can have Frontier email the link, instead of that Frontier sends no mail, when it does", async () => {
    noteMe(person({ emailInfo: emailInfo({ mailOn: true }) }));
    const m = await open({ projects: [], canCreate: false });
    const text = m.one(".all-projects-empty").textContent ?? "";
    expect(text).toContain("They can have Frontier email it to you.");
    expect(text).not.toContain("Frontier sends no mail");
  });

  it("keeps saying that Frontier sends no mail when the server says it sends none", async () => {
    noteMe(person({ emailInfo: emailInfo({ mailOn: false }) }));
    const m = await open({ projects: [], canCreate: false });
    expect(m.one(".all-projects-empty").textContent).toContain("Frontier sends no mail");
  });

  it("offers New project to the server's first account, and still mentions the link", async () => {
    const m = await open({ projects: [], canCreate: true });
    expect(m.withText("button", "New project")).not.toBeNull();
    expect(m.host.textContent).toContain("open an invite link from an owner of another");
  });
});

describe("a project that was lost while the app was open", () => {
  it("says so in plain words, once, and can be dismissed", async () => {
    noteAccessLost("Sample");
    const m = await open({ projects: [], canCreate: false });
    const notice = m.one(".access-notice").textContent ?? "";
    expect(notice).toContain("You are no longer in Sample.");
    await m.click(m.withText("button", "Dismiss")!);
    expect(m.host.querySelector(".access-notice")).toBeNull();
  });
});
