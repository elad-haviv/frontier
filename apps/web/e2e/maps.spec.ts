import { expect, type Page, test } from "@playwright/test";
import {
  answerDialog,
  chooseMapImage,
  entry,
  newMapInForm,
  onMain,
  openMenu,
  pickEntry,
  publish,
  review,
} from "./helpers.ts";

const makeMap = newMapInForm;

/** Throws the open map away, so the next test finds nothing unpublished. */
async function discardMap(page: Page) {
  await page.evaluate(async () => {
    await fetch(`/api/maps/${location.pathname.split("/").pop()}`, { method: "DELETE" });
  });
}

/** The middle of the map's canvas, in page coordinates. */
async function centre(page: Page) {
  const box = (await page.locator(".map-top").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

test("CUJ 7: places a marker for an entry, opens the entry from the map and comes back", async ({
  page,
}, info) => {
  const who = info.project.name;
  const title = `Harbor chart ${who}`;
  await makeMap(page, title, "flat");
  const c = await centre(page);

  await page.getByRole("button", { name: "Marker" }).click();
  await page.mouse.click(c.x, c.y);
  const editor = page.locator(".feature-editor");
  await expect(editor).toBeVisible();
  await pickEntry(editor, "Mira");
  await expect(page.locator(".save-saved")).toBeVisible();
  // An icon from the vault's marker sets.
  await editor.getByRole("button", { name: "Lamp" }).click();
  await expect(page.locator(".save-saved")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  // Reading: move the map, tap the marker, read the card, open the entry. The frame grew when
  // the tools went away, and the marker stays at its centre.
  await expect(page.locator(".map-tools")).toHaveCount(0);
  const r = await centre(page);
  await page.mouse.move(r.x + 80, r.y - 20);
  await page.mouse.down();
  await page.mouse.move(r.x + 20, r.y - 60, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const address = page.url();
  expect(decodeURIComponent(address)).toMatch(/v=f,/);
  await page.mouse.click(r.x - 60, r.y - 40);
  const card = page.locator(".feature-card");
  await expect(card.locator("h2")).toHaveText("Mira");
  await card.getByRole("link", { name: "Open the entry" }).click();
  await expect(page.locator("h1")).toHaveText("Mira");
  await expect(page.locator(".on-maps")).toContainText(title);

  // Back returns to the map at the same place.
  await page.goBack();
  await expect(page.locator(".map-top")).toBeVisible();
  expect(page.url()).toBe(address);

  // The map and the id written into the entry are published together.
  await review(page);
  await publish(page, `Add ${title}`);
  expect(onMain("02 People/Mira.md")).toMatch(/^---\nid: [a-z0-9]{8}\n---\n/);
  await page.goto(entry("02 People/Mira.md"));
  await page.locator(".on-maps a", { hasText: title }).click();
  // Opened from the entry, the map is centred on the marker and shows its card.
  await expect(page.locator(".feature-card h2")).toHaveText("Mira");
});

test("CUJ 5: on a phone, Done, Undo and the menu stay on screen, and Delete map is in the menu", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await makeMap(page, `Pocket chart ${info.project.name}`, "flat");
  const c = await centre(page);
  await page.getByRole("button", { name: "Marker" }).click();
  await page.mouse.click(c.x, c.y);
  await expect(page.locator(".feature-editor")).toBeVisible();
  await page.locator(".feature-editor .card-close").click();

  for (const name of ["Done", "Undo", "Redo", "More actions"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  // The tools are icons in a bar below the map, each named for screen readers.
  const tools = (await page.locator(".map-tools").boundingBox())!;
  const frame = (await page.locator(".map-frame").boundingBox())!;
  expect(tools.y).toBeGreaterThanOrEqual(frame.y + frame.height - 1);
  for (const name of ["Select", "Marker", "Path", "Zone", "Measure"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  // Delete map is no longer in a row beside Undo; it waits in the menu.
  await expect(page.getByRole("button", { name: "Delete map" })).toHaveCount(0);
  await openMenu(page, "More actions");
  await page.getByRole("menuitem", { name: "Delete map" }).click();
  await answerDialog(page, "Delete the map");
  await expect(page).toHaveURL(/\/maps$/);
});

test("draws a path and a zone, hides a layer, and undoes", async ({ page }, info) => {
  await makeMap(page, `Sketches ${info.project.name}`, "flat");
  const c = await centre(page);

  await page.getByRole("button", { name: "Path" }).click();
  // The tool is ready for taps once its hint shows; a tap before that would select instead.
  await expect(page.locator(".map-hint", { hasText: "Tap to add points." })).toBeVisible();
  await page.mouse.click(c.x - 60, c.y - 30);
  await page.mouse.click(c.x, c.y - 10);
  await page.mouse.click(c.x + 60, c.y - 30);
  await page.locator(".map-hint").getByRole("button", { name: "Finish path" }).click();
  await expect(page.locator(".feature-editor")).toBeVisible();
  await page
    .locator(".feature-editor")
    .getByLabel(/^Label/)
    .fill("The Salt Road");

  await page.getByRole("button", { name: "Zone" }).click();
  // The tool is ready for taps once its hint shows; a tap before that would select instead.
  await expect(page.locator(".map-hint", { hasText: "Tap to add points." })).toBeVisible();
  await page.mouse.click(c.x - 50, c.y + 20);
  await page.mouse.click(c.x + 50, c.y + 20);
  await page.mouse.click(c.x, c.y + 70);
  // A tap on the last point finishes the shape.
  await page.mouse.click(c.x, c.y + 70);
  await expect(page.locator(".feature-editor")).toBeVisible();
  await expect(page.locator(".save-saved")).toBeVisible();

  // Tapping inside the zone selects it; tapping the path selects the path.
  await page.locator(".feature-editor .card-close").click();
  await page.mouse.click(c.x, c.y + 40);
  await expect(page.locator(".feature-editor")).toBeVisible();
  // On a phone the editor covers part of the map; it is closed before the next tap.
  await page.locator(".feature-editor .card-close").click();
  await page.mouse.click(c.x - 30, c.y - 20);
  await expect(page.locator(".feature-editor").getByLabel(/^Label/)).toHaveValue("The Salt Road");

  // Undo takes the zone away again; redo brings it back.
  const count = () =>
    page.evaluate(async () => {
      const id = location.pathname.split("/").pop();
      const res = await fetch(`/api/maps/${id}`);
      return ((await res.json()) as { map: { features: unknown[] } }).map.features.length;
    });
  await expect.poll(count).toBe(2);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(count).toBe(1);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect.poll(count).toBe(2);

  // Hiding the layer is kept in the address and changes nothing in the map.
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Layers" }).click();
  await page.getByLabel("Show Places").uncheck();
  await expect(page).toHaveURL(/hide=/);
  await page.mouse.click(c.x - 30, c.y - 20);
  await expect(page.locator(".feature-card")).toHaveCount(0);
  await discardMap(page);
});

test("CUJ 10: measures on a globe of unknown size, then with a radius", async ({ page }, info) => {
  await makeMap(page, `World ${info.project.name}`, "sphere");
  const c = await centre(page);
  await page.getByRole("button", { name: "Measure" }).click();
  await page.mouse.click(c.x - 40, c.y);
  await page.mouse.click(c.x + 40, c.y);
  const hint = page.locator(".map-hint");
  await expect(hint).toContainText("°");
  await expect(hint).toContainText("% of the way round");
  await expect(hint).not.toContainText("km");

  await hint.getByRole("button", { name: "Set the radius" }).click();
  await answerDialog(page, "Set the radius", "6000");
  await expect(hint).toContainText("km");

  // The same world laid flat, and back.
  await page.getByLabel("View").selectOption("plate");
  await expect(page).toHaveURL(/v=p(,|%2C)/);
  await page.getByLabel("View").selectOption("globe");
  await expect(page).toHaveURL(/v=g(,|%2C)/);
  await expect(page.locator(".save-saved")).toBeVisible();
  await discardMap(page);
});

/** The open map as the server has it. */
const stored = (page: Page) =>
  page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    const res = await fetch(`/api/maps/${id}`);
    return (
      (await res.json()) as {
        map: {
          space: { width: number; height: number };
          images: { name: string; extent: number[]; visible: boolean }[];
          features: { label: string | null }[];
        };
      }
    ).map;
  });

test("adds a second image, places it by its extent, hides it and takes it off", async ({
  page,
}, info) => {
  await makeMap(page, `Two pictures ${info.project.name}`, "flat");
  const c = await centre(page);
  // A patch of the map above the panel, which on a phone covers the bottom of the frame.
  const patch = () =>
    page.screenshot({ clip: { x: c.x - 30, y: c.y - 50, width: 60, height: 30 } });
  // The first picture has arrived when the patch stops changing.
  let alone = await patch();
  await expect
    .poll(async () => {
      const before = alone;
      alone = await patch();
      return before.equals(alone);
    })
    .toBe(true);

  await page.getByRole("button", { name: "Layers" }).click();
  const panel = page.locator(".layer-panel");
  await expect(panel.getByLabel("Image name")).toHaveCount(1);
  await chooseMapImage(
    page,
    panel.getByRole("button", { name: "Add an image…" }),
    "Sample world.png",
  );
  await expect(panel.getByLabel("Image name")).toHaveCount(2);
  await expect(panel.getByLabel("Image name").nth(1)).toHaveValue("Sample world");
  await expect(panel.getByLabel("Show Sample world")).toBeChecked();
  const { space } = await stored(page);
  const whole = [0, 0, space.width, space.height];
  await expect.poll(async () => (await stored(page)).images[1]?.extent).toEqual(whole);
  // The second picture is drawn over the first.
  await expect.poll(async () => (await patch()).equals(alone)).toBe(false);

  // Its extent: the right half of the map. A number that makes no extent is refused and said.
  await panel.getByRole("button", { name: "Place Sample world" }).click();
  const form = panel.getByRole("group", { name: "Where Sample world sits" });
  await form.getByLabel("Left").fill(String(space.width / 2));
  const half = [space.width / 2, 0, space.width, space.height];
  await expect.poll(async () => (await stored(page)).images[1]?.extent).toEqual(half);
  await form.getByLabel("Right").fill("-3");
  await expect(form.getByRole("alert")).toHaveText("Left must be less than right.");
  await expect(page.locator(".save-saved")).toBeVisible();
  expect((await stored(page)).images[1]?.extent).toEqual(half);
  await form.getByRole("button", { name: "The whole map" }).click();
  await expect(form.getByLabel("Right")).toHaveValue(String(space.width));
  await expect(form.getByRole("alert")).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).images[1]?.extent).toEqual(whole);

  // The order of the pictures: moved up, it is drawn first, under the other.
  await panel.getByRole("button", { name: "Move Sample world up" }).click();
  await expect.poll(async () => (await stored(page)).images[0]?.name).toBe("Sample world");
  await panel.getByRole("button", { name: "Move Sample world down" }).click();
  await expect.poll(async () => (await stored(page)).images[1]?.name).toBe("Sample world");

  // Hiding it is kept in the address and shows the first picture again.
  await panel.getByLabel("Show Sample world").uncheck();
  await expect(page).toHaveURL(/img=/);
  await expect.poll(async () => (await patch()).equals(alone)).toBe(true);
  await expect(page.locator(".save-saved")).toBeVisible();
  expect((await stored(page)).images[1]?.visible).toBe(true);

  // Taking it off the map, from the row's menu, asks first.
  await panel.getByRole("button", { name: "More for Sample world" }).click();
  await page.getByRole("menuitem", { name: "Take Sample world off the map" }).click();
  await answerDialog(page, "Take it off");
  await expect(panel.getByLabel("Image name")).toHaveCount(1);
  await expect.poll(async () => (await stored(page)).images.length).toBe(1);
  // The last image cannot be taken off.
  await panel
    .getByRole("button", { name: /^More for / })
    .first()
    .click();
  await expect(page.getByRole("menuitem", { name: /^Take .* off the map/ })).toBeDisabled();
  await page.keyboard.press("Escape");
  await discardMap(page);
});

test("brings one of two markers on the same spot above the other", async ({ page }, info) => {
  await makeMap(page, `Stacked ${info.project.name}`, "flat");
  const c = await centre(page);
  const editor = page.locator(".feature-editor");
  for (const label of ["First", "Second"]) {
    await page.getByRole("button", { name: "Marker" }).click();
    await page.mouse.click(c.x, c.y - 40);
    await editor.getByLabel(/^Label/).fill(label);
    await editor.locator(".card-close").click();
  }
  const order = async () => (await stored(page)).features.map((f) => f.label);
  await expect.poll(order).toEqual(["First", "Second"]);
  // The marker tool stays on after a marker; Select picks them again.
  await page.getByRole("button", { name: "Select", exact: true }).click();

  // The later marker lies above, so a tap finds it. It has nothing to pass going forward.
  await page.mouse.click(c.x, c.y - 40);
  await expect(editor.getByLabel(/^Label/)).toHaveValue("Second");
  await expect(editor.getByRole("button", { name: "Bring forward" })).toBeDisabled();
  await editor.getByRole("button", { name: "Send back" }).click();
  await expect.poll(order).toEqual(["Second", "First"]);
  await expect(editor.getByRole("button", { name: "Send back" })).toBeDisabled();
  await editor.locator(".card-close").click();
  await page.mouse.click(c.x, c.y - 40);
  await expect(editor.getByLabel(/^Label/)).toHaveValue("First");

  // And forward again, which undo then takes back.
  await editor.locator(".card-close").click();
  await page.mouse.click(c.x, c.y - 40);
  await editor.getByRole("button", { name: "Send back" }).click();
  await expect.poll(order).toEqual(["First", "Second"]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(order).toEqual(["Second", "First"]);
  await expect(page.locator(".save-saved")).toBeVisible();
  await discardMap(page);
});

test("a zone around a pole is filled up to the pole in the flat view of a globe", async ({
  page,
}, info) => {
  await makeMap(page, `Polar ${info.project.name}`, "sphere");
  await page.getByLabel("View").selectOption("plate");
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  // The address says where the view is; from it, where a position falls on the screen.
  await page.waitForTimeout(600);
  const [kind, lon0, lat0, k] = new URL(page.url()).searchParams.get("v")!.split(",");
  expect(kind).toBe("p");
  const c = await centre(page);
  const at = (lon: number, lat: number): [number, number] => [
    c.x + (lon - Number(lon0)) * Number(k),
    c.y + (Number(lat0) - lat) * Number(k),
  ];
  // The whole height of the globe is on screen, with room to tap near the pole.
  expect(at(0, 90)[1]).toBeGreaterThan(c.box.y + 50);

  await page.getByRole("button", { name: "Zone" }).click();
  // The tool is ready for taps once its hint shows; a tap before that would select instead.
  await expect(page.locator(".map-hint", { hasText: "Tap to add points." })).toBeVisible();
  for (const lon of [-100, 0, 100]) await page.mouse.click(...at(lon, 70));
  await page.locator(".map-hint").getByRole("button", { name: "Finish zone" }).click();
  const editor = page.locator(".feature-editor");
  await expect(editor).toBeVisible();
  await editor.getByLabel(/^Label/).fill("The ice");
  await editor.locator(".card-close").click();
  await expect(page.locator(".save-saved")).toBeVisible();

  // Near the pole, between two corners and on the far side from the third: inside.
  await page.mouse.click(...at(50, 87));
  await expect(editor.getByLabel(/^Label/)).toHaveValue("The ice");
  await editor.locator(".card-close").click();
  await page.mouse.click(...at(-95, 88));
  await expect(editor.getByLabel(/^Label/)).toHaveValue("The ice");
  await editor.locator(".card-close").click();
  // Under the outline: outside.
  await page.mouse.click(...at(50, 55));
  await expect(editor).toHaveCount(0);
  await discardMap(page);
});
