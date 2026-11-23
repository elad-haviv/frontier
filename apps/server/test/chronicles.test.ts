import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ChronicleFile,
  type ChronicleSpan,
  parseChronicle,
  PublishPlan,
  serialiseChronicle,
  TreeResponse,
  UnpublishedResponse,
} from "@frontier/schema";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
  await t.login();
});
afterEach(() => t.close());

const file = (id: string) => `.frontier/chronicles/${id}.json`;
const MIRA = "02 People/Mira.md";

async function create(body: object = { title: "Ezob, humans arrive early" }) {
  const res = await t.post("/api/chronicles", body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().id as string;
}
async function load(id: string) {
  const res = await t.get(`/api/chronicles/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    chronicle: ChronicleFile;
    revision: number;
    state: string;
    blob: string;
    entries: Record<string, { path: string; title: string }>;
  };
}
const span = (id: string, lane: string, extra: Partial<ChronicleSpan> = {}): ChronicleSpan => ({
  id,
  lane,
  name: id,
  point: false,
  start: null,
  end: null,
  length: null,
  entry: null,
  note: "",
  ...extra,
});
const save = (id: string, chronicle: ChronicleFile, revision: number, link: unknown[] = []) =>
  t.put(`/api/chronicles/${id}`, { chronicle, revision, link });

async function saveVersion(message = "Save") {
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
  const parsed = parseChronicle(text);
  return parsed.ok ? parsed.chronicle : null;
};

describe("chronicle files", () => {
  it("makes a chronicle with one lane as a draft, and it is not an entry", async () => {
    const id = await create();
    const c = await load(id);
    expect(c.state).toBe("new");
    expect(c.revision).toBe(1);
    expect(c.chronicle).toMatchObject({
      title: "Ezob, humans arrive early",
      main: false,
      clock: "ezob",
      origin: null,
      spans: [],
      lanes: [{ name: "Main" }],
    });
    expect(t.repo.remoteFile(file(id))).toBeNull();
    expect(JSON.stringify(TreeResponse.parse((await t.get("/api/tree")).json()))).not.toContain(
      ".frontier",
    );
    expect((await t.post("/api/chronicles", {})).statusCode).toBe(400);
    expect((await t.get("/api/chronicles/zzzzzzzz")).statusCode).toBe(404);
  });

  it("saves the whole chronicle, one item per line, and keeps it as a version", async () => {
    const id = await create();
    const { chronicle } = await load(id);
    const lane = chronicle.lanes[0]!.id;
    const next: ChronicleFile = {
      ...chronicle,
      units: [{ id: "unit0001", name: "generation", low: 20, high: 35 }],
      spans: [
        span("landing1", lane, {
          name: "First Landing",
          point: true,
          start: { words: "", low: 0, high: 0 },
        }),
        span("fading01", lane, {
          name: "Earth memory fades",
          length: {
            words: "3 to 5 generations",
            low: 60,
            high: 175,
            clock: "ezob",
            unit: "unit0001",
            count: [3, 5],
          },
        }),
      ],
      relations: [{ id: "rel00001", a: "fading01", kind: "starts_with", b: "landing1" }],
      origin: "landing1",
    };
    const saved = await save(id, next, 1);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().revision).toBe(2);

    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(un.drafts[0]).toMatchObject({ path: file(id), kind: "create", mainText: null });
    expect(un.drafts[0]!.text.split("\n").filter((l) => l.startsWith('    {"id":'))).toHaveLength(
      5,
    );

    expect((await saveVersion("Add the chronicle")).res.statusCode).toBe(200);
    expect(onMain(id)!.spans.map((s) => s.name)).toEqual(["First Landing", "Earth memory fades"]);
    expect(await load(id)).toMatchObject({ state: "published", revision: 0 });
    const list = (await t.get("/api/chronicles")).json();
    expect(list.chronicles).toEqual([
      {
        id,
        title: "Ezob, humans arrive early",
        main: false,
        spans: 2,
        state: "published",
        // Published, with no draft: the blob's first 12 characters only.
        v: (await load(id)).blob.slice(0, 12),
      },
    ]);
  });

  it("checks where a save started from once its draft is gone, and writes nothing for a repeated op", async () => {
    const id = await create();
    await saveVersion();
    const loaded = await load(id);
    const blob = loaded.blob;
    expect(blob).toMatch(/^[0-9a-f]{40}$/);
    // The draft this page knew of was saved as a version, and the file is as the page loaded it:
    // the save starts a new draft.
    const first = await t.put(`/api/chronicles/${id}`, {
      chronicle: { ...loaded.chronicle, title: "Renamed here" },
      revision: 1,
      baseBlob: blob,
      op: "sendop000001",
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().revision).toBe(1);
    // The same send again, its answer lost on the way: nothing more is written.
    const repeat = await t.put(`/api/chronicles/${id}`, {
      chronicle: { ...loaded.chronicle, title: "Renamed here" },
      revision: 1,
      baseBlob: blob,
      op: "sendop000001",
    });
    expect(repeat.json()).toMatchObject({ revision: 1, unlinked: [] });
    expect(repeat.json().chronicle.title).toBe("Renamed here");

    // Saved as a version again, and then changed from outside: the next save is stale, so the
    // browser merges with what the library holds now.
    await saveVersion();
    const now = await load(id);
    const changed = t.repo.pushFromOutside({
      [`.frontier/chronicles/${id}.json`]: t.repo
        .remoteFile(`.frontier/chronicles/${id}.json`)!
        .replace("Renamed here", "Renamed outside"),
    });
    expect(changed).toBeTruthy();
    await t.services.sync();
    const stale = await t.put(`/api/chronicles/${id}`, {
      chronicle: { ...now.chronicle, title: "Mine" },
      revision: 1,
      baseBlob: now.blob,
      op: "sendop000002",
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("stale_revision");
    // No kept copy for an item file, and no draft either.
    expect((await t.get("/api/unpublished")).json().drafts).toEqual([]);
    const theirs = await load(id);
    expect(theirs.chronicle.title).toBe("Renamed outside");
    const merged = await t.put(`/api/chronicles/${id}`, {
      chronicle: { ...theirs.chronicle, title: "Mine" },
      revision: 0,
      baseBlob: theirs.blob,
      op: "sendop000003",
    });
    expect(merged.statusCode, merged.body).toBe(200);
  });

  it("starts a new draft when the page saves after its draft was saved as a version", async () => {
    const id = await create();
    await saveVersion();
    const { chronicle } = await load(id);
    const res = await save(id, { ...chronicle, title: "Renamed" }, 1);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().revision).toBe(1);
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(un.drafts[0]).toMatchObject({ kind: "edit" });
    expect(un.drafts[0]!.mainText).toContain('"title": "Ezob, humans arrive early"');
  });

  it("answers an older save as stale, and refuses what is not a valid chronicle", async () => {
    const id = await create();
    const { chronicle } = await load(id);
    await save(id, { ...chronicle, title: "First" }, 1);
    const stale = await save(id, { ...chronicle, title: "Second" }, 1);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("stale_revision");
    expect((await load(id)).chronicle.title).toBe("First");

    expect((await save(id, { ...chronicle, lanes: [] }, 2)).statusCode).toBe(400);
    expect(
      (await save(id, { ...chronicle, spans: [span("s", "no-such-lane")] }, 2)).statusCode,
    ).toBe(400);
    expect((await save(id, { ...chronicle, id: "otherid1" }, 2)).statusCode).toBe(400);
  });

  it("does not let the note routes change a chronicle draft", async () => {
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
    expect((await load(id)).chronicle.id).toBe(id);
  });

  it("copies a chronicle as the author sees it, keeping the ids inside and never the main mark", async () => {
    const id = await create();
    const { chronicle } = await load(id);
    const lane = chronicle.lanes[0]!.id;
    await save(id, { ...chronicle, main: true, spans: [span("keepid01", lane)] }, 1);
    const copy = await create({ copyOf: id });
    const c = (await load(copy)).chronicle;
    expect(c.id).toBe(copy);
    expect(c.title).toBe("Copy of Ezob, humans arrive early");
    expect(c.main).toBe(false);
    expect(c.spans.map((s) => s.id)).toEqual(["keepid01"]);
    expect(c.lanes[0]!.id).toBe(lane);
    expect((await t.post("/api/chronicles", { copyOf: "zzzzzzzz" })).statusCode).toBe(404);
  });

  it("makes one chronicle the main one and takes the mark off the other", async () => {
    const a = await create({ title: "A" });
    const b = await create({ title: "B" });
    expect((await t.post(`/api/chronicles/${a}/main`)).statusCode).toBe(200);
    expect((await load(a)).chronicle.main).toBe(true);
    await saveVersion("Two chronicles");
    await t.post(`/api/chronicles/${b}/main`);
    expect((await load(a)).chronicle.main).toBe(false);
    expect((await load(b)).chronicle.main).toBe(true);
    // Both changes wait as drafts and go out together.
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    expect(un.drafts.map((d) => d.path).sort()).toEqual([file(a), file(b)].sort());
    await saveVersion("Change the main chronicle");
    expect(onMain(a)!.main).toBe(false);
    expect(onMain(b)!.main).toBe(true);
    expect((await t.get("/api/status")).json().problems).toEqual([]);
  });

  it("deletes a saved chronicle through a draft, and discards one never saved", async () => {
    const fresh = await create({ title: "Scrap" });
    await t.del(`/api/chronicles/${fresh}`);
    expect((await t.get(`/api/chronicles/${fresh}`)).statusCode).toBe(404);
    const id = await create();
    await saveVersion();
    await t.del(`/api/chronicles/${id}`);
    expect(t.repo.remoteFile(file(id))).not.toBeNull();
    await saveVersion("Remove it");
    expect(t.repo.remoteFile(file(id))).toBeNull();
  });

  it("lists a file that cannot be read, and two marked as main, without failing", async () => {
    const id = await create({ title: "One" });
    const other = await create({ title: "Two" });
    await saveVersion();
    const one = onMain(id)!;
    const two = onMain(other)!;
    t.repo.pushFromOutside({
      ".frontier/chronicles/brokench.json": "{ nope",
      [file(id)]: serialiseChronicle({ ...one, main: true }),
      [file(other)]: serialiseChronicle({ ...two, main: true }),
    });
    await t.services.sync();
    const list = (await t.get("/api/chronicles")).json();
    expect(list.chronicles).toHaveLength(2);
    expect(list.problems).toHaveLength(2);
    expect((await t.get("/api/status")).json().problems).toHaveLength(2);
  });
});

describe("a chronicle changed here and in the library", () => {
  async function saved() {
    const id = await create();
    const { chronicle } = await load(id);
    const lane = chronicle.lanes[0]!.id;
    await save(id, { ...chronicle, spans: [span("s0000001", lane), span("s0000002", lane)] }, 1);
    await saveVersion();
    return { id, lane, chronicle: onMain(id)! };
  }

  it("is merged item by item when a version is saved", async () => {
    const { id, lane, chronicle } = await saved();
    await save(id, { ...chronicle, spans: [...chronicle.spans, span("mine0001", lane)] }, 0);
    t.repo.pushFromOutside({
      [file(id)]: serialiseChronicle({
        ...chronicle,
        relations: [{ id: "rtheirs1", a: "s0000001", kind: "after", b: "s0000002" }],
      }),
    });
    const { plan, res } = await saveVersion("Merge");
    expect(plan.merges.map((m) => m.path)).toEqual([file(id)]);
    expect(res.statusCode, res.body).toBe(200);
    const merged = onMain(id)!;
    expect(merged.spans.map((s) => s.id)).toEqual(["s0000001", "s0000002", "mine0001"]);
    expect(merged.relations).toHaveLength(1);
  });

  it("is a conflict when both changed the same span, settled by keeping one whole chronicle", async () => {
    for (const keep of ["mine", "theirs"] as const) {
      const { id, chronicle } = await saved();
      const named = (name: string): ChronicleFile => ({
        ...chronicle,
        spans: chronicle.spans.map((s) => (s.id === "s0000001" ? { ...s, name } : s)),
      });
      await save(id, named("Mine"), 0);
      t.repo.pushFromOutside({ [file(id)]: serialiseChronicle(named("Theirs")) });
      const { plan, res } = await saveVersion();
      expect(plan.conflicts.map((c) => c.reason)).toEqual(["chronicle_changed_on_both"]);
      expect(res.statusCode).toBe(400);
      expect((await t.post(`/api/chronicles/${id}/resolve`, { keep })).statusCode).toBe(200);
      if (keep === "mine") expect((await saveVersion()).res.statusCode).toBe(200);
      expect(onMain(id)!.spans[0]!.name).toBe(keep === "mine" ? "Mine" : "Theirs");
      await t.del(`/api/chronicles/${id}`);
      await saveVersion();
    }
  });
});

describe("linking a span to an entry", () => {
  it("writes an id into the entry, names it in the answer, and saves the two together", async () => {
    const id = await create();
    const { chronicle } = await load(id);
    const lane = chronicle.lanes[0]!.id;
    const res = await save(id, { ...chronicle, spans: [span("s0000001", lane)] }, 1, [
      { span: "s0000001", path: MIRA },
      { span: "missing1", path: MIRA },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const entryId = res.json().chronicle.spans[0].entry as string;
    expect(entryId).toMatch(/^[a-z0-9]{8}$/);
    expect((await load(id)).entries[entryId]).toEqual({ path: MIRA, title: "Mira" });
    const entry = (await t.get(`/api/entries?path=${encodeURIComponent(MIRA)}`)).json();
    expect(entry.chronicles).toEqual([
      { id, title: (await load(id)).chronicle.title, span: "s0000001" },
    ]);

    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    const own = un.drafts.find((d) => d.path === file(id))!;
    const alone = PublishPlan.parse(
      (await t.post("/api/publish/plan", { draftIds: [own.id], renameIds: [] })).json(),
    );
    expect(alone.groups).toHaveLength(1);
    expect((await saveVersion("Chronicle and id")).res.statusCode).toBe(200);
    expect(t.repo.remoteFile(MIRA)).toContain(`id: ${entryId}`);
    expect(onMain(id)!.spans[0]!.entry).toBe(entryId);
  });

  it("leaves the span unlinked when the entry cannot take an id", async () => {
    const id = await create();
    const { chronicle } = await load(id);
    const res = await save(
      id,
      { ...chronicle, spans: [span("s0000001", chronicle.lanes[0]!.id)] },
      1,
      [{ span: "s0000001", path: "notes.json" }],
    );
    expect(res.json().unlinked).toHaveLength(1);
    expect(res.json().chronicle.spans[0].entry).toBeNull();
  });
});
