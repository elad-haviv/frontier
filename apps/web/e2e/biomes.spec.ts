import { expect, type Page, test } from "./test.ts";
import {
  type Feature,
  cleanUp,
  click,
  makeMap,
  onMap,
  open,
  saved,
  stored,
} from "./pathsHelpers.ts";

/**
 * Biome zones (stage 21): a biome on a zone, drawn by hand or found, its pattern and legend, what
 * it does to a route, the owner's own biomes, and Suggest biomes from the terrain. The map is the
 * Find paths fixture (fixtures/make-find-paths.mjs: 600 × 400, a position is a pixel and a km): a
 * mainland from x = 100 to 430, an island from x = 490, and a height map rising east.
 */

test.describe.configure({ mode: "serial" });

type Zone = Feature & { biome?: string; pattern?: boolean; layer: string };
const SHOTS = process.env.BIOME_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const zones = async (page: Page) =>
  (await stored(page)).features.filter((f) => f.kind === "zone") as Zone[];
const layersOf = async (page: Page) =>
  (await page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    return (await (await fetch(`${API}/maps/${id}`)).json()).map.layers;
  })) as { id: string; name: string }[];

/** Chooses a biome in a picker by typing part of its name. */
async function chooseBiome(page: Page, picker: ReturnType<Page["getByRole"]>, name: string) {
  await picker.click();
  await page.getByPlaceholder("Find a biome").fill(name);
  await page.keyboard.press("Enter");
}

const resetLibrary = (page: Page) =>
  page.evaluate(async () => {
    const json = { "content-type": "application/json" };
    for (const [name, file] of [
      ["map-styles", { version: 1, styles: [] }],
      ["biomes", { version: 1, biomes: [] }],
    ] as const) {
      const lib = await (await fetch(`${API}/library-files/${name}`)).json();
      await fetch(`${API}/library-files/${name}`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ file, revision: lib.revision, baseBlob: lib.blob }),
      });
    }
  });

test("draws a desert by hand in the Biomes layer, and a cart's route through it is slower", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Clicks and hover need a mouse");
  const id = await makeMap(page, "Tharn", { heights: true });
  await resetLibrary(page);
  await open(page, id);

  // The Zone tool's bar has the biome picker: new zones in a biome go to the Biomes layer.
  await page.getByRole("button", { name: "Zone", exact: true }).click();
  const picker = page.getByRole("combobox", { name: /^Biome: No biome/ });
  await chooseBiome(page, picker, "Desert (sand)");
  await expect(page.getByRole("combobox", { name: "Biome: Desert (sand)" })).toBeVisible();
  await expect(page.locator(".map-draw-hint")).toContainText("Drawing into Biomes");
  for (const p of [
    [110, 130],
    [425, 130],
    [425, 360],
    [110, 360],
  ] as [number, number][])
    await click(page, p);
  await shot(page, "d-drawing");
  await page.keyboard.press("Enter");
  await saved(page);
  const [desert] = await zones(page);
  expect(desert).toMatchObject({ biome: "desert-sand", style: "biodsand" });
  const layers = await layersOf(page);
  expect(layers[0]!.name).toBe("Biomes");
  expect(desert!.layer).toBe(layers[0]!.id);
  // Its usual style was added to the library.
  const styles = await page.evaluate(
    async () => (await (await fetch(`${API}/library-files/map-styles`)).json()).file.styles,
  );
  expect(styles.map((s: { id: string }) => s.id)).toContain("biodsand");

  // The legend card names it; the hover tag gives what it does to travel.
  const card = page.getByRole("region", { name: "Biomes legend" });
  await expect(card).toContainText("Desert (sand)");
  await page.keyboard.press("v");
  const on = await onMap(page, [300, 300]);
  await page.mouse.move(on.x, on.y);
  await expect(page.locator(".map-tooltip")).toContainText("cart 0.35×");
  await shot(page, "d-desert");

  // A route by cart through it: the bar says what the biomes added, and the km in it.
  await page.getByRole("button", { name: "Find paths" }).click();
  const paths = page.getByRole("group", { name: "Find paths" });
  await paths.getByRole("button", { name: "Route", exact: true }).click();
  await expect(paths).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await paths.getByRole("button", { name: "Cart", exact: true }).click();
  await click(page, [150, 200]);
  await click(page, [400, 300]);
  await expect(paths.getByRole("status")).toContainText("from biomes", { timeout: 20_000 });
  await expect(paths.getByRole("status")).toContainText("+");
  await expect(paths.locator(".paths-biomes")).toContainText("Desert (sand)");
  await shot(page, "d-route");
  await cleanUp(page, [id]);
});

