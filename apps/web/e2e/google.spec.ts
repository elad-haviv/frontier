import { expect, type Browser, test } from "./test.ts";
import { api, proj, tidyPeople } from "./helpers.ts";

/**
 * Stage 31c: the web half of Google sign-on. The e2e server has no Google, and no provider to
 * visit, so these tests stand in for the server's answers inside the browser: the session says
 * Google is offered, and the server's redirect after a trip that did not work is made by hand.
 * The server's side of the trip is covered by its own tests against a stand-in provider.
 */

test.afterEach(async ({ page }) => tidyPeople(page));

async function stranger(browser: Browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return { context, page: await context.newPage() };
}

test("Continue with Google is offered only when the server says so, and a failed trip is explained", async ({
  browser,
}) => {
  const s = await stranger(browser);
  await s.page.goto("/login");
  await expect(s.page.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(s.page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);

  // Google offered: the button is there, beside the password, and sends the browser to the server.
  const session = (await (await s.context.request.get("/api/session")).json()) as Record<
    string,
    unknown
  >;
  await s.page.route("**/api/session", (route) =>
    route.fulfill({ json: { ...session, google: true } }),
  );
  const started: string[] = [];
  await s.page.route("**/api/auth/google/start**", async (route) => {
    started.push(new URL(route.request().url()).search);
    // What the server does when Google knows the person and Frontier does not.
    await route.fulfill({ status: 302, headers: { location: "/login?problem=google_no_account" } });
  });
  await s.page.goto("/login");
  await s.page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(s.page.getByRole("alert")).toContainText("no Frontier account yet");
  await expect(s.page.getByRole("alert")).toContainText("invite link");
  expect(started).toEqual([""]);

  // Each other problem has its own plain words.
  for (const [problem, words] of [
    ["google_denied", "cancelled"],
    ["google_failed", "did not confirm who you are"],
    ["google_unverified", "has not verified that email"],
    ["google_expired", "took too long"],
    ["google_off", "not available on this server"],
  ] as const) {
    await s.page.goto(`/login?problem=${problem}`);
    await expect(s.page.getByRole("alert")).toContainText(words);
  }
  await s.context.close();
});

test("the join page offers Google, and explains a trip that did not work", async ({
  browser,
  page,
}) => {
  const made = await page.request.post(api("/invites"), { data: { role: "reader" } });
  const { id, path } = (await made.json()) as { id: string; path: string };
  const s = await stranger(browser);
  const code = path.split("/join/")[1]!;
  const info = (await (await s.context.request.get(`/api/join/${code}`)).json()) as Record<
    string,
    unknown
  >;
  await s.page.route("**/api/join/*", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { ...info, google: true } })
      : route.continue(),
  );
  await s.page.route("**/api/auth/google/start**", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("invite")).toBe(code);
    await route.fulfill({
      status: 302,
      headers: { location: `/join/${code}?problem=google_denied` },
    });
  });
  await s.page.goto(path);
  await s.page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(s.page.getByRole("alert")).toContainText("Google sign-in was cancelled");
  // The other ways are still there: the passkey first, then the password.
  await expect(
    s.page.getByRole("button", { name: "Join with a passkey on this device" }),
  ).toBeVisible();
  await expect(s.page.getByLabel("Password")).toBeVisible();
  await s.context.close();
  await page.request.delete(api(`/invites/${id}`));
});

test("back from Google, the join page asks for a click, and the person can drop it", async ({
  browser,
  page,
}) => {
  const made = await page.request.post(api("/invites"), { data: { role: "reader" } });
  const { id, path } = (await made.json()) as { id: string; path: string };
  const s = await stranger(browser);
  const code = path.split("/join/")[1]!;
  const info = (await (await s.context.request.get(`/api/join/${code}`)).json()) as Record<
    string,
    unknown
  >;
  // What the server answers after the callback kept a verified profile in the session.
  let pending: { name: string; email: string } | null = {
    name: "Gil Google",
    email: "gil@example.org",
  };
  const writes: string[] = [];
  await s.page.route("**/api/join/*", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { ...info, google: true, pendingGoogle: pending } })
      : route.continue(),
  );
  await s.page.route("**/api/join/*/google", async (route) => {
    writes.push(route.request().method());
    pending = null;
    await route.fulfill({ json: { ok: true } });
  });
  await s.page.goto(path);
  // Nothing was made: the page says who Google says it is and waits.
  await expect(s.page.getByText("gil@example.org")).toBeVisible();
  await expect(
    s.page.getByRole("button", { name: "Join as Gil Google with Google" }),
  ).toBeVisible();
  await expect(s.page.getByLabel("Password")).toHaveCount(0);
  expect(writes).toEqual([]);
  await s.page.getByRole("button", { name: "Use another way to join" }).click();
  await expect(s.page.getByLabel("Password")).toBeVisible();
  expect(writes).toEqual(["DELETE"]);
  await s.context.close();
  await page.request.delete(api(`/invites/${id}`));
});

test("Settings shows a linked Google account, refuses to unlink the last way in, and asks for a recent login", async ({
  page,
}) => {
  const real = (await (await page.request.get("/api/me")).json()) as Record<string, unknown>;
  const me = async (googleLinked: boolean, others: boolean) => {
    await page.route("**/api/me", (route) =>
      route.request().method() !== "GET"
        ? route.continue()
        : route.fulfill({
            json: {
              ...real,
              signingIn: {
                password: { set: others, off: false },
                passkeys: [],
                google: googleLinked
                  ? { email: "gwen@example.com", addedAt: "2026-11-20T10:00:00.000Z" }
                  : null,
                googleAvailable: true,
              },
              passwordSet: others,
              passwordOff: false,
            },
          }),
    );
  };
  // Linked, and it is the only way in: unlinking is not offered, and the page says why.
  await me(true, false);
  await page.goto(proj("/settings/account"));
  await expect(page.getByText("gwen@example.com")).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlink Google" })).toBeDisabled();
  await expect(page.getByText("Google is the only way this account logs in.")).toBeVisible();

  // Linked beside a password: unlinking asks, and the server's refusal is put in plain words.
  await page.unroute("**/api/me");
  await me(true, true);
  await page.route("**/api/me/google", (route) =>
    route.fulfill({
      status: 403,
      json: { error: { code: "not_allowed", message: "That is the last way to log in." } },
    }),
  );
  await page.goto(proj("/settings/account"));
  await page.getByRole("button", { name: "Unlink Google" }).click();
  await page
    .getByRole("dialog", { name: "Unlink Google?" })
    .getByRole("button", { name: "Unlink" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Google is the only way this account logs in",
  );

  // Not linked: it can be linked, and a login that is too old is asked for again.
  await page.unroute("**/api/me");
  await me(false, true);
  await page.goto(proj("/settings/account"));
  await expect(page.getByRole("button", { name: "Link a Google account" })).toBeVisible();
  await page.goto("/settings/you/signing-in?problem=recent_login_needed");
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole("alert")).toContainText("asks for a login from the last few minutes");
  // An address that says so does not open the login by itself: the person asks for it.
  await expect(page.getByRole("dialog", { name: "Log in again" })).toHaveCount(0);
  await page.getByRole("button", { name: "Log in again and link Google" }).click();
  await expect(page.getByRole("dialog", { name: "Log in again" })).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  // A reload does not say it again: the problem is off the address.
  await page.reload();
  await expect(page.getByRole("button", { name: "Log in again and link Google" })).toHaveCount(0);
  await page.goto("/settings/you/signing-in?problem=google_taken");
  await expect(page.getByRole("alert")).toContainText("belongs to another person");
});
