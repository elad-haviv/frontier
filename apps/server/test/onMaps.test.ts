import { describe, expect, it } from "vitest";
import { type ChronicleFile, type MapFile, emptyChronicle } from "@frontier/schema";
import { onMapsOf } from "../src/chronicles/onMaps.js";

const span = (id: string, entry: string | null = null) => ({
  id,
  lane: "l1",
  name: id,
  point: false,
  start: null,
  end: null,
  length: null,
  entry,
  note: "",
});

const chronicle: ChronicleFile = {
  ...emptyChronicle("c4h7x2ab", "Ezob", "l1"),
  spans: [span("kingdom"), span("war", "fort1"), span("war2", "fort1")],
};

const map = (id: string, features: object[]) =>
  ({ id, title: `Map ${id}`, features }) as unknown as MapFile;

describe("what on the maps follows each span", () => {
  it("counts features tied to a span, and features whose entry's first span it is", () => {
    const out = onMapsOf(chronicle, [
      map("m1", [
        { id: "f1", span: "kingdom", entry: null },
        { id: "f2", span: null, entry: "fort1" },
        { id: "f3", entry: "fort1" },
        { id: "f4", span: "gone", entry: "fort1" },
        { id: "f5", entry: "nobody" },
        { id: "f6" },
      ]),
      map("m2", [{ id: "g1", span: "kingdom" }]),
    ]);
    expect(out).toEqual({
      kingdom: [
        { map: "m1", title: "Map m1", features: 1 },
        { map: "m2", title: "Map m2", features: 1 },
      ],
      war: [{ map: "m1", title: "Map m1", features: 2 }],
    });
  });
});
