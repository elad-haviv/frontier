import { expect, test } from "@playwright/test";
import {
  type Feature,
  RIVER_STYLE,
  ROAD_STYLE,
  bar,
  cleanUp,
  click,
  distanceTo,
  findPaths,
  makeMap,
  near,
  onMap,
  open,
  paths,
  ready,
  saved,
  status,
  stored,
  upload,
} from "./pathsHelpers.ts";

/**
 * Find paths (stage 20): rivers, routes and traced lines from the map's picture and its heights.
 * The pictures are made by fixtures/make-find-paths.mjs (600 × 400, a position is a pixel): a
 * mainland from x = 100 to 430 and an island from x = 490, a painted river along y ≈ 200 to the
 * west coast with a tributary from the north, a dashed road down x = 260 that bridges the river,
 * and a height map that matches: a valley along the river, rising east.
 */

test.describe.configure({ mode: "serial" });

test("traces a painted river and its branch, and groups the two paths", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Clicks and hover need a mouse");
  const id = await makeMap(page, "Traced river");
  await open(page, id);
  await findPaths(page, "Trace");
  await expect(status(page)).toHaveText("Click a river, road or coast painted in the picture");
  // Pointing at the line says what a click would follow.
  const on = await onMap(page, [240, 205]);
  await page.mouse.move(on.x, on.y);
  await expect(page.locator(".find-tag")).toHaveText("Click to follow this river");
  await page.mouse.click(on.x, on.y);
  await ready(page);
  await expect(status(page)).toContainText("Painted river");
  await expect(status(page)).toContainText("1 branch in grey: click to add");
  // Bare land is no line; undo brings the river back.
  await click(page, [150, 100]);
  await expect(status(page)).toContainText("No painted line here");
  await page.keyboard.press("Control+z");
  await ready(page);
  // The tributary is offered as a ghost: a click adds it.
  await click(page, [326, 150]);
  await expect(bar(page)).toHaveAttribute("data-paths", "2");
  await ready(page);
  await bar(page).getByRole("button", { name: "Make 2 paths" }).click();
  await saved(page);
  const made = await paths(page);
  expect(made).toHaveLength(2);
  const [main, branch] = made as [Feature, Feature];
  // The river from its source in the east down to the west coast, along the painted line.
  const xs = main.points!.map((p) => p[0]);
  expect(Math.max(...xs)).toBeGreaterThan(405);
  expect(Math.min(...xs)).toBeLessThan(108);
  expect(main.points![0]![0]).toBeGreaterThan(main.points![main.points!.length - 1]![0]);
  for (const p of main.points!) expect(Math.abs(p[1] - 200)).toBeLessThan(14);
  // The branch ends exactly on it.
  expect(distanceTo(branch.points![branch.points!.length - 1]!, main.points!)).toBeLessThan(0.01);
  expect(Math.min(...branch.points!.map((p) => p[1]))).toBeLessThan(130);
  // Both are selected together, and the bar offers to group what was made.
  await expect(page.getByRole("tab", { name: "2 selected" })).toBeVisible();
  await bar(page).getByRole("button", { name: "Group 2 paths" }).click();
  await saved(page);
  const after = await stored(page);
  expect(after.groups).toHaveLength(1);
  expect(after.features.every((f) => f.group === after.groups![0]!.id)).toBe(true);
  await cleanUp(page, [id]);
});

test("finds a route on foot and by cart that differ, guessing the terrain", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Clicks need a mouse");
  const id = await makeMap(page, "Two ways");
  await open(page, id);
  await findPaths(page, "Route");
  // No height map: the tool says it is guessing.
  await expect(bar(page)).toHaveAttribute("data-guessed", "true");
  await expect(bar(page).getByText("Guessing terrain from the picture")).toBeVisible();
  await click(page, [160, 120]);
  await expect(status(page)).toContainText("now click where the route ends");
  await click(page, [160, 300]);
  await ready(page);
  // On foot the painted river is forded, straight across.
  await expect(status(page)).toContainText("on foot");
  await expect(status(page)).toContainText("1 ford");
  await expect(status(page)).toContainText(/about \d+½? days?/);
  const onFoot = (await status(page).textContent())!;
  // A cart all but cannot ford: it goes round by the painted road and its bridge.
  await bar(page).getByRole("button", { name: "Cart" }).click();
  await expect(status(page)).toContainText("by cart");
  await expect(status(page)).toContainText("1 bridge");
  await ready(page);
  expect(await status(page).textContent()).not.toBe(onFoot);
  await bar(page).getByRole("button", { name: "Make path" }).click();
  await expect.poll(async () => (await paths(page)).length).toBe(1);
  const [route] = await paths(page);
  near(route!.points![0], [160, 120]);
  near(route!.points![route!.points!.length - 1], [160, 300]);
  // By way of the road at x = 260.
  expect(Math.max(...route!.points!.map((p) => p[0]))).toBeGreaterThan(250);
  await expect(page.locator(".feature-editor")).toBeVisible();
  // Undo takes back the path.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await paths(page)).length).toBe(0);
  await cleanUp(page, [id]);
});

