import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { Position } from "@frontier/geo";

/**
 * Find areas (stage 19): zones made from the map's own picture. The pictures are made by
 * fixtures/make-find-areas.mjs: on the flat one (600 × 400, a position is a pixel) West is the
 * left country, North-east and South-east the right ones, split at y = 200, and an island sits
 * at the foot; on the globe's plate two countries lie between 30° west and 30° east, one from
 * 20° south to 20° north and one from 20° to 50° north.
 */

const here = dirname(fileURLToPath(import.meta.url));
const WEST: Position = [180, 200];
const NORTH_EAST: Position = [420, 130];
const SOUTH_EAST: Position = [420, 270];
const ISLAND: Position = [130, 375];

type Feature = { id: string; kind: string; label: string | null; points?: Position[] };
type Stored = { space: { kind: string }; features: Feature[] };

/** Uploads a fixture picture and makes a map of it; returns the map's id. */
async function makeMap(page: Page, title: string, picture: string, kind: "flat" | "sphere") {
  if (!page.url().startsWith("http")) await page.goto("/maps");
  const bytes = readFileSync(join(here, "fixtures", picture)).toString("base64");
  return page.evaluate(
    async ({ title, picture, bytes, kind }) => {
      const data = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.append("file", new Blob([data], { type: "image/png" }), picture);
      const { path } = (await (
        await fetch("/api/images", { method: "POST", body: form })
      ).json()) as {
        path: string;
      };
      const made = await fetch("/api/maps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, kind, image: path }),
      });
      return ((await made.json()) as { id: string }).id;
    },
    { title, picture, bytes, kind },
  );
}

const cleanUp = (page: Page, maps: string[]) =>
  page.evaluate(async (maps) => {
    for (const id of maps) await fetch(`/api/maps/${id}`, { method: "DELETE" });
    const un = await (await fetch("/api/unpublished")).json();
    for (const d of un.drafts) await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
  }, maps);

const stored = (page: Page) =>
  page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    return ((await (await fetch(`/api/maps/${id}`)).json()) as { map: Stored }).map;
  });
const zones = async (page: Page) => (await stored(page)).features.filter((f) => f.kind === "zone");
const saved = (page: Page) => expect(page.locator(".save-saved")).toBeVisible();

const viewOf = (page: Page) =>
  decodeURIComponent(new URL(page.url()).searchParams.get("v") ?? "").split(",");

/** Where a position of the flat map is on the page, from the view in the address. */
async function onMap(page: Page, [x, y]: Position) {
  await page.waitForTimeout(150);
  const box = (await page.locator(".map-top").boundingBox())!;
  const [, vx, vy, k] = viewOf(page).map(Number);
  return { x: box.x + box.width / 2 + (x - vx!) * k!, y: box.y + box.height / 2 + (y - vy!) * k! };
}

async function open(page: Page, id: string) {
  await page.goto(`/map/${id}?edit=1`);
  await expect(page.locator(".map-top")).toBeVisible();
  await expect(page).toHaveURL(/v=/);
  await page.waitForTimeout(300);
}

/** Chooses Find areas and waits until the picture has been looked at. */
async function findAreas(page: Page, areas: number) {
  await page.getByRole("button", { name: "Find areas" }).click();
  const bar = page.getByRole("group", { name: "Find areas" });
  await expect(bar).toHaveAttribute("data-areas", String(areas));
  return bar;
}

const status = (page: Page) => page.getByRole("group", { name: "Find areas" }).getByRole("status");

test.describe.configure({ mode: "serial" });

