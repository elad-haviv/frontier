import { describe, expect, it } from "vitest";
import {
  FOLDER_COLORS,
  FOLDER_FILE,
  FOLDER_ICONS,
  type FolderFile,
  FOLDERS,
  LIBRARY_FILES,
  libraryFileNamed,
  libraryFileOf,
  mergeFolders,
  mergeLibraryFile,
  movedFolderPath,
  orderBetween,
  parseFolders,
  parseLibraryFile,
  renameInFolders,
  serialiseFolders,
  sortFolders,
} from "../src/index.js";

const file: FolderFile = {
  version: 1,
  folders: [
    { path: "03 Gazetteer/Islands", icon: "waves", color: "sea", order: "V", type: "place" },
    { path: "03 Gazetteer/Old Coast", order: "k" },
    { path: "05 Empty" },
  ],
};

describe("the folder file", () => {
  it("reads what it writes, one line per folder", () => {
    const text = serialiseFolders(file);
    expect(text.split("\n")).toEqual([
      "{",
      '  "version": 1,',
      '  "folders": [',
      '    {"path":"03 Gazetteer/Islands","icon":"waves","color":"sea","order":"V","type":"place"},',
      '    {"path":"03 Gazetteer/Old Coast","order":"k"},',
      '    {"path":"05 Empty"}',
      "  ]",
      "}",
      "",
    ]);
    const parsed = parseFolders(text);
    expect(parsed).toEqual({ ok: true, file });
  });

  it("writes keys in one order however the line was put together", () => {
    const a = serialiseFolders({ version: 1, folders: [{ type: "x", path: "A", icon: "map" }] });
    const b = serialiseFolders({ version: 1, folders: [{ path: "A", icon: "map", type: "x" }] });
    expect(a).toBe(b);
    expect(serialiseFolders({ version: 1, folders: [] })).toContain('"folders": []');
  });

  it("refuses an unknown icon or colour, bad paths and order keys", () => {
    const bad = (line: Record<string, unknown>) =>
      parseFolders(JSON.stringify({ version: 1, folders: [line] })).ok;
    expect(bad({ path: "A", icon: "rocket" })).toBe(false);
    expect(bad({ path: "A", color: "red" })).toBe(false);
    expect(bad({ path: ".frontier/maps" })).toBe(false);
    expect(bad({ path: ".obsidian" })).toBe(false);
    expect(bad({ path: "A/../B" })).toBe(false);
    expect(bad({ path: "A/" })).toBe(false);
    expect(bad({ path: "A", order: "a0" })).toBe(false);
    expect(bad({ path: "A", order: "a-b" })).toBe(false);
    expect(bad({ path: "A", type: "two words" })).toBe(false);
    expect(bad({ path: "A", icon: "waves", color: "teal", order: "a1", type: "place" })).toBe(true);
    // A line the next Frontier writes with more in it is kept.
    expect(bad({ path: "A", pinned: true })).toBe(true);
  });

  it("refuses two lines for one folder, other versions and text that is not JSON", () => {
    const two = parseFolders(
      JSON.stringify({ version: 1, folders: [{ path: "A" }, { path: "A" }] }),
    );
    expect(two).toEqual({ ok: false, message: '"A" has two lines.' });
    expect(parseFolders('{"version":2,"folders":[]}')).toEqual({
      ok: false,
      message: "It has version 2; this Frontier reads version 1.",
    });
    expect(parseFolders("{")).toEqual({ ok: false, message: "It is not valid JSON." });
    expect(parseFolders("null").ok).toBe(false);
  });

  it("caps the file at 5,000 lines", () => {
    const many = Array.from({ length: 5001 }, (_, i) => ({ path: `F${i}` }));
    expect(parseFolders(JSON.stringify({ version: 1, folders: many })).ok).toBe(false);
  });

  it("has 62 icons and 8 colours, each with a light and a dark value", () => {
    expect(FOLDER_ICONS).toHaveLength(62);
    expect(new Set(FOLDER_ICONS).size).toBe(62);
    expect(Object.keys(FOLDER_COLORS)).toEqual([
      "ember",
      "sea",
      "moss",
      "gold",
      "plum",
      "slate",
      "rose",
      "teal",
    ]);
    for (const c of Object.values(FOLDER_COLORS)) {
      expect(c.light).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.dark).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("merging the folder file", () => {
  it("merges two reorders of different folders", () => {
    const mine = {
      ...file,
      folders: file.folders.map((l) => (l.path === "05 Empty" ? { ...l, order: "a" } : l)),
    };
    const theirs = {
      ...file,
      folders: file.folders.map((l) =>
        l.path === "03 Gazetteer/Old Coast" ? { ...l, order: "N" } : l,
      ),
    };
    const merged = mergeFolders(file, mine, theirs);
    expect(merged.clashes).toEqual([]);
    expect(merged.file.folders.map((l) => [l.path, l.order])).toEqual([
      ["03 Gazetteer/Islands", "V"],
      ["03 Gazetteer/Old Coast", "N"],
      ["05 Empty", "a"],
    ]);
  });

  it("keeps mine and names the folder when both change one line", () => {
    const mine = { ...file, folders: [{ ...file.folders[0]!, color: "moss" as const }] };
    const theirs = { ...file, folders: [{ ...file.folders[0]!, color: "rose" as const }] };
    const merged = mergeFolders(file, mine, theirs);
    expect(merged.clashes).toEqual(["03 Gazetteer/Islands"]);
    expect(merged.file.folders[0]!.color).toBe("moss");
  });

  it("takes lines added on either side", () => {
    const mine = { ...file, folders: [...file.folders, { path: "Mine" }] };
    const theirs = { ...file, folders: [...file.folders, { path: "Theirs" }] };
    const merged = mergeLibraryFile(FOLDERS, file, mine, theirs);
    expect(merged.file.folders.map((l) => l.path)).toEqual([
      "03 Gazetteer/Islands",
      "03 Gazetteer/Old Coast",
      "05 Empty",
      "Theirs",
      "Mine",
    ]);
  });
});

describe("order keys", () => {
  const keys = ["1", "8", "V", "Vz", "W", "a", "a1", "aV", "b", "y", "yz", "z", "zz", "zzzz1"];

  it("puts a key between any two keys, and at either end", () => {
    const all: (string | null)[] = [null, ...keys];
    for (const a of all) {
      for (const b of [...keys, null]) {
        if (a !== null && b !== null && a >= b) continue;
        const k = orderBetween(a, b);
        if (a !== null) expect(k > a, `${a} < ${k}`).toBe(true);
        if (b !== null) expect(k < b, `${k} < ${b}`).toBe(true);
        expect(k).toMatch(/^[0-9A-Za-z]*[1-9A-Za-z]$/);
      }
    }
  });

  it("keeps finding room when keys are put after each other or before each other", () => {
    let low: string | null = null;
    let high: string | null = null;
    const made: string[] = [];
    for (let i = 0; i < 50; i++) {
      low = orderBetween(low, null);
      made.push(low);
      high = orderBetween(null, high ?? "1");
      made.push(high);
    }
    expect(new Set(made).size).toBe(100);
    let a = "V";
    const b = "W";
    for (let i = 0; i < 30; i++) {
      const k = orderBetween(a, b);
      expect(k > a && k < b).toBe(true);
      a = k;
    }
  });

  it("refuses keys out of order or not keys at all", () => {
    expect(() => orderBetween("b", "a")).toThrow();
    expect(() => orderBetween("a", "a")).toThrow();
    expect(() => orderBetween("a0", null)).toThrow();
  });

  it("sorts ordered folders first, the rest by name with numbers in order", () => {
    const sorted = sortFolders([
      { name: "Folder 10" },
      { name: "b", order: "k" },
      { name: "Folder 9" },
      { name: "a", order: "V" },
      { name: "c", order: "k" },
    ]);
    expect(sorted.map((f) => f.name)).toEqual(["a", "b", "c", "Folder 9", "Folder 10"]);
  });
});

describe("renames and the table of library files", () => {
  it("moves a folder's line and the lines under it", () => {
    const moved = renameInFolders(file, "03 Gazetteer", "Places");
    expect(moved.folders.map((l) => l.path)).toEqual([
      "Places/Islands",
      "Places/Old Coast",
      "05 Empty",
    ]);
    expect(movedFolderPath("A/B", "A", "C")).toBe("C/B");
    expect(movedFolderPath("AB", "A", "C")).toBeNull();
    expect(movedFolderPath("A", "A", "C")).toBe("C");
  });

  it("finds the folder file by path and by name, and reads a missing one as empty", () => {
    expect(LIBRARY_FILES.map((k) => k.name)).toEqual([
      "folders",
      "map-styles",
      "biomes",
      "pins",
      "trees",
      "types",
    ]);
    expect(libraryFileOf(FOLDER_FILE)?.label).toBe("Folders");
    expect(libraryFileOf(".frontier/maps/abcdefgh.json")).toBeUndefined();
    expect(libraryFileNamed("folders")?.path).toBe(FOLDER_FILE);
    expect(libraryFileNamed("other")).toBeUndefined();
    expect(FOLDERS.empty()).toEqual({ version: 1, folders: [] });
    expect(parseLibraryFile(FOLDERS, serialiseFolders(FOLDERS.empty())).ok).toBe(true);
  });
});