test("says there is no way by land to an island, and offers a ship", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Clicks need a mouse");
  const id = await makeMap(page, "To the island");
  await open(page, id);
  await findPaths(page, "Route");
  await click(page, [200, 300]);
  await click(page, [535, 200]);
  await expect(status(page)).toContainText("No way on foot");
  await expect(bar(page)).not.toHaveAttribute("data-ready", "true");
  await bar(page)
    .getByRole("button", { name: /Go by ship/ })
    .click();
  await ready(page);
  await expect(status(page)).toContainText("by ship");
  await expect(status(page)).toContainText("part by sea");
  await bar(page).getByRole("button", { name: "Make path" }).click();
  await expect.poll(async () => (await paths(page)).length).toBe(1);
  const [route] = await paths(page);
  near(route!.points![route!.points!.length - 1], [535, 200]);
  await cleanUp(page, [id]);
});

test("runs a river down the height map to the sea, and ends a tributary exactly on it", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Clicks need a mouse");
  const id = await makeMap(page, "Rivers by height", { heights: true, styles: [RIVER_STYLE] });
  await open(page, id);
  await findPaths(page, "River");
  // The terrain comes from the height map.
  await expect(bar(page)).toHaveAttribute("data-guessed", "false");
  await expect(bar(page).getByText("Terrain from “find-paths-heights”")).toBeVisible();
  await click(page, [400, 205]);
  await ready(page);
  await expect(status(page)).toContainText("River ·");
  await expect(status(page)).toContainText("reaches the sea");
  await expect(status(page)).toContainText("km");
  // Enter makes it, the map having the focus.
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await paths(page)).length).toBe(1);
  const [main] = await paths(page);
  // From the click down the valley to the west coast, in the River style.
  near(main!.points![0], [400, 205]);
  const mouth = main!.points![main!.points!.length - 1]!;
  expect(mouth[0]).toBeLessThan(112);
  expect(Math.abs(mouth[1] - 200)).toBeLessThan(15);
  expect(main!.style).toBe("strriver");

  // A second river from the south slope reaches the first and ends exactly on it.
  await click(page, [300, 300]);
  await expect(status(page)).toContainText("joins");
  await ready(page);
  await bar(page).getByRole("button", { name: "Make path" }).click();
  await expect.poll(async () => (await paths(page)).length).toBe(2);
  const tributary = (await paths(page))[1]!;
  near(tributary.points![0], [300, 300]);
  expect(distanceTo(tributary.points![tributary.points!.length - 1]!, main!.points!)).toBeLessThan(
    0.01,
  );
  await cleanUp(page, [id]);
});

test("takes a road the owner made, by what its style counts as", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Clicks need a mouse");
  const road = {
    id: "madeRoad",
    kind: "path",
    style: "strroad1",
    points: [
      [120, 345],
      [400, 345],
    ],
  };
  const id = await makeMap(page, "By the made road", { features: [road], styles: [ROAD_STYLE] });
  await open(page, id);
  await findPaths(page, "Route");
  await click(page, [125, 312]);
  await click(page, [395, 312]);
  await ready(page);
  await bar(page).getByRole("button", { name: "Make path" }).click();
  await expect.poll(async () => (await paths(page)).length).toBe(2);
  const route = (await paths(page)).find((f) => f.id !== "madeRoad")!;
  // It leaves the straight line for the road 33 km to the south, and runs along it.
  const onRoad = route.points!.filter((p) => Math.abs(p[1] - 345) < 4);
  expect(onRoad.length).toBeGreaterThanOrEqual(2);
  expect(
    Math.max(...onRoad.map((p) => p[0])) - Math.min(...onRoad.map((p) => p[0])),
  ).toBeGreaterThan(150);
  await cleanUp(page, [id]);
});

test("on a globe the tool is off, with the reason", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "The reason is in a tooltip");
  await page.goto("/maps");
  const image = await upload(page, "find-areas-globe.png");
  const id = await page.evaluate(async (image) => {
    const made = await fetch("/api/maps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A globe without paths", kind: "sphere", image }),
    });
    return ((await made.json()) as { id: string }).id;
  }, image);
  await open(page, id);
  const tool = page.getByRole("button", { name: "Find paths" });
  await expect(tool).toHaveAttribute("aria-disabled", "true");
  await tool.hover();
  await expect(page.getByText("Find paths works on flat maps for now")).toBeVisible();
  await cleanUp(page, [id]);
});

test("on a phone: taps make a route, Options opens, and Make path opens the path's tab", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "Touch only");
  const id = await makeMap(page, "Tapped route");
  await open(page, id);
  await page.getByRole("button", { name: "Find paths" }).click();
  await bar(page).getByRole("button", { name: "Route", exact: true }).click();
  await expect(bar(page)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(status(page)).toContainText("Tap the start, then the end");
  // The amber warning is an icon in the strip.
  await expect(
    bar(page).getByRole("button", { name: "Guessing terrain from the picture" }),
  ).toBeVisible();
  const start = await onMap(page, [160, 120]);
  await page.touchscreen.tap(start.x, start.y);
  await expect(status(page)).toHaveText("Now tap the end");
  const end = await onMap(page, [300, 130]);
  await page.touchscreen.tap(end.x, end.y);
  await ready(page);
  await expect(status(page)).toContainText("km");
  // The options open above the strip, the kind's own first.
  await page.getByRole("button", { name: "Options" }).click();
  await expect(bar(page).getByRole("button", { name: "On foot" })).toBeVisible();
  await bar(page).getByRole("button", { name: "Horse" }).click();
  await page.getByRole("button", { name: "Options" }).click();
  await ready(page);
  await bar(page).getByRole("button", { name: "Make path" }).click();
  await expect(page.locator(".feature-editor")).toBeVisible();
  await saved(page);
  expect(await paths(page)).toHaveLength(1);
  await cleanUp(page, [id]);
});
