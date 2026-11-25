import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

/**
 * What the Find paths, joins and Terrain browser tests share: a map made of the fixture picture
 * (fixtures/make-find-paths.mjs: 600 × 400, a position is a pixel), with its height map and
 * styles when asked for, and where a position is on the page.
 */

const here = dirname(fileURLToPath(import.meta.url));
export type Position = [number, number];
export type Feature = {
  id: string;
  kind: string;
  label: string | null;
  style?: string;
  points?: Position[];
  group?: string;
  startOn?: string;
  endOn?: string;
};
export type Stored = { features: Feature[]; groups?: { id: string }[] };

export const RIVER_STYLE = {
  id: "strriver",
  name: "River",
  for: "path",
  color: "#2f6f9f",
  width: 3,
  dash: "solid",
  counts: "river",
};
export const ROAD_STYLE = {
  id: "strroad1",
  name: "Road",
  for: "path",
  color: "#7a5230",
  width: 2,
  dash: "long",
  counts: "road",
};

export async function upload(page: Page, picture: string): Promise<string> {
  const bytes = readFileSync(join(here, "fixtures", picture)).toString("base64");
  return page.evaluate(
    async ({ picture, bytes }) => {
      const data = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.append("file", new Blob([data], { type: "image/png" }), picture);
      const sent = await fetch("/api/images", { method: "POST", body: form });
      return ((await sent.json()) as { path: string }).path;
    },
    { picture, bytes },
  );
}

/**
 * Makes a flat map of the fixture picture, one kilometre a pixel. With `heights`, the map's
 * terrain is its height map; `features` are added, and `styles` put in the library.
 */
export async function makeMap(
  page: Page,
  title: string,
  o: { heights?: boolean; features?: object[]; styles?: object[] } = {},
) {
  if (!page.url().startsWith("http")) await page.goto("/maps");
  const image = await upload(page, "find-paths.png");
  const heights = o.heights ? await upload(page, "find-paths-heights.png") : null;
  return page.evaluate(
    async ({ title, image, heights, features, styles }) => {
      const json = { "content-type": "application/json" };
      if (styles.length > 0) {
        const lib = await (await fetch("/api/library-files/map-styles")).json();
        const put = await fetch("/api/library-files/map-styles", {
          method: "PUT",
          headers: json,
          body: JSON.stringify({
            file: { version: 1, styles },
            revision: lib.revision,
            baseBlob: lib.blob,
          }),
        });
        if (!put.ok) throw new Error(await put.text());
      }
      const made = await fetch("/api/maps", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ title, kind: "flat", image }),
      });
      const { id } = (await made.json()) as { id: string };
      const loaded = await (await fetch(`/api/maps/${id}`)).json();
      const map = loaded.map;
      map.space = { ...map.space, scale: 1, unit: "km" };
      if (heights) {
        map.terrain = { image: heights, range: [0, 2550], rangeUnit: "m" };
      }
      map.features = features.map((f: object) => ({
        layer: map.layers[0].id,
        entry: null,
        label: null,
        child: null,
        ...f,
      }));
      const saved = await fetch(`/api/maps/${id}`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ map, revision: loaded.revision, baseBlob: loaded.blob }),
      });
      if (!saved.ok) throw new Error(await saved.text());
      return id;
    },
    { title, image, heights, features: o.features ?? [], styles: o.styles ?? [] },
  );
}

export const cleanUp = (page: Page, maps: string[]) =>
  page.evaluate(async (maps) => {
    for (const id of maps) await fetch(`/api/maps/${id}`, { method: "DELETE" });
    const un = await (await fetch("/api/unpublished")).json();
    for (const d of un.drafts) await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
  }, maps);

export const stored = (page: Page) =>
  page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    return ((await (await fetch(`/api/maps/${id}`)).json()) as { map: Stored }).map;
  });
export const paths = async (page: Page) =>
  (await stored(page)).features.filter((f) => f.kind === "path");
export const saved = (page: Page) => expect(page.locator(".save-saved")).toBeVisible();

export const viewOf = (page: Page) =>
  decodeURIComponent(new URL(page.url()).searchParams.get("v") ?? "").split(",");

/** Where a position of the flat map is on the page, from the view in the address. */
export async function onMap(page: Page, [x, y]: Position) {
  await page.waitForTimeout(150);
  const box = (await page.locator(".map-top").boundingBox())!;
  const [, vx, vy, k] = viewOf(page).map(Number);
  return { x: box.x + box.width / 2 + (x - vx!) * k!, y: box.y + box.height / 2 + (y - vy!) * k! };
}
export const click = async (page: Page, at: Position) => {
  const p = await onMap(page, at);
  await page.mouse.click(p.x, p.y);
};

export async function open(page: Page, id: string) {
  await page.goto(`/map/${id}?edit=1`);
  await expect(page.locator(".map-top")).toBeVisible();
  await expect(page).toHaveURL(/v=/);
  await page.waitForTimeout(300);
}

export const bar = (page: Page) => page.getByRole("group", { name: "Find paths" });
export const status = (page: Page) => bar(page).getByRole("status");

/** Chooses Find paths and a kind, and waits until the map has been looked at. */
export async function findPaths(page: Page, kind: "River" | "Route" | "Trace") {
  await page.getByRole("button", { name: "Find paths" }).click();
  await bar(page).getByRole("button", { name: kind, exact: true }).click();
  await expect(bar(page)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
}
export const ready = (page: Page) => expect(bar(page)).toHaveAttribute("data-ready", "true");

/** How far a point is from a line through points. */
export function distanceTo(p: Position, line: Position[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]!;
    const [bx, by] = line[i]!;
    const l = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = l
      ? Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / l))
      : 0;
    best = Math.min(best, Math.hypot(p[0] - ax - t * (bx - ax), p[1] - ay - t * (by - ay)));
  }
  return best;
}

/** A point made by a click is where the click was meant, to within a screen pixel. */
export const near = (p: Position | undefined, [x, y]: Position) => {
  expect(Math.abs(p![0] - x)).toBeLessThan(1);
  expect(Math.abs(p![1] - y)).toBeLessThan(1);
};
