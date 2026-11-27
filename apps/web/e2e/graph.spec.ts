import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  discardDraft,
  edit,
  entry,
  goTo,
  newEntry,
  openEditor,
  rightPanel,
  saved,
  at,
} from "./helpers.ts";

// Canvas pixels are not read: the tests act through ?focus=, which centres a node, so once the
// layout has ended (aria-busy false) the node is in the middle of the canvas.

const HARBOR = "01 Places/Harbor/Harbor.md";
const MIRA = "02 People/Mira.md";
const graphOn = (path: string) => at(`/graph?focus=${encodeURIComponent(path)}`);
const canvas = (page: Page) => page.locator("canvas.graph-canvas");
const card = (page: Page) => page.getByRole("region", { name: "Selected entry" });

async function settled(page: Page): Promise<void> {
  await expect(canvas(page)).toHaveAttribute("aria-busy", "false");
}

async function middle(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.locator(".graph-stage").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("CUJ 1: the whole library, hover, select and open", async ({ page, isMobile }) => {
  test.skip(isMobile, "Hover and the keyboard are for a desktop.");
  await page.goto(at("/"));
  await goTo(page, "Graph");
  await expect(page).toHaveURL(/\/graph$/);
  await settled(page);
  await expect(canvas(page)).toHaveAttribute("aria-label", /^Graph of \d+ entries and \d+ links/);

  await page.goto(graphOn(HARBOR));
  await settled(page);
  await expect(card(page)).toContainText("Harbor");
  await expect(card(page)).toContainText("01 Places/Harbor");

  // Hovering the node shows its opening in the preview card.
  const at = await middle(page);
  await page.mouse.move(at.x - 20, at.y - 20);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await page.mouse.move(at.x + 1, at.y);
  await expect(page.locator(".hover-preview")).toContainText("A town on the grey water");

  // Esc clears the selection; a click on the middle selects again.
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/graph$/);
  await page.mouse.click(at.x, at.y);
  await expect(card(page)).toContainText("Harbor");

  // Enter opens it; Back comes to the graph with it still selected.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(entry(HARBOR));
  await page.goBack();
  await settled(page);
  await expect(card(page)).toContainText("Harbor");
});

