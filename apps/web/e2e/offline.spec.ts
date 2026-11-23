import { expect, type Page, test } from "@playwright/test";
import { discardDraft, edit, entry, openMenu, openSideBar } from "./helpers.ts";

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

/** Reloads with no connection: the app opens and the mark says it is not connected. */
async function reloadOffline(page: Page): Promise<void> {
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.locator(".connection.is-offline").first()).toContainText("Not connected", {
    timeout: 15_000,
  });
}

const HARBOR = "01 Places/Harbor/Harbor.md";
const MIRA = "02 People/Mira.md";
const SHADE = "02 People/Shade.md";
const entryAnswer = (path: string) => `/api/entries?path=${encodeURIComponent(path)}`;

/** The addresses of the answers kept in the device's database. */
function keptAnswers(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open("frontier");
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("answers")) return resolve([]);
          const read = db.transaction("answers").objectStore("answers").getAllKeys();
          read.onsuccess = () => {
            resolve(read.result.map(String));
            db.close();
          };
          read.onerror = () => resolve([]);
        };
        open.onerror = () => resolve([]);
      }),
  );
}

/** Waits until the device keeps an answer for each address. */
async function kept(page: Page, ...urls: string[]): Promise<void> {
  await expect
    .poll(async () => {
      const have = await keptAnswers(page);
      return urls.filter((u) => !have.includes(u));
    })
    .toEqual([]);
}

/** Opens an entry online and waits until it is on the device. */
async function read(page: Page, path: string): Promise<void> {
  await page.goto(entry(path));
  await expect(page.locator(".entry h1").first()).toHaveText(path.split("/").pop()!.slice(0, -3));
  await kept(page, entryAnswer(path));
}

/** Waits until nothing is waiting to be sent. */
async function allSent(page: Page): Promise<void> {
  await expect(page.locator(".connection.is-offline")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".unsent-count")).toHaveCount(0, { timeout: 15_000 });
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

test("CUJ 2: an entry read and written with no connection, sent when it returns", async ({
  page,
  context,
}) => {
  const words = `Written on the train ${Date.now()}.`;
  await install(page);
  await read(page, HARBOR);
  await read(page, MIRA);
  await kept(page, "/api/graph", "/api/tree");
  await reloadOffline(page);

  // The switcher finds every entry by name, Old Quay too, which is not on the device.
  await page.locator(".find").click();
  const box = page.locator(".switcher");
  await box.locator("input").fill("old q");
  await expect(box.locator(".switcher-name").first()).toHaveText("Old Quay");
  await expect(box).toContainText("Full-text search needs a connection.");
  await box.locator("input").fill("harb");
  await expect(box.locator(".switcher-name").first()).toHaveText("Harbor");
  await page.keyboard.press("Enter");
  await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
  await expect(page.locator(".offline-copy")).toContainText("Offline copy from");

  // Writing: the editor opens from the device, and [[ offers names from the index.
  await page.goto(edit(HARBOR));
  await expect(page.locator(".offline-copy")).toContainText("Offline copy from");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(`\n\n${words} See [[Old`);
  await page.locator(".cm-tooltip-autocomplete li", { hasText: "Old Quay" }).first().click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
  await expect(page.locator(".prose")).toContainText(words);
  await expect(page.locator(".prose a", { hasText: "Old Quay" }).first()).toBeVisible();
  await expect(page.getByText("Not sent yet:")).toBeVisible();
  await expect(page.locator(".connection.is-offline").first()).toContainText("1 change waiting");

  // The connection returns: the change goes without the author doing anything.
  await context.setOffline(false);
  await allSent(page);
  const res = await page.request.get(entryAnswer(HARBOR));
  expect(((await res.json()) as { text: string }).text).toContain(words);
  await page.goto(edit(HARBOR));
  await discardDraft(page);
});

test("CUJ 5: an entry not on the device says so; what needs the server is disabled", async ({
  page,
  context,
}) => {
  await install(page);
  await read(page, HARBOR);
  await kept(page, "/api/graph");
  await reloadOffline(page);

  await page.goto(entry(SHADE));
  await expect(page.locator(".not-on-device")).toContainText(
    "Shade is not on this device. It opens when you are connected.",
  );
  await expect(page.locator(".not-on-device .crumbs")).toHaveText("02 People");
  await expect(page.locator(".not-on-device a", { hasText: "Mira" }).first()).toBeVisible();

  await page.goto(entry(HARBOR));
  await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
  await openMenu(page, "More actions");
  const rename = page.getByRole("menuitem", { name: /^Rename/ });
  await expect(rename).toBeDisabled();
  await expect(rename).toContainText("Needs a connection");
  await page.keyboard.press("Escape");

  // Images need a connection; the text does not.
  await page.goto(edit(HARBOR));
  await expect(page.getByRole("button", { name: "Add an image" })).toBeDisabled();
  await context.setOffline(false);
});

