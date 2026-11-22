import { describe, expect, it } from "vitest";
import { anchorAt, locate } from "./anchor.ts";

describe("finding a commented passage again", () => {
  const text = "# Road\n\nThe toll is salt.\n\nLater: the toll is salt.\n";

  it("finds it after the text before it changed", () => {
    const from = text.indexOf("The toll");
    const a = anchorAt(text, from, from + "The toll is salt.".length);
    const changed = "# Road\n\nA new opening line.\n\n" + text.slice(8);
    const at = locate(changed, a)!;
    expect(changed.slice(at.from, at.to)).toBe("The toll is salt.");
    expect(at.from).toBe(changed.indexOf("The toll"));
  });

  it("tells a repeated passage apart by the text around it", () => {
    const from = text.lastIndexOf("the toll is salt.");
    const a = anchorAt(text, from, from + "the toll is salt.".length);
    // Both lowercase now: only the surroundings decide.
    const both = text.replace("The toll", "the toll");
    expect(locate(both, a)!.from).toBe(both.lastIndexOf("the toll"));
  });

  it("gives null when the passage is gone", () => {
    const a = anchorAt(text, 8, 25);
    expect(locate("# Road\n\nAll different now.\n", a)).toBeNull();
  });

  it("does not take the same short words elsewhere once the passage was rewritten", () => {
    const t = "Kael drew his sword at dawn.\n\nLater, Kael slept.\n";
    const a = anchorAt(t, 0, 4);
    expect(locate(t, a)).toEqual({ from: 0, to: 4 });
    const rewritten = "At dawn the sword came out.\n\nLater, Kael slept.\n";
    expect(locate(rewritten, a)).toBeNull();
  });

  it("takes a long passage that occurs once even when all around it changed", () => {
    const quote = "The toll on the Long Road is paid in salt, always.";
    const a = anchorAt(`Before.\n\n${quote}\n\nAfter.`, 9, 9 + quote.length);
    const moved = `Something else entirely.\n${quote}`;
    expect(locate(moved, a)).toEqual({ from: 25, to: 25 + quote.length });
  });

  it("refuses passages too short to find again", () => {
    expect(locate("a b c", { quote: "a ", prefix: "", suffix: "" })).toBeNull();
  });
});
