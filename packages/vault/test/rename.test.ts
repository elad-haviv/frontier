import { describe, expect, it } from "vitest";
import { folderNoteOf, planRename, RenameError } from "../src/index.js";
import { changedLines, fixture, fixtureFiles } from "./helpers.js";

const files = fixtureFiles();
const plan = (from: string, to: string) => planRename(from, to, files, fixture);

/** For each edited note, the lines that changed, as "before -> after". */
function diff(p: ReturnType<typeof plan>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of p.edits) {
    const { removed, added } = changedLines(fixture(e.path), e.text);
    out[e.path] = removed.map((line, i) => `${line} -> ${added[i] ?? ""}`);
  }
  return out;
}

describe("renaming a note", () => {
  const p = plan("02 People/Mira.md", "02 People/Mira Vale.md");

  it("moves the one file", () => {
    expect(p.moves).toEqual([{ from: "02 People/Mira.md", to: "02 People/Mira Vale.md" }]);
  });

  it("rewrites bare links, keeping display text and table escapes", () => {
    const d = diff(p);
    expect(d["01 Places/Harbor/Harbor.md"]).toEqual([
      "A town on the grey water. See [[Old Quay]] and [[Mira]]. -> A town on the grey water. See [[Old Quay]] and [[Mira Vale]].",
    ]);
    expect(d["02 People/Shade.md"]).toEqual([
      "A quiet figure. Friend of [[Mira]]. -> A quiet figure. Friend of [[Mira Vale]].",
    ]);
    expect(d["03 Things/Ledger.md"]).toEqual([
      "| [[Lantern]] | [[Mira]] | -> | [[Lantern]] | [[Mira Vale]] |",
    ]);
  });

  it("rewrites a standard Markdown link, keeping its URL escapes", () => {
    expect(diff(p)["01 Places/Harbor/Old Quay.md"]).toEqual([
      "A plain link: [Harbor](Harbor.md) and one with spaces: [Mira](../../02%20People/Mira.md). -> A plain link: [Harbor](Harbor.md) and one with spaces: [Mira](../../02%20People/Mira%20Vale.md).",
    ]);
  });

  it("touches nothing else", () => {
    expect(Object.keys(diff(p)).sort()).toEqual([
      "01 Places/Harbor/Harbor.md",
      "01 Places/Harbor/Old Quay.md",
      "02 People/Shade.md",
      "03 Things/Ledger.md",
    ]);
    expect(p.leftAsWritten).toEqual([]);
  });
});

describe("renaming a note that appendix files link to", () => {
  const p = plan("01 Places/Harbor/Old Quay.md", "01 Places/Harbor/New Quay.md");

  it("rewrites editable notes, including a path written with its last folders", () => {
    const d = diff(p);
    expect(d["02 People/Mira.md"]).toEqual([
      "Short path: [[Harbor/Old Quay]]. -> Short path: [[01 Places/Harbor/New Quay]].",
    ]);
    expect(d["03 Things/Rope.md"]).toEqual([
      "Tied at the [[Old Quay]].\r -> Tied at the [[New Quay]].\r",
    ]);
  });

  it("leaves append-only files as written and reports them", () => {
    expect(p.edits.some((e) => e.path.startsWith("99 Appendices/"))).toBe(false);
    expect(p.leftAsWritten).toEqual([
      { path: "99 Appendices/Logs/Session.md", raw: "[[Old Quay]]" },
    ]);
  });

  it("does not rewrite the renamed note's own same-note heading link", () => {
    expect(p.edits.some((e) => e.path === "01 Places/Harbor/Old Quay.md")).toBe(false);
  });
});

