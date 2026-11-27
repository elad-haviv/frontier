import { expect, type Locator, type Page, test } from "./test.ts";
import { api, edit, entry, openEditor, openSideBar, proj, rightPanel, saved } from "./helpers.ts";

// Stage 28: on a desktop the library is a pane beside the side bar, opened from a Library place in
// the side bar (or the rail), docked on a wide window and floating over the page on a narrow one.

const HARBOR = "01 Places/Harbor/Harbor.md";

type Folder = { notes: { path: string }[]; folders: Folder[] };

/** How many entries the library holds, from the server's tree. */
async function entryCount(page: Page): Promise<number> {
  const tree = (await (await page.request.get(api("/tree"))).json()) as Folder;
  const walk = (f: Folder): number => f.notes.length + f.folders.reduce((n, g) => n + walk(g), 0);
  return walk(tree);
}

const side = (page: Page) => page.locator(".side");
const pane = (page: Page) => page.getByRole("region", { name: "Library" });
const toggle = (page: Page) => page.locator("[data-library-toggle]");
const row = (page: Page, name: string): Locator =>
  page.getByRole("treeitem", { name, exact: true });
/** The page's left edge, which moves when the pane pushes it. */
const contentLeft = async (page: Page) => (await page.locator(".content").boundingBox())!.x;

async function open(page: Page, path = HARBOR): Promise<void> {
  await page.goto(entry(path));
  await expect(page.locator(".entry h1").first()).toBeVisible();
}

/** Throws away every unpublished change, so the next test starts from the library. */
async function discardAll(page: Page): Promise<void> {
  const un = await (await page.request.get(api("/unpublished"))).json();
  for (const r of un.renames) await page.request.delete(api(`/renames/${r.id}`));
  for (const d of un.drafts) await page.request.delete(api(`/drafts/${d.id}`));
}

test.beforeEach(({ isMobile }, info) => {
  if (isMobile) {
    test.skip(!info.title.startsWith("on a phone"), "The pane is the desktop's.");
  } else {
    test.skip(info.title.startsWith("on a phone"), "This is the phone's.");
  }
});

test("the side bar has a Library row with the number of entries, and the folders are not in it", async ({
  page,
}) => {
  await open(page);
  const count = await entryCount(page);
  const row = side(page).getByRole("button", { name: /^Library/ });
  await expect(row).toHaveAccessibleName(`Library, ${count} entries`);
  await expect(row).toContainText(String(count));
  await expect(row).toHaveAttribute("aria-pressed", "true");
  // After Ask, in the places; Working on and the footer stay below.
  const ask = (await side(page).getByRole("link", { name: /^Ask/ }).boundingBox())!;
  const box = (await row.boundingBox())!;
  expect(box.y).toBeGreaterThan(ask.y);
  expect(box.height).toBeGreaterThanOrEqual(36);
  await expect(side(page).locator(".tree")).toHaveCount(0);
  await expect(side(page).getByRole("region", { name: "Working on" })).toBeVisible();
  await expect(side(page).getByRole("button", { name: "App menu" })).toBeVisible();
  await row.hover();
  await expect(page.getByRole("tooltip")).toContainText("Library");
  await expect(page.getByRole("tooltip")).toContainText("G then L");
});

