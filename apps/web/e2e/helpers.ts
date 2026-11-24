import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));

/** The Git repository that stands in for GitHub in these tests. */
export const REMOTE = join(here, "..", "..", "..", ".e2e-data", "sample-remote.git");

export const PASSWORD = "browser-test-password";

/** Where the shared login session is kept between tests. */
export const AUTH_FILE = join(here, "..", "..", "..", "test-results", ".auth.json");

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Outside", "-c", "user.email=outside@example.com", ...args],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

export const commitCount = () => Number(git(REMOTE, "rev-list", "--count", "main"));
export const lastMessage = () => git(REMOTE, "log", "-1", "--format=%s", "main");
export const onMain = (path: string): string | null => {
  try {
    return execFileSync("git", ["show", `main:${path}`], {
      cwd: REMOTE,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
};

/** Changes a file on the remote from outside the app, as Obsidian or an agent would. */
export function changeFromOutside(path: string, change: (text: string) => string): void {
  const work = mkdtempSync(join(tmpdir(), "frontier-outside-"));
  try {
    git(tmpdir(), "clone", "-q", REMOTE, work);
    const file = join(work, path);
    writeFileSync(file, change(readFileSync(file, "utf8")));
    git(work, "commit", "-qam", `Outside change to ${path}`);
    git(work, "push", "-q", "origin", "HEAD:main");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Pushes a proposal branch from outside, as an agent would. */
export function pushProposal(branch: string, files: Record<string, string>, message: string): void {
  const work = mkdtempSync(join(tmpdir(), "frontier-agent-"));
  try {
    git(tmpdir(), "clone", "-q", REMOTE, work);
    git(work, "checkout", "-q", "-b", branch);
    for (const [path, text] of Object.entries(files)) writeFileSync(join(work, path), text);
    git(work, "add", "-A");
    git(work, "commit", "-qm", message);
    git(work, "push", "-q", "origin", branch);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Commits files to `main` from outside the app and returns the commit. */
export function pushToMain(files: Record<string, string>, message: string): string {
  const work = mkdtempSync(join(tmpdir(), "frontier-outside-"));
  try {
    git(tmpdir(), "clone", "-q", REMOTE, work);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(work, path)), { recursive: true });
      writeFileSync(join(work, path), text);
    }
    git(work, "add", "-A");
    git(work, "commit", "-qm", message);
    git(work, "push", "-q", "origin", "HEAD:main");
    return git(work, "rev-parse", "HEAD");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export const hasBranch = (branch: string): boolean => {
  try {
    git(REMOTE, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
};
export const lastBody = () => git(REMOTE, "log", "-1", "--format=%B", "main");

export const entry = (path: string) => "/e/" + path.split("/").map(encodeURIComponent).join("/");
export const edit = (path: string) => "/edit/" + path.split("/").map(encodeURIComponent).join("/");

/** Opens a file in the editor and puts the cursor at the very end. */
export async function openEditor(page: Page, path: string): Promise<void> {
  await page.goto(edit(path));
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
}

export async function saved(page: Page): Promise<void> {
  await expect(page.locator(".save-saved")).toBeVisible();
}

/** Reviews every unpublished change and stops at the plan, before Publish. */
export async function review(page: Page): Promise<void> {
  await page.goto("/unpublished");
  await expect(page.locator(".changes > li").first()).toBeVisible();
  await page.locator("button.big").click();
  await expect(page.locator(".plan")).toBeVisible();
}

export async function publish(page: Page, message: string): Promise<void> {
  await page.fill(".field input", message);
  await page.locator(".plan button.big").click();
  await expect(page.locator(".banner-ok")).toBeVisible({ timeout: 20_000 });
}

export async function noSidewaysScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
}

/** Opens a "⋯" menu by the name of its button, such as "More actions", and waits for it. */
export async function openMenu(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

/** On a phone, opens the side bar's drawer; on a desktop the side bar is always there. */
export async function openSideBar(page: Page): Promise<void> {
  const menu = page.getByRole("button", { name: "Open the side bar", exact: true });
  const unfold = page.getByRole("button", { name: "Unfold the side bar", exact: true });
  const fold = page.getByRole("button", { name: "Fold the side bar", exact: true });
  // Wait until the shell has drawn one of its three states; checking at once can run before it.
  await expect(menu.or(unfold).or(fold).first()).toBeVisible();
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.getByRole("dialog", { name: "Side bar" })).toBeVisible();
  } else {
    // A folded side bar is unfolded, so the folders show.
    if (await unfold.isVisible()) await unfold.click();
  }
}

/** Goes to one of the side bar's places, such as "Maps" or "Inbox", as the author would. */
export async function goTo(page: Page, place: string): Promise<void> {
  await openSideBar(page);
  await page
    .locator(".left-bar .side-link")
    .filter({ hasText: new RegExp(`^${place}`) })
    .first()
    .click();
}

/**
 * Waits until the map is drawn as it is now. A tap is tested against where the features were at
 * the last draw, which comes on the frame after a change, and after the canvas has taken its
 * frame's new size when a panel beside the map opens or closes (the drawing sets the canvas's
 * size, so a canvas the size it is laid out at has been drawn at that size).
 */
export async function drawn(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page
        .locator(".map-top")
        .evaluate(
          (c: HTMLCanvasElement) =>
            c.width === Math.round(c.clientWidth * (window.devicePixelRatio || 1)),
        ),
    )
    .toBe(true);
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

/** Opens a panel of the right side bar (the bottom sheet on a phone) by its tab, and gives it. */
export async function rightPanel(page: Page, name: string) {
  const tab = page.getByRole("tab", { name: new RegExp(`^${name}\\b`) });
  if ((await tab.count()) === 0 || (await tab.getAttribute("aria-selected")) !== "true") {
    if ((await tab.count()) === 0) {
      // The side bar is closed: the page's own button for the panel opens it.
      await page
        .getByRole("button", { name: new RegExp(`^${name}\\b`) })
        .first()
        .click();
    }
    await page.getByRole("tab", { name: new RegExp(`^${name}\\b`) }).click();
  }
  const panel = page.getByRole("tabpanel");
  await expect(panel).toBeVisible();
  return panel;
}

/** Makes a new entry through the New entry dialog, choosing its folder in the folder list. */
export async function newEntry(page: Page, folder: string, name: string): Promise<void> {
  // On a phone the button is in the side bar's drawer.
  await openSideBar(page);
  await page.getByRole("button", { name: "New entry", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("combobox", { name: "Folder", exact: true }).click();
  await page.getByPlaceholder("Find a folder").fill(folder);
  await page.getByRole("option", { name: folder, exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Folder", exact: true })).toHaveText(folder);
  await dialog.getByRole("button", { name: "Make the entry", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/**
 * Presses one of the editor's tools: its toolbar button where the bar has room for it, or the item
 * in the toolbar's "⋯" where it does not, as on a phone.
 */
export async function pressTool(page: Page, name: string): Promise<void> {
  const button = page.locator(".edit-toolbar").getByRole("button", { name, exact: true });
  if (await button.isVisible()) {
    await button.click();
    return;
  }
  await page.getByRole("button", { name: "More tools", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
}

/** Opens the image dialog from the toolbar. */
export async function openImageDialog(page: Page) {
  await pressTool(page, "Add an image");
  const dialog = page.getByRole("dialog", { name: "Add an image" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Throws away the draft that is open in the editor, so the next test starts from the vault. */
export async function discardDraft(page: Page): Promise<void> {
  await openMenu(page, "More actions");
  await page.getByRole("menuitem", { name: "Discard draft" }).click();
  await answerDialog(page, "Discard");
  await expect(page.locator(".code-editor")).toHaveCount(0);
}

/**
 * Chooses an image in the map image dialog that `opener` opens: found by its file name, picked,
 * and chosen.
 */
export async function chooseMapImage(page: Page, opener: Locator, name: string): Promise<void> {
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Choose an image" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Find an image by its name or its entry").fill(name);
  await dialog
    .getByRole("button", { name: `Choose ${name}`, exact: true })
    .first()
    .click();
  await dialog.getByRole("button", { name: "Choose", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/**
 * Makes a map through the form on the Maps page, its image chosen in the image dialog, and waits
 * for it to open in editing with its view in the address.
 */
export async function newMapInForm(
  page: Page,
  title: string,
  space: "flat" | "sphere" | "schematic",
  image = "map one.png",
): Promise<void> {
  await page.goto("/maps");
  await page.locator(".new-map input[type=text]").fill(title);
  await page.locator(".new-map select").selectOption(space);
  await chooseMapImage(page, page.getByRole("button", { name: "Choose an image…" }), image);
  await page.getByRole("button", { name: "Make the map" }).click();
  await expect(page.locator(".map-top")).toBeVisible();
  // The view is written into the address once the map has been laid out.
  await expect(page).toHaveURL(/v=/);
}

/**
 * Links to an entry through the entry combobox inside `scope`: types `typed` (the name, unless
 * given) and picks the entry whose name starts with `name`.
 */
export async function pickEntry(scope: Locator, name: string, typed = name): Promise<void> {
  const page = scope.page();
  await scope.getByRole("combobox", { name: "Entry" }).click();
  await page.getByPlaceholder("Find an entry").fill(typed);
  await page
    .getByRole("option", { name: new RegExp(`^${name}`) })
    .first()
    .click();
  await expect(scope.getByRole("combobox", { name: "Entry" })).toContainText(name);
}

/** Answers the app's own question box: types a value if one is given, then presses a button. */
export async function answerDialog(page: Page, button: string, value?: string): Promise<void> {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (value !== undefined) await dialog.getByRole("textbox").fill(value);
  await dialog.getByRole("button", { name: button, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