describe("moving a note to another folder", () => {
  const p = plan("01 Places/Harbor/Old Quay.md", "03 Things/Old Quay.md");

  it("keeps bare links, which still resolve, and fixes path links", () => {
    const d = diff(p);
    expect(d["01 Places/Harbor/Harbor.md"]).toBeUndefined();
    expect(d["02 People/Mira.md"]).toEqual([
      "Short path: [[Harbor/Old Quay]]. -> Short path: [[03 Things/Old Quay]].",
    ]);
  });

  it("fixes the moved note's own relative links", () => {
    expect(diff(p)["01 Places/Harbor/Old Quay.md"]).toEqual([
      "A plain link: [Harbor](Harbor.md) and one with spaces: [Mira](../../02%20People/Mira.md). -> A plain link: [Harbor](../01%20Places/Harbor/Harbor.md) and one with spaces: [Mira](../02%20People/Mira.md).",
    ]);
  });
});

describe("renaming a folder", () => {
  const p = plan("01 Places/Harbor", "01 Places/Port");

  it("moves every file and renames the folder note with it", () => {
    expect(p.moves).toEqual([
      { from: "01 Places/Harbor/Harbor.md", to: "01 Places/Port/Port.md" },
      { from: "01 Places/Harbor/Old Quay.md", to: "01 Places/Port/Old Quay.md" },
    ]);
    expect(folderNoteOf("01 Places/Harbor/", files)).toBe("01 Places/Harbor/Harbor.md");
    expect(folderNoteOf("01 Places/Marsh", files)).toBeNull();
  });

  it("rewrites links by name, by path, with .md, with a heading and inside frontmatter-free tables", () => {
    const d = diff(p);
    expect(d["02 People/Mira.md"]).toEqual([
      "Lives at [[01 Places/Harbor/Harbor]]. Also written [[01 Places/Harbor/Harbor.md]] and [[01 places/harbor/HARBOR]]. -> Lives at [[01 Places/Port/Port]]. Also written [[01 Places/Port/Port.md]] and [[01 Places/Port/Port]].",
      "Short path: [[Harbor/Old Quay]]. -> Short path: [[01 Places/Port/Old Quay]].",
    ]);
    expect(d["01 Places/Marsh/The Marsh.md"]).toEqual([
      "Wet ground north of [[Harbor]]. -> Wet ground north of [[Port]].",
    ]);
    expect(d["03 Things/Lantern.md"]).toEqual([
      "Carried by [[Twin]] at the [[Harbor]].\r -> Carried by [[Twin]] at the [[Port]].\r",
    ]);
    expect(d["01 Places/Harbor/Old Quay.md"]?.[0]).toBe(
      "Part of [[Harbor]], also called [[Harbor|the port]]. -> Part of [[Port]], also called [[Port|the port]].",
    );
    expect(d["01 Places/Harbor/Old Quay.md"]).toContain(
      "Its past: [[Harbor#History]] and [[Harbor#History|its past]]. -> Its past: [[Port#History]] and [[Port#History|its past]].",
    );
    expect(d["README.md"]).toEqual([
      "Made-up content for tests. Start at [Harbor](01%20Places/Harbor/Harbor.md) or read [the rules](AGENTS.md). -> Made-up content for tests. Start at [Harbor](01%20Places/Port/Port.md) or read [the rules](AGENTS.md).",
    ]);
  });

  it("reports the appendix links it left alone", () => {
    expect(p.leftAsWritten).toEqual([
      { path: "99 Appendices/Logs/Session.md", raw: "[[Harbor]]" },
      { path: "99 Appendices/Logs/Session.md", raw: "[[01 Places/Harbor/Harbor.md]]" },
    ]);
    // "[[Old Quay]]" in the log still resolves by name after the folder moves, so it is not reported.
  });

  it("moves a folder without renaming it and leaves bare links alone", () => {
    const moved = plan("01 Places/Marsh", "03 Things/Marsh");
    expect(moved.moves).toEqual([
      { from: "01 Places/Marsh/The Marsh.md", to: "03 Things/Marsh/The Marsh.md" },
    ]);
    expect(moved.edits).toEqual([]);
  });
});

