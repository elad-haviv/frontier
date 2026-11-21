import { expect, type Page, test } from "@playwright/test";
import { entry, onMain, publish, review } from "./helpers.ts";

const IMAGE = "99 Appendices/Images/map one.png";

async function makeMap(page: Page, title: string, kind: "flat" | "sphere") {
  await page.goto("/maps");
  await page.locator(".new-map input[type=text]").fill(title);
  await page.locator(".new-map select").nth(0).selectOption(kind);
  await page.locator(".new-map select").nth(1).selectOption(IMAGE);
  await page.getByRole("button", { name: "Make the map" }).click();
  await expect(page.locator(".map-top")).toBeVisible();
  // The view is written into the address once the map has been laid out.
  await expect(page).toHaveURL(/v=/);
}

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
  await editor.getByLabel("Find an entry").fill("Mira");
  await editor.locator(".entry-picker li button", { hasText: "Mira" }).first().click();
  await expect(editor.locator(".linked")).toContainText("Mira");
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

test("draws a path and a zone, hides a layer, and undoes", async ({ page }, info) => {
  await makeMap(page, `Sketches ${info.project.name}`, "flat");
  const c = await centre(page);

  await page.getByRole("button", { name: "Path" }).click();
  await page.mouse.click(c.x - 60, c.y - 30);
  await page.mouse.click(c.x, c.y - 10);
  await page.mouse.click(c.x + 60, c.y - 30);
  await page.locator(".map-hint").getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".feature-editor")).toBeVisible();
  await page
    .locator(".feature-editor")
    .getByLabel(/^Label/)
    .fill("The Salt Road");

  await page.getByRole("button", { name: "Zone" }).click();
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

  page.once("dialog", (d) => void d.accept("6000"));
  await hint.getByRole("button", { name: "Set the radius" }).click();
  await expect(hint).toContainText("km");

  // The same world laid flat, and back.
  await page.getByRole("button", { name: "Flat", exact: true }).click();
  await expect(page).toHaveURL(/v=p(,|%2C)/);
  await page.getByRole("button", { name: "Globe", exact: true }).click();
  await expect(page).toHaveURL(/v=g(,|%2C)/);
  await expect(page.locator(".save-saved")).toBeVisible();
  await discardMap(page);
});
