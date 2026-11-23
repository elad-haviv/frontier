import { type CDPSession, expect, type Page, test } from "@playwright/test";

/**
 * Reading a map by pointing (stage 13b): hover, the selection, the right-click menu, the map's
 * keys and the names of its controls. The map is a globe of the sample image with a marker for
 * Harbor, a river named Saltwash with no entry, and a zone of four corners.
 */

const IMAGE = "99 Appendices/Images/map one.png";
const HARBOR = "01 Places/Harbor/Harbor.md";

type Point = { x: number; y: number };
type Stored = { features: { id: string; kind: string; points?: [number, number][] }[] };

/** Makes the globe with its three features through the API, and returns its id. */
const makeMap = (page: Page, title: string) =>
  page.evaluate(
    async ({ title, image, harbor }) => {
      const json = { "content-type": "application/json" };
      const made = await fetch("/api/maps", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ title, kind: "sphere", image }),
      });
      const { id } = (await made.json()) as { id: string };
      const loaded = await (await fetch(`/api/maps/${id}`)).json();
      const map = loaded.map;
      const layer = map.layers[0].id;
      const plain = { layer, entry: null, label: null, child: null };
      map.features = [
        {
          id: "reeds001",
          kind: "zone",
          ...plain,
          label: "Reedmarsh",
          points: [
            [20, 5],
            [40, 5],
            [40, -10],
            [20, -10],
          ],
        },
        {
          id: "salt0001",
          kind: "path",
          ...plain,
          label: "Saltwash",
          points: [
            [-10, -20],
            [0, -20],
            [10, -20],
          ],
        },
        { id: "harbor01", kind: "marker", ...plain, at: [0, 10], icon: null },
      ];
      await fetch(`/api/maps/${id}`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({
          map,
          revision: loaded.revision,
          baseBlob: loaded.blob,
          link: [{ feature: "harbor01", path: harbor }],
        }),
      });
      return id;
    },
    { title, image: IMAGE, harbor: HARBOR },
  );

/** Throws the map away, so the next test finds nothing unpublished. */
const cleanUp = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    await fetch(`/api/maps/${id}`, { method: "DELETE" });
    const un = await (await fetch("/api/unpublished")).json();
    for (const d of un.drafts) await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
  }, id);

const stored = (page: Page) =>
  page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    return ((await (await fetch(`/api/maps/${id}`)).json()) as { map: Stored }).map;
  });

const viewOf = (page: Page) =>
  decodeURIComponent(new URL(page.url()).searchParams.get("v") ?? "").split(",");

/**
 * Where a longitude and latitude are on the page, on the globe as first shown: centred on 0, 0,
 * with the radius the address gives.
 */
async function onGlobe(page: Page, lon: number, lat: number): Promise<Point> {
  // A side-bar tab that just opened or closed changes the frame; the map follows on the next draw.
  await page.waitForTimeout(150);
  const box = (await page.locator(".map-top").boundingBox())!;
  const k = Number(viewOf(page)[3]);
  const r = Math.PI / 180;
  return {
    x: box.x + box.width / 2 + k * Math.cos(lat * r) * Math.sin(lon * r),
    y: box.y + box.height / 2 - k * Math.sin(lat * r),
  };
}

/** Opens the map, viewing or editing, once its view is laid out and its features drawn. */
async function openMap(page: Page, title: string, edit = false) {
  await page.goto("/maps");
  const id = await makeMap(page, title);
  await page.goto(`/map/${id}${edit ? "?edit=1" : ""}`);
  await expect(page.locator(".map-top")).toBeVisible();
  await expect(page).toHaveURL(/v=/);
  // The names of linked entries arrive with the map; give the first draw a moment.
  await page.waitForTimeout(300);
  return id;
}

const cursor = (page: Page) =>
  page.locator(".map-top").evaluate((el) => getComputedStyle(el).cursor);

const tooltip = (page: Page) => page.locator(".map-tooltip");
const card = (page: Page) => page.locator(".map-hover-card");