test("the pane opens docked at 1280 and pushes the page, × closes it and the page widens back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  // Open the first time: nothing was chosen on this device.
  await expect(pane(page)).toBeVisible();
  await expect(pane(page).locator(".tree")).toBeVisible();
  await expect(pane(page)).not.toHaveClass(/is-floating/);
  const bar = (await side(page).boundingBox())!;
  const box = (await pane(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(bar.x + bar.width - 1);
  expect(box.width).toBeCloseTo(272, -1);
  expect(box.height).toBeGreaterThanOrEqual(790);
  const docked = await contentLeft(page);
  expect(docked).toBeGreaterThanOrEqual(box.x + box.width - 1);

  // Its top bar: the title, the two buttons and the close button, each at least 2.25rem.
  await expect(pane(page).getByRole("heading", { name: "Library" })).toBeVisible();
  for (const name of ["New entry", "New folder", "Close Library"]) {
    const button = pane(page).getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const size = (await button.boundingBox())!;
    expect(size.width).toBeGreaterThanOrEqual(36);
    expect(size.height).toBeGreaterThanOrEqual(36);
  }

  await pane(page).getByRole("button", { name: "Close Library" }).click();
  await expect(pane(page)).toHaveCount(0);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(toggle(page)).toBeFocused();
  expect(docked - (await contentLeft(page))).toBeCloseTo(272, -1);

  // Clicking the Library place brings it back, with the focus in the pane.
  await toggle(page).click();
  await expect(pane(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => pane(page).evaluate((p) => p.contains(document.activeElement)))
    .toBe(true);
  expect(await contentLeft(page)).toBe(docked);
  // And clicking it again closes it, the focus staying on the place.
  await toggle(page).click();
  await expect(pane(page)).toHaveCount(0);
  await expect(toggle(page)).toBeFocused();
});

test("open or closed is remembered on the device, and an entry picked keeps a docked pane open", async ({
  page,
}) => {
  await open(page);
  await expect(pane(page)).toBeVisible();
  // Picking an entry leaves it open, the folder of the entry still open and the entry marked.
  await row(page, "Salt Road").getByRole("link").click();
  await expect(page).toHaveURL(/Salt%20Road\.md$/);
  await expect(page.locator(".entry h1").first()).toHaveText("Salt Road");
  await expect(pane(page)).toBeVisible();
  await expect(row(page, "Salt Road").locator(".tree-note")).toHaveClass(/active/);
  await page.reload();
  await expect(pane(page)).toBeVisible();

  await toggle(page).click();
  await expect(pane(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".entry h1").first()).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(pane(page)).toHaveCount(0);
  // Closed, it stays closed through a move to another page.
  await page.goto(proj("/maps"));
  await expect(side(page)).toBeVisible();
  await expect(pane(page)).toHaveCount(0);
  await toggle(page).click();
  await expect(pane(page)).toBeVisible();
  await page.reload();
  await expect(pane(page)).toBeVisible();
});

test("on a window under 1100 px the pane floats over the page and closes when an entry is picked", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await open(page);
  // A floating pane is closed on every visit.
  await expect(pane(page)).toHaveCount(0);
  const closedLeft = await contentLeft(page);

  await toggle(page).click();
  await expect(pane(page)).toBeVisible();
  await expect(pane(page)).toHaveClass(/is-floating/);
  // (It slides in a little, so its place is read once it has settled.)
  const bar = (await side(page).boundingBox())!;
  await expect
    .poll(async () => (await pane(page).boundingBox())!.x)
    .toBeGreaterThanOrEqual(bar.x + bar.width - 1);
  // It floats: the page stays where it was, under a dimming.
  expect(await contentLeft(page)).toBe(closedLeft);
  await expect(page.locator(".library-scrim")).toBeVisible();
  expect(await pane(page).evaluate((p) => getComputedStyle(p).boxShadow)).not.toBe("none");

  // An entry picked opens it and closes the pane.
  await row(page, "Salt Road").getByRole("link").click();
  await expect(page).toHaveURL(/Salt%20Road\.md$/);
  await expect(pane(page)).toHaveCount(0);
  await expect(page.locator(".library-scrim")).toHaveCount(0);

  // Escape closes it, and the focus goes back to the Library place.
  await toggle(page).click();
  await expect(pane(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pane(page)).toHaveCount(0);
  await expect(toggle(page)).toBeFocused();

  // So does a click on the dimmed page, and that click does nothing else.
  await toggle(page).click();
  await expect(pane(page)).toBeVisible();
  await page.mouse.click(900, 500);
  await expect(pane(page)).toHaveCount(0);
  await expect(page).toHaveURL(/Salt%20Road\.md$/);

  // Under 1100 the choice made on a wide window is not touched: a wider window has it as it was.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(pane(page)).toBeVisible();
  await expect(pane(page)).not.toHaveClass(/is-floating/);
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(pane(page)).toHaveCount(0);
});

test("a rename's Escape keeps the floating pane open", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await open(page);
  await toggle(page).click();
  await expect(pane(page)).toBeVisible();
  await row(page, "02 People").locator(".tree-icon").click();
  await page.keyboard.press("F2");
  await expect(pane(page).locator("[data-own-escape]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pane(page).locator("[data-own-escape]")).toHaveCount(0);
  await expect(pane(page)).toBeVisible();
});

test("the folded side bar's rail has a Library icon that opens and closes the pane", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("Control+\\");
  await expect(side(page)).toHaveClass(/is-rail/);
  const icon = side(page).getByRole("button", { name: "Library", exact: true });
  await expect(icon).toHaveAttribute("aria-pressed", "true");
  await expect(pane(page)).toBeVisible();
  const railBox = (await side(page).boundingBox())!;
  expect((await pane(page).boundingBox())!.x).toBeGreaterThanOrEqual(railBox.x + railBox.width - 1);
  await icon.click();
  await expect(pane(page)).toHaveCount(0);
  await expect(icon).toHaveAttribute("aria-pressed", "false");
  await expect(icon).toBeFocused();
  await icon.click();
  await expect(pane(page)).toBeVisible();
  await expect
    .poll(() => pane(page).evaluate((p) => p.contains(document.activeElement)))
    .toBe(true);
});

test("g l toggles the pane, moving the focus into the tree and back to the Library place", async ({
  page,
}) => {
  await open(page);
  await expect(pane(page)).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("l");
  await expect(pane(page)).toHaveCount(0);
  await expect(toggle(page)).toBeFocused();

  await page.keyboard.press("g");
  await page.keyboard.press("l");
  await expect(pane(page)).toBeVisible();
  // The focus is on the entry in view, in the tree.
  await expect(row(page, "Harbor")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("role")))
    .toBe("treeitem");
  await expect(pane(page).locator(".tree-note.active, .tree-folder.active")).toBeVisible();
  await expect(
    pane(page).locator('[role="treeitem"]', {
      has: page.locator(".tree-note.active, .tree-folder.active"),
    }),
  ).toBeFocused();
  // The arrow keys go on from it.
  const label = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  const at = await label();
  await page.keyboard.press("ArrowDown");
  await expect.poll(label).not.toBe(at);
  // It is in the list of keys.
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog")).toContainText("Show or hide the Library");
  await page.keyboard.press("Escape");
  // Typing "g l" in a field does nothing.
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.keyboard.type("gl");
  await page.keyboard.press("Escape");
  await expect(pane(page)).toBeVisible();
});

test("an empty library says so in the pane, with a New entry button", async ({ page }) => {
  await page.route("**/api/p/*/tree", (route) =>
    route.fulfill({ json: { folders: [], notes: [] } }),
  );
  await open(page);
  await expect(pane(page).getByText("No entries yet.")).toBeVisible();
  await expect(pane(page).getByRole("button", { name: "New entry", exact: true })).toHaveCount(1);
  await expect(pane(page).getByRole("button", { name: "New folder", exact: true })).toHaveCount(0);
  await expect(side(page).getByRole("button", { name: "Library, 0 entries" })).toBeVisible();
  await pane(page).getByRole("button", { name: "New entry", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Name")).toBeVisible();
});

test("a library that cannot be read shows the problem and a retry in the pane", async ({
  page,
}) => {
  await page.route("**/api/p/*/tree", (route) =>
    route.fulfill({ status: 500, json: { error: "The library could not be read." } }),
  );
  await open(page);
  await expect(pane(page).getByRole("alert")).toBeVisible();
  await expect(pane(page).getByRole("button", { name: "Retry" })).toBeVisible();
});

test("the tree in the pane still moves a folder by dragging", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await open(page, "README.md");
  await expect(pane(page).locator(".tree")).toBeVisible();
  await row(page, "Marsh").dragTo(row(page, "02 People"));
  await expect(page.locator(".ui-toast")).toContainText("Moved 1 entry");
  await expect(row(page, "Marsh").locator(".tree-mark")).toHaveText("moved");
  await discardAll(page);
});

test("showing a folder from Home opens a closed pane at that folder", async ({ page }) => {
  await open(page);
  await toggle(page).click();
  await expect(pane(page)).toHaveCount(0);
  await page.goto(proj("/"));
  await expect(page.locator(".home h1")).toBeVisible();
  await expect(pane(page)).toHaveCount(0);
  await page
    .locator(".home")
    .getByRole("region", { name: "Folders" })
    .getByRole("button", { name: "01 Places" })
    .click();
  await expect(pane(page)).toBeVisible();
  const folder = pane(page).locator('.tree-row[data-path="01 Places"]');
  await expect(folder).toBeVisible();
  await expect(folder).toBeInViewport();
});

test("on a phone there is no Library pane, and the Library row of the drawer still opens its panel", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator(".library-pane")).toHaveCount(0);
  await expect(toggle(page)).toHaveCount(0);
  await openSideBar(page);
  const drawer = page.getByRole("dialog", { name: "Side bar" });
  await drawer.getByRole("button", { name: /^Library/ }).click();
  await expect(pane(page)).toBeVisible();
  await expect(pane(page).getByRole("tree")).toBeVisible();
  await expect(page.locator(".library-pane")).toHaveCount(0);
});

