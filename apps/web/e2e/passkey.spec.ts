import { expect, test } from "@playwright/test";
import { answerDialog, EMAIL, keepSession, PASSWORD } from "./helpers.ts";

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

  // The server wants a login from the last few minutes to add a passkey, and the shared login of
  // these tests may be older. The first try is answered that way whatever its age, so the dialog
  // that asks the person to log in again is part of the test; after it, the passkey goes in.
  let asked = false;
  await page.route("**/api/passkeys/register/options", (route) => {
    if (asked) return route.continue();
    asked = true;
    return route.fulfill({
      status: 403,
      json: { error: { code: "recent_login_needed", message: "Log in again to do this." } },
    });
  });

  await page.goto("/settings/account");
  await page.getByLabel("Add a passkey on this device").fill("Test phone");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  const again = page.getByRole("dialog");
  await expect(again).toContainText("needs a login from the last few minutes");
  await again.getByLabel("Password").fill(PASSWORD);
  await again.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator(".banner-ok")).toContainText("The passkey was added");
  await expect(page.locator(".passkeys")).toContainText("Test phone");

  // The password cannot be switched off from a session that used the password.
  await page.getByLabel(/Switch the password off/).click();
  await expect(page.locator(".settings .banner")).toContainText("Log in with a passkey first");

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: "Use a passkey" }).click();
  // In: the shell's search is there, in the side bar or on the phone's top line.
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
  await page.goto("/settings/account");
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

  // The passkey login, the switches and the removal ended every other session. Logging in with
  // the password again gives the other tests the session they start from.
  const back = await page.request.post("/api/login", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(back.ok()).toBe(true);
  await keepSession(page);
});
