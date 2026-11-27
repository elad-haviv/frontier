import { expect, type Locator, type Page, test } from "./test.ts";
import { api, entry, onMain, openEditor, openLibrary, publish, review, saved } from "./helpers.ts";

/** The tree's row for a folder or an entry, by its name. */
const row = (page: Page, name: string): Locator =>
  page.getByRole("treeitem", { name, exact: true });

/** Opens a folder's menu: a right-click on a desktop, its "⋯" on a phone. */
async function folderMenu(page: Page, name: string, isMobile: boolean): Promise<Locator> {
  if (isMobile) await page.getByRole("button", { name: `More for ${name}`, exact: true }).click();
  else await row(page, name).locator(".tree-row").click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens an entry and shows the tree: in the side bar, or in the drawer on a phone. */
async function openTree(page: Page, path = "README.md"): Promise<void> {
  await roomForTree(page);
  await page.goto(entry(path));
  await expect(page.locator(".entry h1").first()).toBeVisible();
  await openLibrary(page);
  await expect(page.getByRole("tree")).toBeVisible();
  await treeSettled(page);
}

/**
 * On a desktop, a taller window: the folders sit below the places and scroll on their own, and a
 * drag is surest when the rows it starts and ends on are both in sight.
 */
async function roomForTree(page: Page): Promise<void> {
  const size = page.viewportSize();
  if (size && size.width >= 768) await page.setViewportSize({ width: size.width, height: 1200 });
}

/**
 * Waits until the folders have stopped scrolling: they scroll on their own below the places, and
 * bring the entry in view into sight once it opens. A drag started before that misses its row.
 */
async function treeSettled(page: Page): Promise<void> {
  const at = () =>
    page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const box = document.querySelector(".left-scroll");
          const before = box?.scrollTop ?? 0;
          setTimeout(() => resolve((box?.scrollTop ?? 0) === before), 250);
        }),
    );
  await expect.poll(at).toBe(true);
}

/** Waits until the server holds the folder file with `text` in it, sent by the save queue. */
async function sent(page: Page, text: string): Promise<void> {
  await expect
    .poll(
      async () =>
        JSON.stringify((await (await page.request.get(api("/library-files/folders"))).json()).file),
      { timeout: 15_000 },
    )
    .toContain(text);
}

/** Throws away every unpublished change, so the next test starts from the library. */
async function discardAll(page: Page): Promise<void> {
  const un = await (await page.request.get(api("/unpublished"))).json();
  for (const r of un.renames) await page.request.delete(api(`/renames/${r.id}`));
  for (const d of un.drafts) await page.request.delete(api(`/drafts/${d.id}`));
}

