import { describe, expect, it } from "vitest";
import { openingOf, pictureBrief, plainForPrompt } from "./pictureBrief.ts";

describe("plainForPrompt", () => {
  it("turns links into names and drops marks, embeds and tags", () => {
    expect(
      plainForPrompt(
        "Kept by [[02 People/Mira.md|Mira]] on the **harbor** wall at [[Greywater#Docks]], " +
          "a <u>cracked</u> pane ![[lamp.png]] and [a chart](https://x.y/z).",
      ),
    ).toBe("Kept by Mira on the harbor wall at Greywater, a cracked pane and a chart.");
  });

  it("drops list, quote and heading marks", () => {
    expect(plainForPrompt("> A quote\n- [ ] a task\n1. first\n## Heading")).toBe(
      "A quote a task first Heading",
    );
  });
});

describe("openingOf", () => {
  const text =
    "---\ntype: thing\n---\n# Lantern\n\n![[lamp.png]]\n\n| a | b |\n| - | - |\n\n" +
    "A tin storm lantern, kept by [[Mira]].\nIt is lit on bad nights.\n\nLater paragraph.";

  it("takes the title and the first paragraph of prose", () => {
    expect(openingOf(text, "Lantern")).toBe(
      "Lantern. A tin storm lantern, kept by Mira. It is lit on bad nights.",
    );
  });

  it("does not repeat a title the paragraph starts with", () => {
    expect(openingOf("Lantern is a lamp.", "Lantern")).toBe("Lantern is a lamp.");
  });

  it("is the title alone for an entry with no prose", () => {
    expect(openingOf("# Empty\n\n## Notes\n", "Empty")).toBe("Empty");
  });

  it("cuts a long opening at a sentence", () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const got = openingOf(long, "");
    expect(got.length).toBeLessThanOrEqual(700);
    expect(got.endsWith("here.")).toBe(true);
  });
});

describe("pictureBrief", () => {
  it("gives both the selection and the opening", () => {
    expect(pictureBrief({ text: "Body text.", title: "T", selection: "the [[Mira]]" })).toEqual({
      selection: "the Mira",
      opening: "T. Body text.",
    });
  });
});
