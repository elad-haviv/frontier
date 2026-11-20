import { expect, test } from "@playwright/test";
import {
  changeFromOutside,
  commitCount,
  entry,
  lastMessage,
  onMain,
  openEditor,
  publish,
  review,
  saved,
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
  page.on("dialog", (d) => void d.accept(d.type() === "prompt" ? "Saltmother" : undefined));
  await page.goto(entry("01 Places/Unwritten.md"));
  await page.locator(".menu").click();
  await page.locator(".new-entry").click();
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
  page.once("dialog", (d) => void d.accept());
  await page.locator("button.quiet", { hasText: "Discard" }).click();
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
  page.once("dialog", (d) => void d.accept());
  await page.locator("button.quiet", { hasText: "Discard" }).click();
});

test("deletes an entry through a draft and a publish", async ({ page }) => {
  await openEditor(page, "03 Things/Empty.md");
  page.once("dialog", (d) => void d.accept());
  await page.locator("button.quiet", { hasText: "Delete" }).click();
  await expect(page.locator(".tag-delete")).toBeVisible();
  await page.locator("button.big").click();
  await expect(page.locator(".plan")).toBeVisible();
  await publish(page, "Remove Empty");
  expect(onMain("03 Things/Empty.md")).toBeNull();
});
