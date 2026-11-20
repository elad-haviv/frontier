import { describe, expect, it } from "vitest";
import { extractHeadings, findHeading, headingKey } from "../src/index.js";
import { fixture } from "./helpers.js";

describe("headings", () => {
  it("lists headings with level and line, after frontmatter", () => {
    expect(extractHeadings(fixture("01 Places/Harbor/Harbor.md"))).toEqual([
      { level: 1, text: "Harbor", line: 6 },
      { level: 2, text: "History", line: 10 },
      { level: 2, text: "Tides", line: 14 },
    ]);
  });

  it("works on Windows line endings", () => {
    expect(extractHeadings(fixture("03 Things/Lantern.md"))).toEqual([
      { level: 1, text: "Lantern", line: 5 },
    ]);
  });

  it("skips headings inside fenced code and handles closing marks", () => {
    const text =
      "# One\n```\n# not a heading\n```\n~~~~\n## nor this\n~~~\nstill code\n~~~~\n## Two ##\n#NotAHeading\n";
    expect(extractHeadings(text).map((h) => h.text)).toEqual(["One", "Two"]);
  });

  it("keeps reading when a different fence mark appears inside a block", () => {
    const text = "```\n~~~\n# hidden\n```\n# Shown\n";
    expect(extractHeadings(text).map((h) => h.text)).toEqual(["Shown"]);
  });

  it("finds a heading ignoring case and spacing", () => {
    const hs = extractHeadings("# The  Long   Road\n");
    expect(headingKey("  the long road ")).toBe("the long road");
    expect(findHeading(hs, "the long road")?.line).toBe(1);
    expect(findHeading(hs, "missing")).toBeUndefined();
  });
});
