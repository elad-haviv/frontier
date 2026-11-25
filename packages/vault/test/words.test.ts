import { describe, expect, it } from "vitest";
import { bodyWords, countWords } from "../src/index.js";

describe("words", () => {
  it("counts words, names and numbers", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("The Nirani's 3 moons — o'clock, well-known")).toBe(6);
  });

  it("leaves out frontmatter, headings, comments and embedded pictures", () => {
    const text =
      "---\ntype: place\naliases: [A, B]\n---\n# Title\n\nOne two three.\n\n## Section\n" +
      "<!-- four five -->\n![[pic.png|300]] ![alt](x.png)\nfour\n";
    expect(bodyWords(text)).toBe(4);
  });

  it("counts a link as the words it shows", () => {
    expect(bodyWords("See [[Old Quay]] and [[Mira|the keeper]] and [[Mira#Early life]].")).toBe(8);
    expect(bodyWords("A [good map](Maps/Good.md) here")).toBe(4);
    expect(bodyWords("A [[Table\\|cell]] here")).toBe(3);
  });

  it("counts an entry with no frontmatter as all body", () => {
    expect(bodyWords("just five words right here")).toBe(5);
  });
});
