import { expect, type Locator, type Page, test } from "./test.ts";
import { proj } from "./helpers.ts";

/**
 * Path and zone styles (stage 13d): kept once for the library in `.frontier/map-styles.json`,
 * edited in the Styles tab, chosen for a feature, shown in the legend, and merged between two
 * devices that changed different styles.
 */

const IMAGE = "99 Appendices/Images/map one.png";
const STYLES_FILE = ".frontier/map-styles.json";
const AUTH = "test-results/.auth.json";

type Position = [number, number];
type Stored = {
  space: { width: number; height: number };
  layers: { id: string; color: string }[];
  features: { id: string; style?: string }[];
};
type Style = {
  id: string;
  name: string;
  for: string;
  color: string | null;
  width: number;
  dash: string;
};

test.beforeEach(async ({ page }, info) => {
  void page;
  test.skip(info.project.name !== "desktop", "Edited with a mouse, at desktop size");
});

/**
 * Makes a flat map through the API with two rivers across it and a border, each given as
 * fractions of the image, and returns its id.
 */
const makeMap = (page: Page, title: string) =>
  page.evaluate(
    async ({ title, image }) => {
      const json = { "content-type": "application/json" };
      const made = await fetch(`${API}/maps`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ title, kind: "flat", image }),
      });
      const { id } = (await made.json()) as { id: string };
      const loaded = await (await fetch(`${API}/maps/${id}`)).json();
      const map = loaded.map;
      const { width, height } = map.space;
      const at = (x: number, y: number) => [x * width, y * height];
      const path = (fid: string, points: number[][]) => ({
        id: fid,
        kind: "path",
        layer: map.layers[0].id,
        points: points.map(([x, y]) => at(x!, y!)),
        entry: null,
        label: null,
        child: null,
      });
      map.features = [
        path("river1", [
          [0.2, 0.3],
          [0.8, 0.3],
        ]),
        path("river2", [
          [0.2, 0.5],
          [0.8, 0.5],
        ]),
        path("border1", [
          [0.2, 0.7],
          [0.8, 0.7],
        ]),
      ];
      await fetch(`${API}/maps/${id}`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ map, revision: loaded.revision, baseBlob: loaded.blob }),
      });
      return id;
    },
    { title, image: IMAGE },
  );

/** Throws the maps and every draft away, the styles file's too, so the next test starts clean. */
const cleanUp = (page: Page, maps: string[]) =>
  page.evaluate(async (maps) => {
    for (const id of maps) await fetch(`${API}/maps/${id}`, { method: "DELETE" });
    const un = await (await fetch(`${API}/unpublished`)).json();
    for (const d of un.drafts) await fetch(`${API}/drafts/${d.id}`, { method: "DELETE" });
  }, maps);

const storedMap = (page: Page, id: string) =>
  page.evaluate(
    async (id) => ((await (await fetch(`${API}/maps/${id}`)).json()) as { map: Stored }).map,
    id,
  );
const storedStyles = (page: Page) =>
  page.evaluate(
    async () =>
      (
        (await (await fetch(`${API}/library-files/map-styles`)).json()) as {
          file: { styles: Style[] };
        }
      ).file.styles,
  );

const viewOf = (page: Page) =>
  decodeURIComponent(new URL(page.url()).searchParams.get("v") ?? "").split(",");

/** Where a fraction of the map's image is on the page, from the view in the address. */
async function onMap(page: Page, map: Stored, [fx, fy]: Position) {
  await page.waitForTimeout(150);
  const box = (await page.locator(".map-top").boundingBox())!;
  const [, vx, vy, k] = viewOf(page).map(Number);
  return {
    x: box.x + box.width / 2 + (fx * map.space.width - vx!) * k!,
    y: box.y + box.height / 2 + (fy * map.space.height - vy!) * k!,
  };
}

/** The colour drawn on the features' canvas at a point of the page, as "#rrggbb". */
async function colourAt(page: Page, at: { x: number; y: number }) {
  return page.locator(".map-top").evaluate((canvas: HTMLCanvasElement, at) => {
    const box = canvas.getBoundingClientRect();
    const ratio = canvas.width / box.width;
    const ctx = canvas.getContext("2d")!;
    const [r, g, b] = ctx.getImageData(
      Math.floor((at.x - box.x) * ratio),
      Math.floor((at.y - box.y) * ratio),
      1,
      1,
    ).data;
    return "#" + [r, g, b].map((n) => n!.toString(16).padStart(2, "0")).join("");
  }, at);
}

async function open(page: Page, id: string, query = "edit=1") {
  await page.goto(proj(`/map/${id}?${query}`));
  await expect(page.locator(".map-top")).toBeVisible();
  await expect(page).toHaveURL(/v=/);
  await page.waitForTimeout(300);
}

