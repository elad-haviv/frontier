import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EntryResponse,
  parseTypes,
  PublishPlan,
  SchemaResponse,
  serialiseTypes,
  type TypesFile,
  UnpublishedResponse,
} from "@frontier/schema";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
  await t.login();
});
afterEach(() => t.close());

const at = async (path: string) => {
  const res = await t.get(`/api/entries?path=${encodeURIComponent(path)}`);
  expect(res.statusCode, res.body).toBe(200);
  return EntryResponse.parse(res.json());
};
const schema = async () => SchemaResponse.parse((await t.get("/api/schema")).json());
const types = async () => {
  const res = await t.get("/api/library-files/types");
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { file: TypesFile; revision: number; blob: string };
};
const save = async (file: TypesFile) => {
  const { revision } = await types();
  return t.put("/api/library-files/types", { file, revision });
};

const MIRA = "02 People/Mira.md";
const SCHEMA = {
  ".frontier/schema.yaml":
    'version: 1\ntypes:\n  person: { folders: ["02 People"] }\n  place: { folders: ["01 Places"] }\nwhat:\n  born: { begins: true }\n  died: { ends: true }\n',
};

describe("the types file (stage 34)", () => {
  it("starts from the schema's names, with a person chattable", async () => {
    t.repo.pushFromOutside(SCHEMA);
    await t.services.sync();
    const { file, revision, blob } = await types();
    expect(revision).toBe(0);
    expect(blob).toBe("");
    expect(file).toEqual({
      version: 1,
      types: [
        { name: "person", props: [{ key: "chattable", kind: "checkbox", value: true }], dates: [] },
        { name: "place", props: [], dates: [] },
      ],
      what: [
        { name: "born", begins: true },
        { name: "died", ends: true },
      ],
    });
    // A person who has the type only from the folder can be talked with; a place cannot.
    const mira = await at(MIRA);
    expect(mira.fields).toMatchObject({ type: "person", typeFrom: "folder", chattable: true });
    expect(mira.fields.props).toEqual([{ key: "chattable", kind: "checkbox", value: true }]);
    expect((await at("01 Places/Unwritten.md")).fields).toMatchObject({
      type: "place",
      chattable: false,
      props: [],
    });
  });

  it("gives a type's properties to its entries, and an entry's own word wins", async () => {
    t.repo.pushFromOutside(SCHEMA);
    await t.services.sync();
    const { file } = await types();
    const next: TypesFile = {
      ...file,
      types: [
        {
          name: "person",
          props: [
            { key: "species", kind: "link", to: "place" },
            { key: "rank", kind: "choice", options: ["low", "high"], value: "low" },
            { key: "chattable", kind: "checkbox", value: true },
          ],
          dates: ["born", "died"],
        },
        file.types[1]!,
        { name: "vessel", props: [], dates: [] },
      ],
      what: [...file.what, { name: "launched", begins: true }],
    };
    expect((await save(next)).statusCode).toBe(200);
    const s = await schema();
    expect(s.types).toEqual(["person", "place", "vessel"]);
    expect(s.what).toEqual(["born", "died", "launched"]);
    expect(s.file.types[0]!.dates).toEqual(["born", "died"]);
    expect((await at(MIRA)).fields.props.map((p) => p.key)).toEqual([
      "species",
      "rank",
      "chattable",
    ]);

    await t.put("/api/drafts", {
      id: "typesdraft01",
      path: MIRA,
      kind: "edit",
      text: "---\nchattable: false\n---\n# Mira\n",
      revision: 0,
    });
    expect((await at(MIRA)).fields.chattable).toBe(false);
  });

  it("refuses two types of one name, and a property with a field of its own", async () => {
    const { file } = await types();
    const twice = await save({ ...file, types: [...file.types, { ...file.types[0]! }] });
    expect(twice.statusCode).toBe(400);
    const reserved = await save({
      ...file,
      types: [{ name: "x", props: [{ key: "tags", kind: "list" }], dates: [] }],
    });
    expect(reserved.statusCode).toBe(400);
    const wrongKind = await save({
      ...file,
      types: [{ name: "x", props: [{ key: "chattable", kind: "text" }], dates: [] }],
    });
    expect(wrongKind.statusCode).toBe(400);
  });

  it("counts entries by type and dates by name, and lists words that are on neither list", async () => {
    t.repo.pushFromOutside({
      ...SCHEMA,
      [MIRA]:
        '---\ntime:\n  - what: born\n    when: "long ago"\n  - what: crowned\n    when: "later"\n---\n# Mira\n',
      "01 Places/Unwritten.md": "---\ntype: wasteland\n---\n# Unwritten\n",
    });
    await t.services.sync();
    const s = await schema();
    expect(s.counts.types["person"]).toBeGreaterThan(0);
    expect(s.counts.what).toEqual({ born: 1 });
    expect(s.counts.untyped).toBeGreaterThan(0);
    expect(s.strays).toEqual({
      types: [{ name: "wasteland", entries: 1 }],
      what: [{ name: "crowned", entries: 1 }],
    });
  });
});

