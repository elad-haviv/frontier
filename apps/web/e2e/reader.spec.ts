import { expect, test } from "@playwright/test";
import { entry, noSidewaysScroll } from "./helpers.ts";

test("refuses the wrong password", async ({ browser }) => {
  // A fresh browser with no session.
  const page = await (
    await browser.newContext({ storageState: { cookies: [], origins: [] } })
  ).newPage();
  await page.goto("/");
  await page.fill("#password", "not the password");
  await page.click("button[type=submit]");
  await expect(page.locator(".login-card .error")).toHaveText("Wrong password.");
});

test("shows an entry with its links, and follows one", async ({ page }) => {
  await page.goto(entry("01 Places/Harbor/Old Quay.md"));
  await expect(page.locator(".entry h1").first()).toHaveText("Old Quay");
  // Links inside code are text, not links.
  await expect(page.locator(".prose code").first()).toHaveText("[[Harbor]]");
  await page.locator(".prose a.link-resolved").first().click();
  await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
  await expect(page.locator(".chip").first()).toHaveText("The Port");
  await expect(page.locator(".backlinks")).toContainText("Old Quay");
  await noSidewaysScroll(page);
});

test("marks entries not written yet, ambiguous links and files outside the notes", async ({
  page,
}) => {
  await page.goto(entry("01 Places/Unwritten.md"));
  await expect(page.locator(".link-unresolved").first()).toHaveText("The Drowned Bell");
  await page.goto(entry("03 Things/Twin.md"));
  await expect(page.locator(".link-ambiguous")).toHaveText("Twin");
  await page.goto(entry("02 People/Mira.md"));
  await expect(page.locator(".link-outside")).toHaveCount(1);
});

test("shows images, a missing image as a missing link, and opens the lightbox", async ({
  page,
}) => {
  await page.goto(entry("03 Things/Gallery.md"));
  const figures = page.locator(".prose .figure");
  await expect(figures.first()).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".prose img")
        .evaluateAll(
          (imgs) => imgs.filter((i) => (i as HTMLImageElement).naturalWidth === 0).length,
        ),
    )
    .toBe(0);
  await expect(page.locator(".prose .link-unresolved")).toHaveCount(2);

  await figures.first().click();
  const box = page.locator(".lightbox");
  await expect(box).toBeVisible();
  await expect(box.locator(".lightbox-caption")).toContainText("photo.png");
  await page.keyboard.press("ArrowRight");
  await expect(box.locator(".lightbox-count")).toContainText("2 /");
  await box.locator(".lightbox-stage img").click();
  await expect(box).toHaveClass(/is-zoomed/);
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
});

test("marks read-only files and offers no Edit for them", async ({ page }) => {
  await page.goto(entry("99 Appendices/Logs/Session.md"));
  await expect(page.locator(".chip-quiet")).toHaveText("read-only");
  await expect(page.locator(".edit-link")).toHaveCount(0);
  await page.goto(entry("03 Things/Knot.md"));
  await expect(page.locator(".edit-link")).toHaveCount(0);
});

test("lists what needs attention on the status page", async ({ page }) => {
  await page.goto("/status");
  await expect(page.locator(".facts")).toBeVisible();
  await expect(
    page.locator(".attention").filter({ hasText: "mix two kinds of line endings" }),
  ).toContainText("Knot.md");
  await noSidewaysScroll(page);
});

test("opens the folder list and finds an entry in it", async ({ page, isMobile }) => {
  await page.goto(entry("README.md"));
  if (isMobile) await page.locator(".menu").click();
  await page.locator(".tree-folder", { hasText: "Harbor" }).click();
  await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
});
