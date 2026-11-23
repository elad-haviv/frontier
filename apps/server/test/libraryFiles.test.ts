import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAP_STYLES_FILE,
  type MapStyle,
  type MapStylesFile,
  PublishPlan,
  UnpublishedResponse,
} from "@frontier/schema";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
  await t.login();
});
afterEach(() => t.close());

const river: MapStyle = {
  id: "k3v9x2pa",
  name: "River",
  for: "path",
  color: "#2f6f9f",
  width: 3,
  dash: "solid",
};
const styles = (...list: unknown[]) => ({ version: 1, styles: list }) as MapStylesFile;

async function load() {
  const res = await t.get("/api/library-files/map-styles");
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { file: MapStylesFile; revision: number; blob: string };
}
const save = (file: unknown, revision: number, extra: Record<string, unknown> = {}) =>
  t.put("/api/library-files/map-styles", { file, revision, ...extra });

describe("the map styles file", () => {
  it("reads as empty while it is missing, and is saved as a draft that says where it started", async () => {
    expect(await load()).toEqual({ file: { version: 1, styles: [] }, revision: 0, blob: "" });
    const saved = await save(styles(river), 0, { baseBlob: "", op: "aaaaaaaaaaaa" });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().revision).toBe(1);
    expect((await load()).file.styles).toEqual([river]);

    // The draft is listed by its label, as one unpublished change.
    const un = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    const draft = un.drafts.find((d) => d.path === MAP_STYLES_FILE)!;
    expect(draft.kind).toBe("create");
    const plan = PublishPlan.parse(
      (await t.post("/api/publish/plan", { draftIds: [draft.id], renameIds: [] })).json(),
    );
    const res = await t.post("/api/publish/confirm", {
      planId: plan.planId,
      confirmedMergeIds: [],
      message: "Add the river",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(t.repo.remoteFile(MAP_STYLES_FILE)).toContain('"name":"River"');
    const after = await load();
    expect(after.revision).toBe(0);
    expect(after.blob).not.toBe("");
  });

  it("refuses a save from older text", async () => {
    expect((await save(styles(river), 0, { baseBlob: "", op: "bbbbbbbbbbbb" })).statusCode).toBe(
      200,
    );
    const stale = await save(styles(), 0, { baseBlob: "", op: "cccccccccccc" });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("stale_revision");
    expect(stale.json().error.message).toBe(
      "The styles were changed from another device. The two are being merged.",
    );
    expect((await save(styles(), 1, { op: "dddddddddddd" })).statusCode).toBe(200);
  });

  it("checks every field, and keeps at most 200 styles", async () => {
    const bad = async (style: Record<string, unknown>) =>
      (await save(styles({ ...river, ...style }), 0)).statusCode;
    expect(await bad({ id: "River" })).toBe(400);
    expect(await bad({ name: "" })).toBe(400);
    expect(await bad({ for: "marker" })).toBe(400);
    expect(await bad({ color: "blue" })).toBe(400);
    expect(await bad({ width: 13 })).toBe(400);
    expect(await bad({ width: 1.2 })).toBe(400);
    expect(await bad({ dash: "dotted" })).toBe(400);
    expect(await bad({ fill: 0.2 })).toBe(400);
    expect(await bad({ for: "zone", fill: 0.9 })).toBe(400);
    expect((await save(styles(river, river), 0)).statusCode).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => ({
      ...river,
      id: `s${String(i).padStart(7, "0")}`,
    }));
    expect((await save(styles(...many), 0)).statusCode).toBe(400);
    expect((await save(styles(...many.slice(0, 200)), 0)).statusCode).toBe(200);
  });

  it("has nothing to settle while it has no unpublished change", async () => {
    const res = await t.post("/api/library-files/map-styles/resolve", { keep: "mine" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe("The styles have no unpublished change.");
  });
});
