import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  DEVICE_KEY,
  entry,
  noSidewaysScroll,
  openLibrary,
  openSideBar,
  setUpAi,
  proj,
  keyOf,
} from "./helpers.ts";

// Home and the rest of "keep going" in the shell (stage 25). Pins and the settings are one per
// server, so these take turns and put back what they change.
test.describe.configure({ mode: "serial" });

const SALT_FLATS = "01 Places/Salt Flats.md";
const HARBOR = "01 Places/Harbor/Harbor.md";
const MIRA = "02 People/Mira.md";

/**
 * Puts entries in this device's recents, in the shape the app writes them: the newest first, the
 * entry open now and the one before it. Reloads, since the app reads them as it starts.
 */
async function seedRecents(page: Page): Promise<void> {
  await page.goto(proj("/"));
  const key = await keyOf(page, "frontier.keepGoing.v1");
  await page.evaluate(
    ({ harbor, mira, flats, key }) => {
      const now = Date.now();
      // Midnight at the start of yesterday: always a calendar day back and more than 24 hours
      // ago, so "yesterday" is what the page says whatever the hour the test runs at.
      const yesterday = new Date(now);
      yesterday.setHours(0, 0, 0, 0);
      yesterday.setDate(yesterday.getDate() - 1);
      localStorage.setItem(
        key,
        JSON.stringify({
          recents: [
            { path: flats, title: "Salt Flats", kind: "read", at: now - 2 * 3_600_000 },
            { path: mira, title: "Mira", kind: "edited", at: yesterday.getTime() },
            { path: harbor, title: "Harbor", kind: "read", at: now - 3 * 86_400_000 },
          ],
          current: { path: flats, title: "Salt Flats" },
          previous: { path: harbor, title: "Harbor" },
          scroll: {},
          cursor: {},
        }),
      );
    },
    { harbor: HARBOR, mira: MIRA, flats: SALT_FLATS, key },
  );
  await page.reload();
  await expect(page.locator(".home h1")).toBeVisible();
}

const card = (page: Page, name: string): Locator =>
  page.locator(".home").getByRole("region", { name });
const queue = (page: Page) => card(page, "What to work on next");

/** Opens a filter of the work queue and shows all its rows. */
async function filter(page: Page, name: RegExp): Promise<Locator> {
  const chip = queue(page).getByRole("button", { name });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  const more = queue(page).getByRole("button", { name: /^Show all/ });
  if (await more.isVisible()) await more.click();
  return queue(page);
}

async function unpinAll(page: Page): Promise<void> {
  const res = await page.request.get("/api/pins");
  const { pins } = (await res.json()) as { pins: { path: string }[] };
  for (const p of pins) await page.request.delete(`/api/pins?path=${encodeURIComponent(p.path)}`);
}

test.beforeEach(async ({ page }) => {
  await unpinAll(page);
});

