import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EntryResponse, PublishPlan, UnpublishedResponse } from "@frontier/schema";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
let png: Buffer;

beforeAll(async () => {
  t = await makeTestApp({ UPLOAD_FOLDER: "99 Appendices/Images" });
  await t.login();
  png = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#225588" } })
    .png()
    .toBuffer();
});
afterAll(() => t.close());

/** Sends one file as a browser form would. */
function upload(filename: string, content: Buffer, type = "image/png") {
  const boundary = "----frontiertest";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return t.app.inject({
    method: "POST",
    url: "/api/images",
    headers: { cookie: t.cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
}

describe("image upload", () => {
  it("keeps an uploaded image as a draft and returns the text to embed it", async () => {
    const res = await upload("Sea Chart.png", png);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      path: "99 Appendices/Images/Sea Chart.png",
      embed: "![[Sea Chart.png]]",
    });
    expect(t.repo.remoteFiles()).not.toContain("99 Appendices/Images/Sea Chart.png");
    const draft = t.services.drafts.byPath("99 Appendices/Images/Sea Chart.png")!;
    expect(draft).toMatchObject({ kind: "create", binary: true });
    expect((await t.services.drafts.bytes(draft.id)).equals(png)).toBe(true);
  });

  it("serves the image before it is published, at full size and scaled", async () => {
    const full = await t.get("/api/images?path=99%20Appendices%2FImages%2FSea%20Chart.png");
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload.equals(png)).toBe(true);
    const small = await t.get("/api/images?path=99%20Appendices%2FImages%2FSea%20Chart.png&w=320");
    expect((await sharp(small.rawPayload).metadata()).width).toBe(320);
  });

  it("resolves an embed of the unpublished image in a draft entry", async () => {
    await t.put("/api/drafts", {
      id: "uploadentry1",
      path: "02 People/Mira.md",
      kind: "edit",
      text: "# Mira\n\n![[Sea Chart.png]]\n",
      revision: 0,
    });
    const entry = EntryResponse.parse(
      (await t.get("/api/entries?path=02%20People%2FMira.md")).json(),
    );
    expect(entry.links[0]).toMatchObject({
      kind: "image",
      target: "99 Appendices/Images/Sea Chart.png",
    });
  });

  it("finds the image an embed points at, for the editor to show it", async () => {
    const find = async (name: string) =>
      (
        await t.get(
          `/api/images/find?name=${encodeURIComponent(name)}&from=${encodeURIComponent("02 People/Mira.md")}`,
        )
      ).json();
    expect(await find("Sea Chart.png")).toEqual({ path: "99 Appendices/Images/Sea Chart.png" });
    expect(await find("Nowhere.png")).toEqual({ path: null });
    // A note is not an image, even when the name matches.
    expect(await find("Mira")).toEqual({ path: null });
    expect((await t.get("/api/images/find?name=a%5Bb.png&from=x.md")).statusCode).toBe(400);
    expect(
      (await t.app.inject({ method: "GET", url: "/api/images/find?name=a.png&from=x.md" }))
        .statusCode,
    ).toBe(401);
  });

  it("lists the image among the unpublished changes without treating it as text", async () => {
    const u = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    const image = u.drafts.find((d) => d.path.endsWith("Sea Chart.png"))!;
    expect(image).toMatchObject({ kind: "create", binary: true, text: "", mainText: null });
  });

  it("gives a second image with the same name a number, ignoring letter case", async () => {
    expect((await upload("sea chart.PNG", png)).json().path).toBe(
      "99 Appendices/Images/sea chart 2.PNG",
    );
    // "lamp.png" exists in the vault already, in another folder.
    expect((await upload("LAMP.png", png)).json().embed).toBe("![[LAMP 2.png]]");
  });

  it("refuses what is not an image", async () => {
    const message = async (name: string, content: Buffer) =>
      (await upload(name, content)).json().error?.message as string;
    expect(await message("notes.png", Buffer.from("just text"))).toMatch(/not an image/);
    expect(await message("picture", png)).toMatch(/image extension/);
    expect(await message("script.md", png)).toMatch(/image extension/);
    const none = await t.app.inject({
      method: "POST",
      url: "/api/images",
      headers: { cookie: t.cookie, "content-type": "multipart/form-data; boundary=x" },
      payload: "--x--\r\n",
    });
    expect(none.statusCode).toBe(400);
    expect((await t.app.inject({ method: "POST", url: "/api/images" })).statusCode).toBe(401);
  });

  it("strips a folder from the file name, so an upload cannot land elsewhere", async () => {
    const res = await upload("..\\\\..\\\\evil/../Escape.png", png);
    expect(res.json().path).toBe("99 Appendices/Images/Escape.png");
  });

  it("refuses to edit an uploaded image as text", async () => {
    const res = await t.put("/api/drafts", {
      id: "uploadtext01",
      path: "99 Appendices/Images/Sea Chart.png",
      kind: "edit",
      text: "x",
      revision: 0,
    });
    expect(res.statusCode).toBe(400);
  });

  it("publishes the image with the entry that uses it, byte for byte, in one commit", async () => {
    const ids = t.services.drafts
      .list()
      .filter((d) => d.path.endsWith("Sea Chart.png") || d.path === "02 People/Mira.md")
      .map((d) => d.id);
    const plan = PublishPlan.parse(
      (await t.post("/api/publish/plan", { draftIds: ids, renameIds: [] })).json(),
    );
    expect(plan.ready.sort()).toEqual([...ids].sort());
    const res = await t.post("/api/publish/confirm", {
      planId: plan.planId,
      confirmedMergeIds: [],
      message: "Add sea chart",
    });
    expect(res.statusCode, res.body).toBe(200);
    const stored = execFileSync(
      "git",
      ["show", "refs/heads/main:99 Appendices/Images/Sea Chart.png"],
      { cwd: t.repo.remote },
    );
    expect(stored.equals(png)).toBe(true);
    expect(t.repo.remoteFile("02 People/Mira.md")).toContain("![[Sea Chart.png]]");
    expect(t.services.drafts.byPath("99 Appendices/Images/Sea Chart.png")).toBeUndefined();
    // Now it is served from the vault.
    expect(
      (await t.get("/api/images?path=99%20Appendices%2FImages%2FSea%20Chart.png")).statusCode,
    ).toBe(200);
  });

  it("holds an image back when a file took its name on main meanwhile, and drops an identical one", async () => {
    const other = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    await upload("Clash.png", png);
    await upload("Same.png", png);
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(join(t.repo.root, "outside", "99 Appendices", "Images", "Clash.png"), other);
    writeFileSync(join(t.repo.root, "outside", "99 Appendices", "Images", "Same.png"), png);
    t.repo.pushFromOutside({ "x-marker.md": "# x\n" });
    const clash = t.services.drafts.byPath("99 Appendices/Images/Clash.png")!;
    const plan = PublishPlan.parse(
      (await t.post("/api/publish/plan", { draftIds: [clash.id], renameIds: [] })).json(),
    );
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({ draftId: clash.id, reason: "created_on_main" });
    // The identical upload was cleared by the fetch.
    expect(t.services.drafts.byPath("99 Appendices/Images/Same.png")).toBeUndefined();
  });

  it("moves an unpublished image along when its folder is renamed", async () => {
    const local = await makeTestApp({ UPLOAD_FOLDER: "01 Places/Harbor" });
    try {
      await local.login();
      const boundary = "----frontiertest";
      await local.app.inject({
        method: "POST",
        url: "/api/images",
        headers: {
          cookie: local.cookie,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="quay.png"\r\nContent-Type: image/png\r\n\r\n`,
          ),
          png,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
      const rename = (
        await local.post("/api/renames", { from: "01 Places/Harbor", to: "01 Places/Port" })
      ).json();
      const image = local.services.drafts.byPath("01 Places/Harbor/quay.png")!;
      const plan = (
        await local.post("/api/publish/plan", { draftIds: [image.id], renameIds: [rename.id] })
      ).json();
      const res = await local.post("/api/publish/confirm", {
        planId: plan.planId,
        confirmedMergeIds: [],
        message: "Move",
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(local.repo.remoteFiles()).toContain("01 Places/Port/quay.png");
      expect(local.repo.remoteFiles()).not.toContain("01 Places/Harbor/quay.png");
      expect(local.services.drafts.list()).toEqual([]);
    } finally {
      await local.close();
    }
  });
});