// The focus goes into the pane once, when the author opens it. A tree that loads again, a library
// that stops being empty or a window that widens never take it from the page.
const inEditor = (page: Page) =>
  page.evaluate(() => !!document.activeElement?.closest(".cm-content"));

test("a tree that comes back after a failure does not take the focus from the editor", async ({
  page,
}) => {
  let failing = true;
  await page.route("**/api/p/*/tree", (route) =>
    failing
      ? route.fulfill({ status: 500, json: { error: "The library could not be read." } })
      : route.fallback(),
  );
  await page.goto(edit(HARBOR));
  await expect(pane(page).getByRole("button", { name: "Retry" })).toBeVisible();
  // The author closes the pane and opens it by a click: the focus goes in, once.
  await toggle(page).click();
  await expect(pane(page)).toHaveCount(0);
  await toggle(page).click();
  await expect(pane(page).getByRole("button", { name: "Retry" })).toBeFocused();
  // Back in the editor, the connection returns and the next save loads the tree again.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  failing = false;
  await page.keyboard.type("\nA line while the tree was away.\n");
  await saved(page);
  await expect(pane(page).locator(".tree")).toBeVisible();
  await page.waitForTimeout(400);
  expect(await inEditor(page)).toBe(true);
  await page.keyboard.type("more");
  await expect(page.locator(".cm-content")).toContainText("more");
  await discardAll(page);
});

