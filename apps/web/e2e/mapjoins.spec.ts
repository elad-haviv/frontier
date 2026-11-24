import { expect, type Page, test } from "@playwright/test";
import {
  type Position,
  RIVER_STYLE,
  ROAD_STYLE,
  bar,
  cleanUp,
  click,
  findPaths,
  makeMap,
  onMap,
  open,
  paths,
  ready,
  status,
} from "./pathsHelpers.ts";

/**
 * Joins (stage 20): a path that ends on another path stays attached to it. The other path gets a
 * corner at the meeting point with the same coordinates, and the join is remembered on the path.
 */

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
const MAIN = {
  id: "mainroad",
  kind: "path",
  label: "King's Road",
  style: "strroad1",
  points: [
    [150, 320],
    [400, 320],
  ],
};

async function drag(page: Page, from: Position, to: Position) {
  const a = await onMap(page, from);
  const b = await onMap(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }, info) => {
  void page;
  test.skip(info.project.name !== "desktop", "Drawn and dragged with a mouse");
});
test.describe.configure({ mode: "serial" });

test("a tributary made by Find paths stays on the river when the river's corner is dragged", async ({
  page,
}) => {
  const id = await makeMap(page, "Joined rivers", { heights: true, styles: [RIVER_STYLE] });
  await open(page, id);
  await findPaths(page, "River");
  await click(page, [400, 205]);
  await ready(page);
  await bar(page).getByRole("button", { name: "Make path" }).click();
  await expect.poll(async () => (await paths(page)).length).toBe(1);
  await click(page, [300, 300]);
  await expect(status(page)).toContainText("joins");
  await ready(page);
  await bar(page).getByRole("button", { name: "Make path" }).click();
  await expect.poll(async () => (await paths(page)).length).toBe(2);
  let [river, tributary] = await paths(page);
  // The join is remembered, and the river has a corner exactly where the tributary ends.
  expect(tributary!.endOn).toBe(river!.id);
  const end = tributary!.points![tributary!.points!.length - 1]!;
  const corner = river!.points!.findIndex((p) => same(p, end));
  expect(corner).toBeGreaterThan(0);

  // Select the river and drag that shared corner: the tributary's end goes with it.
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const before = river!.points![corner - 1]!;
  await click(page, [(before[0] + end[0]) / 2, (before[1] + end[1]) / 2]);
  await expect(page.locator(".feature-editor")).toBeVisible();
  await drag(page, end, [end[0] + 6, end[1] + 30]);
  await expect
    .poll(async () => {
      const [r] = await paths(page);
      return Math.abs(r!.points![corner]![1] - end[1]) > 20;
    })
    .toBe(true);
  [river, tributary] = await paths(page);
  const moved = river!.points![corner]!;
  expect(same(tributary!.points![tributary!.points!.length - 1]!, moved)).toBe(true);
  expect(tributary!.endOn).toBe(river!.id);
  await cleanUp(page, [id]);
});

test("a side road drawn by hand onto a road adds a corner to it, and not with Paths snapping off", async ({
  page,
}) => {
  const id = await makeMap(page, "Side roads", { features: [MAIN], styles: [ROAD_STYLE] });
  await open(page, id);
  // With the Path tool and snapping on: the last point snaps onto the road, mid-segment.
  await page.getByRole("button", { name: "Path", exact: true }).click();
  await click(page, [250, 250]);
  await click(page, [275, 321]);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await paths(page)).length).toBe(2);
  let all = await paths(page);
  let main = all.find((f) => f.id === "mainroad")!;
  const side = all.find((f) => f.id !== "mainroad")!;
  expect(side.endOn).toBe("mainroad");
  expect(main.points).toHaveLength(3);
  // The same coordinates in both, on the road.
  expect(same(main.points![1]!, side.points![1]!)).toBe(true);
  expect(main.points![1]![1]).toBeCloseTo(320, 1);

  // The magnet's menu turns snapping to paths off: the next one is not joined.
  await page.getByRole("button", { name: "Snap to" }).click();
  await page.getByRole("menuitem", { name: /Paths/ }).click();
  await page.getByRole("button", { name: "Path", exact: true }).click();
  await click(page, [350, 250]);
  await click(page, [350, 321]);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await paths(page)).length).toBe(3);
  all = await paths(page);
  main = all.find((f) => f.id === "mainroad")!;
  const loose = all[2]!;
  expect(loose.endOn).toBeUndefined();
  expect(main.points).toHaveLength(3);
  // Back on, for the tests after this one.
  await page.getByRole("button", { name: "Snap to" }).click();
  await page.getByRole("menuitem", { name: /Paths/ }).click();
  await cleanUp(page, [id]);
});

test("a road found across a road gets a crossroads corner in both", async ({ page }) => {
  const id = await makeMap(page, "Crossroads", { features: [MAIN], styles: [ROAD_STYLE] });
  await open(page, id);
  await findPaths(page, "Route");
  await click(page, [300, 290]);
  await click(page, [300, 350]);
  await ready(page);
  await bar(page).getByRole("button", { name: "Make path" }).click();
  await expect.poll(async () => (await paths(page)).length).toBe(2);
  const all = await paths(page);
  const main = all.find((f) => f.id === "mainroad")!;
  const across = all.find((f) => f.id !== "mainroad")!;
  expect(across.style).toBe("strroad1");
  // Neither is split: each has one more corner, the same one.
  expect(main.points).toHaveLength(3);
  expect(across.points!.some((p) => same(p, main.points![1]!))).toBe(true);
  expect(across.startOn).toBeUndefined();
  await cleanUp(page, [id]);
});

test("a route from the end of a road continues it, or is made a separate path joined to it", async ({
  page,
}) => {
  const id = await makeMap(page, "Continued", { features: [MAIN], styles: [ROAD_STYLE] });
  await open(page, id);
  await findPaths(page, "Route");
  // The start snaps to the road's end.
  await click(page, [401, 321]);
  await click(page, [400, 250]);
  await ready(page);
  const make = bar(page).getByRole("button", { name: "Continue “King's Road”" });
  await expect(make).toBeVisible();
  await make.click();
  await expect
    .poll(async () => (await paths(page)).find((f) => f.id === "mainroad")!.points!.length)
    .toBeGreaterThan(2);
  let all = await paths(page);
  expect(all).toHaveLength(1);
  const last = all[0]!.points![all[0]!.points!.length - 1]!;
  expect(Math.abs(last[1] - 250)).toBeLessThan(1);

  // From its other end, as a path of its own: joined where they meet.
  await click(page, [149, 321]);
  await click(page, [150, 250]);
  await ready(page);
  await bar(page).getByRole("button", { name: "Make separate path" }).click();
  await bar(page).getByRole("button", { name: "Make path" }).click();
  await expect.poll(async () => (await paths(page)).length).toBe(2);
  all = await paths(page);
  const other = all.find((f) => f.id !== "mainroad")!;
  expect(other.startOn).toBe("mainroad");
  expect(same(other.points![0]!, [150, 320])).toBe(true);
  await cleanUp(page, [id]);
});
