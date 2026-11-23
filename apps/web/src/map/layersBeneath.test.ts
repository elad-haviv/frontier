import type { MapFile } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { aboveAndBelow, lies, type OtherMap } from "./layersBeneath.ts";

const sphere = { kind: "sphere", radius: null, unit: "km" } as MapFile["space"];
const flat = { kind: "flat", width: 10, height: 10, scale: null, unit: "" } as MapFile["space"];
const other = (id: string, under: string | null, space = sphere): OtherMap => ({
  id,
  title: id,
  space,
  under,
});

describe("which maps lie under which", () => {
  it("finds a map that lies under this one, directly or through others", () => {
    const maps = [other("caves", "here"), other("deep", "caves"), other("moon", null)];
    expect(lies("here", "caves", maps)).toBe(true);
    expect(lies("here", "deep", maps)).toBe(true);
    expect(lies("here", "moon", maps)).toBe(false);
  });

  it("stops at a loop that does not pass through this map", () => {
    const maps = [other("a", "b"), other("b", "a")];
    expect(lies("here", "a", maps)).toBe(false);
  });

  it("gives the globe above and the globes below, never a flat map", () => {
    const map = { space: sphere, under: "surface" } as unknown as MapFile;
    const maps = [
      other("surface", null),
      other("caves", "here"),
      other("sketch", "here", flat),
      other("moon", null),
    ];
    const { above, below } = aboveAndBelow(map, "here", maps);
    expect(above?.id).toBe("surface");
    expect(below.map((m) => m.id)).toEqual(["caves"]);
    expect(aboveAndBelow({ space: flat } as MapFile, "here", maps)).toEqual({
      above: undefined,
      below: [],
    });
  });
});
