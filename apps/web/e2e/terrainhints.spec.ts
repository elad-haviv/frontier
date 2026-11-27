import { expect, type Page, test } from "@playwright/test";
import { bar, cleanUp, findPaths, open, upload } from "./pathsHelpers.ts";
import { at } from "./helpers.ts";

/**
 * Height map from hints (stage 21): find hints in the fixture picture (an island with a river
 * and its tributary, a lake, a chain of mountain symbols, a marsh and a road; see
 * fixtures/make-infer-heights.mjs), review them, draw one, build, use, and Find paths reads it.
 */

type Stored = {
  terrain?: { image: string; seaLevel?: number; generated?: { hints: string; seed: number } };
  terrainHints?: { id: string; kind: string; state: string; by: string; points?: number[][] }[];
};
const stored = (page: Page) =>
  page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    return ((await (await fetch(`/api/maps/${id}`)).json()) as { map: Stored }).map;
  });

/** A flat map of the fixture picture, one kilometre a pixel. */
async function makeMap(page: Page, title: string): Promise<string> {
  if (!page.url().startsWith("http")) await page.goto(at("/maps"));
  const image = await upload(page, "infer-heights.png");
  return page.evaluate(
    async ({ title, image }) => {
      const json = { "content-type": "application/json" };
      const made = await fetch("/api/maps", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ title, kind: "flat", image }),
      });
      const { id } = (await made.json()) as { id: string };
      const loaded = await (await fetch(`/api/maps/${id}`)).json();
      const map = loaded.map;
      map.space = { ...map.space, scale: 1, unit: "km" };
      const saved = await fetch(`/api/maps/${id}`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ map, revision: loaded.revision, baseBlob: loaded.blob }),
      });
      if (!saved.ok) throw new Error(await saved.text());
      return id;
    },
    { title, image },
  );
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "Terrain" });
const editor = (page: Page) => dialog(page).getByRole("application");
/** Where a position of the picture (600 × 400, a position is a pixel) is on the hint editor. */
async function onEditor(page: Page, [x, y]: [number, number]) {
  const box = (await editor(page).boundingBox())!;
  const k = Math.min(box.width / 600, box.height / 400);
  return { x: box.x + box.width / 2 + (x - 300) * k, y: box.y + box.height / 2 + (y - 200) * k };
}
const badges = (page: Page) =>
  dialog(page).getByRole("status", { name: "How the build turned out" });

test.describe.configure({ mode: "serial" });

