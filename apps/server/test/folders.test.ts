import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EntryResponse,
  FOLDER_FILE,
  type FolderFile,
  parseFolders,
  PublishPlan,
  serialiseFolders,
  type TreeFolder,
  TreeResponse,
  UnpublishedResponse,
} from "@frontier/schema";
import { makeTestApp, type TestApp } from "./helpers/app.js";

const SCHEMA = `version: 1
types:
  place: { folders: ["01 Places", "Nowhere At All"] }
  person: { folders: ["02 People/"] }
  thing: {}
what:
  born: { begins: true }
`;

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
  t.repo.pushFromOutside({ ".frontier/schema.yaml": SCHEMA }, "Add a schema");
  await t.services.sync();
  await t.login();
});
afterEach(() => t.close());

async function load() {
  const res = await t.get("/api/library-files/folders");
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { file: FolderFile; revision: number; blob: string };
}
const save = (file: FolderFile, revision: number, extra: Record<string, unknown> = {}) =>
  t.put("/api/library-files/folders", { file, revision, ...extra });

async function typeOf(path: string) {
  const res = await t.get(`/api/entries?path=${encodeURIComponent(path)}`);
  expect(res.statusCode, res.body).toBe(200);
  return EntryResponse.parse(res.json()).fields;
}
async function tree() {
  return TreeResponse.parse((await t.get("/api/tree")).json());
}
function find(folders: TreeFolder[], path: string): TreeFolder | undefined {
  for (const f of folders) {
    if (f.path === path) return f;
    const inner = find(f.folders, path);
    if (inner) return inner;
  }
  return undefined;
}
async function publishAll(message = "Save") {
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
    message,
  });
  return { un, plan, res };
}
const status = async () => (await t.get("/api/status")).json() as { problems: string[] };