test.describe("with a mouse", () => {
  // The phone has no mouse; it is tried by touch below.
  test.beforeEach(async ({ page }, info) => {
    void page;
    test.skip(info.project.name !== "desktop", "Needs a mouse");
  });

  test("CUJ 1: reads a map by pointing, clicking and right-clicking", async ({ page }) => {
    const id = await openMap(page, "Pointed at");
    const harbor = await onGlobe(page, 0, 10);
    const river = await onGlobe(page, 0, -20);

    // Over nothing the map can be grabbed.
    const empty = await onGlobe(page, -60, 40);
    await page.mouse.move(empty.x, empty.y);
    await expect.poll(() => cursor(page)).toBe("grab");

    // Over the marker: a hand, its name at once, then its entry's opening in its place.
    await page.mouse.move(harbor.x, harbor.y);
    await expect.poll(() => cursor(page)).toBe("pointer");
    await expect(tooltip(page)).toHaveText("Harbor");
    await expect(card(page)).toContainText("A town on the grey water.");
    await expect(card(page).locator("strong")).toHaveText("Harbor");
    await expect(tooltip(page)).toHaveCount(0);

    // Over the river: its name, and no card, since it has no entry.
    await page.mouse.move(river.x, river.y, { steps: 4 });
    await expect(tooltip(page)).toHaveText("Saltwash");
    await page.waitForTimeout(700);
    await expect(card(page)).toHaveCount(0);

    // Neither the name nor the live canvas catches the pointer: a click selects the river.
    await page.mouse.click(river.x, river.y);
    const selected = page.locator(".feature-card");
    await expect(selected.locator("h2")).toHaveText("Saltwash");
    await expect(tooltip(page)).toHaveCount(0);

    // The right-click menu on the marker. The Selected tab took room, so the globe moved.
    const marker = await onGlobe(page, 0, 10);
    await page.mouse.click(marker.x, marker.y, { button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Open the entry",
      /^Open the map of this placeIt has no map of its place$/,
      "Copy a link to this place",
      /^Edit this feature/,
    ]);
    await expect(menu.getByRole("menuitem", { name: /Open the map of this place/ })).toBeDisabled();
    // While the menu is open nothing is hovered.
    await expect(tooltip(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    // Closing it gives the focus back to the map.
    await expect(page.locator(".map-frame")).toBeFocused();

    // A right-click on an empty place.
    const nowhere = await onGlobe(page, -60, 40);
    await page.mouse.click(nowhere.x, nowhere.y, { button: "right" });
    // "Explore here" joins it when discovery is on, which depends on earlier tests.
    await expect(page.getByRole("menuitem").first()).toHaveText("Copy a link to this view");
    await expect(page.getByRole("menuitem", { name: /Open the entry/ })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Shift with a right-click leaves the browser's own menu: ours does not open.
    await page.keyboard.down("Shift");
    await page.mouse.click(marker.x, marker.y, { button: "right" });
    await page.keyboard.up("Shift");
    await page.waitForTimeout(300);
    await expect(page.getByRole("menu")).toHaveCount(0);

    // "Open the entry" goes to the entry.
    await page.mouse.move(nowhere.x, nowhere.y);
    await page.mouse.click(marker.x, marker.y, { button: "right" });
    await page.getByRole("menuitem", { name: "Open the entry" }).click();
    await expect(page.locator("h1")).toHaveText("Harbor");
    await cleanUp(page, id);
  });

  test("the selected feature's card copies a link to its place, without the view", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const id = await openMap(page, "Linked place");
    const harbor = await onGlobe(page, 0, 10);
    await page.mouse.click(harbor.x, harbor.y);
    const selected = page.locator(".feature-card");
    await selected.getByRole("button", { name: "Copy a link to this place" }).click();
    await expect(page.getByText("Copied a link to this place.")).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const url = new URL(link);
    expect(url.pathname).toBe(`/map/${id}`);
    expect(url.searchParams.get("f")).toBe("harbor01");
    expect(url.searchParams.get("v")).toBeNull();

    // Opened, it is centred on the marker, and its card shows.
    await page.goto(link);
    await expect(page.locator(".feature-card h2")).toHaveText("Harbor");
    await expect(page).toHaveURL(/v=/);
    expect(Number(viewOf(page)[2])).toBeCloseTo(10, 0);

    // "Edit this feature" starts editing with it selected.
    await page.locator(".feature-card").getByRole("button", { name: "Edit this feature" }).click();
    await expect(page.locator(".feature-editor")).toBeVisible();
    await expect(page.locator(".map-tools")).toBeVisible();
    await cleanUp(page, id);
  });

  test("every control of the map names itself, with its key, in a tooltip", async ({ page }) => {
    const id = await openMap(page, "Named controls");
    const tip = page.locator(".ui-tip");
    const named = async (name: string, words: string | RegExp) => {
      await page
        .getByRole("button", { name, exact: true })
        .or(page.getByRole("combobox", { name, exact: true }))
        .first()
        .hover();
      await expect(tip).toContainText(words);
      // Off the control, onto the foot of the map where nothing is: the tooltip closes.
      const box = (await page.locator(".map-top").boundingBox())!;
      await page.mouse.move(box.x + 10, box.y + box.height - 10);
      await expect(tip).toHaveCount(0);
    };
    await named("View", "View");
    await named("Layers", /Layers\s*L/);
    await named("Zoom in", /Zoom in\s*=/);
    await named("Zoom out", /Zoom out\s*-/);
    await named("Show the whole map", /Show the whole map\s*0/);
    await named("More actions", "More actions");
    await named("Edit", /Edit the map\s*E/);

    // While editing: the tools with their keys, undo and redo, Done.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await named("Select", /Select\s*V/);
    await named("Marker", /Marker\s*M/);
    await named("Path", /Path\s*P/);
    await named("Zone", /Zone\s*Z/);
    await named("Measure", /Measure\s*R/);
    await named("Undo", /Undo\s*Ctrl\+Z/);
    await named("Redo", /Redo\s*Ctrl\+Shift\+Z/);
    await named("Done", /Done editing\s*Ctrl\+Enter/);

    // The layer and image rows, whose delete is in each row's menu.
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    const panel = page.locator(".layer-panel");
    const place = panel.getByRole("button", { name: /^Place / });
    const placeName = (await place.getAttribute("aria-label"))!;
    await named(placeName, placeName);
    await named("Move up", "Move up");
    await named("Move down", "Move down");
    await panel
      .getByRole("button", { name: /^More for / })
      .last()
      .click();
    await expect(page.getByRole("menuitem", { name: /^Delete / })).toBeVisible();
    await page.keyboard.press("Escape");

    // The marker icons, named and plainly marked when chosen.
    const harbor = await onGlobe(page, 0, 10);
    await page.mouse.click(harbor.x, harbor.y);
    const editor = page.locator(".feature-editor");
    await expect(editor).toBeVisible();
    await named("Lamp", "Lamp");
    await editor.getByRole("button", { name: "Lamp" }).click();
    await expect(editor.getByRole("button", { name: "Lamp" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".save-saved")).toBeVisible();
    await cleanUp(page, id);
  });

  test("the map's keys, Esc one step at a time, and the sheet", async ({ page }) => {
    const id = await openMap(page, "Keyed", true);
    const pressed = (name: string) =>
      expect(page.getByRole("button", { name, exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    const empty = await onGlobe(page, -60, 40);
    // A press on the map gives it the focus, so the keys act on it.
    await page.mouse.click(empty.x, empty.y);
    await expect(page.locator(".map-frame")).toBeFocused();
    for (const [key, name] of [
      ["m", "Marker"],
      ["p", "Path"],
      ["z", "Zone"],
      ["r", "Measure"],
      ["v", "Select"],
    ]) {
      await page.keyboard.press(key!);
      await pressed(name!);
    }

    // Esc: a drawing in progress first, keeping the tool; then the tool; then the picked point;
    // then the selection.
    await page.keyboard.press("p");
    const a = await onGlobe(page, -40, 20);
    const b = await onGlobe(page, -30, 25);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    const finish = page.locator(".map-hint").getByRole("button", { name: "Finish path" });
    await expect(finish).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(finish).toBeDisabled();
    await pressed("Path");
    await page.keyboard.press("Escape");
    await pressed("Select");

    // Pick a corner of the zone, then Escape lets the point go, then the zone.
    // Inside the zone with four corners, and with three once one is gone.
    const zone = () => onGlobe(page, 25, -5);
    const corner = () => onGlobe(page, 40, 5);
    const other = () => onGlobe(page, 40, -10);
    const click = async (at: Promise<Point>, button: "left" | "right" = "left") => {
      const p = await at;
      await page.mouse.click(p.x, p.y, { button });
    };
    await click(zone());
    const editor = page.locator(".feature-editor");
    await expect(editor).toBeVisible();
    const c = await corner();
    // Over a corner: a cursor to move it, and what it does.
    await page.mouse.move(c.x, c.y);
    await expect(tooltip(page)).toHaveText("Drag to move · Delete to remove");
    await expect.poll(() => cursor(page)).toBe("move");
    await page.mouse.click(c.x, c.y);
    const remove = editor.getByRole("button", { name: "Remove this point" });
    await expect(remove).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(remove).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);

    // Delete takes the picked point, at once and as one step; at the fewest points it says why.
    await click(zone());
    await expect(editor).toBeVisible();
    await click(corner());
    await page.keyboard.press("Delete");
    await expect
      .poll(async () => (await stored(page)).features.find((f) => f.id === "reeds001")?.points)
      .toHaveLength(3);
    await click(other());
    await expect(editor.getByRole("button", { name: "Remove this point" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.keyboard.press("Backspace");
    await expect(page.locator(".map-said")).toHaveText("A zone needs at least 3 points");
    // The right-click menu says so too.
    await click(other(), "right");
    await expect(page.getByRole("menuitem", { name: /Remove this point/ })).toBeDisabled();
    await page.keyboard.press("Escape");

    // Without a picked point, Delete takes the feature; Ctrl+Z puts it back.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Delete");
    await expect(editor).toHaveCount(0);
    await expect
      .poll(async () => (await stored(page)).features.some((f) => f.id === "reeds001"))
      .toBe(false);
    await page.keyboard.press("Control+z");
    await expect
      .poll(async () => (await stored(page)).features.some((f) => f.id === "reeds001"))
      .toBe(true);

    // "-" zooms out, "=" in, "0" shows the whole map; arrows move it.
    const k = Number(viewOf(page)[3]);
    await page.keyboard.press("-");
    await expect.poll(() => Number(viewOf(page)[3])).toBeLessThan(k);
    const out = Number(viewOf(page)[3]);
    await page.keyboard.press("=");
    await expect.poll(() => Number(viewOf(page)[3])).toBeGreaterThan(out);
    await page.keyboard.press("-");
    await page.keyboard.press("-");
    await expect.poll(() => Number(viewOf(page)[3])).toBeLessThan(out);
    await page.keyboard.press("0");
    await expect.poll(() => Number(viewOf(page)[3])).toBeGreaterThan(out);
    const lon = Number(viewOf(page)[1]);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => Number(viewOf(page)[1])).not.toBeCloseTo(lon, 3);
    // The whole map again, as it opened, for the clicks below.
    await page.keyboard.press("0");
    await expect.poll(() => Number(viewOf(page)[1])).toBeCloseTo(0, 3);

    // In a side-bar field the letters are typed, not taken as keys.
    await click(zone());
    await editor.getByLabel(/^Label/).fill("mpz");
    await pressed("Select");
    await expect(editor.getByLabel(/^Label/)).toHaveValue("mpz");

    // The "?" sheet lists the map's keys, and says which act only while editing.
    await click(onGlobe(page, -60, 40));
    await page.keyboard.press("?");
    const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(sheet).toContainText("Marker tool while editing");
    await expect(sheet).toContainText("Zoom out");
    await expect(sheet).toContainText("Edit the map while viewing");
    await expect(sheet).toContainText("Stop, one step at a time");
    await page.keyboard.press("Escape");

    // Mod+Enter is Done; in viewing, M and Delete do nothing, and E edits again.
    await click(onGlobe(page, -60, 40));
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".map-tools")).toHaveCount(0);
    await click(zone());
    await expect(page.locator(".feature-card h2")).toHaveText("mpz");
    await page.keyboard.press("Delete");
    await page.keyboard.press("m");
    await expect(page.locator(".map-tools")).toHaveCount(0);
    expect((await stored(page)).features.some((f) => f.id === "reeds001")).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator(".feature-card")).toHaveCount(0);
    await page.keyboard.press("e");
    await expect(page.locator(".map-tools")).toBeVisible();
    await cleanUp(page, id);
  });
});

/** One finger on the screen, through Chromium's own touch input. */
async function touch(cdp: CDPSession, at: Point, hold: number) {
  const touchPoints = [{ id: 1, ...at }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints });
  await new Promise((resolve) => setTimeout(resolve, hold));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("CUJ 7: on a phone a tap selects, and a still long press is a tap with no menu", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "Needs touch");
  const id = await openMap(page, "Touched");
  const cdp = await page.context().newCDPSession(page);
  await touch(cdp, await onGlobe(page, 0, -20), 50);
  await expect(page.locator(".feature-card h2")).toHaveText("Saltwash");
  // A touch shows no name on the map: there is no hover.
  await expect(tooltip(page)).toHaveCount(0);

  // A still long press selects, as a tap does.
  await touch(cdp, await onGlobe(page, 0, 10), 1000);
  await expect(page.locator(".feature-card h2")).toHaveText("Harbor");
  await page.waitForTimeout(300);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(tooltip(page)).toHaveCount(0);
  await cleanUp(page, id);
});
