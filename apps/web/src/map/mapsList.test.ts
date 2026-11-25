// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  above,
  agoText,
  below,
  byKind,
  counts,
  deckDepth,
  defaultView,
  filterAndSort,
  inStack,
  type MapRow,
  matches,
  metaText,
  noteOpened,
  NO_FILTERS,
  recentMaps,
  rowOf,
  stackText,
  toolsFor,
} from "./mapsList.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 25);
const row = (
  id: string,
  title: string,
  kind: MapRow["kind"] = "flat",
  extra: Partial<MapRow> = {},
): MapRow => ({
  id,
  title,
  kind,
  schematic: false,
  features: 3,
  state: "published",
  under: null,
  edited: NOW - 5 * DAY,
  preview: null,
  ...extra,
});
const rows = [
  row("ezob", "Ezob", "sphere"),
  row("lab", "Derdama, layer 1: The Labyrinth", "sphere", { under: "ezob" }),
  row("l2", "Derdama, layer 2", "sphere", { under: "lab" }),
  row("harbor", "Harbor Coast", "flat", { state: "unpublished", edited: NOW - DAY }),
  row("near", "The Near Stars", "stars", { state: "new", edited: NOW }),
  row("solen", "Solen system", "system", { edited: NOW - 30 * DAY }),
];

describe("stacks of globes", () => {
  it("find the maps below and above, nearest first", () => {
    expect(below("ezob", rows).map((r) => r.id)).toEqual(["lab", "l2"]);
    expect(above("l2", rows).map((r) => r.id)).toEqual(["lab", "ezob"]);
    expect(below("harbor", rows)).toEqual([]);
  });
  it("survive a loop in the data", () => {
    const loop = [row("a", "A", "sphere", { under: "b" }), row("b", "B", "sphere", { under: "a" })];
    expect(below("a", loop).map((r) => r.id)).toEqual(["b"]);
    expect(above("a", loop).map((r) => r.id)).toEqual(["b"]);
  });
  it("draw a deck behind a map that has maps under it, up to two sheets, and nothing behind a lone map", () => {
    expect(deckDepth("ezob", rows)).toBe(2);
    expect(deckDepth("lab", rows)).toBe(1);
    expect(deckDepth("l2", rows)).toBe(0);
    expect(deckDepth("harbor", rows)).toBe(0);
    expect(inStack("l2", rows)).toBe(true);
    expect(inStack("harbor", rows)).toBe(false);
  });
  it("say where a map sits", () => {
    expect(stackText(rows[0]!, rows)).toBe("2 layers below");
    expect(stackText(rows[1]!, rows)).toBe("lies under Ezob · 1 layer below");
    expect(stackText(rows[3]!, rows)).toBe("");
  });
});

describe("search", () => {
  it("matches the title, the kind and the world a layer lies under, every word in any order", () => {
    expect(matches(rows[3]!, "harbor", rows)).toBe(true);
    expect(matches(rows[3]!, "coast harbor", rows)).toBe(true);
    expect(matches(rows[4]!, "star map", rows)).toBe(true);
    expect(matches(rows[2]!, "ezob", rows)).toBe(true);
    expect(matches(rows[3]!, "ezob", rows)).toBe(false);
    expect(matches(rows[3]!, "", rows)).toBe(true);
  });
  it("is not case sensitive", () => {
    expect(matches(rows[5]!, "SOLEN", rows)).toBe(true);
  });
});

