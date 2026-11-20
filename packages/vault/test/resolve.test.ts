import { describe, expect, it } from "vitest";
import { createResolver, findLinks, type Resolution } from "../src/index.js";
import { fixture, fixtureFiles } from "./helpers.js";

const files = fixtureFiles();
const resolver = createResolver(files);

/** Resolves every link of a fixture note and returns "raw -> result" lines. */
function resolved(path: string): Record<string, Resolution> {
  const out: Record<string, Resolution> = {};
  for (const link of findLinks(fixture(path))) out[link.raw] = resolver.resolve(link, path);
  return out;
}

const HARBOR = "01 Places/Harbor/Harbor.md";

describe("bare names", () => {
  it("resolves by note name, ignoring case and surrounding spaces", () => {
    const r = resolved("01 Places/Harbor/Old Quay.md");
    expect(r["[[Harbor]]"]).toEqual({ kind: "note", path: HARBOR, heading: null });
    expect(r["[[ Harbor]]"]).toEqual({ kind: "note", path: HARBOR, heading: null });
    expect(r["[[harbor]]"]).toEqual({ kind: "note", path: HARBOR, heading: null });
    expect(r["[[Harbor|the port]]"]).toEqual({ kind: "note", path: HARBOR, heading: null });
  });

  it("carries the heading, and resolves a same-note heading link to the note itself", () => {
    const r = resolved("01 Places/Harbor/Old Quay.md");
    expect(r["[[Harbor#History|its past]]"]).toEqual({
      kind: "note",
      path: HARBOR,
      heading: "History",
    });
    expect(r["[[#Tides]]"]).toEqual({
      kind: "note",
      path: "01 Places/Harbor/Old Quay.md",
      heading: "Tides",
    });
  });

  it("prefers the one note outside the appendix folder (Frontier's stated exception)", () => {
    // "Harbor" exists as a live note and as a recycle-bin copy; "Shade" as lore and as a chat profile.
    expect(resolved("03 Things/Broken.md")["[[Harbor]]"]).toEqual({
      kind: "note",
      path: HARBOR,
      heading: null,
    });
    expect(resolved("03 Things/Ledger.md")["[[Shade]]"]).toEqual({
      kind: "note",
      path: "02 People/Shade.md",
      heading: null,
    });
  });

  it("calls two lore notes with one name ambiguous and does not guess", () => {
    expect(resolved("03 Things/Twin.md")["[[Twin]]"]).toEqual({
      kind: "ambiguous",
      candidates: ["02 People/Twin.md", "03 Things/Twin.md"],
    });
  });

  it("leaves an unwritten entry unresolved", () => {
    const r = resolved("01 Places/Unwritten.md");
    expect(r["[[The Drowned Bell]]"]).toEqual({ kind: "unresolved" });
    expect(r["[[Saltmother]]"]).toEqual({ kind: "unresolved" });
  });

  it("does not use aliases as link targets", () => {
    const [link] = findLinks("[[The Port]]");
    expect(resolver.resolve(link!, "02 People/Mira.md")).toEqual({ kind: "unresolved" });
  });

  it("does not see notes inside excluded folders", () => {
    const [link] = findLinks("[[Hidden]]");
    expect(resolver.resolve(link!, "02 People/Mira.md")).toEqual({ kind: "unresolved" });
  });
});

describe("links with a path", () => {
  const r = resolved("02 People/Mira.md");

  it("resolves a full path, with or without .md, in any letter case", () => {
    expect(r["[[01 Places/Harbor/Harbor]]"]).toEqual({ kind: "note", path: HARBOR, heading: null });
    expect(r["[[01 Places/Harbor/Harbor.md]]"]).toEqual({
      kind: "note",
      path: HARBOR,
      heading: null,
    });
    expect(r["[[01 places/harbor/HARBOR]]"]).toEqual({ kind: "note", path: HARBOR, heading: null });
  });

  it("resolves the last folders of a path", () => {
    expect(r["[[Harbor/Old Quay]]"]).toEqual({
      kind: "note",
      path: "01 Places/Harbor/Old Quay.md",
      heading: null,
    });
  });

  it("applies the appendix tie-break to a path that matches twice", () => {
    const [link] = findLinks("[[Harbor/Harbor]]");
    expect(resolver.resolve(link!, "02 People/Mira.md")).toEqual({
      kind: "note",
      path: HARBOR,
      heading: null,
    });
  });

  it("reports a file in an excluded folder, or a file that is not a note", () => {
    expect(r["[[.obsidian/app.json]]"]).toEqual({ kind: "outside", path: ".obsidian/app.json" });
    expect(r["[[notes.json]]"]).toEqual({ kind: "file", path: "notes.json" });
    const [gone] = findLinks("[[.gemini/skills/x/SKILL.md]]");
    expect(resolver.resolve(gone!, "02 People/Mira.md")).toEqual({ kind: "outside", path: null });
    const [hidden] = findLinks("[[.obsidian/Hidden.md]]");
    expect(resolver.resolve(hidden!, "02 People/Mira.md")).toEqual({
      kind: "outside",
      path: ".obsidian/Hidden.md",
    });
  });

  it("leaves a path to nothing unresolved", () => {
    expect(r["[[01 Places/Nowhere/Gone]]"]).toEqual({ kind: "unresolved" });
  });

  it("resolves a path to a file that is not a note", () => {
    const [link] = findLinks("![[99 Appendices/Images/map one.png]]");
    expect(resolver.resolve(link!, "02 People/Mira.md")).toEqual({
      kind: "file",
      path: "99 Appendices/Images/map one.png",
    });
  });

  it("calls two paths that differ only in case ambiguous", () => {
    const local = createResolver(["A/Note.md", "a/note.md"]);
    const [link] = findLinks("[[a/note]]");
    expect(local.resolve(link!, "x.md")).toEqual({
      kind: "ambiguous",
      candidates: ["A/Note.md", "a/note.md"],
    });
    const [image] = findLinks("![[img/a.png]]");
    expect(createResolver(["img/a.png", "IMG/A.png"]).resolve(image!, "x.md")).toEqual({
      kind: "ambiguous",
      candidates: ["IMG/A.png", "img/a.png"],
    });
  });
});

