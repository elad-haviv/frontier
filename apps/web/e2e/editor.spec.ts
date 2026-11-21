import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import {
  discardDraft,
  edit,
  entry,
  onMain,
  openEditor,
  publish,
  REMOTE,
  review,
  saved,
} from "./helpers.ts";

test("adds an image from the toolbar, shows it before publishing, then publishes it", async ({
  page,
}) => {
  const png = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 120, b: 40 } },
  })
    .png()
    .toBuffer();
  await openEditor(page, "03 Things/Ledger.md");
  await page.keyboard.type("\n");
  await page
    .locator(".edit-toolbar-file input")
    .setInputFiles({ name: "Ledger cover.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".cm-content")).toContainText("![[Ledger cover.png]]");
  await saved(page);

  await page.locator("button.primary").click();
  const shown = page.locator('.prose img[alt*="Ledger cover"]');
  await expect(shown).toBeVisible();
  expect(await shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await page.goto("/unpublished");
  await expect(page.locator(".change-image")).toBeVisible();
  await review(page);
  await publish(page, "Add the ledger cover");
  expect(onMain("03 Things/Ledger.md")).toContain("![[Ledger cover.png]]");
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", "main"], {
    cwd: REMOTE,
    encoding: "utf8",
  });
  expect(files).toContain("Ledger cover.png");
});

test("live preview hides marks away from the cursor and leaves the text as written", async ({
  page,
}) => {
  await openEditor(page, "02 People/Mira.md");
  await page.keyboard.type("\nShe keeps the **old** [[Harbor|quay]] lamp.\n\nLast line.");
  const line = page.locator(".cm-line", { hasText: "She keeps the" });
  await expect(line).toHaveText("She keeps the old quay lamp.");
  await expect(line.locator(".cm-lp-link")).toHaveText("quay");

  // On the line itself the marks come back.
  await line.click();
  await expect(line).toContainText("**old** [[Harbor|quay]]");

  // Switched off, every line shows its source.
  await page.keyboard.press("Control+End");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(line).toContainText("**old** [[Harbor|quay]]");
  await saved(page);
  await page.goto(entry("02 People/Mira.md"));
  await expect(page.locator(".prose")).toContainText("She keeps the old quay lamp.");
  await page.goto(edit("02 People/Mira.md"));
  await discardDraft(page);
});

test("the properties panel writes other names into the frontmatter only", async ({ page }) => {
  await openEditor(page, "03 Things/Ledger.md");
  const before = await page.locator(".cm-content").innerText();
  await page.locator(".props summary").click();
  const field = page.locator(".props-field", { hasText: "Other names" }).locator("input");
  await field.fill("The Grey Book, Tally");
  await field.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("aliases:");
  await expect(page.locator(".cm-content")).toContainText("- The Grey Book");
  await expect(page.locator(".cm-content")).toContainText("- Tally");
  await saved(page);
  // Clearing the field removes the key again and nothing else.
  await field.fill("");
  await field.press("Enter");
  await expect(page.locator(".cm-content")).not.toContainText("The Grey Book");
  expect(
    (await page.locator(".cm-content").innerText()).trim().endsWith(before.trim().slice(-40)),
  ).toBe(true);
  await saved(page);
  await discardDraft(page);
});

test("Tab moves between the cells of a table", async ({ page }) => {
  await openEditor(page, "02 People/Mira.md");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.keyboard.type("\n| a | b |\n| - | - |\n|  |  |");
  // To the start of the last row, then cell by cell.
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  await page.keyboard.type("one");
  await page.keyboard.press("Tab");
  await page.keyboard.type("two");
  await expect(page.locator(".cm-content")).toContainText("| one | two |");
  await saved(page);
  await discardDraft(page);
});
