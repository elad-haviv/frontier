import { describe, expect, it } from "vitest";
import type { TreeResponse } from "@frontier/schema";
import {
  eachFolder,
  entriesIn,
  entriesUnder,
  findFolder,
  foldersUnder,
  libraryPath,
  placeAt,
  rowsOf,
  shownPath,
  withFolderFile,
} from "./model.ts";

const note = (path: string, extra = {}) => ({
  path,
  title: path,
  state: "published" as const,
  ...extra,
});

const tree: TreeResponse = {
  folders: [
    {
      path: "01 Places",
      notes: [note("01 Places/Unwritten.md")],
      folders: [
        {
          path: "01 Places/Harbor",
          notes: [note("01 Places/Harbor/Harbor.md"), note("01 Places/Harbor/Old Quay.md")],
          folders: [],
        },
        { path: "01 Places/Marsh", notes: [note("01 Places/Marsh/The Marsh.md")], folders: [] },
      ],
    },
    {
      path: "Islands",
      moved: "02 Isles",
      renameId: "aaaaaaaaaaaa",
      notes: [note("Islands/Rock.md", { moved: "02 Isles/Rock.md" })],
      folders: [{ path: "Islands/Deep", notes: [], folders: [], empty: true }],
    },
  ],
  notes: [note("README.md")],
};

describe("the tree's rows", () => {
  it("lists folders before entries, opens a folder's own note from its name, and links moved entries where they are", () => {
    const rows = rowsOf(tree);
    expect(rows.map((r) => r.id)).toEqual(["f:01 Places", "f:Islands", "n:README.md"]);
    const harbor = rows[0]!.children!.find((r) => r.name === "Harbor")!;
    expect(harbor.own?.path).toBe("01 Places/Harbor/Harbor.md");
    expect(harbor.children!.map((r) => r.name)).toEqual(["Old Quay"]);
    const islands = rows[1]!;
    expect(islands.children!.map((r) => [r.id, r.inMoved])).toEqual([
      ["f:Islands/Deep", true],
      ["n:02 Isles/Rock.md", undefined],
    ]);
  });

  it("counts what a folder holds and finds folders by path", () => {
    const places = findFolder(tree, "01 Places")!;
    expect(entriesUnder(places)).toBe(4);
    expect(foldersUnder(places)).toBe(2);
    expect(entriesIn(tree)).toBe(
      tree.notes.length + tree.folders.reduce((n, f) => n + entriesUnder(f), 0),
    );
    expect(entriesIn({ folders: [], notes: [] })).toBe(0);
    expect(findFolder(tree, "01 Places/Marsh")?.path).toBe("01 Places/Marsh");
    expect(findFolder(tree, "Nowhere")).toBeUndefined();
    expect(eachFolder(tree).map((f) => f.path)).toEqual([
      "01 Places",
      "01 Places/Harbor",
      "01 Places/Marsh",
      "Islands",
      "Islands/Deep",
    ]);
  });
});

describe("this device's folder file over the server's tree", () => {
  it("adds new lines as empty folders, shows icons and order, and drops an empty folder whose line went", () => {
    const shown = withFolderFile(tree, {
      version: 1,
      folders: [
        { path: "01 Places/Marsh", icon: "waves", color: "sea", order: "V" },
        { path: "01 Places/New/Deeper" },
        // A line kept at the library path of a moved folder shows where the folder goes.
        { path: "02 Isles", color: "rose" },
      ],
    });
    const marsh = findFolder(shown, "01 Places/Marsh")!;
    expect(marsh).toMatchObject({ icon: "waves", color: "sea", order: "V", unpublished: true });
    expect(findFolder(shown, "01 Places/New/Deeper")).toMatchObject({ empty: true });
    expect(findFolder(shown, "Islands")).toMatchObject({ color: "rose" });
    expect(findFolder(shown, "02 Isles")).toBeUndefined();
    // Islands/Deep was empty and has no line here: it goes.
    expect(findFolder(shown, "Islands/Deep")).toBeUndefined();
    // Marsh now has an order, so it comes before Harbor.
    expect(rowsOf(shown)[0]!.children!.map((r) => r.name)).toEqual([
      "Marsh",
      "Harbor",
      "New",
      "Unwritten",
    ]);
    expect(withFolderFile(tree, null)).toBe(tree);
  });

  it("turns shown paths into library paths and back", () => {
    const renames = [{ from: "02 Isles", to: "Islands" }];
    expect(shownPath("02 Isles/Deep", renames)).toBe("Islands/Deep");
    expect(libraryPath("Islands/Deep", renames)).toBe("02 Isles/Deep");
    expect(libraryPath("Other", renames)).toBe("Other");
  });
});

describe("placing a folder among its siblings", () => {
  it("changes one key when the siblings have keys", () => {
    const keys = placeAt(
      [
        { path: "A", order: "V" },
        { path: "B", order: "k" },
      ],
      1,
      "C",
    );
    expect([...keys.keys()]).toEqual(["C"]);
    const c = keys.get("C")!;
    expect(c > "V" && c < "k").toBe(true);
    expect(placeAt([{ path: "A", order: "V" }], 0, "C").get("C")! < "V").toBe(true);
  });

  it("gives keys to the folders before it when they had none", () => {
    const keys = placeAt([{ path: "A" }, { path: "B" }, { path: "D" }], 2, "C");
    expect([...keys.keys()]).toEqual(["A", "B", "C"]);
    expect(keys.get("A")! < keys.get("B")! && keys.get("B")! < keys.get("C")!).toBe(true);
    expect(placeAt([{ path: "A" }], 0, "C")).toEqual(new Map([["C", "V"]]));
  });
});
