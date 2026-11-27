// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DialogProvider } from "../components/Dialogs.tsx";
import { setKeysOwner } from "../aiKeys.ts";
import { setCurrentProject } from "../project.ts";
import { ALPHA, signInWithProjects } from "../testing/switchProject.ts";
import { UnpublishedPage } from "./Unpublished.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const MAP = ".frontier/maps/abcd1234.json";
const draft = (id: string, path: string, kind: "edit" | "create" | "delete", binary = false) => ({
  id,
  path,
  kind,
  binary,
  text: binary ? "" : "text",
  mainText: kind === "create" ? null : "was",
  origins: [],
});

const unpublished = {
  drafts: [
    draft("del1", "01 Places/Old.md", "delete"),
    draft("img1", "05 Images/pic.png", "create", true),
    draft("map1", MAP, "edit"),
    draft("txt1", "01 Places/Harbor.md", "edit"),
  ],
  renames: [{ id: "ren1", from: "a/Old.md", to: "a/New.md", affected: [] }],
  decisions: [{ id: "dec1", path: "02 People/Mira.md", decision: "accepted" }],
};
const plan = {
  planId: "plan1",
  mainCommit: "abc",
  ready: ["del1", "img1", "map1", "txt1"],
  merges: [],
  conflicts: [],
  renames: unpublished.renames,
  groups: [],
  decisions: unpublished.decisions,
};
const clash = (draftId: string, path: string, reason: string) => ({
  draftId,
  path,
  reason,
  mine: "mine",
  theirs: "theirs",
  base: "base",
  theirsBy: { id: "p1", name: "Wren" },
  theirsAt: "2026-11-27T14:02:00.000Z",
});

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await signInWithProjects();
  setCurrentProject(ALPHA);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
afterAll(() => {
  setKeysOwner(null);
  setCurrentProject(null);
});

async function saveWith(conflicts: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/unpublished")) return json(unpublished);
      if (url.endsWith("/publish/plan")) return json(plan);
      if (url.endsWith("/publish/confirm")) {
        // The server's `published` lists only entry texts: here, none of the four were new text.
        return json({ commit: "0123456789abcdef", published: [], conflicts });
      }
      return json({});
    }),
  );
  await act(async () =>
    root.render(
      createElement(
        DialogProvider,
        null,
        createElement(
          MemoryRouter,
          { initialEntries: ["/p/alpha/unpublished"] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: "/p/:project/unpublished",
              element: createElement(UnpublishedPage),
            }),
          ),
        ),
      ),
    ),
  );
  const press = (label: RegExp) =>
    act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => label.test(b.textContent ?? ""))!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
  await vi.waitFor(() => expect(host.textContent).toContain("Review 6 changes"));
  await press(/^Review 6 changes/);
  await vi.waitFor(() => expect(host.querySelector(".plan")).not.toBeNull());
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(".field input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Save");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await press(/^(Publish|Saving|Save a version)$/);
  return host.querySelector("[aria-label='Entries to compare']");
}

describe("the banner of a save that held some entries back", () => {
  it("counts what was written and deleted, whatever it is, minus what was left", async () => {
    const banner = (await saveWith([clash("txt1", "01 Places/Harbor.md", "saved_by_other")]))!;
    const text = banner.textContent!;
    // Deleted, image, map, rename and review decision all went in: five, not "Nothing".
    expect(text).toMatch(/5 changes (saved|published)/);
    expect(text).not.toMatch(/^Nothing/);
    expect(text).toContain("Old");
    expect(text).toContain("pic.png");
    expect(text).toContain("1 entry needs comparing, because someone saved a newer version first");
    // A text clash goes to the text compare.
    expect(banner.querySelector("a[href$='/conflict/txt1']")).not.toBeNull();
  });

  it("gives a map clash its own choices, not the text compare and not 'a newer version first'", async () => {
    const banner = (await saveWith([clash("map1", MAP, "map_changed_on_both")]))!;
    const text = banner.textContent!;
    expect(text).not.toContain("someone saved a newer version first");
    expect(text).toContain("changed here and in the vault in the same places");
    expect(banner.querySelector("a[href*='/conflict/']")).toBeNull();
    const buttons = [...banner.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toEqual(["Keep my map", "Take the vault's"]);
  });
});
