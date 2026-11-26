import { expect, type Page, test } from "@playwright/test";
import { entry, noSidewaysScroll, openSideBar } from "./helpers.ts";

// Stage 26: on a phone the library is a row in the drawer's menu and opens as a panel over it.

const HARBOR = "01 Places/Harbor/Harbor.md";

type Folder = { notes: { path: string }[]; folders: Folder[] };

/** The paths of every entry of the library, from the server's tree. */
async function allEntries(page: Page): Promise<string[]> {
  const tree = (await (await page.request.get("/api/tree")).json()) as Folder;
  const walk = (f: Folder): string[] => [...f.notes.map((n) => n.path), ...f.folders.flatMap(walk)];
  return walk(tree);
}

const drawer = (page: Page) => page.getByRole("dialog", { name: "Side bar" });
const panel = (page: Page) => page.getByRole("region", { name: "Library" });
const libraryRow = (page: Page) => drawer(page).getByRole("button", { name: /^Library/ });

/** Opens the drawer on an entry's page and taps the Library row. */
async function openPanel(page: Page, path = HARBOR): Promise<void> {
  await page.goto(entry(path));
  await expect(page.locator(".entry h1").first()).toBeVisible();
  await openSideBar(page);
  await libraryRow(page).click();
  await expect(panel(page)).toBeVisible();
}

test("the menu has a Library row with the number of entries, and the folders are not in it", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The drawer is the phone's side bar.");
  await page.goto(entry(HARBOR));
  await openSideBar(page);
  const count = (await allEntries(page)).length;
  const row = libraryRow(page);
  await expect(row).toBeVisible();
  await expect(row).toHaveAccessibleName(`Library, ${count} entries`);
  await expect(row).toContainText(String(count));
  // After the places, with a tap target of at least 2.5rem.
  const ask = (await drawer(page).getByRole("link", { name: /^Ask/ }).boundingBox())!;
  const box = (await row.boundingBox())!;
  expect(box.y).toBeGreaterThan(ask.y);
  expect(box.height).toBeGreaterThanOrEqual(40);
  // The small buttons and the folders left the menu; Working on stays.
  await expect(drawer(page).getByRole("tree")).toHaveCount(0);
  await expect(drawer(page).locator(".left-tree")).toHaveCount(0);
  await expect(drawer(page).getByRole("region", { name: "Working on" })).toBeVisible();
  await noSidewaysScroll(page);
});

test("the Library row opens a panel in which the folders fill the height", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The drawer is the phone's side bar.");
  await openPanel(page);
  const view = page.viewportSize()!;
  await expect(panel(page).getByRole("tree")).toBeVisible();
  const tree = (await panel(page).locator(".tree").boundingBox())!;
  expect(tree.height).toBeGreaterThanOrEqual(view.height * 0.6);
  // The panel is the drawer's size, the whole of it.
  const box = (await drawer(page).boundingBox())!;
  const pane = (await panel(page).boundingBox())!;
  expect(Math.abs(pane.width - box.width)).toBeLessThan(2);
  expect(Math.abs(pane.height - box.height)).toBeLessThan(2);
  // Its top bar: Back, the title and the two buttons.
  await expect(panel(page).getByRole("button", { name: "Menu" })).toBeFocused();
  await expect(panel(page).getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "New entry", exact: true })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "New folder", exact: true })).toBeVisible();
  // The footer is out of the way while the library is open, and the menu is out of reach.
  await expect(drawer(page).getByRole("link", { name: /^Inbox/ })).toBeHidden();
  await expect(drawer(page).getByRole("button", { name: "App menu" })).toBeHidden();
  await noSidewaysScroll(page);
});

