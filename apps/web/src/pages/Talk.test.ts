// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { createElement } from "react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setCurrentProject } from "../project.ts";
import { ALPHA } from "../testing/switchProject.ts";
import { answer, type Mounted, mount, projectInfo, stubServer } from "../testing/mount.ts";
import { TalkPage } from "./Talk.tsx";

vi.mock("../components/Shell.tsx", () => ({ useRefresh: () => () => undefined }));

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  setCurrentProject(null);
  vi.unstubAllGlobals();
});

const PROFILE = {
  entry: "abcd1234",
  name: "Shade",
  traits: [{ kind: "voice", text: "Speaks slowly.", sources: [], quotes: [] }],
  moment: { words: "Before the fire", year: null },
  approvedAt: "2026-11-27T10:00:00Z",
};
const LINE = {
  who: "character",
  text: "We count by the currents.",
  sources: [],
  quotes: [],
  improvised: true,
  kept: false,
};
const TALK = {
  id: "talk00000001",
  entry: "abcd1234",
  at: "2026-11-27T10:00:00Z",
  updatedAt: "2026-11-27T10:00:00Z",
  moment: PROFILE.moment,
  lines: [{ who: "author", text: "How do you count days?" }, LINE],
};

async function open(role: "owner" | "writer" | "reader", profile: unknown) {
  const calls = stubServer((url) => {
    if (url.includes("/characters/profile")) return answer({ profile });
    if (url.includes("/characters/talks/")) return answer({ talk: TALK });
    if (url.includes("/characters/talks")) {
      return answer({
        talks: [
          {
            id: TALK.id,
            at: TALK.at,
            updatedAt: TALK.updatedAt,
            moment: TALK.moment,
            title: "How do you count days?",
            lines: 2,
            kept: 0,
          },
        ],
      });
    }
    return answer({});
  });
  setCurrentProject(ALPHA);
  mounted = await mount(
    createElement(
      Routes,
      null,
      createElement(Route, { path: "/talk/*", element: createElement(TalkPage) }),
    ),
    projectInfo({ role }),
    "/talk/People/Shade.md",
  );
  await mounted.settle();
  await mounted.settle();
  return { m: mounted, calls };
}

describe("talking with a character, by role", () => {
  it("lets a reader talk to a character that has a profile, and nothing that writes", async () => {
    const { m } = await open("reader", PROFILE);
    expect(m.host.textContent).toContain("How do you count days?");
    expect(m.host.querySelector('textarea[aria-label="Say something to Shade"]')).not.toBeNull();
    // No adding a line to the entry, no editing the profile.
    expect(m.withText("button", "Add to Shade")).toBeNull();
    expect(m.withText("button", "Edit")).toBeNull();
  });

  it("offers a writer to add a line to the entry and to edit the profile", async () => {
    const { m } = await open("writer", PROFILE);
    expect(m.withText("button", "Add to Shade")).not.toBeNull();
    expect(m.withText("button", "Edit")).not.toBeNull();
  });

  it("tells a reader there is no one to talk with when there is no profile, and drafts nothing", async () => {
    const { m, calls } = await open("reader", null);
    expect(m.host.textContent).toContain("Shade has no profile yet");
    expect(m.withText("button", "Draft a profile")).toBeNull();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("offers a writer to draft the profile", async () => {
    const { m } = await open("writer", null);
    expect(m.withText("button", "Draft a profile")).not.toBeNull();
  });
});
