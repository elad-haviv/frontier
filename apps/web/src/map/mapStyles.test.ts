import type { MapFeature, MapStyle } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import {
  casingOf,
  dashOf,
  fillAlpha,
  freshName,
  INK,
  legendOf,
  paintOf,
  selectionOf,
  styleOf,
  styleState,
  stylesFor,
  undatedOf,
  withStyle,
} from "./mapStyles.ts";

const river: MapStyle = {
  id: "k3v9x2pa",
  name: "River",
  for: "path",
  color: "#2f6f9f",
  width: 3,
  dash: "solid",
};
const border: MapStyle = {
  id: "q8m1z0tr",
  name: "Border",
  for: "path",
  color: null,
  width: 2,
  dash: "dash-dot",
};
const realm: MapStyle = {
  id: "a7d2w5ne",
  name: "Realm",
  for: "zone",
  color: null,
  width: 1.5,
  dash: "dashed",
  fill: 0.4,
};
const marsh: MapStyle = {
  id: "m4r5h000",
  name: "Marsh",
  for: "zone",
  color: "#5f7a4a",
  width: 1,
  dash: "solid",
};
const styles = [river, border, realm, marsh];

const path = (id: string, style?: string): MapFeature =>
  ({
    id,
    kind: "path",
    layer: "l1",
    points: [
      [0, 0],
      [1, 1],
    ],
    entry: null,
    label: null,
    child: null,
    ...(style ? { style } : {}),
  }) as MapFeature;
const zone = (id: string, style?: string): MapFeature =>
  ({
    id,
    kind: "zone",
    layer: "l1",
    points: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    entry: null,
    label: null,
    child: null,
    ...(style ? { style } : {}),
  }) as MapFeature;
const marker: MapFeature = {
  id: "m",
  kind: "marker",
  layer: "l1",
  at: [0, 0],
  icon: null,
  entry: null,
  label: null,
  child: null,
} as MapFeature;

