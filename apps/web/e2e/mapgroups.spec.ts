import { expect, type Page, test } from "@playwright/test";
import { rightPanel } from "./helpers.ts";

/**
 * Feature groups (stage 19): three islands picked and grouped as one realm, named, selected as one
 * and gone inside, moved together, ungrouped and grouped back with Undo; on a phone with Select
 * several and a second tap; and the group's card while viewing.
 */

const IMAGE = "99 Appendices/Images/map one.png";

type Point = { x: number; y: number };
type Feature = { id: string; kind: string; group?: string; points?: [number, number][] };
type Stored = { features: Feature[]; groups?: { id: string; label: string | null }[] };

const makeMap = (page: Page, title: string) =>
  page.evaluate(
    async ({ title, image }) => {
      const res = await fetch("/api/maps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, kind: "flat", image }),
      });
      return ((await res.json()) as { id: string }).id;
    },
    { title, image: IMAGE },
  );

const stored = (page: Page) =>
  page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    return ((await (await fetch(`/api/maps/${id}`)).json()) as { map: Stored }).map;
  });
const zones = async (page: Page) => (await stored(page)).features.filter((f) => f.kind === "zone");

const cleanUp = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    await fetch(`/api/maps/${id}`, { method: "DELETE" });
    const un = await (await fetch("/api/unpublished")).json();
    for (const d of un.drafts) await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
  }, id);

async function openMap(page: Page, title: string) {
  await page.goto("/maps");
  const id = await makeMap(page, title);
  await page.goto(`/map/${id}?edit=1`);
  await expect(page.locator(".map-top")).toBeVisible();
  await expect(page).toHaveURL(/v=/);
  await page.waitForTimeout(300);
  // Snapping off: each island keeps the corners it is drawn with.
  await page.getByRole("button", { name: "Snapping", exact: true }).click();
  return id;
}

/**
 * A place on the map, as an offset from the middle of its canvas. When the side bar comes or goes
 * the canvas changes size but the map stays in its middle, so the offset keeps finding the place.
 */
async function on(page: Page, off: Point): Promise<Point> {
  await page.waitForTimeout(150);
  const box = (await page.locator(".map-top").boundingBox())!;
  return { x: box.x + box.width / 2 + off.x, y: box.y + box.height / 2 + off.y };
}

/** The three islands: across the upper part of the map, clear of a phone's sheet. */
const ISLANDS: Point[] = [-95, 0, 95].map((x) => ({ x, y: -120 }));

async function drawZone(page: Page, at: Point, count: number) {
  await page.getByRole("button", { name: "Zone", exact: true }).click();
  const c = await on(page, at);
  const corners = [
    { x: c.x - 30, y: c.y - 25 },
    { x: c.x + 30, y: c.y - 25 },
    { x: c.x, y: c.y + 40 },
  ];
  for (const p of corners) await page.mouse.click(p.x, p.y);
  await page.mouse.click(corners[2]!.x, corners[2]!.y);
  await expect.poll(async () => (await zones(page)).length).toBe(count);
  // Let go of it, so its tab closes before the next is drawn.
  await page.locator(".map-frame").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: /^Edit feature/ })).toHaveCount(0);
}

async function threeIslands(page: Page) {
  for (const [i, p] of ISLANDS.entries()) await drawZone(page, p, i + 1);
}

const click = async (page: Page, off: Point) => {
  const p = await on(page, off);
  await page.mouse.click(p.x, p.y);
};