describe("saving the types as a version (stage 34)", () => {
  async function publishAll() {
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    const plan = PublishPlan.parse(
      (
        await t.post("/api/publish/plan", {
          draftIds: un.drafts.map((d) => d.id),
          renameIds: un.renames.map((r) => r.id),
        })
      ).json(),
    );
    const res = await t.post("/api/publish/confirm", {
      planId: plan.planId,
      confirmedMergeIds: plan.merges.map((m) => m.id),
      message: "Types",
    });
    return { plan, res };
  }

  it("writes the file into the library, and merges another change to a different type", async () => {
    t.repo.pushFromOutside(SCHEMA);
    await t.services.sync();
    const { file } = await types();
    const vessel = { name: "vessel", props: [{ key: "rig", kind: "text" as const }], dates: [] };
    expect((await save({ ...file, types: [...file.types, vessel] })).statusCode).toBe(200);
    const first = await publishAll();
    expect(first.res.statusCode, first.res.body).toBe(200);
    const onMain = parseTypes(t.repo.remoteFile(".frontier/types.json")!);
    expect(onMain.ok && onMain.file.types.map((x) => x.name)).toEqual([
      "person",
      "place",
      "vessel",
    ]);
    const after = await types();
    expect(after.revision).toBe(0);
    expect(after.blob).not.toBe("");
    // The schema file is no longer what decides: the types file is.
    expect((await schema()).types).toEqual(["person", "place", "vessel"]);

    const mine = after.file;
    await t.put("/api/library-files/types", {
      file: {
        ...mine,
        types: mine.types.map((x) => (x.name === "vessel" ? { ...x, dates: ["born"] } : x)),
      },
      revision: 0,
      baseBlob: after.blob,
    });
    t.repo.pushFromOutside({
      ".frontier/types.json": serialiseTypes({
        ...mine,
        types: mine.types.map((x) => (x.name === "place" ? { ...x, dates: ["died"] } : x)),
      }),
    });
    const second = await publishAll();
    expect(second.plan.merges).toHaveLength(1);
    expect(second.res.statusCode, second.res.body).toBe(200);
    const merged = parseTypes(t.repo.remoteFile(".frontier/types.json")!);
    expect(merged.ok && merged.file.types.map((x) => [x.name, x.dates])).toEqual([
      ["person", []],
      ["place", ["died"]],
      ["vessel", ["born"]],
    ]);
  });
});

describe("renaming (stage 34)", () => {
  beforeEach(async () => {
    t.repo.pushFromOutside({
      ...SCHEMA,
      [MIRA]:
        '---\ntype: person\nhome: "[[Harbor]]"\ntime:\n  - what: born\n    when: "long ago"\n---\n# Mira\n',
    });
    await t.services.sync();
  });

  it("renames a type in the types file, the folder file and the entries that write it", async () => {
    const dry = await t.post("/api/types/rename", {
      what: "type",
      from: "person",
      to: "character",
      dryRun: true,
    });
    expect(dry.json()).toEqual({ entries: 1, folders: 1, skipped: 0 });
    expect((await types()).file.types[0]!.name).toBe("person");

    const res = await t.post("/api/types/rename", {
      what: "type",
      from: "person",
      to: "character",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ entries: 1, folders: 1, skipped: 0 });
    expect((await types()).file.types.map((x) => x.name)).toEqual(["character", "place"]);
    const mira = await at(MIRA);
    expect(mira.text).toContain("type: character");
    expect(mira.fields).toMatchObject({ type: "character", typeKnown: true, chattable: true });
    // An entry with the type from its folder follows through the folder file.
    expect((await at("02 People/Shade.md")).fields).toMatchObject({
      type: "character",
      typeFrom: "folder",
    });
    const taken = await t.post("/api/types/rename", {
      what: "type",
      from: "character",
      to: "place",
    });
    expect(taken.statusCode).toBe(400);
  });

  it("renames a property of a type in its entries, and a date name in every date", async () => {
    const { file } = await types();
    await save({
      ...file,
      types: file.types.map((x) =>
        x.name === "person"
          ? { ...x, props: [...x.props, { key: "home", kind: "link" as const }], dates: ["born"] }
          : x,
      ),
    });
    const prop = await t.post("/api/types/rename", {
      what: "prop",
      type: "person",
      from: "home",
      to: "lives in",
    });
    expect(prop.json()).toEqual({ entries: 1, folders: 0, skipped: 0 });
    expect((await at(MIRA)).text).toContain('lives in: "[[Harbor]]"');
    expect((await types()).file.types[0]!.props.map((p) => p.key)).toContain("lives in");

    const date = await t.post("/api/types/rename", { what: "date", from: "born", to: "hatched" });
    expect(date.json()).toEqual({ entries: 1, folders: 0, skipped: 0 });
    const after = await types();
    expect(after.file.what.map((w) => w.name)).toEqual(["hatched", "died"]);
    expect(after.file.types[0]!.dates).toEqual(["hatched"]);
    expect((await at(MIRA)).fields.time).toMatchObject([{ what: "hatched", known: true }]);
  });
});