describe("images", () => {
  const r = resolved("03 Things/Gallery.md");

  it("resolves an embed by bare file name", () => {
    expect(r["![[photo.png]]"]).toEqual({ kind: "file", path: "99 Appendices/Images/photo.png" });
    expect(r["![[photo.png|200]]"]).toEqual({
      kind: "file",
      path: "99 Appendices/Images/photo.png",
    });
    expect(r["![[map one.png]]"]).toEqual({
      kind: "file",
      path: "99 Appendices/Images/map one.png",
    });
  });

  it("calls a name that exists twice, ignoring case, ambiguous", () => {
    expect(r["![[lamp.png]]"]).toEqual({
      kind: "ambiguous",
      candidates: ["99 Appendices/Icons/Lamp.png", "99 Appendices/Images/lamp.png"],
    });
  });

  it("leaves a missing image unresolved", () => {
    expect(r["![[nothing.png]]"]).toEqual({ kind: "unresolved" });
  });

  it("lists duplicated names", () => {
    expect(resolver.duplicateImageNames()).toEqual([
      ["99 Appendices/Icons/Lamp.png", "99 Appendices/Images/lamp.png"],
    ]);
    expect(resolver.duplicateNoteNames()).toEqual([
      ["01 Places/Harbor/Harbor.md", "99 Appendices/Recycle Bin/Harbor.md"],
      ["02 People/Shade.md", "99 Appendices/Agents/Shade.md"],
      ["02 People/Twin.md", "03 Things/Twin.md"],
    ]);
  });
});

describe("standard Markdown links", () => {
  it("resolves against the folder of the note that contains the link", () => {
    const r = resolved("01 Places/Harbor/Old Quay.md");
    expect(r["[Harbor](Harbor.md)"]).toEqual({ kind: "note", path: HARBOR, heading: null });
    expect(r["[Mira](../../02%20People/Mira.md)"]).toEqual({
      kind: "note",
      path: "02 People/Mira.md",
      heading: null,
    });
    const g = resolved("03 Things/Gallery.md");
    expect(g["![a map](<../99 Appendices/Images/map one.png>)"]).toEqual({
      kind: "file",
      path: "99 Appendices/Images/map one.png",
    });
    expect(g["![missing](<../99 Appendices/Images/none.png>)"]).toEqual({ kind: "unresolved" });
  });

  it("resolves from the vault root for notes at the root", () => {
    const r = resolved("README.md");
    expect(r["[Harbor](01%20Places/Harbor/Harbor.md)"]).toEqual({
      kind: "note",
      path: HARBOR,
      heading: null,
    });
    expect(r["[the rules](AGENTS.md)"]).toEqual({ kind: "note", path: "AGENTS.md", heading: null });
  });

  it("handles a leading slash, a missing extension, a heading and case", () => {
    const at = (text: string, from = "02 People/Mira.md") =>
      resolver.resolve(findLinks(text)[0]!, from);
    expect(at("[x](/01%20Places/Harbor/Harbor.md)")).toEqual({
      kind: "note",
      path: HARBOR,
      heading: null,
    });
    expect(at("[x](../01%20Places/Harbor/Harbor)")).toEqual({
      kind: "note",
      path: HARBOR,
      heading: null,
    });
    expect(at("[x](../01%20Places/Harbor/harbor.md#History)")).toEqual({
      kind: "note",
      path: HARBOR,
      heading: "History",
    });
    expect(at("[x](../notes.json)")).toEqual({ kind: "file", path: "notes.json" });
  });

  it("reports paths outside the vault or into excluded folders", () => {
    const at = (text: string) => resolver.resolve(findLinks(text)[0]!, "02 People/Mira.md");
    expect(at("[x](../../elsewhere.md)")).toEqual({ kind: "outside", path: null });
    expect(at("[x](../.obsidian/app.json)")).toEqual({
      kind: "outside",
      path: ".obsidian/app.json",
    });
    expect(at("[x](../.gemini/none.md)")).toEqual({ kind: "outside", path: null });
  });
});