test("CUJ 2: find an entry with the keyboard", async ({ page, isMobile }) => {
  test.skip(isMobile, "The keyboard's way is for a desktop.");
  await page.goto(at("/graph"));
  await settled(page);
  await page.keyboard.press("/");
  await expect(page.getByPlaceholder("Find an entry")).toBeFocused();
  await page.keyboard.type("quay");
  await expect(page.getByRole("option", { name: "Old Quay" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(card(page)).toContainText("Old Quay");
  await expect(page.getByRole("status").filter({ hasText: "Old Quay" })).toHaveText(
    /^Old Quay, 01 Places\/Harbor, \d+ links? out, \d+ in$/,
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(entry("01 Places/Harbor/Old Quay.md"));

  // The Entries tab: down one, Enter selects it, Enter again opens it.
  await page.goto(at("/graph"));
  await settled(page);
  const panel = await rightPanel(page, "Entries");
  const list = panel.getByRole("listbox", { name: "Entries on the graph" });
  await list.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const second = list.getByRole("option").nth(1);
  await expect(second).toHaveAttribute("aria-selected", "true");
  const name = (await second.locator(".graph-entry-name").innerText()).trim();
  await expect(card(page)).toContainText(name);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/e/.*${encodeURIComponent(name)}\\.md$`));
});

test("CUJ 3: narrow it down by folder", async ({ page }) => {
  await page.goto(at("/graph"));
  await settled(page);
  let panel = await rightPanel(page, "Filters");
  await panel.getByRole("checkbox", { name: "03 Things" }).uncheck();
  await panel.getByRole("checkbox", { name: "99 Appendices" }).check();
  panel = await rightPanel(page, "Entries");
  await expect(panel.getByRole("option", { name: /^Session/ })).toBeVisible();
  await expect(panel.getByRole("option", { name: /^Lantern/ })).toHaveCount(0);
  await expect(panel.getByRole("option", { name: /^Harbor/ }).first()).toBeVisible();
});

test("CUJ 5: on a phone, tap to select and tap again to open, pinch to zoom", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Touch is for a phone.");
  await page.goto(at("/"));
  await goTo(page, "Graph");
  await expect(page).toHaveURL(/\/graph$/);

  // A tap on the selected node opens it.
  await page.goto(graphOn(HARBOR));
  await settled(page);
  let at = await middle(page);
  await page.touchscreen.tap(at.x, at.y);
  await expect(page).toHaveURL(entry(HARBOR));

  // Back: zoomed right out, a tap on empty space clears; zoomed in again, a tap selects.
  await page.goBack();
  await settled(page);
  await expect(card(page)).toContainText("Harbor");
  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  for (let i = 0; i < 6; i++) await zoomOut.click();
  const box = (await page.locator(".graph-stage").boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 4, box.y + box.height / 2);
  await expect(card(page)).toHaveCount(0);
  for (let i = 0; i < 6; i++) await zoomIn.click();
  at = await middle(page);
  await page.touchscreen.tap(at.x, at.y);
  await expect(card(page)).toContainText("Harbor");

  // Two fingers moving apart zoom in.
  const zoom = () =>
    page.evaluate(() => {
      const raw = sessionStorage.getItem("frontier.graph.view");
      return raw ? (JSON.parse(raw) as { k: number }).k : 0;
    });
  await expect.poll(zoom).toBeGreaterThan(0);
  const before = await zoom();
  const cdp = await page.context().newCDPSession(page);
  const fingers = (type: string, spread: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd"
          ? []
          : [
              { x: at.x - spread, y: at.y - 40, id: 1 },
              { x: at.x + spread, y: at.y - 40, id: 2 },
            ],
    });
  await fingers("touchStart", 20);
  for (const spread of [30, 45, 60, 80]) await fingers("touchMove", spread);
  await fingers("touchEnd", 80);
  await expect.poll(zoom).toBeGreaterThan(before * 2);
});

// An entry's Graph tab (14b). Lists are checked for what they hold, since other test files
// publish entries into the same library.

/** A neighbour in the list under the tab's drawing, by its exact name. */
const neighbour = (panel: Locator, name: string | RegExp) =>
  panel
    .getByRole("list", { name: "Neighbours" })
    .getByRole("link")
    .filter({
      has: panel.page().locator(".local-graph-name", {
        hasText: typeof name === "string" ? new RegExp(`^${name}$`) : name,
      }),
    });

// Another test renames Lantern to Storm Lantern and publishes it.
const LANTERN = /^(Storm )?Lantern$/;

async function graphTab(page: Page): Promise<Locator> {
  const panel = await rightPanel(page, "Graph");
  await expect(panel.locator("canvas.graph-canvas")).toHaveAttribute("aria-busy", "false");
  return panel;
}

test("CUJ 4: an entry's neighbours, at depth 1 and 2", async ({ page }) => {
  await page.goto(entry(MIRA));
  let panel = await graphTab(page);
  await expect(panel.locator("canvas.graph-canvas")).toHaveAttribute(
    "aria-label",
    /^Graph of Mira and \d+ neighbours/,
  );
  for (const name of ["Harbor", "Old Quay", "Shade", "Ledger"]) {
    await expect(neighbour(panel, name)).toBeVisible();
  }
  await expect(neighbour(panel, LANTERN)).toHaveCount(0);
  // README links to Mira, but notes about the library are left out.
  await expect(neighbour(panel, "README")).toHaveCount(0);

  await panel.getByRole("button", { name: "Depth 2" }).click();
  await expect(panel.getByRole("button", { name: "Depth 2" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const name of ["The Marsh", LANTERN, "Broken", "Rope"]) {
    await expect(neighbour(panel, name)).toBeVisible();
  }
  // Session, in the appendices, links to Harbor and Old Quay, but the appendices are left out.
  await expect(neighbour(panel, "Session")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("frontier.graph.depth"))).toBe("2");

  // Choosing a neighbour opens it, with the Graph tab still open and it in the middle.
  await neighbour(panel, "Old Quay").click();
  await expect(page).toHaveURL(entry("01 Places/Harbor/Old Quay.md"));
  panel = page.getByRole("tabpanel");
  await expect(page.getByRole("tab", { name: /^Graph/ })).toHaveAttribute("aria-selected", "true");
  await expect(panel.locator("canvas.graph-canvas")).toHaveAttribute(
    "aria-label",
    /^Graph of Old Quay and/,
  );

  // "Open in full graph" selects the entry on the graph screen.
  await page.goto(entry(MIRA));
  panel = await graphTab(page);
  await panel.getByRole("link", { name: "Open in full graph" }).click();
  await expect(page).toHaveURL(/\/graph\?focus=/);
  expect(new URL(page.url()).searchParams.get("focus")).toBe(MIRA);
  await settled(page);
  await expect(card(page)).toContainText("Mira");
});

test("CUJ 6: a link just written, and a new entry, among the neighbours", async ({
  page,
}, info) => {
  // The tab opens before the queue has sent the change; the link shows once it is sent.
  await page.goto(entry(MIRA));
  // On a phone, Edit sits in the top line; on a desktop, in the bar at the top of the page.
  await page
    .locator(".sticky-line .edit-link, .phone-bar .edit-link")
    .locator("visible=true")
    .click();
  await expect(page).toHaveURL(edit(MIRA));
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nKeeps a coil of [[Rope]].");
  await page.goBack();
  await expect(page).toHaveURL(entry(MIRA));
  let panel = await graphTab(page);
  await expect(neighbour(panel, "Rope")).toBeVisible();
  await expect(neighbour(panel, "Rope")).not.toContainText("unpublished");

  // A new entry linking to Mira is among her neighbours, marked unpublished.
  const gull = `Gull ${info.project.name}`;
  await newEntry(page, "02 People", gull);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Sails past [[Mira]].\n");
  await saved(page);
  await page.goto(entry(MIRA));
  panel = await graphTab(page);
  await expect(neighbour(panel, gull)).toContainText("unpublished");

  await openEditor(page, `02 People/${gull}.md`);
  await discardDraft(page);
  await openEditor(page, MIRA);
  await discardDraft(page);
});
