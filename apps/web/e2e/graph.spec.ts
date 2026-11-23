import { expect, type Page, test } from "@playwright/test";
import { entry, goTo, rightPanel } from "./helpers.ts";

// Canvas pixels are not read: the tests act through ?focus=, which centres a node, so once the
// layout has ended (aria-busy false) the node is in the middle of the canvas.

const HARBOR = "01 Places/Harbor/Harbor.md";
const graphOn = (path: string) => `/graph?focus=${encodeURIComponent(path)}`;
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
  await page.goto("/");
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
  await page.goto("/graph");
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
  await page.goto("/graph");
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
  await page.goto("/graph");
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
  await page.goto("/");
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
