import { describe, expect, it } from "vitest";
import {
  isStub,
  KeepGoingSettings,
  KeepGoingSettingsRequest,
  libraryFileNamed,
  libraryFileOf,
  LinkItUndo,
  MAX_PINS,
  mergePins,
  NeedsLoveRules,
  parsePins,
  PINS,
  PINS_FILE,
  PinOrderRequest,
  PinRequest,
  PinsFile,
  RandomQuery,
  renameInPins,
  serialisePins,
  Settings,
  STUB_WORDS,
  WeekResponse,
} from "../src/index.js";

const pins = (...paths: string[]): PinsFile => ({
  version: 1,
  pins: paths.map((path) => ({ path })),
});

describe("stubs", () => {
  it("is an entry of under 80 words", () => {
    expect(STUB_WORDS).toBe(80);
    expect(isStub(0)).toBe(true);
    expect(isStub(79)).toBe(true);
    expect(isStub(80)).toBe(false);
  });
});

describe("the needs-love settings", () => {
  it("has every rule on until it is switched off", () => {
    expect(NeedsLoveRules.parse({})).toEqual({
      stub: true,
      emptyHeadings: true,
      noType: true,
      noPicture: true,
      openComments: true,
      todoMarks: true,
    });
    expect(KeepGoingSettings.parse({}).needsLove.stub).toBe(true);
    expect(Settings.parse({ passwordHash: "x" }).keepGoing.needsLove.todoMarks).toBe(true);
    expect(
      Settings.parse({ passwordHash: "x", keepGoing: { needsLove: { stub: false } } }).keepGoing
        .needsLove,
    ).toMatchObject({
      stub: false,
      noType: true,
    });
  });

  it("takes some rules to change, and refuses what is not a switch", () => {
    expect(KeepGoingSettingsRequest.parse({ needsLove: { stub: false } })).toEqual({
      needsLove: { stub: false },
    });
    expect(KeepGoingSettingsRequest.parse({})).toEqual({});
    expect(KeepGoingSettingsRequest.safeParse({ needsLove: { stub: "no" } }).success).toBe(false);
  });
});

describe("the pins file", () => {
  it("is one of the library's item files, found by name and by path", () => {
    expect(libraryFileNamed("pins")).toBe(PINS);
    expect(libraryFileOf(PINS_FILE)).toBe(PINS);
    expect(PINS.conflict).toBe("pins_changed_on_both");
    expect(PINS.empty()).toEqual(pins());
  });

  it("is written one pin to a line, and read back", () => {
    const text = serialisePins(pins("01 Places/Harbor/Harbor.md", "Mira.md"));
    expect(text).toBe(
      '{\n  "version": 1,\n  "pins": [\n    {"path":"01 Places/Harbor/Harbor.md"},\n    {"path":"Mira.md"}\n  ]\n}\n',
    );
    expect(parsePins(text)).toEqual({
      ok: true,
      file: pins("01 Places/Harbor/Harbor.md", "Mira.md"),
    });
    expect(serialisePins(pins())).toBe('{\n  "version": 1,\n  "pins": []\n}\n');
  });

  it("refuses a pin that is not an entry, a pin twice, and too many", () => {
    expect(PinsFile.safeParse(pins("Harbor.png")).success).toBe(false);
    expect(PinsFile.safeParse(pins("../Harbor.md")).success).toBe(false);
    expect(PinsFile.safeParse(pins("/Harbor.md")).success).toBe(false);
    const twice = parsePins(serialisePins(pins("A.md", "A.md")));
    expect(twice).toEqual({ ok: false, message: '"A.md" is pinned twice.' });
    const many = pins(...Array.from({ length: MAX_PINS + 1 }, (_, i) => `E${i}.md`));
    expect(PinsFile.safeParse(many).success).toBe(false);
    expect(
      PinsFile.safeParse(pins(...many.pins.slice(0, MAX_PINS).map((p) => p.path))).success,
    ).toBe(true);
    expect(parsePins("nope")).toEqual({ ok: false, message: "It is not valid JSON." });
    expect(parsePins('{"version":2,"pins":[]}')).toEqual({
      ok: false,
      message: "It has version 2; this Frontier reads version 1.",
    });
  });

  it("keeps what it does not know", () => {
    const read = parsePins('{"version":1,"pins":[{"path":"A.md","note":"x"}],"extra":true}');
    expect(read.ok && read.file).toEqual({
      version: 1,
      pins: [{ path: "A.md", note: "x" }],
      extra: true,
    });
  });

  it("follows the rename of an entry or of a folder", () => {
    expect(renameInPins(pins("A.md", "F/B.md"), "A.md", "C.md")).toEqual(pins("C.md", "F/B.md"));
    expect(renameInPins(pins("A.md", "F/B.md", "FF/B.md"), "F", "G/H")).toEqual(
      pins("A.md", "G/H/B.md", "FF/B.md"),
    );
    expect(PINS.follow!(pins("A.md"), "A.md", "B.md")).toEqual(pins("B.md"));
  });

  it("merges two versions by path", () => {
    const base = pins("A.md", "B.md");
    const merged = mergePins(base, pins("A.md", "B.md", "C.md"), pins("A.md", "D.md"));
    expect(merged.clashes).toEqual([]);
    expect(merged.file.pins.map((p) => p.path).sort()).toEqual(["A.md", "C.md", "D.md"]);
  });
});

describe("requests", () => {
  it("takes the pins to add, and their order", () => {
    expect(PinRequest.parse({ path: "A.md" })).toEqual({ path: "A.md" });
    expect(PinRequest.safeParse({ path: "A.txt" }).success).toBe(false);
    expect(PinOrderRequest.parse({ paths: ["A.md", "B.md"] }).paths).toHaveLength(2);
    expect(PinOrderRequest.safeParse({ paths: ["A.md", "B.png"] }).success).toBe(false);
  });

  it("takes a kind of random entry, any by default", () => {
    expect(RandomQuery.parse({}).kind).toBe("any");
    expect(RandomQuery.parse({ kind: "old" }).kind).toBe("old");
    expect(RandomQuery.safeParse({ kind: "big" }).success).toBe(false);
  });

  it("holds what Undo needs", () => {
    const undo = { path: "A.md", draftId: "abcdefghijkl", revision: 2, previousText: null };
    expect(LinkItUndo.parse(undo)).toEqual(undo);
    expect(LinkItUndo.safeParse({ ...undo, revision: 0 }).success).toBe(false);
    expect(LinkItUndo.safeParse({ ...undo, draftId: "short" }).success).toBe(false);
  });

  it("has seven days in a week", () => {
    const day = (n: number) => ({ date: `2026-03-0${n}`, entries: 0, words: 0 });
    const week = {
      entriesTouched: 0,
      wordsAdded: 0,
      linksFilled: 0,
      days: [1, 2, 3, 4, 5, 6, 7].map(day),
    };
    expect(WeekResponse.parse({ week, onThisDay: [] }).week.days).toHaveLength(7);
    expect(
      WeekResponse.safeParse({ week: { ...week, days: week.days.slice(1) }, onThisDay: [] })
        .success,
    ).toBe(false);
  });
});
