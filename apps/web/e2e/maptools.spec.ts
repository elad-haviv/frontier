import { expect, type Page, test } from "@playwright/test";
import type { Position } from "@frontier/geo";
import { drawn, setUpAi as setUpAiAs } from "./helpers.ts";

/**
 * The map tools of stage 16d: labels, snapping, making a feature's entry from its entry list,
 * generating a feature's name and description, placing features with AI, and exploring from the
 * names on the map.
 */

const IMAGE = "99 Appendices/Images/map one.png";

type Feature = {
  id: string;
  kind: string;
  label: string | null;
  entry: string | null;
  at?: Position;
  points?: Position[];
  size?: number;
};
type Stored = { space: { width: number; height: number }; features: Feature[] };

/**
 * Makes a flat map through the API with these features, whose places are given as fractions of
 * the map's width and height, and returns its id.
 */
async function makeMap(page: Page, title: string, features: Record<string, unknown>[] = []) {
  if (!page.url().startsWith("http")) await page.goto("/maps");
  return page.evaluate(
    async ({ title, image, features }) => {
      const json = { "content-type": "application/json" };
      const made = await fetch("/api/maps", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ title, kind: "flat", image }),
      });
      const { id } = (await made.json()) as { id: string };
      if (features.length === 0) return id;
      const loaded = await (await fetch(`/api/maps/${id}`)).json();
      const map = loaded.map;
      const [w, h] = [map.space.width, map.space.height];
      const scale = ([x, y]: number[]) => [x! * w, y! * h];
      map.features = features.map((f) => ({
        layer: map.layers[0].id,
        entry: null,
        label: null,
        child: null,
        ...f,
        ...(f.at ? { at: scale(f.at as number[]) } : {}),
        ...(f.points ? { points: (f.points as number[][]).map(scale) } : {}),
      }));
      await fetch(`/api/maps/${id}`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ map, revision: loaded.revision, baseBlob: loaded.blob }),
      });
      return id;
    },
    { title, image: IMAGE, features },
  );
}

/** Throws maps away, and every draft, so the next test finds nothing unpublished. */
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

const viewOf = (page: Page) =>
  decodeURIComponent(new URL(page.url()).searchParams.get("v") ?? "").split(",");

/** Where a place given as fractions of the map is on the page, from the view in the address. */
async function onMap(page: Page, [fx, fy]: Position) {
  await page.waitForTimeout(150);
  const box = (await page.locator(".map-top").boundingBox())!;
  const { space } = await stored(page);
  const [, vx, vy, k] = viewOf(page).map(Number);
  return {
    x: box.x + box.width / 2 + (fx * space.width - vx!) * k!,
    y: box.y + box.height / 2 + (fy * space.height - vy!) * k!,
  };
}

async function open(page: Page, id: string, query = "edit=1") {
  await page.goto(`/map/${id}?${query}`);
  await expect(page.locator(".map-top")).toBeVisible();
  await expect(page).toHaveURL(/v=/);
  await page.waitForTimeout(300);
}

const saved = (page: Page) => expect(page.locator(".save-saved")).toBeVisible();

const setUpAi = (page: Page) => setUpAiAs(page, { conversation: "sample/reader" });

test.describe.configure({ mode: "serial" });

test("writes a label on the map, sets its look, and selects it by its words", async ({ page }) => {
  const id = await makeMap(page, "Labelled coast");
  await open(page, id);
  const c = await onMap(page, [0.5, 0.5]);
  await page.getByRole("button", { name: "Label", exact: true }).click();
  await page.mouse.click(c.x, c.y);
  const editor = page.locator(".feature-editor");
  await editor.getByLabel("Words").fill("The Grey Sea");
  await editor.getByLabel("Size").fill("28");
  await saved(page);
  const label = (await stored(page)).features.find((f) => f.kind === "label");
  expect(label).toMatchObject({ label: "The Grey Sea", size: 28 });

  // Closed, then tapped on its words, it is selected again.
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await editor.getByRole("button", { name: "Close" }).click();
  await expect(editor).toHaveCount(0);
  // Closing the editor widens the map again; the tap waits for the label drawn at the new width.
  await drawn(page);
  await page.mouse.click(c.x + 25, c.y + 4);
  await expect(page.locator(".feature-editor").getByLabel("Words")).toHaveValue("The Grey Sea");
  await cleanUp(page, [id]);
});

