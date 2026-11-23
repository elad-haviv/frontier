import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DraftRecord, type FolderFile, GraphResponse } from "@frontier/schema";
import { buildGraph } from "../src/index/graph.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
  await t.login();
});
afterEach(() => t.close());

async function graph() {
  const res = await t.get("/api/graph");
  expect(res.statusCode, res.body).toBe(200);
  const g = GraphResponse.parse(res.json());
  const paths = g.nodes.map((n) => n.path);
  const node = (path: string) => g.nodes.find((n) => n.path === path);
  /** The edges as "from → to" by path, so a test reads them by name. */
  const edges = new Set(g.edges.map(([a, b]) => `${paths[a]} → ${paths[b]}`));
  const out = (path: string) =>
    [...edges].filter((e) => e.startsWith(`${path} → `)).map((e) => e.split(" → ")[1]);
  const into = (path: string) =>
    [...edges].filter((e) => e.endsWith(` → ${path}`)).map((e) => e.split(" → ")[0]);
  return { g, paths, node, edges, out, into };
}

let ids = 0;
const draftId = () => `graphdraft${String(++ids).padStart(2, "0")}`;
async function draft(path: string, kind: "edit" | "create" | "delete", text = "") {
  const res = await t.put("/api/drafts", { id: draftId(), path, kind, text, revision: 0 });
  expect(res.statusCode, res.body).toBe(200);
}

const HARBOR = "01 Places/Harbor/Harbor.md";
const QUAY = "01 Places/Harbor/Old Quay.md";
const MIRA = "02 People/Mira.md";
const SHADE = "02 People/Shade.md";
const LEDGER = "03 Things/Ledger.md";
const LANTERN = "03 Things/Lantern.md";
const UNWRITTEN = "01 Places/Unwritten.md";

describe("the graph", () => {
  it("has the notes as nodes, and nothing else", async () => {
    const { paths, node } = await graph();
    for (const gone of [
      "99 Appendices/Images/lamp.png",
      "99 Appendices/Icons/Lamp.png",
      "notes.json",
      ".obsidian/Hidden.md",
    ]) {
      expect(paths).not.toContain(gone);
    }
    expect(paths).toContain("README.md");
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain("99 Appendices/Logs/Session.md");
    expect(paths).toEqual([...paths].sort());
    expect(node(HARBOR)).toEqual({
      path: HARBOR,
      title: "Harbor",
      type: null,
      aliases: ["The Port", "Greywater"],
    });
    expect(node(UNWRITTEN)).not.toHaveProperty("aliases");
  });

  it("makes one edge per linking pair, from resolved links to notes only", async () => {
    const { g, out, edges } = await graph();
    // Old Quay links to Harbor many ways; one edge, and Mira from the Markdown link.
    expect(out(QUAY).sort()).toEqual([HARBOR, MIRA]);
    // Mira's three spellings of Harbor are one edge; Old Quay comes from the short path.
    expect(out(MIRA).sort()).toEqual([HARBOR, QUAY]);
    expect(g.edges.filter(([a, b]) => a === b)).toEqual([]);
    expect(new Set(g.edges.map((e) => e.join())).size).toBe(g.edges.length);
    // Lantern's ambiguous [[Twin]] makes no edge; its [[Harbor]] does.
    expect(out(LANTERN)).toEqual([HARBOR]);
    // Unresolved links, images, files and links outside make none.
    expect(out(UNWRITTEN)).toEqual([]);
    expect(out("03 Things/Gallery.md")).toEqual([]);
    expect([...edges].some((e) => e.includes("Unwritten"))).toBe(false);
  });

  it("drops a deleted note with its edges, without moving other notes' links", async () => {
    await draft(SHADE, "delete");
    const { paths, out, into } = await graph();
    expect(paths).not.toContain(SHADE);
    expect(out(LEDGER)).not.toContain(SHADE);
    // Ledger's [[Shade]] does not jump to the appendices' Shade.
    expect(out(LEDGER)).not.toContain("99 Appendices/Agents/Shade.md");
    expect(into(MIRA)).not.toContain(SHADE);
  });

  it("takes an edited note's outbound links and aliases from its draft, and keeps its backlinks", async () => {
    await draft(
      MIRA,
      "edit",
      "---\naliases: [Mi]\ntype: person\n---\nLives at [[Harbor]]. Carries a [[Lantern]].\n",
    );
    const { node, out, into } = await graph();
    expect(out(MIRA).sort()).toEqual([HARBOR, LANTERN]);
    expect(node(MIRA)).toEqual({
      path: MIRA,
      title: "Mira",
      type: "person",
      aliases: ["Mi"],
      unpublished: true,
    });
    expect(into(MIRA).sort()).toEqual([QUAY, HARBOR, SHADE, LEDGER].sort());
  });

  it("adds a created note with its own links, and resolves no other note again", async () => {
    await draft("02 People/Gull.md", "create", "# Gull\n\nFriend of [[Mira]].\n");
    await draft(MIRA, "edit", "Knows [[Gull]].\n");
    await draft("01 Places/The Drowned Bell.md", "create", "# The Drowned Bell\n");
    const { node, out, into } = await graph();
    expect(node("02 People/Gull.md")).toEqual({
      path: "02 People/Gull.md",
      title: "Gull",
      type: null,
      unpublished: true,
    });
    expect(out("02 People/Gull.md")).toEqual([MIRA]);
    expect(out(MIRA)).toEqual(["02 People/Gull.md"]);
    expect(node("01 Places/The Drowned Bell.md")?.unpublished).toBe(true);
    // Unwritten's older link to it waits for a saved version, as its backlinks do.
    expect(into("01 Places/The Drowned Bell.md")).toEqual([]);
  });

  it("does not apply a rename until it is saved", async () => {
    const res = await t.post("/api/renames", { from: SHADE, to: "02 People/The Shade.md" });
    expect(res.statusCode, res.body).toBe(200);
    const { paths, node } = await graph();
    expect(paths).not.toContain("02 People/The Shade.md");
    expect(node(SHADE)?.title).toBe("Shade");
  });
});

