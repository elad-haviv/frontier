import { describe, expect, it } from "vitest";
import { findAnchor } from "./anchor.ts";

describe("findAnchor", () => {
  const text =
    "# Title\n\nThe **Nirani** keep  time by [[Vaakh|the pulse]], and “count” days.\n\nThe Nirani rest.";
  it("finds words that read the same, through marks, links, spacing and quotes", () => {
    const a = findAnchor(text, 'the nirani keep time by the pulse, and "count" days');
    expect(a && text.slice(a.from, a.to)).toBe(
      "The **Nirani** keep  time by [[Vaakh|the pulse]], and “count” days",
    );
  });
  it("takes the place nearest where it was when the words occur twice", () => {
    expect(findAnchor(text, "The Nirani", 0)?.from).toBeLessThan(text.indexOf("rest"));
    expect(findAnchor(text, "Nirani", text.length)?.from).toBe(text.lastIndexOf("Nirani"));
  });
  it("is null when the words are gone", () => {
    expect(findAnchor(text, "no such words")).toBeNull();
    expect(findAnchor(text, "   ")).toBeNull();
  });
});
