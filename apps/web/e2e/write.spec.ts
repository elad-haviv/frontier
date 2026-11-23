import { expect, type Page, test } from "@playwright/test";
import {
  answerDialog,
  AUTH_FILE,
  changeFromOutside,
  commitCount,
  discardDraft,
  edit,
  entry,
  lastMessage,
  newEntry,
  onMain,
  openEditor,
  openMenu,
  publish,
  review,
  saved,
  pressTool,
} from "./helpers.ts";

test("CUJ 1: write, leave, come back, publish as one commit", async ({ page, context }) => {
  const before = commitCount();
  await openEditor(page, "02 People/Mira.md");
  await page.keyboard.type("\nA line typed in the browser test.\n");
  await saved(page);
  // Saving a draft makes no commit.
  expect(commitCount()).toBe(before);

  // The tab is closed without pressing Done; the draft is on the server.
  await page.close();
  const later = await context.newPage();
  await later.goto(entry("02 People/Mira.md"));
  await expect(later.locator(".draft-note")).toBeVisible();
  await expect(later.locator(".prose")).toContainText("A line typed in the browser test.");

  await review(later);
  await publish(later, "Add a line about Mira");
  expect(commitCount()).toBe(before + 1);
  expect(lastMessage()).toBe("Add a line about Mira");
  expect(onMain("02 People/Mira.md")).toContain("A line typed in the browser test.");
  await later.goto(entry("02 People/Mira.md"));
  await expect(later.locator(".draft-note")).toHaveCount(0);
});

test("creates a new entry whose links resolve before it is published", async ({ page }) => {
  await page.goto(entry("01 Places/Unwritten.md"));
  await newEntry(page, "01 Places", "Saltmother");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("A village by the [[Harbor]].\n");
  await saved(page);
  await page.locator("button.primary").click();
  await expect(page.locator(".draft-note")).toContainText("A new entry");
  await expect(page.locator(".prose a.link-resolved")).toHaveText("Harbor");

  await review(page);
  await publish(page, "Add Saltmother");
  expect(onMain("01 Places/Saltmother.md")).toContain("A village by the [[Harbor]].");
  // The link that waited for this entry now resolves.
  await page.goto(entry("01 Places/Unwritten.md"));
  await expect(page.locator(".prose a.link-resolved", { hasText: "Saltmother" })).toBeVisible();
});

test("offers entry names after [[ and writes an alias the way Obsidian does", async ({ page }) => {
  await openEditor(page, "03 Things/Ledger.md");
  await page.keyboard.type("\nSee [[grey");
  const option = page.locator(".cm-tooltip-autocomplete li", { hasText: "Greywater" });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator(".cm-content")).toContainText("See [[Harbor|Greywater]]");
  await page.keyboard.type(" and [[twi");
  await page.locator(".cm-tooltip-autocomplete li").first().click();
  // Two notes are called Twin, so the link is written with its path.
  await expect(page.locator(".cm-content")).toContainText("[[02 People/Twin]]");
  await saved(page);
  await discardDraft(page);
  await expect(page.locator(".entry h1").first()).toHaveText("Ledger");
  await expect(page.locator(".draft-note")).toHaveCount(0);
});

test("keeps Windows line endings and changes only the edited line", async ({ page }) => {
  const before = onMain("03 Things/Rope.md")!;
  await openEditor(page, "03 Things/Rope.md");
  await page.keyboard.type("A new last line.");
  await saved(page);
  await review(page);
  await publish(page, "Add a line to Rope");
  const after = onMain("03 Things/Rope.md")!;
  expect(after).toBe(before + "A new last line.");
  expect(after.split("\r\n").length).toBe(before.split("\r\n").length);
});

test("CUJ 4: a change elsewhere in the file is combined only after it is confirmed", async ({
  page,
}) => {
  await openEditor(page, "02 People/Shade.md");
  await page.keyboard.type("\nMy line at the end.\n");
  await saved(page);
  changeFromOutside("02 People/Shade.md", (t) => t.replace("# Shade", "# Shade the Quiet"));

  await review(page);
  await expect(page.locator(".plan .diff")).toContainText("My line at the end.");
  await page.fill(".field input", "Add a line to Shade");
  // Publish stays off until the combined text is ticked.
  await expect(page.locator(".plan button.big")).toBeDisabled();
  await page.locator(".plan .changes input[type=checkbox]").check();
  await page.locator(".plan button.big").click();
  await expect(page.locator(".banner-ok")).toBeVisible({ timeout: 20_000 });
  const text = onMain("02 People/Shade.md")!;
  expect(text).toContain("# Shade the Quiet");
  expect(text).toContain("My line at the end.");
});