describe("filtering and sorting", () => {
  it("keeps each map as its own row, layers included", () => {
    expect(filterAndSort(rows, { ...NO_FILTERS, query: "ezob" }, "name").map((r) => r.id)).toEqual([
      "lab",
      "l2",
      "ezob",
    ]);
  });
  it("filters by kind and by needing publishing", () => {
    expect(filterAndSort(rows, { ...NO_FILTERS, kind: "sphere" }, "name")).toHaveLength(3);
    expect(
      filterAndSort(rows, { ...NO_FILTERS, needsPublishing: true }, "name").map((r) => r.id),
    ).toEqual(["harbor", "near"]);
    expect(
      filterAndSort(rows, { ...NO_FILTERS, kind: "stars", needsPublishing: true }, "name").map(
        (r) => r.id,
      ),
    ).toEqual(["near"]);
  });
  it("sorts by recent change, by name and by kind", () => {
    expect(filterAndSort(rows, NO_FILTERS, "recent").map((r) => r.id)).toEqual([
      "near",
      "harbor",
      "lab",
      "l2",
      "ezob",
      "solen",
    ]);
    expect(filterAndSort(rows, NO_FILTERS, "name").map((r) => r.id)[0]).toBe("lab");
    expect(filterAndSort(rows, NO_FILTERS, "kind").map((r) => r.kind)).toEqual([
      "sphere",
      "sphere",
      "sphere",
      "flat",
      "stars",
      "system",
    ]);
  });
  it("puts a map with no edit time last when sorting by recent change", () => {
    const some = [row("a", "A", "flat", { edited: null }), row("b", "B", "flat", { edited: NOW })];
    expect(filterAndSort(some, NO_FILTERS, "recent").map((r) => r.id)).toEqual(["b", "a"]);
  });
  it("counts and groups", () => {
    expect(counts(rows)).toEqual({
      all: 6,
      sphere: 3,
      flat: 1,
      stars: 1,
      system: 1,
      needsPublishing: 2,
    });
    expect(byKind(rows).map((g) => [g.kind, g.rows.length])).toEqual([
      ["sphere", 3],
      ["flat", 1],
      ["stars", 1],
      ["system", 1],
    ]);
  });
});

describe("a library grows into its tools", () => {
  it("shows only cards at first, then search, then filters and recent", () => {
    expect(toolsFor(3, false)).toMatchObject({
      view: false,
      search: false,
      chips: false,
      recent: false,
      newTile: true,
    });
    expect(toolsFor(5, false)).toMatchObject({ view: true, search: false });
    expect(toolsFor(12, false)).toMatchObject({
      search: true,
      chips: false,
      groups: true,
      newTile: false,
    });
    expect(toolsFor(30, false)).toMatchObject({ chips: true, recent: true });
  });
  it("keeps search and filters while one is in use, so it can be undone", () => {
    expect(toolsFor(6, true)).toMatchObject({ search: true, chips: true });
  });
  it("is a grid up to forty maps and a list above", () => {
    expect(defaultView(40)).toBe("grid");
    expect(defaultView(41)).toBe("list");
  });
});

describe("words", () => {
  it("says how long ago", () => {
    expect(agoText(NOW, NOW)).toBe("today");
    expect(agoText(NOW - DAY, NOW)).toBe("yesterday");
    expect(agoText(NOW - 5 * DAY, NOW)).toBe("5 days ago");
    expect(agoText(NOW - 40 * DAY, NOW)).toBe("last month");
    expect(agoText(NOW - 150 * DAY, NOW)).toBe("5 months ago");
    expect(agoText(NOW - 400 * DAY, NOW)).toBe("last year");
    expect(agoText(null, NOW)).toBe("");
  });
  it("gives the features and when it changed", () => {
    expect(metaText(row("a", "A", "flat", { features: 1, edited: NOW }), NOW)).toBe(
      "1 feature · edited today",
    );
    expect(metaText(row("a", "A", "flat", { features: 12, edited: null }), NOW)).toBe(
      "12 features",
    );
  });
});

describe("a row from the server's list", () => {
  it("reads the kind, schematic, state and time", () => {
    const r = rowOf({
      id: "x",
      title: "X",
      space: { kind: "flat", schematic: true },
      under: null,
      features: 2,
      state: "unpublished",
      edited: "2026-11-24T00:00:00.000Z",
    });
    expect(r).toMatchObject({
      kind: "flat",
      schematic: true,
      state: "unpublished",
      edited: Date.UTC(2026, 10, 24),
    });
    expect(
      rowOf({
        id: "y",
        title: "Y",
        space: { kind: "stars" },
        under: null,
        features: 0,
        state: "published",
      }),
    ).toMatchObject({
      kind: "stars",
      edited: null,
      state: "published",
    });
  });
});

describe("recently opened", () => {
  beforeEach(() => localStorage.clear());
  it("lists the maps opened last, newest first, once each, only those that still exist", () => {
    noteOpened("harbor", 1);
    noteOpened("ezob", 2);
    noteOpened("gone", 3);
    noteOpened("harbor", 4);
    expect(recentMaps(rows).map((r) => r.id)).toEqual(["harbor", "ezob"]);
    expect(recentMaps(rows, 1).map((r) => r.id)).toEqual(["harbor"]);
  });
});
