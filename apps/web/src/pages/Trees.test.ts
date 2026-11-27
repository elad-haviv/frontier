// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_KINDS, type RelationsResponse, type TreeLine } from "@frontier/schema";
import { type Mounted, mount, projectInfo } from "../testing/mount.ts";
import { makeGraph } from "../trees/model.ts";

// What the page reads: one saved tree, and the library's relations, set by each test.
const held = vi.hoisted(() => ({ trees: [] as unknown[], change: vi.fn() }));
vi.mock("../trees/data.ts", async (original) => {
  const real = await original<typeof import("../trees/data.ts")>();
  return {
    ...real,
    useTrees: () => ({
      state: "ready",
      value: { trees: held.trees, fine: [], kinds: [] },
      error: null,
      client: { change: held.change },
    }),
    useRelations: () => ({
      state: "ready",
      graph,
      response: null,
      error: null,
      reload: async () => undefined,
    }),
  };
});
vi.mock("../components/Shell.tsx", () => ({ usePhone: () => false }));

const response: RelationsResponse = { kinds: BUILT_IN_KINDS, people: [], facts: [], unknown: [] };
const graph = makeGraph(response);

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  held.trees = [];
  held.change.mockReset();
});

const TREE: TreeLine = {
  id: "abcd1234",
  name: "House Vane",
  kind: "parent",
  look: "family",
  start: "People/Aldric.md",
  dir: "down",
};

async function page(role: "owner" | "writer" | "reader" | null) {
  const { TreesPage } = await import("./Trees.tsx");
  mounted = await mount(createElement(TreesPage), projectInfo({ role }));
  await mounted.settle();
  return mounted;
}

const buttons = (m: Mounted) => [...m.host.querySelectorAll("button")].map((b) => b.textContent);

describe("the Trees page", () => {
  it("offers a writer and an owner to make a tree, with none and with some", async () => {
    for (const role of ["writer", "owner"] as const) {
      held.trees = [];
      let m = await page(role);
      expect(buttons(m).some((t) => t?.includes("New tree"))).toBe(true);
      await m.unmount();
      mounted = null;
      held.trees = [TREE];
      m = await page(role);
      expect(m.host.textContent).toContain("House Vane");
      expect(buttons(m).some((t) => t?.includes("New tree"))).toBe(true);
      await m.unmount();
      mounted = null;
    }
  });

  it("lets a reader look at the trees and make none", async () => {
    held.trees = [TREE];
    let m = await page("reader");
    expect(m.host.textContent).toContain("House Vane");
    expect(m.host.querySelector("a.tr-card-link")).not.toBeNull();
    expect(buttons(m).filter((t) => t?.includes("New tree"))).toEqual([]);
    expect(m.host.querySelector(".tr-fab")).toBeNull();
    await m.unmount();
    mounted = null;

    held.trees = [];
    m = await page("reader");
    expect(m.host.textContent).toContain("No trees yet");
    expect(m.host.textContent).toContain("A writer or an owner of the project can make one");
    expect(buttons(m).filter((t) => t?.includes("New tree"))).toEqual([]);
    expect(held.change).not.toHaveBeenCalled();
  });
});
