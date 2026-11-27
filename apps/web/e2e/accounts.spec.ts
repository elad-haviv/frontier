import { expect, type Page, test } from "@playwright/test";
import {
  EMAIL,
  entry,
  keepSession,
  NAME,
  noSidewaysScroll,
  openSideBar,
  PASSWORD,
  at,
} from "./helpers.ts";

// The account is one per server: these tests take turns and put back what they change.
test.describe.configure({ mode: "serial" });

const isPhone = (name: string) => name === "phone";

/** Where you are shown: the side bar on a desktop, the drawer on a phone. */
async function bar(page: Page) {
  await page.goto(at("/"));
  await openSideBar(page);
  return page.locator(".left-bar").first();
}

test("the foot of the left bar shows you, and the app menu says who is logged in", async ({
  page,
}) => {
  const left = await bar(page);
  const you = left.getByRole("link", { name: `${NAME}, your profile` });
  await expect(you).toContainText(NAME);
  // The avatar carries the initials of the name.
  await expect(you.locator(".ui-avatar")).toHaveText("OO");
  await left.getByRole("button", { name: "App menu" }).click();
  const heading = page.locator(".ui-menu-heading");
  await expect(heading).toContainText(NAME);
  await expect(heading).toContainText(EMAIL);
  // The heading is not an action: the menu's own items are all still there.
  await expect(page.getByRole("menuitem", { name: "Settings", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // Your name goes to your profile.
  await you.click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.getByLabel("Name")).toHaveValue(NAME);
  await expect(page.getByLabel("Email")).toHaveValue(EMAIL);
  await noSidewaysScroll(page);
});

test("the folded rail keeps you: the avatar, named on hover, and the app menu", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "A phone has a drawer, not a rail.");
  await page.goto(entry("03 Things/Ledger.md"));
  await expect(page.locator(".entry h1").first()).toBeVisible();
  await page.keyboard.press("Control+\\");
  const rail = page.locator(".side");
  await expect(rail).toHaveClass(/is-rail/);
  const you = rail.getByRole("link", { name: `${NAME}, your profile` });
  await expect(you.locator(".ui-avatar")).toHaveText("OO");
  await you.hover();
  await expect(page.getByRole("tooltip")).toContainText(NAME);
  await rail.getByRole("button", { name: "App menu" }).click();
  await expect(page.locator(".ui-menu-heading")).toContainText(EMAIL);
  await page.keyboard.press("Escape");
  // Put it back.
  await page.keyboard.press("Control+\\");
  await expect(rail).not.toHaveClass(/is-rail/);
});

test("Settings has a You group with Profile and Signing in", async ({ page }, info) => {
  await page.goto(at("/settings"));
  const menu = page.getByRole("navigation", { name: "Settings" });
  await expect(menu.getByRole("heading", { name: "You" })).toBeVisible();
  await expect(menu.getByRole("link", { name: /Profile/ })).toBeVisible();
  await expect(menu.getByRole("link", { name: /Signing in/ })).toBeVisible();
  if (isPhone(info.project.name)) {
    // The list says each section's state.
    await expect(menu.getByRole("link", { name: /Profile/ })).toContainText(EMAIL);
    await expect(menu.getByRole("link", { name: /Signing in/ })).toContainText("Password");
  }
  await menu.getByRole("link", { name: /Profile/ }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.locator("article.settings-section h1")).toHaveText("Profile");
});

test("the profile says what is wrong under the field, and a saved name shows in the side bar", async ({
  page,
}, info) => {
  test.skip(!isPhone(info.project.name), "One account: the phone project runs the changes.");
  await page.goto(at("/settings/profile"));
  const name = page.getByLabel("Name");
  const email = page.getByLabel("Email");
  const save = page.getByRole("button", { name: "Save" });
  // Nothing changed, nothing to save.
  await expect(save).toBeDisabled();

  await email.fill("not an email");
  await save.click();
  await expect(page.locator(".field-error")).toHaveText("This is not an email address.");
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await name.fill("   ");
  await save.click();
  await expect(page.locator(".field-error")).toHaveCount(2);
  await expect(page.locator(".field-error").first()).toHaveText("Give a name.");
  // Typing in a field clears its message.
  await name.fill("Olive Q. Owner");
  await expect(page.locator(".field-error")).toHaveCount(1);
  await email.fill(EMAIL);

  await save.click();
  await expect(page.locator(".field-ok")).toHaveText("Saved.");
  const left = await bar(page);
  await expect(left.getByRole("link", { name: "Olive Q. Owner, your profile" })).toBeVisible();

  // Put it back.
  await page.goto(at("/settings/profile"));
  await name.fill(NAME);
  await save.click();
  await expect(page.locator(".field-ok")).toHaveText("Saved.");
});

test("the password changes only with the current one, and says why under the field", async ({
  page,
}, info) => {
  test.skip(!isPhone(info.project.name), "One account: the phone project runs the changes.");
  await page.goto(at("/settings/account"));
  await expect(page.getByRole("heading", { name: "Passkeys" })).toBeVisible();
  const change = page.getByRole("button", { name: "Change the password" });
  const current = page.getByLabel("Current password");
  const next = page.getByLabel("New password");

  await change.click();
  await expect(page.locator(".field-error")).toHaveText("Type your current password.");
  await current.fill("not the password");
  await next.fill("short");
  await change.click();
  await expect(page.locator(".field-error")).toHaveText("Use at least 12 characters.");
  await next.fill("a new long password");
  await change.click();
  await expect(page.locator(".field-error")).toContainText("current password is not right");
  await expect(current).toHaveAttribute("aria-invalid", "true");

  await current.fill(PASSWORD);
  await change.click();
  await expect(page.locator(".banner-ok")).toHaveText("The password was changed.");
  await expect(current).toHaveValue("");
  // Changing the password ended the other sessions: this page's is the one that stays valid.
  await keepSession(page);

  // Back to how it was, so the other tests can log in.
  await current.fill("a new long password");
  await next.fill(PASSWORD);
  await change.click();
  await expect(page.locator(".banner-ok")).toHaveText("The password was changed.");
  await expect(page.getByText("The last way to log in cannot be removed.")).toBeVisible();
  await keepSession(page);
});

test("the login page: a passkey first, then email and password, then the note about invites", async ({
  browser,
}, info) => {
  test.skip(!isPhone(info.project.name), "The page is the same at every size.");
  const page = await (
    await browser.newContext({ storageState: { cookies: [], origins: [] } })
  ).newPage();
  // A server that has a passkey, and an account that has no email yet.
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: {
        loggedIn: false,
        person: null,
        emailless: true,
        passkeys: true,
        password: true,
      },
    }),
  );
  await page.goto("/login");
  const passkey = page.getByRole("button", { name: "Use a passkey" });
  await expect(passkey.locator(".lucide-fingerprint")).toBeVisible();
  const or = page.getByText("or", { exact: true });
  const email = page.getByLabel("Email");
  const password = page.getByLabel("Password");
  const logIn = page.getByRole("button", { name: "Log in" });
  const note = page.getByText("No account? You need an invite link from a project's owner.");
  await expect(note).toBeVisible();
  await expect(page.getByText("This account has no email yet. Leave this empty.")).toBeVisible();
  const tops = [];
  for (const part of [passkey, or, email, password, logIn, note]) {
    tops.push((await part.boundingBox())!.y);
  }
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  // The password is needed to log in.
  await expect(logIn).toBeDisabled();
  await password.fill("x");
  await expect(logIn).toBeEnabled();
  await noSidewaysScroll(page);
});
