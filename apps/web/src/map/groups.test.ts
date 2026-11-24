import type { ChronicleFile, ChronicleSpan, MapFeature, MapFile } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { autoAnchor, clearOfMarkers, darker, nameFits, polylabel, ringArea } from "./groupLabel.ts";
import {
  addToGroup,
  deleteItems,
  groupNamesOf,
  groupOf,
  groupReason,
  hiddenMembers,
  lockedMembers,
  makeGroup,
  membersOf,
  moveGroupTo,
  pickOf,
  takeOut,
  ungroup,
  withFeature,
} from "./groups.ts";
import { applyDrop, dropFor, layerRows, removeLayer, type Row } from "./layerRows.ts";
import { readTime, resolve, withGroup } from "./time.ts";

const zone = (id: string, x: number, extra: Record<string, unknown> = {}): MapFeature =>
  ({
    id,
    kind: "zone",
    layer: "realms",
    points: [
      [x, 0],
      [x + 10, 0],
      [x + 10, 10],
      [x, 10],
    ],
    entry: null,
    label: id,
    child: null,
    ...extra,
  }) as MapFeature;
const marker = (id: string, layer = "places"): MapFeature => ({
  id,
  kind: "marker",
  layer,
  at: [5, 5],
  entry: null,
  label: id,
  icon: null,
  child: null,
});

const plain: MapFile = {
  version: 1,
  id: "m0000000",
  title: "Isles",
  space: { kind: "flat", width: 100, height: 100, scale: null, unit: "km" },
  images: [],
  markerSets: [],
  layers: [
    { id: "realms", name: "Realms", visible: true, color: "#8a5a9e" },
    { id: "places", name: "Places", visible: true, color: "#2f5d8a" },
  ],
  features: [zone("calder", 0), zone("skerra", 20), zone("wyn", 40), marker("port")],
};
const grouped = makeGroup(plain, ["calder", "skerra", "wyn"], "aldmere")!.map;
const named = { ...grouped, groups: [{ ...grouped.groups![0]!, label: "Aldmere" }] };

describe("making and unmaking groups", () => {
  it("groups two or more into the layer of the first, and says when it cannot", () => {
    expect(groupReason(plain, ["calder"])).toMatch(/two or more/);
    expect(makeGroup(plain, ["calder"], "g")).toBeNull();
    const made = makeGroup(plain, ["calder", "port"], "g")!;
    expect(made.group).toBe("g");
    expect(made.moved).toEqual(["port"]);
    expect(made.map.features.find((f) => f.id === "port")).toMatchObject({
      layer: "realms",
      group: "g",
    });
    expect(made.map.groups).toEqual([{ id: "g", layer: "realms", label: null, entry: null }]);
  });

  it("adds the rest to a group among the picked, and merges two groups into the first", () => {
    const added = makeGroup(named, ["aldmere", "port"], "new")!;
    expect(added.group).toBe("aldmere");
    expect(membersOf(added.map, "aldmere").map((f) => f.id)).toEqual([
      "calder",
      "skerra",
      "wyn",
      "port",
    ]);
    const two = makeGroup(plain, ["calder", "skerra"], "a")!.map;
    const both = makeGroup(
      { ...two, features: [...two.features, zone("isle", 60)] },
      ["wyn", "isle"],
      "b",
    )!.map;
    const merged = makeGroup(both, ["a", "b"], "c")!;
    expect(merged.group).toBe("a");
    expect(merged.map.groups!.map((g) => g.id)).toEqual(["a"]);
    expect(membersOf(merged.map, "a")).toHaveLength(4);
    expect(groupReason(two, ["a"])).not.toBeNull();
  });

  it("ungroups, leaving the members where they are", () => {
    const out = ungroup(named, "aldmere");
    expect(out.groups).toBeUndefined();
    expect(out.features.map((f) => f.layer)).toEqual(plain.features.map((f) => f.layer));
    expect(out.features.every((f) => f.group == null)).toBe(true);
  });

  it("dissolves a group left with one member", () => {
    const two = takeOut(named, ["wyn"]);
    expect(membersOf(two, "aldmere")).toHaveLength(2);
    const one = takeOut(two, ["skerra"]);
    expect(one.groups).toBeUndefined();
    expect(groupOf(one, "calder")).toBeNull();
    expect(deleteItems(two, ["skerra"]).groups).toBeUndefined();
  });

  it("deletes a group with all its members", () => {
    const gone = deleteItems(named, ["aldmere"]);
    expect(gone.features.map((f) => f.id)).toEqual(["port"]);
    expect(gone.groups).toBeUndefined();
  });

  it("takes a member out when it moves to another layer, and moves a group whole", () => {
    const calder = named.features[0]!;
    const moved = withFeature(named, { ...calder, layer: "places" });
    expect(groupOf(moved, "calder")).toBeNull();
    expect(membersOf(moved, "aldmere")).toHaveLength(2);
    const whole = moveGroupTo(named, "aldmere", "places");
    expect(whole.groups![0]!.layer).toBe("places");
    expect(membersOf(whole, "aldmere").every((f) => f.layer === "places")).toBe(true);
    expect(addToGroup(named, ["port"], "aldmere").features[3]).toMatchObject({
      layer: "realms",
      group: "aldmere",
    });
  });
});

