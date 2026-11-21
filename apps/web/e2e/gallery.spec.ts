import { expect, test } from "@playwright/test";
import { noSidewaysScroll } from "./helpers.ts";

test("the gallery shows images by folder, finds one by its entry and opens it large", async ({
  page,
}) => {
  await page.goto("/gallery");
  const tiles = page.locator(".gallery-tile");
  await expect(tiles.first()).toBeVisible();
  const used = await tiles.count();

  // Every image shown first is used by an entry, and says which.
  await expect(page.locator(".gallery-used a").first()).toBeVisible();
  expect(await page.locator(".gallery-used").count()).toBe(used);

  await page.getByRole("tab", { name: /^All/ }).click();
  expect(await tiles.count()).toBeGreaterThanOrEqual(used);
  await noSidewaysScroll(page);

  await page.getByRole("tab", { name: /^In entries/ }).click();
  const entry = (await page.locator(".gallery-used a").first().textContent())!;
  await page.getByLabel("Find an image by its name or its entry").fill(entry);
  await expect(tiles.first()).toContainText(entry);

  await tiles.first().getByRole("button").click();
  await expect(page.locator(".lightbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".lightbox")).toHaveCount(0);

  await page.locator(".gallery-used a").first().click();
  await expect(page).toHaveURL(/\/e\//);
});