test("CUJ 4: an overlapping change is held back and resolved by hand", async ({ page }) => {
  await openEditor(page, "03 Things/Plain.md");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  await page.keyboard.type(" (mine)");
  await saved(page);
  changeFromOutside("03 Things/Plain.md", (t) => t.replace("# Plain", "# Plain (theirs)"));

  await review(page);
  await expect(page.locator(".plan .error")).toContainText("changed the same lines");
  await page.locator(".plan a", { hasText: "Resolve" }).click();
  await expect(page.locator(".diff")).toContainText("# Plain (theirs)");
  await page.locator("button", { hasText: "Save as resolved" }).click();
  await review(page);
  await publish(page, "Resolve Plain");
  expect(onMain("03 Things/Plain.md")).toContain("# Plain (mine)");
});

test("keeps text typed while the server cannot be reached, and sends it afterwards", async ({
  page,
  context,
}) => {
  await openEditor(page, "01 Places/Marsh/The Marsh.md");
  await context.setOffline(true);
  await page.keyboard.type("\nTyped with no connection.\n");
  await expect(page.locator(".save-offline")).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator(".save-saved")).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("Typed with no connection.");
  await discardDraft(page);
});

test("keeps unsent text across a reload, and sends it once the server takes it", async ({
  page,
}) => {
  await openEditor(page, "01 Places/Marsh/The Marsh.md");
  // The server cannot be reached for saves: they fail as with no connection.
  await page.route("**/api/drafts", (route) => route.abort("internetdisconnected"));
  await page.keyboard.type("\nTyped while saves could not get through.\n");
  await expect(page.locator(".save-offline")).toHaveText("Unsent: kept on this device", {
    timeout: 15_000,
  });
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText(
    "Typed while saves could not get through.",
  );
  await expect(page.locator(".save-offline")).toBeVisible({ timeout: 15_000 });
  // The unsent list names the file.
  await page.locator(".unsent-count").click();
  await expect(page.locator(".unsent")).toContainText("The Marsh");
  await page.keyboard.press("Escape");

  await page.unroute("**/api/drafts");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+s");
  await expect(page.locator(".save-saved")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".unsent-count")).toHaveCount(0);
  await page.goto(entry("01 Places/Marsh/The Marsh.md"));
  await expect(page.locator(".prose")).toContainText("Typed while saves could not get through.");
  await page.goto(edit("01 Places/Marsh/The Marsh.md"));
  await discardDraft(page);
});

test("moves text kept by an earlier build into the queue, and sends it", async ({ page }) => {
  const path = "03 Things/Scalar.md";
  await page.goto(entry(path));
  await page.evaluate((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        id: "olddraft0001",
        text: "# Scalar\n\nKept by the old buffer.\n",
        revision: 0,
      }),
    );
  }, `frontier:draft:${path}`);
  await page.goto(edit(path));
  await expect(page.locator(".cm-content")).toContainText("Kept by the old buffer.");
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith("frontier:draft:")),
    ),
  ).toEqual([]);
  await saved(page);
  await page.goto(entry(path));
  await expect(page.locator(".prose")).toContainText("Kept by the old buffer.");
  await page.goto(edit(path));
  await discardDraft(page);
});

/** Opens a second browser, logged in, as another device would be. */
async function device(browser: import("@playwright/test").Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: AUTH_FILE });
  return context.newPage();
}

