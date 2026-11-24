import { expect, type Locator, type Page, test } from "@playwright/test";
import { rightPanel } from "./helpers.ts";

/**
 * The Layers tab as a tree (stage 16c): adding layers and sublayers, dragging one into another,
 * locking, hiding a layer with what is inside it, and choosing a feature from the list.
 */

const IMAGE = "99 Appendices/Images/map one.png";

type Layer = { id: string; name: string; parent?: string; locked?: boolean };
type Stored = { layers: Layer[]; features: { id: string; layer: string }[] };

/**
 * Makes a flat map through the API with a marker "Beacon" in the middle of it, in a sublayer
 * "Roads" of the first layer when `sublayer` is set, and returns its id.
 */
const makeMap = (page: Page, title: string, sublayer = false) =>
  page.evaluate(
    async ({ title, image, sublayer }) => {
      const json = { "content-type": "application/json" };
      const made = await fetch("/api/maps", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ title, kind: "flat", image }),
      });
      const { id } = (await made.json()) as { id: string };
      const loaded = await (await fetch(`/api/maps/${id}`)).json();
      const map = loaded.map;
      const top = map.layers[0].id as string;
      if (sublayer) {
        map.layers.push({
          id: "roads001",
          name: "Roads",
          visible: true,
          color: "#2f5d8a",
          parent: top,
        });
      }
      map.features = [
        {
          id: "beacon01",
          kind: "marker",
          layer: sublayer ? "roads001" : top,
          at: [map.space.width / 2, map.space.height / 2],
          entry: null,
          label: "Beacon",
          icon: null,
          child: null,
        },
      ];
      await fetch(`/api/maps/${id}`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ map, revision: loaded.revision, baseBlob: loaded.blob }),
      });
      return id;
    },
    { title, image: IMAGE, sublayer },
  );

const stored = (page: Page) =>
  page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    return ((await (await fetch(`/api/maps/${id}`)).json()) as { map: Stored }).map;
  });

const cleanUp = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    await fetch(`/api/maps/${id}`, { method: "DELETE" });
  }, id);

async function openMap(page: Page, title: string, sublayer = false) {
  await page.goto("/maps");
  const id = await makeMap(page, title, sublayer);
  await page.goto(`/map/${id}?edit=1`);
  await expect(page.locator(".map-top")).toBeVisible();
  await expect(page).toHaveURL(/v=/);
  await page.waitForTimeout(300);
  return id;
}

const row = (panel: Locator, name: string) => panel.getByRole("treeitem", { name, exact: true });

