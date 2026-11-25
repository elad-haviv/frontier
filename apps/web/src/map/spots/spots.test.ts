import type { Position } from "@frontier/geo";
import { type MapFeature, STARTER_STYLES } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import {
  alongOf,
  contextOf,
  type DayMode,
  findSpots,
  type HeightAt,
  hereSpot,
  type SpotsInput,
} from "./spots.ts";

const ROAD = "strroad1";
const RIVER = "strriver";
const BORDER = "strborde";
const WATER = "strwater";

let n = 0;
const base = { layer: "l1", entry: null, child: null } as const;
const path = (
  label: string,
  style: string,
  points: Position[],
  extra: Partial<{ startOn: string; endOn: string; id: string }> = {},
): MapFeature =>
  ({
    ...base,
    id: extra.id ?? `p${n++}`,
    kind: "path",
    label,
    style,
    points,
    ...extra,
  }) as MapFeature;
const zone = (label: string, style: string, points: Position[]): MapFeature =>
  ({ ...base, id: `z${n++}`, kind: "zone", label, style, points }) as MapFeature;
const marker = (label: string, at: Position): MapFeature =>
  ({ ...base, id: `m${n++}`, kind: "marker", label, at, icon: null }) as MapFeature;

/** A 1000 × 1000 map, one kilometre a unit. */
function spots(features: MapFeature[], o: Partial<SpotsInput> = {}) {
  return findSpots({
    width: 1000,
    height: 1000,
    kmPerUnit: 1,
    features,
    styles: STARTER_STYLES,
    nameOf: (f) => f.label ?? "",
    heights: null,
    day: "horse" as DayMode,
    ...o,
  });
}
const kinds = (found: ReturnType<typeof spots>) => found.spots.map((s) => s.kind).sort();

