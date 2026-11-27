import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  ArtStylesResponse,
  artLibrary,
  DEFAULT_ART_STYLE,
  PicturesResponse,
  STARTER_ART_STYLES,
} from "@frontier/schema";
import { SAMPLE_SUBJECT } from "../src/ai/artStyles.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t.close());

const KEY = "sk-or-test-key-1234";
const URL_ = "/api/settings/art-styles";

async function start() {
  const png = await sharp({
    create: { width: 900, height: 600, channels: 3, background: "#aa7733" },
  })
    .png()
    .toBuffer();
  const calls: Record<string, unknown>[] = [];
  const fake: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/key")) return Response.json({ data: { label: "test" } });
    if (path.endsWith("/models")) return Response.json({ data: [] });
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({ data: [{ b64_json: png.toString("base64") }], usage: { cost: 0.04 } });
  };
  t = await makeTestApp({}, { fetch: fake, settleMs: 0 });
  await t.login();
  t.keys = { openrouter: KEY };
  return { calls };
}

const library = async () => ArtStylesResponse.parse((await t.get(URL_)).json());
const settingsAi = async () =>
  (await t.get("/api/settings")).json().ai as {
    artStyle: string;
    artStyles: { id: string; name: string }[];
    usualArtStyle: string;
  };

describe("the library of art styles", () => {
  it("is worked out from the one style a person had", async () => {
    await start();
    const fresh = artLibrary({ artStyle: DEFAULT_ART_STYLE });
    expect(fresh.styles.map((s) => s.name)).toEqual(STARTER_ART_STYLES.map((s) => s.name));
    expect(fresh.usual).toBe("field-notebook");

    const own = artLibrary({ artStyle: "Charcoal." });
    expect(own.styles[0]).toEqual({
      id: "my-style",
      name: "My style",
      text: "Charcoal.",
      sample: null,
    });
    expect(own.styles).toHaveLength(STARTER_ART_STYLES.length + 1);
    expect(own.usual).toBe("my-style");
  });

  it("starts as the starter styles, the field notebook the usual one", async () => {
    await start();
    const lib = await library();
    expect(lib.styles).toHaveLength(6);
    expect(lib.usual).toBe("field-notebook");
    const ai = await settingsAi();
    expect(ai.artStyle).toBe(DEFAULT_ART_STYLE);
    expect(ai.usualArtStyle).toBe("field-notebook");
    expect(ai.artStyles).toHaveLength(6);
  });

  it("adds, edits, makes usual and deletes, and the usual one's words are the art style", async () => {
    await start();
    const added = await t.post(URL_, { name: " Charcoal study ", text: "Charcoal on grey paper." });
    expect(added.statusCode, added.body).toBe(200);
    const made = ArtStylesResponse.parse(added.json()).styles.at(-1)!;
    expect(made).toMatchObject({
      name: "Charcoal study",
      text: "Charcoal on grey paper.",
      sample: null,
    });
    expect(made.id).toMatch(/^[a-z0-9]{12}$/);

    // A name is one style's.
    const twice = await t.post(URL_, { name: "charcoal STUDY", text: "x" });
    expect(twice.statusCode).toBe(400);
    expect(twice.json().error.message).toContain("already a style called");

    expect((await t.put("/api/settings/ai", { usualArtStyle: made.id })).statusCode).toBe(200);
    expect((await settingsAi()).artStyle).toBe("Charcoal on grey paper.");

    const edited = await t.put(`${URL_}/${made.id}`, { name: "Charcoal", text: "Soft charcoal." });
    expect(edited.statusCode, edited.body).toBe(200);
    expect((await settingsAi()).artStyle).toBe("Soft charcoal.");

    // The one text box of an earlier build changes what the usual style says.
    await t.put("/api/settings/ai", { artStyle: "Hard charcoal." });
    expect((await library()).styles.find((s) => s.id === made.id)!.text).toBe("Hard charcoal.");

    // Deleting the usual one makes the first the usual one.
    const gone = ArtStylesResponse.parse((await t.del(`${URL_}/${made.id}`)).json());
    expect(gone.styles).toHaveLength(6);
    expect(gone.usual).toBe("field-notebook");
    expect((await settingsAi()).artStyle).toBe(DEFAULT_ART_STYLE);

    // Undo puts it back where it was, under its id, and usual again.
    const back = ArtStylesResponse.parse(
      (
        await t.post(URL_, {
          id: made.id,
          at: 2,
          usual: true,
          name: "Charcoal",
          text: "Hard charcoal.",
        })
      ).json(),
    );
    expect(back.styles[2]!.id).toBe(made.id);
    expect(back.usual).toBe(made.id);

    expect((await t.put(`${URL_}/nope`, { name: "X" })).statusCode).toBe(404);
    expect((await t.put("/api/settings/ai", { usualArtStyle: "nope" })).statusCode).toBe(404);
  });

  it("keeps the last style, holds 24, and brings the starters back", async () => {
    await start();
    for (const s of STARTER_ART_STYLES.slice(1)) await t.del(`${URL_}/${s.id}`);
    const last = await t.del(`${URL_}/field-notebook`);
    expect(last.statusCode).toBe(400);
    expect(last.json().error.message).toContain("The last style stays");

    const again = (await t.post(`${URL_}/starters`)).json();
    expect(again.added).toBe(5);
    expect(again.styles).toHaveLength(6);
    expect((await t.post(`${URL_}/starters`)).json().added).toBe(0);

    for (let i = 0; i < 18; i++) {
      expect((await t.post(URL_, { name: `Style ${i}`, text: "x" })).statusCode).toBe(200);
    }
    const full = await t.post(URL_, { name: "One more", text: "x" });
    expect(full.statusCode).toBe(400);
    expect(full.json().error.message).toContain("holds 24 styles");
  });

  it("draws a sample of the fixed scene and keeps it for the style that saves it", async () => {
    const { calls } = await start();
    await t.put("/api/settings/ai", { models: { art: "test/painter" } });
    const res = await t.post(`${URL_}/sample`, { text: "Charcoal on grey paper." });
    expect(res.statusCode, res.body).toBe(200);
    const { sample } = res.json() as { sample: string };
    expect(String(calls.at(-1)!.prompt)).toBe(
      `Charcoal on grey paper.\n\nThe subject: ${SAMPLE_SUBJECT}`,
    );

    const shown = await t.get(`${URL_}/sample/${sample}`);
    expect(shown.statusCode).toBe(200);
    expect(shown.headers["content-type"]).toBe("image/webp");
    expect((await sharp(shown.rawPayload).metadata()).width).toBe(640);

    const lib = ArtStylesResponse.parse(
      (await t.post(URL_, { name: "Charcoal", text: "Charcoal on grey paper.", sample })).json(),
    );
    expect(lib.styles.at(-1)!.sample).toBe(sample);
    // A sample that was never made is not kept on a style.
    const none = ArtStylesResponse.parse(
      (await t.put(`${URL_}/field-notebook`, { sample: "abcdefghijkl" })).json(),
    );
    expect(none.styles[0]!.sample).toBeNull();
    expect((await t.get(`${URL_}/sample/abcdefghijkl`)).statusCode).toBe(404);
  });

  it("gives the picture dialog the styles, and says on a try which one made it", async () => {
    await start();
    await t.put("/api/settings/ai", { models: { art: "test/painter" } });
    const entry = "03 Things/Lantern.md";
    const s = PicturesResponse.parse(
      (await t.get(`/api/pictures?entry=${encodeURIComponent(entry)}`)).json(),
    );
    expect(s.styles).toHaveLength(6);
    expect(s.usualStyle).toBe("field-notebook");
    expect(s.style).toBe(DEFAULT_ART_STYLE);
    const made = await t.post("/api/pictures", {
      entry,
      prompt: "A tin lantern.",
      style: "Woodcut.",
      styleName: "Woodcut print",
    });
    expect(made.statusCode, made.body).toBe(200);
    expect(made.json().try.styleName).toBe("Woodcut print");
  });
});