test("the Menu button, Escape and the browser's Back each return to the menu", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The drawer is the phone's side bar.");
  await openPanel(page);
  const history = () => page.evaluate(() => window.history.length);
  const opened = await history();

  // The Menu button: the focus goes back to the Library row, and the footer returns.
  await panel(page).getByRole("button", { name: "Menu" }).click();
  await expect(panel(page)).toBeHidden();
  await expect(libraryRow(page)).toBeFocused();
  await expect(drawer(page).getByRole("link", { name: /^Inbox/ })).toBeVisible();

  // Escape from the library goes back to the menu; from the menu it closes the drawer.
  await libraryRow(page).click();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(drawer(page)).toBeVisible();
  await expect(libraryRow(page)).toBeFocused();

  // The browser's Back closes the panel, not the page, and the drawer stays.
  await libraryRow(page).click();
  await expect(panel(page)).toBeVisible();
  await page.goBack();
  await expect(panel(page)).toBeHidden();
  await expect(drawer(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent("Harbor.md")}$`));
  await expect(libraryRow(page)).toBeFocused();

  // None of it left entries behind in the history.
  expect(await history()).toBeLessThanOrEqual(opened);
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
});

test("Back after the panel closed goes to the page before, not to the library", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The drawer is the phone's side bar.");
  await page.goto(entry("README.md"));
  await expect(page.locator(".entry h1").first()).toBeVisible();
  await page.goto(entry(HARBOR));
  await expect(page.locator(".entry h1").first()).toBeVisible();
  await openSideBar(page);
  await libraryRow(page).click();
  await expect(panel(page)).toBeVisible();
  // Closing the whole drawer from the library (Escape, then Escape) takes its entry away too.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/README\.md$/);
});

test("a folder opens and closes, and an entry opens its page and closes the drawer", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The drawer is the phone's side bar.");
  await page.goto(entry("README.md"));
  await expect(page.locator(".entry h1").first()).toBeVisible();
  await openSideBar(page);
  await libraryRow(page).click();
  const people = panel(page).getByRole("treeitem", { name: "02 People", exact: true });
  await expect(people).toBeVisible();
  const before = await panel(page).getByRole("treeitem").count();
  await people.getByText("02 People", { exact: true }).click();
  await expect.poll(() => panel(page).getByRole("treeitem").count()).not.toBe(before);
  await people.getByText("02 People", { exact: true }).click();
  await expect.poll(() => panel(page).getByRole("treeitem").count()).toBe(before);
  const mira = panel(page).getByRole("treeitem", { name: "Mira", exact: true });
  await mira.getByRole("link", { name: "Mira", exact: true }).click();
  await expect(page.locator(".entry h1").first()).toHaveText("Mira");
  await expect(drawer(page)).toHaveCount(0);
  // The tap replaced the library's history entry: one Back is the page before.
  await page.goBack();
  await expect(page).toHaveURL(/README\.md$/);
  await expect(drawer(page)).toHaveCount(0);
});

test("the library opens with the open entry's folder revealed and the entry in sight", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The drawer is the phone's side bar.");
  // The last entry by path sits low in the list, so it is below the first screen.
  const last = (await allEntries(page)).sort((a, b) => a.localeCompare(b)).at(-1)!;
  await openPanel(page, last);
  const active = panel(page).locator(".tree-note.active, .tree-folder.active");
  await expect(active).toBeVisible();
  await expect(active).toBeInViewport();
  // Another entry, in a folder: its row is in sight too.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await openPanel(page, HARBOR);
  await expect(active).toHaveText("Harbor");
  await expect(active).toBeInViewport();
});

test("New entry in the panel starts an entry at the top of the library", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The drawer is the phone's side bar.");
  await openPanel(page);
  await panel(page).getByRole("button", { name: "New entry", exact: true }).click();
  await expect(drawer(page)).toHaveCount(0);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Folder", exact: true })).toHaveText(
    "Top of the library",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("New folder in the panel asks for a name", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The drawer is the phone's side bar.");
  await openPanel(page);
  await panel(page).getByRole("button", { name: "New folder", exact: true }).click();
  // The drawer is a dialog too; the question is the one with a Name field.
  const ask = page.getByRole("dialog").filter({ has: page.getByLabel("Name") });
  await expect(ask).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
});

test("a swipe right from the panel's left edge goes back to the menu; scrolling does not", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The drawer is the phone's side bar.");
  await openPanel(page);
  // Once it has slid in, the drawer's left edge is the screen's, so these are the panel's own.
  await expect.poll(async () => (await panel(page).boundingBox())!.x).toBe(0);
  // A real TouchEvent, as a finger sends it.
  const touch = (type: string, x: number, y: number) =>
    panel(page).evaluate(
      (el, [kind, clientX, clientY]) => {
        const point = new Touch({
          identifier: 1,
          target: el,
          clientX: clientX!,
          clientY: clientY!,
        });
        const list = kind === "touchend" ? [] : [point];
        el.dispatchEvent(
          new TouchEvent(kind as string, {
            bubbles: true,
            touches: list,
            changedTouches: [point],
          }),
        );
      },
      [type, x, y] as const,
    );
  // From the middle of the panel, or mostly downward, nothing happens.
  await touch("touchstart", 150, 300);
  await touch("touchend", 260, 305);
  await expect(panel(page)).toBeVisible();
  await touch("touchstart", 8, 300);
  await touch("touchend", 60, 500);
  await expect(panel(page)).toBeVisible();
  // From the edge, to the right, it goes back.
  await touch("touchstart", 8, 300);
  await touch("touchend", 140, 310);
  await expect(panel(page)).toBeHidden();
  await expect(drawer(page)).toBeVisible();
});

test("closing the drawer from the library resets it to the menu", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The drawer is the phone's side bar.");
  await openPanel(page);
  // The close button is in the menu; Escape twice is the keyboard's way out.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
  await openSideBar(page);
  await expect(panel(page)).toBeHidden();
  await expect(libraryRow(page)).toBeVisible();
  await expect(drawer(page).getByRole("link", { name: /^Inbox/ })).toBeVisible();
});

test("an empty library says so, with a New entry button", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The drawer is the phone's side bar.");
  await page.route("**/api/tree", (route) => route.fulfill({ json: { folders: [], notes: [] } }));
  await openPanel(page);
  await expect(panel(page).getByText("No entries yet.")).toBeVisible();
  await panel(page).getByRole("button", { name: "New entry", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /New entry/ })).toBeVisible();
});

test("a library that cannot be read says why inside the panel, with Retry", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The drawer is the phone's side bar.");
  await page.route("**/api/tree", (route) =>
    route.fulfill({ status: 500, json: { error: "The library could not be read." } }),
  );
  await page.goto(entry("README.md"));
  await openSideBar(page);
  await libraryRow(page).click();
  await expect(panel(page).getByRole("alert")).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Retry" })).toBeVisible();
});

test("on a desktop the left bar is as before: no Library row, the folders and their buttons", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "This is the desktop's side bar.");
  await page.goto(entry(HARBOR));
  const bar = page.locator(".left-bar");
  await expect(bar.locator(".tree")).toBeVisible();
  await expect(bar.getByRole("button", { name: /^Library/ })).toHaveCount(0);
  await expect(bar.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "New entry", exact: true })).toHaveCount(2);
  await expect(bar.getByRole("button", { name: "New folder", exact: true })).toBeVisible();
  await expect(page.locator(".drawer-panes")).toHaveCount(0);
});
