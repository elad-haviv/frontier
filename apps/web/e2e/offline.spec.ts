import { expect, type Page, test } from "@playwright/test";
import { openSideBar } from "./helpers.ts";

/**
 * The installable app, with the service worker the build ships. A worker answers navigations and
 * the app's own files from its cache, and `context.route` does not see those (the 15a spike); the
 * tests read what it did from the page instead, with `caches` and `navigator.serviceWorker`.
 */

/** Opens the app signed in and waits until its worker is active and the sign-in is noted. */
async function install(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".entry h1").first()).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const open = indexedDB.open("frontier");
            open.onsuccess = () => {
              const read = open.result.transaction("meta").objectStore("meta").get("signedIn");
              read.onsuccess = () => resolve(read.result ?? null);
              read.onerror = () => resolve(null);
            };
            open.onerror = () => resolve(null);
          }),
      ),
    )
    .toMatchObject({ until: expect.any(Number) });
}

/** Reloads with no connection: the app opens, its page says why it is empty, the mark says so. */
async function reloadOffline(page: Page): Promise<void> {
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.locator(".ui-problem").first()).toContainText("Can't reach Frontier");
  await expect(page.locator(".connection.is-offline").first()).toContainText("Not connected", {
    timeout: 15_000,
  });
}

test("the app opens signed in with no connection", async ({ page, context }) => {
  await install(page);
  await reloadOffline(page);
  // The page came from the worker: the app, signed in, not the login page or the browser's own.
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.locator("#password")).toHaveCount(0);

  // Back online, the app finds the server by itself.
  await context.setOffline(false);
  await expect(page.locator(".connection.is-offline")).toHaveCount(0, { timeout: 15_000 });
});

test("Log out needs a connection", async ({ page, context }) => {
  await install(page);
  await reloadOffline(page);
  await openSideBar(page);
  await page.getByRole("button", { name: "App menu" }).click();
  const logout = page.getByRole("menuitem", { name: /^Log out/ });
  await expect(logout).toBeDisabled();
  await expect(logout).toContainText("Needs a connection");
  await context.setOffline(false);
});

test("the app can be installed: a manifest, icons and an Apple touch icon", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".entry h1").first()).toBeVisible();
  const links = await page.evaluate(() => ({
    manifest: [...document.querySelectorAll('link[rel="manifest"]')].map((l) =>
      l.getAttribute("href"),
    ),
    apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
    icon: document.querySelector('link[rel="icon"]')?.getAttribute("href"),
    themes: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) =>
      m.getAttribute("content"),
    ),
  }));
  expect(links.manifest).toEqual(["/manifest.webmanifest"]);
  expect(links.themes).toEqual(["#f7f3ea", "#171512"]);

  const res = await page.request.get(links.manifest[0]!);
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({
    name: "Frontier",
    short_name: "Frontier",
    start_url: "/",
    display: "standalone",
  });
  expect(manifest.icons.map((i) => i.sizes)).toEqual(["192x192", "512x512", "512x512"]);
  expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  for (const src of [...manifest.icons.map((i) => i.src), links.apple!, links.icon!]) {
    const icon = await page.request.get(src);
    expect(icon.ok(), src).toBe(true);
  }
});

// Last in the file: it ends this context's session.
test("logout removes the worker and its caches, and the login page registers none", async ({
  page,
}) => {
  await install(page);
  expect(await page.evaluate(() => caches.keys())).not.toEqual([]);
  await openSideBar(page);
  await page.getByRole("button", { name: "App menu" }).click();
  await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
  await page.waitForURL("**/login");
  await expect(page.locator("#password")).toBeVisible();
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations())).toHaveLength(0);
  // The login page itself brings no worker back.
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations())).toHaveLength(0);
});
