import { describe, expect, it } from "vitest";
import { FOLDER_COLORS } from "@frontier/schema";
import { colourNameOf, folderColour, nodeColours } from "./colours.ts";
import { makeModel } from "./model.ts";

const model = makeModel({
  nodes: [
    "01 Places/Harbor/Harbor.md",
    "01 Places/Harbor/Docks/Pier.md",
    "01 Places/Marsh/The Marsh.md",
    "01 Places/Harborside/Inn.md",
    "02 People/Mira.md",
    "03 Things/Lantern.md",
    "README.md",
  ].map((path) => ({ path, title: path, type: null })),
  edges: [],
  folders: [
    { path: "01 Places", color: "sea" },
    { path: "02 People", color: "ember" },
    { path: "03 Things", color: null },
  ],
  nested: [
    { path: "01 Places/Harbor", color: "teal" },
    { path: "01 Places/Harbor/Docks", color: "gold" },
  ],
});

describe("node colours", () => {
  it("take the nearest folder's own colour, then the top-level folder's", () => {
    const names = model.nodes.map((n) => colourNameOf(model, n));
    expect(names).toEqual([
      "teal",
      // The deeper folder wins over the one above it.
      "gold",
      "sea",
      // "Harborside" is not inside "Harbor".
      "sea",
      "ember",
      null,
      null,
    ]);
  });

  it("use the light or the dark value, and null for the neutral colour", () => {
    expect(nodeColours(model, "light").slice(4)).toEqual([FOLDER_COLORS.ember.light, null, null]);
    expect(nodeColours(model, "dark")[0]).toBe(FOLDER_COLORS.teal.dark);
    expect(folderColour("moss", "dark")).toBe("#9cc47f");
    expect(folderColour(null, "light")).toBeNull();
  });

  it("are neutral for a folder the answer does not list", () => {
    const lone = makeModel({
      nodes: [{ path: "05 New/A.md", title: "A", type: null }],
      edges: [],
      folders: [],
      nested: [],
    });
    expect(colourNameOf(lone, lone.nodes[0]!)).toBeNull();
  });
});
