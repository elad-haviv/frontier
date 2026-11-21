import { expect, test } from "@playwright/test";
import { answerDialog } from "./helpers.ts";

test("adds a passkey, logs in with it, and switches the password off and on again", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== "phone", "Sign-in settings are one per server.");
  // A passkey device built into the browser, which confirms the user every time.
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto("/settings");
  await page.getByLabel("Add a passkey on this device").fill("Test phone");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.locator(".banner-ok")).toContainText("The passkey was added");
  await expect(page.locator(".passkeys")).toContainText("Test phone");

  // The password cannot be switched off from a session that used the password.
  await page.getByLabel(/Switch the password off/).click();
  await expect(page.locator(".settings .banner")).toContainText("Log in with a passkey first");

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: "Use a passkey" }).click();
  await expect(page.locator(".topnav")).toBeVisible();
  await page.goto("/settings");
  await expect(page.locator(".passkeys")).toContainText("Test phone");

  await page.getByLabel(/Switch the password off/).click();
  await expect(page.locator(".banner-ok")).toContainText("The password no longer logs in");
  expect(await page.evaluate(() => fetch("/api/session").then((r) => r.json()))).toMatchObject({
    loggedIn: true,
    password: false,
  });

  // Back to how it was, so the other tests can log in.
  await page.getByLabel(/Switch the password off/).click();
  await expect(page.locator(".banner-ok")).toContainText("The password logs in again");
  await page.locator(".passkeys").getByRole("button", { name: "Remove" }).click();
  await answerDialog(page, "Remove");
  await expect(page.locator(".passkeys")).toHaveCount(0);
});
