// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_KINDS, type RelationsResponse } from "@frontier/schema";
import { type Mounted, mount, projectInfo } from "../../testing/mount.ts";
import { makeGraph } from "../../trees/model.ts";

const P = "People/Wren.md";
const response: RelationsResponse = {
  kinds: BUILT_IN_KINDS,
  people: [{ key: P, title: "Wren", path: P, type: "person", born: null, died: null, dates: null }],
  facts: [],
  unknown: [],
};
const graph = makeGraph(response);

vi.mock("../../trees/data.ts", async (original) => ({
  ...(await original<typeof import("../../trees/data.ts")>()),
  useTrees: () => ({ state: "ready", value: { trees: [], fine: [], kinds: [] }, client: {} }),
  useRelations: () => ({
    state: "ready",
    graph,
    response,
    error: null,
    reload: async () => undefined,
  }),
}));
vi.mock("../Shell.tsx", () => ({ usePhone: () => false, useRefresh: () => () => undefined }));

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

const TEXT = '---\nrelations:\n  - what: parent\n    who: "[[Corin]]"\n---\n# Wren\n';

async function tab(role: "owner" | "writer" | "reader" | null, editable = true) {
  const { RelationsPanel } = await import("./RelationsPanel.tsx");
  mounted = await mount(
    createElement(RelationsPanel, { path: P, text: TEXT, editable, onChanged: () => undefined }),
    projectInfo({ role }),
  );
  await mounted.settle();
  return mounted;
}

describe("an entry's Relations tab", () => {
  it("lets a writer and an owner add a relation and take one off", async () => {
    for (const role of ["writer", "owner"] as const) {
      const m = await tab(role);
      expect(m.host.querySelector(".tr-add-row")).not.toBeNull();
      expect(m.host.querySelector('button[aria-label^="Remove"]')).not.toBeNull();
      await m.unmount();
      mounted = null;
    }
  });

  it("shows a reader what is written and nothing that writes it", async () => {
    for (const role of ["reader", null] as const) {
      const m = await tab(role);
      expect(m.host.textContent).toContain("As written in this entry");
      expect(m.host.textContent).toContain("parent");
      expect(m.host.querySelector(".tr-add-row")).toBeNull();
      expect(m.host.querySelector('button[aria-label^="Remove"]')).toBeNull();
      expect(m.host.querySelector(".is-add")).toBeNull();
      // Nothing to make a tree with either.
      expect(m.host.textContent).not.toContain("Make a tree");
      await m.unmount();
      mounted = null;
    }
  });

  it("is read-only for a writer when the entry itself cannot be edited", async () => {
    const m = await tab("writer", false);
    expect(m.host.querySelector(".tr-add-row")).toBeNull();
  });
});