test("finds hints, rejects one, draws a ridge, builds, uses it, and Find paths reads it", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "The desktop workspace");
  const id = await makeMap(page, "Hints island");
  await open(page, id);
  await findPaths(page, "River");
  await expect(bar(page)).toHaveAttribute("data-guessed", "true");
  await bar(page).getByRole("button", { name: "Guessing terrain from the picture" }).click();
  await expect(dialog(page).getByText("Build one from the picture")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Find hints" }).click();

  // What the picture says: the sea, a lake, two rivers, the mountains and the marsh; the road waits.
  const kinds = dialog(page).getByRole("list").first();
  await expect(kinds.getByRole("button", { name: /^Rivers 2 of 2 used/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(kinds.getByRole("button", { name: /^Lakes 1 of 1 used/ })).toBeVisible();
  await expect(kinds.getByRole("button", { name: /^Peaks/ })).toBeVisible();
  await expect(kinds.getByRole("button", { name: /^Marsh 1 of 1 used/ })).toBeVisible();
  await expect(kinds.getByRole("button", { name: /^Roads 0 of 1 used · 1 waiting/ })).toBeVisible();

  // Next suggestion goes to a waiting one; reject the road.
  await dialog(page)
    .getByRole("button", { name: /^Roads/ })
    .click();
  await dialog(page).getByRole("button", { name: "Reject Road · gentle ground" }).click();
  await expect(kinds.getByRole("button", { name: /^Roads 0 of 1 used$/ })).toBeVisible();

  // Draw a ridge in the south-east: click, click, and Enter.
  await dialog(page).getByRole("button", { name: "Ridge", exact: true }).click();
  for (const at of [
    [330, 300],
    [380, 330],
    [450, 340],
  ] as [number, number][]) {
    const p = await onEditor(page, at);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press("Enter");
  await expect(dialog(page).getByRole("region", { name: "The selected hint" })).toContainText(
    "Drawn by you",
  );
  // Undo takes it away and Redo puts it back.
  await dialog(page).getByRole("button", { name: "Undo" }).click();
  await expect(kinds.getByRole("button", { name: /^Ridges 1 of 1 used/ })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Redo" }).click();
  await expect(kinds.getByRole("button", { name: /^Ridges 2 of 2 used/ })).toBeVisible();

  // Dragging a waiting suggestion (the highland round the mountain symbols) accepts it.
  await expect(
    kinds.getByRole("button", { name: /^Highlands 0 of 1 used · 1 waiting/ }),
  ).toBeVisible();
  await dialog(page).getByRole("button", { name: "Select", exact: true }).click();
  const from = await onEditor(page, [470, 152]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 15, from.y + 10, { steps: 4 });
  await page.mouse.move(from.x - 30, from.y + 20, { steps: 4 });
  await page.mouse.up();
  await expect(kinds.getByRole("button", { name: /^Highlands 1 of 1 used$/ })).toBeVisible();

  // Build: the rivers drain and the coast stays where it is painted.
  await dialog(page).getByRole("tab", { name: "Build" }).click();
  await dialog(page).getByRole("button", { name: "Build height map" }).click();
  await expect(badges(page)).toContainText("Rivers drain 2/2", { timeout: 20_000 });
  await expect(badges(page)).toContainText(/Coast (9\d|100)%/);
  await expect(dialog(page).getByText("Rivers drain correctly: 2/2")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Relief" }).click();
  await dialog(page).getByLabel("Highest point").fill("2400");

  await dialog(page).getByRole("button", { name: "Use this height map" }).click();
  await expect(page.getByText(/Height map built from \d+ hints/)).toBeVisible({ timeout: 20_000 });
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).terrain?.generated?.seed).toBe(1);
  const map = await stored(page);
  expect(map.terrain!.image).toContain("heights-generated");
  expect(map.terrain!.seaLevel!).toBeGreaterThan(0);
  const hints = map.terrainHints!;
  expect(hints.find((h) => h.kind === "road")?.state).toBe("rejected");
  expect(hints.find((h) => h.kind === "ridge" && h.by === "you")?.points?.length).toBe(3);
  expect(hints.some((h) => h.kind === "sea" && h.state === "accepted")).toBe(true);

  // Find paths now uses it: no longer guessing.
  await expect(bar(page)).toHaveAttribute("data-guessed", "false", { timeout: 20_000 });
  await expect(
    bar(page).getByRole("button", { name: "Terrain from hints (generated)" }),
  ).toBeVisible();

  // Reopened, the workspace is as it was, on the Build tab, built again.
  await bar(page).getByRole("button", { name: "Terrain from hints (generated)" }).click();
  await expect(dialog(page).getByRole("tab", { name: "Build" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(badges(page)).toContainText("Rivers drain 2/2", { timeout: 20_000 });
  await expect(dialog(page).getByLabel("Highest point")).toHaveValue("2400");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await cleanUp(page, [id]);
});

test("on a phone: find hints, place a peak, build and use", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "The phone sheet");
  const id = await makeMap(page, "Hints by phone");
  await open(page, id);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Terrain…" }).click();
  await dialog(page).getByRole("button", { name: "Find hints" }).click();
  await expect(dialog(page).getByRole("button", { name: /^Rivers 2 of 2 used/ })).toBeVisible({
    timeout: 20_000,
  });

  // The tools are a column of icons; a tap places a peak.
  await dialog(page).getByRole("button", { name: "Peak", exact: true }).click();
  const p = await onEditor(page, [300, 300]);
  await page.touchscreen.tap(p.x, p.y);
  await expect(dialog(page).getByRole("region", { name: "The selected hint" })).toContainText(
    "Drawn by you",
  );
  await dialog(page).getByRole("button", { name: "Build height map" }).click();
  await expect(dialog(page).getByRole("tab", { name: "Build" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(badges(page)).toContainText("Rivers drain 2/2", { timeout: 20_000 });
  await dialog(page).getByRole("button", { name: "Use this height map" }).click();
  await expect(page.getByText(/Height map built from \d+ hints/)).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await stored(page)).terrain?.generated?.seed).toBe(1);
  const hints = (await stored(page)).terrainHints!;
  expect(hints.some((h) => h.kind === "peak" && h.by === "you")).toBe(true);
  await cleanUp(page, [id]);
});