describe("names that collide after the rename", () => {
  it("writes the full path when the new name is shared with another note", () => {
    const p = plan("02 People/Mira.md", "02 People/Lantern.md");
    expect(diff(p)["02 People/Shade.md"]).toEqual([
      "A quiet figure. Friend of [[Mira]]. -> A quiet figure. Friend of [[02 People/Lantern]].",
    ]);
  });

  it("uses the bare name again when the rename ends a collision", () => {
    const p = plan("03 Things/Twin.md", "03 Things/Token.md");
    // "[[Twin]]" was ambiguous before, so no link pointed at this note and nothing is rewritten.
    expect(p.edits).toEqual([]);
  });
});

describe("renaming an image", () => {
  it("rewrites embeds by name and by relative path", () => {
    const local = ["a/Note.md", "img/old pic.png", "img/other.png"];
    const text =
      "![[old pic.png]] ![[old pic.png|120]] ![x](<../img/old pic.png>) ![y](../img/old%20pic.png) ![[img/old pic.png]]";
    const p = planRename("img/old pic.png", "art/new pic.png", local, () => text);
    expect(p.edits[0]!.text).toBe(
      "![[new pic.png]] ![[new pic.png|120]] ![x](<../art/new pic.png>) ![y](../art/new%20pic.png) ![[art/new pic.png]]",
    );
  });

  it("writes the path when the new image name already exists elsewhere", () => {
    const local = ["a/Note.md", "img/one.png", "other/two.png"];
    const p = planRename("img/one.png", "img/two.png", local, () => "![[one.png]]");
    expect(p.edits[0]!.text).toBe("![[img/two.png]]");
  });
});

describe("links written from the vault root", () => {
  it("keeps a leading slash and drops .md only when it was not written", () => {
    const local = ["a/Note.md", "b/Target.md"];
    const p = planRename("b/Target.md", "c/Goal.md", local, (path) =>
      path === "a/Note.md" ? "[x](/b/Target.md) [y](../b/Target) [[b/Target.md#Part|shown]]" : "",
    );
    expect(p.edits[0]!.text).toBe("[x](/c/Goal.md) [y](../c/Goal) [[c/Goal.md#Part|shown]]");
  });
});

describe("refusals", () => {
  it("refuses a rename to the same path, an empty path, or a missing source", () => {
    expect(() => plan("02 People/Mira.md", "02 People/Mira.md")).toThrow(RenameError);
    expect(() => plan("02 People/Mira.md", "")).toThrow(/missing/);
    expect(() => plan("", "x.md")).toThrow(/missing/);
    expect(() => plan("02 People/Nobody.md", "02 People/Somebody.md")).toThrow(/Nothing exists/);
  });

  it("refuses to overwrite an existing file, ignoring case", () => {
    expect(() => plan("02 People/Mira.md", "02 People/shade.md")).toThrow(/already exists/);
  });

  it("refuses to move append-only or excluded files", () => {
    expect(() => plan("99 Appendices/Logs/Session.md", "99 Appendices/Logs/Old.md")).toThrow(
      /append-only/,
    );
    expect(() => plan("99 Appendices/Logs", "Logs")).toThrow(/append-only/);
    expect(() => plan(".obsidian/app.json", "app.json")).toThrow(/append-only or excluded/);
  });

  it("refuses to change a file's extension", () => {
    expect(() => plan("02 People/Mira.md", "02 People/Mira.txt")).toThrow(/extension/);
  });

  it("allows a change of letter case only", () => {
    const p = plan("02 People/Mira.md", "02 People/MIRA.md");
    expect(p.moves).toEqual([{ from: "02 People/Mira.md", to: "02 People/MIRA.md" }]);
    expect(diff(p)["02 People/Shade.md"]).toEqual([
      "A quiet figure. Friend of [[Mira]]. -> A quiet figure. Friend of [[MIRA]].",
    ]);
  });
});