test("groups three islands, names the realm, goes inside and back out, moves and ungroups it", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Shift-click and Ctrl+G are the desktop's way");
  const id = await openMap(page, `Aldmere ${info.project.name}`);
  await threeIslands(page);
  const [a, b, c] = ISLANDS as [Point, Point, Point];

  // Shift-click picks several; the side bar and the strip over the map say how many.
  await click(page, a);
  await expect(page.getByRole("tab", { name: /^Edit feature/ })).toBeVisible();
  await page.keyboard.down("Shift");
  await click(page, b);
  await click(page, c);
  await page.keyboard.up("Shift");
  await expect(page.getByRole("tab", { name: /^3 selected/ })).toBeVisible();
  await expect(page.locator(".pick-strip")).toContainText("3 picked");

  // Ctrl+G groups them, and the group's tab opens with its name ready to type.
  await page.keyboard.press("Control+g");
  await expect.poll(async () => (await stored(page)).groups?.length ?? 0).toBe(1);
  const made = await stored(page);
  expect(made.features.filter((f) => f.group === made.groups![0]!.id)).toHaveLength(3);
  const name = page.getByRole("textbox", { name: "Group name" });
  await expect(name).toBeFocused();
  await name.fill("Aldmere");
  await expect.poll(async () => (await stored(page)).groups?.[0]?.label).toBe("Aldmere");

  // The Layers tree shows it as a folder of its three members.
  const layers = await rightPanel(page, "Layers");
  const folder = layers.getByRole("treeitem", { name: "Aldmere", exact: true });
  await expect(folder).toHaveAttribute("aria-level", "2");
  await expect(layers.locator('.lt-feature[aria-level="3"]')).toHaveCount(3);

  // A click on an island selects the realm; a double-click goes inside; Esc comes back out.
  await click(page, b);
  await expect(page.getByRole("tab", { name: /^Edit group/ })).toBeVisible();
  const inB = await on(page, b);
  await page.mouse.dblclick(inB.x, inB.y);
  await expect(page.getByRole("tab", { name: /^Edit feature/ })).toBeVisible();
  await expect(page.locator(".group-crumb")).toContainText("Aldmere");
  await page.locator(".map-frame").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: /^Edit group/ })).toBeVisible();

  // Dragging one island moves all three, as one step.
  const before = (await zones(page)).map((z) => z.points![0]!);
  const from = await on(page, a);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 30, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await zones(page))[0]!.points![0]![1]).not.toBe(before[0]![1]);
  const after = (await zones(page)).map((z) => z.points![0]!);
  const moved = after.map((p, i) => [p[0] - before[i]![0], p[1] - before[i]![1]]);
  expect(moved[1]).toEqual(moved[0]);
  expect(moved[2]).toEqual(moved[0]);

  // Ungroup with Shift+Ctrl+G; Undo in the toast puts the realm back.
  await page.locator(".map-frame").focus();
  await page.keyboard.press("Shift+Control+g");
  await expect.poll(async () => (await stored(page)).groups?.length ?? 0).toBe(0);
  await page.getByRole("button", { name: "Undo", exact: true }).last().click();
  await expect.poll(async () => (await stored(page)).groups?.[0]?.label).toBe("Aldmere");

  // While viewing, a click selects the group and its card names it.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".map-tools")).toHaveCount(0);
  await click(page, { x: b.x, y: b.y + 20 });
  const card = page.locator(".group-card");
  await expect(card).toContainText("Aldmere");
  await expect(card).toContainText("A group of 3");
  await cleanUp(page, id);
});

test("on a phone, Select several picks with taps, Group groups them, and a second tap goes inside", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "The phone's Select several");
  const id = await openMap(page, `Isles ${info.project.name}`);
  await threeIslands(page);
  const tap = async (off: Point) => {
    const p = await on(page, off);
    await page.touchscreen.tap(p.x, p.y);
  };

  await page.getByRole("button", { name: "Select several", exact: true }).click();
  for (const p of ISLANDS) await tap(p);
  const strip = page.locator(".pick-strip");
  await expect(strip).toContainText("3 picked");
  await strip.getByRole("button", { name: /Group/ }).click();
  await expect.poll(async () => (await stored(page)).groups?.length ?? 0).toBe(1);
  await expect(strip).toHaveCount(0);

  // Let go of it; then a tap selects the group, and a second tap goes inside to the island.
  await page.locator(".group-editor .card-close").click();
  await tap(ISLANDS[1]!);
  await expect(page.getByRole("tab", { name: /^Edit group/ })).toBeVisible();
  await page.waitForTimeout(600);
  await tap(ISLANDS[1]!);
  await expect(page.getByRole("tab", { name: /^Edit feature/ })).toBeVisible();
  await expect(page.locator(".group-crumb")).toBeVisible();
  await cleanUp(page, id);
});
