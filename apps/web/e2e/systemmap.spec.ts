import { expect, type Page, test } from "@playwright/test";
import { chooseKind, openNewMap, rightPanel, at } from "./helpers.ts";

/** Throws the open map away, so the next test finds nothing unpublished. */
async function discardMap(page: Page) {
  await page.evaluate(async () => {
    await fetch(`/api/maps/${location.pathname.split("/").pop()}`, { method: "DELETE" });
  });
}

async function newSystem(page: Page, title: string) {
  await page.goto(at("/maps"));
  await openNewMap(page);
  await page.locator(".new-map input[type=text]").fill(title);
  await chooseKind(page, "System model");
  await page.getByRole("button", { name: "Make the map" }).click();
  await expect(page.locator(".star-canvas")).toBeVisible();
}

test("a system model starts with its star, and a world dropped on it gets an orbit and a year", async ({
  page,
}, info) => {
  await newSystem(page, `Solen ${info.project.name}`);
  const canvas = page.locator(".star-canvas");
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.3;

  // The tool offers kinds; a click says how far out the world goes.
  await page.getByRole("button", { name: "Add object" }).first().click();
  await page.getByRole("menuitem", { name: /^Ocean world/ }).click();
  await expect(page.locator(".map-hint")).toContainText("distance");
  await page.mouse.click(cx + 140, cy);
  const name = page.getByRole("textbox", { name: "Name" });
  await expect(name).toBeVisible();
  await name.fill("Tamar");

  // Distance and year are one fact: setting a distance of 1 AU gives a year of 365 days.
  const edit = await rightPanel(page, "Edit object");
  await edit.getByRole("spinbutton", { name: "Distance, AU" }).fill("1");
  await expect
    .poll(async () =>
      Number(await edit.getByRole("spinbutton", { name: "Its year, in days" }).inputValue()),
    )
    .toBeCloseTo(365.3, 0);
  // And the other way: a year of 687 days puts it out at about 1.5 AU.
  await edit.getByRole("spinbutton", { name: "Its year, in days" }).fill("687");
  await expect
    .poll(async () =>
      Number(await edit.getByRole("spinbutton", { name: "Distance, AU" }).inputValue()),
    )
    .toBeCloseTo(1.52, 1);

  // A second star makes a pair that circle each other.
  await page.getByRole("button", { name: "Add object" }).first().click();
  await page.getByRole("menuitem", { name: /second star/i }).click();
  await expect(page.getByRole("status").filter({ hasText: "circle each other" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Apart, in AU" })).toBeVisible();

  // Done keeps it all, and the objects are listed as an outline.
  await page.getByRole("button", { name: "Done" }).first().click();
  await page.reload();
  await expect(page.locator(".star-canvas")).toBeVisible();
  const objects = await rightPanel(page, "Objects");
  await expect(objects.getByRole("button", { name: /^Tamar/ })).toBeVisible();
  await expect(objects.getByRole("button", { name: /second star/i })).toBeVisible();
  await discardMap(page);
});

test("time plays and the year moves; a world's card says when it is next closest to home", async ({
  page,
}, info) => {
  await newSystem(page, `Years ${info.project.name}`);
  const canvas = page.locator(".star-canvas");
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.3;
  const place = async (kind: RegExp, dx: number) => {
    await page.getByRole("button", { name: "Add object" }).first().click();
    await page.getByRole("menuitem", { name: kind }).click();
    await page.mouse.click(cx + dx, cy);
    await expect(page.getByRole("textbox", { name: "Name" })).toBeVisible();
  };
  await place(/^Ocean world/, 90);
  await page.getByRole("textbox", { name: "Name" }).fill("Tamar");
  const edit = await rightPanel(page, "Edit object");
  await edit.getByRole("group", { name: "Colour" }).getByRole("button").first().click();
  await edit.locator("summary", { hasText: "More" }).click();
  await edit.getByRole("checkbox", { name: /home world/ }).check();
  // The other side of the star: the right edge of a phone has the zoom buttons.
  await place(/^Rocky planet/, -130);
  await page.getByRole("textbox", { name: "Name" }).fill("Ordo");
  await page.getByRole("button", { name: "Done" }).first().click();

  // Playing moves the year on; pausing stops it.
  const year = page.locator(".system-time .time-year");
  await expect(year).toHaveText("Year 0, day 1");
  await page.getByLabel("Speed").selectOption({ value: "365.25" });
  await page.getByRole("button", { name: "Play" }).click();
  await expect(year).not.toHaveText("Year 0, day 1");
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();

  // The card of the other world says how far it is from home now, and when it is next closest.
  const objects = await rightPanel(page, "Objects");
  await objects.getByRole("button", { name: /^Ordo/ }).click();
  const card = await rightPanel(page, "Selected");
  await expect(card.locator(".star-facts")).toContainText("From Tamar now");
  await expect(card.locator(".star-facts")).toContainText("Next closest");
  await discardMap(page);
});

test("the New map form offers a system model without an image", async ({ page }) => {
  await page.goto(at("/maps"));
  await openNewMap(page);
  await chooseKind(page, "System model");
  await expect(page.locator(".new-map .field:has(.chosen-image)")).toBeHidden();
  await page.locator(".new-map input[type=text]").fill("Anything");
  await expect(page.getByRole("button", { name: "Make the map" })).toBeEnabled();
});
