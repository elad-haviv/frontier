import { describe, expect, it } from "vitest";
import { detectLineEnding, normaliseLineEndings, restoreLineEndings } from "../src/index.js";
import { changedLines, fixture, fixtureFiles } from "./helpers.js";

describe("line endings", () => {
  it("detects each kind", () => {
    expect(detectLineEnding("a\nb\n")).toBe("lf");
    expect(detectLineEnding("a\r\nb\r\n")).toBe("crlf");
    expect(detectLineEnding("a\r\nb\n")).toBe("mixed");
    expect(detectLineEnding("no break")).toBe("lf");
    expect(detectLineEnding("\nstarts with a break")).toBe("lf");
  });

  it("detects the fixture files", () => {
    expect(detectLineEnding(fixture("03 Things/Rope.md"))).toBe("crlf");
    expect(detectLineEnding(fixture("03 Things/Lantern.md"))).toBe("crlf");
    expect(detectLineEnding(fixture("03 Things/Knot.md"))).toBe("mixed");
    expect(detectLineEnding(fixture("02 People/Mira.md"))).toBe("lf");
  });

  it("normalises and restores every fixture note byte for byte", () => {
    for (const path of fixtureFiles().filter((p) => p.endsWith(".md"))) {
      const raw = fixture(path);
      const kind = detectLineEnding(raw);
      if (kind === "mixed") continue;
      expect(restoreLineEndings(normaliseLineEndings(raw), kind), path).toBe(raw);
    }
  });

  it("gives a one-line difference for a one-character edit to a Windows file", () => {
    const raw = fixture("03 Things/Rope.md");
    const edited = normaliseLineEndings(raw).replace("Second line.", "Second line!");
    const saved = restoreLineEndings(edited, "crlf");
    const { removed, added } = changedLines(raw, saved);
    expect(removed).toEqual(["Second line.\r"]);
    expect(added).toEqual(["Second line!\r"]);
  });

  it("does not double a Windows ending that is already there", () => {
    expect(restoreLineEndings("a\r\nb\n", "crlf")).toBe("a\r\nb\r\n");
  });

  it("refuses to save a file with mixed endings", () => {
    expect(() => restoreLineEndings("a\nb\n", "mixed")).toThrow(/read-only/);
  });
});
