import { expect, type Page, test } from "@playwright/test";
import { bar, cleanUp, findPaths, makeMap, open, upload } from "./pathsHelpers.ts";

/**
 * Terrain (stage 20): the dialog for a map's height map. The fixtures are the Find paths ones: a
 * picture, the height map that matches it, and the same height map moved 40 pixels east and 24
 * south, which does not line up.
 */

type Terrain = {
  image: string;
  extent?: number[];
  seaLevel?: number;
  smoothing?: number;
  invert?: boolean;
};
const terrainOf = (page: Page) =>
  page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    const loaded = (await (await fetch(`/api/maps/${id}`)).json()) as {
      map: { terrain?: Terrain };
    };
    return loaded.map.terrain ?? null;
  });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Terrain" });
const match = async (page: Page) =>
  Number(
    /(\d+)%/.exec(
      (await dialog(page).getByRole("status", { name: "Coast match" }).textContent())!,
    )![1],
  );

test.describe.configure({ mode: "serial" });

test("chooses a height map from Find paths' amber line, lines it up, sets the sea, and undoes", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "The desktop dialog");
  const id = await makeMap(page, "Terrain chosen");
  await upload(page, "find-paths-heights-shifted.png");
  await open(page, id);
  await findPaths(page, "Route");
  // The amber line is the way in.
  await bar(page).getByRole("button", { name: "Guessing terrain from the picture" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText("No height map yet")).toBeVisible();
  await expect(dialog(page).getByText("What Find paths guesses now")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Choose a height map…" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a height map" });
  await picker
    .getByRole("button", { name: /^Choose find-paths-heights-shifted/ })
    .first()
    .click();
  await picker.getByRole("button", { name: "Choose", exact: true }).click();

  // It does not line up: the match says so, and so does the check.
  await expect(dialog(page).getByRole("status", { name: "Coast match" })).toBeVisible();
  const before = await match(page);
  expect(before).toBeLessThan(85);
  await expect(
    dialog(page)
      .getByText(/(Doesn't line up with|Nearly on) the coast/)
      .first(),
  ).toBeVisible();
  // Line up for me slides it into place.
  await dialog(page).getByRole("button", { name: "Line up for me" }).first().click();
  await expect(dialog(page).getByText(/Lined up: coast \d+% → \d+%/)).toBeVisible();
  const after = await match(page);
  expect(after).toBeGreaterThan(before);
  expect(after).toBeGreaterThanOrEqual(85);
  await expect(
    dialog(page)
      .getByText(/Lines up with the coast/)
      .first(),
  ).toBeVisible();

  // The sea level floods the land as it rises, and Match brings it back.
  const floods = dialog(page).getByRole("status", { name: "What the sea level does" });
  const low = (await floods.textContent())!;
  await dialog(page).getByRole("slider", { name: "Sea level" }).fill("0.6");
  await expect(floods).not.toHaveText(low);
  expect(await match(page)).toBeLessThan(after);
  await dialog(page).getByRole("button", { name: "Match the picture's coast" }).first().click();
  await expect(floods).toHaveText(low);

  await dialog(page).getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Terrain set: Find paths now uses the height map.")).toBeVisible();
  await expect.poll(() => terrainOf(page)).not.toBeNull();
  const terrain = (await terrainOf(page))!;
  expect(terrain.image).toContain("find-paths-heights-shifted");
  // Moved back west and north by about what it was off.
  expect(terrain.extent![0]!).toBeLessThan(-30);
  expect(terrain.extent![1]!).toBeLessThan(-16);
  // Find paths now reads it.
  await expect(bar(page)).toHaveAttribute("data-guessed", "false");
  // Undo takes it off again.
  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect.poll(() => terrainOf(page)).toBeNull();
  await expect(bar(page)).toHaveAttribute("data-guessed", "true");
  await cleanUp(page, [id]);
});

test("adjusts terrain from the map's menu, shows relief, and removes it with Undo", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "The desktop dialog");
  const id = await makeMap(page, "Terrain removed", { heights: true });
  await open(page, id);
  // The chip on the map turns relief on.
  const chip = page.getByRole("group", { name: "Terrain" });
  await chip.getByRole("button", { name: "Relief" }).click();
  await expect(page.locator(".map-relief[data-drawn]")).toBeVisible();
  await page.keyboard.press("h");
  await expect(page.locator(".map-relief")).toHaveCount(0);

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Terrain…" }).click();
  await expect(dialog(page)).toBeVisible();
  expect(await match(page)).toBeGreaterThanOrEqual(85);
  // Moving it by hand with the keys spoils the match; 0 puts it back.
  const preview = dialog(page).getByRole("img");
  await preview.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await expect(dialog(page).getByText(/Moved 50 km east/)).toBeVisible();
  const off = await match(page);
  await page.keyboard.press("0");
  await expect(dialog(page).getByText("It lies over the whole map.")).toBeVisible();
  expect(await match(page)).toBeGreaterThan(off);

  await dialog(page).getByRole("button", { name: "Remove terrain" }).click();
  await expect(page.getByText("Terrain removed. The image stays in the library.")).toBeVisible();
  await expect.poll(() => terrainOf(page)).toBeNull();
  await expect(chip).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect
    .poll(async () => (await terrainOf(page))?.image ?? "")
    .toContain("find-paths-heights");
  await cleanUp(page, [id]);
});

test("on a phone: the steps one at a time, and Done", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "The phone sheet");
  const id = await makeMap(page, "Terrain by steps", { heights: true });
  await open(page, id);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Terrain…" }).click();
  await expect(dialog(page)).toBeVisible();
  const steps = dialog(page).getByRole("tablist", { name: "Steps" });
  await expect(steps.getByRole("tab")).toHaveText(["Image", "Line up", "Sea", "Heights", "Check"]);
  // Only the open step's controls show.
  await expect(dialog(page).getByRole("button", { name: "White is high" })).toBeVisible();
  await expect(dialog(page).getByRole("slider", { name: "Sea level" })).toHaveCount(0);
  await dialog(page).getByRole("button", { name: "Next" }).click();
  await expect(dialog(page).getByRole("button", { name: "Line up for me" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Next" }).click();
  await expect(dialog(page).getByRole("slider", { name: "Sea level" })).toBeVisible();
  await steps.getByRole("tab", { name: "Check" }).click();
  await expect(
    dialog(page)
      .getByText(/Lines up with the coast/)
      .first(),
  ).toBeVisible();
  await steps.getByRole("tab", { name: "Heights" }).click();
  await dialog(page).getByRole("combobox", { name: "Smoothing" }).selectOption("Light");
  await dialog(page).getByRole("button", { name: "Done" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(async () => (await terrainOf(page))?.smoothing).toBe(1);
  await cleanUp(page, [id]);
});
