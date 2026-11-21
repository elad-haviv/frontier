import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

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

/** Throws away the draft that is open in the editor, so the next test starts from the vault. */
export async function discardDraft(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Discard" }).click();
  await answerDialog(page, "Discard");
  await expect(page.locator(".code-editor")).toHaveCount(0);
}

/** Answers the app's own question box: types a value if one is given, then presses a button. */
export async function answerDialog(page: Page, button: string, value?: string): Promise<void> {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (value !== undefined) await dialog.getByRole("textbox").fill(value);
  await dialog.getByRole("button", { name: button, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
