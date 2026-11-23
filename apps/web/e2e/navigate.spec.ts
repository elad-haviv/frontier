import { expect, test } from "@playwright/test";
import { commitCount, entry, noSidewaysScroll, onMain, openMenu, publish } from "./helpers.ts";

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
  // The pencil beside the title turns it into a field; Enter renames.
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const field = page.getByRole("textbox", { name: "New name for Lantern" });
  await expect(field).toBeFocused();
  await field.fill("Storm Lantern");
  await field.press("Enter");
  await expect(page.locator(".entry h1").first()).toHaveText("Storm Lantern");
  await expect(page.locator(".ui-toast")).toContainText(
    "Renamed to Storm Lantern; links in 2 other entries change",
  );
  await expect(page.locator(".draft-note")).toContainText("renamed from Lantern");

  await page.goto("/unpublished");
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
  // The old address of the rename page opens the entry, where renaming is now.
  await page.goto("/rename/" + ["02 People", "Mira.md"].map(encodeURIComponent).join("/"));
  await expect(page).toHaveURL(/\/e\/02%20People\/Mira\.md$/);
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const field = page.getByRole("textbox", { name: "New name for Mira" });
  await field.fill("Shade");
  await field.press("Enter");
  // The refusal shows in place, and the field stays for another name.
  await expect(page.locator(".rename-field-problem")).toContainText("already exists");
  await field.fill("Sha/de");
  await field.press("Escape");
  await expect(page.locator(".entry h1").first()).toHaveText("Mira");
  await page.goto(entry("99 Appendices/Logs/Session.md"));
  await expect(page.locator(".edit-link")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rename", exact: true })).toHaveCount(0);
});

test("CUJ 2: renames and moves an entry in place, as one pending rename, with Undo", async ({
  page,
}) => {
  const from = "01 Places/Harbor/Old Quay.md";
  const renames = async () =>
    (
      (await (await page.request.get("/api/unpublished")).json()) as {
        renames: { from: string; to: string }[];
      }
    ).renames.filter((r) => r.from === from);

  await page.goto(entry(from));
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const field = page.getByRole("textbox", { name: "New name for Old Quay" });
  await field.fill("Greywater Quay");
  await field.press("Enter");
  await expect(page.locator(".entry h1").first()).toHaveText("Greywater Quay");

  // Move to… opens the folder list from the menu; typing narrows it.
  await openMenu(page, "More actions");
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  await page.getByPlaceholder("Find a folder").fill("peo");
  await page.getByRole("option", { name: "02 People", exact: true }).click();
  await expect(page.locator(".crumbs")).toContainText("02 People");
  await expect(page.locator(".crumbs")).toContainText("unpublished");
  await expect(page.locator(".entry h1").first()).toHaveText("Greywater Quay");
  await expect(page.locator(".ui-toast")).toContainText(/Moved to 02 People; links in \d+ other/);
  // One pending rename, from where it is in the library to where it goes.
  expect(await renames()).toEqual([
    expect.objectContaining({ from, to: "02 People/Greywater Quay.md" }),
  ]);

  // Undo brings back the rename it replaced; Undo beside the title takes that one away too.
  await page.locator(".ui-toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".crumbs")).toContainText("Harbor");
  await expect(page.locator(".entry h1").first()).toHaveText("Greywater Quay");
  expect(await renames()).toEqual([
    expect.objectContaining({ from, to: "01 Places/Harbor/Greywater Quay.md" }),
  ]);
  await page.locator(".draft-note").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".entry h1").first()).toHaveText("Old Quay");
  await expect(page.locator(".crumbs")).not.toContainText("unpublished");
  expect(await renames()).toEqual([]);
});

test("searches the text of entries from the same box", async ({ page }) => {
  await page.goto(entry("README.md"));
  await page.locator(".find").click();
  const box = page.locator(".switcher");
  await box.locator("input").fill("fishers");
  await expect(box.locator(".switcher-label")).toHaveText("In the text");
  await expect(box.locator(".is-snippet")).toContainText("Founded by fishers.");
  await box.locator("li button").first().click();
  await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
});

test("lists an entry's headings in the Outline tab and jumps to one", async ({ page }) => {
  await page.goto(entry("01 Places/Harbor/Harbor.md"));
  await page.getByRole("button", { name: "Outline", exact: true }).first().click();
  const outline = page.getByRole("navigation", { name: "Outline" });
  await expect(outline.getByRole("button")).toHaveText(["History", "Tides"]);
  await outline.getByRole("button", { name: "Tides" }).click();
  await expect(page.locator(".prose h2", { hasText: "Tides" })).toBeInViewport();
  // A link to a heading still goes there.
  await page.goto(entry("01 Places/Harbor/Harbor.md") + "#History");
  await expect(page.locator(".prose h2", { hasText: "History" })).toBeInViewport();
});
