import { describe, expect, it } from "vitest";
import type { GraphResponse } from "@frontier/schema";
import { Layout, radiusOf, seedOf } from "./layout.ts";
import { filterGraph, makeModel, tickedFolders } from "./model.ts";
import { runLayout } from "./runner.ts";

/** A made-up library of 500 entries and 3,000 links, the same on every run. */
function generated(): GraphResponse {
  let state = 42;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const folders = ["01 Places", "02 People", "03 Things", "04 Events"];
  const nodes = Array.from({ length: 500 }, (_, i) => ({
    path: `${folders[i % 4]}/Entry ${String(i).padStart(3, "0")}.md`,
    title: `Entry ${i}`,
    type: null,
  })).sort((a, b) => (a.path < b.path ? -1 : 1));
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  while (edges.length < 3000) {
    const a = Math.floor(random() * 500);
    // Links gather around a few entries, as they do in a library.
    const b = Math.floor(random() ** 2 * 500);
    if (a === b || seen.has(`${a} ${b}`)) continue;
    seen.add(`${a} ${b}`);
    edges.push([a, b]);
  }
  return { nodes, edges, folders: folders.map((path) => ({ path, color: null })), nested: [] };
}

const model = makeModel(generated());
const shown = filterGraph(model, tickedFolders(model, new Map()));

function settled() {
  const layout = new Layout();
  layout.set(model, shown);
  layout.finish();
  return layout;
}

describe("the layout", () => {
  it("ends a cold start in 200 ticks", () => {
    expect(shown.nodes).toHaveLength(500);
    expect(settled().ticks).toBe(200);
  });

  it("restarts warm in 67 ticks, keeping placed nodes where they were", () => {
    const layout = settled();
    const before = layout.at(model.nodes[0]!.path);
    const fewer = filterGraph(model, tickedFolders(model, new Map([["04 Events", false]])));
    layout.set(model, fewer);
    // The first tick moves from where the node rested, not from its seed.
    const node = layout.nodes.find((n) => n.i === 0)!;
    expect({ x: node.x, y: node.y }).toEqual(before);
    layout.finish();
    expect(layout.ticks).toBe(67);
  });

  it("gives the same positions for the same input", () => {
    const a = settled();
    const b = settled();
    for (const i of shown.nodes.slice(0, 50)) {
      expect(a.at(model.nodes[i]!.path)).toEqual(b.at(model.nodes[i]!.path));
    }
  });

  it("starts a node at a point that depends only on its path", () => {
    const first = seedOf("01 Places/Harbor/Harbor.md", 400);
    expect(seedOf("01 Places/Harbor/Harbor.md", 400)).toEqual(first);
    expect(seedOf("01 Places/Harbor/Old Quay.md", 400)).not.toEqual(first);
    // Inside a disc of radius 10·√n.
    expect(Math.hypot(first.x, first.y)).toBeLessThanOrEqual(200);
    const layout = new Layout();
    const one = makeModel({
      nodes: [{ path: model.nodes[7]!.path, title: "x", type: null }],
      edges: [],
      folders: model.folders,
      nested: [],
    });
    layout.set(one, filterGraph(one, new Set(model.folders.map((f) => f.path))));
    expect(layout.at(model.nodes[7]!.path)).toEqual(seedOf(model.nodes[7]!.path, 1));
  });

  it("keeps a local graph's centre in the middle", () => {
    const layout = new Layout();
    layout.set(model, shown, shown.nodes[3]!);
    layout.finish();
    expect(layout.at(model.nodes[shown.nodes[3]!]!.path)).toEqual({ x: 0, y: 0 });
  });

  it("sizes a node by its neighbours, up to 14", () => {
    expect(radiusOf(0)).toBe(3);
    expect(radiusOf(4)).toBeCloseTo(6.2);
    expect(radiusOf(400)).toBe(14);
  });
});

describe("the runner", () => {
  /** Frames run by hand; each read of the made-up clock moves it on 3 ms. */
  function frames() {
    let clock = 0;
    const queued: (() => void)[] = [];
    return {
      deps: {
        frame: (run: () => void) => queued.push(run),
        cancel: () => queued.splice(0),
        now: () => (clock += 3),
      },
      step: () => queued.shift()?.(),
      get waiting() {
        return queued.length;
      },
    };
  }

  it("ticks in slices of about 8 ms and draws after each", () => {
    const layout = new Layout();
    layout.set(model, shown);
    const f = frames();
    let drawn = 0;
    let done = 0;
    runLayout(layout, { onSlice: () => drawn++, onDone: () => done++ }, f.deps);
    f.step();
    // Read at 3 ms, then 6, 9 and 12 after each tick: three ticks before 8 ms have passed.
    expect(layout.ticks).toBe(3);
    expect(drawn).toBe(1);
    while (f.waiting > 0) f.step();
    expect(layout.ticks).toBe(200);
    expect(done).toBe(1);
    expect(drawn).toBe(66);
  });

  it("draws nothing until the end with reduced motion, and can be stopped", () => {
    const layout = new Layout();
    layout.set(model, shown);
    const f = frames();
    let drawn = 0;
    let done = 0;
    const stop = runLayout(
      layout,
      { onSlice: () => drawn++, onDone: () => done++, reduced: true },
      f.deps,
    );
    f.step();
    f.step();
    stop();
    expect(f.waiting).toBe(0);
    expect(drawn).toBe(0);
    expect(done).toBe(0);
    runLayout(layout, { onSlice: () => drawn++, onDone: () => done++, reduced: true }, f.deps);
    while (f.waiting > 0) f.step();
    expect(drawn).toBe(0);
    expect(done).toBe(1);
  });
});
