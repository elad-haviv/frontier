import { expect, test } from "@playwright/test";
import { commitCount, entry, onMain, publish, review } from "./helpers.ts";

test("imports a note, saves it, changes it, and restores the first version from its history", async ({
  page,
}, info) => {
  const who = info.project.name;
  const name = `Tidewatch ${who}`;
  const path = `01 Places/${name}.md`;
  const before = commitCount();

  await page.goto("/import");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: `${name}.md`,
      mimeType: "text/markdown",
      buffer: Buffer.from(`# ${name}\n\nThe first telling.\n`),
    });
  await page.getByLabel("Folder for the notes").fill("01 Places");
  await page.getByRole("button", { name: /^Import 1 file/ }).click();
  await expect(page.locator(".import-result")).toContainText("1 imported");
  // Importing saves nothing yet.
  expect(commitCount()).toBe(before);
  await review(page);
  await publish(page, `Import ${name}`);
  expect(onMain(path)).toContain("The first telling.");

  // Importing the same name again asks first, then replaces as a change to read.
  await page.goto("/import");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: `${name}.md`,
      mimeType: "text/markdown",
      buffer: Buffer.from(`# ${name}\n\nThe second telling.\n`),
    });
  await page.getByLabel("Folder for the notes").fill("01 Places");
  await page.getByRole("button", { name: /^Import 1 file/ }).click();
  await expect(page.locator(".import-result")).toContainText("A note of this name exists");
  await page.getByRole("button", { name: "Replace with the imported text" }).click();
  await expect(page.locator(".import-result")).toContainText("1 imported");
  await review(page);
  await publish(page, `Retell ${name}`);

  // The history lists both versions; the first can be brought back.
  await page.goto(entry(path));
  await expect(page.locator(".prose")).toContainText("The second telling.");
  await page.getByRole("link", { name: "History" }).click();
  const rows = page.locator(".versions > li");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(`Retell ${name}`);
  await rows.nth(1).locator("summary").click();
  await expect(rows.nth(1).locator(".diff")).toContainText("The first telling.");
  await rows.nth(1).getByRole("button", { name: "Restore this version" }).click();
  await expect(page.locator(".prose")).toContainText("The first telling.");
  await expect(page.locator(".draft-note")).toBeVisible();
  await review(page);
  await publish(page, `Bring back the first telling (${who})`);
  expect(onMain(path)).toContain("The first telling.");

  // The whole library's versions, and the export.
  await page.goto("/versions");
  await expect(page.locator(".versions > li").first()).toContainText(
    "Bring back the first telling",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export the library as a zip" }).click();
  expect((await download).suggestedFilename()).toMatch(/^library-\d{4}-\d{2}-\d{2}\.zip$/);
});