test("the first entry saved in an empty library does not take the focus from the editor", async ({
  page,
}) => {
  let empty = true;
  await page.route("**/api/p/*/tree", (route) =>
    empty ? route.fulfill({ json: { folders: [], notes: [] } }) : route.fallback(),
  );
  await page.goto(edit(HARBOR));
  await expect(pane(page).getByText("No entries yet.")).toBeVisible();
  await toggle(page).click();
  await expect(pane(page)).toHaveCount(0);
  await toggle(page).click();
  await expect(pane(page).getByRole("button", { name: "New entry", exact: true })).toBeFocused();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  empty = false;
  await page.keyboard.type("\nThe first line.\n");
  await saved(page);
  await expect(pane(page).locator(".tree")).toBeVisible();
  await page.waitForTimeout(400);
  expect(await inEditor(page)).toBe(true);
  await discardAll(page);
});

test("widening the window to dock the pane again does not take the focus from the editor", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(edit(HARBOR));
  await expect(page.locator(".cm-content")).toBeVisible();
  await toggle(page).click();
  await expect(pane(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pane(page)).toHaveCount(0);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(pane(page)).toBeVisible();
  await expect(pane(page)).not.toHaveClass(/is-floating/);
  await expect(pane(page).locator(".tree")).toBeVisible();
  await page.waitForTimeout(400);
  expect(await inEditor(page)).toBe(true);
});

