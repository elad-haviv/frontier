import { expect, test as setup } from "@playwright/test";
import { AUTH_FILE, PASSWORD } from "./helpers.ts";

/**
 * Logs in once and keeps the session for every other test. The server allows five login attempts
 * per 15 minutes, so the tests must not log in one by one.
 */
setup("log in", async ({ page }) => {
  await page.goto("/");
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await expect(page.locator(".home h1")).toBeVisible();
  // The tests run as an iPhone in Safari: the card about the Home Screen, shown once, was seen.
  await page.evaluate(() => localStorage.setItem("frontier.installNotice", "1"));
  await page.context().storageState({ path: AUTH_FILE });
});
