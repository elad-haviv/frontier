import { describe, expect, it } from "vitest";
import {
  combineKept,
  emptyChronicle,
  findItem,
  itemShapeOf,
  serialiseChronicle,
  unionClashes,
} from "../src/index.js";

const MAP = ".frontier/maps/coast001.json";

describe("the items of a kept copy", () => {
  it("knows maps, chronicles and library item files, and nothing else", () => {
    expect(itemShapeOf(MAP)?.kind).toBe("map");
    expect(itemShapeOf(".frontier/chronicles/ezob0001.json")?.kind).toBe("chronicle");
    expect(itemShapeOf(".frontier/folders.json")?.kind).toBe("library");
    expect(itemShapeOf("02 People/Mira.md")).toBeUndefined();
  });

  it("finds an item in a list or a value at the top", () => {
    const shape = itemShapeOf(MAP)!;
    const file = { title: "Coast", features: [{ id: "f1", label: "Lighthouse" }], images: 3 };
    expect(findItem(shape, file, "f1")).toEqual({
      list: "features",
      value: { id: "f1", label: "Lighthouse" },
    });
    expect(findItem(shape, file, "title")).toEqual({ list: null, value: "Coast" });
    expect(findItem(shape, file, "under")).toBeUndefined();
    expect(findItem(shape, file, "f2")).toBeUndefined();
  });

  it("combines two copies: the newer one, with the earlier items as they were", () => {
    const shape = itemShapeOf(MAP)!;
    const older = {
      title: "Old title",
      layers: [{ id: "l1" }],
      features: [
        { id: "f1", label: "Old Light" },
        { id: "f3", label: "Kept" },
      ],
    };
    const newer = {
      title: "New title",
      under: "abcdefgh",
      layers: [{ id: "l1" }],
      features: [
        { id: "f1", label: "Newer" },
        { id: "f2", label: "Removed in the older" },
      ],
    };
    const out = combineKept(shape, older, newer, ["f1", "f2", "f3", "title", "under"]);
    expect(out).toEqual({
      title: "Old title",
      layers: [{ id: "l1" }],
      features: [
        { id: "f1", label: "Old Light" },
        { id: "f3", label: "Kept" },
      ],
    });
    // The newer copy is left as it was.
    expect(newer.features).toHaveLength(2);
    expect(unionClashes(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(unionClashes()).toEqual([]);
  });

  it("reads and writes each kind's text", () => {
    const chronicle = itemShapeOf(".frontier/chronicles/ezob0001.json")!;
    expect(chronicle.parse("not json")).toBeNull();
    const text = serialiseChronicle(emptyChronicle("ezob0001", "Ezob", "lane0001"));
    expect(chronicle.serialise(chronicle.parse(text)!)).toBe(text);
    const folders = itemShapeOf(".frontier/folders.json")!;
    const parsed = folders.parse('{"version":1,"folders":[{"path":"A"}]}')!;
    expect(folders.keyOf((parsed.folders as unknown[])[0])).toBe("A");
    expect(folders.parse("[]")).toBeNull();
    expect(folders.serialise(parsed)).toContain('{"path":"A"}');
    expect(itemShapeOf(MAP)!.parse("{}")).toBeNull();
  });
});
