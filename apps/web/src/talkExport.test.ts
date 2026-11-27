import { describe, expect, it } from "vitest";
import { momentText, talkMarkdown } from "./talkExport.ts";

describe("exporting a conversation with a character", () => {
  it("writes who said what, with each line's sources or that it was improvised", () => {
    const text = talkMarkdown("Shade", {
      id: "abcdefghijkl",
      entry: "shade001",
      at: "2026-11-26T10:00:00.000Z",
      updatedAt: "2026-11-26T10:05:00.000Z",
      moment: { words: "the night of the fire", year: 412 },
      lines: [
        { who: "author", text: "Who are your friends?" },
        {
          who: "character",
          text: "Mira, and no one else.",
          sources: ["02 People/Shade.md"],
          quotes: [],
          improvised: false,
          kept: false,
        },
        {
          who: "character",
          text: "I had a dog once.",
          sources: [],
          quotes: [],
          improvised: true,
          kept: true,
        },
      ],
    });
    expect(text).toContain("# Talk with Shade");
    expect(text).toContain("Speaking from the night of the fire (412). Begun 2026-11-26.");
    expect(text).toContain("**You:** Who are your friends?");
    expect(text).toContain("**Shade:** Mira, and no one else.\n\n*From Shade*");
    expect(text).toContain("*Improvised: nothing in the entries says this.*");
  });

  it("names a moment with no words or year", () => {
    expect(momentText({ words: "", year: null })).toBe("a moment not named");
  });
});
