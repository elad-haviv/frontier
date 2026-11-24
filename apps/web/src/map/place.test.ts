import type { View } from "@frontier/geo";
import type { MapFeature, MapFile, MapStyle } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { folderFor, newEntryText } from "./featureEntry.ts";
import {
  choiceName,
  choicesFor,
  ghostMarker,
  middleOf,
  placeSpots,
  withProposal,
} from "./place.ts";

/** A view whose screen is the map's own units. */
const view = {
  project: (p: [number, number]) => p,
  unproject: (x: number, y: number) => [x, y],
} as unknown as View;

const base = { layer: "l1", entry: null, label: null, child: null };
const marker = { id: "m", kind: "marker", ...base, at: [5, 5], icon: null } as MapFeature;
const zone = {
  id: "z",
  kind: "zone",
  ...base,
  points: [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ],
} as MapFeature;
const proposal = { name: "Gull Rock", description: "A rock.", choice: null, basis: [] };

describe("where proposals go", () => {
  it("around a spot: the first on it, the rest in a ring", () => {
    const spots = placeSpots(view, [[200, 200]], 3);
    expect(spots).toHaveLength(3);
    expect(spots[0]).toEqual([200, 200]);
    for (const [x, y] of spots.slice(1)) expect(Math.hypot(x - 200, y - 200)).toBeCloseTo(44);
  });

  it("in an area: inside it, apart, and the same each time", () => {
    const area: [number, number][] = [
      [0, 0],
      [200, 0],
      [0, 200],
    ];
    const spots = placeSpots(view, area, 4);
    expect(spots).toHaveLength(4);
    for (const [x, y] of spots) expect(x + y).toBeLessThan(200);
    expect(placeSpots(view, area, 4)).toEqual(spots);
    const [a, b] = spots;
    expect(Math.hypot(a![0] - b![0], a![1] - b![1])).toBeGreaterThan(16);
  });

  it("nowhere when the spot is off the map", () => {
    const off = { ...view, project: () => null } as unknown as View;
    expect(placeSpots(off, [[1, 1]], 2)).toEqual([]);
  });
});

describe("what a proposal makes", () => {
  it("names the feature and gives it the look chosen: an icon or a style", () => {
    expect(withProposal(marker, { ...proposal, choice: "Skyrim/Fort" })).toMatchObject({
      label: "Gull Rock",
      icon: { set: "Skyrim", name: "Fort" },
    });
    expect(withProposal(zone, { ...proposal, choice: "k3v9x2pa" })).toMatchObject({
      label: "Gull Rock",
      style: "k3v9x2pa",
    });
    expect(withProposal(zone, proposal)).not.toHaveProperty("style");
  });

  it("places a proposal as a new named marker", () => {
    const made = ghostMarker({ ...proposal, key: "k", at: [3, 4] }, "l2");
    expect(made).toMatchObject({ kind: "marker", layer: "l2", at: [3, 4], label: "Gull Rock" });
  });

  it("asks about the middle of a shape", () => {
    expect(middleOf(zone)).toEqual([50, 50]);
    expect(middleOf(marker)).toEqual([5, 5]);
  });

  it("offers the styles of a path's or zone's kind, and a marker's icons, by name", () => {
    const map = { markerSets: ["Skyrim"] } as unknown as MapFile;
    const styles = [
      { id: "aaaaaaaa", name: "Kingdom", for: "zone" },
      { id: "bbbbbbbb", name: "Road", for: "path" },
    ] as MapStyle[];
    const sets = [
      { name: "Skyrim", icons: [{ name: "fort-ruin", path: "x" }] },
      { name: "Other", icons: [{ name: "cave", path: "y" }] },
    ];
    expect(choicesFor("zone", map, styles, sets)).toEqual([{ id: "aaaaaaaa", name: "Kingdom" }]);
    const icons = choicesFor("marker", map, styles, sets);
    expect(icons.map((c) => c.id)).toEqual(["Skyrim/fort-ruin"]);
    expect(choicesFor("label", map, styles, sets)).toEqual([]);
    expect(choiceName("aaaaaaaa", choicesFor("zone", map, styles, sets))).toBe("Kingdom");
    expect(choiceName(null, [])).toBeNull();
  });
});

describe("an entry made from the map", () => {
  it("has its title, what it says, and its folder's type", () => {
    expect(newEntryText("03 Places/Gull Rock.md", " A rock. ", null)).toBe(
      "# Gull Rock\n\nA rock.\n",
    );
    expect(newEntryText("03 Places/Gull Rock.md", "", "place")).toBe(
      "---\ntype: place\n---\n# Gull Rock\n\n",
    );
  });

  it("is offered in the folder most entries of its kind on the map are in", () => {
    const linked = (id: string, kind: "marker" | "zone", entry: string) =>
      ({ ...(kind === "zone" ? zone : marker), id, entry }) as MapFeature;
    const map = {
      features: [
        linked("a", "marker", "e1"),
        linked("b", "marker", "e2"),
        linked("c", "marker", "e3"),
        linked("d", "zone", "e4"),
      ],
    } as unknown as MapFile;
    const names = {
      e1: { path: "03 Places/A.md", title: "A" },
      e2: { path: "03 Places/B.md", title: "B" },
      e3: { path: "02 People/C.md", title: "C" },
      e4: { path: "05 Realms/D.md", title: "D" },
    };
    expect(folderFor(map, "marker", names)).toBe("03 Places");
    expect(folderFor(map, "zone", names)).toBe("05 Realms");
    expect(folderFor(map, "label", names)).toBe("03 Places");
    expect(folderFor({ features: [] } as unknown as MapFile, "marker", {})).toBe("");
  });
});