/** Opens the side bar's tab of this name, through the Layers button when the bar is folded. */
async function tab(page: Page, name: string) {
  if ((await page.getByRole("tab", { name }).count()) === 0) {
    await page.getByRole("button", { name: "Layers", exact: true }).click();
  }
  await page.getByRole("tab", { name }).click();
  return page.getByRole("tabpanel");
}

/** Opens a style's form from its row's "⋯". */
async function editStyle(panel: Locator, name: string) {
  await panel.getByRole("button", { name: `More for ${name}` }).click();
  await panel.page().getByRole("menuitem", { name: "Edit" }).click();
  return panel.getByRole("group", { name: `The look of ${name}` });
}

/** Chooses a style for the selected feature in its Edit feature tab. */
async function chooseStyle(page: Page, name: string) {
  const panel = await tab(page, "Edit feature");
  await panel.getByRole("combobox", { name: "Path style" }).click();
  await page.getByPlaceholder("Find a style").fill(name);
  await page.getByRole("option", { name, exact: true }).click();
  await expect(panel.getByRole("combobox", { name: "Path style" })).toContainText(name);
}

/** Whether two colours are alike, within what smoothing the edges of a line leaves. */
const alike = (a: string, b: string) =>
  [1, 3, 5].every(
    (i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 24,
  );
/** Waits until the canvas shows this colour at a point. */
const showsColour = (page: Page, at: { x: number; y: number }, colour: string) =>
  expect.poll(async () => alike(await colourAt(page, at), colour)).toBe(true);

/** Every change on its way to the server has arrived. */
const saved = (page: Page) => expect(page.locator(".save-saved")).toBeVisible();

test("CUJ 5: gives rivers and borders their own look on two maps, and a deleted style falls back", async ({
  page,
}) => {
  const tag = Date.now().toString(36);
  const one = await (async () => {
    await page.goto(proj("/maps"));
    return makeMap(page, `Rivers one ${tag}`);
  })();
  const two = await makeMap(page, `Rivers two ${tag}`);

  // The usual styles, then River in teal at width 4 and Border dashed in its layer's colour.
  await open(page, one);
  let styles = await tab(page, "Styles");
  await styles.getByRole("button", { name: "Add the usual styles" }).click();
  await expect(styles.getByText("River", { exact: true })).toBeVisible();
  await expect(styles.getByRole("button", { name: "Add the usual styles" })).toHaveCount(0);
  const river = await editStyle(styles, "River");
  await river.getByRole("radio", { name: "Teal" }).click();
  await river.getByRole("slider").first().fill("4");
  await expect(river).toContainText("4 px");
  await river.getByRole("button", { name: "Close the form" }).click();
  const border = await editStyle(styles, "Border");
  await border.getByRole("radio", { name: "Dashed" }).click();
  await expect(border.getByRole("radio", { name: "The layer's colour" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await border.getByRole("button", { name: "Close the form" }).click();
  // A second Border for paths is refused.
  const road = await editStyle(styles, "Road");
  await road.getByLabel("Name").fill("Border");
  await expect(road.getByRole("alert")).toHaveText("There is already a path style named Border.");
  await road.getByLabel("Name").fill("Road");
  await road.getByRole("button", { name: "Close the form" }).click();
  await expect
    .poll(async () => (await storedStyles(page)).find((s) => s.name === "River"))
    .toMatchObject({ color: "#1d6b63", width: 4, dash: "solid" });
  await expect
    .poll(async () => (await storedStyles(page)).find((s) => s.name === "Border"))
    .toMatchObject({ color: null, dash: "dashed" });
  const riverId = (await storedStyles(page)).find((s) => s.name === "River")!.id;
  const borderId = (await storedStyles(page)).find((s) => s.name === "Border")!.id;

  // Two rivers on each map take the River style, and one border the Border style: the first
  // river in its tab, the rest through the right-click menu.
  for (const id of [one, two]) {
    await open(page, id, "edit=1&f=river1");
    await chooseStyle(page, "River");
    const map = await storedMap(page, id);
    const middle = await onMap(page, map, [0.5, 0.5]);
    await page.mouse.click(middle.x, middle.y, { button: "right" });
    await page.getByRole("menuitem", { name: "Path style" }).click();
    // By key: the way down to the item would cross the next submenu's trigger.
    await page.getByRole("menuitem", { name: "River" }).press("Enter");
    const lower = await onMap(page, map, [0.5, 0.7]);
    await page.mouse.click(lower.x, lower.y, { button: "right" });
    await page.getByRole("menuitem", { name: "Path style" }).click();
    await page.getByRole("menuitem", { name: "Border" }).press("Enter");
    await expect
      .poll(async () => (await storedMap(page, id)).features.map((f) => f.style ?? null))
      .toEqual([riverId, riverId, borderId]);
    await saved(page);
  }

  // Both maps draw their rivers in the River style, and list it in the legend.
  for (const id of [two, one]) {
    await open(page, id, "");
    const map = await storedMap(page, id);
    await showsColour(page, await onMap(page, map, [0.5, 0.3]), "#1d6b63");
    const layers = await tab(page, "Layers");
    const legend = layers.getByRole("region", { name: "Legend" });
    await expect(legend.locator("li")).toHaveText([/^River$/, /^Border\s*in its layer's colour$/]);
  }

  // Delete River: at once, with Undo in the toast, which brings it back with its look.
  const map = await storedMap(page, one);
  await open(page, one);
  styles = await tab(page, "Styles");
  await styles.getByRole("button", { name: "More for River" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.locator(".ui-toast")).toContainText("Deleted the style River");
  await expect(styles.getByText("River", { exact: true })).toHaveCount(0);
  const riverAt = await onMap(page, map, [0.5, 0.3]);
  await showsColour(page, riverAt, map.layers[0]!.color);
  await page.locator(".ui-toast").getByRole("button", { name: "Undo" }).click();
  await expect(styles.getByText("River", { exact: true })).toBeVisible();
  await showsColour(page, riverAt, "#1d6b63");
  await expect
    .poll(async () => (await storedStyles(page)).find((s) => s.id === riverId))
    .toMatchObject({ name: "River", color: "#1d6b63", width: 4 });

  // Deleted again: the rivers fall back to their layer's look and keep the id.
  await styles.getByRole("button", { name: "More for River" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect
    .poll(async () => (await storedStyles(page)).some((s) => s.id === riverId))
    .toBe(false);
  await saved(page);
  await open(page, two, "edit=1&f=river2");
  const other = await storedMap(page, two);
  await showsColour(page, await onMap(page, other, [0.5, 0.3]), other.layers[0]!.color);
  expect(other.features.map((f) => f.style ?? null)).toEqual([riverId, riverId, borderId]);
  await expect((await tab(page, "Edit feature")).getByText("Style: deleted")).toBeVisible();
  const legend = (await tab(page, "Layers")).getByRole("region", { name: "Legend" });
  await expect(legend.locator("li")).toHaveText([/^Border/]);

  // The styles file and both maps wait to be saved together with the next version.
  const unpublished = await page.evaluate(async () =>
    (
      (await (await fetch(`${API}/unpublished`)).json()) as { drafts: { path: string }[] }
    ).drafts.map((d) => d.path),
  );
  expect(unpublished).toEqual(
    expect.arrayContaining([
      STYLES_FILE,
      `.frontier/maps/${one}.json`,
      `.frontier/maps/${two}.json`,
    ]),
  );
  await page.goto(proj("/unpublished"));
  await expect(page.getByText("Map styles", { exact: true })).toBeVisible();

  await cleanUp(page, [one, two]);
});

test("two devices editing different styles are merged", async ({ page, browser }) => {
  await page.goto(proj("/maps"));
  const id = await makeMap(page, `Merged rivers ${Date.now().toString(36)}`);
  await page.evaluate(async () => {
    const loaded = await (await fetch(`${API}/library-files/map-styles`)).json();
    await fetch(`${API}/library-files/map-styles`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file: {
          version: 1,
          styles: [
            {
              id: "k3v9x2pa",
              name: "River",
              for: "path",
              color: "#2f6f9f",
              width: 3,
              dash: "solid",
            },
            {
              id: "q8m1z0tr",
              name: "Border",
              for: "path",
              color: null,
              width: 2,
              dash: "dash-dot",
            },
          ],
        },
        revision: loaded.revision,
        baseBlob: loaded.blob,
      }),
    });
  });

  // A second device, with its own storage, opens the same map before the first changes anything.
  const other = await browser.newContext({
    storageState: AUTH,
    serviceWorkers: "block",
    viewport: { width: 1280, height: 800 },
  });
  const second = await other.newPage();
  await open(page, id);
  await open(second, id);
  const firstPanel = await tab(page, "Styles");
  const secondPanel = await tab(second, "Styles");
  await expect(secondPanel.getByText("Border", { exact: true })).toBeVisible();

  const river = await editStyle(firstPanel, "River");
  await river.getByRole("slider").first().fill("5");
  await saved(page);
  const border = await editStyle(secondPanel, "Border");
  await border.getByRole("radio", { name: "Long dashes" }).click();

  // The second save is stale; its device merges the two and sends again.
  await expect
    .poll(async () => (await storedStyles(page)).map((s) => [s.name, s.width, s.dash]))
    .toEqual([
      ["River", 5, "solid"],
      ["Border", 2, "long"],
    ]);
  await other.close();
  await cleanUp(page, [id]);
});
