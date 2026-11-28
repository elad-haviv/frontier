import { expect, type Page, test } from "@playwright/test";
import { api, noSidewaysScroll, proj, setUpAi } from "./helpers.ts";

/**
 * The World Wizard (stage 34, release 1): a world built in parts and made into a globe map with
 * its height map and biome zones. Reached from New project and from the list of maps.
 */

const part = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Parts of the wizard" })
    .getByRole("button", { name: new RegExp(`\\d ${name}$`) });

/** Sets a slider, as dragging it would. */
async function slide(page: Page, label: string, value: number): Promise<void> {
  await page.getByLabel(label).evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/**
 * A project of its own for a test that makes maps, styles and entries, so the sample library the
 * other specs read is left as it was. One for the phone run and one for the desktop run, which
 * share a server.
 */
async function ownProject(page: Page, name: string, run: string): Promise<string> {
  const slug = `${name}-${run}`.toLowerCase();
  const res = await page.request.post("/api/projects", {
    data: { name: `${name} ${run}`, slug, start: "empty" },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return slug;
}

async function openWizard(page: Page, project?: string): Promise<void> {
  await page.goto(proj("/world", project));
  await expect(page.getByRole("heading", { name: "World Wizard" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Parts of the wizard" })).toBeVisible();
}

test("New project offers the World Wizard, makes the project and opens the wizard in it", async ({
  page,
}, info) => {
  // The phone and the desktop run share one server: each makes a project of its own.
  const name = `Wizard ${info.project.name}`;
  await page.goto("/projects?new=1");
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Name").fill(name);
  await expect(dialog).toContainText("This address is free.");
  await dialog.getByRole("radio", { name: /The World Wizard/ }).check();
  await dialog.getByRole("button", { name: "Make it and start the wizard" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/wizard-${info.project.name}/world$`));
  await expect(page.getByRole("heading", { name: "World Wizard" })).toBeVisible();
  // It begins at the star system, and the world is named after the project.
  await expect(part(page, "Star system")).toHaveAttribute("aria-current", "step");
  await part(page, "Make it").click();
  await expect(page.getByLabel("Name of the world")).toHaveValue(name);
});

test("the list of maps has New world, which opens the wizard", async ({ page }) => {
  await page.goto(proj("/maps"));
  await page.getByRole("link", { name: /New world/ }).click();
  await expect(page).toHaveURL(/\/world$/);
  await expect(page.getByRole("heading", { name: "World Wizard" })).toBeVisible();
});

test("each part shows its controls, the plates drift when played, and nothing scrolls sideways", async ({
  page,
}) => {
  await openWizard(page);
  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start again" }).click();

  // The star system: the world's place by its star says whether water stays liquid.
  await expect(page.getByRole("heading", { name: "Star system" })).toBeVisible();
  await expect(page.getByRole("img", { name: "The star system seen from above" })).toBeVisible();
  const said = page.locator(".ww-facts");
  await expect(said).toContainText("in the band where water stays liquid");
  await expect(said).toContainText(/A year is \d+ of its days/);
  await slide(page, "Distance of planet 2", 90);
  await expect(said).toContainText("Too far: the seas would freeze");
  await page.getByRole("button", { name: "Ignore that" }).click();
  await expect(said).toContainText("The rule is off");
  await page.getByRole("button", { name: "Keep it able to hold life" }).click();
  await page.getByRole("button", { name: "Roll a system" }).click();
  await expect(said).toContainText("in the band where water stays liquid");
  await page.getByRole("button", { name: "None" }).click();
  await expect(said).toContainText("No moon, so no months");
  await page.getByRole("button", { name: "Two", exact: true }).click();
  await expect(said).toContainText(/A month is \d+ days, by the nearest moon/);

  await part(page, "Basics").click();
  await expect(page.getByRole("heading", { name: "Basics" })).toBeVisible();
  await expect(page.locator(".ww-facts")).toContainText(/A year is [\d,]+ days/);
  await slide(page, "Tilt of the axis", 45);
  await expect(page.locator(".ww-panel")).toContainText("45° · hard seasons");
  await page.getByRole("button", { name: "East to west" }).click();
  await expect(page.locator(".ww-facts")).toContainText("rises in the west");

  await part(page, "Land and sea").click();
  await expect(page.getByRole("heading", { name: "Land and sea" })).toBeFocused();
  await expect(page.locator(".ww-panel")).toContainText("White is land, black is sea");
  await slide(page, "How much land", 50);
  await expect(page.locator(".ww-panel")).toContainText("50%");

  await part(page, "Plates").click();
  await expect(page.locator(".ww-facts")).toContainText("0 million years have passed");
  await page.getByRole("button", { name: "Step" }).click();
  await expect(page.locator(".ww-facts")).toContainText("2 million years have passed");
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.locator(".ww-facts")).not.toContainText(/^2 million/, { timeout: 5000 });
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Back to the start" }).click();
  await expect(page.locator(".ww-facts")).toContainText("0 million years have passed");
  // A plate's drift is set with the compass.
  await page.getByRole("button", { name: "Plate 2" }).click();
  await page.getByRole("button", { name: "Drift south-west" }).click();
  await expect(page.getByRole("button", { name: "Drift south-west" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await part(page, "Heights").click();
  await expect(page.locator(".ww-facts")).toContainText(/\d+% of the surface is land/);
  const before = await page.locator(".ww-facts").innerText();
  await slide(page, "Sea level", 0.15);
  await expect(page.locator(".ww-facts")).not.toHaveText(before);

  await part(page, "Climate").click();
  await expect(page.locator(".ww-facts")).toContainText("tilt of 45°, spinning east to west");
  await page.getByRole("button", { name: "Temperature" }).click();
  await expect(page.locator(".ww-key")).toContainText("cold");

  await part(page, "Biomes").click();
  await expect(page.locator(".ww-legend")).toContainText("Ocean / sea");
  await expect(page.locator(".ww-legend")).toContainText(/\d+%/);
  await noSidewaysScroll(page);
});

test("the world is kept on the device: leaving and coming back finds it where it was, and Home says so", async ({
  page,
}) => {
  await openWizard(page);
  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start again" }).click();
  await part(page, "Basics").click();
  await slide(page, "Tilt of the axis", 37);
  await part(page, "Climate").click();
  await expect(page.getByRole("heading", { name: "Climate" })).toBeVisible();
  // Kept a moment after the change.
  await page.waitForTimeout(1200);
  await page.goto(proj("/"));
  const card = page.getByRole("region", { name: "World Wizard" });
  await expect(card).toContainText("waiting at Climate");
  await card.getByRole("link", { name: "Carry on" }).click();
  await expect(page.getByRole("heading", { name: "Climate" })).toBeVisible();
  await expect(page.locator(".ww-facts")).toContainText("tilt of 37°");
});

test("Make the world makes a globe map with its terrain and biome zones, as unsaved changes", async ({
  page,
}, info) => {
  const own = await ownProject(page, "wizmake", info.project.name);
  await openWizard(page, own);
  await page.getByRole("button", { name: "Surprise me" }).click();
  // A world already built is asked about first; a new one is rolled at once.
  const ask = page.getByRole("dialog");
  if (await ask.isVisible().catch(() => false)) {
    await ask.getByRole("button", { name: "Roll it" }).click();
  }
  await expect(page.getByRole("heading", { name: "Biomes" })).toBeVisible();
  await part(page, "Make it").click();
  await page.getByLabel("Name of the world").fill("Test Globe");
  await expect(page.locator(".ww-makes")).toContainText(/\d+ biome zones/);
  await expect(page.locator(".ww-makes")).toContainText("A system model");
  await expect(page.locator(".ww-makes")).toContainText("An entry: the sky and the calendar");
  await page.getByRole("button", { name: "Make the world" }).click();
  await expect(page).toHaveURL(/\/map\/[a-z0-9]{8}/, { timeout: 60_000 });
  const id = /\/map\/([a-z0-9]{8})/.exec(page.url())![1]!;

  const made = await (await page.request.get(api(`/maps/${id}`, own))).json();
  expect(made.map.title).toBe("Test Globe");
  expect(made.map.space).toMatchObject({ kind: "sphere", unit: "km" });
  expect(made.map.space.radius).toBeGreaterThan(3000);
  expect(made.map.images[0].path).toMatch(/Test Globe map.*\.png$/);
  expect(made.map.terrain.image).toMatch(/Test Globe heights.*\.png$/);
  expect(made.map.terrain.rangeUnit).toBe("m");
  const zones = made.map.features.filter((f: { kind: string }) => f.kind === "zone");
  expect(zones.length).toBeGreaterThan(3);
  // Every zone is a biome's, or a lake in the Water style.
  expect(
    zones.every((z: { biome?: string; style?: string }) => !!z.biome || z.style === "strwater"),
  ).toBe(true);
  expect(zones.some((z: { biome?: string }) => !!z.biome)).toBe(true);
  expect(made.map.layers.some((l: { name: string }) => l.name === "Biomes")).toBe(true);
  expect(made.state).not.toBe("published");
  // Rivers, where enough rain gathers, are paths in their own layer.
  const rivers = made.map.features.filter((f: { kind: string }) => f.kind === "path");
  if (rivers.length > 0) {
    expect(made.map.layers.some((l: { name: string }) => l.name === "Rivers and lakes")).toBe(true);
  }

  // The system model: its star, its planets, and the world as home, which opens the globe map.
  const maps = await (await page.request.get(api("/maps", own))).json();
  const row = maps.maps.find((m: { title: string }) => m.title === "Test Globe system");
  expect(row).toBeTruthy();
  const system = await (await page.request.get(api(`/maps/${row.id}`, own))).json();
  const bodies = system.map.features.filter((f: { body?: unknown }) => f.body);
  expect(bodies.some((f: { body: { type: string } }) => f.body.type === "star")).toBe(true);
  const home = bodies.find((f: { body: { home?: boolean } }) => f.body.home);
  expect(home).toMatchObject({ label: "Test Globe", child: id });

  // The calendar is an entry not yet saved as a version.
  const calendar = await page.request.get(
    api(`/entries?path=${encodeURIComponent("The sky and the calendar of Test Globe.md")}`, own),
  );
  expect(calendar.ok()).toBe(true);
  expect(JSON.stringify(await calendar.json())).toContain("A year is");

  // The wizard remembers the map it made, and Home no longer says a world is waiting.
  await page.goto(proj("/world", own));
  await part(page, "Make it").click();
  await expect(page.getByRole("link", { name: "Open the map" })).toBeVisible();
  await page.goto(proj("/", own));
  await expect(page.locator(".home h1")).toBeVisible();
  await expect(page.getByRole("region", { name: "World Wizard" })).toHaveCount(0);
});

test("Life and lore finds places, the AI names them and suggests species and life, and Make it writes them", async ({
  page,
}, info) => {
  // The phone and the desktop run share a server: each names its own world and its own place.
  const mine = info.project.name;
  // The key is kept on the device, so the app is opened before it is given one.
  await page.goto(proj("/"));
  await setUpAi(page, { conversation: "sample/reader" });
  const own = await ownProject(page, "wizlore", mine);
  await openWizard(page, own);
  await page.getByRole("button", { name: "Surprise me" }).click();
  const ask = page.getByRole("dialog");
  if (await ask.isVisible().catch(() => false)) {
    await ask.getByRole("button", { name: "Roll it" }).click();
  }
  await expect(page.getByRole("heading", { name: "Biomes" })).toBeVisible();
  await part(page, "Life and lore").click();

  // Without the AI: the places found on the world, named for what they are.
  const places = page.getByRole("region", { name: "Places", exact: true });
  await expect(places.getByLabel("Name").first()).toHaveValue("The highest range");
  await expect(places).toContainText(/°C through the year/);
  await expect(page.getByRole("region", { name: "Sapient species" })).toHaveCount(0);

  await page.getByRole("button", { name: "One", exact: true }).click();
  await page.getByRole("button", { name: "Suggest names and entries" }).click();
  await expect(places.getByLabel("Name").first()).toHaveValue("Test peak");
  const species = page.getByRole("region", { name: "Sapient species" });
  await expect(species.getByLabel("Name")).toHaveValue("Testfolk 1");
  await expect(species).toContainText("They count in tides.");
  const life = page.getByRole("region", { name: "Life", exact: true });
  await expect(life.getByLabel("Name")).toHaveValue("Test reed deer");
  // A name is the author's to change, and an item his to leave out.
  await places.getByLabel("Name").first().fill(`Peak of the ${mine}`);
  await life.getByRole("checkbox").uncheck();
  await noSidewaysScroll(page);

  await part(page, "Make it").click();
  await page.getByLabel("Name of the world").fill(`Lore ${mine}`);
  await expect(page.locator(".ww-makes")).toContainText("The World brief");
  await page.getByRole("button", { name: /^Make (the world|it again)/ }).click();
  await expect(page).toHaveURL(/\/map\/[a-z0-9]{8}/, { timeout: 60_000 });
  const id = /\/map\/([a-z0-9]{8})/.exec(page.url())![1]!;

  // The place is a marker on the map, tied to its entry.
  const made = await (await page.request.get(api(`/maps/${id}`, own))).json();
  const marker = made.map.features.find(
    (f: { kind: string; label?: string }) =>
      f.kind === "marker" && f.label === `Peak of the ${mine}`,
  );
  expect(marker).toBeTruthy();
  expect(marker.entry).toBeTruthy();
  expect(made.entries[marker.entry].path).toBe(`Places/Peak of the ${mine}.md`);

  const read = async (path: string) =>
    page.request.get(api(`/entries?path=${encodeURIComponent(path)}`, own));
  const place = await read(`Places/Peak of the ${mine}.md`);
  expect(place.ok()).toBe(true);
  expect(JSON.stringify(await place.json())).toContain("The peak of the test world.");
  // The World brief is written by the wizard, and lists what was kept.
  const brief = await read(`Lore ${mine} world brief.md`);
  expect(brief.ok()).toBe(true);
  const text = JSON.stringify(await brief.json());
  expect(text).toContain(`Peak of the ${mine}`);
  expect(text).toContain("Built from seed");
  // What was left out was not written.
  expect((await read("Life/Test reed deer.md")).ok()).toBe(false);

  // Made again under the same name: what is already there is left alone, and the wizard says so.
  await page.goto(proj("/world", own));
  await part(page, "Make it").click();
  await page.getByRole("button", { name: "Make it again, as another map" }).click();
  await expect(page).toHaveURL(/\/map\/[a-z0-9]{8}/, { timeout: 60_000 });
  await expect(page.getByText(/already in the library and (was|were) left as/)).toBeVisible();
});
