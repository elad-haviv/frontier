import { describe, expect, it } from "vitest";
import {
  DASHES,
  LIBRARY_FILE_NAMES,
  LIBRARY_FILES,
  libraryFileNamed,
  libraryFileOf,
  MAP_STYLES,
  MAP_STYLES_FILE,
  type MapStyle,
  type MapStylesFile,
  MapStyle as MapStyleSchema,
  mergeMapStyles,
  parseMapStyles,
  serialiseMapStyles,
  STARTER_STYLES,
  styleNameTaken,
} from "../src/index.js";

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
  dash: "solid",
  fill: 0.2,
};
const file: MapStylesFile = { version: 1, styles: [river, border, realm] };
const ok = (style: Record<string, unknown>) =>
  parseMapStyles(JSON.stringify({ version: 1, styles: [style] })).ok;

describe("the map styles file", () => {
  it("is the second library file, after the folder file", () => {
    expect(LIBRARY_FILES.map((k) => k.name)).toEqual([
      "folders",
      "map-styles",
      "biomes",
      "pins",
      "trees",
      "types",
    ]);
    expect(LIBRARY_FILE_NAMES).toEqual([
      "folders",
      "map-styles",
      "biomes",
      "pins",
      "trees",
      "types",
    ]);
    expect(libraryFileOf(MAP_STYLES_FILE)).toBe(MAP_STYLES);
    expect(libraryFileNamed("map-styles")).toBe(MAP_STYLES);
    expect(MAP_STYLES.empty()).toEqual({ version: 1, styles: [] });
    expect(MAP_STYLES.label).toBe("Map styles");
    expect(MAP_STYLES.conflict).toBe("map_styles_changed_on_both");
  });

  it("reads what it writes, one style per line", () => {
    const text = serialiseMapStyles(file);
    expect(text.split("\n")).toEqual([
      "{",
      '  "version": 1,',
      '  "styles": [',
      '    {"id":"k3v9x2pa","name":"River","for":"path","color":"#2f6f9f","width":3,"dash":"solid"},',
      '    {"id":"q8m1z0tr","name":"Border","for":"path","color":null,"width":2,"dash":"dash-dot"},',
      '    {"id":"a7d2w5ne","name":"Realm","for":"zone","color":null,"width":1.5,"dash":"solid","fill":0.2}',
      "  ]",
      "}",
      "",
    ]);
    expect(parseMapStyles(text)).toEqual({ ok: true, file });
    // Keys in one order however the style was put together.
    const shuffled = Object.fromEntries(Object.entries(river).reverse()) as MapStyle;
    expect(serialiseMapStyles({ version: 1, styles: [shuffled] })).toBe(
      serialiseMapStyles({ version: 1, styles: [river] }),
    );
  });

  it("checks each field's limits", () => {
    expect(ok(river)).toBe(true);
    expect(ok({ ...river, id: "River" })).toBe(false);
    expect(ok({ ...river, name: "  " })).toBe(false);
    expect(ok({ ...river, name: "x".repeat(61) })).toBe(false);
    expect(ok({ ...river, for: "marker" })).toBe(false);
    expect(ok({ ...river, color: "blue" })).toBe(false);
    expect(ok({ ...river, color: "#2F6F9F" })).toBe(false);
    expect(ok({ ...river, width: 0 })).toBe(false);
    expect(ok({ ...river, width: 12.5 })).toBe(false);
    expect(ok({ ...river, width: 2.25 })).toBe(false);
    expect(ok({ ...river, width: 0.5 })).toBe(true);
    expect(ok({ ...river, width: 12 })).toBe(true);
    expect(ok({ ...river, dash: "dotted" })).toBe(false);
    expect(ok({ ...realm, fill: 0.9 })).toBe(false);
    expect(ok({ ...realm, fill: 0 })).toBe(true);
    // A style the next Frontier writes with more in it is kept.
    expect(ok({ ...river, label: "along" })).toBe(true);
  });

  it("refuses a fill on a path style", () => {
    const parsed = MapStyleSchema.safeParse({ ...river, fill: 0.2 });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Only a zone style has a fill");
  });

  it("refuses two styles with one id, more than 200 styles, and other versions", () => {
    expect(
      parseMapStyles(JSON.stringify({ version: 1, styles: [river, { ...border, id: river.id }] })),
    ).toEqual({ ok: false, message: 'Two styles share the id "k3v9x2pa".' });
    const many = Array.from({ length: 201 }, (_, i) => ({
      ...river,
      id: `s${String(i).padStart(7, "0")}`,
    }));
    expect(parseMapStyles(JSON.stringify({ version: 1, styles: many })).ok).toBe(false);
    expect(parseMapStyles(JSON.stringify({ version: 1, styles: many.slice(0, 200) })).ok).toBe(
      true,
    );
    expect(parseMapStyles('{"version":2,"styles":[]}').ok).toBe(false);
  });

  it("keeps two styles of one name, as a merge can make them", () => {
    expect(
      parseMapStyles(JSON.stringify({ version: 1, styles: [river, { ...river, id: "zzzzzzzz" }] }))
        .ok,
    ).toBe(true);
  });

  it("offers the usual styles, each valid, with names unique for their kind", () => {
    expect(STARTER_STYLES.map((s) => `${s.for}:${s.name}`)).toEqual([
      "path:River",
      "path:Road",
      "path:Border",
      "zone:Realm",
      "zone:Forest",
      "zone:Water",
      "zone:Marsh",
      "zone:Mountains",
    ]);
    expect(parseMapStyles(JSON.stringify({ version: 1, styles: STARTER_STYLES })).ok).toBe(true);
  });

  it("measures dashes in widths", () => {
    expect(DASHES.solid).toEqual([]);
    expect(DASHES["dash-dot"]).toEqual([5, 2, 1, 2]);
  });

  it("says when a name is taken by a style of the same kind", () => {
    const styles = file.styles;
    expect(styleNameTaken(styles, " river ", "path")).toBe(true);
    expect(styleNameTaken(styles, "River", "zone")).toBe(false);
    expect(styleNameTaken(styles, "River", "path", river.id)).toBe(false);
    expect(styleNameTaken(styles, "Road", "path")).toBe(false);
  });
});

describe("merging the map styles file", () => {
  it("merges two edits to different styles", () => {
    const mine = { ...file, styles: [{ ...river, width: 4 }, border, realm] };
    const theirs = { ...file, styles: [river, { ...border, dash: "long" as const }, realm] };
    const merged = mergeMapStyles(file, mine, theirs);
    expect(merged.clashes).toEqual([]);
    expect(merged.file.styles).toEqual([
      { ...river, width: 4 },
      { ...border, dash: "long" },
      realm,
    ]);
  });

  it("keeps a style added on one side and a delete on the other", () => {
    const added: MapStyle = { ...river, id: "n3wn3wn3", name: "Canal" };
    const mine = { ...file, styles: [...file.styles, added] };
    const theirs = { ...file, styles: [river, realm] };
    const merged = mergeMapStyles(file, mine, theirs);
    expect(merged.file.styles.map((s) => s.name)).toEqual(["River", "Realm", "Canal"]);
  });

  it("names a style changed on both sides by its id, keeping mine", () => {
    const mine = { ...file, styles: [{ ...river, color: "#000000" }, border, realm] };
    const theirs = { ...file, styles: [{ ...river, color: "#ffffff" }, border, realm] };
    const merged = mergeMapStyles(file, mine, theirs);
    expect(merged.clashes).toEqual([river.id]);
    expect(merged.file.styles[0]!.color).toBe("#000000");
  });
});