test("opens on Home: what to work on next, each row with its reason", async ({ page }) => {
  await page.goto(proj("/"));
  await expect(page.locator(".home h1")).toHaveText("Welcome back");
  const q = queue(page);
  // Four filters, each with its count; Needs love is the one open.
  for (const name of ["Needs love", "Wanted", "Orphans", "Dead ends"]) {
    await expect(q.getByRole("button", { name: new RegExp(`^${name} \\d+$`) })).toBeVisible();
  }
  await expect(q.getByRole("button", { name: /^Needs love/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const flats = (await filter(page, /^Needs love/)).locator("li", { hasText: "Salt Flats" });
  await expect(flats).toContainText("stub");
  await expect(flats).toContainText("linked from 3 entries");
  await expect(flats).toContainText("Marked TODO");
  await expect(flats).toContainText("Empty heading");

  const wanted = await filter(page, /^Wanted/);
  const gate = wanted.locator("li", { hasText: "The Sunken Gate" });
  await expect(gate).toContainText("Mentioned in 3 entries");
  await expect(wanted.getByRole("button", { name: /^Needs love/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  const orphans = await filter(page, /^Orphans/);
  await expect(orphans.locator("li", { hasText: "Salt Road" })).toContainText("Nothing links here");
  await expect(orphans.locator("li", { hasText: "Ruun" })).toBeVisible();

  const dead = await filter(page, /^Dead ends/);
  await expect(dead.locator("li", { hasText: "Salt Crystal" })).toContainText("Links to nothing");
  await dead
    .locator("li", { hasText: "Salt Crystal" })
    .getByRole("link", { name: /^Open/ })
    .click();
  await expect(page.locator(".entry h1").first()).toHaveText("Salt Crystal");
  await page.goBack();
  await expect(page.locator(".home h1")).toBeVisible();
  await noSidewaysScroll(page);
});

test('"Write it" opens New entry with the name and the folder filled in', async ({ page }) => {
  await page.goto(proj("/"));
  const wanted = await filter(page, /^Wanted/);
  const row = wanted.locator("li", { hasText: "The Sunken Gate" });
  const likely = /likely in (.+?)\s*$/.exec((await row.locator(".home-why").textContent()) ?? "");
  await row.getByRole("button", { name: "Write The Sunken Gate" }).click();
  const dialog = page.getByRole("dialog", { name: "New entry" });
  await expect(dialog.getByLabel("Name")).toHaveValue("The Sunken Gate");
  if (likely) {
    await expect(dialog.getByRole("combobox", { name: "Folder", exact: true })).toHaveText(
      likely[1]!,
    );
  }
  await dialog.getByRole("button", { name: "Start writing", exact: true }).click();
  await expect(page).toHaveURL(/\/edit\/.*The%20Sunken%20Gate\.md\?new=1/);
  // Nothing of it is kept if it was not written.
  const res = await page.request.get("/api/unpublished");
  const { drafts } = (await res.json()) as { drafts: { id: string; path: string }[] };
  for (const d of drafts.filter((x) => x.path.includes("The Sunken Gate"))) {
    await page.request.delete(`/api/drafts/${d.id}`);
  }
});

test("the dice: a kind, then Roll, and it says so when nothing fits", async ({ page }) => {
  await seedRecents(page);
  const dice = card(page, "Random entry");
  await expect(dice.getByRole("button", { name: "Any" })).toHaveAttribute("aria-pressed", "true");

  // A stub: some entry opens.
  await dice.getByRole("button", { name: "A stub" }).click();
  await expect(dice.getByRole("button", { name: "A stub" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dice.getByRole("button", { name: "Roll" }).click();
  await expect(page).toHaveURL(/\/e\//);
  await expect(page.locator(".entry h1").first()).toBeVisible();
  // In this folder: the folder of the last entry read. The recents are put back as seeded, since
  // the stub just opened is now the last one read, and it may be in any folder.
  await seedRecents(page);
  await dice.getByRole("button", { name: "In this folder" }).click();
  await expect(dice).toContainText("In 01 Places");
  await dice.getByRole("button", { name: "Roll" }).click();
  await expect(page).toHaveURL(/\/e\/01%20Places\//);
  await expect(page).not.toHaveURL(/Salt%20Flats/);

  // Untouched for 6 months: an entry opens, or the toast says every entry was touched lately.
  await page.goto(proj("/"));
  await dice.getByRole("button", { name: "Untouched 6 months" }).click();
  await dice.getByRole("button", { name: "Roll" }).click();
  await expect(
    page
      .getByText("Every entry was touched in the last 6 months.")
      .or(page.locator(".entry h1").first()),
  ).toBeVisible();
});

test('"In this folder" says plainly when no entry has been read', async ({ page }) => {
  await page.goto(proj("/"));
  const key = await keyOf(page, "frontier.keepGoing.v1");
  await page.evaluate((k) => localStorage.removeItem(k), key);
  await page.reload();
  const dice = card(page, "Random entry");
  await dice.getByRole("button", { name: "In this folder" }).click();
  await expect(dice).toContainText("No entry in a folder read yet");
  await dice.getByRole("button", { name: "Roll" }).click();
  await expect(page.locator(".ui-toasts")).toContainText("Read an entry in a folder first");
  await expect(page.locator(".home h1")).toBeVisible();
});

test('"In this folder" after reading a top-level entry says so and sends no request', async ({
  page,
}) => {
  await page.goto(proj("/"));
  const key = await keyOf(page, "frontier.keepGoing.v1");
  await page.evaluate(
    (k) =>
      localStorage.setItem(
        k,
        JSON.stringify({
          recents: [{ path: "Top.md", title: "Top", kind: "read", at: Date.now() }],
          current: null,
          previous: null,
          scroll: {},
          cursor: {},
        }),
      ),
    key,
  );
  await page.reload();
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/keep-going/random")) asked.push(r.url());
  });
  const dice = card(page, "Random entry");
  await dice.getByRole("button", { name: "In this folder" }).click();
  await dice.getByRole("button", { name: "Roll" }).click();
  await expect(page.locator(".ui-toasts")).toContainText("Read an entry in a folder first");
  expect(asked).toEqual([]);
});

test("on a phone the dice is a round button; on a desktop it is not", async ({ page }, info) => {
  await page.goto(proj("/"));
  const round = page.getByRole("button", { name: "Random entry", exact: true });
  if (info.project.name === "phone") {
    await expect(round).toBeVisible();
    await round.click();
    await expect(page).toHaveURL(/\/e\//);
  } else {
    await expect(page.locator(".home-fab")).toBeHidden();
  }
});

test("pick up where you left off, recently, and what was read last", async ({ page }) => {
  await seedRecents(page);
  const pick = card(page, "Pick up where you left off");
  await expect(pick.getByRole("link", { name: /Last read: Salt Flats/ })).toBeVisible();
  const recent = card(page, "Recently");
  await expect(recent.locator("li")).toHaveCount(3);
  await expect(recent.locator("li").nth(0)).toContainText("Salt Flats");
  await expect(recent.locator("li").nth(0)).toContainText("read");
  await expect(recent.locator("li").nth(1)).toContainText("Mira");
  await expect(recent.locator("li").nth(1)).toContainText("edited");
  await expect(recent.locator("li").nth(1)).toContainText("yesterday");
  await recent.getByRole("link", { name: "Mira" }).click();
  await expect(page.locator(".entry h1").first()).toHaveText("Mira");
});

test("the newest unpublished draft is offered to continue", async ({ page }) => {
  await seedRecents(page);
  const id = "kgcontinue01";
  const base = await (
    await page.request.get(`/api/entries?path=${encodeURIComponent(MIRA)}`)
  ).json();
  const saved = await page.request.put("/api/drafts", {
    data: {
      id,
      path: MIRA,
      kind: "edit",
      text: `${base.text}\nA line to continue from.\n`,
      revision: 0,
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  try {
    await page.reload();
    const pick = card(page, "Pick up where you left off");
    // Mira is the entry edited last on this device, so its draft is the one offered.
    await expect(pick).toContainText("Mira");
    await expect(pick).toContainText("Unpublished changes");
    await pick.getByRole("link", { name: "Continue editing" }).click();
    await expect(page).toHaveURL(/\/edit\/02%20People\/Mira\.md/);
  } finally {
    await page.request.delete(`/api/drafts/${id}`);
  }
});

test("pins: Working on, on Home and in the left bar, with Unpin", async ({ page }) => {
  await page.goto(proj("/"));
  const pins = card(page, "Working on");
  await expect(pins).toContainText("Pin an entry from its page");
  try {
    for (const path of [HARBOR, MIRA]) {
      const res = await page.request.post("/api/pins", { data: { path } });
      expect(res.ok(), await res.text()).toBe(true);
    }
    await page.reload();
    await expect(pins.locator("li")).toHaveCount(2);
    await expect(pins.locator("li").nth(0)).toContainText("Harbor");

    // The left bar lists them above the folders, in the same order.
    await openSideBar(page);
    const bar = page.locator(".left-bar");
    await expect(bar.getByRole("region", { name: "Working on" }).locator("li")).toHaveCount(2);
    await bar
      .getByRole("region", { name: "Working on" })
      .getByRole("link", { name: "Mira" })
      .click();
    await expect(page.locator(".entry h1").first()).toHaveText("Mira");

    // Unpin from Home: gone from Home and from the bar.
    await page.goto(proj("/"));
    await pins.getByRole("button", { name: "Unpin Harbor" }).click();
    await expect(pins.locator("li")).toHaveCount(1);
    await expect(pins).not.toContainText("Harbor");
    await openSideBar(page);
    await expect(
      page.locator(".left-bar").getByRole("region", { name: "Working on" }).locator("li"),
    ).toHaveCount(1);
  } finally {
    await unpinAll(page);
  }
});

test("quick switcher: opened empty it shows the way back, the dice and the recents", async ({
  page,
}) => {
  await seedRecents(page);
  await page.keyboard.press("Control+k");
  const box = page.getByRole("dialog", { name: "Find an entry" });
  const options = box.getByRole("option");
  await expect(options.nth(0)).toContainText("Back to last: Salt Flats");
  await expect(options.nth(1)).toContainText("Random entry");
  await expect(options.nth(2)).toContainText("Salt Flats");
  await expect(options.nth(2)).toContainText("read");
  await expect(options.nth(3)).toContainText("Mira");
  await expect(options.nth(3)).toContainText("edited");
  await expect(options).toHaveCount(5);
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");

  // The arrows reach the new rows, and Enter opens the chosen one.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(3)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(entry(MIRA).replace(/ /g, "%20"));

  // Typing replaces the list with the search; a stub carries its tag.
  await page.keyboard.press("Control+k");
  await box.getByRole("searchbox").fill("salt fl");
  await expect(options.first()).toContainText("Salt Flats");
  await expect(options.first()).toContainText("stub");
  await expect(box).not.toContainText("Back to last");
  await page.keyboard.press("Escape");

  // The dice row opens some entry.
  await page.goto(proj("/"));
  await expect(page.locator(".home h1")).toBeVisible();
  await page.keyboard.press("Control+k");
  await box.getByRole("option", { name: /^Random entry/ }).click();
  await expect(page).toHaveURL(/\/e\//);
});

test("quick switcher with no recents shows only the dice", async ({ page }) => {
  await page.goto(proj("/"));
  const key = await keyOf(page, "frontier.keepGoing.v1");
  await page.evaluate((k) => localStorage.removeItem(k), key);
  await page.reload();
  await expect(page.locator(".home h1")).toBeVisible();
  await page.keyboard.press("Control+k");
  const options = page.getByRole("dialog", { name: "Find an entry" }).getByRole("option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("Random entry");
});

test("g h goes Home and g r opens a random entry; both are on the key sheet", async ({ page }) => {
  await page.goto(entry(SALT_FLATS));
  await expect(page.locator(".entry h1").first()).toHaveText("Salt Flats");
  await page.keyboard.press("g");
  await page.keyboard.press("r");
  await expect(page).toHaveURL(/\/e\//);
  await expect(page).not.toHaveURL(/Salt%20Flats/);
  await expect(page.locator(".entry h1").first()).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".home h1")).toBeVisible();

  // A key alone does nothing, and typing in a field is left alone.
  await page.keyboard.press("h");
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press("?");
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Go to Home");
  await expect(sheet).toContainText("G then H");
  await expect(sheet).toContainText("Open a random entry");
});

test("the left bar: Home, Random entry under New entry, and stub counts on the top folders", async ({
  page,
  isMobile,
}) => {
  await page.goto(entry(SALT_FLATS));
  await openLibrary(page);
  // 01 Places holds stubs: Salt Flats, Harbor, Old Quay. (On a phone the folders are in the
  // library panel, and Escape goes back to the menu.)
  const places = page.locator('.tree-row[data-path="01 Places"]');
  await expect(places.locator(".tree-mark.is-stubs")).toHaveText(/^\d+ stubs?$/);
  await expect(places.locator(".tree-mark.is-stubs")).toHaveAttribute("title", /of \d+ entries/);
  if (isMobile) await page.keyboard.press("Escape");
  const bar = page.locator(".left-bar");
  const actions = bar.locator(".left-actions");
  await expect(actions.locator("button").nth(0)).toContainText(/New entry|Search/);
  await expect(actions.getByRole("button", { name: "Random entry" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Home" })).toBeVisible();

  await actions.getByRole("button", { name: "Random entry" }).click();
  await expect(page).toHaveURL(/\/e\//);
  await expect(page).not.toHaveURL(/Salt%20Flats/);
  await openSideBar(page);
  await page.locator(".left-bar").getByRole("link", { name: "Home" }).click();
  await expect(page.locator(".home h1")).toBeVisible();
});

test("the rail keeps Home and the dice as icons", async ({ page, isMobile }) => {
  test.skip(isMobile, "A phone has a drawer instead of the rail.");
  await page.goto(proj("/"));
  await expect(page.locator(".home h1")).toBeVisible();
  await page.keyboard.press("Control+\\");
  const side = page.locator(".side");
  await expect(side).toHaveClass(/is-rail/);
  await expect(side.getByRole("link", { name: "Home" })).toBeVisible();
  await side.getByRole("button", { name: "Random entry" }).click();
  await expect(page).toHaveURL(/\/e\//);
  await page.keyboard.press("Control+\\");
  await expect(side).not.toHaveClass(/is-rail/);
});

test("a folder in Folders shows it in the tree", async ({ page }) => {
  await page.goto(proj("/"));
  const folders = card(page, "Folders");
  await expect(folders.locator("li", { hasText: "01 Places" })).toContainText(
    /\d+ of \d+ are stubs/,
  );
  await folders.getByRole("button", { name: "01 Places" }).click();
  await expect(page.locator('.tree-row[data-path="01 Places"]')).toBeVisible();
});

test("Settings › Keep going: the six rules switch off and on, and Home follows", async ({
  page,
}) => {
  await page.goto(proj("/"));
  const count = async () => {
    const text = await queue(page)
      .getByRole("button", { name: /^Needs love/ })
      .textContent();
    return Number(/(\d+)$/.exec(text ?? "")![1]);
  };
  await expect(queue(page).getByRole("button", { name: /^Needs love \d+/ })).toBeVisible();
  const before = await count();

  await page.goto(proj("/settings/library/keep-going"));
  const labels = [
    "Stubs that many entries link to",
    "Headings with nothing under them",
    "Entries with no type",
    "Longer entries with no picture",
    "Entries with open comments",
    "Entries marked TODO, TBD or ??",
  ];
  for (const label of labels) await expect(page.getByLabel(label)).toBeChecked();
  await noSidewaysScroll(page);
  try {
    await page.getByLabel("Entries with no type").uncheck();
    await expect(page.getByText("Saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Entries with no type")).not.toBeChecked();

    await page.goto(proj("/"));
    await expect(queue(page).getByRole("button", { name: /^Needs love \d+/ })).toBeVisible();
    expect(await count()).toBeLessThan(before);
    const rows = await filter(page, /^Needs love/);
    await expect(rows).not.toContainText("No type");
  } finally {
    await page.goto(proj("/settings/library/keep-going"));
    await page.getByLabel("Entries with no type").check();
    await expect(page.getByLabel("Entries with no type")).toBeChecked();
    await expect(page.getByText("Saved")).toBeVisible();
  }
});

test("empty states: a new library, and a library with nothing that needs love", async ({
  page,
}) => {
  const real = await (await page.request.get("/api/keep-going/queue")).json();
  const none = { total: 0, rows: [] };

  await page.route("**/api/p/*/keep-going/queue", (route) =>
    route.fulfill({
      json: {
        ...real,
        needsLove: none,
        wanted: none,
        orphans: none,
        deadEnds: none,
        folders: [],
        entries: 0,
      },
    }),
  );
  await page.goto(proj("/"));
  await expect(page.locator(".home h1")).toHaveText("Welcome to Frontier");
  await expect(card(page, "Write your first entry")).toContainText("no entries yet");
  await expect(page.getByRole("region", { name: "What to work on next" })).toHaveCount(0);
  await card(page, "Write your first entry").getByRole("button", { name: "New entry" }).click();
  await expect(page.getByRole("dialog", { name: "New entry" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.unroute("**/api/p/*/keep-going/queue");
  await page.route("**/api/p/*/keep-going/queue", (route) =>
    route.fulfill({
      json: { ...real, needsLove: none, wanted: none, orphans: none, deadEnds: none },
    }),
  );
  await page.goto(proj("/"));
  await expect(queue(page)).toContainText(
    "Every entry has a type, a picture and some text. Pick a random one to reread.",
  );
});

test("the queue fails in its own card and can be tried again", async ({ page }) => {
  let fail = true;
  await page.route("**/api/p/*/keep-going/queue", (route) =>
    fail
      ? route.fulfill({
          status: 500,
          json: { error: { code: "boom", message: "The index is broken." } },
        })
      : route.continue(),
  );
  await page.goto(proj("/"));
  await expect(queue(page).getByRole("alert")).toContainText("The index is broken.");
  // The rest of the page is still there.
  await expect(card(page, "Random entry")).toBeVisible();
  fail = false;
  await queue(page).getByRole("button", { name: "Retry" }).click();
  await expect(queue(page).getByRole("button", { name: /^Needs love \d+$/ })).toBeVisible();
});

test.describe("the question of the day (AI)", () => {
  let before: string | null = null;
  test.beforeAll(async ({ browser }, info) => {
    if (info.project.name !== "desktop") return;
    const page = await browser.newPage({
      storageState: "test-results/.auth.json",
      baseURL: `http://localhost:${process.env.E2E_PORT ?? 3987}`,
    });
    const res = await page.request.get("/api/settings");
    before = ((await res.json()) as { ai: { models: { conversation: string | null } } }).ai.models
      .conversation;
    await page.close();
  });
  test.afterAll(async ({ browser }, info) => {
    if (info.project.name !== "desktop") return;
    const page = await browser.newPage({
      storageState: "test-results/.auth.json",
      baseURL: `http://localhost:${process.env.E2E_PORT ?? 3987}`,
    });
    const res = await page.request.put("/api/settings/ai", {
      data: { models: { conversation: before } },
    });
    expect(res.ok(), await res.text()).toBe(true);
    await page.close();
  });

  test("hidden with no model, a button when today has none, then a question to answer", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop", "The AI settings are one per server.");
    const off = await page.request.put("/api/settings/ai", {
      data: { models: { conversation: null } },
    });
    expect(off.ok(), await off.text()).toBe(true);
    await page.goto(proj("/"));
    await expect(queue(page)).toBeVisible();
    await expect(card(page, "A question to answer")).toHaveCount(0);

    await setUpAi(page, { conversation: "sample/reader" });
    await page.goto(proj("/"));
    const q = card(page, "A question to answer");
    // Never made without a click the first time.
    await expect(q.getByRole("button", { name: "Give me a question" })).toBeVisible();
    await expect(q.locator("q")).toHaveCount(0);
    await q.getByRole("button", { name: "Give me a question" }).click();
    await expect(q.locator("q")).toContainText("smell like");
    await expect(q.getByRole("link", { name: /^Answer it in / })).toHaveAttribute(
      "href",
      /^\/p\/sample\/edit\//,
    );

    // Kept for the day: a reload shows it without asking again.
    await page.reload();
    await expect(q.locator("q")).toContainText("smell like");
    await expect(q.getByRole("button", { name: "Give me a question" })).toHaveCount(0);

    await q.getByRole("button", { name: "Another question" }).click();
    await expect(q.locator("q")).toContainText("smell like");
    await q.getByRole("link", { name: /^Answer it in / }).click();
    await expect(page).toHaveURL(/\/edit\//);
  });

  test("with no key on this device, the first ask explains and then carries on (stage 27f)", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop", "The AI settings are one per server.");
    await setUpAi(page, { conversation: "sample/reader" }, { key: false });
    await page.goto(proj("/"));
    const q = card(page, "A question to answer");
    // A question kept for the day by an earlier test is asked for again; either way it is a click.
    const ask = q
      .getByRole("button", { name: "Give me a question" })
      .or(q.getByRole("button", { name: "Another question" }));
    await ask.click();
    const explain = page.getByRole("dialog", {
      name: "The question of the day runs on your own AI key",
    });
    await expect(explain).toContainText("The key is kept on this device only.");
    await explain.getByLabel("Key", { exact: true }).fill(DEVICE_KEY);
    await explain.getByRole("button", { name: "Test and keep on this device" }).click();
    await expect(explain).toHaveCount(0);
    await expect(q.locator("q")).toContainText("smell like");
  });
});
