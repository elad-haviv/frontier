import { describe, expect, it } from "vitest";
import {
  lastEntry,
  MAX_POSITIONS,
  MAX_RECENTS,
  readStored,
  Recents,
  RECENTS_KEY,
  RESUME_MAX_AGE_MS,
  shouldResume,
} from "./recents.ts";

const DAY = 24 * 60 * 60 * 1000;

function memory(initial?: string) {
  const data = new Map<string, string>(initial ? [[RECENTS_KEY, initial]] : []);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

function make(storage: ReturnType<typeof memory> | null = memory(), start = 1_000_000) {
  const clock = { now: start };
  const timers: (() => void)[] = [];
  const recents = new Recents({
    storage,
    now: () => clock.now,
    later: (run) => timers.push(run),
  });
  return { recents, clock, storage, timers };
}

describe("recent entries", () => {
  it("keeps each entry once, newest first, with how it was last used", () => {
    const { recents, clock } = make();
    recents.touch("A.md", "A", "read");
    clock.now += 10;
    recents.touch("B.md", "B", "read");
    clock.now += 10;
    recents.touch("A.md", "A", "edited");
    expect(recents.snapshot().recents).toEqual([
      { path: "A.md", title: "A", kind: "edited", at: 1_000_020 },
      { path: "B.md", title: "B", kind: "read", at: 1_000_010 },
    ]);
  });

  it("keeps the last 30", () => {
    const { recents } = make();
    for (let i = 0; i < MAX_RECENTS + 5; i++) recents.touch(`E${i}.md`, `E${i}`, "read");
    const list = recents.snapshot().recents;
    expect(list).toHaveLength(MAX_RECENTS);
    expect(list[0]!.path).toBe(`E${MAX_RECENTS + 4}.md`);
    expect(list.at(-1)!.path).toBe("E5.md");
  });

  it("tells subscribers, and gives the same snapshot until something changes", () => {
    const { recents } = make();
    let heard = 0;
    const off = recents.subscribe(() => heard++);
    const before = recents.snapshot();
    expect(recents.snapshot()).toBe(before);
    recents.touch("A.md", "A", "read");
    expect(heard).toBe(1);
    expect(recents.snapshot()).not.toBe(before);
    off();
    recents.touch("B.md", "B", "read");
    expect(heard).toBe(1);
  });

  it("forgets an entry everywhere, and follows a rename", () => {
    const { recents } = make();
    recents.viewed("A.md", "A");
    recents.viewed("B.md", "B");
    recents.setScroll("A.md", 900);
    recents.setCursor("A.md", 12);
    recents.renamed("A.md", "New/A2.md", "A2");
    expect(recents.snapshot().previous).toEqual({ path: "New/A2.md", title: "A2" });
    expect(recents.snapshot().recents.map((r) => r.path)).toContain("New/A2.md");
    expect(recents.cursorAt("New/A2.md")).toBe(12);
    expect(recents.cursorAt("A.md")).toBeNull();
    recents.renamed("Nothing.md", "Else.md", "Else");
    recents.forget("New/A2.md");
    expect(recents.snapshot().previous).toBeNull();
    expect(recents.snapshot().recents.map((r) => r.path)).toEqual(["B.md"]);
    expect(recents.cursorAt("New/A2.md")).toBeNull();
    recents.forget("B.md");
    expect(recents.snapshot().current).toBeNull();
  });
});

describe("the last entry", () => {
  it("is the entry viewed before the open one", () => {
    const { recents } = make();
    expect(recents.lastBefore("A.md")).toBeNull();
    recents.viewed("A.md", "A");
    expect(recents.lastBefore("A.md")).toBeNull();
    recents.viewed("B.md", "B", "edited");
    expect(recents.lastBefore("B.md")).toEqual({ path: "A.md", title: "A" });
    // From Home, "last" is the entry that was open.
    expect(recents.lastBefore(null)).toEqual({ path: "B.md", title: "B" });
  });

  it("is not lost by reloading the open entry, and swaps when going back", () => {
    const { recents } = make();
    recents.viewed("A.md", "A");
    recents.viewed("B.md", "B");
    recents.viewed("B.md", "B");
    expect(recents.lastBefore("B.md")).toEqual({ path: "A.md", title: "A" });
    recents.viewed("A.md", "A");
    expect(recents.lastBefore("A.md")).toEqual({ path: "B.md", title: "B" });
  });

  it("never offers the open entry as its own last", () => {
    expect(
      lastEntry(
        { current: { path: "A.md", title: "A" }, previous: { path: "A.md", title: "A" } },
        "A.md",
      ),
    ).toBeNull();
  });
});

describe("reading position", () => {
  it("resumes only more than a screen down and within 30 days", () => {
    const now = 100 * DAY;
    expect(shouldResume(null, 800, now)).toBe(false);
    expect(shouldResume(undefined, 800, now)).toBe(false);
    expect(shouldResume({ y: 800, at: now }, 800, now)).toBe(false);
    expect(shouldResume({ y: 801, at: now }, 800, now)).toBe(true);
    expect(shouldResume({ y: 5000, at: now - RESUME_MAX_AGE_MS + 1 }, 800, now)).toBe(true);
    expect(shouldResume({ y: 5000, at: now - RESUME_MAX_AGE_MS }, 800, now)).toBe(false);
  });

  it("gives where reading stopped, and forgets it on request", () => {
    const { recents, clock } = make();
    recents.setScroll("A.md", 2400.6);
    expect(recents.resumeAt("A.md", 800)).toBe(2401);
    expect(recents.resumeAt("A.md", 3000)).toBeNull();
    expect(recents.resumeAt("B.md", 800)).toBeNull();
    clock.now += RESUME_MAX_AGE_MS + 1;
    expect(recents.resumeAt("A.md", 800)).toBeNull();
    recents.setScroll("A.md", -5);
    expect(recents.resumeAt("A.md", 0)).toBeNull();
    recents.clearScroll("A.md");
    recents.clearScroll("A.md");
    expect(recents.resumeAt("A.md", -1)).toBeNull();
  });

  it("keeps the newest positions only", () => {
    const { recents, clock } = make();
    for (let i = 0; i < MAX_POSITIONS + 3; i++) {
      clock.now += 1;
      recents.setScroll(`E${i}.md`, 5000);
      recents.setCursor(`E${i}.md`, i);
    }
    expect(recents.resumeAt("E0.md", 100)).toBeNull();
    expect(recents.cursorAt("E0.md")).toBeNull();
    expect(recents.resumeAt(`E${MAX_POSITIONS + 2}.md`, 100)).toBe(5000);
    expect(recents.cursorAt("E3.md")).toBe(3);
  });

  it("keeps the editor's cursor", () => {
    const { recents } = make();
    expect(recents.cursorAt("A.md")).toBeNull();
    recents.setCursor("A.md", 40.2);
    expect(recents.cursorAt("A.md")).toBe(40);
  });
});

describe("storage", () => {
  it("writes positions once for a burst, and at once on flush", () => {
    const { recents, storage, timers } = make();
    recents.setScroll("A.md", 900);
    recents.setScroll("A.md", 950);
    expect(storage!.data.has(RECENTS_KEY)).toBe(false);
    expect(timers).toHaveLength(1);
    timers[0]!();
    expect(JSON.parse(storage!.data.get(RECENTS_KEY)!).scroll["A.md"].y).toBe(950);
    // Nothing new to write: the timer finds nothing dirty.
    recents.setCursor("A.md", 1);
    recents.flush();
    recents.flush();
    timers[1]!();
    expect(JSON.parse(storage!.data.get(RECENTS_KEY)!).cursor["A.md"].pos).toBe(1);
  });

  it("is read back by the next page, and by reload", () => {
    const first = make();
    first.recents.viewed("A.md", "A");
    first.recents.viewed("B.md", "B", "edited");
    first.recents.setScroll("B.md", 3000);
    first.recents.flush();
    const second = new Recents({ storage: first.storage, now: () => 1_000_001 });
    expect(second.snapshot().recents.map((r) => r.path)).toEqual(["B.md", "A.md"]);
    expect(second.lastBefore("B.md")).toEqual({ path: "A.md", title: "A" });
    expect(second.resumeAt("B.md", 800)).toBe(3000);
    first.recents.touch("C.md", "C", "read");
    second.reload();
    expect(second.snapshot().recents[0]!.path).toBe("C.md");
  });

  it("works with no storage, or storage that throws", () => {
    const none = make(null);
    none.recents.viewed("A.md", "A");
    none.recents.flush();
    expect(none.recents.snapshot().current?.path).toBe("A.md");
    const broken = new Recents({
      storage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("full");
        },
      },
    });
    broken.viewed("A.md", "A");
    expect(broken.snapshot().recents).toHaveLength(1);
  });

  it("reads what is well formed and drops the rest", () => {
    expect(readStored(null).recents).toEqual([]);
    expect(readStored("not json").recents).toEqual([]);
    expect(readStored("[]").recents).toEqual([]);
    const read = readStored(
      JSON.stringify({
        recents: [
          { path: "A.md", title: "A", kind: "read", at: 5 },
          { path: "A.md", title: "A again", kind: "read", at: 4 },
          { path: "B.md", title: "B", kind: "sideways", at: 5 },
          { path: 7, title: "C", kind: "read", at: 5 },
          { path: "D.md", title: "D", kind: "read", at: "now" },
        ],
        current: { path: "A.md", title: "A" },
        previous: { path: 1 },
        scroll: { "A.md": { y: 10, at: 1 }, "B.md": { y: "far", at: 1 }, "C.md": null },
        cursor: "no",
      }),
    );
    expect(read.recents).toEqual([{ path: "A.md", title: "A", kind: "read", at: 5 }]);
    expect(read.current).toEqual({ path: "A.md", title: "A" });
    expect(read.previous).toBeNull();
    expect(Object.keys(read.scroll)).toEqual(["A.md"]);
    expect(read.cursor).toEqual({});
    expect(readStored(JSON.stringify({ previous: { path: "P.md", title: "P" } })).previous).toEqual(
      { path: "P.md", title: "P" },
    );
  });
});
