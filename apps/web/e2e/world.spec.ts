import { expect, type Page, test } from "@playwright/test";
import { api, noSidewaysScroll, proj } from "./helpers.ts";

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

async function openWizard(page: Page): Promise<void> {
  await page.goto(proj("/world"));
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
}) => {
  await openWizard(page);
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

  const made = await (await page.request.get(api(`/maps/${id}`))).json();
  expect(made.map.title).toBe("Test Globe");
  expect(made.map.space).toMatchObject({ kind: "sphere", unit: "km" });
  expect(made.map.space.radius).toBeGreaterThan(3000);
  expect(made.map.images[0].path).toMatch(/Test Globe map.*\.png$/);
  expect(made.map.terrain.image).toMatch(/Test Globe heights.*\.png$/);
  expect(made.map.terrain.rangeUnit).toBe("m");
  const zones = made.map.features.filter((f: { kind: string }) => f.kind === "zone");
  expect(zones.length).toBeGreaterThan(3);
  expect(zones.every((z: { biome?: string }) => !!z.biome)).toBe(true);
  expect(made.map.layers.some((l: { name: string }) => l.name === "Biomes")).toBe(true);
  expect(made.state).not.toBe("published");
  // Rivers, where enough rain gathers, are paths in their own layer.
  const rivers = made.map.features.filter((f: { kind: string }) => f.kind === "path");
  if (rivers.length > 0) {
    expect(made.map.layers.some((l: { name: string }) => l.name === "Rivers")).toBe(true);
  }

  // The system model: its star, its planets, and the world as home, which opens the globe map.
  // (The phone and the desktop run share a server, so there may be two of that name.)
  const maps = await (await page.request.get(api("/maps"))).json();
  const rows = maps.maps.filter((m: { title: string }) => m.title === "Test Globe system");
  expect(rows.length).toBeGreaterThan(0);
  let home: { label?: string; child?: string } | undefined;
  for (const row of rows) {
    const system = await (await page.request.get(api(`/maps/${row.id}`))).json();
    const bodies = system.map.features.filter((f: { body?: unknown }) => f.body);
    expect(bodies.some((f: { body: { type: string } }) => f.body.type === "star")).toBe(true);
    const found = bodies.find((f: { body: { home?: boolean } }) => f.body.home);
    if (found?.child === id) home = found;
  }
  expect(home).toMatchObject({ label: "Test Globe", child: id });

  // The calendar is an entry not yet saved as a version.
  const calendar = await page.request.get(
    api(`/entries?path=${encodeURIComponent("The sky and the calendar of Test Globe.md")}`),
  );
  expect(calendar.ok()).toBe(true);
  expect(JSON.stringify(await calendar.json())).toContain("A year is");

  // The wizard remembers the map it made, and Home no longer says a world is waiting.
  await page.goto(proj("/world"));
  await part(page, "Make it").click();
  await expect(page.getByRole("link", { name: "Open the map" })).toBeVisible();
  await page.goto(proj("/"));
  await expect(page.locator(".home h1")).toBeVisible();
  await expect(page.getByRole("region", { name: "World Wizard" })).toHaveCount(0);
});