describe("what a path or zone is drawn with", () => {
  it("takes the style's colour, width and dash", () => {
    expect(paintOf(path("p", river.id), "#9a3b1f", styles)).toEqual({
      colour: "#2f6f9f",
      width: 3,
      dash: [],
      cap: "round",
      fill: 0,
      style: river,
    });
  });

  it("takes the layer's colour for a style without one", () => {
    expect(paintOf(path("p", border.id), "#9a3b1f", styles)).toMatchObject({
      colour: "#9a3b1f",
      width: 2,
    });
  });

  it("draws a feature without a style in its layer's colour and the plain look", () => {
    expect(paintOf(path("p"), "#9a3b1f", styles)).toEqual({
      colour: "#9a3b1f",
      width: 2.5,
      dash: [],
      cap: "round",
      fill: 0,
      style: null,
    });
    expect(paintOf(zone("z"), "#9a3b1f", styles)).toMatchObject({ width: 1.5, fill: 0.2 });
    // A layer without a colour, as an older file may have: ink.
    expect(paintOf(path("p"), undefined, styles).colour).toBe(INK);
  });

  it("falls back to the layer's look when the style was deleted, keeping the id", () => {
    const deleted = path("p", "gonegone");
    expect(paintOf(deleted, "#9a3b1f", styles)).toMatchObject({
      colour: "#9a3b1f",
      width: 2.5,
      style: null,
    });
    expect(styleState(deleted, styles)).toBe("deleted");
    expect((deleted as { style?: string }).style).toBe("gonegone");
  });

  it("ignores a style whose kind does not match the feature's", () => {
    const wrong = path("p", realm.id);
    expect(styleOf(wrong, styles)).toBeNull();
    expect(paintOf(wrong, "#9a3b1f", styles).width).toBe(2.5);
    expect(styleState(wrong, styles)).toBe("deleted");
    expect(styleOf(zone("z", river.id), styles)).toBeNull();
  });

  it("says whether a feature has a style, a drawn one, or one gone", () => {
    expect(styleState(marker, styles)).toBe("none");
    expect(styleState(path("p"), styles)).toBe("none");
    expect(styleState(path("p", river.id), styles)).toBe("found");
    expect(styleOf(marker, styles)).toBeNull();
  });

  it("fills a zone from its style, or with the plain strength when the style has none", () => {
    expect(paintOf(zone("z", realm.id), "#9a3b1f", styles)).toMatchObject({
      colour: "#9a3b1f",
      fill: 0.4,
      width: 1.5,
    });
    expect(paintOf(zone("z", marsh.id), "#9a3b1f", styles)).toMatchObject({
      colour: "#5f7a4a",
      fill: 0.2,
    });
  });

  it("scales dashes by the width, with butt caps", () => {
    expect(dashOf("dashed", 2)).toEqual([8, 6]);
    expect(dashOf("long", 1)).toEqual([7, 3]);
    expect(dashOf("dash-dot", 3)).toEqual([15, 6, 3, 6]);
    expect(dashOf("solid", 5)).toEqual([]);
    const paint = paintOf(path("p", border.id), "#000000", styles);
    expect(paint.dash).toEqual([10, 4, 2, 4]);
    expect(paint.cap).toBe("butt");
    expect(paintOf(zone("z", realm.id), "#000000", styles)).toMatchObject({
      dash: [6, 4.5],
      cap: "butt",
    });
  });

  it("draws an undated line as a narrower dotted stroke over a dashed style", () => {
    const paint = paintOf(path("p", border.id), "#000000", styles);
    expect(undatedOf(paint.width)).toEqual({ width: 1, dash: [2, 4] });
    expect(undatedOf(6)).toEqual({ width: 3, dash: [6, 12] });
    // Never thinner than a pixel.
    expect(undatedOf(1).width).toBe(1);
  });

  it("sizes the casing, the selection and the hover from the width", () => {
    expect(casingOf(2.5)).toBe(5.5);
    expect(casingOf(3)).toBe(6);
    expect(selectionOf("path", 3)).toBe(9);
    expect(selectionOf("zone", 1.5)).toBe(3.5);
  });

  it("fills a zone as the hex strength, stronger while selected", () => {
    expect(fillAlpha(0.2, false)).toBe("33");
    expect(fillAlpha(0.2, true)).toBe("55");
    expect(fillAlpha(0, false)).toBe("00");
    expect(fillAlpha(0.8, true)).toBe("ee");
    expect(fillAlpha(0.95, true)).toBe("ff");
  });
});

describe("the legend and the lists", () => {
  it("lists each style used by a feature drawn now, paths first, in the file's order", () => {
    const drawn = [
      zone("z1", realm.id),
      path("p1", border.id),
      path("p2", river.id),
      path("p3", river.id),
      path("p4", "gonegone"),
      path("p5", realm.id),
      marker,
      path("p6"),
    ];
    expect(legendOf(drawn, styles).map((s) => s.name)).toEqual(["River", "Border", "Realm"]);
    expect(legendOf([], styles)).toEqual([]);
  });

  it("lists the styles of a kind", () => {
    expect(stylesFor(styles, "zone").map((s) => s.name)).toEqual(["Realm", "Marsh"]);
  });

  it("names a new style so that no style of its kind has that name", () => {
    expect(freshName([], "path")).toBe("Path style");
    const one = { ...river, name: "Path style" };
    expect(freshName([one], "path")).toBe("Path style 2");
    expect(freshName([one, { ...river, id: "x", name: "path STYLE 2" }], "path")).toBe(
      "Path style 3",
    );
    expect(freshName([one], "zone")).toBe("Zone style");
  });

  it("gives a feature a style, or takes it away", () => {
    expect((withStyle(path("p"), river.id) as { style?: string }).style).toBe(river.id);
    expect("style" in withStyle(path("p", river.id), null)).toBe(false);
    expect(withStyle(marker, river.id)).toBe(marker);
  });
});
