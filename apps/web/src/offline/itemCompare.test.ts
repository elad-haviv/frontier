import { describe, expect, it } from "vitest";
import { type FolderFile, type MapFile, serialiseFolders, serialiseMap } from "@frontier/schema";
import { compareItems, differingFields, nowLabel, shown } from "./itemCompare.ts";

const marker = (id: string, label: string, at: [number, number]) => ({
  id,
  kind: "marker" as const,
  layer: "l1",
  at,
  entry: null,
  label,
  icon: null,
  child: null,
});
const map = (features: MapFile["features"], title = "Coast"): MapFile => ({
  version: 1,
  id: "coast001",
  title,
  space: { kind: "flat", width: 100, height: 100, scale: null, unit: "km" },
  images: [],
  markerSets: [],
  layers: [{ id: "l1", name: "Places", visible: true, color: "#9a3b1f" }],
  features,
});
const MAP = ".frontier/maps/coast001.json";

describe("comparing the items of a clash", () => {
  it("shows a feature moved on one side and renamed on the other", () => {
    const now = serialiseMap(map([marker("f1", "Lighthouse", [40, 50])]));
    const other = serialiseMap(map([marker("f1", "Old Light", [10, 20])]));
    expect(compareItems(MAP, now, other, ["f1"])).toEqual([
      {
        key: "f1",
        name: "Lighthouse",
        state: "changed",
        rows: [
          { field: "Name", now: "Lighthouse", other: "Old Light" },
          { field: "Place", now: "moved", other: "another place", moved: true },
        ],
      },
    ]);
    expect(nowLabel(MAP)).toBe("This map now");
  });

  it("says when the other side removed an item, or this side did, and names a title clash", () => {
    const now = serialiseMap(map([marker("f1", "Lighthouse", [1, 1])], "Coast"));
    const other = serialiseMap(map([marker("f2", "Wreck", [2, 2])], "The coast"));
    expect(compareItems(MAP, now, other, ["f1", "f2", "title"])).toEqual([
      { key: "f1", name: "Lighthouse", state: "removed-other", rows: [] },
      { key: "f2", name: "Wreck", state: "removed-now", rows: [] },
      {
        key: "title",
        name: "Title",
        state: "changed",
        rows: [{ field: "Title", now: "Coast", other: "The coast" }],
      },
    ]);
  });

  it("compares a folder line by its path, and a style removed on the other side", () => {
    const folders = (lines: FolderFile["folders"]) =>
      serialiseFolders({ version: 1, folders: lines });
    const now = folders([{ path: "02 People", color: "ember", icon: "user" }, { path: "B" }]);
    const other = folders([{ path: "02 People", color: "sea", icon: "user" }]);
    expect(compareItems(".frontier/folders.json", now, other, ["02 People", "B"])).toEqual([
      {
        key: "02 People",
        name: "02 People",
        state: "changed",
        rows: [{ field: "Colour", now: "ember", other: "sea" }],
      },
      { key: "B", name: "B", state: "removed-other", rows: [] },
    ]);
    expect(nowLabel(".frontier/folders.json")).toBe("This file now");
  });

  it("is null for a note, or a text that cannot be read", () => {
    expect(compareItems("02 People/Mira.md", "a", "b", ["x"])).toBeNull();
    expect(compareItems(MAP, "not json", "{}", ["x"])).toBeNull();
  });

  it("puts values in words", () => {
    expect(shown(null)).toBe("none");
    expect(shown(true)).toBe("yes");
    expect(shown(3)).toBe("3");
    expect(shown({ set: "pins", name: "anchor" })).toBe("anchor");
    expect(shown(["a".repeat(100)])).toHaveLength(78);
    expect(differingFields("a", "b")).toEqual([{ field: "Value", now: "a", other: "b" }]);
    expect(differingFields("a", "a")).toEqual([]);
  });
});
