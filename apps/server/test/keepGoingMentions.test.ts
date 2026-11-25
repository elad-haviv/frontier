import { describe, expect, it } from "vitest";
import { firstMention, namesOf, sentenceAround } from "../src/keepGoing/mentions.js";
import { likelyFolder, wantedKey } from "../src/keepGoing/derived.js";

const found = (text: string, names: string[], exact: string[] = []) => {
  const m = firstMention(text, names, new Set(exact));
  return m ? text.slice(m.start, m.end) : null;
};

describe("names of an entry", () => {
  it("is the title, then the other names, each once, none too short", () => {
    expect(
      namesOf({ title: "Mira", aliases: ["The Keeper", "mira", " ", "Mi", "The Keeper"] }),
    ).toEqual(["Mira", "The Keeper"]);
  });
});

describe("a mention that is not linked", () => {
  it("matches whole words in any letter case", () => {
    expect(found("The harbor and the Harbors are far.", ["Harbor"])).toBe("harbor");
    expect(found("Harborside is not it.", ["Harbor"])).toBeNull();
    expect(found("Café Éclair at the café.", ["Café"])).toBe("Café");
    expect(found("pre_Mira and Mira2 and Mira.", ["Mira"])).toBe("Mira");
  });

  it("takes the earliest, and the longest name at the same place", () => {
    expect(found("Alpha Town and Alpha", ["Alpha", "Alpha Town"])).toBe("Alpha Town");
    expect(found("The First came before Alpha.", ["Alpha", "The First"])).toBe("The First");
  });

  it("takes an ordinary word only as the name is written", () => {
    expect(found("water and Water", ["Water"], ["Water"])).toBe("Water");
    expect(found("water only", ["Water"], ["Water"])).toBeNull();
  });

  it("skips frontmatter, code, links, headings, comments and web addresses", () => {
    expect(found("---\ntitle: Mira\n---\nMira here", ["Mira"])).toBe("Mira");
    expect(found("---\ntitle: Mira\n---\nNone.", ["Mira"])).toBeNull();
    expect(found("`Mira` and ```\nMira\n```", ["Mira"])).toBeNull();
    expect(found("[[Mira]] and [Mira](Mira.md) and ![[Mira.png]]", ["Mira"])).toBeNull();
    expect(found("# Mira\n\n## About Mira\n", ["Mira"])).toBeNull();
    expect(found("<!-- Mira -->\nhttps://example.com/Mira here", ["Mira"])).toBeNull();
    expect(found("~~~\n# not a heading Mira\n~~~", ["Mira"])).toBeNull();
    // After the skipped ones, the first real one counts.
    expect(found("`Mira`, [[Mira]], then Mira.", ["Mira"])).toBe("Mira");
  });

  it("escapes characters that mean something in a pattern", () => {
    expect(found("The (Old) Quay (Moon) stands.", ["Quay (Moon)"])).toBe("Quay (Moon)");
    expect(found("Dr. Who? Yes.", ["Dr. Who"])).toBe("Dr. Who");
    expect(found("nothing", [])).toBeNull();
  });
});

describe("the sentence around a span", () => {
  const around = (text: string, name: string) => {
    const at = text.indexOf(name);
    return sentenceAround(text, at, at + name.length);
  };

  it("is the sentence the span is in, with where the span lies in it", () => {
    const r = around("First one. The road to Alpha is long. Last.", "Alpha");
    expect(r.sentence).toBe("The road to Alpha is long.");
    expect(r.sentence.slice(...r.at)).toBe("Alpha");
  });

  it("stops at the end of a line, and drops the marks of a list, a quote and a table", () => {
    expect(around("Intro\n- Alpha is here\nNext", "Alpha").sentence).toBe("Alpha is here");
    expect(around("> Alpha, quoted. More", "Alpha").sentence).toBe("Alpha, quoted.");
    expect(around("3. Third Alpha item", "Alpha").sentence).toBe("Third Alpha item");
    expect(around("| Alpha | note |", "Alpha").sentence).toBe("Alpha | note |");
  });

  it("takes a sentence at the start and the end of the text whole", () => {
    expect(around("Alpha", "Alpha")).toEqual({ sentence: "Alpha", at: [0, 5] });
    expect(around("Dr. Smith saw Alpha!", "Alpha").sentence).toBe("Smith saw Alpha!");
  });

  it("shortens a long sentence around the name", () => {
    const long = `${"before ".repeat(60)}Alpha${" after".repeat(60)}.`;
    const r = around(long, "Alpha");
    expect(r.sentence.length).toBeLessThan(300);
    expect(r.sentence.startsWith("… ")).toBe(true);
    expect(r.sentence.endsWith(" …")).toBe(true);
    expect(r.sentence.slice(...r.at)).toBe("Alpha");
    const early = around(`Alpha ${"after ".repeat(80)}.`, "Alpha");
    expect(early.sentence.startsWith("Alpha")).toBe(true);
    expect(early.sentence.endsWith(" …")).toBe(true);
    expect(early.sentence.slice(...early.at)).toBe("Alpha");
    const late = around(`${"before ".repeat(80)}Alpha.`, "Alpha");
    expect(late.sentence.startsWith("… ")).toBe(true);
    expect(late.sentence.endsWith("Alpha.")).toBe(true);
    expect(late.sentence.slice(...late.at)).toBe("Alpha");
  });
});

describe("wanted names", () => {
  it("keys a name by its last part, without .md, in lower case", () => {
    expect(wantedKey("Missing One")).toBe("missing one");
    expect(wantedKey(" Folder/Sub/Name.md ")).toBe("name");
    expect(wantedKey("")).toBe("");
  });

  it("suggests the folder most of the mentioning entries are in, never an appendix", () => {
    expect(likelyFolder(["A/x.md", "B/y.md", "A/z.md"])).toBe("A");
    expect(likelyFolder(["B/x.md", "A/y.md"])).toBe("A");
    expect(likelyFolder(["99 Appendices/x.md", "Root.md"])).toBeNull();
    expect(likelyFolder([])).toBeNull();
  });
});
