import { inflateSync } from "node:zlib";
import type { MapFeature, MapStyle, MapTerrainHint } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { hintsChanged } from "./hash.ts";
import {
  forStore,
  foundHints,
  type Hint,
  heightWords,
  hintName,
  hintsHash,
  inUse,
  mergeFound,
  tiedHints,
} from "./page.ts";
import { greyPng } from "./png.ts";
import type { HintsFound } from "./protocol.ts";

const space = { kind: "flat", width: 1200, height: 800, scale: 1, unit: "km" } as const;
const extent = [0, 0, 1200, 800];

const found: HintsFound = {
  w: 600,
  h: 400,
  ms: 120,
  notUsed: [],
  hints: [
    { kind: "sea", conf: 0.97, why: "sea" },
    { kind: "peak", at: [100, 50], h: 0.9, conf: 0.88, why: "peak" },
    {
      kind: "road",
      points: [
        [10, 10],
        [10, 300],
      ],
      conf: 0.35,
      why: "road",
    },
  ],
};

describe("hints on the page", () => {
  it("turns what was found into hints of the map: likely ones in use, the rest waiting", () => {
    const hints = foundHints(found, extent);
    expect(hints.map((h) => h.state)).toEqual(["accepted", "accepted", "waiting"]);
    // Twice the size: the working copy is half the map's.
    expect(hints[1]!.at).toEqual([201, 101]);
    expect(hints.every((h) => h.by === "found" && h.id.length === 8)).toBe(true);
    // And back to the worker's pixels, only those in use.
    const px = inUse(hints, extent, 600, 400);
    expect(px.map((h) => h.kind)).toEqual(["sea", "peak"]);
    expect(px[1]!.at).toEqual([100, 50]);
  });

  it("Find again keeps his own, his changes and what he rejected, and adds what is new", () => {
    const [sea, peak, road] = foundHints(found, extent);
    const mine: Hint = {
      id: "mine0001",
      kind: "ridge",
      points: [
        [1, 1],
        [2, 2],
      ],
      state: "accepted",
      by: "you",
    };
    const now: Hint[] = [
      sea!,
      { ...peak!, at: [300, 300], touched: true },
      { ...road!, state: "rejected" },
      mine,
    ];
    const again = foundHints(found, extent);
    const merged = mergeFound(now, again, 40);
    // The sea found again stays one; the moved peak and the rejected road stay as they are.
    expect(merged.filter((h) => h.kind === "sea")).toHaveLength(1);
    expect(merged.find((h) => h.kind === "peak")!.at).toEqual([300, 300]);
    expect(merged.filter((h) => h.kind === "peak")).toHaveLength(2);
    expect(merged.find((h) => h.kind === "road")!.state).toBe("rejected");
    expect(merged.filter((h) => h.kind === "road")).toHaveLength(1);
    expect(merged).toContainEqual(mine);
  });

  it("ties hints to the features whose styles count as terrain, and to mountains by name", () => {
    const styles = [
      { id: "stywater", name: "Lake", for: "zone", color: "#2f6f9f", counts: "water" },
      { id: "stymount", name: "Mountains", for: "zone", color: "#7a4a22", counts: "mountains" },
      { id: "stywood1", name: "Wood", for: "zone", color: "#5f8a4a", counts: "forest" },
      { id: "styriver", name: "River", for: "path", color: "#2f6f9f", counts: "river" },
    ] as unknown as MapStyle[];
    const ring = [
      [10, 10],
      [50, 10],
      [50, 40],
    ];
    const f = (id: string, kind: string, extra: object) =>
      ({ id, kind, layer: "l1", entry: null, label: null, child: null, ...extra }) as MapFeature;
    const drawn = [
      f("lake0001", "zone", { points: ring, style: "stywater" }),
      f("mount001", "zone", { points: ring, style: "stymount", label: "Grey Peaks" }),
      f("wood0001", "zone", { points: ring, style: "stywood1" }),
      f("river001", "path", {
        points: [
          [1, 1],
          [9, 9],
        ],
        style: "styriver",
      }),
      f("mark0001", "marker", { at: [5, 5], icon: null, label: "Mt. Corran" }),
      f("mark0002", "marker", { at: [6, 6], icon: null, label: "Harbor" }),
    ];
    const kept: MapTerrainHint[] = [
      { id: "keptlake", kind: "lake", state: "rejected", by: "feature:lake0001" },
    ];
    const tied = tiedHints(space, drawn, styles, kept);
    expect(tied.map((h) => [h.kind, h.by, h.state])).toEqual([
      ["lake", "feature:lake0001", "rejected"],
      ["highland", "feature:mount001", "accepted"],
      ["river", "feature:river001", "accepted"],
      ["peak", "feature:mark0001", "waiting"],
    ]);
    expect(tied[0]!.id).toBe("keptlake");
    expect(tied[1]!.why).toContain("“Grey Peaks”");
    expect(tied[3]!.at).toEqual([5, 5]);
    expect(tied[3]!.conf).toBe(0.6);
    // Kept without a shape: it comes from the feature each time.
    const store = forStore(tied);
    expect(store[1]).toEqual({
      id: tied[1]!.id,
      kind: "highland",
      state: "accepted",
      by: "feature:mount001",
    });
    expect(store.some((h) => "why" in h)).toBe(false);
  });

  it("hashes the hints in use only, whatever their order", () => {
    const [sea, peak, road] = foundHints(found, extent) as [Hint, Hint, Hint];
    const a = hintsHash([sea, peak, road]);
    expect(hintsHash([road, peak, sea])).toBe(a);
    expect(hintsHash([sea, peak, { ...road, state: "rejected" }])).toBe(a);
    expect(hintsHash([sea, { ...peak, at: [1, 2] }, road])).not.toBe(a);
    const map = { terrain: { generated: { hints: a } }, terrainHints: forStore([sea, peak, road]) };
    expect(hintsChanged(map)).toBe(false);
    expect(hintsChanged({ ...map, terrainHints: forStore([sea]) })).toBe(true);
    expect(hintsChanged({ terrainHints: [] })).toBe(false);
  });

  it("says heights in words until the highest point is given", () => {
    expect(heightWords(0.9, null)).toBe("high peaks");
    expect(heightWords(0.25, null)).toBe("hills");
    expect(heightWords(0.5, { value: 2600, unit: "m" })).toBe("1,300 m");
    const river: MapTerrainHint = {
      id: "r",
      kind: "river",
      points: [
        [0, 0],
        [100, 0],
      ],
      state: "accepted",
      by: "found",
    };
    expect(hintName(river, null, 1)).toBe("River, flowing east");
    expect(hintName({ ...river, flip: true }, null, 1)).toBe("River, flowing west");
    expect(hintName({ ...river, kind: "ridge", h: 0.9 }, null, 2)).toBe(
      "Ridge · high peaks, 200 km",
    );
  });
});

describe("the saved image", () => {
  it("is a 16-bit grey PNG that reads back", async () => {
    const w = 5;
    const h = 3;
    const grey = new Uint16Array(w * h).map((_, i) => i * 4000 + 7);
    const png = await greyPng(grey, w, h);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(w);
    expect(view.getUint32(20)).toBe(h);
    expect(png[24]).toBe(16);
    // Undo the "up" filter and compare.
    const idat = view.getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idat));
    const out = new Uint16Array(w * h);
    const prev = new Uint8Array(w * 2);
    for (let y = 0; y < h; y++) {
      const row = raw.subarray(y * (1 + w * 2) + 1, (y + 1) * (1 + w * 2));
      const up = raw[y * (1 + w * 2)] === 2;
      const bytes = row.map((b, i) => (up ? (b + prev[i]!) & 255 : b));
      prev.set(bytes);
      for (let x = 0; x < w; x++) out[y * w + x] = (bytes[x * 2]! << 8) | bytes[x * 2 + 1]!;
    }
    expect([...out]).toEqual([...grey]);
  });
});
