import type { MapFeature, MapFile, MapLayer } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import {
  addLayer,
  applyDrop,
  dropFor,
  FEATURE_LIMIT,
  freshName,
  heirOf,
  kindName,
  layerAndAbove,
  layerRows,
  moveFeatures,
  removeLayer,
  type Row,
  setLayer,
} from "./layerRows.ts";

const layer = (id: string, parent?: string): MapLayer => ({
  id,
  name: id,
  visible: true,
  color: "#333333",
  ...(parent ? { parent } : {}),
});
const marker = (id: string, layer: string): MapFeature => ({
  id,
  kind: "marker",
  layer,
  at: [0, 0],
  entry: null,
  label: id,
  icon: null,
  child: null,
});
const mapOf = (layers: MapLayer[], features: MapFeature[] = []): MapFile => ({
  version: 1,
  id: "m0000000",
  title: "Test",
  space: { kind: "flat", width: 10, height: 10, scale: null, unit: "" },
  images: [],
  markerSets: [],
  layers,
  features,
});
const keys = (rows: Row[]) => rows.map((r) => `${" ".repeat(r.depth)}${r.key}`);
const none = { collapsed: new Set<string>(), showAll: new Set<string>() };
const order = (map: MapFile) => map.layers.map((l) => `${l.id}<${l.parent ?? ""}`);
const rowOf = (map: MapFile, key: string) => layerRows(map, none).find((r) => r.key === key)!;

describe("the rows of the Layers tab", () => {
  const map = mapOf(
    [layer("a"), layer("b", "a"), layer("c")],
    [marker("f1", "a"), marker("f2", "b"), marker("f3", "a"), marker("f4", "c")],
  );

  it("lists each layer, its features, then its sublayers", () => {
    expect(keys(layerRows(map, none))).toEqual([
      "l:a",
      " f:f1",
      " f:f3",
      " l:b",
      "  f:f2",
      "l:c",
      " f:f4",
    ]);
    const first = layerRows(map, none)[0]!;
    expect(first.type === "layer" && first.count).toBe(2);
  });

  it("leaves out what is inside a closed layer", () => {
    const rows = layerRows(map, { ...none, collapsed: new Set(["a"]) });
    expect(keys(rows)).toEqual(["l:a", "l:c", " f:f4"]);
  });

  it("lists a long layer's first features, then how many more", () => {
    const many = Array.from({ length: FEATURE_LIMIT + 5 }, (_, i) => marker(`m${i}`, "a"));
    const big = mapOf([layer("a")], many);
    const rows = layerRows(big, none);
    expect(rows).toHaveLength(FEATURE_LIMIT + 2);
    expect(rows.at(-1)).toMatchObject({ type: "more", rest: 5 });
    expect(layerRows(big, { ...none, showAll: new Set(["a"]) })).toHaveLength(FEATURE_LIMIT + 6);
  });

  it("names the layers above one, and kinds it does not know", () => {
    expect(layerAndAbove([layer("a"), layer("b", "a"), layer("c", "b")], "c")).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(layerAndAbove([layer("x", "y"), layer("y", "x")], "x")).toEqual(["x", "y"]);
    expect(kindName("label")).toBe("Label");
    expect(freshName([layer("New layer"), { ...layer("z"), name: "New layer 2" }])).toBe(
      "New layer 3",
    );
  });
});

