import { describe, expect, it } from "vitest";
import {
  type ChronicleFile,
  chronicleIdOf,
  chroniclePath,
  type ChronicleSpan,
  emptyChronicle,
  mergeChronicles,
  parseChronicle,
  serialiseChronicle,
} from "../src/index.js";

const span = (id: string, extra: Partial<ChronicleSpan> = {}): ChronicleSpan => ({
  id,
  lane: "l1",
  name: id,
  point: false,
  start: null,
  end: null,
  length: null,
  entry: null,
  note: "",
  ...extra,
});

const base: ChronicleFile = {
  ...emptyChronicle("c4h7x2ab", "Ezob, humans arrive early", "l1"),
  origin: "s1",
  units: [{ id: "u1", name: "generation", low: 20, high: 35 }],
  spans: [
    span("s1", { name: "First Landing", point: true, start: { words: "", low: 0, high: 0 } }),
    span("s2", {
      name: "Earth memory fades",
      length: {
        words: "3 to 5 generations",
        low: 60,
        high: 175,
        clock: "ezob",
        unit: "u1",
        count: [3, 5],
      },
    }),
    span("s3", { name: "The Adyni", start: "open" }),
  ],
  relations: [{ id: "r1", a: "s2", kind: "starts_with", b: "s1" }],
};
const copy = (c: ChronicleFile): ChronicleFile => JSON.parse(JSON.stringify(c)) as ChronicleFile;
const edit = (change: (c: ChronicleFile) => void, from = base): ChronicleFile => {
  const c = copy(from);
  change(c);
  return c;
};

describe("the chronicle file", () => {
  it("is written with one item per line and reads back the same", () => {
    const text = serialiseChronicle(base);
    expect(text.split("\n").filter((l) => l.startsWith('    {"id":"s'))).toHaveLength(3);
    expect(text).toContain('    {"id":"u1","name":"generation","low":20,"high":35}\n');
    expect(text).toContain('"start":"open"');
    const back = parseChronicle(text);
    expect(back.ok && back.chronicle).toEqual(base);
    const shuffled = Object.fromEntries(Object.entries(base).reverse()) as ChronicleFile;
    expect(serialiseChronicle(shuffled)).toBe(text);
  });

  it("keeps keys and relation kinds it does not know", () => {
    const text = serialiseChronicle(base)
      .replace('"kind":"starts_with","b":"s1"}', '"kind":"mirrors","b":"s1","strength":2}')
      .replace('  "title":', '  "epoch": "later",\n  "title":');
    const back = parseChronicle(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.chronicle.relations[0]!.kind).toBe("mirrors");
    const again = serialiseChronicle(back.chronicle);
    expect(again).toContain('"strength":2');
    expect(again).toContain('"epoch": "later"');
  });

  it("opens with a relation to a missing span, a circle, and a missing unit or origin", () => {
    const odd = edit((c) => {
      c.origin = "gone";
      c.relations.push(
        { id: "r2", a: "s1", kind: "after", b: "nowhere" },
        { id: "r3", a: "s1", kind: "after", b: "s2" },
        { id: "r4", a: "s2", kind: "after", b: "s1" },
      );
      c.spans[1]!.length!.unit = "no-such-unit";
    });
    expect(parseChronicle(serialiseChronicle(odd)).ok).toBe(true);
  });

  it("says why a file is not a chronicle", () => {
    const bad = (change: (c: Record<string, unknown>) => void) => {
      const c = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      change(c);
      const r = parseChronicle(JSON.stringify(c));
      return r.ok ? "ok" : r.message;
    };
    expect(parseChronicle("{ nope").ok).toBe(false);
    expect(bad((c) => (c["version"] = 3))).toMatch(/version 3/);
    expect(bad((c) => (c["lanes"] = []))).not.toBe("ok");
    expect(bad((c) => ((c["spans"] as { lane: string }[])[0]!.lane = "gone"))).toMatch(
      /lane that does not exist/,
    );
    expect(bad((c) => ((c["spans"] as { id: string }[])[1]!.id = "s1"))).toMatch(/share an id/);
    expect(
      bad((c) => ((c["spans"] as { start: unknown }[])[0]!.start = { words: "", low: 5, high: 1 })),
    ).toMatch(/lowest value is above/);
    expect(bad((c) => ((c["spans"] as { start: unknown }[])[0]!.start = "sometime"))).not.toBe(
      "ok",
    );
    expect(bad(() => undefined)).toBe("ok");
  });

  it("knows where a chronicle is kept, and what a new one holds", () => {
    expect(chroniclePath("c4h7x2ab")).toBe(".frontier/chronicles/c4h7x2ab.json");
    expect(chronicleIdOf(".frontier/chronicles/c4h7x2ab.json")).toBe("c4h7x2ab");
    expect(chronicleIdOf(".frontier/maps/c4h7x2ab.json")).toBeNull();
    const fresh = emptyChronicle("aaaaaaaa", "New", "lane0001");
    expect(parseChronicle(serialiseChronicle(fresh)).ok).toBe(true);
    expect(fresh).toMatchObject({
      main: false,
      clock: "ezob",
      origin: null,
      lanes: [{ name: "Main" }],
    });
  });
});