// The pane docks only where the page keeps room beside it.
test("with a wide side bar and the right bar open the pane floats, the page keeping its width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(edit(HARBOR));
  // The right bar is opened and remembered by the page's own control; the side bar is widest.
  await rightPanel(page, "Properties");
  await page.evaluate(() => localStorage.setItem("frontier.shell.left", "480"));
  await page.reload();
  await expect(page.getByRole("tabpanel")).toBeVisible();
  // Floating pane: closed on every visit, then opened by the Library place.
  await expect(pane(page)).toHaveCount(0);
  const before = (await page.locator(".content").boundingBox())!;
  await toggle(page).click();
  await expect(pane(page)).toBeVisible();
  await expect(pane(page)).toHaveClass(/is-floating/);
  expect((await page.locator(".content").boundingBox())!.width).toBe(before.width);
});

test("the pane switches between docked and floating as the side bar is resized, staying open", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openEditor(page, HARBOR);
  await expect(pane(page)).toBeVisible();
  await expect(pane(page)).not.toHaveClass(/is-floating/);
  expect((await page.locator(".content").boundingBox())!.width).toBeGreaterThanOrEqual(560);
  const grip = page.getByRole("separator", { name: "Side bar width" });
  await grip.focus();
  await page.keyboard.press("End");
  // Too little room for the pane beside a fair page: it floats, so it is not drawn over the page
  // as the bar is dragged; the choice stays, and the focus is unmoved.
  await expect(pane(page)).toHaveCount(0);
  await expect(grip).toBeFocused();
  // The Library place opens it floating, over the page, which keeps its width.
  const narrow = (await page.locator(".content").boundingBox())!.width;
  await toggle(page).click();
  await expect(pane(page)).toHaveClass(/is-floating/);
  expect((await page.locator(".content").boundingBox())!.width).toBe(narrow);
  await page.keyboard.press("Escape");
  await expect(pane(page)).toHaveCount(0);
  await grip.focus();
  await page.keyboard.press("Home");
  // Room again: the pane is docked as the device left it, and the focus is still on the grip.
  await expect(pane(page)).toBeVisible();
  await expect(pane(page)).not.toHaveClass(/is-floating/);
  await expect(grip).toBeFocused();
  expect((await page.locator(".content").boundingBox())!.width).toBeGreaterThanOrEqual(560);
});

test("the pane is not open on a first visit to a map, a chronicle or the graph, and keeps its own choice for each kind", async ({
  page,
}) => {
  await page.goto(proj("/graph"));
  await expect(toggle(page)).toBeVisible();
  await expect(pane(page)).toHaveCount(0);
  await page.goto(proj("/map/nosuchmap"));
  await expect(toggle(page)).toBeVisible();
  await expect(pane(page)).toHaveCount(0);
  await page.goto(proj("/chronicle/nosuchchronicle"));
  await expect(toggle(page)).toBeVisible();
  await expect(pane(page)).toHaveCount(0);
  // Entries still start with it open.
  await open(page);
  await expect(pane(page)).toBeVisible();
  // Opening it on the graph is remembered for the graph only.
  await page.goto(proj("/graph"));
  await toggle(page).click();
  await expect(pane(page)).toBeVisible();
  await page.reload();
  await expect(pane(page)).toBeVisible();
  await page.goto(proj("/map/nosuchmap"));
  await expect(toggle(page)).toBeVisible();
  await expect(pane(page)).toHaveCount(0);
  await open(page);
  await expect(pane(page)).toBeVisible();
  // Closing it on an entry leaves the graph's choice alone.
  await toggle(page).click();
  await expect(pane(page)).toHaveCount(0);
  await page.goto(proj("/graph"));
  await expect(pane(page)).toBeVisible();
});

test("a choice kept before the pane was kept per kind is the default for entries", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.clear();
      localStorage.setItem("frontier.shell.library", "closed");
    }
  });
  await open(page);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(pane(page)).toHaveCount(0);
});

test("Escape in a dialog, a context menu or the switcher leaves a floating pane open", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await open(page);
  await toggle(page).click();
  await expect(pane(page)).toBeVisible();
  await expect(pane(page)).toHaveClass(/is-floating/);

  await pane(page).getByRole("button", { name: "New entry", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(pane(page)).toBeVisible();

  await row(page, "02 People").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(pane(page)).toBeVisible();

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(pane(page)).toBeVisible();

  // With nothing else open, Escape closes it.
  await page.keyboard.press("Escape");
  await expect(pane(page)).toHaveCount(0);
});