test("snaps a path to a zone's corner and edge, unless Alt is held or snapping is off", async ({
  page,
}) => {
  const id = await makeMap(page, "Shared borders", [
    {
      id: "land",
      kind: "zone",
      points: [
        [0.3, 0.3],
        [0.6, 0.3],
        [0.6, 0.6],
        [0.3, 0.6],
      ],
    },
  ]);
  await open(page, id);
  const { space } = await stored(page);
  const corner = [0.6 * space.width, 0.3 * space.height];

  /** Draws a path of three points: near the corner, near the right edge, and away. */
  async function drawPath(alt = false) {
    await page.getByRole("button", { name: "Path", exact: true }).click();
    const near = await onMap(page, [0.6, 0.3]);
    const edge = await onMap(page, [0.6, 0.45]);
    const away = await onMap(page, [0.8, 0.8]);
    if (alt) await page.keyboard.down("Alt");
    await page.mouse.click(near.x + 5, near.y - 4);
    await page.mouse.click(edge.x + 6, edge.y);
    if (alt) await page.keyboard.up("Alt");
    await page.mouse.click(away.x, away.y);
    await page.getByRole("button", { name: "Finish path" }).click();
    await saved(page);
    const paths = (await stored(page)).features.filter((f) => f.kind === "path");
    return paths[paths.length - 1]!.points!;
  }

  const snapped = await drawPath();
  // The corner exactly, so the two borders share it; the edge's line, wherever along it.
  expect(snapped[0]).toEqual(corner);
  expect(snapped[1]![0]).toBeCloseTo(corner[0]!, 3);

  const free = await drawPath(true);
  expect(free[0]).not.toEqual(corner);

  const toggle = page.getByRole("button", { name: "Snapping" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const off = await drawPath();
  expect(off[0]).not.toEqual(corner);
  // Remembered on this device.
  await page.reload();
  await expect(page.getByRole("button", { name: "Snapping" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.getByRole("button", { name: "Snapping" }).click();
  await cleanUp(page, [id]);
});

test("makes the entry a feature's typed name asks for, and links it", async ({ page }) => {
  const id = await makeMap(page, "Harbours", [
    { id: "port", kind: "marker", at: [0.5, 0.5], icon: null },
  ]);
  await open(page, id);
  const c = await onMap(page, [0.5, 0.5]);
  await page.mouse.click(c.x, c.y);
  const editor = page.locator(".feature-editor");
  await editor.getByRole("combobox", { name: "Entry" }).click();
  await page.getByPlaceholder("Find an entry").fill("Gull Rock Harbour");
  await page.getByRole("option", { name: "Create entry “Gull Rock Harbour”" }).click();

  const dialog = page.getByRole("dialog", { name: "New entry" });
  await expect(dialog.getByLabel("Name")).toHaveValue("Gull Rock Harbour");
  await dialog.getByRole("combobox", { name: "Folder" }).click();
  await page.getByPlaceholder("Find a folder").fill("02 People");
  await page.getByRole("option", { name: "02 People", exact: true }).click();
  await dialog.getByRole("button", { name: "Make and link the entry" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editor.getByRole("combobox", { name: "Entry" })).toContainText("Gull Rock Harbour");
  await saved(page);
  await expect
    .poll(async () => (await stored(page)).features.find((f) => f.id === "port")?.entry)
    .toBeTruthy();
  const drafts = await page.evaluate(async () =>
    ((await (await fetch("/api/unpublished")).json()).drafts as { path: string }[]).map(
      (d) => d.path,
    ),
  );
  expect(drafts).toContain("02 People/Gull Rock Harbour.md");
  await cleanUp(page, [id]);
});

test("explores from the names on the map, and says plainly why it cannot", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "The AI settings are one per server.");
  await setUpAi(page);
  const empty = await makeMap(page, "Empty sea");
  const named = await makeMap(page, "Named coast", [
    { id: "lab1", kind: "label", at: [0.55, 0.5], label: "The Sunken Coast" },
  ]);
  const cut = await makeMap(page, "Cut coast", [
    { id: "lab2", kind: "label", at: [0.55, 0.5], label: "Truncated Point" },
  ]);

  // Nothing near: why is said over the map and in the notice. A tap chooses; Ask asks.
  await open(page, empty, "");
  await page.getByRole("button", { name: "Explore" }).click();
  let c = await onMap(page, [0.5, 0.5]);
  await page.mouse.click(c.x, c.y);
  await page.getByRole("button", { name: "Ask what is there" }).click();
  await expect(page.locator(".map-hint-failed")).toContainText("Nothing near this place");
  await expect(page.locator(".map-notice")).toBeVisible();

  // Only a label near: it is enough to draw on.
  await open(page, named, "");
  await page.getByRole("button", { name: "Explore" }).click();
  c = await onMap(page, [0.5, 0.5]);
  await page.mouse.click(c.x, c.y);
  await page.getByRole("button", { name: "Ask what is there" }).click();
  const card = page.locator(".discovery-card");
  await expect(card.locator("h2")).toHaveText("Test Hollow");
  await expect(card).toContainText("grows only from the names on the map");

  // An answer cut off at the token limit says so.
  await open(page, cut, "");
  await page.getByRole("button", { name: "Explore" }).click();
  c = await onMap(page, [0.5, 0.5]);
  await page.mouse.click(c.x, c.y);
  await page.getByRole("button", { name: "Ask what is there" }).click();
  await expect(page.locator(".map-hint-failed")).toContainText(
    "The model ran out of room before finishing its answer",
  );
  await cleanUp(page, [empty, named, cut]);
});

test("generates a feature's name, makes its entry, and places features with AI", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "The AI settings are one per server.");
  await setUpAi(page);
  const id = await makeMap(page, "Generated coast", [
    { id: "tower", kind: "marker", at: [0.5, 0.5], icon: null },
  ]);
  await open(page, id);
  const c = await onMap(page, [0.5, 0.5]);
  await page.mouse.click(c.x, c.y);
  const editor = page.locator(".feature-editor");
  await editor.getByRole("button", { name: "Surprise me" }).click();
  const preview = editor.locator(".generate-preview");
  await expect(preview).toContainText("Test Watchtower");
  await expect(preview).toContainText("A watchtower the test made up.");
  await preview.getByRole("button", { name: "Use this" }).click();
  await expect(editor.getByRole("textbox", { name: /^Label/ })).toHaveValue("Test Watchtower");

  await editor.getByRole("button", { name: "Make an entry for “Test Watchtower”…" }).click();
  const dialog = page.getByRole("dialog", { name: "New entry" });
  await expect(dialog.getByLabel("Name")).toHaveValue("Test Watchtower");
  await dialog.getByRole("combobox", { name: "Folder" }).click();
  await page.getByPlaceholder("Find a folder").fill("02 People");
  await page.getByRole("option", { name: "02 People", exact: true }).click();
  await dialog.getByRole("button", { name: "Make and link the entry" }).click();
  await expect(editor.getByRole("combobox", { name: "Entry" })).toContainText("Test Watchtower");
  await saved(page);
  const text = await page.evaluate(async () => {
    const un = await (await fetch("/api/unpublished")).json();
    return (un.drafts as { path: string; text: string }[]).find(
      (d) => d.path === "02 People/Test Watchtower.md",
    )?.text;
  });
  expect(text).toContain("A watchtower the test made up.");

  // Place with AI: a spot, two proposals shown on the map, one placed.
  await page.getByRole("button", { name: "Place with AI" }).click();
  const spot = await onMap(page, [0.3, 0.3]);
  await page.mouse.click(spot.x, spot.y);
  const panel = page.getByRole("region", { name: "Place with AI" });
  await panel.getByLabel("How many").selectOption("2");
  await panel.getByRole("button", { name: "Propose" }).click();
  await expect(page.locator(".ghost-pin")).toHaveCount(2);
  const before = (await stored(page)).features.length;
  await panel.getByRole("button", { name: "Place Test Watchtower 2" }).click();
  await expect(page.locator(".ghost-pin")).toHaveCount(1);
  await saved(page);
  const after = (await stored(page)).features;
  expect(after).toHaveLength(before + 1);
  expect(after[after.length - 1]).toMatchObject({ kind: "marker", label: "Test Watchtower 2" });
  await cleanUp(page, [id]);
});