test("gives a zone a biome in its Edit tab, with the owner's own biome", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "The Styles tab is tried at desktop size");
  const id = await makeMap(page, "Blight", {
    features: [
      {
        id: "zrealm01",
        kind: "zone",
        points: [
          [150, 80],
          [300, 80],
          [300, 250],
          [150, 250],
        ],
        label: "The Withering",
      },
    ],
  });
  await resetLibrary(page);
  await open(page, id);
  // The owner's own biome, made in the Styles tab.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("tab", { name: "Styles" }).click();
  const section = page.getByRole("tabpanel").getByRole("region", { name: "Biomes" });
  await section.getByRole("button", { name: "Add the usual biomes" }).click();
  await section.getByRole("button", { name: "New biome" }).click();
  const form = page.locator("form.biome-form");
  await form.getByLabel("Name").fill("Blightlands");
  await form.getByLabel("Behaves like").selectOption({ label: "Volcanic / wasteland" });
  await form.getByRole("radio", { name: "thorns" }).click();
  await form.getByLabel("Cart").fill("0.3");
  await form.getByLabel("Rivers").selectOption({ label: "Rivers lose water and can dry out" });
  await form.getByRole("button", { name: "Done" }).click();
  await expect
    .poll(async () =>
      page.evaluate(async () => (await (await fetch(`${API}/library-files/biomes`)).json()).file),
    )
    .toMatchObject({
      biomes: [{ name: "Blightlands", like: "wasteland", pattern: "thorns", rivers: "dry" }],
    });

  // The zone keeps its look and takes the biome's meaning.
  await click(page, [220, 160]);
  await page.getByRole("tab", { name: "Edit feature" }).click();
  await chooseBiome(page, page.getByRole("combobox", { name: /^Biome:/ }), "Blightlands");
  await expect(page.locator(".biome-meaning")).toContainText("cart 0.3×");
  await expect(page.locator(".biome-explore")).toContainText("The Withering");
  await page.getByLabel("Draw its pattern").uncheck();
  await saved(page);
  const [zone] = await zones(page);
  expect(zone!.biome).toMatch(/^[a-z0-9]{8}$/);
  expect(zone!.pattern).toBe(false);
  await shot(page, "d-edit");
  await cleanUp(page, [id]);
});

test("suggests biomes from the terrain, moves the rain shadow with the wind, accepts one and all", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Clicks and hover need a mouse");
  const id = await makeMap(page, "Suggested", { heights: true });
  await resetLibrary(page);
  await open(page, id);
  await page.keyboard.press("b");
  const bar = page.getByRole("group", { name: "Suggest biomes" });
  await expect(bar).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  const count = async () => Number(await bar.getAttribute("data-ghosts"));
  await expect.poll(count).toBeGreaterThan(0);
  await shot(page, "d-suggest");
  const before = await bar.getByRole("status").textContent();

  // The wind from the east: the suggestion changes.
  await bar.getByRole("radio", { name: "From the east" }).click();
  await expect(bar.getByRole("status")).not.toHaveText(before ?? "", { timeout: 20_000 });
  // The temperature view draws the field behind it, with a scale in the legend.
  await page.keyboard.press("2");
  await expect(page.getByRole("region", { name: "Temperature" })).toBeVisible();
  await shot(page, "d-temp");
  await page.keyboard.press("1");

  // A click on a ghost accepts it as a zone in the Biomes layer.
  await bar.getByRole("button", { name: "List" }).click();
  const first = page
    .getByRole("tabpanel")
    .getByRole("button", { name: /^Accept / })
    .first();
  await expect(first).toBeVisible();
  const n = await count();
  await first.click();
  await saved(page);
  let made = await zones(page);
  expect(made).toHaveLength(1);
  expect(made[0]!.biome).toBeTruthy();
  expect((await layersOf(page))[0]!.name).toBe("Biomes");
  await expect.poll(count).toBeLessThan(n);
  const kept = await stored(page);
  expect((kept as unknown as { climate: { wind: string } }).climate.wind).toBe("E");

  // Undo takes it back; Accept all takes every ghost at once.
  await page.keyboard.press("Control+z");
  await saved(page);
  expect(await zones(page)).toHaveLength(0);
  await expect.poll(count).toBeGreaterThan(0);
  const all = await count();
  await bar.getByRole("button", { name: "Accept all" }).click();
  await saved(page);
  made = await zones(page);
  expect(made.length).toBe(all);
  await expect.poll(count).toBe(0);
  await shot(page, "d-accepted");
  await cleanUp(page, [id]);
});

test("on a phone, a tap accepts a suggestion and Options opens the world's settings", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "The phone's strip");
  const id = await makeMap(page, "Pocket", { heights: true });
  await resetLibrary(page);
  await open(page, id);
  await page.getByRole("button", { name: "Suggest biomes" }).click();
  const bar = page.getByRole("group", { name: "Suggest biomes" });
  await expect(bar).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expect.poll(async () => Number(await bar.getAttribute("data-ghosts"))).toBeGreaterThan(0);
  await bar.getByRole("button", { name: "Options" }).click();
  await expect(bar.getByRole("radiogroup", { name: "Prevailing wind, from" })).toBeVisible();
  await shot(page, "p-options");
  await bar.getByRole("button", { name: "Options" }).click();
  // A tap on the land accepts the ghost there, with Undo in the toast.
  const at = await onMap(page, [250, 200]);
  await page.touchscreen.tap(at.x, at.y);
  await expect(page.getByText(/^Accepted: /)).toBeVisible();
  await saved(page);
  expect(await zones(page)).toHaveLength(1);
  await shot(page, "p-accepted");
  await cleanUp(page, [id]);
});
