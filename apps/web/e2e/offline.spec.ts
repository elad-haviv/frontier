import {
  type APIRequestContext,
  type Browser,
  type CDPSession,
  expect,
  type Page,
  test,
} from "@playwright/test";
import {
  AUTH_FILE,
  discardDraft,
  edit,
  entry,
  giveDeviceKeys,
  newEntry,
  newMapInForm,
  openMenu,
  openSideBar,
  at,
} from "./helpers.ts";

/**
 * The installable app, with the service worker the build ships. A worker answers navigations and
 * the app's own files from its cache, and `context.route` does not see those (the 15a spike); the
 * tests read what it did from the page instead, with `caches` and `navigator.serviceWorker`.
 */

/** Opens the app signed in and waits until its worker is active and the sign-in is noted. */
async function install(page: Page): Promise<void> {
  await page.goto(at("/"));
  await expect(page.locator(".home h1")).toBeVisible();
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

test("Home with no connection: pins and recents from the device, the queue needs a connection", async ({
  page,
  context,
}) => {
  const pin = await page.request.post("/api/pins", { data: { path: MIRA } });
  expect(pin.ok(), await pin.text()).toBe(true);
  try {
    await install(page);
    // The pins were read on this device while online.
    await expect(page.locator(".home").getByRole("region", { name: "Working on" })).toContainText(
      "Mira",
    );
    await page.evaluate((path) => {
      localStorage.setItem(
        "frontier.keepGoing.v1",
        JSON.stringify({
          recents: [{ path, title: "Mira", kind: "read", at: Date.now() - 600_000 }],
          current: { path, title: "Mira" },
          previous: null,
          scroll: {},
          cursor: {},
        }),
      );
    }, MIRA);
    await reloadOffline(page);
    const home = page.locator(".home");
    await expect(home.getByRole("region", { name: "Working on" })).toContainText("Mira");
    await expect(home.getByRole("region", { name: "Recently" })).toContainText("Mira");
    await expect(home.getByRole("region", { name: "What to work on next" })).toContainText(
      "needs a connection",
    );
    // The dice asks the server: it stays, and does nothing until the connection is back.
    await expect(home.getByRole("button", { name: "Roll" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  } finally {
    await context.setOffline(false);
    await page.request.delete(`/api/pins?path=${encodeURIComponent(MIRA)}`);
  }
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
  await page.goto(at("/"));
  await expect(page.locator(".home h1")).toBeVisible();
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

test("a property of the author's own added with no connection is sent when it returns", async ({
  page,
  context,
}) => {
  const path = "03 Things/Rope.md";
  await install(page);
  await read(page, path);
  await kept(page, "/api/graph", "/api/tree");
  await reloadOffline(page);

  // The Properties panel writes the frontmatter in the editor's text, which the queue keeps.
  await page.goto(edit(path));
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  const panel = page.getByRole("tabpanel");
  await panel.getByRole("button", { name: "Add a property" }).click();
  await panel.getByLabel("Name", { exact: true }).fill("Length");
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await panel.getByLabel("Value of Length").fill("Forty fathoms");
  await panel.getByLabel("Value of Length").press("Enter");
  await page.getByRole("button", { name: "Hide the panel" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".custom-fields")).toContainText("Forty fathoms");
  await expect(page.getByText("Not sent yet:")).toBeVisible();

  await context.setOffline(false);
  await allSent(page);
  const res = await page.request.get(entryAnswer(path));
  expect(((await res.json()) as { text: string }).text).toContain("Length: Forty fathoms\n");
  await page.goto(edit(path));
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
  // On a phone the image tool is in the toolbar's "⋯".
  await page.goto(edit(HARBOR));
  await page.getByRole("button", { name: "More tools", exact: true }).click();
  const image = page.getByRole("menuitem", { name: /^Add an image/ });
  await expect(image).toBeDisabled();
  await expect(image).toContainText("Images need a connection");
  await page.keyboard.press("Escape");
  await context.setOffline(false);
});

test("a map on the device opens with its image, and a marker added offline is sent", async ({
  page,
  context,
}) => {
  await install(page);
  await newMapInForm(page, `Train chart ${Date.now()}`, "flat");
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
  await page.goto(at("/graph"));
  await expect(page.locator("canvas.graph-canvas")).toHaveAttribute("aria-busy", "false");
  const online = await page.locator("canvas.graph-canvas").getAttribute("aria-label");
  await kept(page, "/api/graph");
  await reloadOffline(page);

  await page.goto(at(`/graph?focus=${encodeURIComponent(HARBOR)}`));
  await expect(page.locator("canvas.graph-canvas")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("canvas.graph-canvas")).toHaveAttribute("aria-label", online!);
  await expect(page.locator(".offline-copy")).toContainText("Offline copy from");
  await expect(page.getByRole("region", { name: "Selected entry" })).toContainText("Harbor");
  await page.context().setOffline(false);
});

/** A second device: another browser, signed in, online. */
async function laptopOf(browser: Browser): Promise<APIRequestContext> {
  const context = await browser.newContext({ storageState: AUTH_FILE });
  return context.request;
}

/** A draft id as a browser makes one. */
const draftId = () =>
  Array.from(
    { length: 12 },
    () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)],
  ).join("");

/** Saves the given drafts as a version, from a device's requests. */
async function saveVersion(request: APIRequestContext, draftIds: string[]): Promise<void> {
  const plan = await request.post("/api/publish/plan", { data: { draftIds, renameIds: [] } });
  expect(plan.ok(), await plan.text()).toBe(true);
  const { planId, merges } = (await plan.json()) as { planId: string; merges: { id: string }[] };
  const done = await request.post("/api/publish/confirm", {
    data: { planId, confirmedMergeIds: merges.map((m) => m.id), message: "From the laptop" },
  });
  expect(done.ok(), await done.text()).toBe(true);
}

/** The number of drafts with kept copies, as the attention count has it. */
const keptCopies = async (request: APIRequestContext) =>
  ((await (await request.get("/api/status")).json()) as { attention: { keptCopies: number } })
    .attention.keptCopies;

test("CUJ 3: a new entry made offline, its path taken meanwhile, ends as two texts to compare", async ({
  page,
  context,
  browser,
}) => {
  const name = `Gull ${Date.now()}`;
  const path = `02 People/${name}.md`;
  await install(page);
  await read(page, MIRA);
  await kept(page, "/api/graph", "/api/tree");
  await reloadOffline(page);

  // On the phone, with no connection: New entry opens a new entry, as online.
  await newEntry(page, "02 People", name);
  await expect(page.locator(".editor-path")).toHaveText(name);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Sister of [[Mira]].");
  await expect(page.locator(".connection.is-offline").first()).toContainText("1 change waiting");
  // Leaving it and coming back shows the text, from the change not sent yet.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".entry h1").first()).toHaveText(name);
  await page.goto(entry(MIRA));
  await page.goto(entry(path));
  await expect(page.locator(".entry h1").first()).toHaveText(name);
  await expect(page.locator(".prose")).toContainText("Sister of");
  await expect(page.getByText("Not sent yet:")).toBeVisible();

  // Meanwhile the laptop makes the same entry and saves a version.
  const laptop = await laptopOf(browser);
  const theirs = draftId();
  const made = await laptop.put("/api/drafts", {
    data: {
      id: theirs,
      path,
      kind: "create",
      text: `# ${name}\n\nFrom the laptop.\n`,
      revision: 0,
      baseBlob: "",
    },
  });
  expect(made.ok(), await made.text()).toBe(true);
  await saveVersion(laptop, [theirs]);

  // The phone reconnects: the server keeps its text beside a draft of the laptop's.
  await page.goto(entry(MIRA));
  await context.setOffline(false);
  const toast = page.locator(".ui-toast").filter({ hasText: `${name}: two texts to compare` });
  await expect(toast).toBeVisible({ timeout: 20_000 });
  await toast.getByRole("button", { name: "Open" }).click();
  await expect(page.locator(".versions-page h1")).toHaveText("Two texts to compare");
  await expect(page.locator(".versions-page")).toContainText("Sister of");
  await expect(page.locator(".versions-page")).toContainText("From the laptop.");

  // Clean up: the draft goes, and the entry is taken out of the library again.
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await laptop.delete(`/api/drafts/${id}`);
  const opened = (await (await laptop.get(entryAnswer(path))).json()) as { blob: string };
  const gone = draftId();
  await laptop.put("/api/drafts", {
    data: { id: gone, path, kind: "delete", text: "", revision: 0, baseBlob: opened.blob },
  });
  await saveVersion(laptop, [gone]);
});

test("CUJ 4: a map changed on the train and at home keeps the other side, compared per item", async ({
  page,
  context,
  browser,
}) => {
  await install(page);
  // A flat map with one marker, Lighthouse, in the middle of its image.
  const id = await page.evaluate(async (title) => {
    const json = { "content-type": "application/json" };
    const made = await fetch("/api/maps", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ title, kind: "flat", image: "99 Appendices/Images/map one.png" }),
    });
    const { id } = (await made.json()) as { id: string };
    const loaded = await (await fetch(`/api/maps/${id}`)).json();
    const map = loaded.map;
    map.features = [
      {
        id: "lightho1",
        kind: "marker",
        layer: map.layers[0].id,
        at: [map.space.width / 2, map.space.height / 2],
        entry: null,
        label: "Lighthouse",
        icon: null,
        child: null,
      },
    ];
    await fetch(`/api/maps/${id}`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ map, revision: loaded.revision, baseBlob: loaded.blob }),
    });
    return id;
  }, `Coast ${Date.now()}`);
  await page.goto(at(`/map/${id}?edit=1`));
  await expect(page.locator(".map-canvas").first()).toHaveAttribute("data-images", "1");
  await kept(page, `/api/maps/${id}`);

  // On the train: the phone moves Lighthouse with a finger.
  await reloadOffline(page);
  await expect(page.locator(".map-canvas").first()).toHaveAttribute("data-images", "1", {
    timeout: 15_000,
  });
  await expect(page).toHaveURL(/v=/);
  await page.waitForTimeout(300);
  const editButton = page.getByRole("button", { name: "Edit", exact: true });
  if (await editButton.isVisible()) await editButton.click();
  // Where the marker is on the screen: the map's space from the device's copy, the view from the
  // address.
  const box = (await page.locator(".map-top").boundingBox())!;
  const [, vx, vy, k] = decodeURIComponent(new URL(page.url()).searchParams.get("v") ?? "")
    .split(",")
    .map(Number);
  const space = await page.evaluate(async (url) => {
    const open = indexedDB.open("frontier");
    return new Promise<{ width: number; height: number }>((resolve) => {
      open.onsuccess = () => {
        const read = open.result.transaction("answers").objectStore("answers").get(url);
        read.onsuccess = () => resolve(read.result.body.map.space);
      };
    });
  }, `/api/maps/${id}`);
  const at = {
    x: box.x + box.width / 2 + (space.width / 2 - vx!) * k!,
    y: box.y + box.height / 2 + (space.height / 2 - vy!) * k!,
  };
  const fingers = await Fingers.on(page);
  await fingers.tap(at);
  await expect(page.locator(".feature-editor")).toBeVisible();
  await fingers.press(1, at);
  await fingers.move(1, { x: at.x + 40, y: at.y + 10 });
  await fingers.lift(1);
  await expect(page.locator(".connection.is-offline").first()).toContainText("1 change waiting");

  // At home: the laptop renames it, and its save is sent first.
  const laptop = await laptopOf(browser);
  const home = (await (await laptop.get(`/api/maps/${id}`)).json()) as {
    map: { features: { label: string }[] };
    revision: number;
    blob: string;
  };
  home.map.features[0]!.label = "Old Light";
  const renamed = await laptop.put(`/api/maps/${id}`, {
    data: { map: home.map, revision: home.revision, baseBlob: home.blob },
  });
  expect(renamed.ok(), await renamed.text()).toBe(true);
  const before = await keptCopies(laptop);

  // The phone reconnects: the two are merged, and the laptop's side is kept on the server.
  await context.setOffline(false);
  const toast = page.locator(".ui-toast").filter({ hasText: "changed in both places: Lighthouse" });
  await expect(toast).toBeVisible({ timeout: 20_000 });
  await expect(toast).toContainText("Yours is in the map; the other version is kept.");
  await toast.getByRole("button", { name: "Compare" }).click();
  const compare = page.locator(".versions-page");
  await expect(compare.locator("h1")).toHaveText("Changed in both places");
  const item = compare.getByRole("region", { name: "Lighthouse" });
  await expect(item.locator("thead")).toContainText("This map now");
  await expect(item.locator("thead")).toContainText("Server copy at");
  await expect(item.getByRole("row", { name: /^Name/ })).toContainText("Old Light");
  await expect(item.getByRole("row", { name: /^Place/ })).toContainText("moved");
  expect(await keptCopies(laptop)).toBe(before + 1);

  // Dismissed, the attention count goes down; the map keeps the phone's place.
  await compare.getByRole("button", { name: "Dismiss" }).click();
  await expect(page).toHaveURL(new RegExp(`/map/${id}`));
  await expect.poll(() => keptCopies(laptop)).toBe(before);
  await laptop.delete(`/api/maps/${id}`);
});