test("CUJ 1: makes a folder, styles it, fills it, and saves it as a version", async ({
  page,
  isMobile,
}, info) => {
  const name = `Islands ${info.project.name}`;
  const path = `01 Places/${name}`;
  await openTree(page, "01 Places/Unwritten.md");
  await (
    await folderMenu(page, "01 Places", isMobile)
  )
    .getByRole("menuitem", { name: "New subfolder" })
    .click();
  const ask = page.getByRole("dialog");
  await ask.getByLabel("Name").fill(name);
  await ask.getByRole("button", { name: "Make the folder" }).click();

  // The empty folder appears at once, marked unpublished.
  const islands = row(page, name);
  await expect(islands).toBeVisible();
  await expect(islands.locator(".tree-mark")).toHaveText("empty");
  await expect(islands.locator(".tree-folder")).toHaveClass(/is-draft/);

  // The waves icon, the sea colour and the type place.
  await (
    await folderMenu(page, name, isMobile)
  )
    .getByRole("menuitem", { name: "Icon, colour and type…" })
    .click();
  const settings = page.getByRole("dialog", { name });
  await settings.getByRole("button", { name: "waves", exact: true }).click();
  await settings.getByRole("button", { name: "sea", exact: true }).click();
  await settings.getByLabel("Type of new entries").selectOption("place");
  await expect(settings.getByRole("button", { name: "sea", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(islands.locator(".tree-icon")).toHaveClass(/folder-tint-sea/);
  await sent(page, `"path":"${path}","icon":"waves","color":"sea","type":"place"`);

  // It is still there after a reload.
  await page.reload();
  await expect(page.locator(".entry h1").first()).toBeVisible();
  await openLibrary(page);
  await expect(row(page, name).locator(".tree-icon")).toHaveClass(/folder-tint-sea/);
  await expect(row(page, name).locator(".tree-mark")).toHaveText("empty");

  // "+" beside it makes an entry there, with the folder's type in its properties.
  await row(page, name).hover();
  await page.getByRole("button", { name: `New entry in ${name}`, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Folder", exact: true })).toHaveText(path);
  await dialog.getByLabel("Name").fill("Rock");
  await dialog.getByRole("button", { name: "Make the entry", exact: true }).click();
  await expect(page).toHaveURL(/\/edit\/.*Rock\.md/);
  // The properties are folded to one line in the editor; the type is in them.
  await expect(page.locator(".cm-content")).toContainText("Properties: type");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("A rock in the sea.");
  await saved(page);

  // Saved as a version: the folder, its icon, colour and type are in the history.
  await review(page);
  await publish(page, `Add ${name}`);
  const folders = onMain(".frontier/folders.json") ?? "";
  expect(folders).toContain(`{"path":"${path}","icon":"waves","color":"sea","type":"place"}`);
  expect(onMain(`${path}/Rock.md`)).toContain("type: place");
});

test("CUJ 2: moves a folder with its entries, and Undo puts it back", async ({
  page,
  isMobile,
}) => {
  await openTree(page, "README.md");
  if (isMobile) {
    // On touch, "Move to…" takes the place of dragging.
    await (
      await folderMenu(page, "Harbor", isMobile)
    )
      .getByRole("menuitem", { name: "Move to…" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Move Harbor" });
    await dialog.getByRole("combobox", { name: "Into" }).click();
    await page.getByPlaceholder("Find a folder").fill("02 People");
    await page.getByRole("option", { name: "02 People", exact: true }).click();
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
  } else {
    await row(page, "Harbor").dragTo(row(page, "02 People"));
  }
  await expect(page.locator(".ui-toast")).toContainText(
    /Moved 2 entries; links in \d+ other entr(y|ies) will be updated when you save a version/,
  );

  // The tree shows it in its new place, marked; its settings wait for the version.
  const moved = page.locator('[role="treeitem"][aria-level="2"]', { hasText: "Harbor" });
  await expect(moved.locator(".tree-mark")).toHaveText("moved");
  const people = row(page, "02 People");
  const peopleTop = (await people.boundingBox())!.y;
  expect((await moved.boundingBox())!.y).toBeGreaterThan(peopleTop);
  await expect(page.locator(".ui-toast")).toBeVisible();
  await page.locator(".ui-toast").getByRole("button", { name: "Undo" }).click();

  // Back where it was, and nothing waits to be saved.
  await expect(page.locator(".tree-mark", { hasText: "moved" })).toHaveCount(0);
  const un = await (await page.request.get(api("/unpublished"))).json();
  expect(un.renames).toEqual([]);
  await expect(row(page, "Harbor")).toBeVisible();
  expect((await row(page, "Harbor").boundingBox())!.y).toBeLessThan(
    (await row(page, "02 People").boundingBox())!.y,
  );
  await discardAll(page);
});

test("a moved folder's entries open where they are, and its settings wait for a version", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "The same on a phone; the move itself is tested there in CUJ 2.");
  await roomForTree(page);
  await page.goto(entry("README.md"));
  await expect(page.locator(".entry h1").first()).toBeVisible();
  await treeSettled(page);
  await row(page, "Marsh").dragTo(row(page, "02 People"));
  await expect(page.locator(".ui-toast")).toContainText("Moved 1 entry");
  await expect(row(page, "Marsh").locator(".tree-mark")).toHaveText("moved");
  const menu = await folderMenu(page, "Marsh", false);
  await expect(menu.getByRole("menuitem", { name: /Icon, colour and type/ })).toHaveAttribute(
    "data-disabled",
    "",
  );
  await expect(menu.getByRole("menuitem", { name: /New subfolder/ })).toContainText(
    "Save a version first",
  );
  await page.keyboard.press("Escape");
  // Its entry is listed under 02 People and opens at its old path until the version is saved.
  await row(page, "Marsh").locator(".twist").click();
  await row(page, "The Marsh").getByRole("link").click();
  await expect(page).toHaveURL(/\/e\/01%20Places\/Marsh\/The%20Marsh\.md$/);
  await expect(page.locator(".entry h1").first()).toHaveText("The Marsh");
  await discardAll(page);
});

test("a folder reordered by dragging keeps its place after a reload", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Dragging is for a mouse; on touch, folders move with Move to….");
  await roomForTree(page);
  await page.goto(entry("README.md"));
  await expect(row(page, "03 Things")).toBeVisible();
  await expect(page.locator(".entry h1").first()).toBeVisible();
  await treeSettled(page);
  const top = () =>
    page
      .locator('[role="treeitem"][aria-level="1"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  expect((await top()).slice(0, 3)).toEqual(["01 Places", "02 People", "03 Things"]);
  // The library grows as the other tests run, so with the folders open the two rows can be too far
  // apart to be in sight together. Folded, the three sit one under the other.
  for (const name of ["01 Places", "02 People", "03 Things"]) {
    const folder = row(page, name);
    if ((await folder.getAttribute("aria-expanded")) === "true") {
      await folder.locator(".twist").first().click();
    }
  }
  await expect(row(page, "01 Places")).toHaveAttribute("aria-expanded", "false");
  // Dropped on the top edge of 01 Places, 03 Things goes before it.
  const target = row(page, "01 Places").locator(".tree-row");
  await row(page, "03 Things").dragTo(target, { targetPosition: { x: 60, y: 2 } });
  await expect
    .poll(async () => (await top()).slice(0, 3))
    .toEqual(["03 Things", "01 Places", "02 People"]);
  await sent(page, `"path":"03 Things","order"`);
  await page.reload();
  await expect(row(page, "03 Things")).toBeVisible();
  expect((await top()).slice(0, 3)).toEqual(["03 Things", "01 Places", "02 People"]);
  await discardAll(page);
});

test("CUJ 7: a folder with an unpublished change is not deleted; then it is, until discarded", async ({
  page,
}) => {
  await openEditor(page, "02 People/Mira.md");
  await page.keyboard.type("\nA change not yet saved.\n");
  await saved(page);
  await openTree(page, "README.md");
  const isMobile = (page.viewportSize()?.width ?? 1000) < 768;
  await (
    await folderMenu(page, "02 People", isMobile)
  )
    .getByRole("menuitem", { name: "Delete…" })
    .click();
  await expect(page.locator(".ui-toast")).toHaveText(
    /1 entry here has unpublished changes\. Save a version or discard them first\./,
  );
  await expect(row(page, "02 People")).toBeVisible();

  // Once the change is discarded, Delete asks with the counts, and marks them for deletion.
  await discardAll(page);
  await page.reload();
  await expect(page.locator(".entry h1").first()).toBeVisible();
  await openLibrary(page);
  await (
    await folderMenu(page, "02 People", isMobile)
  )
    .getByRole("menuitem", { name: "Delete…" })
    .click();
  // Earlier tests may have added entries to 02 People, so the count is read from the question.
  const ask = page.getByRole("dialog", { name: /^Delete 02 People and its \d+ entries\?$/ });
  await expect(ask).toBeVisible();
  const count = Number(
    /its (\d+) entries/.exec((await ask.getByRole("heading").textContent()) ?? "")![1],
  );
  expect(count).toBeGreaterThanOrEqual(3);
  await ask.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row(page, "02 People")).toHaveCount(0);
  const un = await (await page.request.get(api("/unpublished"))).json();
  expect(un.drafts.filter((d: { kind: string }) => d.kind === "delete")).toHaveLength(count);

  // Discard in the unpublished list takes it back.
  await discardAll(page);
  await page.reload();
  await expect(page.locator(".entry h1").first()).toBeVisible();
  await openLibrary(page);
  await expect(row(page, "02 People")).toBeVisible();
});

test("moves through the tree with arrow keys and renames a folder with F2", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Keys are for a keyboard; a phone uses the menu.");
  await page.goto(entry("README.md"));
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  const ask = page.getByRole("dialog");
  await ask.getByLabel("Name").fill("Keys");
  await ask.getByRole("button", { name: "Make the folder" }).click();
  await expect(row(page, "Keys")).toBeVisible();

  await row(page, "01 Places").locator(".tree-icon").click();
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  await expect.poll(focused).toBe("01 Places");
  // Left closes the folder, Down goes to the next one, Right opens it.
  await page.keyboard.press("ArrowLeft");
  await expect(row(page, "01 Places")).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowDown");
  await expect.poll(focused).toBe("02 People");
  await page.keyboard.press("ArrowLeft");
  await expect(row(page, "02 People")).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight");
  await expect(row(page, "02 People")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect.poll(focused).toBe("Mira");
  // Enter opens the entry.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/e\/02%20People\/Mira\.md$/);

  // F2 renames the empty folder in place.
  await row(page, "Keys").locator(".tree-icon").click();
  await expect.poll(focused).toBe("Keys");
  await page.keyboard.press("F2");
  const field = page.getByRole("textbox", { name: "New name for Keys" });
  await expect(field).toBeFocused();
  await field.fill("Keys Renamed");
  await page.keyboard.press("Enter");
  await expect(row(page, "Keys Renamed")).toBeVisible();
  await expect(row(page, "Keys")).toHaveCount(0);
  await sent(page, `"path":"Keys Renamed"`);
  await discardAll(page);
});

test("a long press on a folder opens its menu", async ({ page, isMobile }) => {
  test.skip(!isMobile, "A long press is for touch.");
  await openTree(page, "README.md");
  const target = row(page, "03 Things").locator(".tree-row");
  const box = (await target.boundingBox())!;
  const at = { clientX: box.x + 40, clientY: box.y + box.height / 2 };
  await target.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 1,
    isPrimary: true,
    button: 0,
    ...at,
  });
  await page.waitForTimeout(900);
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  for (const item of ["New entry here", "New subfolder", "Rename", "Move to…", "Delete…"]) {
    await expect(menu.getByRole("menuitem", { name: new RegExp(`^${item}`) })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("New entry beside New folder starts an entry at the top of the library", async ({
  page,
  isMobile,
}) => {
  // In view is an entry in a folder; the side bar's own New entry would start there.
  await openTree(page, "01 Places/Harbor/Harbor.md");
  // Beside the library's heading in the side bar; in the library panel's top bar on a phone.
  const library = isMobile
    ? page.getByRole("region", { name: "Library" })
    : page.locator(".left-tree");
  const button = library.getByRole("button", { name: "New entry", exact: true });
  if (!isMobile) {
    await button.hover();
    await expect(page.getByRole("tooltip")).toHaveText("New entry");
  }
  await button.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Folder", exact: true })).toHaveText(
    "Top of the library",
  );
  await dialog.getByLabel("Name").fill("Lighthouse Keepers");
  await dialog.getByRole("button", { name: "Make the entry", exact: true }).click();
  await expect(page).toHaveURL(/\/edit\/Lighthouse%20Keepers\.md\?new=1$/);
  await expect(page.locator(".editor-path")).toHaveText("Lighthouse Keepers");
});
