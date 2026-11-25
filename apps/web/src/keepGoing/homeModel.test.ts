import type { TreeFolder } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import {
  ago,
  barHeights,
  dayLetter,
  diceFolder,
  type Draft,
  entriesWord,
  folderOf,
  lastRead,
  mentionsText,
  newestDraft,
  onThisDayWhen,
  stemOf,
  stubsIn,
} from "./homeModel.ts";

const NOON = new Date("2026-11-25T12:00:00").getTime();

describe("ago", () => {
  it("says it in minutes, hours, yesterday, a weekday, then a date", () => {
    expect(ago(NOON - 10_000, NOON)).toBe("just now");
    expect(ago(NOON - 12 * 60_000, NOON)).toBe("12 min ago");
    expect(ago(NOON - 2 * 3_600_000, NOON)).toBe("2 h ago");
    expect(ago(new Date("2026-11-24T09:00:00").getTime(), NOON)).toBe("yesterday");
    expect(ago(new Date("2026-11-22T09:00:00").getTime(), NOON)).toMatch(/\w+/);
    expect(ago(new Date("2026-11-22T09:00:00").getTime(), NOON)).not.toMatch(/ago|yesterday/);
    expect(ago(new Date("2026-09-01T09:00:00").getTime(), NOON)).toMatch(/1/);
  });

  it("never reads a time ahead of now as negative", () => {
    expect(ago(NOON + 5000, NOON)).toBe("just now");
  });
});

const draft = (path: string, over: Partial<Draft> = {}): Draft => ({
  id: path,
  path,
  kind: "edit",
  binary: false,
  text: "",
  mainText: "",
  origins: [],
  ...over,
});

describe("newestDraft", () => {
  const drafts = [draft("A.md"), draft("B.md"), draft("C.md")];

  it("prefers the entry edited last on this device", () => {
    const recents = [
      { path: "C.md", kind: "read" as const },
      { path: "B.md", kind: "edited" as const },
      { path: "A.md", kind: "edited" as const },
    ];
    expect(newestDraft(drafts, recents)?.path).toBe("B.md");
  });

  it("falls back to the last one listed", () => {
    expect(newestDraft(drafts, [])?.path).toBe("C.md");
  });

  it("leaves out deletions, files and maps", () => {
    const all = [
      draft("A.md"),
      draft("B.md", { kind: "delete" }),
      draft("img.png", { binary: true }),
      draft(".frontier/maps/x.json"),
    ];
    expect(newestDraft(all, [])?.path).toBe("A.md");
    expect(newestDraft([all[1]!, all[2]!, all[3]!], [])).toBeNull();
    expect(newestDraft([], [])).toBeNull();
  });
});

describe("small helpers", () => {
  it("finds the newest entry read", () => {
    expect(lastRead([{ kind: "edited" as const }, { kind: "read" as const, n: 1 }])).toEqual({
      kind: "read",
      n: 1,
    });
    expect(lastRead([{ kind: "edited" as const }])).toBeNull();
  });

  it("names folders and entries from paths", () => {
    expect(folderOf("01 Places/Harbor/Harbor.md")).toBe("01 Places/Harbor");
    expect(folderOf("README.md")).toBe("");
    expect(stemOf("01 Places/Harbor.md")).toBe("Harbor");
    // The dice has no folder to pick from at the library top, nor before any entry was read.
    expect(diceFolder("01 Places/Harbor.md")).toBe("01 Places");
    expect(diceFolder("README.md")).toBeNull();
    expect(diceFolder(null)).toBeNull();
  });

  it("scales the week's bars to the busiest day, with a mark for a quiet one", () => {
    const heights = barHeights([{ entries: 0 }, { entries: 1 }, { entries: 8 }]);
    expect(heights).toEqual([8, 14, 100]);
    expect(barHeights([{ entries: 0 }])).toEqual([8]);
    expect(dayLetter("2026-11-25")).toMatch(/^\p{L}$/u);
  });

  it("words the lists", () => {
    expect(entriesWord(1)).toBe("1 entry");
    expect(entriesWord(3)).toBe("3 entries");
    expect(mentionsText(3, "02 People")).toBe("Mentioned in 3 entries · likely in 02 People");
    expect(mentionsText(1, null)).toBe("Mentioned in 1 entry");
    expect(onThisDayWhen({ span: "year", kind: "written" })).toBe("written 1 year ago");
    expect(onThisDayWhen({ span: "sixMonths", kind: "changed" })).toBe("last changed 6 months ago");
  });
});

describe("stubsIn", () => {
  const note = (path: string, words?: number) => ({
    path,
    title: path,
    state: "published" as const,
    ...(words === undefined ? {} : { words }),
  });
  const folder: TreeFolder = {
    path: "01 Places",
    notes: [note("01 Places/A.md", 20), note("01 Places/B.md", 400), note("01 Places/New.md")],
    folders: [
      { path: "01 Places/Harbor", notes: [note("01 Places/Harbor/C.md", 79)], folders: [] },
    ],
  };

  it("counts the entries and the stubs below a folder, drafts without words left out", () => {
    expect(stubsIn(folder)).toEqual({ entries: 3, stubs: 2 });
  });

  it("never counts the README or the appendices", () => {
    expect(stubsIn({ path: "x", notes: [note("README.md", 5)], folders: [] })).toEqual({
      entries: 0,
      stubs: 0,
    });
    expect(
      stubsIn({ path: "99 Appendices", notes: [note("99 Appendices/A.md", 5)], folders: [] }),
    ).toEqual({ entries: 0, stubs: 0 });
  });
});
