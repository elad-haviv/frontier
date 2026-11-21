import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttentionResponse, EntryResponse, SchemaResponse } from "@frontier/schema";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
  await t.login();
});
afterEach(() => t.close());

const entry = async (query: string) => {
  const res = await t.get(`/api/entries?${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return EntryResponse.parse(res.json());
};
const at = (path: string) => entry(`path=${encodeURIComponent(path)}`);

const VEL = "01 Places/Vel Aran.md";
const note = `---
id: k3f9x2ab
type: city
time:
  - what: founded
    when: "c. 340 EM"
  - what: sacked
    when: "after [[Mira]] left, before [[Nobody Wrote This]]"
---
# Vel Aran
`;

describe("fields of an entry", () => {
  it("gives none for a note without frontmatter, and no type outside the schema's folders", async () => {
    const e = await at("02 People/Mira.md");
    expect(e.id).toBeNull();
    expect(e.fields).toEqual({
      type: null,
      typeFrom: "none",
      typeKnown: true,
      time: [],
      problems: [],
    });
  });

  it("reads id, type and dates, marks names outside the schema and resolves links in dates", async () => {
    t.repo.pushFromOutside({ [VEL]: note });
    await t.services.sync();
    const e = await at(VEL);
    expect(e.id).toBe("k3f9x2ab");
    expect(e.fields.type).toBe("city");
    expect(e.fields.typeFrom).toBe("field");
    expect(e.fields.typeKnown).toBe(false);
    expect(e.fields.time).toEqual([
      { what: "founded", when: "c. 340 EM", known: true, links: [] },
      {
        what: "sacked",
        when: "after [[Mira]] left, before [[Nobody Wrote This]]",
        known: false,
        links: [
          { raw: "[[Mira]]", kind: "resolved", target: "02 People/Mira.md" },
          { raw: "[[Nobody Wrote This]]", kind: "unresolved" },
        ],
      },
    ]);
    // A link inside a date is a link of the entry like any other.
    expect((await at("02 People/Mira.md")).backlinks.map((b) => b.path)).toContain(VEL);
    expect((await entry("id=k3f9x2ab")).path).toBe(VEL);
    expect((await t.get("/api/entries?id=zzzzzzzz")).statusCode).toBe(404);
    expect((await t.get("/api/entries")).statusCode).toBe(400);
  });

  it("reads the fields of the draft when there is one", async () => {
    await t.put("/api/drafts", {
      id: "fielddraft01",
      path: "02 People/Mira.md",
      kind: "edit",
      text: '---\ntime:\n  - what: born\n    when: "in the year of the long tide"\n---\n# Mira\n',
      revision: 0,
    });
    expect((await at("02 People/Mira.md")).fields.time).toEqual([
      { what: "born", when: "in the year of the long tide", known: true, links: [] },
    ]);
  });

  it("takes the type from the folder when the schema names it", async () => {
    t.repo.pushFromOutside({
      ".frontier/schema.yaml":
        'version: 1\ntypes:\n  person: { folders: ["02 People"] }\nwhat:\n  born: { begins: true }\n',
    });
    await t.services.sync();
    const e = await at("02 People/Mira.md");
    expect(e.fields).toMatchObject({ type: "person", typeFrom: "folder", typeKnown: true });
    const schema = SchemaResponse.parse((await t.get("/api/schema")).json());
    expect(schema).toMatchObject({
      builtIn: false,
      problem: null,
      types: ["person"],
      what: ["born"],
    });
  });

  it("falls back to the built-in schema and says why when the vault's file cannot be used", async () => {
    let schema = SchemaResponse.parse((await t.get("/api/schema")).json());
    expect(schema.builtIn).toBe(true);
    expect(schema.what).toContain("founded");
    expect((await t.get("/api/status")).json().problems).toEqual([]);

    for (const bad of ["version: 2\nwhat: {}\n", "what: [\n"]) {
      t.repo.pushFromOutside({ ".frontier/schema.yaml": bad });
      await t.services.sync();
      schema = SchemaResponse.parse((await t.get("/api/schema")).json());
      expect(schema.builtIn).toBe(true);
      expect(schema.problem).toMatch(/cannot be used/);
      expect((await t.get("/api/status")).json().problems).toHaveLength(1);
    }
  });

  it("lists unreadable fields and an id carried by two entries", async () => {
    t.repo.pushFromOutside({
      [VEL]: note,
      "01 Places/Copy of Vel Aran.md": note,
      "01 Places/Odd.md": "---\ntime: someday\n---\n# Odd\n",
    });
    await t.services.sync();
    const a = AttentionResponse.parse((await t.get("/api/attention")).json());
    // The fixture vault already has two notes whose properties block is broken.
    expect(a.unreadableFields).toEqual([
      { path: "01 Places/Odd.md", problems: ["`time` is not a list."] },
      { path: "03 Things/Broken.md", problems: ["The properties block cannot be read."] },
      { path: "03 Things/Scalar.md", problems: ["The properties block cannot be read."] },
    ]);
    expect(a.duplicateIds).toEqual([
      { id: "k3f9x2ab", paths: ["01 Places/Copy of Vel Aran.md", VEL] },
    ]);
    expect((await t.get("/api/entries?id=k3f9x2ab")).statusCode).toBe(404);
    const status = (await t.get("/api/status")).json();
    expect(status.attention).toMatchObject({ unreadableFields: 3, duplicateIds: 1 });
  });

  it("rewrites a link inside a date when its target is renamed, and refuses a name with a quote", async () => {
    t.repo.pushFromOutside({ [VEL]: note });
    await t.services.sync();
    const bad = await t.post("/api/renames", {
      from: "02 People/Mira.md",
      to: '02 People/Mira "the Bold".md',
    });
    expect(bad.statusCode).toBe(400);
    const res = await t.post("/api/renames", {
      from: "02 People/Mira.md",
      to: "02 People/Mira of the Quay.md",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().affected).toContain(VEL);
    const plan = (
      await t.post("/api/publish/plan", { draftIds: [], renameIds: [res.json().id] })
    ).json();
    const done = await t.post("/api/publish/confirm", {
      planId: plan.planId,
      confirmedMergeIds: [],
      message: "Rename Mira",
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(t.repo.remoteFile(VEL)).toContain('when: "after [[Mira of the Quay]] left, before');
  });
});
