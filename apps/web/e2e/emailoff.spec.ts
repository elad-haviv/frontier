import { expect, test } from "./test.ts";
import { EMAIL, noSidewaysScroll, proj } from "./helpers.ts";

/**
 * Stage 28 with the mail switched off (the main e2e server has no relay): nothing about email
 * shows, except that the invite box says the server cannot send it, and Signing in shows the
 * address plainly. The specs of the mail itself are in `email.spec.ts`, against a second server.
 */
test("with no mail relay the app shows nothing about confirming, and no Forgot password", async ({
  page,
  browser,
}) => {
  await page.goto(proj("/"));
  await expect(page.locator(".home h1")).toBeVisible();
  await expect(page.locator(".confirm-banner")).toHaveCount(0);

  // The invite box: no address field, and it says why. Today's button.
  await page.goto(proj("/settings/members"));
  await expect(
    page.getByText("This server cannot send email, so copy the link and send it yourself."),
  ).toBeVisible();
  await expect(page.getByLabel(/Send it to/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Make an invite link" })).toBeVisible();
  await expect(page.locator(".tag-unconfirmed")).toHaveCount(0);
  await noSidewaysScroll(page);

  // Signing in: the address as plain text, and Change address, which applies at once.
  await page.goto(proj("/settings/account"));
  const block = page.getByTestId("email-block");
  await expect(block).toContainText(EMAIL);
  await expect(block).not.toContainText("Unconfirmed");
  await expect(block).not.toContainText("Confirmed");
  await block.getByRole("button", { name: "Change address" }).click();
  await expect(page.getByText("The change applies at once.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  // The profile still takes the address.
  await page.goto(proj("/settings/profile"));
  await expect(page.getByLabel("Email")).toHaveValue(EMAIL);

  // Logged out: no Forgot password, and its page says it cannot be done here.
  const out = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const anon = await out.newPage();
  await anon.goto("/login");
  await expect(anon.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(anon.getByRole("link", { name: "Forgot password?" })).toHaveCount(0);
  await anon.goto("/forgot-password");
  await expect(anon.getByRole("heading", { name: "This server cannot send email" })).toBeVisible();
  await out.close();
});