describe("what a click picks", () => {
  it("picks the group, then stays inside once a member is selected", () => {
    expect(pickOf(named, "skerra", null)).toBe("aldmere");
    expect(pickOf(named, "skerra", "aldmere")).toBe("aldmere");
    // Gone inside (a double-click, Enter or a second tap): a member, and the others from there.
    expect(pickOf(named, "skerra", "aldmere", true)).toBe("skerra");
    expect(pickOf(named, "wyn", "skerra")).toBe("wyn");
    expect(pickOf(named, "port", "skerra")).toBe("port");
    expect(pickOf(named, null, "skerra")).toBeNull();
  });

  it("hides and locks a group's members with it", () => {
    expect(hiddenMembers(named, new Set(["aldmere"]))).toEqual(["calder", "skerra", "wyn"]);
    const locked = { ...named, groups: [{ ...named.groups![0]!, locked: true }] };
    expect([...lockedMembers(locked)]).toEqual(["calder", "skerra", "wyn"]);
  });
});

describe("the group's name on the map", () => {
  const opts = {
    entryTitle: () => undefined,
    styles: [],
    hidden: new Set<string>(),
    selected: null,
  };
  it("is written in capitals, in a darker shade of its zones' colour", () => {
    const [name] = groupNamesOf(named, opts);
    expect(name).toMatchObject({ words: "ALDMERE", colour: darker("#8a5a9e"), ring: false });
    expect(darker("#8a5a9e")).toBe("#4c3257");
  });

  it("is not written without a name or entry, when turned off, or when all are hidden", () => {
    expect(groupNamesOf(grouped, opts)).toEqual([]);
    const off = { ...named, groups: [{ ...named.groups![0]!, write: false as const }] };
    expect(groupNamesOf(off, opts)).toEqual([]);
    const hidden = new Set(["calder", "skerra", "wyn"]);
    expect(groupNamesOf(named, { ...opts, hidden })).toEqual([]);
    const linked = { ...grouped, groups: [{ ...grouped.groups![0]!, entry: "e1" }] };
    expect(groupNamesOf(linked, { ...opts, entryTitle: () => "Aldmere" })[0]!.words).toBe(
      "ALDMERE",
    );
  });

  it("goes in the visual centre of the largest piece, or across an archipelago", () => {
    const square: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const [x, y] = polylabel(square);
    expect(Math.abs(x - 50)).toBeLessThan(2);
    expect(Math.abs(y - 50)).toBeLessThan(2);
    expect(ringArea(square)).toBe(10000);
    const small = square.map(([a, b]): [number, number] => [a / 10 + 300, b / 10]);
    // One large island and a small one: in the large one.
    expect(autoAnchor([square, small], [])!.at[0]).toBeLessThan(100);
    // Like islands, none with 40% of the whole: the middle of all of them, across the sea.
    const like = square.map(([a, b]): [number, number] => [a + 300, b]);
    const third = square.map(([a, b]): [number, number] => [a + 600, b]);
    expect(autoAnchor([square, like, third], [])!.at).toEqual([350, 50]);
    // No zones (a road in stretches): above the middle of its box.
    expect(
      autoAnchor(
        [],
        [
          [0, 0],
          [10, 20],
        ],
      ),
    ).toEqual({ at: [5, 10], above: true });
    expect(autoAnchor([], [])).toBeNull();
  });

  it("keeps clear of markers, and is dropped when the group is too small on screen", () => {
    const half = { w: 30, h: 8 };
    expect(clearOfMarkers([100, 100], half, [])).toEqual([100, 100]);
    expect(clearOfMarkers([100, 100], half, [[100, 100]])).toEqual([100, 120]);
    expect(nameFits(60, 100)).toBe(true);
    expect(nameFits(59, 100)).toBe(false);
  });
});

