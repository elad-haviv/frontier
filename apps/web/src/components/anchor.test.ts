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
});