describe("points of interest", () => {
  it("finds one crossroads where two roads cross", () => {
    const found = spots(
      [
        path("King's Road", ROAD, [
          [100, 500],
          [900, 500],
        ]),
        path("Salt Way", ROAD, [
          [500, 100],
          [500, 900],
        ]),
      ],
      { kmPerUnit: null },
    );
    expect(kinds(found)).toEqual(["crossroads"]);
    expect(found.spots[0]!.title).toBe("Crossroads of King's Road and Salt Way");
    expect(found.spots[0]!.at).toEqual([500, 500]);
  });

  it("finds a junction where a road joined to another starts", () => {
    const king = path("King's Road", ROAD, [
      [100, 500],
      [500, 500],
      [900, 500],
    ]);
    const high = path(
      "High Road",
      ROAD,
      [
        [500, 500],
        [500, 900],
      ],
      { startOn: king.id },
    );
    const found = spots([king, high], { kmPerUnit: null });
    expect(kinds(found)).toEqual(["junction"]);
    expect(found.spots[0]!.why).toContain("joined there");
  });

  it("finds a ford on a tributary and a bridge far down a large river", () => {
    const main = path("Greywater", RIVER, [
      [100, 100],
      [500, 500],
      [900, 900],
    ]);
    const trib = path(
      "Brenn",
      RIVER,
      [
        [100, 600],
        [500, 500],
      ],
      { endOn: main.id },
    );
    const road = path("Low Road", ROAD, [
      [800, 600],
      [600, 950],
    ]);
    const trail = path("Hill Track", ROAD, [
      [300, 300],
      [250, 900],
    ]);
    const found = spots([main, trib, road, trail], { kmPerUnit: null });
    const k = kinds(found);
    expect(k).toContain("bridge");
    expect(k).toContain("ford");
    expect(k).toContain("confluence");
    const ford = found.spots.find((s) => s.title === "Hill Track fords Brenn")!;
    expect(ford.kind).toBe("ford");
    expect(ford.why).toContain("tributary");
    expect(found.spots.find((s) => s.kind === "bridge")!.title).toBe("Low Road crosses Greywater");
  });

  it("finds a delta where arms start on a river, and no mouth for it", () => {
    const stem = path("Greywater", RIVER, [
      [100, 100],
      [600, 600],
    ]);
    const north = path(
      "North arm",
      RIVER,
      [
        [600, 600],
        [700, 620],
      ],
      { startOn: stem.id },
    );
    const south = path(
      "South arm",
      RIVER,
      [
        [600, 600],
        [620, 700],
      ],
      { startOn: stem.id },
    );
    const found = spots([stem, north, south], { kmPerUnit: null });
    expect(found.spots.filter((s) => s.kind === "delta")).toHaveLength(1);
    expect(found.spots.some((s) => s.kind === "mouth" && s.paths[0] === stem.id)).toBe(false);
    // Arms are not springs.
    expect(found.spots.filter((s) => s.kind === "spring")).toHaveLength(1);
  });

  it("folds a spot next to a marker into the marker", () => {
    const found = spots(
      [
        path("A", ROAD, [
          [100, 500],
          [900, 500],
        ]),
        path("B", ROAD, [
          [500, 100],
          [500, 900],
        ]),
        marker("Fourways", [503, 502]),
      ],
      { kmPerUnit: null },
    );
    expect(found.spots).toHaveLength(0);
    expect(found.folded.map((f) => f.kind)).toEqual(["crossroads"]);
  });

  it("merges close spots into one with several reasons, the best-ranked first", () => {
    const road = path("Pass Road", ROAD, [
      [100, 500],
      [900, 500],
    ]);
    const border = path("The march", BORDER, [
      [503, 100],
      [503, 900],
    ]);
    const other = path("Cross Road", ROAD, [
      [500, 100],
      [500, 900],
    ]);
    const found = spots([road, border, other], { kmPerUnit: null });
    expect(found.spots).toHaveLength(1);
    expect(found.spots[0]!.kind).toBe("crossroads");
    expect(found.spots[0]!.also.map((a) => a.kind)).toEqual(["border"]);
  });

  it("puts a day's travel along a road by the way of travelling chosen", () => {
    const road = [
      path("Long Road", ROAD, [
        [0, 500],
        [120, 500],
      ]),
    ];
    const horse = spots(road, { day: "horse" }).spots.filter((s) => s.kind === "waystation");
    expect(horse).toHaveLength(1);
    expect(horse[0]!.title).toBe("A day's ride along Long Road");
    expect(horse[0]!.at[0]).toBeCloseTo(55, 0);
    const foot = spots(road, { day: "foot" }).spots.filter((s) => s.kind === "waystation");
    expect(foot.map((s) => Math.round(s.at[0]))).toEqual([30, 60, 90]);
    // With no scale there is no day's travel.
    expect(spots(road, { kmPerUnit: null }).spots).toHaveLength(0);
  });

  it("counts a day's travel from a town on the road", () => {
    const found = spots(
      [
        path("Long Road", ROAD, [
          [0, 500],
          [200, 500],
        ]),
        marker("Harbor", [40, 500]),
      ],
      { day: "horse" },
    );
    const titles = found.spots.filter((s) => s.kind === "waystation").map((s) => s.title);
    expect(titles).toContain("A day's ride from Harbor");
  });

  it("finds passes and springs from the heights, and the sea at a river's mouth", () => {
    // Highest in the middle (x = 500), sea west of x = 50.
    const heights: HeightAt = ([x]) => {
      const grey = Math.max(0, 1 - Math.abs(x - 500) / 450);
      return { grey, metres: grey * 2000, sea: x < 50 };
    };
    const found = spots(
      [
        path("High Road", ROAD, [
          [100, 300],
          [900, 300],
        ]),
        path("Wyn", RIVER, [
          [480, 700],
          [20, 700],
        ]),
      ],
      { heights, kmPerUnit: null },
    );
    const pass = found.spots.find((s) => s.kind === "pass")!;
    expect(pass.why).toContain("m: a pass");
    const spring = found.spots.find((s) => s.kind === "spring")!;
    expect(spring.why).toMatch(/about 1,9\d0 m up/);
    expect(found.spots.some((s) => s.kind === "mouth")).toBe(true);
  });

  it("finds a lake's outlet where a river leaves a water zone", () => {
    const found = spots(
      [
        zone("Lake Merrow", WATER, [
          [80, 80],
          [220, 80],
          [220, 220],
          [80, 220],
        ]),
        path("Ashwell", RIVER, [
          [150, 150],
          [600, 600],
        ]),
      ],
      { kmPerUnit: null },
    );
    expect(kinds(found)).toContain("lake");
    expect(kinds(found)).not.toContain("spring");
  });

  it("loses the spots of a road that is not there yet", () => {
    const king = path("King's Road", ROAD, [
      [100, 500],
      [900, 500],
    ]);
    const salt = path("Salt Way", ROAD, [
      [500, 100],
      [500, 900],
    ]);
    expect(spots([king, salt], { kmPerUnit: null }).spots).toHaveLength(1);
    expect(spots([king], { kmPerUnit: null }).spots).toHaveLength(0);
  });

  it("lists a road's spots and towns in order from its start", () => {
    const road = path("Long Road", ROAD, [
      [0, 500],
      [200, 500],
    ]);
    const found = spots([road, marker("Harbor", [40, 500])], { day: "horse" });
    const along = alongOf(found, road.id, found.spots);
    expect(along.map((a) => a.milestone?.name ?? a.spot!.title)).toEqual([
      "Its start",
      "Harbor",
      "A day's ride from Harbor",
      "Two days' ride from Harbor",
      "Its end",
    ]);
  });

  it("describes a place clicked, and what the AI is told about a spot", () => {
    const king = path("King's Road", ROAD, [
      [100, 500],
      [900, 500],
    ]);
    const salt = path("Salt Way", ROAD, [
      [500, 100],
      [500, 900],
    ]);
    const town = marker("Wynmouth", [700, 300]);
    const found = spots([king, salt, town], { kmPerUnit: 1, day: "cart" });
    const here = hereSpot(found, [520, 500], 1, 1414);
    expect(here.why).toMatch(/^On King's Road · /);
    const far = hereSpot(found, [100, 100], 1, 1414);
    expect(far.why).toBe("632 km west of Wynmouth");
    const cross = found.spots.find((s) => s.kind === "crossroads")!;
    const ctx = contextOf(cross, found, { km: 1, heights: null, guessed: false, year: 450 });
    expect(ctx.lines[0]).toBe("What is here: Crossroads of King's Road and Salt Way.");
    expect(ctx.lines).toContain(
      "On: King's Road (road, a name on the map), Salt Way (road, a name on the map).",
    );
    expect(ctx.lines.some((l) => /^Towns: Wynmouth, \d+ km to the north-east\.$/.test(l))).toBe(
      true,
    );
    expect(ctx.lines).toContain("The moment: year 450.");
    expect(ctx.features).toEqual(expect.arrayContaining([king.id, salt.id, town.id]));
  });
});
