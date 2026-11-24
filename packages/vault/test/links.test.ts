import { describe, expect, it } from "vitest";
import { codeRanges, findLinks, type MarkdownLink, type WikiLink } from "../src/index.js";
import { fixture } from "./helpers.js";

const wiki = (text: string) => findLinks(text).filter((l): l is WikiLink => l.kind === "wikilink");
const md = (text: string) => findLinks(text).filter((l): l is MarkdownLink => l.kind === "mdlink");

describe("wikilinks", () => {
  it("reads target, heading and display text with exact positions", () => {
    const text = "See [[Harbor#History|its past]] now.";
    const [l] = wiki(text);
    expect(l).toMatchObject({
      embed: false,
      raw: "[[Harbor#History|its past]]",
      target: "Harbor",
      heading: "History",
      display: "its past",
      width: null,
    });
    expect(text.slice(l!.start, l!.end)).toBe(l!.raw);
    expect(text.slice(l!.targetStart, l!.targetEnd)).toBe("Harbor");
  });

  it("reads every form in the fixture note", () => {
    const links = wiki(fixture("01 Places/Harbor/Old Quay.md"));
    expect(links.map((l) => l.raw)).toEqual([
      "[[Harbor]]",
      "[[Harbor|the port]]",
      "[[Harbor#History]]",
      "[[Harbor#History|its past]]",
      "[[#Tides]]",
      "[[ Harbor]]",
      "[[harbor]]",
      "[[Harbor#Tides]]",
    ]);
    const same = links[4]!;
    expect(same.target).toBe("");
    expect(same.heading).toBe("Tides");
    expect(links[5]!.target).toBe(" Harbor");
  });

  it("reads embeds and a width", () => {
    const links = wiki(fixture("03 Things/Gallery.md"));
    expect(links.map((l) => [l.raw, l.embed, l.width])).toEqual([
      ["![[photo.png]]", true, null],
      ["![[photo.png|200]]", true, 200],
      ["![[lamp.png]]", true, null],
      ["![[map one.png]]", true, null],
      ["![[nothing.png]]", true, null],
    ]);
    expect(wiki("![[a.png|300x200]]")[0]!.width).toBe(300);
    expect(wiki("![[a.png|caption]]")[0]!.width).toBeNull();
    expect(wiki("[[Note|200]]")[0]!.width).toBeNull();
  });

  it("treats an escaped pipe in a table cell as the separator", () => {
    const links = wiki(fixture("03 Things/Ledger.md"));
    const rope = links.find((l) => l.raw.includes("Rope"))!;
    expect(rope.target).toBe("Rope");
    expect(rope.display).toBe("a rope");
  });

  it("finds links inside frontmatter text", () => {
    const text = '---\nwhen: "after [[The Flood]], within a year"\n---\nbody\n';
    expect(wiki(text).map((l) => l.target)).toEqual(["The Flood"]);
  });

  it("does not span lines or nested brackets", () => {
    expect(wiki("[[a\nb]]")).toEqual([]);
    expect(wiki("[[]]")).toEqual([]);
    expect(wiki("[[a]] and [[b]]").map((l) => l.target)).toEqual(["a", "b"]);
  });
});

describe("code is not linked", () => {
  it("skips inline code and fenced blocks", () => {
    const text = fixture("01 Places/Harbor/Old Quay.md");
    const raws = findLinks(text).map((l) => text.slice(0, l.start).split("\n").length);
    // Line 7 holds the inline code, lines 9-11 the fenced block.
    expect(raws.filter((line) => line === 7 || (line >= 9 && line <= 11))).toEqual([]);
  });

  it("handles runs of backticks, unclosed spans and unclosed fences", () => {
    expect(wiki("``[[a]] ` [[b]]`` [[c]]").map((l) => l.target)).toEqual(["c"]);
    expect(wiki("` [[a]] with no close").map((l) => l.target)).toEqual(["a"]);
    expect(wiki("`one\n\n[[a]]` two").map((l) => l.target)).toEqual(["a"]);
    expect(wiki("[[a]]\n```\n[[b]]\n").map((l) => l.target)).toEqual(["a"]);
    expect(wiki("~~~\n[[b]]\n```\n[[c]]\n~~~\n[[d]]").map((l) => l.target)).toEqual(["d"]);
    expect(wiki("```` \n[[b]]\n```\n[[c]]\n````\n[[d]]").map((l) => l.target)).toEqual(["d"]);
    expect(wiki("a ``x`y`` [[k]] `z`").map((l) => l.target)).toEqual(["k"]);
    expect(wiki("```x``` ` [[m]] `").map((l) => l.target)).toEqual([]);
  });

  it("reports ranges in order", () => {
    const ranges = codeRanges("`a` text\n```\nblock\n```\n`b`");
    expect(ranges.map(([a]) => a)).toEqual([...ranges.map(([a]) => a)].sort((x, y) => x - y));
    expect(ranges).toHaveLength(3);
    expect(codeRanges("no code")).toEqual([]);
  });
});

describe("standard Markdown links", () => {
  it("reads a relative link and decodes URL escapes", () => {
    const links = md(fixture("01 Places/Harbor/Old Quay.md"));
    expect(links.map((l) => [l.display, l.target, l.embed, l.angle])).toEqual([
      ["Harbor", "Harbor.md", false, false],
      ["Mira", "../../02 People/Mira.md", false, false],
    ]);
    const text = fixture("01 Places/Harbor/Old Quay.md");
    const mira = links[1]!;
    expect(text.slice(mira.targetStart, mira.targetEnd)).toBe("../../02%20People/Mira.md");
  });

  it("reads an image with an angle-bracket path", () => {
    const text = fixture("03 Things/Gallery.md");
    const [first] = md(text);
    expect(first).toMatchObject({
      embed: true,
      angle: true,
      target: "../99 Appendices/Images/map one.png",
    });
    expect(text.slice(first!.targetStart, first!.targetEnd)).toBe(
      "../99 Appendices/Images/map one.png",
    );
  });

  it("leaves web addresses, anchors and empty destinations alone", () => {
    expect(
      md("[a](https://example.com/x) [b](#top) [c](mailto:x@y.z) [d](//host/x) [e](<>)"),
    ).toEqual([]);
  });

  it("separates a heading and keeps a bad escape as written", () => {
    const [l] = md("[x](Notes/A%20B.md#Part%20One)");
    expect(l).toMatchObject({ target: "Notes/A B.md", heading: "Part One" });
    expect(md("[x](bad%zz.md)")[0]!.target).toBe("bad%zz.md");
    expect(md("[x](<a b.md#Part One>)")[0]).toMatchObject({
      target: "a b.md",
      heading: "Part One",
    });
  });

  it("allows brackets in a path and a title after it", () => {
    expect(md('[x](Folder%20(old)/A.md "title")')[0]!.target).toBe("Folder (old)/A.md");
  });

  it("returns links in the order they appear", () => {
    const links = findLinks("[a](x.md) then [[b]] then ![c](y.png)");
    expect(links.map((l) => l.kind)).toEqual(["mdlink", "wikilink", "mdlink"]);
  });
});