describe("merging two versions of a chronicle", () => {
  it("takes what each side added, changed and removed", () => {
    const mine = edit((c) => {
      c.spans.push(span("mine"));
      c.spans[1]!.name = "Memory of Earth fades";
      c.title = "Renamed";
    });
    const theirs = edit((c) => {
      c.spans.push(span("theirs"));
      c.spans.splice(2, 1);
      c.relations.push({ id: "r2", a: "theirs", kind: "after", b: "s1" });
      c.units[0]!.high = 40;
      c.main = true;
    });
    const { chronicle, clashes } = mergeChronicles(base, mine, theirs);
    expect(clashes).toEqual([]);
    expect(chronicle.spans.map((s) => s.id)).toEqual(["s1", "s2", "theirs", "mine"]);
    expect(chronicle.spans[1]!.name).toBe("Memory of Earth fades");
    expect(chronicle.title).toBe("Renamed");
    expect(chronicle.main).toBe(true);
    expect(chronicle.units[0]!.high).toBe(40);
    expect(chronicle.relations).toHaveLength(2);
    expect(parseChronicle(serialiseChronicle(chronicle)).ok).toBe(true);
  });

  it("names each clash and keeps mine", () => {
    const mine = edit((c) => {
      c.spans[0]!.name = "Mine";
      c.origin = "s2";
      c.compare = { spans: ["s2"], cases: [] };
    });
    const theirs = edit((c) => {
      c.spans[0]!.name = "Theirs";
      c.origin = "s3";
      c.compare = { spans: ["s3"], cases: [] };
    });
    const { chronicle, clashes } = mergeChronicles(base, mine, theirs);
    expect(clashes.sort()).toEqual(["compare", "origin", "s1"]);
    expect(chronicle.spans[0]!.name).toBe("Mine");
    expect(chronicle.origin).toBe("s2");
  });

  it("can leave opposite statements standing, for the views to mark", () => {
    const mine = edit((c) => c.relations.push({ id: "ra", a: "s1", kind: "after", b: "s3" }));
    const theirs = edit((c) => c.relations.push({ id: "rb", a: "s3", kind: "after", b: "s1" }));
    const { chronicle, clashes } = mergeChronicles(base, mine, theirs);
    expect(clashes).toEqual([]);
    expect(chronicle.relations.map((r) => r.id)).toEqual(["r1", "rb", "ra"]);
    expect(parseChronicle(serialiseChronicle(chronicle)).ok).toBe(true);
  });

  it("moves a span out of a lane the other side removed, and never ends with no lane", () => {
    const two = edit((c) =>
      c.lanes.push({ id: "l2", name: "Nirani", color: "#2f5d8a", clock: "ezob" }),
    );
    const mine = edit((c) => c.spans.push(span("new", { lane: "l2" })), two);
    const theirs = edit((c) => c.lanes.pop(), two);
    const merged = mergeChronicles(two, mine, theirs).chronicle;
    expect(merged.lanes.map((l) => l.id)).toEqual(["l1"]);
    expect(merged.spans.find((s) => s.id === "new")!.lane).toBe("l1");

    // One device replaces the only lane while the other deletes... the last lane cannot be
    // deleted in the app, but a merge of two renames-by-replacement can remove every lane.
    const a = edit((c) => (c.lanes = [{ id: "la", name: "A", color: "#111111", clock: "ezob" }]));
    const b = edit((c) => (c.lanes = [{ id: "lb", name: "B", color: "#222222", clock: "ezob" }]));
    const both = mergeChronicles(base, a, b).chronicle;
    expect(both.lanes.length).toBeGreaterThan(0);
    expect(parseChronicle(serialiseChronicle(both)).ok).toBe(true);
  });

  it("keeps a length's own clock when its span changes lane", () => {
    const two = edit((c) =>
      c.lanes.push({ id: "l2", name: "Derdama", color: "#2f5d8a", clock: "derdama" }),
    );
    const moved = edit((c) => (c.spans[1]!.lane = "l2"), two);
    const merged = mergeChronicles(two, moved, two).chronicle;
    expect(merged.spans[1]!.lane).toBe("l2");
    expect(merged.spans[1]!.length).toEqual(two.spans[1]!.length);
  });
});