describe("the folder file", () => {
  it("is built from the schema's lists until the first change, then is the only source", async () => {
    const first = await load();
    expect(first.revision).toBe(0);
    expect(first.blob).toBe("");
    // A folder the schema names but the library lacks is not made into an empty folder.
    expect(first.file.folders).toEqual([
      { path: "01 Places", type: "place" },
      { path: "02 People", type: "person" },
    ]);
    expect((await typeOf("01 Places/Unwritten.md")).typeFrom).toBe("folder");
    expect((await status()).problems.join(" ")).not.toContain("no longer read");

    // The first change: the people folder loses its type, a new empty folder is added.
    const next: FolderFile = {
      version: 1,
      folders: [
        { path: "01 Places", type: "place", icon: "map", color: "sea" },
        { path: "02 People" },
        { path: "01 Places/Islands", icon: "waves", color: "teal", order: "V", type: "thing" },
      ],
    };
    const saved = await save(next, 0, { baseBlob: first.blob, op: "aaaaaaaaaaaa" });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().revision).toBe(1);

    // The draft's types are used before a version is saved.
    expect(await typeOf("02 People/Mira.md")).toMatchObject({ type: null, typeFrom: "none" });
    expect(await typeOf("01 Places/Harbor/Harbor.md")).toMatchObject({ type: "place" });
    expect((await status()).problems.join(" ")).toContain(
      "The folder lists in .frontier/schema.yaml are no longer read",
    );

    const shown = await tree();
    const islands = find(shown.folders, "01 Places/Islands")!;
    expect(islands).toMatchObject({
      icon: "waves",
      color: "teal",
      order: "V",
      type: "thing",
      empty: true,
      unpublished: true,
    });
    expect(find(shown.folders, "01 Places")).toMatchObject({ icon: "map", type: "place" });
    expect(find(shown.folders, "01 Places")!.empty).toBeUndefined();
    expect(find(shown.folders, "02 People")!.type).toBeUndefined();

    // After a version is saved the empty folder is still there, and is in the history.
    const { res } = await publishAll("Add Islands");
    expect(res.statusCode, res.body).toBe(200);
    const onMain = parseFolders(t.repo.remoteFile(FOLDER_FILE)!);
    expect(onMain.ok && onMain.file.folders.map((l) => l.path)).toEqual([
      "01 Places",
      "02 People",
      "01 Places/Islands",
    ]);
    expect((await load()).revision).toBe(0);
    expect(find((await tree()).folders, "01 Places/Islands")!.empty).toBe(true);
    expect(find((await tree()).folders, "01 Places/Islands")!.unpublished).toBeUndefined();
    expect((await typeOf("02 People/Mira.md")).typeFrom).toBe("none");
  });

  it("refuses a file it cannot keep", async () => {
    const bad = async (folders: unknown[]) =>
      (await t.put("/api/library-files/folders", { file: { version: 1, folders }, revision: 0 }))
        .statusCode;
    expect(await bad([{ path: "A", icon: "rocket" }])).toBe(400);
    expect(await bad([{ path: "A", color: "red" }])).toBe(400);
    expect(await bad([{ path: ".frontier/maps" }])).toBe(400);
    expect(await bad([{ path: "A", type: "dragon" }])).toBe(400);
    expect(await bad([{ path: "A" }, { path: "A" }])).toBe(400);
    expect((await t.get("/api/library-files/other")).statusCode).toBe(400);
  });

  it("refuses a save from older text, repeats a send without writing, and settles a clash", async () => {
    const first = await load();
    const one: FolderFile = { version: 1, folders: [{ path: "New A" }] };
    expect((await save(one, 0, { baseBlob: "", op: "bbbbbbbbbbbb" })).statusCode).toBe(200);
    // The same send again writes nothing.
    const again = await save(one, 0, { baseBlob: "", op: "bbbbbbbbbbbb" });
    expect(again.json().revision).toBe(1);
    // A device that knew no draft is told to merge.
    const stale = await save({ version: 1, folders: [{ path: "New B" }] }, 0, {
      baseBlob: first.blob,
      op: "cccccccccccc",
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("stale_revision");
    expect((await save(one, 5)).json().error.code).toBe("stale_revision");

    // Saved as a version, then changed on both sides: a clash is held back at publish.
    await publishAll();
    const mine = await load();
    expect(mine.blob).not.toBe("");
    // A save that started from the library's copy before it moved is stale too.
    expect(
      (await save(one, 0, { baseBlob: "0".repeat(40), op: "dddddddddddd" })).json().error.code,
    ).toBe("stale_revision");
    await save({ version: 1, folders: [{ path: "New A", color: "rose" }] }, 0, {
      baseBlob: mine.blob,
    });
    t.repo.pushFromOutside({
      [FOLDER_FILE]: serialiseFolders({ version: 1, folders: [{ path: "New A", color: "moss" }] }),
    });
    const { plan } = await publishAll();
    expect(plan.conflicts.map((c) => c.reason)).toEqual(["folders_changed_on_both"]);
    expect((await t.post("/api/library-files/folders/resolve", { keep: "mine" })).statusCode).toBe(
      200,
    );
    const after = await publishAll();
    expect(after.res.statusCode, after.res.body).toBe(200);
    expect(t.repo.remoteFile(FOLDER_FILE)).toContain('"color":"rose"');
    expect(
      (await t.post("/api/library-files/folders/resolve", { keep: "theirs" })).statusCode,
    ).toBe(404);
  });

  it("merges changes to different folders at publish", async () => {
    await save({ version: 1, folders: [{ path: "A" }, { path: "B" }] }, 0, { baseBlob: "" });
    await publishAll();
    const base = await load();
    await save({ version: 1, folders: [{ path: "A", color: "rose" }, { path: "B" }] }, 0, {
      baseBlob: base.blob,
    });
    t.repo.pushFromOutside({
      [FOLDER_FILE]: serialiseFolders({
        version: 1,
        folders: [{ path: "A" }, { path: "B", icon: "ship" }],
      }),
    });
    const { plan, res } = await publishAll();
    expect(plan.merges).toHaveLength(1);
    expect(res.statusCode, res.body).toBe(200);
    expect(t.repo.remoteFile(FOLDER_FILE)).toContain('{"path":"A","color":"rose"}');
    expect(t.repo.remoteFile(FOLDER_FILE)).toContain('{"path":"B","icon":"ship"}');
  });

  it("shows a line whose folder went some other way as an empty folder, and reports a broken file", async () => {
    await save({ version: 1, folders: [{ path: "02 People", icon: "users" }] }, 0, {
      baseBlob: "",
    });
    await publishAll();
    t.repo.pushFromOutside({
      "02 People/Mira.md": null,
      "02 People/Shade.md": null,
      "02 People/Twin.md": null,
    });
    await t.services.sync();
    expect(find((await tree()).folders, "02 People")).toMatchObject({
      icon: "users",
      empty: true,
    });
    t.repo.pushFromOutside({ [FOLDER_FILE]: "{ not json" });
    await t.services.sync();
    expect((await status()).problems.join(" ")).toContain(`${FOLDER_FILE} cannot be read.`);
  });
});

describe("deleting a folder", () => {
  it("counts first, then marks every entry for deletion and removes the lines", async () => {
    await save(
      {
        version: 1,
        folders: [
          { path: "01 Places", type: "place" },
          { path: "01 Places/Empty Hall" },
          { path: "02 People" },
        ],
      },
      0,
    );
    await publishAll();
    const dry = await t.post("/api/folders/delete", { path: "01 Places", dryRun: true });
    expect(dry.json()).toEqual({ entries: 4, folders: 3 });
    expect(UnpublishedResponse.parse((await t.get("/api/unpublished")).json()).drafts).toEqual([]);
    const done = await t.post("/api/folders/delete", { path: "01 Places" });
    expect(done.json()).toEqual({ entries: 4, folders: 3 });
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(un.drafts.filter((d) => d.kind === "delete").map((d) => d.path)).toEqual([
      "01 Places/Harbor/Harbor.md",
      "01 Places/Harbor/Old Quay.md",
      "01 Places/Marsh/The Marsh.md",
      "01 Places/Unwritten.md",
    ]);
    expect((await load()).file.folders.map((l) => l.path)).toEqual(["02 People"]);
    expect(find((await tree()).folders, "01 Places")).toBeUndefined();
    // Deleting it again finds nothing.
    expect((await t.post("/api/folders/delete", { path: "01 Places" })).statusCode).toBe(409);
  });

  it("deletes an empty folder by its line alone", async () => {
    await save({ version: 1, folders: [{ path: "Nothing Here" }] }, 0);
    const res = await t.post("/api/folders/delete", { path: "Nothing Here" });
    expect(res.json()).toEqual({ entries: 0, folders: 0 });
    expect((await load()).file.folders).toEqual([]);
    expect((await t.post("/api/folders/delete", { path: "Nothing Here" })).statusCode).toBe(404);
  });

  it("refuses while anything under it is unpublished, an image, append-only or mixed", async () => {
    const refusal = async (path: string) => {
      const res = await t.post("/api/folders/delete", { path });
      return [res.statusCode, res.json().error.code, res.json().error.message];
    };
    await t.put("/api/drafts", {
      id: "draftaaaaaaa",
      path: "02 People/Mira.md",
      kind: "edit",
      text: "Changed",
      revision: 0,
    });
    expect(await refusal("02 People")).toEqual([
      409,
      "has_drafts",
      "1 entry here has unpublished changes. Save a version or discard them first.",
    ]);
    expect((await refusal("03 Things"))[1]).toBe("read_only_file");
    expect((await refusal("99 Appendices/Logs"))[1]).toBe("append_only");
    t.repo.pushFromOutside({ "04 Pictures/a.png": "png", "05 Data/a.json": "{}" });
    await t.services.sync();
    expect(await refusal("04 Pictures")).toEqual([
      409,
      "has_images",
      "1 image is kept here. Move it out first.",
    ]);
    expect((await refusal("05 Data"))[2]).toBe("1 file here is not an entry. Move it out first.");
    // A rename waiting inside counts as an unpublished change.
    await t.post("/api/renames", { from: "01 Places/Unwritten.md", to: "01 Places/Written.md" });
    expect((await refusal("01 Places"))[1]).toBe("has_drafts");
  });
});

describe("applying a folder's type", () => {
  it("writes the type only into entries without one", async () => {
    t.repo.pushFromOutside({
      "01 Places/Typed.md": "---\ntype: person\n---\nA person among places.\n",
    });
    await t.services.sync();
    const res = await t.post("/api/folders/apply-type", { path: "01 Places" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ made: 4 });
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(un.drafts.map((d) => d.path).sort()).toEqual([
      "01 Places/Harbor/Harbor.md",
      "01 Places/Harbor/Old Quay.md",
      "01 Places/Marsh/The Marsh.md",
      "01 Places/Unwritten.md",
    ]);
    expect(un.drafts.every((d) => d.text.includes("type: place"))).toBe(true);
    // Run again, nothing is left to do.
    expect((await t.post("/api/folders/apply-type", { path: "01 Places" })).json()).toEqual({
      made: 0,
    });
    expect((await t.post("/api/folders/apply-type", { path: "03 Things" })).statusCode).toBe(400);
  });
});

describe("the other side of a folder line clash (stage 15c)", () => {
  const keptCount = () => t.services.status.snapshot().attention.keptCopies;

  it("keeps the replaced folder file, made from the library's copy when it has no draft", async () => {
    // The file is in the library, with no draft.
    expect(
      (await save({ version: 1, folders: [{ path: "A", color: "ember" }] }, 0)).statusCode,
    ).toBe(200);
    expect((await publishAll()).res.statusCode).toBe(200);
    const published = await load();
    expect(published.revision).toBe(0);
    const before = keptCount();
    const res = await save({ version: 1, folders: [{ path: "A", color: "sea" }] }, 0, {
      baseBlob: published.blob,
      clashes: ["A"],
    });
    expect(res.statusCode, res.body).toBe(200);
    const draft = t.services.drafts.byPath(FOLDER_FILE)!;
    expect(res.json().kept).toBe(draft.id);
    expect(keptCount()).toBe(before + 1);
    const versions = (await t.get(`/api/drafts/${draft.id}/versions`)).json();
    expect(versions).toMatchObject({ path: FOLDER_FILE });
    expect(versions.others[0]).toMatchObject({ source: "server", clashes: ["A"] });
    const kept = parseFolders(versions.others[0].text);
    expect(kept.ok && kept.file.folders).toEqual([{ path: "A", color: "ember" }]);

    // A second clash on another line keeps the first line's other side as it was.
    const now = await load();
    const res2 = await save(
      { version: 1, folders: [{ path: "A", color: "moss" }, { path: "B" }] },
      now.revision,
      { clashes: ["B"] },
    );
    expect(res2.json().kept).toBe(draft.id);
    const again = (await t.get(`/api/drafts/${draft.id}/versions`)).json();
    expect(again.others[0].clashes).toEqual(["A", "B"]);
    const both = parseFolders(again.others[0].text);
    expect(both.ok && both.file.folders).toEqual([{ path: "A", color: "ember" }]);

    // Dismissed, the count goes down.
    expect((await t.del(`/api/drafts/${draft.id}/versions/server`)).statusCode).toBe(200);
    expect(keptCount()).toBe(before);
  });
});
