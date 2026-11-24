import { expect, test } from "@playwright/test";
import { edit, entry, noSidewaysScroll, openMenu, openSideBar, pushToMain } from "./helpers.ts";

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

test("CUJ 1: says where the reader is in a long entry, and goes to a heading from the outline", async ({
  page,
}, info) => {
  const who = info.project.name;
  const name = `Tidewater ${who}`;
  const path = `01 Places/${name}.md`;
  const sections = [
    "Founding",
    "Streets",
    "Tides",
    "Boats",
    "Markets",
    "Bells",
    "Storms",
    "Lamps",
    "Graves",
    "Songs",
  ];
  const words = "Grey water against the stones of the quay, and nets left to dry. ".repeat(12);
  const text = `# ${name}\n\n${sections.map((s) => `## ${s}\n\n${words}\n\n${words}\n`).join("\n")}`;
  pushToMain({ [path]: text }, `Add ${name}`);
  // Opening the inbox fetches the vault, which brings the entry.
  await page.goto("/inbox");
  await expect
    .poll(async () =>
      (await page.request.get(`/api/entries?path=${encodeURIComponent(path)}`)).status(),
    )
    .toBe(200);
  await page.goto(entry(path));
  await expect(page.locator(".entry h1").first()).toHaveText(name);

  // Scrolled to the seventh section, the title has gone and the line says where the reader is.
  await page
    .locator(".prose h2", { hasText: "Storms" })
    .evaluate((h) => h.scrollIntoView({ block: "start" }));
  const phone = who === "phone";
  if (phone) {
    await expect(page.locator(".phone-title-text")).toHaveText(`${name} › Storms`);
    await page.locator(".phone-bar").getByRole("button", { name: "Outline" }).click();
  } else {
    const line = page.locator(".sticky-line");
    await expect(line).toHaveClass(/is-shown/);
    await expect(line.locator(".sticky-folder")).toHaveText("01 Places");
    await expect(line.locator(".sticky-name")).toHaveText(name);
    await expect(line.locator(".sticky-heading")).toHaveText("Storms");
    await line.getByRole("button", { name: "Outline" }).click();
  }
  const outline = page.getByRole("navigation", { name: "Outline" });
  await expect(outline.locator('[aria-current="location"]')).toHaveText("Storms");

  // Choosing the third heading goes there, and the line follows.
  await outline.getByRole("button", { name: "Tides" }).click();
  await expect(page.locator(".prose h2", { hasText: "Tides" })).toBeInViewport();
  if (phone) {
    await expect(page.locator(".phone-title-text")).toHaveText(`${name} › Tides`);
  } else {
    const line = page.locator(".sticky-line");
    await expect(line.locator(".sticky-heading")).toHaveText("Tides");
    await expect(outline.locator('[aria-current="location"]')).toHaveText("Tides");
    // Full width, remembered on the device, widens the page; the switch turns it back.
    const article = page.locator("article.entry");
    // The measure widens; with the side bar open the page may be narrower than either.
    const measure = () => article.evaluate((a) => parseFloat(getComputedStyle(a).maxWidth));
    const narrow = await measure();
    await line.getByRole("button", { name: "Full width" }).click();
    await expect(article).toHaveClass(/is-wide/);
    expect(await measure()).toBeGreaterThan(narrow);
    await line.getByRole("button", { name: "Full width" }).click();
    await expect(article).not.toHaveClass(/is-wide/);
    // The folder opens the side bar's tree there.
    await line.locator(".sticky-folder").click();
    await expect(page.locator('.tree-row[data-path="01 Places"]')).toBeInViewport();
  }
  await noSidewaysScroll(page);
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

test("opens the folder list and finds an entry in it", async ({ page }) => {
  await page.goto(entry("README.md"));
  await openSideBar(page);
  await page
    .getByRole("treeitem", { name: "Harbor", exact: true })
    .getByRole("link", { name: "Harbor", exact: true })
    .click();
  await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
});

test("the entry's actions are icons at the top right, with Edit a pencil", async ({
  page,
  isMobile,
}) => {
  await page.goto(entry("01 Places/Harbor/Harbor.md"));
  await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
  // Nothing beside the title now: the actions moved to the top of the page.
  await expect(page.locator(".title-row").getByRole("button")).toHaveCount(0);
  await expect(page.locator(".title-row").getByRole("link")).toHaveCount(0);

  if (isMobile) {
    // On a phone: Edit and "⋯" in the top line, beside the title.
    const line = page.locator(".phone-bar");
    await expect(line.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
    await openMenu(page, "More actions");
    for (const item of ["Outline", "Graph", "Rename", "Move to…", "History", "Export"]) {
      await expect(page.getByRole("menuitem", { name: item, exact: true })).toBeVisible();
    }
    await page.getByRole("menuitem", { name: "History", exact: true }).click();
    await expect(
      page.locator(".bottom-sheet").getByRole("tab", { name: "History" }),
    ).toHaveAttribute("aria-selected", "true");
    return;
  }

  // On a desktop: each action an icon in the bar at the top right, named in its tooltip.
  const bar = page.getByRole("toolbar", { name: "Entry actions" });
  const barBox = (await bar.boundingBox())!;
  const titleBox = (await page.locator(".entry h1").first().boundingBox())!;
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(titleBox.y);
  for (const name of [
    "Outline",
    "Graph",
    "Full width",
    "Rename",
    "Move to…",
    "History",
    "Export",
  ]) {
    await expect(bar.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "More actions", exact: true })).toHaveCount(0);
  const pencil = bar.getByRole("link", { name: "Edit", exact: true });
  await expect(pencil).toHaveText("");
  await expect(pencil.locator("svg")).toBeVisible();
  await pencil.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Edit");
  await bar.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator(".right-bar").getByRole("tab", { name: "History" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Hide the panels" }).click();

  // Narrow, the less used ones go behind "⋯"; Outline, Graph and Edit stay.
  await page.setViewportSize({ width: 820, height: 800 });
  await expect(bar.getByRole("button", { name: "Rename", exact: true })).toBeHidden();
  for (const name of ["Outline", "Graph"]) {
    await expect(bar.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(pencil).toBeVisible();
  await openMenu(page, "More actions");
  for (const item of ["Rename", "Move to…", "History", "Export"]) {
    await expect(page.getByRole("menuitem", { name: item, exact: true })).toBeVisible();
  }
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "New name for Harbor" })).toBeFocused();
  await page.keyboard.press("Escape");
  await noSidewaysScroll(page);

  // The pencil opens the editor.
  await pencil.click();
  await expect(page).toHaveURL(edit("01 Places/Harbor/Harbor.md"));
});
