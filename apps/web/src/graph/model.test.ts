import { describe, expect, it } from "vitest";
import type { GraphResponse } from "@frontier/schema";
import {
  describeNode,
  emptyReason,
  filterGraph,
  makeModel,
  neighbourhood,
  shownLinks,
  tickedFolders,
} from "./model.ts";

const PATHS = [
  "01 Places/Harbor/Harbor.md", // 0
  "01 Places/Harbor/Old Quay.md", // 1
  "02 People/Mira.md", // 2
  "02 People/Shade.md", // 3
  "03 Things/Lantern.md", // 4
  "03 Things/README.md", // 5
  "99 Appendices/Logs/Session.md", // 6
  "AGENTS.md", // 7
  "README.md", // 8
  "Welcome.md", // 9
  "01 Places/Marsh/The Marsh.md", // 10
];

const response: GraphResponse = {
  nodes: PATHS.map((path) => ({
    path,
    title: path.split("/").pop()!.replace(/\.md$/, ""),
    type: null,
  })),
  edges: [
    [1, 0],
    [0, 1],
    [2, 0],
    [2, 1],
    [3, 2],
    [4, 0],
    [6, 0],
    [6, 1],
    [10, 0],
    [8, 2],
  ],
  folders: [
    { path: "01 Places", color: "sea" },
    { path: "02 People", color: "ember" },
    { path: "03 Things", color: null },
    { path: "99 Appendices", color: null },
  ],
  nested: [],
};

const model = makeModel(response);
const pathsOf = (nodes: number[]) => nodes.map((i) => PATHS[i]);
const defaults = () => filterGraph(model, tickedFolders(model, new Map()));

describe("the model", () => {
  it("knows each node's folder, top-level folder and links", () => {
    const quay = model.nodes[1]!;
    expect(quay.folder).toBe("01 Places/Harbor");
    expect(quay.top).toBe("01 Places");
    expect(quay.out).toEqual([0]);
    expect(quay.in).toEqual([0, 2, 6]);
    expect(model.nodes[8]).toMatchObject({ folder: "", top: null });
    expect(model.byPath.get("02 People/Mira.md")).toBe(2);
  });
});

describe("the filters", () => {
  it("hide the appendices, and README.md and AGENTS.md at the top level only, by default", () => {
    const shown = defaults();
    expect(pathsOf(shown.nodes)).toEqual(
      PATHS.filter(
        (p) => !p.startsWith("99 Appendices/") && p !== "README.md" && p !== "AGENTS.md",
      ),
    );
    // A README in a folder stays; so does another note at the top level.
    expect(shown.has[5]).toBe(true);
    expect(shown.has[9]).toBe(true);
    // README's link to Mira and Session's links go with them.
    expect(shown.edges).not.toContainEqual([8, 2]);
    expect(shown.edges).not.toContainEqual([6, 0]);
    // Harbor's neighbours: Old Quay (both ways, counted once), Mira, Lantern and The Marsh.
    expect(shown.degree[0]).toBe(4);
  });

  it("remove an unticked folder's nodes with their edges, and show a ticked appendix", () => {
    const choices = new Map([
      ["03 Things", false],
      ["99 Appendices", true],
      ["Gone", true],
    ]);
    const shown = filterGraph(model, tickedFolders(model, choices));
    expect(shown.has[4]).toBe(false);
    expect(shown.edges).not.toContainEqual([4, 0]);
    expect(shown.has[6]).toBe(true);
    expect(shown.edges).toContainEqual([6, 1]);
    expect(shownLinks(model, shown, 0)).toEqual({ out: 1, in: 4 });
  });

  it("say why nothing is shown", () => {
    expect(emptyReason(model, defaults())).toBeNull();
    const none = filterGraph(model, new Set());
    // Welcome.md is at the top level, so unticking every folder still shows it.
    expect(pathsOf(none.nodes)).toEqual(["Welcome.md"]);
    const bare = makeModel({ ...response, nodes: response.nodes.slice(0, 7), edges: [] });
    const unticked = filterGraph(bare, new Set());
    expect(unticked.nodes).toEqual([]);
    expect(emptyReason(bare, unticked)).toBe("unticked");
    const empty = makeModel({ nodes: [], edges: [], folders: [], nested: [] });
    expect(emptyReason(empty, filterGraph(empty, new Set()))).toBe("empty");
  });

  it("announce a node with its shown links", () => {
    const shown = defaults();
    expect(describeNode(model, shown, 1)).toBe("Old Quay, 01 Places/Harbor, 1 link out, 2 in");
    expect(describeNode(model, shown, 9)).toBe("Welcome, top level, 0 links out, 0 in");
    const gull = makeModel({
      ...response,
      nodes: [{ path: "Gull.md", title: "Gull", type: null, unpublished: true }],
      edges: [],
    });
    expect(describeNode(gull, filterGraph(gull, new Set()), 0)).toBe(
      "Gull, top level, 0 links out, 0 in, unpublished",
    );
  });
});

describe("the local graph", () => {
  it("is the centre and its neighbours either way at depth 1, with the edges among them", () => {
    const local = neighbourhood(model, "02 People/Mira.md", 1)!;
    // README.md links to Mira but is hidden at the top level.
    expect(pathsOf(local.nodes).sort()).toEqual(
      [
        "01 Places/Harbor/Harbor.md",
        "01 Places/Harbor/Old Quay.md",
        "02 People/Mira.md",
        "02 People/Shade.md",
      ].sort(),
    );
    // Harbor and Old Quay link to each other; those edges are kept.
    expect(local.edges).toContainEqual([1, 0]);
    expect(local.edges).toContainEqual([0, 1]);
  });

  it("reaches two links away at depth 2, without the appendices", () => {
    const local = neighbourhood(model, "02 People/Mira.md", 2)!;
    expect(local.has[4]).toBe(true);
    expect(local.has[10]).toBe(true);
    expect(local.has[6]).toBe(false);
    expect(local.has[9]).toBe(false);
  });

  it("always keeps the centre, even where the screen hides it", () => {
    const local = neighbourhood(model, "99 Appendices/Logs/Session.md", 1)!;
    expect(pathsOf(local.nodes).sort()).toEqual(
      [
        "01 Places/Harbor/Harbor.md",
        "01 Places/Harbor/Old Quay.md",
        "99 Appendices/Logs/Session.md",
      ].sort(),
    );
    expect(neighbourhood(model, "README.md", 1)!.has[8]).toBe(true);
    expect(neighbourhood(model, "Nowhere.md", 1)).toBeNull();
  });
});
