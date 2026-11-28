import { describe, expect, it } from "vitest";
import {
  entryOf,
  findPlaces,
  loreRequest,
  NO_LORE,
  placeItems,
  ringAround,
  stampOf,
  withAnswer,
  worldBrief,
  worldFacts,
} from "./lore.ts";
import { cellAt, DEFAULT_SETTINGS, dirty, driftStep, ensure, newWorld } from "./model.ts";
import { riversOf } from "./rivers.ts";
import { DEFAULT_SYSTEM } from "./system.ts";

function built() {
  const world = newWorld({ ...DEFAULT_SETTINGS, seed: 2024 });
  ensure(world, "sim");
  for (let n = 0; n < 20; n++) driftStep(world);
  ensure(world, "biome");
  return world;
}

describe("the places found on a world", () => {
  const world = built();
  const places = findPlaces(world, riversOf(world));

  it("finds the highest ground and the rest on land, apart from each other, each with its facts", () => {
    expect(places.length).toBeGreaterThanOrEqual(3);
    const peak = places.find((p) => p.key === "peak")!;
    expect(world.elev[peak.cell]).toBe(world.elev.reduce((m, v) => Math.max(m, v), -1));
    expect(new Set(places.map((p) => p.key)).size).toBe(places.length);
    for (const p of places) {
      expect(world.elev[p.cell]!).toBeGreaterThan(0);
      expect(p.key).toMatch(/^[a-z]{2,12}$/);
      expect(p.facts).toMatch(/^At .*(north|south|equator).*°C through the year/);
    }
  });

  it("finds none on a world of sea", () => {
    const sea = newWorld({ ...DEFAULT_SETTINGS, sea: 0.15, landPct: 8, mountains: 0, rough: 0 });
    ensure(sea, "biome");
    sea.elev.fill(-0.5);
    expect(findPlaces(sea)).toEqual([]);
  });

  it("marks the world, so suggestions for another world are known to be stale", () => {
    const stamp = stampOf(world);
    expect(stampOf(world)).toBe(stamp);
    const other = built();
    other.s.sea = 0.1;
    dirty(other, "height");
    expect(stampOf(other)).not.toBe(stamp);
  });
});

describe("what is suggested and kept", () => {
  const world = built();
  const places = findPlaces(world, riversOf(world));
  const first = places[0]!;
  const answer = {
    places: [{ key: first.key, name: "The Elluneth Range", text: "High and cold." }],
    species: [
      { cradle: first.key, name: "The Minik", text: "Highlanders." },
      { cradle: null, name: "The Thossamar", text: "Shore folk." },
    ],
    life: [{ name: "Reed deer", text: "It grazes at low tide." }],
  };

  it("names the places the AI named and keeps the others plain; a tick taken off stays off", () => {
    const before = placeItems(places).map((i, n) => (n === 0 ? { ...i, on: false } : i));
    const items = withAnswer(places, before, answer);
    expect(items[0]).toMatchObject({
      title: "The Elluneth Range",
      on: false,
      written: true,
      cell: first.cell,
    });
    expect(items[1]).toMatchObject({ title: places[1]!.what, on: true });
    expect(items.filter((i) => i.group === "species").map((i) => i.cell)).toEqual([
      first.cell,
      undefined,
    ]);
    expect(items.filter((i) => i.group === "life")).toHaveLength(1);
  });

  it("asks for the world as facts, with the places by key and the author's words", () => {
    const ask = loreRequest("Salt Coast", world, DEFAULT_SYSTEM, places, {
      ...NO_LORE,
      know: " Salt is money. ",
    });
    expect(ask.places.map((p) => p.key)).toEqual(places.map((p) => p.key));
    expect(ask.know).toBe("Salt is money.");
    expect(ask.facts.join(" ")).toMatch(/A day is 24 hours and a year is \d+ days/);
    expect(worldFacts(world, DEFAULT_SYSTEM).join(" ")).toContain("% of the surface is land");
  });

  it("makes an entry of an item in its group's folder, under a name a file can have", () => {
    expect(
      entryOf({
        id: "x",
        group: "species",
        title: "The Min/ik [old]",
        text: " Highlanders. ",
        on: true,
      }),
    ).toEqual({
      path: "Peoples/The Min ik old.md",
      text: "---\ntype: species\n---\n# The Min ik old\n\nHighlanders.\n",
    });
    expect(entryOf({ id: "x", group: "place", title: " / ", text: "t", on: true })).toBeNull();
  });

  it("writes the World brief from the numbers, the choices and the entries kept", () => {
    const items = withAnswer(places, [], answer).map((i) =>
      i.title === "Reed deer" ? { ...i, on: false } : i,
    );
    const brief = worldBrief("Salt Coast", world, DEFAULT_SYSTEM, {
      ...NO_LORE,
      know: "Salt is money.",
      items,
    });
    expect(brief).toContain("# Salt Coast: world brief");
    expect(brief).toContain("- Built from seed 2024.");
    expect(brief).toContain("- Magic: rare.");
    expect(brief).toContain("## What is already known\n\nSalt is money.");
    expect(brief).toContain("- [[The Elluneth Range]]");
    expect(brief).toContain("- [[The Minik]]");
    expect(brief).not.toContain("Reed deer");
  });

  it("draws a homeland as a ring on the globe round its place", () => {
    const ring = ringAround(cellAt(0, 0), 10, 12);
    expect(ring).toHaveLength(12);
    for (const [lon, lat] of ring) expect(Math.hypot(lon, lat)).toBeGreaterThan(8.5);
    // Near the edge of the picture the longitudes stay in range.
    for (const [lon] of ringAround(cellAt(0, Math.PI - 0.01), 10))
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
  });
});
