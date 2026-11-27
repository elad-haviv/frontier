import { expect, type Page, test } from "./test.ts";
import { chooseKind, openNewMap, rightPanel, proj } from "./helpers.ts";

/** Throws the open map away, so the next test finds nothing unpublished. */
async function discardMap(page: Page) {
  await page.evaluate(async () => {
    await fetch(`${API}/maps/${location.pathname.split("/").pop()}`, { method: "DELETE" });
  });
}

async function newStarMap(page: Page, title: string) {
  await page.goto(proj("/maps"));
  await openNewMap(page);
  await page.locator(".new-map input[type=text]").fill(title);
  await chooseKind(page, "Star map");
  // A star map needs no image: Make the map is enough.
  await page.getByRole("button", { name: "Make the map" }).click();
  await expect(page.locator(".star-canvas")).toBeVisible();
}

test("a star map is made without an image, with stars placed on the plane, joined by a route and lifted", async ({
  page,
}, info) => {
  await newStarMap(page, `Near stars ${info.project.name}`);
  const canvas = page.locator(".star-canvas");
  let box = (await canvas.boundingBox())!;
  const cy = box.y + box.height * 0.3;
  const name = page.getByRole("textbox", { name: "Name" });

  // The Star tool places a star where the plane is clicked, and opens its tab.
  await page.getByRole("button", { name: "Star" }).first().click();
  await page.mouse.click(box.x + box.width / 2, cy);
  await expect(name).toBeVisible();
  // The side bar opening narrows the canvas, and the view stays centred: measure again.
  // (On a phone the sheet covers the map instead, and nothing moves.)
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await canvas.boundingBox());
      const settled = now === last;
      last = now;
      return settled;
    })
    .toBe(true);
  box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  await name.fill("Solen");
  await expect(page.getByRole("spinbutton", { name: "Height" })).toHaveValue("0");
  await page.mouse.click(cx + 120, cy + 40);
  await name.fill("Twin Hearths");

  // The Route tool joins stars one after another; a star clicked twice in a row ends it.
  await page.getByRole("button", { name: "Route" }).first().click();
  await expect(page.locator(".map-hint")).toContainText("first star");
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx + 120, cy + 40);
  await expect(page.locator(".map-hint")).toContainText("2 stops");
  await page.getByRole("button", { name: "Finish route" }).click();
  // The new route is selected: its tab shows its length, which comes from the places.
  await expect(page.getByRole("heading", { name: "Stops" })).toBeVisible();
  await expect(page.locator(".star-facts")).toContainText("Length");

  // The layers tab lists both stars and the route.
  const layers = await rightPanel(page, "Layers");
  const places = layers.locator(".star-places");
  await expect(layers.getByRole("heading", { name: "Places (2)" })).toBeVisible();
  await expect(places.getByRole("button", { name: "Solen" })).toBeVisible();
  await expect(places.getByRole("button", { name: "New route" })).toBeVisible();

  // Lifting a star above the plane is a number, as well as a handle on the canvas.
  await places.getByRole("button", { name: "Solen" }).click();
  const edit = await rightPanel(page, "Edit feature");
  await edit.getByRole("spinbutton", { name: "Height" }).fill("4.5");
  await expect(edit.getByRole("spinbutton", { name: "Height" })).toHaveValue("4.5");

  // Done keeps all of it after the page is read again.
  await page.getByRole("button", { name: "Done" }).first().click();
  await page.reload();
  await expect(page.locator(".star-canvas")).toBeVisible();
  const again = await rightPanel(page, "Layers");
  await expect(again.getByRole("heading", { name: "Places (2)" })).toBeVisible();
  await again.locator(".star-places").getByRole("button", { name: "Solen" }).click();
  const card = await rightPanel(page, "Selected");
  await expect(card.locator(".star-facts")).toContainText("4.5 ly above the plane");
  await expect(card.locator(".star-facts")).toContainText("Twin Hearths");
  await discardMap(page);
});

test("the New map form hides the image for a star map and shows it again for a flat map", async ({
  page,
}) => {
  await page.goto(proj("/maps"));
  await openNewMap(page);
  const image = page.locator(".new-map .field:has(.chosen-image)");
  await expect(image).toBeVisible();
  await chooseKind(page, "Star map");
  await expect(image).toBeHidden();
  await expect(page.getByRole("button", { name: "Make the map" })).toBeDisabled();
  await page.locator(".new-map input[type=text]").fill("Anything");
  await expect(page.getByRole("button", { name: "Make the map" })).toBeEnabled();
  await chooseKind(page, "Flat map");
  await expect(image).toBeVisible();
  await expect(page.getByRole("button", { name: "Make the map" })).toBeDisabled();
});

test("a star slides level when dragged, rises with its handle, and undo takes each back", async ({
  page,
}, info) => {
  await newStarMap(page, `Dragging ${info.project.name}`);
  const canvas = page.locator(".star-canvas");
  const first = (await canvas.boundingBox())!;
  const y = first.y + first.height * 0.3;
  await page.getByRole("button", { name: "Star" }).first().click();
  await page.mouse.click(first.x + first.width / 2, y);
  const across = page.getByRole("spinbutton", { name: "Across" });
  const height = page.getByRole("spinbutton", { name: "Height" });
  await expect(across).toBeVisible();
  // The side bar opening can narrow the canvas, and the view stays centred: measure again.
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await canvas.boundingBox());
      const settled = now === last;
      last = now;
      return settled;
    })
    .toBe(true);
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2;
  await page.getByRole("button", { name: "Select" }).first().click();
  const startX = Number(await across.inputValue());

  // Dragging the star moves it along the plane, keeping its height.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y, { steps: 4 });
  await page.mouse.move(x + 40, y, { steps: 4 });
  await page.mouse.up();
  await expect(across).not.toHaveValue(String(startX));
  await expect(height).toHaveValue("0");
  const moved = await across.inputValue();

  // Its handle, above it, lifts it off the plane.
  await page.mouse.move(x + 40, y - 30);
  await page.mouse.down();
  await page.mouse.move(x + 40, y - 45, { steps: 4 });
  await page.mouse.move(x + 40, y - 60, { steps: 4 });
  await page.mouse.up();
  await expect(height).not.toHaveValue("0");
  expect(Number(await height.inputValue())).toBeGreaterThan(0);

  // Undo takes the lift back, then the slide.
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(height).toHaveValue("0");
  await expect(across).toHaveValue(moved);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(across).toHaveValue(String(startX));
  await discardMap(page);
});

test("a star map made in parsecs keeps that unit", async ({ page }, info) => {
  await page.goto(proj("/maps"));
  await openNewMap(page);
  await page.locator(".new-map input[type=text]").fill(`Parsecs ${info.project.name}`);
  await chooseKind(page, "Star map");
  await page.getByLabel("Distances are in").selectOption("pc");
  await page.getByRole("button", { name: "Make the map" }).click();
  await expect(page.locator(".star-canvas")).toBeVisible();
  const unit = await page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    for (let i = 0; i < 20; i++) {
      const got = (await (await fetch(`${API}/maps/${id}`)).json()) as {
        map: { space: { unit: string } };
      };
      if (got.map.space.unit === "pc") return "pc";
      await new Promise((r) => setTimeout(r, 250));
    }
    return "ly";
  });
  expect(unit).toBe("pc");
  await discardMap(page);
});