/** Drags a row by its handle onto the middle of another row. */
async function dragOnto(page: Page, from: Locator, to: Locator) {
  const grip = (await from.locator(".lt-grip").boundingBox())!;
  const target = (await to.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 8, { steps: 2 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await expect(to).toHaveClass(/drop-into/);
  await page.mouse.up();
}

/**
 * The middle of the map, where the marker is once the list has centred it: on a phone, the
 * middle of the part above the sheet.
 */
async function middle(page: Page) {
  await page.waitForTimeout(200);
  const box = (await page.locator(".map-top").boundingBox())!;
  const sheets = page.locator(".bottom-sheet");
  const sheet = (await sheets.count()) > 0 ? await sheets.boundingBox() : null;
  const bottom = sheet ? Math.min(box.y + box.height, sheet.y) : box.y + box.height;
  return { x: box.x + box.width / 2, y: (box.y + bottom) / 2 };
}

/** Whether a feature is selected: its tab is there. */
const featureTab = (page: Page) => page.getByRole("tab", { name: /^Edit feature/ });

test("adds a layer, puts it inside another by dragging, and adds a sublayer from the menu", async ({
  page,
}, info) => {
  const id = await openMap(page, `Layered ${info.project.name}`);
  const panel = await rightPanel(page, "Layers");
  const first = (await stored(page)).layers[0]!;

  await panel.getByRole("button", { name: "Add a layer", exact: true }).click();
  const name = panel.getByRole("textbox", { name: "Layer name" });
  await expect(name).toBeFocused();
  await name.fill("Roads");
  await name.press("Enter");
  await expect
    .poll(async () => (await stored(page)).layers.map((l) => l.name))
    .toEqual([first.name, "Roads"]);
  // The new layer is the one drawn into: it is only highlighted, with no words for it.
  await expect(row(panel, "Roads")).toHaveAttribute("aria-current", "true");
  await expect(panel).not.toContainText("Drawing into");
  // Clicking a layer makes it the current one.
  await row(panel, first.name).locator(".lt-name").click();
  await expect(row(panel, first.name)).toHaveAttribute("aria-current", "true");

  // Dragged onto the first layer, it goes inside it.
  await dragOnto(page, row(panel, "Roads"), row(panel, first.name));
  await expect
    .poll(async () => (await stored(page)).layers.find((l) => l.name === "Roads")?.parent)
    .toBe(first.id);
  await expect(row(panel, "Roads")).toHaveAttribute("aria-level", "2");
  await expect(panel.getByRole("button", { name: `Collapse ${first.name}` })).toBeVisible();

  // A sublayer from the row's right-click menu (a long press on a phone), named in place.
  await row(panel, "Roads").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add a sublayer" }).click();
  await expect(name).toBeFocused();
  await name.fill("Ruts");
  await name.press("Enter");
  await expect
    .poll(async () => (await stored(page)).layers.find((l) => l.name === "Ruts")?.parent)
    .toBe((await stored(page)).layers.find((l) => l.name === "Roads")?.id);
  await expect(row(panel, "Ruts")).toHaveAttribute("aria-level", "3");
  await expect(row(panel, "Ruts")).toHaveAttribute("aria-current", "true");

  // And back to the top level, without dragging.
  await row(panel, "Ruts").hover();
  await panel.getByRole("button", { name: `More for Ruts` }).click();
  await page.getByRole("menuitem", { name: "Move to the top level" }).click();
  await expect
    .poll(async () => (await stored(page)).layers.find((l) => l.name === "Ruts")?.parent)
    .toBeUndefined();

  // Its properties: locked from there.
  await row(panel, "Ruts").hover();
  await panel.getByRole("button", { name: "More for Ruts" }).click();
  await page.getByRole("menuitem", { name: "Properties…" }).click();
  const dialog = page.getByRole("dialog", { name: "Properties of Ruts" });
  await dialog.getByLabel(/^Locked/).check();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(async () => (await stored(page)).layers.find((l) => l.name === "Ruts")?.locked)
    .toBe(true);

  // Deleting a layer that holds a feature asks where the feature goes; its sublayer stays.
  await row(panel, first.name).hover();
  await panel.getByRole("button", { name: `More for ${first.name}` }).click();
  await page.getByRole("menuitem", { name: `Delete ${first.name}` }).click();
  const ask = page.getByRole("dialog", { name: `Delete ${first.name}?` });
  await expect(ask).toContainText("It holds 1 feature.");
  await ask.getByLabel("The layer they move to").selectOption({ label: "Ruts" });
  await ask.getByRole("button", { name: "Delete the layer" }).click();
  await expect
    .poll(async () => (await stored(page)).layers.map((l) => l.name))
    .toEqual(["Roads", "Ruts"]);
  const after = await stored(page);
  expect(after.features[0]!.layer).toBe(after.layers[1]!.id);
  expect(after.layers[0]!.parent).toBeUndefined();
  await cleanUp(page, id);
});

test("a feature chosen in the list is selected and centred; a locked layer's cannot be picked", async ({
  page,
}, info) => {
  const id = await openMap(page, `Locked ${info.project.name}`);
  const panel = await rightPanel(page, "Layers");
  const first = (await stored(page)).layers[0]!;

  // Choosing the feature in the list selects it on the map and centres the map on it.
  await row(panel, "Beacon").click();
  await expect(row(panel, "Beacon")).toHaveAttribute("aria-selected", "true");
  await expect(featureTab(page)).toHaveCount(1);
  const centre = await middle(page);
  // Off it, on the empty map: nothing is selected. On it: it is, and the list shows it.
  await page.mouse.click(centre.x - 120, centre.y - 90);
  await expect(featureTab(page)).toHaveCount(0);
  await page.mouse.click(centre.x, centre.y);
  await expect(featureTab(page)).toHaveCount(1);
  const again = await rightPanel(page, "Layers");
  await expect(row(again, "Beacon")).toHaveAttribute("aria-selected", "true");
  await page.mouse.click(centre.x - 120, centre.y - 90);
  await expect(featureTab(page)).toHaveCount(0);

  // Locked, the layer's marker is still drawn but a click passes through it.
  await row(again, first.name).hover();
  await again.getByRole("button", { name: `Lock ${first.name}` }).click();
  await expect.poll(async () => (await stored(page)).layers[0]!.locked).toBe(true);
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(300);
  await expect(featureTab(page)).toHaveCount(0);

  await again.getByRole("button", { name: `Unlock ${first.name}` }).click();
  await expect.poll(async () => (await stored(page)).layers[0]!.locked).toBeUndefined();
  await page.mouse.click(centre.x, centre.y);
  await expect(featureTab(page)).toHaveCount(1);
  await cleanUp(page, id);
});

test("hiding a layer hides its sublayers and their features", async ({ page }, info) => {
  const id = await openMap(page, `Hidden ${info.project.name}`, true);
  const panel = await rightPanel(page, "Layers");
  const first = (await stored(page)).layers[0]!;
  await expect(row(panel, "Roads")).toHaveAttribute("aria-level", "2");

  await row(panel, "Beacon").click();
  const centre = await middle(page);
  await page.mouse.click(centre.x - 120, centre.y - 90);
  await expect(featureTab(page)).toHaveCount(0);

  // The top layer hidden: the sublayer's marker is gone from the map, and dimmed in the list.
  await panel.getByRole("button", { name: `Hide ${first.name}` }).click();
  await expect(page).toHaveURL(new RegExp(`hide=${first.id}(&|$)`));
  await expect(row(panel, "Roads")).toHaveClass(/is-off/);
  await expect(row(panel, "Beacon")).toHaveClass(/is-off/);
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(300);
  await expect(featureTab(page)).toHaveCount(0);

  await panel.getByRole("button", { name: `Show ${first.name}` }).click();
  await expect(row(panel, "Roads")).not.toHaveClass(/is-off/);
  await page.mouse.click(centre.x, centre.y);
  await expect(featureTab(page)).toHaveCount(1);
  await cleanUp(page, id);
});
