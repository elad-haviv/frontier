import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { PicturesResponse, PictureTry } from "@frontier/schema";
import { EntryPictures, KEEP_TRIES_MS } from "../src/ai/pictures.js";
import { asAdmin, makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t.close());

/** The key this test's "device" holds; it reaches the server only in the keys header. */
const KEY = "sk-or-test-key-1234";
const ENTRY = "03 Things/Lantern.md";
const q = encodeURIComponent(ENTRY);

/** Stands in for OpenRouter: every picture call answers a small PNG and costs four cents. */
async function start(opts: { model?: boolean; fail?: boolean; key?: boolean } = {}) {
  const png = await sharp({ create: { width: 6, height: 4, channels: 3, background: "#aa7733" } })
    .png()
    .toBuffer();
  const calls: Record<string, unknown>[] = [];
  const fake: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/key")) return Response.json({ data: { label: "test" } });
    if (path.endsWith("/models")) return Response.json({ data: [] });
    calls.push(JSON.parse(String(init?.body)));
    if (opts.fail) return Response.json({ error: { message: "no credit" } }, { status: 402 });
    return Response.json({ data: [{ b64_json: png.toString("base64") }], usage: { cost: 0.04 } });
  };
  t = await makeTestApp({ UPLOAD_FOLDER: "99 Appendices/Images" }, { fetch: fake, settleMs: 0 });
  await t.login();
  if (opts.key !== false) t.keys = { openrouter: KEY };
  const res = await t.put("/api/settings/ai", {
    ...(opts.model === false ? {} : { models: { art: "test/painter" } }),
    artStyle: "Ink and watercolour.",
  });
  expect(res.statusCode, res.body).toBe(200);
  return { calls, png };
}

const status = async () => PicturesResponse.parse((await t.get(`/api/pictures?entry=${q}`)).json());
const make = (body: Record<string, unknown>) =>
  t.post("/api/pictures", { entry: ENTRY, prompt: "A tin storm lantern.", ...body });

describe("pictures for entries", () => {
  it("says how to choose a picture model when none is chosen", async () => {
    await start({ model: false });
    const s = await status();
    expect(s.off).toEqual({
      message: expect.stringContaining("Choose one in Settings › AI models"),
      href: "/settings/you/ai-models/art",
    });
    expect(s.style).toBe("Ink and watercolour.");
    expect(s.tries).toEqual([]);
  });

  it("makes a picture in the style and shape asked for, and keeps it as a try", async () => {
    const { calls, png } = await start();
    expect((await status()).off).toBeNull();
    const res = await make({ style: "Charcoal.", shape: "wide" });
    expect(res.statusCode, res.body).toBe(200);
    const made = PictureTry.parse(res.json().try);
    expect(made).toMatchObject({ entry: ENTRY, shape: "wide", ext: "png", style: "Charcoal." });
    expect(calls[0]).toMatchObject({
      model: "test/painter",
      prompt: "Charcoal.\n\nThe subject: A tin storm lantern.",
      aspect_ratio: "3:2",
    });

    const s = await status();
    expect(s.tries.map((x) => x.id)).toEqual([made.id]);
    expect(s.perPictureUsd).toBeCloseTo(0.04);
    // The call is logged with the person who made it, and went out with their key.
    const logged = (await t.server.aiLog.calls(new Date().toISOString().slice(0, 7))).at(-1)!;
    expect(logged).toMatchObject({
      task: "art",
      ok: true,
      person: (await t.server.people.all())[0]!.id,
    });
    const served = await t.get(`/api/pictures/${made.id}`);
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.equals(png)).toBe(true);
    // Another entry's dialog does not show it.
    const other = await t.get(`/api/pictures?entry=${encodeURIComponent("02 People/Mira.md")}`);
    expect(PicturesResponse.parse(other.json()).tries).toEqual([]);
  });

  it("sends the prompt alone when the style is left empty", async () => {
    const { calls } = await start();
    await make({ style: "  " });
    expect(calls[0]!.prompt).toBe("A tin storm lantern.");
    expect(calls[0]!.aspect_ratio).toBe("1:1");
  });

  it("inserts a try as an unpublished image, named as asked or after the entry", async () => {
    await start();
    const first = PictureTry.parse((await make({})).json().try);
    const second = PictureTry.parse((await make({})).json().try);

    const a = await t.post(`/api/pictures/${first.id}/insert`, { name: "Harbor: at dusk.png" });
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json()).toEqual({
      path: "99 Appendices/Images/Harbor at dusk.png",
      embed: "![[Harbor at dusk.png]]",
    });
    const draft = t.services.drafts.byPath("99 Appendices/Images/Harbor at dusk.png");
    expect(draft).toMatchObject({ kind: "create", binary: true });

    const b = await t.post(`/api/pictures/${second.id}/insert`, { name: "" });
    expect(b.json().path).toBe("99 Appendices/Images/Lantern.png");

    expect((await status()).tries).toEqual([]);
    expect((await t.get(`/api/pictures/${first.id}`)).statusCode).toBe(404);
  });

  it("refuses a prompt that is empty and a path that is not an entry", async () => {
    const { calls } = await start();
    expect((await make({ prompt: "   " })).statusCode).toBe(400);
    expect((await t.post("/api/pictures", { entry: "a.png", prompt: "x" })).statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("passes on the model's refusal and keeps no try", async () => {
    await start({ fail: true });
    const res = await make({});
    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toContain("no credit");
    expect((await status()).tries).toEqual([]);
  });

  it("drops tries older than seven days", async () => {
    await start();
    let now = new Date("2026-11-01T10:00:00Z");
    const s = t.services;
    const pictures = new EntryPictures({
      dir: join(s.config.dataDir, "assets", "generated", "entries"),
      files: s.files,
      settings: s.settings,
      log: s.aiLog,
      provider: s.ai,
      saving: s,
      now: () => now,
    });
    // A call outside a request speaks for the first account; the device key is the request's.
    const asMe = <T>(work: () => T) => asAdmin(t, { openrouter: KEY }, work);
    const made = await asMe(() =>
      pictures.make({ entry: ENTRY, prompt: "A lantern.", style: "", shape: "tall" }),
    );
    expect((await asMe(() => pictures.status(ENTRY))).tries).toHaveLength(1);
    now = new Date(now.getTime() + KEEP_TRIES_MS + 1000);
    expect((await asMe(() => pictures.status(ENTRY))).tries).toHaveLength(0);
    await expect(asMe(() => pictures.bytes(made.id))).rejects.toThrow("no longer kept");
  });
});
