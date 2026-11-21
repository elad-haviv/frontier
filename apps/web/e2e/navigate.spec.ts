import { expect, test } from "@playwright/test";
import { commitCount, entry, noSidewaysScroll, onMain, publish } from "./helpers.ts";

test("jumps to an entry by name or alias with the switcher", async ({ page }) => {
  await page.goto(entry("README.md"));
  await page.locator(".find").click();
  const box = page.locator(".switcher");
  await expect(box).toBeVisible();
  await box.locator("input").fill("greyw");
  await expect(box.locator("li button").first()).toContainText("Greywater");
  await page.keyboard.press("Enter");
  await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
  await expect(box).toHaveCount(0);

  // Ctrl+K opens it, Escape closes it, and appendix notes are not offered.
  await page.keyboard.press("Control+k");
  await box.locator("input").fill("session");
  await expect(box.locator(".switcher-empty")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  await noSidewaysScroll(page);
});

test("CUJ 3: renames an entry and rewrites the links to it in one commit", async ({ page }) => {
  const before = commitCount();
  await page.goto(entry("03 Things/Lantern.md"));
  await page.locator(".edit-link.subtle").click();
  await expect(page.locator(".entry h1").first()).toHaveText("Rename or move");
  // Renaming to itself is not offered.
  await expect(page.locator("button.big")).toBeDisabled();
  await page.locator(".field input").first().fill("Storm Lantern");
  await expect(page.locator("code")).toHaveText("03 Things/Storm Lantern.md");
  await page.locator("button.big").click();

  await expect(page.locator(".changes > li")).toContainText(
    "03 Things/Lantern.md → 03 Things/Storm Lantern.md",
  );
  await expect(page.locator(".changes > li")).toContainText("Links in 2 notes will be rewritten");
  expect(commitCount()).toBe(before);

  await page.locator("button.big").click();
  await expect(page.locator(".plan")).toBeVisible();
  await publish(page, "Rename Lantern to Storm Lantern");
  expect(commitCount()).toBe(before + 1);
  expect(onMain("03 Things/Lantern.md")).toBeNull();
  expect(onMain("03 Things/Storm Lantern.md")).toContain("# Lantern");
  expect(onMain("02 People/Twin.md")).toContain("[[Storm Lantern]]");
  expect(onMain("03 Things/Ledger.md")).toContain("[[Storm Lantern]]");
});

test("refuses a rename onto an existing entry, and one in an append-only folder", async ({
  page,
}) => {
  await page.goto("/rename/" + ["02 People", "Mira.md"].map(encodeURIComponent).join("/"));
  await page.locator(".field input").first().fill("Shade");
  await page.locator("button.big").click();
  await expect(page.locator(".banner")).toContainText("already exists");
  await page.goto(entry("99 Appendices/Logs/Session.md"));
  await expect(page.locator(".edit-link")).toHaveCount(0);
});