test("chooses two areas, takes one back with Alt-click, and makes a zone of the rest", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Clicks and hover need a mouse");
  const id = await makeMap(page, "Found coast", "find-areas-flat.png", "flat");
  await open(page, id);
  // The sea, the three countries and the island.
  await findAreas(page, 5);
  await expect(status(page)).toHaveText("5 areas found · click one to start");

  // Pointing says what a click would do.
  const west = await onMap(page, WEST);
  await page.mouse.move(west.x, west.y);
  await expect(page.locator(".find-tag")).toHaveText("+ Add this area");
  await page.mouse.click(west.x, west.y);
  await expect(page.locator(".find-tag")).toHaveText("Already chosen · Alt-click removes it");
  const ne = await onMap(page, NORTH_EAST);
  await page.mouse.click(ne.x, ne.y);
  await expect(status(page)).toContainText("2 areas → 1 zone");
  // Alt-click takes one back; undo puts it back, and undo again takes it back again.
  await page.keyboard.down("Alt");
  await page.mouse.click(ne.x, ne.y);
  await page.keyboard.up("Alt");
  await expect(status(page)).toContainText("1 area → 1 zone");
  await page.keyboard.press("Control+z");
  await expect(status(page)).toContainText("2 areas → 1 zone");
  await page.keyboard.press("Control+z");
  await expect(status(page)).toContainText("1 area → 1 zone");

  const se = await onMap(page, SOUTH_EAST);
  await page.mouse.click(se.x, se.y);
  await expect(status(page)).toContainText("2 areas → 1 zone");
  await page.getByRole("button", { name: "Make zone" }).click();
  await saved(page);
  const [zone] = await zones(page);
  const xs = zone!.points!.map((p) => p[0]);
  const ys = zone!.points!.map((p) => p[1]);
  // West and South-east together, out to the middle of the painted lines round them.
  expect(Math.min(...xs)).toBeGreaterThan(55);
  expect(Math.min(...xs)).toBeLessThan(65);
  expect(Math.max(...xs)).toBeGreaterThan(535);
  expect(Math.min(...ys)).toBeLessThan(65);
  // The zone is selected and its tab is open; the tool stays on, with nothing chosen.
  await expect(page.locator(".feature-editor")).toBeVisible();
  await expect(page.getByRole("button", { name: "Find areas" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(status(page)).toHaveText("5 areas found · click one to start");
  // Undo takes the zone back.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await zones(page)).length).toBe(0);
  await cleanUp(page, [id]);
});

test("makes a zone beside another that shares its border points", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Clicks need a mouse");
  const id = await makeMap(page, "Shared borders found", "find-areas-flat.png", "flat");
  await open(page, id);
  await findAreas(page, 5);
  const se = await onMap(page, SOUTH_EAST);
  await page.mouse.click(se.x, se.y);
  await expect(page.getByRole("group", { name: "Find areas" })).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.keyboard.press("Enter");
  await saved(page);
  const ne = await onMap(page, NORTH_EAST);
  await page.mouse.click(ne.x, ne.y);
  await expect(page.getByRole("group", { name: "Find areas" })).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByRole("button", { name: "Make zone" }).click();
  await saved(page);
  const [first, second] = await zones(page);
  const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
  const shared = second!.points!.filter((p) => first!.points!.some((q) => same(p, q)));
  // Both ends of the border between them, exactly.
  expect(shared.length).toBeGreaterThanOrEqual(2);
  for (const [, y] of shared) expect(Math.abs(y - 200)).toBeLessThan(3);
  await cleanUp(page, [id]);
});

test("adds areas to the selected zone, and an island apart becomes a zone beside it", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Clicks need a mouse");
  const id = await makeMap(page, "Added realm", "find-areas-flat.png", "flat");
  await open(page, id);
  await findAreas(page, 5);
  const bar = page.getByRole("group", { name: "Find areas" });
  const west = await onMap(page, WEST);
  await page.mouse.click(west.x, west.y);
  await expect(bar).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Make zone" }).click();
  await saved(page);
  const [made] = await zones(page);
  await page.locator(".feature-editor").getByLabel("Label").fill("Vael");
  await saved(page);

  // North-east is beside it: the zone grows to take it in.
  const ne = await onMap(page, NORTH_EAST);
  await page.mouse.click(ne.x, ne.y);
  await expect(bar).toHaveAttribute("data-ready", "true");
  await bar.getByRole("button", { name: "Add to “Vael”" }).click();
  // The chosen areas are cleared once they are added.
  await expect(bar).toHaveAttribute("data-chosen", "0");
  const widest = async () => Math.max(...(await zones(page))[0]!.points!.map((p) => p[0]));
  await expect.poll(widest).toBeGreaterThan(535);
  let all = await zones(page);
  expect(all).toHaveLength(1);
  expect(all[0]!.id).toBe(made!.id);

  // The island is a piece apart: the zone keeps the largest piece, the island is a new zone.
  const island = await onMap(page, ISLAND);
  await page.mouse.click(island.x, island.y);
  await expect(bar).toHaveAttribute("data-ready", "true");
  await bar.getByRole("button", { name: "Add to “Vael”" }).click();
  await expect.poll(async () => (await zones(page)).length).toBe(2);
  all = await zones(page);
  expect(all.find((z) => z.id !== made!.id)?.label).toBe("Vael 2");
  await cleanUp(page, [id]);
});

test("finds areas on a globe and makes a zone in longitude and latitude", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Clicks need a mouse");
  const id = await makeMap(page, "Found globe", "find-areas-globe.png", "sphere");
  await open(page, id);
  // The sea and the two countries.
  await findAreas(page, 3);
  const box = (await page.locator(".map-top").boundingBox())!;
  const [, lon, lat, k] = viewOf(page).map(Number);
  expect([lon, lat]).toEqual([0, 0]);
  // On the ball facing 0°, 0°: latitude 35° is k·sin 35° above the middle.
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx, cy - k! * Math.sin((35 * Math.PI) / 180));
  await expect(status(page)).toContainText("2 areas → 1 zone");
  await page.getByRole("button", { name: "Make zone" }).click();
  await saved(page);
  const [zone] = await zones(page);
  for (const [lo, la] of zone!.points!) {
    expect(Math.abs(lo)).toBeLessThan(31.5);
    expect(la).toBeGreaterThan(-21.5);
    expect(la).toBeLessThan(51.5);
  }
  // The northern edge, a parallel on the plate, is kept as more than its two corners, so the
  // globe's great circles follow it.
  expect(zone!.points!.filter(([, la]) => la > 48).length).toBeGreaterThan(2);
  await cleanUp(page, [id]);
});

test("on a phone: taps choose areas, and Make zone opens the zone's tab", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "Touch only");
  const id = await makeMap(page, "Tapped coast", "find-areas-flat.png", "flat");
  await open(page, id);
  await findAreas(page, 5);
  await expect(status(page)).toHaveText("5 areas found · tap one to start");
  const west = await onMap(page, WEST);
  await page.touchscreen.tap(west.x, west.y);
  await expect(status(page)).toContainText("1 area → 1 zone");
  // Tapped again, it says how to take it away.
  await page.touchscreen.tap(west.x, west.y);
  await expect(page.locator(".map-said")).toHaveText(
    "Already chosen. Switch to Remove to take it away.",
  );
  const se = await onMap(page, SOUTH_EAST);
  await page.touchscreen.tap(se.x, se.y);
  await expect(status(page)).toContainText("2 areas → 1 zone");
  // The options open above the strip.
  await page.getByRole("button", { name: "Options" }).click();
  await expect(page.getByRole("button", { name: "Stop at lines" })).toBeVisible();
  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("button", { name: "Make zone" }).click();
  await expect(page.locator(".feature-editor")).toBeVisible();
  await saved(page);
  expect(await zones(page)).toHaveLength(1);
  await cleanUp(page, [id]);
});