describe("groups in the Layers tree", () => {
  const rows = (map: MapFile, collapsed: string[] = []) =>
    layerRows(map, { collapsed: new Set(collapsed), showAll: new Set() });
  const keys = (r: Row[]) => r.map((x) => `${x.key}@${x.depth}`);

  it("lists a group as a folder at its first member, with its members under it", () => {
    expect(keys(rows(named))).toEqual([
      "l:realms@0",
      "g:aldmere@1",
      "f:calder@2",
      "f:skerra@2",
      "f:wyn@2",
      "l:places@0",
      "f:port@1",
    ]);
    expect(keys(rows(named, ["aldmere"]))).toEqual([
      "l:realms@0",
      "g:aldmere@1",
      "l:places@0",
      "f:port@1",
    ]);
  });

  it("adds a feature dropped on a group, and takes one out dropped on a layer", () => {
    const list = rows(named);
    const groupRow = list.find((r) => r.type === "group")!;
    const into = dropFor(named, { kind: "features", ids: ["port"] }, groupRow, 0.5)!;
    expect(into).toMatchObject({ kind: "features", layer: "realms", group: "aldmere" });
    const added = applyDrop(named, into);
    expect(membersOf(added, "aldmere").map((f) => f.id)).toContain("port");
    const layerRow = list.find((r) => r.key === "l:places")!;
    const out = applyDrop(
      named,
      dropFor(named, { kind: "features", ids: ["wyn"] }, layerRow, 0.5)!,
    );
    expect(out.features.find((f) => f.id === "wyn")).toMatchObject({ layer: "places" });
    expect(groupOf(out, "wyn")).toBeNull();
  });

  it("moves a dragged group to another layer, members and all", () => {
    const list = rows(named);
    const layerRow = list.find((r) => r.key === "l:places")!;
    const drop = dropFor(named, { kind: "group", id: "aldmere" }, layerRow, 0.5)!;
    expect(drop).toEqual({ kind: "group", id: "aldmere", layer: "places", show: "into" });
    expect(membersOf(applyDrop(named, drop), "aldmere").every((f) => f.layer === "places")).toBe(
      true,
    );
    const own = list.find((r) => r.key === "l:realms")!;
    expect(dropFor(named, { kind: "group", id: "aldmere" }, own, 0.5)).toBeNull();
  });

  it("takes a deleted layer's groups with its features", () => {
    expect(removeLayer(named, "realms", "places").groups![0]!.layer).toBe("places");
    expect(removeLayer(named, "realms", null).groups).toBeUndefined();
  });
});

describe("a group in time", () => {
  const span = (id: string, start: number, end?: number): ChronicleSpan =>
    ({
      id,
      lane: "l1",
      name: id,
      point: false,
      start: { words: "", low: start, high: start },
      end: end === undefined ? null : { words: "", low: end, high: end },
      length: null,
      entry: null,
      note: "",
    }) as ChronicleSpan;
  const time = readTime({
    spans: [span("realm", 100, 200), span("isle", 0)],
  } as unknown as ChronicleFile);
  const map = {
    ...named,
    groups: [{ ...named.groups![0]!, span: "realm" }],
    features: named.features.map((f) => (f.id === "wyn" ? { ...f, span: "isle" } : f)),
  };
  const shownAt = (year: number) =>
    resolve(map, time, year, { selected: null, pin: null, editing: false, showAll: false }).map(
      (r) => r.feature.id,
    );

  it("shows a member only while both it and its group exist", () => {
    expect(shownAt(50)).toEqual(["port"]);
    expect(shownAt(150)).toEqual(["calder", "skerra", "wyn", "port"]);
    expect(shownAt(250)).toEqual(["port"]);
  });

  it("combines the two presences", () => {
    expect(withGroup("there", "gone")).toBe("gone");
    expect(withGroup("not_yet", "there")).toBe("not_yet");
    expect(withGroup("there", "perhaps")).toBe("perhaps");
    expect(withGroup("timeless", undefined)).toBe("timeless");
  });
});