test("CUJ 3: two devices, one entry: the late text is kept to compare, and nothing is lost", async ({
  browser,
}) => {
  const path = "02 People/Twin.md";
  const phone = await device(browser);
  const laptop = await device(browser);

  // On the phone: a first line is saved, then the connection drops while more is typed.
  await openEditor(phone, path);
  await phone.keyboard.type("\nA line from the phone.\n");
  await saved(phone);
  await phone.route("**/api/drafts", (route) => route.abort("internetdisconnected"));
  await phone.keyboard.type("Typed on the train, unsent.\n");
  await expect(phone.locator(".save-offline")).toBeVisible({ timeout: 15_000 });

  // At home: the laptop edits the same entry and saves a version.
  await openEditor(laptop, path);
  await expect(laptop.locator(".cm-content")).toContainText("A line from the phone.");
  await laptop.keyboard.type("Written at home.\n");
  await saved(laptop);
  await review(laptop);
  await publish(laptop, "Twin, from home");
  expect(onMain(path)).toContain("Written at home.");
  await laptop.goto(entry(path));

  // The phone gets a connection again.
  await phone.unroute("**/api/drafts");
  await phone.locator(".cm-content").click();
  await phone.keyboard.press("Control+s");
  await expect(phone.locator(".save-stale")).toHaveText("Two texts to compare", {
    timeout: 15_000,
  });
  // The library was not built on the phone's older text.
  expect(onMain(path)).toContain("Written at home.");

  // The laptop's count rises without a reload, and leads to both texts.
  const compare = laptop.getByRole("link", { name: /^Compare/ });
  await expect(compare).toBeVisible({ timeout: 15_000 });
  await compare.click();
  await laptop.getByRole("link", { name: path, exact: true }).click();
  await expect(laptop.locator("h1")).toHaveText("Two texts to compare");
  await expect(laptop.locator(".diff")).toContainText("Typed on the train, unsent.");
  await expect(laptop.locator(".diff")).toContainText("Written at home.");
  await laptop.getByRole("button", { name: "Keep this one" }).click();
  await expect(laptop.locator(".changes")).toBeVisible();
  await expect(compare).toHaveCount(0, { timeout: 15_000 });

  // What the phone typed is in the draft now; it is thrown away so other tests start clean.
  await laptop.goto(entry(path));
  await expect(laptop.locator(".prose")).toContainText("Typed on the train, unsent.");
  await laptop.goto(edit(path));
  await discardDraft(laptop);
  await phone.context().close();
  await laptop.context().close();
});

test("deletes an entry through a draft and a publish", async ({ page }) => {
  await openEditor(page, "03 Things/Empty.md");
  await openMenu(page, "More actions");
  await page.getByRole("menuitem", { name: "Delete entry" }).click();
  await answerDialog(page, "Delete");
  await expect(page.locator(".tag-delete")).toBeVisible();
  await page.locator("button.big").click();
  await expect(page.locator(".plan")).toBeVisible();
  await publish(page, "Remove Empty");
  expect(onMain("03 Things/Empty.md")).toBeNull();
});

test("the toolbar inserts a link, a heading and bold without leaving the editor", async ({
  page,
}) => {
  await openEditor(page, "03 Things/Scalar.md");
  await page.keyboard.type("\nplain");
  await page.getByRole("button", { name: "Style: Paragraph" }).click();
  await page.getByRole("menuitem", { name: /^Heading 2/ }).click();
  await expect(page.locator(".cm-content")).toContainText("## plain");
  await expect(page.locator(".cm-content")).toBeFocused();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n");
  await pressTool(page, "Link to an entry");
  await page.getByPlaceholder("Find an entry").fill("mir");
  await page.getByRole("option", { name: "Mira" }).click();
  await expect(page.locator(".cm-content")).toContainText("[[Mira]]");
  // Typing "[[" still offers names, too.
  await page.keyboard.type(" and [[mir");
  await page.locator(".cm-tooltip-autocomplete li", { hasText: "Mira" }).click();
  await expect(page.locator(".cm-content")).toContainText("[[Mira]] and [[Mira]]");
  await pressTool(page, "Undo");
  await saved(page);
  await discardDraft(page);
});

test("tapping a link to an entry that is not written offers to write it, beside the note that holds it", async ({
  page,
}) => {
  await page.goto(entry("01 Places/Unwritten.md"));
  await page.getByRole("button", { name: "The Drowned Bell" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("is not written yet");
  await expect(dialog).toContainText("01 Places/The Drowned Bell.md");
  await answerDialog(page, "Write it");
  await expect(page).toHaveURL(/\/edit\/.*Drowned%20Bell\.md\?new=1/);
  await expect(page.locator(".cm-content")).toContainText("# The Drowned Bell");

  // Declining stays on the page and makes nothing.
  await page.goto(entry("01 Places/Unwritten.md"));
  await page.getByRole("button", { name: "The Drowned Bell" }).first().click();
  await answerDialog(page, "Cancel");
  await expect(page).toHaveURL(/\/e\/.*Unwritten\.md/);
  // Escape leaves the box too.
  await page.getByRole("button", { name: "The Drowned Bell" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
