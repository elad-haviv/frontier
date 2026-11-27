import { describe, expect, it } from "vitest";
import {
  customProperties,
  propertyKind,
  propertyValue,
  thingOf,
  thingValue,
} from "../src/index.js";

describe("links to maps, chronicles and trees (stage 34)", () => {
  it("reads a link by its kind and id, with a place or an event inside it", () => {
    expect(thingOf("map/ab12cd34")).toEqual({ kind: "map", id: "ab12cd34" });
    expect(thingOf("chronicle/k3v9x2ab#s1")).toEqual({
      kind: "chronicle",
      id: "k3v9x2ab",
      spot: "s1",
    });
    expect(thingOf("tree/f2")).toEqual({ kind: "tree", id: "f2" });
    for (const not of ["map/", "maps/ab", "a map/ab", "map/ab cd", "[[map/ab]]", 12, null]) {
      expect(thingOf(not)).toBeNull();
    }
    expect(thingValue({ kind: "map", id: "ab", spot: "f9" })).toBe("map/ab#f9");
    expect(thingValue({ kind: "tree", id: "t1" })).toBe("tree/t1");
  });

  it("gives such a value its kind, and other text stays text", () => {
    expect(propertyKind("map/ab12cd34#f9")).toBe("map");
    expect(propertyKind("chronicle/k3v9x2ab")).toBe("chronicle");
    expect(propertyKind("tree/f2g6y0lm")).toBe("tree");
    expect(propertyKind("a map of the coast")).toBe("text");
    expect(customProperties("---\nhome: map/ab12cd34\n---\n")).toEqual([
      { key: "home", kind: "map", value: "map/ab12cd34" },
    ]);
  });

  it("writes only a link of the property's own kind", () => {
    expect(propertyValue("map", "map/ab12cd34")).toBe("map/ab12cd34");
    expect(propertyValue("map", "  ")).toBeNull();
    expect(() => propertyValue("map", "tree/ab")).toThrow("Choose a map");
    expect(() => propertyValue("chronicle", "the long years")).toThrow("Choose a chronicle");
  });
});
