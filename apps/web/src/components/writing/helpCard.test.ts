import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { wordChanges } from "../Diff.tsx";
import { closeHelp, focusHelp, helpField, openHelp, passageOf } from "./helpCard.ts";

const TEXT =
  "# Harbor\n\nThe bells ring at dawn.\nThe fishers listen.\n\n## Tides\n\nHigh at noon.";

function opened(from: number, to: number) {
  const state = EditorState.create({ doc: TEXT, extensions: [helpField] });
  return state.update({ effects: openHelp.of({ from, to }) }).state;
}

describe("the passage writing help works on", () => {
  it("is the selection, or else the cursor's paragraph, which stops at headings", () => {
    const at = (anchor: number, head = anchor) =>
      passageOf(EditorState.create({ doc: TEXT, selection: { anchor, head } })).text;
    expect(at(TEXT.indexOf("bells"), TEXT.indexOf(" at dawn"))).toBe("bells ring");
    expect(at(TEXT.indexOf("fishers"))).toBe("The bells ring at dawn.\nThe fishers listen.");
    expect(at(TEXT.indexOf("Tides"))).toBe("## Tides");
    expect(at(TEXT.indexOf("\n\n## Tides") + 1)).toBe("");
  });
});

describe("the help field", () => {
  const from = TEXT.indexOf("The bells");
  const to = TEXT.indexOf("listen.") + "listen.".length;

  it("moves the passage with text typed before it, and keeps typing at its edges outside", () => {
    let state = opened(from, to);
    state = state.update({ changes: { from: 0, insert: "Intro. " } }).state;
    const moved = state.field(helpField)!;
    expect(state.sliceDoc(moved.from, moved.to)).toBe(
      "The bells ring at dawn.\nThe fishers listen.",
    );
    state = state.update({ changes: { from: moved.to, insert: " More." } }).state;
    state = state.update({ changes: { from: moved.from, insert: "So: " } }).state;
    const edged = state.field(helpField)!;
    expect(state.sliceDoc(edged.from, edged.to)).toBe(
      "The bells ring at dawn.\nThe fishers listen.",
    );
  });

  it("takes in text typed inside the passage, and closes when it is deleted whole", () => {
    let state = opened(from, to);
    const inside = TEXT.indexOf("ring");
    state = state.update({ changes: { from: inside, insert: "loudly " } }).state;
    const grown = state.field(helpField)!;
    expect(state.sliceDoc(grown.from, grown.to)).toContain("bells loudly ring");
    state = state.update({ changes: { from: grown.from, to: grown.to } }).state;
    expect(state.field(helpField)).toBeNull();
  });

  it("starts afresh each time it opens, counts asks for the focus, and closes", () => {
    let state = opened(from, to);
    const first = state.field(helpField)!;
    state = state.update({ effects: focusHelp.of(null) }).state;
    expect(state.field(helpField)!.focus).toBe(1);
    state = state.update({ effects: openHelp.of({ from, to }) }).state;
    expect(state.field(helpField)!.id).toBeGreaterThan(first.id);
    expect(state.field(helpField)!.focus).toBe(0);
    state = state.update({ effects: closeHelp.of(null) }).state;
    expect(state.field(helpField)).toBeNull();
  });
});

describe("word changes", () => {
  it("marks words taken out and put in, and the share that changed", () => {
    const few = wordChanges("The bells ring at dawn.", "The bells rang at dawn.");
    expect(few.parts.filter((p) => p.kind === "del").map((p) => p.text)).toEqual(["ring"]);
    expect(few.parts.filter((p) => p.kind === "add").map((p) => p.text)).toEqual(["rang"]);
    expect(few.share).toBeLessThan(0.5);
    expect(
      wordChanges("The bells ring at dawn.", "Long before light, chimes sound.").share,
    ).toBeGreaterThan(0.5);
  });
});
