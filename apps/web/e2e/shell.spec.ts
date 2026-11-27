import { expect, type Page, test } from "@playwright/test";
import { discardDraft, entry, noSidewaysScroll, openEditor, saved } from "./helpers.ts";

const side = (page: Page) => page.locator(".side");
/** The library pane, beside the side bar. */
const pane = (page: Page) => page.getByRole("region", { name: "Library" });

test("the side bar folds to a rail that keeps the counts and the connection", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "A phone has a drawer instead of the side bar.");
  // Something unpublished, so there is a count to keep.
  await openEditor(page, "03 Things/Ledger.md");
  await page.keyboard.type("\nA line for the rail.\n");
  await saved(page);
  await page.goto(entry("03 Things/Ledger.md"));

  // No top bar: every place is in the side bar, the rest in its app menu.
  await expect(page.locator(".topbar, .topnav")).toHaveCount(0);
  for (const place of ["Maps", "Chronicles", "Gallery", "Ask", "Inbox"]) {
    await expect(
      side(page)
        .locator(".side-link")
        .filter({ hasText: new RegExp(`^${place}`) }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "App menu" }).click();
  for (const item of [
    "Import",
    "Export",
    "History of the library",
    "Settings",
    "Status",
    "Keyboard shortcuts",
    "Log out",
  ]) {
    await expect(page.getByRole("menuitem", { name: item, exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");

  // Ctrl+\ folds it to the rail, which keeps the counts, the connection and the menu.
  await page.keyboard.press("Control+\\");
  await expect(side(page)).toHaveClass(/is-rail/);
  expect((await side(page).boundingBox())!.width).toBeLessThanOrEqual(49);
  const waiting = side(page).getByRole("link", { name: /^Unpublished/ });
  await expect(waiting.locator(".badge")).toHaveText(/^[1-9]\d*$/);
  await expect(
    side(page)
      .getByRole("link", { name: /^Inbox/ })
      .locator(".badge"),
  ).toBeVisible();
  await expect(side(page).locator(".connection")).toContainText("Connected");
  await expect(side(page).getByRole("button", { name: "App menu" })).toBeVisible();
  // Its icons are named in tooltips.
  await side(page).getByRole("link", { name: /^Maps/ }).hover();
  await expect(page.getByRole("tooltip")).toContainText("Maps");

  // It stays folded on this kind of screen after a reload; unfolded, the folders are back.
  await page.reload();
  await expect(side(page)).toHaveClass(/is-rail/);
  await side(page).getByRole("button", { name: "Unfold the side bar" }).click();
  await expect(pane(page).locator(".tree")).toBeVisible();

  await page.goto("/edit/" + ["03 Things", "Ledger.md"].map(encodeURIComponent).join("/"));
  await discardDraft(page);
});

test("the left side bar has the places, the Library among them and its folders in a pane beside it, and its width is set by dragging or with the keys, and kept", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "A phone has a drawer instead of the side bar.");
  await page.goto(entry("01 Places/Harbor/Harbor.md"));
  await expect(pane(page).locator(".tree")).toBeVisible();
  // The places come first, the Library after them; the folders are not in the side bar.
  const maps = side(page).getByRole("link", { name: /^Maps/ });
  const library = side(page).getByRole("button", { name: /^Library/ });
  expect((await maps.boundingBox())!.y).toBeLessThan((await library.boundingBox())!.y);
  await expect(side(page).locator(".tree")).toHaveCount(0);
  await expect(maps).toBeInViewport();
  // Working on and the footer stay in the side bar, and the pane sits right of it.
  await expect(side(page).getByRole("region", { name: "Working on" })).toBeVisible();
  await expect(side(page).getByRole("button", { name: "App menu" })).toBeVisible();
  const bar = (await side(page).boundingBox())!;
  expect((await pane(page).boundingBox())!.x).toBeGreaterThanOrEqual(bar.x + bar.width - 1);

  const width = async () => (await side(page).boundingBox())!.width;
  const before = await width();

  // Dragging its edge widens it, and the page beside it gives way.
  const splitter = page.getByRole("separator", { name: "Side bar width" });
  const grip = (await splitter.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 100, grip.y + grip.height / 2, { steps: 6 });
  await page.mouse.up();
  const wider = await width();
  expect(wider).toBeGreaterThan(before + 80);
  const text = (await page.locator(".content").boundingBox())!;
  expect(text.x).toBeGreaterThanOrEqual(wider - 1);

  // It is kept on this device, on every kind of screen.
  await page.reload();
  await expect(pane(page).locator(".tree")).toBeVisible();
  expect(Math.abs((await width()) - wider)).toBeLessThan(6);
  await openEditor(page, "01 Places/Harbor/Harbor.md");
  await expect(pane(page).locator(".tree")).toBeVisible();
  expect(Math.abs((await width()) - wider)).toBeLessThan(6);

  // The arrow keys move the edge too; it never gets narrower than its least width.
  await splitter.focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowLeft");
  await expect.poll(width).toBeLessThan(wider - 40);
  expect(await width()).toBeGreaterThanOrEqual(199);

  // Folding still folds it to the rail, and unfolded it has the width it had.
  const narrow = await width();
  await page.keyboard.press("Control+\\");
  await expect(side(page)).toHaveClass(/is-rail/);
  await expect(page.getByRole("separator", { name: "Side bar width" })).toHaveCount(0);
  await side(page).getByRole("button", { name: "Unfold the side bar" }).click();
  await expect(pane(page).locator(".tree")).toBeVisible();
  expect(Math.abs((await width()) - narrow)).toBeLessThan(6);
});

test("the right side bar remembers its tab and its width", async ({ page, isMobile }) => {
  test.skip(isMobile, "A phone has a bottom sheet instead of the right side bar.");
  await openEditor(page, "01 Places/Harbor/Harbor.md");
  await page.getByRole("button", { name: /^Comments/ }).click();
  const bar = page.locator(".right-bar");
  await expect(bar.getByRole("tab", { name: /^Comments/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // The panels sit beside the text, not over it.
  const text = (await page.locator(".content").boundingBox())!;
  const before = (await bar.boundingBox())!;
  expect(text.x + text.width).toBeLessThanOrEqual(before.x + 1);

  // Dragging the splitter widens it.
  const splitter = page.locator(".right-splitter");
  const grip = (await splitter.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 120, grip.y + grip.height / 2, { steps: 6 });
  await page.mouse.up();
  const wider = (await bar.boundingBox())!.width;
  expect(wider).toBeGreaterThan(before.width + 80);

  // Another tab, and both are kept for the editor after a reload.
  await bar.getByRole("tab", { name: "Properties" }).click();
  await page.reload();
  await expect(page.locator(".right-bar").getByRole("tab", { name: "Properties" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(Math.abs((await page.locator(".right-bar").boundingBox())!.width - wider)).toBeLessThan(6);

  // Hidden, it stays hidden.
  await page.getByRole("button", { name: "Hide the panels" }).click();
  await expect(page.locator(".right-bar")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator(".right-bar")).toHaveCount(0);
});

test("on a phone the drawer opens with the places first, keeps the focus, and closes", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The drawer is the phone's side bar.");
  await page.goto(entry("01 Places/Harbor/Harbor.md"));
  // One slim line: the menu, the page's title, and its main action.
  const line = page.locator(".phone-bar");
  await expect(line.locator(".phone-title")).toHaveText("Harbor");
  await expect(line.getByRole("link", { name: "Edit" })).toBeVisible();
  expect((await line.boundingBox())!.height).toBeLessThanOrEqual(56);

  const menu = page.getByRole("button", { name: "Open the side bar" });
  await menu.click();
  const drawer = page.getByRole("dialog", { name: "Side bar" });
  await expect(drawer).toBeVisible();
  // The places come first, and the library is a row after them (its folders are in its panel).
  const maps = (await drawer.getByRole("link", { name: /^Maps/ }).boundingBox())!;
  const library = (await drawer.getByRole("button", { name: /^Library/ }).boundingBox())!;
  expect(maps.y).toBeLessThan(library.y);
  await expect(drawer.getByRole("link", { name: /^Inbox/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "App menu" })).toBeVisible();

  // Tab goes round inside the drawer.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    expect(await drawer.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  // Escape closes it, and the focus goes back to the menu button.
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(menu).toBeFocused();

  // A place chosen in it opens, and the drawer closes.
  await menu.click();
  await drawer.locator(".side-link", { hasText: "Gallery" }).click();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(drawer).toHaveCount(0);
  await expect(line.locator(".phone-title")).toHaveText("Gallery");
  await noSidewaysScroll(page);
});

test("on a phone the panels open as a bottom sheet above the toolbar, and close", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The bottom sheet is the phone's right side bar.");
  await openEditor(page, "01 Places/Harbor/Harbor.md");
  // Done is on the top line.
  await expect(page.locator(".phone-bar").getByRole("button", { name: "Done" })).toBeVisible();
  const opener = page.getByRole("button", { name: "Properties", exact: true });
  await opener.click();
  const sheet = page.locator(".bottom-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("tab", { name: "Properties" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    sheet.locator(".props-field", { hasText: "Other names" }).locator("input"),
  ).toHaveValue("The Port, Greywater");
  // It stops above the editor's toolbar, which stays in reach.
  const toolbar = (await page.locator(".edit-toolbar").boundingBox())!;
  // Measured once it has slid in.
  await expect
    .poll(async () => {
      const box = (await sheet.boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(toolbar.y + 1);
  await expect(page.getByRole("button", { name: "Bold" })).toBeInViewport();

  // Another tab; then Escape closes the sheet and the focus goes back.
  await sheet.getByRole("tab", { name: /^Comments/ }).click();
  await expect(sheet.getByRole("tab", { name: /^Comments/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await sheet.getByRole("tab", { name: /^Comments/ }).focus();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();

  // The sheet's own button closes it too.
  await opener.click();
  await sheet.getByRole("button", { name: "Hide the panel" }).click();
  await expect(sheet).toHaveCount(0);
  await noSidewaysScroll(page);
});

test("CUJ 6: with the server out of reach the mark says so, and the page does not go blank", async ({
  page,
  context,
}) => {
  await page.goto(entry("01 Places/Harbor/Harbor.md"));
  await expect(page.locator(".prose")).toContainText("A town on the grey water.");
  await context.setOffline(true);
  await page.locator(".prose").getByRole("link", { name: "Old Quay" }).click();

  // The mark says "Not connected", with Retry; the next page, not on this device, says so.
  const mark = page.locator(".connection.is-offline").first();
  await expect(mark).toContainText("Not connected", { timeout: 15_000 });
  await expect(page.locator(".not-on-device")).toContainText(
    "Old Quay is not on this device. It opens when you are connected.",
  );
  await expect(page.locator(".content")).not.toBeEmpty();

  // Once connected, it opens by itself.
  await context.setOffline(false);
  await expect(page.locator(".entry h1").first()).toHaveText("Old Quay", { timeout: 15_000 });
  await expect(page.locator(".connection.is-offline")).toHaveCount(0, { timeout: 15_000 });
});

test("writes that go straight to the server wait for a connection, and say so", async ({
  page,
  context,
}) => {
  await openEditor(page, "03 Things/Scalar.md");
  await context.setOffline(true);
  await page.keyboard.type("\nTyped with no connection.\n");
  await expect(page.locator(".save-offline")).toBeVisible({ timeout: 15_000 });

  // Comments and images need the server: their buttons refuse, and say why. On a phone they are
  // in the toolbar's "⋯", where the items say so beside them.
  const comment = page.getByRole("button", { name: "Comment", exact: true });
  if (await comment.isVisible()) {
    await expect(comment).toBeDisabled();
    await comment.hover();
    await expect(page.getByRole("tooltip")).toContainText("Needs a connection");
    await expect(page.getByRole("button", { name: "Add an image" })).toBeDisabled();
  } else {
    // Where the bar has room for the things to insert but not for Comment (a desktop beside the
    // side bar, now that Help keeps its name on the bar), the image button is on the bar.
    const image = page.locator(".edit-toolbar").getByRole("button", { name: "Add an image" });
    const imageOnBar = await image.isVisible();
    if (imageOnBar) await expect(image).toBeDisabled();
    await page.getByRole("button", { name: "More tools" }).click();
    const item = page.getByRole("menuitem", { name: /^Comment/ });
    await expect(item).toBeDisabled();
    await expect(item).toContainText("Needs a connection");
    if (!imageOnBar)
      await expect(page.getByRole("menuitem", { name: /^Add an image/ })).toBeDisabled();
    await page.keyboard.press("Escape");
  }

  await context.setOffline(false);
  await expect(page.locator(".save-saved")).toBeVisible({ timeout: 15_000 });
  if (await comment.isVisible()) await expect(comment).toBeEnabled({ timeout: 15_000 });
  else {
    await page.getByRole("button", { name: "More tools" }).click();
    await expect(page.getByRole("menuitem", { name: /^Comment/ })).toBeEnabled({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");
  }
  await discardDraft(page);
});