/**
 * Fingers on the screen, as in `mapsedit.spec.ts`: a start or a move sends every finger that is
 * down, as a touch screen does.
 */
class Fingers {
  private down = new Map<number, { x: number; y: number }>();
  private constructor(private cdp: CDPSession) {}

  static async on(page: Page) {
    return new Fingers(await page.context().newCDPSession(page));
  }

  private send(type: "touchStart" | "touchMove" | "touchEnd", ids = [...this.down.keys()]) {
    const touchPoints = ids.map((id) => ({ id, ...this.down.get(id)! }));
    return this.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  }

  async press(id: number, at: { x: number; y: number }) {
    this.down.set(id, at);
    await this.send("touchStart");
  }

  async move(id: number, to: { x: number; y: number }, steps = 5) {
    const from = this.down.get(id)!;
    for (let i = 1; i <= steps; i++) {
      this.down.set(id, {
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
      });
      await this.send("touchMove");
    }
  }

  async lift(id: number) {
    await this.send("touchEnd", [id]);
    this.down.delete(id);
  }

  async tap(at: { x: number; y: number }) {
    await this.press(1, at);
    await this.lift(1);
  }
}

test("Offline copy shows in Settings with no connection, and the rest say they need one", async ({
  page,
}) => {
  await install(page);
  await read(page, HARBOR);
  // A key is on this device already.
  await giveDeviceKeys(page);
  await reloadOffline(page);
  await page.goto(at("/settings"));
  // Every section is listed; those that need the server say so.
  const list = page.getByRole("navigation", { name: "Settings" });
  await expect(list.getByRole("link", { name: /AI models/ })).toContainText("Needs a connection");
  await expect(list.getByRole("link", { name: /Offline copy/ })).not.toContainText(
    "Needs a connection",
  );
  await expect(list.getByRole("link", { name: /AI keys/ })).toContainText("1 key in this browser");
  await expect(page.locator(".settings-offline-banner")).toBeVisible();
  // The keys are device state: their section opens with no connection, and only Test waits.
  await list.getByRole("link", { name: /AI keys/ }).click();
  await expect(page.getByRole("note")).toContainText("Your keys stay in this browser.");
  const key = page.locator(".provider-row", { hasText: "OpenRouter" });
  await expect(key).toContainText("key sk-…-key");
  await expect(key.getByRole("button", { name: "Test", exact: true })).toBeDisabled();
  await key.getByRole("button", { name: "Replace key" }).click();
  await expect(key.getByRole("button", { name: "Test and keep on this device" })).toBeDisabled();
  await page.goBack();
  // Opening one that needs the server says why it is empty.
  await list.getByRole("link", { name: /AI models/ }).click();
  await expect(page.locator(".settings-offline-card")).toContainText("Needs a connection");
  await page.locator(".settings-offline-card").getByRole("link", { name: "Offline copy" }).click();
  const block = page.locator(".on-this-device");
  await expect(block).toContainText("On this device");
  await expect(block).toContainText(/Space used: \d+(\.\d)? (KB|MB)/);
  await expect(
    block.getByRole("button", { name: "Remove everything on this device" }),
  ).toBeVisible();
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

test("the server's answer for an entry read from the device keeps the reader's place", async ({
  page,
  context,
}) => {
  const id = "kgreread0001";
  const path = "03 Things/Keep Going Reread.md";
  const sections = Array.from(
    { length: 8 },
    (_, i) =>
      `## Section ${i + 1}\n\n` +
      Array.from({ length: 6 }, () => "Salt and brine and the grey tide. ".repeat(20)).join("\n\n"),
  ).join("\n\n");
  const made = await page.request.put("/api/drafts", {
    data: { id, path, kind: "create", text: `# Keep Going Reread\n\n${sections}\n`, revision: 0 },
  });
  expect(made.ok(), await made.text()).toBe(true);
  const top = () => page.evaluate(() => document.querySelector<HTMLElement>(".content")!.scrollTop);
  try {
    await install(page);
    await read(page, path);
    await page.evaluate(() => document.querySelector(".content")!.scrollTo({ top: 1800 }));
    await page.waitForTimeout(700);

    await reloadOffline(page);
    await expect(page.locator(".resume-line")).toBeVisible();
    expect(Math.abs((await top()) - 1800)).toBeLessThan(3);

    // The connection returns and the server answers: the page is read again, in place.
    await context.setOffline(false);
    await expect(page.locator(".connection.is-offline")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(".offline-copy")).toHaveCount(0);
    await page.waitForTimeout(700);
    // Not at the top again (the offline line going takes a few pixels of height with it).
    expect(await top()).toBeGreaterThan(1500);
    const stored = await page.evaluate(
      (p) => JSON.parse(localStorage.getItem("frontier.keepGoing.v1")!).scroll[p].y as number,
      path,
    );
    expect(stored).toBeGreaterThan(1500);
  } finally {
    await context.setOffline(false);
    await page.request.delete(`/api/drafts/${id}`);
  }
});
