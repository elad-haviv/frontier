import type { Position, Space } from "@frontier/geo";
import { type MapFeature, type MapFile, mergeMaps, parseMap, serialiseMap } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import {
  cornerOn,
  crossCorners,
  joinedTo,
  joinEnd,
  joinNewPath,
  keepJoins,
  nearestOnPath,
  type PathFeature,
  roadCrossings,
} from "./joins.ts";

const space: Space = { kind: "flat", width: 600, height: 400, scale: 1, unit: "km" };
const path = (id: string, points: Position[], extra: object = {}): PathFeature =>
  ({
    id,
    kind: "path",
    layer: "l1",
    points,
    entry: null,
    label: null,
    child: null,
    ...extra,
  }) as PathFeature;
const mapOf = (...features: MapFeature[]): MapFile =>
  ({
    version: 1,
    id: "ab12cd34",
    title: "Joins",
    space,
    images: [],
    markerSets: [],
    layers: [{ id: "l1", name: "Paths", visible: true, color: "#2f6f9f" }],
    features,
  }) as unknown as MapFile;
const get = (m: MapFile, id: string) => m.features.find((f) => f.id === id) as PathFeature;
const set = (m: MapFile, f: PathFeature): MapFile => ({
  ...m,
  features: m.features.map((x) => (x.id === f.id ? f : x)),
});

const river = path("river", [
  [100, 200],
  [300, 200],
  [500, 200],
]);
const tributary = path("trib", [
  [200, 50],
  [200, 199.999],
]);

describe("joining a path's end onto another path", () => {
  it("puts a corner into the other path at the meeting point and remembers the join", () => {
    const joined = joinEnd(mapOf(river, tributary), space, "trib", "end", "river");
    const r = get(joined, "river");
    const t = get(joined, "trib");
    expect(r.points).toEqual([
      [100, 200],
      [200, 200],
      [300, 200],
      [500, 200],
    ]);
    // Exactly the same coordinates in both.
    expect(t.points[1]).toEqual([200, 200]);
    expect(t.endOn).toBe("river");
    expect(t.startOn).toBeUndefined();
    expect(joinedTo(joined, "river")).toEqual([{ path: "trib", end: "end", at: [200, 200] }]);
  });

  it("uses a corner that is already there, and joins at the other path's own end too", () => {
    const side = path("side", [
      [300, 100],
      [300, 200],
    ]);
    const joined = joinEnd(mapOf(river, side), space, "side", "end", "river");
    expect(get(joined, "river").points).toHaveLength(3);
    const onward = path("on", [
      [500, 200],
      [560, 260],
    ]);
    const more = joinNewPath(mapOf(river, onward), space, "on");
    expect(get(more, "on").startOn).toBe("river");
    expect(get(more, "river").points).toHaveLength(3);
  });

  it("puts the corner on the curve of a curved path", () => {
    const bend = path(
      "bend",
      [
        [100, 200],
        [300, 100],
        [500, 200],
      ],
      { curve: "smooth" },
    );
    const on = nearestOnPath(space, bend, [200, 140]);
    const side = path("side", [[200, 20], on.at]);
    const joined = joinNewPath(mapOf(bend, side), space, "side");
    const b = get(joined, "bend");
    expect(b.points).toHaveLength(4);
    expect(get(joined, "side").points[1]).toEqual(b.points[1]);
    // The new corner lay on the curve as it was drawn, so the curve hardly changes.
    expect(nearestOnPath(space, bend, b.points[1]!).d).toBeLessThan(0.001);
    expect(
      Math.abs(nearestOnPath(space, b, [400, 140]).d - nearestOnPath(space, bend, [400, 140]).d),
    ).toBeLessThan(3);
  });

  it("joins a new path only where an end lies on another, and only among those allowed", () => {
    const apart = path("apart", [
      [200, 50],
      [200, 150],
    ]);
    expect(joinNewPath(mapOf(river, apart), space, "apart")).toEqual(mapOf(river, apart));
    const none = joinNewPath(mapOf(river, tributary), space, "trib", new Set());
    expect(get(none, "trib").endOn).toBeUndefined();
    expect(get(joinNewPath(mapOf(river, tributary), space, "trib"), "trib").endOn).toBe("river");
  });

  it("finds a corner within reach rather than making a second beside it", () => {
    const made = cornerOn(space, river, [300.001, 200], 0.012);
    expect(made.path).toBe(river);
    expect(made.at).toEqual([300, 200]);
  });
});

