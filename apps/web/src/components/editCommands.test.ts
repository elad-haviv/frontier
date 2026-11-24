import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  type Edit,
  fenceAround,
  indentListItem,
  insertEmbeds,
  insertLink,
  insertRule,
  lineStyle,
  linkName,
  outdentListItem,
  setBlockStyle,
  toggleInline,
  toggleList,
} from "./editCommands.ts";

// Texts are written with the cursor as "|", or a selection between "«" and "»".
function state(text: string): EditorState {
  const cursor = text.indexOf("|");
  if (cursor !== -1) {
    return EditorState.create({
      doc: text.slice(0, cursor) + text.slice(cursor + 1),
      selection: { anchor: cursor },
    });
  }
  const from = text.indexOf("«");
  const to = text.indexOf("»") - 1;
  return EditorState.create({
    doc: text.replace("«", "").replace("»", ""),
    selection: EditorSelection.single(from, to),
  });
}

/** The text after an edit, with the selection marked the same way. */
function after(start: EditorState, edit: Edit | null): string {
  if (!edit) return "(nothing)";
  const next = start.update(edit).state;
  const doc = next.doc.toString();
  const { from, to } = next.selection.main;
  if (from === to) return doc.slice(0, from) + "|" + doc.slice(from);
  return doc.slice(0, from) + "«" + doc.slice(from, to) + "»" + doc.slice(to);
}

const apply = (text: string, make: (s: EditorState) => Edit | null) => {
  const s = state(text);
  return after(s, make(s));
};

describe("block styles", () => {
  it("knows the style of the cursor's line", () => {
    expect(lineStyle(state("plain|"))).toBe("paragraph");
    expect(lineStyle(state("### Tides|"))).toBe("h3");
    expect(lineStyle(state("> quoted|"))).toBe("quote");
    expect(lineStyle(state("```\ncode|\n```"))).toBe("code");
    expect(lineStyle(state("```\n```\nafter|"))).toBe("paragraph");
  });

  it("finds the fenced block around a line, closed or not", () => {
    const doc = state("a\n~~~~\nb\n~~~\nc\n~~~~\nd\n```\ne|").doc;
    expect(fenceAround(doc, 1)).toBeNull();
    expect(fenceAround(doc, 4)).toEqual({ open: 2, close: 6 });
    expect(fenceAround(doc, 7)).toBeNull();
    expect(fenceAround(doc, 9)).toEqual({ open: 8, close: null });
  });

  it("makes a line a heading, replacing the mark it had", () => {
    expect(apply("plain|", (s) => setBlockStyle(s, "h2"))).toBe("## plain|");
    expect(apply("|", (s) => setBlockStyle(s, "h1"))).toBe("# |");
    expect(apply("### old|", (s) => setBlockStyle(s, "h1"))).toBe("# old|");
    expect(apply("> said|", (s) => setBlockStyle(s, "h4"))).toBe("#### said|");
    expect(apply("## title|", (s) => setBlockStyle(s, "paragraph"))).toBe("title|");
    expect(apply("## same|", (s) => setBlockStyle(s, "h2"))).toBe("(nothing)");
    expect(apply("plain|", (s) => setBlockStyle(s, "paragraph"))).toBe("(nothing)");
  });

  it("quotes every selected line, blank lines included", () => {
    expect(apply("«one\n\ntwo»", (s) => setBlockStyle(s, "quote"))).toBe("> «one\n> \n> two»");
  });

  it("puts fences around the lines for a code block, and takes them away again", () => {
    expect(apply("«a\nb»", (s) => setBlockStyle(s, "code"))).toBe("```\n«a\nb»\n```");
    expect(apply("```\nx|\n```", (s) => setBlockStyle(s, "code"))).toBe("(nothing)");
    expect(apply("```js\nx|\ny\n```\nafter", (s) => setBlockStyle(s, "paragraph"))).toBe(
      "x|\ny\nafter",
    );
    expect(apply("```\nx|\n```", (s) => setBlockStyle(s, "h2"))).toBe("## x|");
    expect(apply("```|\n```\nz", (s) => setBlockStyle(s, "paragraph"))).toBe("|\nz");
    expect(apply("```\nopen|", (s) => setBlockStyle(s, "quote"))).toBe("> open|");
  });
});

describe("inline marks", () => {
  it("wraps the selection, and the word at the cursor", () => {
    expect(apply("a «big» b", (s) => toggleInline(s, "bold"))).toBe("a **«big»** b");
    expect(apply("a bi|g b", (s) => toggleInline(s, "underline"))).toBe("a <u>bi|g</u> b");
    expect(apply("a b|", (s) => toggleInline(s, "strike"))).toBe("a ~~b|~~");
    expect(apply("a |", (s) => toggleInline(s, "code"))).toBe("a `|`");
  });

  it("takes a mark away when it is already there, outside or inside the selection", () => {
    expect(apply("a **«big»** b", (s) => toggleInline(s, "bold"))).toBe("a «big» b");
    expect(apply("a «**big**» b", (s) => toggleInline(s, "bold"))).toBe("a «big» b");
    expect(apply("a <u>wo|rd</u>", (s) => toggleInline(s, "underline"))).toBe("a wo|rd");
    expect(apply("«<u>x</u>»", (s) => toggleInline(s, "underline"))).toBe("«x»");
    expect(apply("`|`", (s) => toggleInline(s, "code"))).toBe("|");
  });

  it("tells bold from italic by the number of asterisks", () => {
    expect(apply("**«x»**", (s) => toggleInline(s, "italic"))).toBe("***«x»***");
    expect(apply("***«x»***", (s) => toggleInline(s, "italic"))).toBe("**«x»**");
    expect(apply("***«x»***", (s) => toggleInline(s, "bold"))).toBe("*«x»*");
    expect(apply("*«x»*", (s) => toggleInline(s, "bold"))).toBe("***«x»***");
    expect(apply("«*x*»", (s) => toggleInline(s, "italic"))).toBe("«x»");
    expect(apply("«**x**»", (s) => toggleInline(s, "italic"))).toBe("*«**x**»*");
    expect(apply("«****»", (s) => toggleInline(s, "bold"))).toBe("**«****»**");
    expect(apply("«x»", (s) => toggleInline(s, "strike"))).toBe("~~«x»~~");
  });
});