describe("changing the layers", () => {
  it("adds a layer at the top level or inside another, at the end", () => {
    const map = mapOf([layer("a"), layer("b", "a"), layer("c")]);
    const top = addLayer(map, "n", null);
    expect(order(top.map)).toEqual(["a<", "b<a", "c<", "n<"]);
    expect(top.layer.name).toBe("New layer");
    expect("parent" in top.layer).toBe(false);
    const sub = addLayer(map, "n", "a");
    expect(order(sub.map)).toEqual(["a<", "b<a", "n<a", "c<"]);
  });

  it("locks and unlocks, leaving out the lock when it is off", () => {
    const map = mapOf([layer("a")]);
    const locked = setLayer(map, "a", { locked: true });
    expect(locked.layers[0]!.locked).toBe(true);
    expect("locked" in setLayer(locked, "a", { locked: false }).layers[0]!).toBe(false);
  });

  it("deletes a layer: its sublayers take its place, its features move or go", () => {
    const map = mapOf(
      [layer("a"), layer("b", "a"), layer("c", "b"), layer("d")],
      [marker("f1", "b"), marker("f2", "c")],
    );
    const moved = removeLayer(map, "b", "d");
    expect(order(moved)).toEqual(["a<", "c<a", "d<"]);
    expect(moved.features.map((f) => f.layer)).toEqual(["d", "c"]);
    const deleted = removeLayer(map, "b", null);
    expect(deleted.features.map((f) => f.id)).toEqual(["f2"]);
    // The last layer stays.
    const one = mapOf([layer("a")]);
    expect(removeLayer(one, "a", null)).toBe(one);
  });

  it("gives a deleted layer's features to its layer, or the one above, or the next", () => {
    const layers = [layer("a"), layer("b", "a"), layer("c"), layer("d")];
    expect(heirOf(layers, "b")).toBe("a");
    expect(heirOf(layers, "c")).toBe("b");
    // Its sublayer stays, so it may take them.
    expect(heirOf(layers, "a")).toBe("b");
    expect(heirOf(layers, "d")).toBe("c");
    expect(heirOf([layer("a")], "a")).toBeNull();
  });

  it("moves features into a layer, beside a feature or at the end of the layer's own", () => {
    const map = mapOf(
      [layer("a"), layer("b")],
      [marker("f1", "a"), marker("f2", "b"), marker("f3", "a"), marker("f4", "b")],
    );
    const ids = (m: MapFile) => m.features.map((f) => `${f.id}:${f.layer}`);
    expect(ids(moveFeatures(map, ["f1", "f3"], "b"))).toEqual(["f2:b", "f4:b", "f1:b", "f3:b"]);
    expect(ids(moveFeatures(map, ["f4"], "a", { id: "f1", after: false }))).toEqual([
      "f4:a",
      "f1:a",
      "f2:b",
      "f3:a",
    ]);
    expect(ids(moveFeatures(map, ["f1"], "a", { id: "f3", after: true }))).toEqual([
      "f2:b",
      "f3:a",
      "f1:a",
      "f4:b",
    ]);
    expect(moveFeatures(map, ["f1"], "gone")).toBe(map);
    expect(moveFeatures(map, ["f3"], "a")).toBe(map);
    expect(ids(moveFeatures(map, ["f3", "f2"], "a"))).toEqual(["f1:a", "f3:a", "f2:a", "f4:b"]);
  });
});

describe("dropping in the Layers tab", () => {
  const map = mapOf(
    [layer("a"), layer("b", "a"), layer("c"), layer("e")],
    [marker("f1", "a"), marker("f2", "c")],
  );
  const layerDrag = (id: string) => ({ kind: "layer" as const, id });

  it("puts a layer inside another, before it or after it", () => {
    const into = dropFor(map, layerDrag("e"), rowOf(map, "l:c"), 0.5)!;
    expect(into).toMatchObject({ parent: "c", show: "into" });
    expect(order(applyDrop(map, into))).toEqual(["a<", "b<a", "c<", "e<c"]);
    const before = dropFor(map, layerDrag("e"), rowOf(map, "l:a"), 0.1)!;
    expect(order(applyDrop(map, before))).toEqual(["e<", "a<", "b<a", "c<"]);
    const intoSub = dropFor(map, layerDrag("e"), rowOf(map, "l:b"), 0.1)!;
    expect(order(applyDrop(map, intoSub))).toEqual(["a<", "e<a", "b<a", "c<"]);
    // After an open layer with something under it: inside it, at the end.
    expect(dropFor(map, layerDrag("e"), rowOf(map, "l:a"), 0.9)).toMatchObject({
      parent: "a",
      show: "into",
    });
    // After a layer with nothing under it: after it, among its siblings.
    const after = dropFor(map, layerDrag("a"), rowOf(map, "l:e"), 0.9)!;
    expect(order(applyDrop(map, after))).toEqual(["c<", "e<", "a<", "b<a"]);
    // On a feature: into its layer.
    expect(dropFor(map, layerDrag("e"), rowOf(map, "f:f1"), 0.5)).toMatchObject({ parent: "a" });
  });

  it("refuses to put a layer inside itself or what is inside it", () => {
    expect(dropFor(map, layerDrag("a"), rowOf(map, "l:a"), 0.5)).toBeNull();
    expect(dropFor(map, layerDrag("a"), rowOf(map, "l:b"), 0.5)).toBeNull();
    expect(dropFor(map, layerDrag("a"), rowOf(map, "l:b"), 0.1)).toBeNull();
  });

  it("moves features into the layer of the row", () => {
    const drag = { kind: "features" as const, ids: ["f1"] };
    const onLayer = dropFor(map, drag, rowOf(map, "l:e"), 0.2)!;
    expect(applyDrop(map, onLayer).features.find((f) => f.id === "f1")!.layer).toBe("e");
    const onFeature = dropFor(map, drag, rowOf(map, "f:f2"), 0.9)!;
    expect(onFeature).toMatchObject({ layer: "c", beside: { id: "f2", after: true } });
    expect(applyDrop(map, onFeature).features.map((f) => f.id)).toEqual(["f2", "f1"]);
    expect(dropFor(map, drag, rowOf(map, "f:f1"), 0.5)).toBeNull();
  });
});
