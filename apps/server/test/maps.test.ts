import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DraftVersionsResponse,
  EntryResponse,
  type MapFile,
  parseMap,
  PublishPlan,
  serialiseMap,
  TreeResponse,
  UnpublishedResponse,
} from "@frontier/schema";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp({ ICON_FOLDER: "99 Appendices/Icons" });
  await t.login();
});
afterEach(() => t.close());

const IMAGE = "99 Appendices/Images/map one.png";
const MIRA = "02 People/Mira.md";
const file = (id: string) => `.frontier/maps/${id}.json`;

async function create(kind: "sphere" | "flat" = "sphere", title = "Ezob") {
  const res = await t.post("/api/maps", { title, kind, image: IMAGE });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().id as string;
}
async function load(id: string) {
  const res = await t.get(`/api/maps/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    map: MapFile;
    revision: number;
    state: string;
    blob: string;
    entries: Record<string, { path: string; title: string }>;
    children: Record<string, string>;
  };
}
const marker = (id: string, layer: string, at: [number, number] = [10, 20]) => ({
  id,
  kind: "marker" as const,
  layer,
  at,
  entry: null,
  label: id,
  icon: null,
  child: null,
});
const save = (id: string, map: MapFile, revision: number, link: unknown[] = []) =>
  t.put(`/api/maps/${id}`, { map, revision, link });

async function publishAll(message = "Publish") {
  const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
  const plan = PublishPlan.parse(
    (
      await t.post("/api/publish/plan", { draftIds: un.drafts.map((d) => d.id), renameIds: [] })
    ).json(),
  );
  const res = await t.post("/api/publish/confirm", {
    planId: plan.planId,
    confirmedMergeIds: plan.merges.map((m) => m.id),
    message,
  });
  return { un, plan, res };
}
const onMain = (id: string) => {
  const text = t.repo.remoteFile(file(id));
  if (text === null) return null;
  const parsed = parseMap(text);
  return parsed.ok ? parsed.map : null;
};

describe("map files", () => {
  it("creates a globe and a flat map as drafts, with the image's size as the flat frame", async () => {
    const globe = await create("sphere");
    const flat = await create("flat", "Harbor town");
    const g = await load(globe);
    expect(g.state).toBe("new");
    expect(g.revision).toBe(1);
    expect(g.map.space).toEqual({ kind: "sphere", radius: null, unit: "km" });
    expect(g.map.images[0]).toMatchObject({
      path: IMAGE,
      extent: [-180, -90, 180, 90],
      visible: true,
    });
    expect(g.map.layers).toHaveLength(1);
    expect(g.map.markerSets).toEqual(["Icons"]);
    const f = (await load(flat)).map;
    expect(f.space.kind).toBe("flat");
    if (f.space.kind === "flat") {
      expect(f.images[0]!.extent).toEqual([0, 0, f.space.width, f.space.height]);
      expect(f.space.width).toBeGreaterThan(0);
    }
    // Nothing is in the vault yet, and a map is not an entry.
    expect(t.repo.remoteFile(file(globe))).toBeNull();
    const list = (await t.get("/api/maps")).json();
    expect(list.maps.map((m: { title: string; state: string }) => [m.title, m.state])).toEqual([
      ["Ezob", "new"],
      ["Harbor town", "new"],
    ]);
    const tree = JSON.stringify(TreeResponse.parse((await t.get("/api/tree")).json()));
    expect(tree).not.toContain(".frontier");
    expect((await t.get("/api/switcher?q=" + globe)).json().results).toEqual([]);
    const bad = await t.post("/api/maps", { title: "X", kind: "flat", image: "02 People/Mira.md" });
    expect(bad.statusCode).toBe(400);
  });

  it("marks each map in the list with its version: the blob, then the draft's revision", async () => {
    const id = await create();
    const v = async () =>
      ((await t.get("/api/maps")).json().maps as { id: string; v: string }[]).find(
        (m) => m.id === id,
      )!.v;
    // New: no blob yet, the draft at revision 1.
    expect(await v()).toBe(".1");
    const { map } = await load(id);
    expect((await save(id, { ...map, title: "Ezob, again" }, 1)).statusCode).toBe(200);
    expect(await v()).toBe(".2");
    expect((await publishAll()).res.statusCode).toBe(200);
    const published = await v();
    expect(published).toBe((await load(id)).blob.slice(0, 12));
    expect(published).toMatch(/^[0-9a-f]{12}$/);
  });

  it("saves the whole map, one item per line, and publishes it like a note", async () => {
    const id = await create();
    const { map } = await load(id);
    const layer = map.layers[0]!.id;
    const next = {
      ...map,
      title: "Ezob, the world",
      features: [marker("f1", layer), marker("f2", layer)],
    };
    const saved = await save(id, next, 1);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().revision).toBe(2);

    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(un.drafts).toHaveLength(1);
    expect(un.drafts[0]).toMatchObject({ path: file(id), kind: "create", mainText: null });
    expect(
      un.drafts[0]!.text.split("\n").filter((l) => /^ {4}\{"id":"f[12]"/.test(l)),
    ).toHaveLength(2);

    const { res } = await publishAll("Add the map of Ezob");
    expect(res.statusCode, res.body).toBe(200);
    expect(onMain(id)!.title).toBe("Ezob, the world");
    expect(await load(id)).toMatchObject({ state: "published", revision: 0 });
    expect((await t.get("/api/unpublished")).json().drafts).toEqual([]);
  });

  it("checks where a save started from once its draft is gone, and writes nothing for a repeated op", async () => {
    const id = await create();
    await publishAll();
    const loaded = await load(id);
    const blob = loaded.blob;
    expect(blob).toMatch(/^[0-9a-f]{40}$/);
    // The draft this page knew of was saved as a version, and the file is as the page loaded it:
    // the save starts a new draft.
    const first = await t.put(`/api/maps/${id}`, {
      map: { ...loaded.map, title: "Renamed here" },
      revision: 1,
      baseBlob: blob,
      op: "sendop000001",
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().revision).toBe(1);
    // The same send again, its answer lost on the way: nothing more is written.
    const repeat = await t.put(`/api/maps/${id}`, {
      map: { ...loaded.map, title: "Renamed here" },
      revision: 1,
      baseBlob: blob,
      op: "sendop000001",
    });
    expect(repeat.json()).toMatchObject({ revision: 1, unlinked: [] });
    expect(repeat.json().map.title).toBe("Renamed here");

    // Saved as a version again, and then changed from outside: the next save is stale, so the
    // browser merges with what the library holds now.
    await publishAll();
    const now = await load(id);
    const changed = t.repo.pushFromOutside({
      [file(id)]: t.repo.remoteFile(file(id))!.replace("Renamed here", "Renamed outside"),
    });
    expect(changed).toBeTruthy();
    await t.services.sync();
    const stale = await t.put(`/api/maps/${id}`, {
      map: { ...now.map, title: "Mine" },
      revision: 1,
      baseBlob: now.blob,
      op: "sendop000002",
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("stale_revision");
    // No kept copy for an item file, and no draft either.
    expect((await t.get("/api/unpublished")).json().drafts).toEqual([]);
    const theirs = await load(id);
    expect(theirs.map.title).toBe("Renamed outside");
    const merged = await t.put(`/api/maps/${id}`, {
      map: { ...theirs.map, title: "Mine" },
      revision: 0,
      baseBlob: theirs.blob,
      op: "sendop000003",
    });
    expect(merged.statusCode, merged.body).toBe(200);
  });

  it("starts a new draft when the page saves a map whose draft was published", async () => {
    const id = await create();
    await publishAll();
    const { map } = await load(id);
    // The open page still holds revision 1.
    const res = await save(id, { ...map, title: "Renamed" }, 1);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().revision).toBe(1);
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(un.drafts[0]).toMatchObject({ kind: "edit" });
    expect(un.drafts[0]!.mainText).toContain('"title": "Ezob"');
    expect((await load(id)).state).toBe("unpublished");
  });

  it("answers a save from an older revision as stale, and refuses a map that is not valid", async () => {
    const id = await create();
    const { map } = await load(id);
    await save(id, { ...map, title: "First" }, 1);
    const stale = await save(id, { ...map, title: "Second" }, 1);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("stale_revision");
    expect((await load(id)).map.title).toBe("First");
    // No second version is kept for a map.
    expect((await publishAll()).res.statusCode).toBe(200);

    const broken = await save(id, { ...map, features: [marker("f1", "no-such-layer")] }, 0);
    expect(broken.statusCode).toBe(400);
    expect((await save(id, { ...map, id: "otherid1" }, 0)).statusCode).toBe(400);
    expect((await t.get("/api/maps/zzzzzzzz")).statusCode).toBe(404);
  });

  it("saves a label with its words and look, and refuses one without words", async () => {
    const id = await create();
    const { map } = await load(id);
    const layer = map.layers[0]!.id;
    const label = {
      id: "lab1",
      kind: "label" as const,
      layer,
      at: [10, 20] as [number, number],
      entry: null,
      label: "The Grey Sea",
      child: null,
      size: 24,
      rotate: 30,
    };
    const res = await save(id, { ...map, features: [label] }, 1);
    expect(res.statusCode, res.body).toBe(200);
    expect((await load(id)).map.features[0]).toEqual(label);
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(un.drafts[0]!.text).toContain('"label":"The Grey Sea","size":24,"rotate":30');

    const bad = await save(id, { ...map, features: [{ ...label, label: "" }] }, 2);
    expect(bad.statusCode).toBe(400);
  });

  it("does not let the note routes change a map draft", async () => {
    const id = await create();
    const draft = UnpublishedResponse.parse((await t.get("/api/unpublished")).json()).drafts[0]!;
    const put = await t.put("/api/drafts", {
      id: draft.id,
      path: file(id),
      kind: "edit",
      text: "{}",
      revision: 1,
    });
    expect(put.statusCode).toBe(400);
    expect((await t.post(`/api/drafts/${draft.id}/resolve`, { text: "{}" })).statusCode).toBe(400);
    expect(
      (await t.post(`/api/drafts/${draft.id}/merge-versions`, { text: "{}" })).statusCode,
    ).toBe(400);
    expect((await load(id)).map.id).toBe(id);
  });

  it("deletes a published map through a draft, and discards one that was never published", async () => {
    const fresh = await create("flat", "Scrap");
    expect((await t.del(`/api/maps/${fresh}`)).statusCode).toBe(200);
    expect((await t.get(`/api/maps/${fresh}`)).statusCode).toBe(404);

    const id = await create();
    await publishAll();
    await t.del(`/api/maps/${id}`);
    expect((await t.get(`/api/maps/${id}`)).statusCode).toBe(404);
    expect(t.repo.remoteFile(file(id))).not.toBeNull();
    expect((await publishAll("Remove the map")).res.statusCode).toBe(200);
    expect(t.repo.remoteFile(file(id))).toBeNull();
    expect((await t.get("/api/maps")).json().maps).toEqual([]);
  });

  it("lists a map file that cannot be read and does not show it", async () => {
    t.repo.pushFromOutside({
      ".frontier/maps/brokenmp.json": "{ not a map",
      ".frontier/maps/newer001.json": JSON.stringify({ version: 2 }),
    });
    await t.services.sync();
    const list = (await t.get("/api/maps")).json();
    expect(list.maps).toEqual([]);
    expect(list.problems.map((p: { path: string }) => p.path)).toEqual([
      ".frontier/maps/brokenmp.json",
      ".frontier/maps/newer001.json",
    ]);
    expect((await t.get("/api/status")).json().problems).toHaveLength(2);
  });

  it("offers the folders of icons as marker sets, and serves images at the sizes maps ask for", async () => {
    const sets = (await t.get("/api/marker-sets")).json().sets;
    expect(sets).toEqual([
      { name: "Icons", icons: [{ name: "Lamp", path: "99 Appendices/Icons/Lamp.png" }] },
    ]);
    const icon = await t.get(
      `/api/images?path=${encodeURIComponent("99 Appendices/Icons/Lamp.png")}`,
    );
    expect(icon.statusCode).toBe(200);
    const big = await t.get(`/api/images?path=${encodeURIComponent(IMAGE)}&w=4096`);
    expect(big.statusCode).toBe(200);
    expect((await t.get(`/api/images?path=${encodeURIComponent(IMAGE)}&w=999`)).statusCode).toBe(
      400,
    );
  });
});

describe("linking entries", () => {
  it("writes an id into the entry, finds it before it is published, and publishes both together", async () => {
    const id = await create();
    const { map } = await load(id);
    const layer = map.layers[0]!.id;
    const res = await save(id, { ...map, features: [marker("f1", layer)] }, 1, [
      { feature: "f1", path: MIRA },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const entryId = res.json().map.features[0].entry as string;
    expect(entryId).toMatch(/^[a-z0-9]{8}$/);
    expect(res.json().unlinked).toEqual([]);

    // Before anything is published the marker opens its entry, and the entry lists the map.
    const loaded = await load(id);
    expect(loaded.entries[entryId]).toEqual({ path: MIRA, title: "Mira" });
    const byId = EntryResponse.parse((await t.get(`/api/entries?id=${entryId}`)).json());
    expect(byId.path).toBe(MIRA);
    expect(byId.maps).toEqual([{ id, title: "Ezob", feature: "f1" }]);

    // Publishing the map alone is held back: its id would not be in the vault.
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    const mapDraft = un.drafts.find((d) => d.path === file(id))!;
    const alone = PublishPlan.parse(
      (await t.post("/api/publish/plan", { draftIds: [mapDraft.id], renameIds: [] })).json(),
    );
    expect(alone.groups).toHaveLength(1);
    const refused = await t.post("/api/publish/confirm", {
      planId: alone.planId,
      confirmedMergeIds: [],
      message: "Map alone",
    });
    expect(refused.statusCode).toBe(400);
    expect(t.repo.remoteFile(file(id))).toBeNull();

    expect((await publishAll("Map and id")).res.statusCode).toBe(200);
    expect(t.repo.remoteFile(MIRA)).toContain(`id: ${entryId}`);
    expect(onMain(id)!.features[0]!.entry).toBe(entryId);
    // A second link to the same entry reuses the id and needs no new draft.
    const again = await save(
      id,
      { ...onMain(id)!, features: [...onMain(id)!.features, marker("f2", layer)] },
      0,
      [{ feature: "f2", path: MIRA }],
    );
    expect(again.json().map.features[1].entry).toBe(entryId);
    expect((await t.get("/api/unpublished")).json().drafts).toHaveLength(1);
  });

  it("saves the map with the feature left unlinked when the entry cannot take an id", async () => {
    const id = await create();
    const { map } = await load(id);
    const layer = map.layers[0]!.id;
    const appendix = t.services.index.files.find(
      (f) => f.startsWith("99 Appendices/") && f.endsWith(".md"),
    )!;
    const res = await save(
      id,
      { ...map, features: [marker("f1", layer), marker("f2", layer)] },
      1,
      [
        { feature: "f1", path: appendix },
        { feature: "f2", path: "notes.json" },
        { feature: "gone", path: MIRA },
      ],
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().unlinked.map((u: { feature: string }) => u.feature)).toEqual(["f1", "f2"]);
    expect(res.json().map.features.map((f: { entry: string | null }) => f.entry)).toEqual([
      null,
      null,
    ]);
  });
});

describe("a map changed here and in the vault", () => {
  async function published() {
    const id = await create();
    const { map } = await load(id);
    const layer = map.layers[0]!.id;
    await save(id, { ...map, features: [marker("f1", layer), marker("f2", layer)] }, 1);
    await publishAll();
    return { id, layer, map: onMain(id)! };
  }

  it("is merged item by item at publish, after confirmation", async () => {
    const { id, layer, map } = await published();
    await save(id, { ...map, features: [...map.features, marker("mine", layer)] }, 0);
    // Another device's publish, or Obsidian, changed the file meanwhile.
    t.repo.pushFromOutside({
      [file(id)]: serialiseMap({ ...map, features: [...map.features, marker("theirs", layer)] }),
    });
    const { plan, res } = await publishAll("Merge the map");
    expect(plan.merges.map((m) => m.path)).toEqual([file(id)]);
    expect(res.statusCode, res.body).toBe(200);
    expect(onMain(id)!.features.map((f) => f.id)).toEqual(["f1", "f2", "theirs", "mine"]);
  });

  it("is a conflict when both moved the same marker, settled by keeping one whole map", async () => {
    for (const keep of ["mine", "theirs"] as const) {
      const { id, map } = await published();
      const moved = (at: [number, number]) => ({
        ...map,
        features: map.features.map((f) => (f.id === "f1" ? { ...f, at } : f)),
      });
      await save(id, moved([1, 1]) as MapFile, 0);
      t.repo.pushFromOutside({ [file(id)]: serialiseMap(moved([2, 2]) as MapFile) });
      const { plan, res } = await publishAll();
      expect(plan.conflicts.map((c) => c.reason)).toEqual(["map_changed_on_both"]);
      expect(res.statusCode).toBe(400);

      expect((await t.post(`/api/maps/${id}/resolve`, { keep })).statusCode).toBe(200);
      if (keep === "mine") expect((await publishAll()).res.statusCode).toBe(200);
      else expect((await t.get("/api/unpublished")).json().drafts).toEqual([]);
      const at = (onMain(id)!.features[0] as { at: number[] }).at;
      expect(at).toEqual(keep === "mine" ? [1, 1] : [2, 2]);
      await t.del(`/api/maps/${id}`);
      await publishAll();
    }
  });
});

describe("the other side of an item clash (stage 15c)", () => {
  const keptCount = () => t.services.status.snapshot().attention.keptCopies;
  const versionsOf = async (draftId: string) =>
    DraftVersionsResponse.parse((await t.get(`/api/drafts/${draftId}/versions`)).json());
  const draftOf = (id: string) => t.services.drafts.byPath(file(id))!;

  async function withLighthouse() {
    const id = await create();
    const { map } = await load(id);
    const layer = map.layers[0]!.id;
    const res = await save(id, { ...map, features: [marker("lighthouse", layer)] }, 1);
    expect(res.statusCode, res.body).toBe(200);
    return { id, layer };
  }

  it("keeps the replaced side of a map with a draft, answers kept, and unions a second clash", async () => {
    const { id, layer } = await withLighthouse();
    // The laptop renames the marker and the map; its save is sent first.
    const theirs = await load(id);
    const laptop = {
      ...theirs.map,
      title: "Coast",
      features: [{ ...marker("lighthouse", layer), label: "Old Light" }],
    };
    expect((await save(id, laptop, theirs.revision)).statusCode).toBe(200);
    const before = keptCount();

    // The phone moved it; its queue merged and keeps its own side of the marker.
    const merged = await load(id);
    const phone = { ...merged.map, features: [marker("lighthouse", layer, [40, 50])] };
    const res = await t.put(`/api/maps/${id}`, {
      map: phone,
      revision: merged.revision,
      link: [],
      clashes: ["lighthouse"],
    });
    expect(res.statusCode, res.body).toBe(200);
    const draft = draftOf(id);
    expect(res.json().kept).toBe(draft.id);
    expect(keptCount()).toBe(before + 1);
    const versions = await versionsOf(draft.id);
    expect(versions.path).toBe(file(id));
    expect(versions.others).toHaveLength(1);
    expect(versions.others[0]).toMatchObject({
      device: "server",
      source: "server",
      clashes: ["lighthouse"],
    });
    const kept = parseMap(versions.others[0]!.text);
    expect(kept.ok && kept.map.features[0]!.label).toBe("Old Light");
    expect(parseMap(versions.current.text).ok).toBe(true);

    // A later clash on the title: the earlier item's other side stays as it was kept.
    const now = await load(id);
    const laptop2 = {
      ...now.map,
      title: "Coast, again",
      features: [{ ...marker("lighthouse", layer), label: "Newer label" }],
    };
    expect((await save(id, laptop2, now.revision)).statusCode).toBe(200);
    const next = await load(id);
    const second = await t.put(`/api/maps/${id}`, {
      map: { ...next.map, title: "Phone title" },
      revision: next.revision,
      link: [],
      clashes: ["title"],
    });
    expect(second.json().kept).toBe(draft.id);
    const again = await versionsOf(draft.id);
    expect(again.others[0]!.clashes).toEqual(["lighthouse", "title"]);
    const both = parseMap(again.others[0]!.text);
    expect(both.ok && both.map.features[0]!.label).toBe("Old Light");
    expect(both.ok && both.map.title).toBe("Coast, again");
    expect(keptCount()).toBe(before + 1);

    // Saving the draft as a version is not held back by it, and clears it.
    await publishAll();
    expect(keptCount()).toBe(before);
  });

  it("makes the draft first from the library's copy for a map with no draft", async () => {
    const { id, layer } = await withLighthouse();
    await publishAll();
    const published = await load(id);
    expect(published.revision).toBe(0);
    const res = await t.put(`/api/maps/${id}`, {
      map: { ...published.map, features: [marker("lighthouse", layer, [1, 2])] },
      revision: 0,
      link: [],
      baseBlob: published.blob,
      clashes: ["lighthouse"],
    });
    expect(res.statusCode, res.body).toBe(200);
    const draft = draftOf(id);
    expect(res.json()).toMatchObject({ kept: draft.id, revision: 2 });
    const versions = await versionsOf(draft.id);
    expect(versions.others[0]!.text).toBe(t.repo.remoteFile(file(id)));
  });

  it("keeps nothing for a save without clashes, as from an older build, and repeats kept for a resend", async () => {
    const { id, layer } = await withLighthouse();
    const now = await load(id);
    const plain = await save(id, { ...now.map, title: "Plain" }, now.revision);
    expect(plain.json().kept).toBeUndefined();
    expect(t.services.drafts.hasKeptCopies(draftOf(id).id)).toBe(false);

    const body = {
      map: { ...now.map, features: [marker("lighthouse", layer, [3, 4])] },
      revision: now.revision + 1,
      link: [],
      clashes: ["lighthouse"],
      op: "clashop00001",
    };
    const first = await t.put(`/api/maps/${id}`, body);
    expect(first.statusCode, first.body).toBe(200);
    const repeat = await t.put(`/api/maps/${id}`, body);
    expect(repeat.json()).toMatchObject({
      kept: first.json().kept,
      revision: first.json().revision,
    });
  });

  it("dismisses the kept copy, which lowers the attention count", async () => {
    const { id, layer } = await withLighthouse();
    const now = await load(id);
    await t.put(`/api/maps/${id}`, {
      map: { ...now.map, features: [marker("lighthouse", layer, [5, 6])] },
      revision: now.revision,
      link: [],
      clashes: ["lighthouse"],
    });
    const draft = draftOf(id);
    const before = keptCount();
    const res = await t.del(`/api/drafts/${draft.id}/versions/server`);
    expect(res.statusCode, res.body).toBe(200);
    expect(keptCount()).toBe(before - 1);
    expect((await t.get(`/api/drafts/${draft.id}/versions`)).statusCode).toBe(404);
    expect((await t.del(`/api/drafts/zzzzzzzzzzzz/versions/server`)).statusCode).toBe(404);
    // The draft itself stays.
    expect(draftOf(id).id).toBe(draft.id);
  });
});
