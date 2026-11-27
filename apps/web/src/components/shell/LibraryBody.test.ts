// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TreeResponse } from "@frontier/schema";
import { type Mounted, mount, projectInfo } from "../../testing/mount.ts";
import { LibraryBody, LibraryTools } from "./LibraryBody.tsx";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

const EMPTY = { state: "ready", value: { folders: [], notes: [] } as unknown as TreeResponse };
const SOME = {
  state: "ready",
  value: {
    folders: [],
    notes: [{ path: "A.md", title: "A", state: "published" }],
  } as unknown as TreeResponse,
};

const tools = (tree: typeof EMPTY) =>
  createElement(LibraryTools, {
    tree: tree as never,
    onNewEntryIn: () => undefined,
    onNewFolder: () => undefined,
    tipSide: "bottom",
  });

describe("the library's top bar (the pane on a desktop, the panel on a phone)", () => {
  it("has New entry and New folder for a writer and an owner", async () => {
    for (const role of ["writer", "owner"] as const) {
      mounted = await mount(tools(SOME), projectInfo({ role }));
      expect(mounted.host.querySelector(".left-new-entry")).not.toBeNull();
      expect(mounted.host.querySelector(".left-new-folder")).not.toBeNull();
      await mounted.unmount();
      mounted = null;
    }
  });

  it("has neither for a reader, nor while the role is not known", async () => {
    for (const role of ["reader", null] as const) {
      mounted = await mount(tools(SOME), projectInfo({ role }));
      expect(mounted.host.querySelector(".left-new-entry")).toBeNull();
      expect(mounted.host.querySelector(".left-new-folder")).toBeNull();
      await mounted.unmount();
      mounted = null;
    }
  });
});

describe("an empty library", () => {
  const body = () =>
    createElement(LibraryBody, {
      tree: EMPTY as never,
      current: "",
      active: true,
      asked: 0,
      onRetry: vi.fn(),
      onNewEntryIn: vi.fn(),
    });

  it("offers a writer a New entry button", async () => {
    mounted = await mount(body(), projectInfo({ role: "writer" }));
    expect(mounted.host.textContent).toContain("No entries yet.");
    expect(mounted.host.querySelector("button.new-entry")).not.toBeNull();
  });

  it("only says so to a reader", async () => {
    mounted = await mount(body(), projectInfo({ role: "reader" }));
    expect(mounted.host.textContent).toContain("No entries yet.");
    expect(mounted.host.querySelector("button.new-entry")).toBeNull();
  });
});