describe("keeping joins as the map changes", () => {
  const start = joinEnd(mapOf(river, tributary), space, "trib", "end", "river");

  it("moves the joined end with the shared corner when the other path's corner is dragged", () => {
    const r = get(start, "river");
    const dragged = set(start, {
      ...r,
      points: r.points.map((p, i) => (i === 1 ? [220, 240] : p)),
    });
    const kept = keepJoins(start, dragged, space);
    expect(get(kept, "trib").points[1]).toEqual([220, 240]);
    expect(get(kept, "trib").endOn).toBe("river");
  });

  it("moves the corner, and every end on it, when the joined end is dragged", () => {
    const second = path("second", [
      [260, 330],
      [200, 200],
    ]);
    const both = joinEnd(
      { ...start, features: [...start.features, second] },
      space,
      "second",
      "end",
      "river",
    );
    const t = get(both, "trib");
    const dragged = set(both, { ...t, points: [t.points[0]!, [190, 215]] });
    const kept = keepJoins(both, dragged, space);
    expect(get(kept, "river").points[1]).toEqual([190, 215]);
    expect(get(kept, "second").points[1]).toEqual([190, 215]);
  });

  it("keeps the end on its corner when the whole other path is moved, or gains a point", () => {
    const r = get(start, "river");
    const moved = set(start, {
      ...r,
      points: r.points.map(([x, y]): Position => [x + 10, y + 30]),
    });
    expect(get(keepJoins(start, moved, space), "trib").points[1]).toEqual([210, 230]);
    const more = set(start, { ...r, points: [r.points[0]!, [150, 180], ...r.points.slice(1)] });
    const kept = keepJoins(start, more, space);
    expect(get(kept, "trib").points[1]).toEqual([200, 200]);
    expect(get(kept, "trib").endOn).toBe("river");
  });

  it("re-places the end on the other path when that is redrawn", () => {
    const r = get(start, "river");
    const redrawn = set(start, {
      ...r,
      points: [
        [100, 260],
        [500, 260],
      ],
    });
    const kept = keepJoins(start, redrawn, space);
    expect(get(kept, "trib").points[1]).toEqual([200, 260]);
    expect(get(kept, "river").points).toContainEqual([200, 260]);
    expect(get(kept, "trib").endOn).toBe("river");
  });

  it("lets the join go when its corner is deleted, its own end is, or the other path is", () => {
    const r = get(start, "river");
    const cornerGone = set(start, { ...r, points: r.points.filter((_, i) => i !== 1) });
    const a = keepJoins(start, cornerGone, space);
    expect(get(a, "trib").endOn).toBeUndefined();
    expect(get(a, "trib").points[1]).toEqual([200, 200]);

    const longer = set(start, {
      ...get(start, "trib"),
      points: [
        [200, 50],
        [200, 120],
        [200, 200],
      ],
    });
    const stillJoined = keepJoins(start, longer, space);
    expect(get(stillJoined, "trib").endOn).toBe("river");
    const endGone = set(stillJoined, {
      ...get(stillJoined, "trib"),
      points: [
        [200, 50],
        [200, 120],
      ],
    });
    const b = keepJoins(stillJoined, endGone, space);
    expect(get(b, "trib").endOn).toBeUndefined();
    expect(get(b, "river").points).toHaveLength(4);

    const riverGone = { ...start, features: start.features.filter((f) => f.id !== "river") };
    expect(get(keepJoins(start, riverGone, space), "trib").endOn).toBeUndefined();
  });

  it("leaves a map with no joins as it is", () => {
    const plain = mapOf(river, tributary);
    expect(keepJoins(plain, plain, space)).toBe(plain);
  });
});