describe("folder colours", () => {
  async function folders(file: FolderFile["folders"]) {
    const loaded = (await t.get("/api/library-files/folders")).json() as { revision: number };
    const res = await t.put("/api/library-files/folders", {
      file: { version: 1, folders: file },
      revision: loaded.revision,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (await graph()).g;
  }

  it("keeps a folder's own colour and gives the others the unused ones in order", async () => {
    const g = await folders([
      { path: "03 Things", order: "1" },
      { path: "02 People", color: "ember" },
      { path: "01 Places/Harbor", color: "teal" },
    ]);
    // The folder file's order first, then by name; the appendices are never given one.
    expect(g.folders).toEqual([
      { path: "03 Things", color: "sea" },
      { path: "01 Places", color: "moss" },
      { path: "02 People", color: "ember" },
      { path: "99 Appendices", color: null },
    ]);
    expect(g.nested).toEqual([{ path: "01 Places/Harbor", color: "teal" }]);
  });

  it("gives the neutral colour once the eight run out", async () => {
    const colours = ["ember", "sea", "moss", "gold", "plum", "slate", "rose"] as const;
    const g = await folders(colours.map((color, i) => ({ path: `01 Places/F${i}`, color })));
    expect(g.folders).toEqual([
      { path: "01 Places", color: "teal" },
      { path: "02 People", color: null },
      { path: "03 Things", color: null },
      { path: "99 Appendices", color: null },
    ]);
    expect(g.nested).toHaveLength(7);
  });
});

describe("buildGraph", () => {
  it("ignores drafts that are not notes, edits of notes gone, and drafts without text", () => {
    const record = (path: string, kind: DraftRecord["kind"], binary = false): DraftRecord => ({
      id: draftId(),
      revision: 1,
      path,
      kind,
      baseBlob: "",
      lineEnding: "lf",
      binary,
      updatedAt: "2026-11-23T10:00:00Z",
      origins: [],
    });
    const before = buildGraph({
      index: t.services.index,
      drafts: [],
      texts: new Map(),
      added: [],
      removed: [],
      folders: { version: 1, folders: [] },
    });
    const after = buildGraph({
      index: t.services.index,
      drafts: [
        record("99 Appendices/Images/new.png", "create", true),
        record(".frontier/maps/x.json", "create"),
        record("02 People/Nobody.md", "edit"),
        record("02 People/Silent.md", "create"),
      ],
      texts: new Map([["02 People/Nobody.md", "Links to [[Mira]]."]]),
      added: ["99 Appendices/Images/new.png", "02 People/Silent.md"],
      removed: [],
      folders: { version: 1, folders: [] },
    });
    expect(after).toEqual(before);
  });
});
