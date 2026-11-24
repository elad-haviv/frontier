// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { anchorAt } from "../anchor.ts";
import { stack } from "./CommentBubbles.tsx";
import { findSpaced, occurrence, passageRange, plainQuote } from "./passage.ts";

describe("a passage as the page shows it", () => {
  it("leaves out the Markdown marks of its first line", () => {
    expect(plainQuote("## The **old** quay")).toBe("The old quay");
    expect(plainQuote("- [ ] mend the *nets*\n- dry them")).toBe("mend the nets");
    expect(plainQuote("> Built by [[02 People/Mira|Mira]] and [[Oren]]")).toBe(
      "Built by Mira and Oren",
    );
    expect(plainQuote("See [the map](maps/one) and <u>this</u> `code` ~~gone~~")).toBe(
      "See the map and this code gone",
    );
    expect(plainQuote("\n\n1. first   step")).toBe("first step");
    expect(plainQuote("x".repeat(100))).toHaveLength(60);
  });

  it("knows which occurrence of its words a passage is", () => {
    const text = "The quay. Then the quay again. The quay at last.";
    const third = text.lastIndexOf("quay");
    expect(occurrence(text, anchorAt(text, third, third + 4))).toBe(2);
    expect(occurrence(text, { quote: "nowhere", prefix: "", suffix: "" })).toBe(-1);
  });

  it("finds words with spaces counted as one, at the occurrence asked for", () => {
    const text = "a  quay\n\nand a quay";
    expect(findSpaced(text, "a quay", 0)).toBe(0);
    expect(findSpaced(text, "a quay", 1)).toBe(13);
    // An occurrence that is not there falls back to the first.
    expect(findSpaced(text, "a quay", 5)).toBe(0);
    expect(findSpaced(text, "boat", 0)).toBe(-1);
    expect(findSpaced(text, "", 0)).toBe(-1);
  });

  it("gives a range over the passage in the rendered page", () => {
    const root = document.createElement("div");
    root.innerHTML =
      "<h2>Tides</h2>\n<p>The <strong>old</strong> quay floods.</p>\n<p>The quay</p>";
    const text = "## Tides\n\nThe **old** quay floods.\n\nThe quay\n";
    const at = text.indexOf("**old** quay");
    const range = passageRange(root, text, anchorAt(text, at, at + 12));
    expect(range?.startContainer.textContent).toBe("old");
    const last = text.lastIndexOf("quay");
    const second = passageRange(root, text, anchorAt(text, last - 4, last + 4));
    expect(second?.startContainer.parentElement?.outerHTML).toBe("<p>The quay</p>");
    expect(passageRange(root, text, { quote: "a lost line", prefix: "", suffix: "" })).toBeNull();
  });
});

describe("bubbles in the margin", () => {
  it("start level with their passages and never cover one another", () => {
    expect(
      stack([
        { top: 100, height: 40 },
        { top: 0, height: 30 },
        { top: 120, height: 20 },
        { top: 400, height: 20 },
      ]),
    ).toEqual([100, 0, 146, 400]);
  });
});