describe("lists", () => {
  it("makes lines items, numbered on from the item above, and plain again", () => {
    expect(apply("«a\nb»", (s) => toggleList(s, "bullet"))).toBe("- «a\n- b»");
    expect(apply("«a\n\nb»", (s) => toggleList(s, "task"))).toBe("- [ ] «a\n\n- [ ] b»");
    expect(apply("«a\nb\nc»", (s) => toggleList(s, "numbered"))).toBe("1. «a\n2. b\n3. c»");
    expect(apply("1. a\n«b»", (s) => toggleList(s, "numbered"))).toBe("1. a\n2. «b»");
    expect(apply("«- a\n- b»", (s) => toggleList(s, "bullet"))).toBe("«a\nb»");
    expect(apply("«- a\n- b»", (s) => toggleList(s, "numbered"))).toBe("«1. a\n2. b»");
    expect(apply("  - [x] done|", (s) => toggleList(s, "task"))).toBe("  done|");
    expect(apply("|", (s) => toggleList(s, "bullet"))).toBe("- |");
  });

  it("indents an item under the one above by its marker, renumbering the list", () => {
    expect(apply("1. a\n2. b|\n3. c", indentListItem)).toBe("1. a\n   1. b|\n2. c");
    expect(apply("- a\n- b|", indentListItem)).toBe("- a\n  - b|");
    expect(apply("- [ ] a\n- [ ] b|", indentListItem)).toBe("- [ ] a\n  - [ ] b|");
    // Its children go with it.
    expect(apply("- a\n- b|\n  - c\n\n    more\n- d", indentListItem)).toBe(
      "- a\n  - b|\n    - c\n\n      more\n- d",
    );
    // Past a deeper item, to the sibling above it.
    expect(apply("- a\n  - x\n- b|", indentListItem)).toBe("- a\n  - x\n  - b|");
  });

  it("leaves a first item where it is, and is not for lines outside a list", () => {
    expect(apply("- a|\n- b", indentListItem)).toBe("- a|\n- b");
    expect(apply("text\n- a|", indentListItem)).toBe("text\n- a|");
    expect(apply("- a\n  - b|", indentListItem)).toBe("- a\n  - b|");
    expect(apply("plain|", indentListItem)).toBe("(nothing)");
  });

  it("brings an item out to the depth of the one it was under", () => {
    expect(apply("1. a\n   1. b|\n2. c", outdentListItem)).toBe("1. a\n2. b|\n3. c");
    expect(apply("- a\n  - b|\n    - c", outdentListItem)).toBe("- a\n- b|\n  - c");
    expect(apply("- a|", outdentListItem)).toBe("- a|");
    expect(apply("plain|", outdentListItem)).toBe("(nothing)");
    expect(apply("    - orphan|", outdentListItem)).toBe("- orphan|");
  });

  it("counts a nested list from 1 and a top list from its first number", () => {
    expect(apply("3. a\n4. b|\n9. c\n- d\n1. e", indentListItem)).toBe(
      "3. a\n   1. b|\n4. c\n- d\n1. e",
    );
  });
});

describe("inserting", () => {
  it("puts a rule on a line of its own, never under a line of text", () => {
    expect(apply("text|", insertRule)).toBe("text\n\n---\n|");
    expect(apply("text\n|", insertRule)).toBe("text\n\n---\n|");
    expect(apply("text\n\n|", insertRule)).toBe("text\n\n---\n|");
    expect(apply("|", insertRule)).toBe("---\n|");
  });

  it("links to an entry, keeping selected words as what the link shows", () => {
    expect(apply("see |", (s) => insertLink(s, "Harbor"))).toBe("see [[Harbor]]|");
    expect(apply("the «quay»", (s) => insertLink(s, "Harbor"))).toBe("the [[Harbor|quay]]|");
    expect(apply("«Harbor»", (s) => insertLink(s, "Harbor"))).toBe("[[Harbor]]|");
  });

  it("embeds images one per line", () => {
    expect(apply("|", (s) => insertEmbeds(s, ["a.png", "b.png"]))).toBe("![[a.png]]\n![[b.png]]|");
  });

  it("names a file by its name when that is unique, else by its path", () => {
    const all = ["01 Places/Harbor.md", "02 Things/Lamp.md", "03 Old/lamp.md", "x/lamp.png"];
    expect(linkName("01 Places/Harbor.md", all, false)).toBe("Harbor");
    expect(linkName("02 Things/Lamp.md", all, false)).toBe("02 Things/Lamp");
    expect(linkName("x/lamp.png", ["x/lamp.png", "y/sea.png"], true)).toBe("lamp.png");
    expect(linkName("x/lamp.png", ["x/lamp.png", "y/Lamp.png"], true)).toBe("x/lamp.png");
  });
});