describe("crossroads", () => {
  it("gives both roads a corner with the same coordinates where they cross, splitting neither", () => {
    const high = path("high", [
      [100, 100],
      [500, 300],
    ]);
    const cross = path("cross", [
      [300, 50],
      [300, 350],
    ]);
    const { map, count } = crossCorners(mapOf(high, cross), space, "cross", new Set(["high"]));
    expect(count).toBe(1);
    expect(map.features).toHaveLength(2);
    expect(get(map, "high").points).toEqual([
      [100, 100],
      [300, 200],
      [500, 300],
    ]);
    expect(get(map, "cross").points).toEqual([
      [300, 50],
      [300, 200],
      [300, 350],
    ]);
  });

  it("makes none where the path only ends on the other, or does not meet it", () => {
    const high = path("high", [
      [100, 100],
      [500, 100],
    ]);
    const ends = path("ends", [
      [300, 300],
      [300, 100],
    ]);
    expect(crossCorners(mapOf(high, ends), space, "ends", new Set(["high"])).count).toBe(0);
    const apart = path("apart", [
      [100, 300],
      [500, 300],
    ]);
    expect(crossCorners(mapOf(high, apart), space, "apart", new Set(["high"])).count).toBe(0);
  });
});

describe("joins in the map file", () => {
  const joined = joinEnd(mapOf(river, tributary), space, "trib", "end", "river");

  it("are written last on the path's line, and a path without one keeps its bytes", () => {
    const text = serialiseMap(joined);
    expect(text).toContain('"child":null,"endOn":"river"}');
    expect(serialiseMap(mapOf(river))).not.toContain("endOn");
    expect(serialiseMap(mapOf(path("p", river.points, { endOn: null })))).toBe(
      serialiseMap(mapOf(path("p", river.points))),
    );
    const read = parseMap(text);
    expect(read.ok && serialiseMap(read.map)).toBe(text);
  });

  it("are dropped on reading when the other path is not there", () => {
    const orphan = mapOf(path("trib", tributary.points, { endOn: "gone", startOn: "trib" }));
    const read = parseMap(JSON.stringify(orphan));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const t = read.map.features[0] as PathFeature;
    expect(t.endOn).toBeUndefined();
    expect(t.startOn).toBeUndefined();
  });

  it("merge item by item, and a join to a path the other side deleted is dropped", () => {
    const base = mapOf(river, tributary);
    // One side joins the tributary; the other names the river.
    const named = set(base, { ...river, label: "Calder" } as PathFeature);
    const clash = mergeMaps(base, joined, named);
    // Both changed the river (a corner here, a name there): a clash, mine kept.
    expect(clash.clashes).toEqual(["river"]);
    expect(get(clash.map, "trib").endOn).toBe("river");
    // The other side deleted the river: the join goes with it.
    const withoutRiver = { ...base, features: [tributary] } as MapFile;
    const mergedGone = mergeMaps(
      joined,
      set(joined, { ...get(joined, "trib"), label: "Wyn" } as PathFeature),
      {
        ...joined,
        features: joined.features.filter((f) => f.id !== "river"),
      },
    );
    expect(mergedGone.map.features.map((f) => f.id)).toEqual(["trib"]);
    expect(get(mergedGone.map, "trib").endOn).toBeUndefined();
    expect(withoutRiver.features).toHaveLength(1);
  });
});

describe("a path drawn by hand that becomes a road", () => {
  const styles = [
    {
      id: "roadroad",
      name: "Road",
      for: "path",
      color: "#7a5230",
      width: 2,
      dash: "long",
      counts: "road",
    },
    {
      id: "riverriv",
      name: "River",
      for: "path",
      color: "#2f6f9f",
      width: 3,
      dash: "solid",
      counts: "river",
    },
  ] as never[];
  const kings = path(
    "kings",
    [
      [0, 100],
      [300, 100],
    ],
    { style: "roadroad" },
  );
  const drawn = (style?: string) =>
    path(
      "drawn",
      [
        [150, 0],
        [150, 200],
      ],
      style ? { style } : {},
    );

  it("gets a crossroads corner with each road it crosses, in both", () => {
    const map = roadCrossings(mapOf(kings, drawn("roadroad")), space, "drawn", styles);
    expect(get(map, "kings").points).toContainEqual([150, 100]);
    expect(get(map, "drawn").points).toContainEqual([150, 100]);
    // A crossroads is not a join.
    expect(get(map, "drawn").startOn ?? null).toBeNull();
  });

  it("leaves a path that is not a road, and roads it does not cross, alone", () => {
    const river = mapOf(kings, drawn("riverriv"));
    expect(roadCrossings(river, space, "drawn", styles)).toBe(river);
    const plain = mapOf(kings, drawn());
    expect(roadCrossings(plain, space, "drawn", styles)).toBe(plain);
  });
});
