import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { makeTestApp, type TestApp, testEnv } from "./helpers/app.js";
import { makeTestRepo } from "./helpers/repo.js";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp();
  const wide = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: "#336699" },
  })
    .png()
    .toBuffer();
  const jpegNamedPng = await sharp({
    create: { width: 900, height: 300, channels: 3, background: "#996633" },
  })
    .jpeg()
    .toBuffer();
  const { mkdirSync, cpSync } = await import("node:fs");
  const stage = join(t.repo.root, "stage");
  mkdirSync(stage);
  writeFileSync(join(stage, "wide.png"), wide);
  writeFileSync(join(stage, "wide-photo.png"), jpegNamedPng);
  // Binary files go to the remote through the outside clone's folder.
  cpSync(
    join(stage, "wide.png"),
    join(t.repo.root, "outside", "99 Appendices", "Images", "wide.png"),
  );
  cpSync(
    join(stage, "wide-photo.png"),
    join(t.repo.root, "outside", "99 Appendices", "Images", "wide-photo.png"),
  );
  t.repo.pushFromOutside({
    "99 Appendices/Images/vector.svg":
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="10"/>',
  });
  await t.services.sync();
  await t.login();
});
afterAll(() => t.close());

const img = (path: string, extra = "") =>
  t.get(`/api/images?path=${encodeURIComponent(path)}${extra}`);

describe("image serving", () => {
  it("sends the original when no width is asked for", async () => {
    const res = await img("99 Appendices/Images/wide.png");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect((await sharp(res.rawPayload).metadata()).width).toBe(2000);
  });

  it("scales down to the asked width and caches the result", async () => {
    const first = await img("99 Appendices/Images/wide.png", "&w=640");
    const meta = await sharp(first.rawPayload).metadata();
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(320);
    const second = await img("99 Appendices/Images/wide.png", "&w=640");
    expect(second.rawPayload.equals(first.rawPayload)).toBe(true);
  });

  it("never enlarges a small image", async () => {
    const res = await img("99 Appendices/Images/lamp.png", "&w=1280");
    expect((await sharp(res.rawPayload).metadata()).width).toBe(1);
  });

  it("reports the real type of a JPEG named .png, resized or not", async () => {
    expect((await img("99 Appendices/Images/photo.png")).headers["content-type"]).toBe(
      "image/jpeg",
    );
    const resized = await img("99 Appendices/Images/wide-photo.png", "&w=320");
    expect(resized.headers["content-type"]).toBe("image/jpeg");
    expect((await sharp(resized.rawPayload).metadata()).format).toBe("jpeg");
  });

  it("sends a vector image as stored", async () => {
    const res = await img("99 Appendices/Images/vector.svg", "&w=320");
    expect(res.headers["content-type"]).toBe("image/svg+xml");
    expect(res.body).toContain("<svg");
  });

  it("refuses anything that is not an image in the vault", async () => {
    for (const path of [
      "02 People/Mira.md",
      "99 Appendices/Images/none.png",
      ".obsidian/app.json",
      "notes.json",
    ]) {
      expect((await img(path)).statusCode, path).toBe(404);
    }
    expect((await img("../../etc/passwd.png")).statusCode).toBe(400);
    expect((await img("99 Appendices/Images/wide.png", "&w=999")).statusCode).toBe(400);
  });

  it("needs a session", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/api/images?path=99%20Appendices%2FImages%2Fwide.png",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("serving the interface", () => {
  it("serves the built app for page addresses and keeps API errors as JSON", async () => {
    const repo = makeTestRepo();
    const web = mkdtempSync(join(tmpdir(), "frontier-web-"));
    writeFileSync(join(web, "index.html"), "<!doctype html><title>Frontier</title>");
    writeFileSync(join(web, "app.js"), "console.log(1)");
    try {
      const { app } = await buildApp(loadConfig(testEnv(repo)), { webDir: web });
      const page = await app.inject({ method: "GET", url: "/e/02%20People/Mira.md" });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain("<title>Frontier</title>");
      expect((await app.inject({ method: "GET", url: "/" })).body).toContain("Frontier");
      expect((await app.inject({ method: "GET", url: "/app.js" })).body).toBe("console.log(1)");
      const api = await app.inject({ method: "GET", url: "/api/nothing" });
      expect(api.statusCode).toBe(401);
      const post = await app.inject({ method: "POST", url: "/somewhere" });
      expect(post.statusCode).toBe(404);
      expect(post.json().error.code).toBe("not_found");
      await app.close();
    } finally {
      repo.cleanup();
    }
  });

  it("serves no pages when the web folder has no build", async () => {
    const repo = makeTestRepo();
    try {
      const { app } = await buildApp(loadConfig(testEnv(repo)), {
        webDir: join(repo.root, "missing"),
      });
      expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(404);
      await app.close();
    } finally {
      repo.cleanup();
    }
  });
});

describe("the gallery", () => {
  it("lists every image with the entries that use it, in order", async () => {
    const res = await t.get("/api/gallery");
    expect(res.statusCode).toBe(200);
    const { images } = res.json() as {
      images: { path: string; icon: boolean; usedBy: { path: string; title: string }[] }[];
    };
    const paths = images.map((i) => i.path);
    expect(paths).toContain("99 Appendices/Images/wide.png");
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
    expect(images.find((i) => i.path.endsWith("/wide.png"))?.usedBy).toEqual([]);
    const used = images.filter((i) => i.usedBy.length > 0);
    expect(used.length).toBeGreaterThan(0);
    for (const image of used) {
      // No entry is named twice for one image, however often it shows it.
      expect(new Set(image.usedBy.map((e) => e.path)).size).toBe(image.usedBy.length);
      expect(image.usedBy.every((e) => e.path.endsWith(".md") && e.title !== "")).toBe(true);
    }
  });
});