test("a map on the device opens with its image, and a marker added offline is sent", async ({
  page,
  context,
}) => {
  await install(page);
  await page.goto("/maps");
  await page.locator(".new-map input[type=text]").fill(`Train chart ${Date.now()}`);
  await page.locator(".new-map select").nth(0).selectOption("flat");
  await page.locator(".new-map select").nth(1).selectOption("99 Appendices/Images/map one.png");
  await page.getByRole("button", { name: "Make the map" }).click();
  await expect(page.locator(".map-canvas").first()).toHaveAttribute("data-images", "1");
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await kept(page, `/api/maps/${id}`, "/api/marker-sets");
  // The image is stored for the page to draw offline.
  await expect
    .poll(() =>
      page.evaluate(async () => (await (await caches.open("frontier-images")).keys()).length),
    )
    .toBeGreaterThan(0);

  await reloadOffline(page);
  await expect(page.locator(".map-canvas").first()).toHaveAttribute("data-images", "1", {
    timeout: 15_000,
  });
  await expect(page.locator(".offline-copy")).toContainText("Offline copy from");
  // A map just made opens for editing.
  const editButton = page.getByRole("button", { name: "Edit", exact: true });
  if (await editButton.isVisible()) await editButton.click();
  await page.getByRole("button", { name: "Marker" }).click();
  const box = (await page.locator(".map-top").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".feature-editor")).toBeVisible();
  await expect(page.locator(".connection.is-offline").first()).toContainText("1 change waiting");

  await context.setOffline(false);
  await allSent(page);
  const map = (await (await page.request.get(`/api/maps/${id}`)).json()) as {
    map: { features: unknown[] };
  };
  expect(map.map.features).toHaveLength(1);
  await page.request.delete(`/api/maps/${id}`);
});

test("CUJ 8: the graph offline, drawn from the compact index", async ({ page }) => {
  await install(page);
  await page.goto("/graph");
  await expect(page.locator("canvas.graph-canvas")).toHaveAttribute("aria-busy", "false");
  const online = await page.locator("canvas.graph-canvas").getAttribute("aria-label");
  await kept(page, "/api/graph");
  await reloadOffline(page);

  await page.goto(`/graph?focus=${encodeURIComponent(HARBOR)}`);
  await expect(page.locator("canvas.graph-canvas")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("canvas.graph-canvas")).toHaveAttribute("aria-label", online!);
  await expect(page.locator(".offline-copy")).toContainText("Offline copy from");
  await expect(page.getByRole("region", { name: "Selected entry" })).toContainText("Harbor");
  await page.context().setOffline(false);
});

test("On this device shows in Settings with no connection", async ({ page }) => {
  await install(page);
  await read(page, HARBOR);
  await reloadOffline(page);
  await page.goto("/settings");
  const block = page.locator(".on-this-device");
  await expect(block).toContainText("On this device");
  await expect(block).toContainText(/Space used: \d+(\.\d)? (KB|MB)/);
  await expect(
    block.getByRole("button", { name: "Remove everything on this device" }),
  ).toBeVisible();
  // The blocks that need the server say so below it.
  await expect(page.locator(".ui-problem").first()).toContainText("Can't reach Frontier");
  await page.context().setOffline(false);
});

// Last in the file: it ends this context's session.
test("logout removes the worker and its caches, and the login page registers none", async ({
  page,
}) => {
  await install(page);
  await read(page, HARBOR);
  expect(await page.evaluate(() => caches.keys())).not.toEqual([]);
  // A change waiting, its send held back: logout warns before it loses it.
  await page.route("**/api/drafts", () => undefined);
  await page.goto(edit(HARBOR));
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Left behind.");
  await expect(page.locator(".unsent-count")).toBeVisible();
  await openSideBar(page);
  await page.getByRole("button", { name: "App menu" }).click();
  await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
  const warning = page.getByRole("dialog").filter({ hasText: "not sent yet" });
  await expect(warning).toContainText("1 change is not sent yet");
  await warning.getByRole("button", { name: "Log out and lose them" }).click();
  await page.waitForURL("**/login");
  // Nothing of the library is left in the database.
  expect(await keptAnswers(page)).toEqual([]);
  await expect(page.locator("#password")).toBeVisible();
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations())).toHaveLength(0);
  // The login page itself brings no worker back.
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations())).toHaveLength(0);
});
