import { expect, type Page, test } from "@playwright/test";
import { edit, entry, noSidewaysScroll, review, setUpAi } from "./helpers.ts";

/**
 * Stage 25, the entry's half: back to last, resume position, pins, "From here", next and previous
 * in the folder, and what follows Publish. On the made-up sample vault: Salt Road names two
 * entries that do not exist and links the stub Salt Flats; Harbor is named, not linked, in Salt
 * Road; Brine Works names Mira without linking her.
 */

const HARBOR = "01 Places/Harbor/Harbor.md";
const SALT_ROAD = "01 Places/Salt Road.md";

/** Whether the page area has scrolled, and how far. */
const scrolled = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLElement>(".content")!.scrollTop);

/** The link back to the last entry: a chip in the bar on a desktop, an arrow on a phone. */
const lastLink = (page: Page, name: string) =>
  page.getByRole("link", { name: new RegExp(`^(Last: |Back to )${name}$`) });

/** Waits for what the reader keeps on the device to be written, which is a moment after a scroll. */
const kept = (page: Page) => page.waitForTimeout(700);

/** The entries either side of one in its folder, as the library has them. */
async function neighbours(
  page: Page,
  path: string,
): Promise<{
  previous: { path: string; title: string } | null;
  next: { path: string; title: string } | null;
}> {
  const res = await page.request.get(`/api/keep-going/from-here?path=${encodeURIComponent(path)}`);
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

/** An entry that exists only as a draft, long enough to scroll, with a heading to say where. */
async function tallDraft(page: Page, id: string): Promise<string> {
  const path = "03 Things/Keep Going Tall.md";
  const sections = Array.from(
    { length: 8 },
    (_, i) =>
      `## Section ${i + 1}\n\n` +
      Array.from({ length: 6 }, () => "Salt and brine and the grey tide. ".repeat(20)).join("\n\n"),
  ).join("\n\n");
  const made = await page.request.put("/api/drafts", {
    data: { id, path, kind: "create", text: `# Keep Going Tall\n\n${sections}\n`, revision: 0 },
  });
  expect(made.ok(), await made.text()).toBe(true);
  return path;
}

test.describe("back to last", () => {
  test("a chip in the bar, an arrow on a phone, and Alt+Left", async ({ page }) => {
    await page.goto(entry(HARBOR));
    await expect(page.locator(".entry h1").first()).toHaveText("Harbor");

    await page.goto(entry(SALT_ROAD));
    await expect(page.locator(".entry h1").first()).toHaveText("Salt Road");
    await expect(lastLink(page, "Harbor")).toBeVisible();

    // Alt+Left goes back, and the entry left becomes the last one.
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
    await expect(lastLink(page, "Salt Road")).toBeVisible();
    await lastLink(page, "Salt Road").click();
    await expect(page.locator(".entry h1").first()).toHaveText("Salt Road");
    await noSidewaysScroll(page);
  });

  test("lists its keys in the sheet, and leaves the editor's text its own", async ({ page }) => {
    await page.goto(entry(HARBOR));
    await page.goto(entry(SALT_ROAD));
    await expect(page.locator(".entry h1").first()).toHaveText("Salt Road");
    await page.keyboard.press("?");
    const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(sheet).toContainText("Back to the last entry viewed");
    await expect(sheet).toContainText("Previous entry in the folder");
    await expect(sheet).toContainText("Pin or unpin the entry");
    await page.keyboard.press("Escape");

    // In the editor Alt+Left is the text's: it moves the cursor, and the page stays.
    await page.goto(edit("03 Things/Brine Works.md"));
    await page.locator(".cm-content").click();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page).toHaveURL(/\/edit\//);
    await expect(page.locator(".cm-content")).toContainText("The boiling takes");
    // An entry edited is among the last ones: it is "Last" in the reader that follows.
    await page.goto(entry(HARBOR));
    await expect(lastLink(page, "Brine Works")).toBeVisible();
  });
});

test("g h and g r keep out while the key sheet is open", async ({ page }) => {
  await page.goto(entry(HARBOR));
  await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
  await page.keyboard.press("?");
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet).toBeVisible();
  for (const second of ["h", "r"]) {
    await page.keyboard.press("g");
    await page.keyboard.press(second);
  }
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent("Harbor")}`));
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await expect(page.locator(".home h1")).toBeVisible();
});

test.describe("where reading stopped", () => {
  test("opens there, says so, and starts from the top on request", async ({ page }) => {
    const id = "kgresume0001";
    const path = await tallDraft(page, id);
    try {
      await page.goto(entry(path));
      await expect(page.locator(".entry h1").first()).toHaveText("Keep Going Tall");
      // Not resumed the first time: there was no earlier stop.
      await expect(page.locator(".resume-line")).toHaveCount(0);
      await page.evaluate(() => document.querySelector(".content")!.scrollTo({ top: 1800 }));
      await kept(page);

      await page.reload();
      await expect(page.locator(".entry h1").first()).toBeAttached();
      const line = page.locator(".resume-line");
      await expect(line).toContainText(/Back where you stopped, under “Section \d”\./);
      expect(Math.abs((await scrolled(page)) - 1800)).toBeLessThan(3);
      await noSidewaysScroll(page);

      // Reached by an address that names a heading: there it opens, and says nothing of a stop.
      await page.goto(entry(HARBOR));
      await page.goto(`${entry(path)}#Section%202`);
      await expect(page.locator(".entry h1").first()).toBeAttached();
      await expect(page.locator(".resume-line")).toHaveCount(0);

      // Scrolled again: a link to it resumes, and the browser's own back does not.
      await page.evaluate(() => document.querySelector(".content")!.scrollTo({ top: 1800 }));
      await kept(page);
      await page.goto(entry(HARBOR));
      await lastLink(page, "Keep Going Tall").click();
      await expect(line).toBeVisible();
      await lastLink(page, "Harbor").click();
      await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
      await page.goBack();
      await expect(page.locator(".entry h1").first()).toHaveText("Keep Going Tall");
      await expect(line).toHaveCount(0);

      // "Start from the top" forgets the stop.
      await page.evaluate(() => document.querySelector(".content")!.scrollTo({ top: 1800 }));
      await kept(page);
      await page.goto(entry(HARBOR));
      await lastLink(page, "Keep Going Tall").click();
      await expect(line).toBeVisible();
      await line.getByRole("button", { name: "Start from the top" }).click();
      await expect(line).toHaveCount(0);
      await expect.poll(() => scrolled(page)).toBe(0);
      await kept(page);
      await page.goto(entry(HARBOR));
      await lastLink(page, "Keep Going Tall").click();
      await expect(page.locator(".entry h1").first()).toHaveText("Keep Going Tall");
      await expect(line).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/drafts/${id}`);
    }
  });

  test("an entry that is not far read opens at its top", async ({ page }) => {
    await page.goto(entry(HARBOR));
    await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
    await kept(page);
    await page.reload();
    await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
    await expect(page.locator(".resume-line")).toHaveCount(0);
  });

  test("the editor opens with the cursor where it was", async ({ page }) => {
    const brine = edit("03 Things/Brine Works.md");
    await page.goto(brine);
    await page.locator(".cm-content").click();
    // The end of the text is an empty line; the line above is the last paragraph.
    await page.keyboard.press("Control+End");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(".cm-activeLine")).toContainText("The boiling takes");
    await kept(page);
    await page.goto(entry(HARBOR));
    await page.goto(brine);
    await expect(page.locator(".cm-content")).toContainText("The boiling takes");
    await expect(page.locator(".cm-activeLine")).toContainText("The boiling takes");
    // Nothing was typed, so nothing was kept as a draft.
    const text = await (
      await page.request.get(`/api/entries?path=${encodeURIComponent("03 Things/Brine Works.md")}`)
    ).json();
    expect(text.draft).toBeNull();
  });
});

test("pins the entry from the bar, the phone's top line, and the p key", async ({ page }) => {
  await page.goto(entry(HARBOR));
  const pin = page.getByRole("button", { name: "Pin to Working on" });
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  try {
    await pin.click();
    await expect(page.locator(".ui-toast")).toContainText("Pinned “Harbor” to Working on.");
    await expect(pin).toHaveAttribute("aria-pressed", "true");
    const pins = await (await page.request.get("/api/pins")).json();
    expect(pins.pins.map((p: { path: string }) => p.path)).toContain(HARBOR);

    await page.keyboard.press("p");
    await expect(page.locator(".ui-toast")).toContainText("Unpinned “Harbor”.");
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("p");
    await expect(pin).toHaveAttribute("aria-pressed", "true");
  } finally {
    await page.request.delete(`/api/pins?path=${encodeURIComponent(HARBOR)}`);
    // The pins file is a library file with its own draft; it goes, so later tests start clean.
    const { drafts } = (await (await page.request.get("/api/unpublished")).json()) as {
      drafts: { id: string; path: string }[];
    };
    for (const d of drafts.filter((d) => d.path === ".frontier/pins.json")) {
      await page.request.delete(`/api/drafts/${d.id}`);
    }
  }
  // The key is the reader's only: typed in a field it is a letter.
  await page.reload();
  await page.getByRole("button", { name: "Search" }).first().click();
  await page.keyboard.type("p");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Pin to Working on" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("p twice quickly makes one change, and a pin made elsewhere shows when the page returns", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/pins")) asked.push(r.method());
  });
  const clean = async () => {
    await page.request.delete(`/api/pins?path=${encodeURIComponent(HARBOR)}`);
    const { drafts } = (await (await page.request.get("/api/unpublished")).json()) as {
      drafts: { id: string; path: string }[];
    };
    for (const d of drafts.filter((d) => d.path === ".frontier/pins.json")) {
      await page.request.delete(`/api/drafts/${d.id}`);
    }
  };
  try {
    await page.goto(entry(HARBOR));
    const pin = page.getByRole("button", { name: "Pin to Working on" });
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("p");
    await page.keyboard.press("p");
    await expect(pin).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(300);
    expect(asked).toEqual(["POST"]);
    await page.request.delete(`/api/pins?path=${encodeURIComponent(HARBOR)}`);

    // Another device unpinned it; this page hears of it when it is shown again after a while.
    await page.clock.install();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(90_000);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(pin).toHaveAttribute("aria-pressed", "false");
  } finally {
    await clean();
  }
});

test.describe("From here", () => {
  test("shows what is missing, thin neighbours and related entries; Write opens New entry", async ({
    page,
  }) => {
    await page.goto(entry(SALT_ROAD));
    const strip = page.locator(".fh");
    await expect(strip.getByRole("heading", { name: "From here" })).toBeVisible();

    const missing = strip.locator(".fh-card", { hasText: "Missing from this entry" });
    await expect(missing).toContainText("The Sunken Gate");
    await expect(missing).toContainText("Tide Singers");
    await expect(missing.locator(".fh-when").first()).toContainText(/\d entries/);

    // Write: the New entry dialog, with the name and the folder most mentioning it are in.
    await missing.getByRole("button", { name: "Write The Sunken Gate" }).click();
    const dialog = page.getByRole("dialog", { name: "New entry" });
    await expect(dialog.getByLabel("Name")).toHaveValue("The Sunken Gate");
    await expect(dialog.getByRole("combobox")).toContainText("01 Places");
    await dialog.getByRole("button", { name: "Make the entry" }).click();
    await expect(page).toHaveURL(/\/edit\/01%20Places\/The%20Sunken%20Gate\.md\?new=1/);
    await expect(page.locator(".cm-content")).toContainText("The Sunken Gate");

    // Close by, and thin: the stub, with the reasons as tags.
    await page.goto(entry(SALT_ROAD));
    const thin = page.locator(".fh-card", { hasText: "Close by, and thin" });
    await expect(thin.getByRole("link", { name: "Salt Flats" })).toBeVisible();
    await expect(thin.locator(".fh-tag", { hasText: "stub" })).toBeVisible();
    await expect(thin.locator(".fh-tag", { hasText: "empty headings" })).toBeVisible();
    await expect(thin).toContainText("words");

    // Related: entries sharing links, not linked directly.
    const related = page.locator(".fh-card", { hasText: "Related" });
    await expect(related.getByRole("link").first()).toBeVisible();
    await expect(related).toContainText("shared");
    await noSidewaysScroll(page);
  });

  test("leaves out groups with nothing to show, and the strip when there is none", async ({
    page,
  }) => {
    await page.goto(entry("03 Things/Salt Crystal.md"));
    await expect(page.locator(".entry h1").first()).toHaveText("Salt Crystal");
    await expect(page.locator(".fh-card", { hasText: "Missing from this entry" })).toHaveCount(0);
    await expect(page.locator(".fh-card", { hasText: "Named here, not linked" })).toHaveCount(0);

    // An entry that exists only as a draft has an empty strip, and is quiet about it.
    const id = "kgempty00001";
    const path = await tallDraft(page, id);
    try {
      await page.goto(entry(path));
      await expect(page.locator(".entry h1").first()).toHaveText("Keep Going Tall");
      for (const group of ["Missing from this entry", "Named here", "Close by", "Related"]) {
        await expect(page.locator(".fh-card", { hasText: group })).toHaveCount(0);
      }
      await expect(page.getByRole("button", { name: "Pin to Working on" })).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/drafts/${id}`);
    }
  });

  test("is quiet when it cannot be read", async ({ page }) => {
    await page.route("**/api/keep-going/from-here*", (route) => route.abort());
    await page.goto(entry(HARBOR));
    await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
    // Who links here is read with the entry, so it stays.
    await expect(page.locator(".backlinks")).toBeVisible();
    await expect(page.locator(".fh-neighbours")).toHaveCount(0);
    for (const group of ["Missing from this entry", "Named here", "Close by", "Related"]) {
      await expect(page.locator(".fh-card", { hasText: group })).toHaveCount(0);
    }
  });

  test("Link it saves a draft of the other entry, says so, and Undo takes it back", async ({
    page,
  }) => {
    await page.goto(entry(HARBOR));
    const card = page.locator(".fh-card", { hasText: "Named here, not linked" });
    const row = card.locator(".fh-mention", { hasText: "Salt Road" });
    // The sentence, with the name emphasised.
    await expect(row.locator(".fh-at")).toHaveText("Harbor");
    await expect(row).toContainText("the first thing a traveller sees is the Harbor");

    await row.getByRole("button", { name: "Link it" }).click();
    await expect(row).toContainText("Linked, in drafts");
    await expect(page.locator(".ui-toast")).toContainText("Linked in Salt Road");
    const drafted = await (
      await page.request.get(`/api/entries?path=${encodeURIComponent(SALT_ROAD)}`)
    ).json();
    expect(drafted.draft).not.toBeNull();
    expect(drafted.text).toContain("[[Harbor]]");

    await page.locator(".ui-toast").getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".ui-toast")).toContainText("Took the link back out of Salt Road");
    await expect(row.getByRole("button", { name: "Link it" })).toBeVisible();
    const undone = await (
      await page.request.get(`/api/entries?path=${encodeURIComponent(SALT_ROAD)}`)
    ).json();
    expect(undone.draft).toBeNull();
    expect(undone.text).not.toContain("[[Harbor]]");
  });

  test("says why a link or an undo is refused", async ({ page }) => {
    await page.goto(entry(HARBOR));
    const row = page.locator(".fh-mention", { hasText: "Salt Road" });

    // The mention is gone: nothing is linked and the row goes.
    await page.route("**/api/keep-going/link-it", (route) =>
      route.fulfill({
        status: 404,
        json: { error: { code: "not_found", message: "There is no such mention." } },
      }),
    );
    await row.getByRole("button", { name: "Link it" }).click();
    await expect(page.locator(".ui-toast")).toContainText("no longer names it");
    await expect(row).toHaveCount(0);

    // The entry cannot be changed here.
    await page.reload();
    await page.unroute("**/api/keep-going/link-it");
    await page.route("**/api/keep-going/link-it", (route) =>
      route.fulfill({
        status: 403,
        json: { error: { code: "not_allowed", message: "Not allowed." } },
      }),
    );
    await row.getByRole("button", { name: "Link it" }).click();
    await expect(row.locator(".fh-refused")).toContainText("read-only, or has texts to compare");
    await expect(row.getByRole("button", { name: "Link it" })).toBeVisible();

    // A real link, whose undo is refused because the draft was edited since.
    await page.reload();
    await page.unroute("**/api/keep-going/link-it");
    const made = page.waitForResponse(
      (r) => r.url().endsWith("/api/keep-going/link-it") && r.request().method() === "POST",
    );
    await row.getByRole("button", { name: "Link it" }).click();
    const { undo } = await (await made).json();
    await page.route("**/api/keep-going/link-it/undo", (route) =>
      route.fulfill({
        status: 403,
        json: { error: { code: "not_allowed", message: "Not allowed." } },
      }),
    );
    await page.locator(".ui-toast").getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".ui-toast")).toContainText("Undo the link in its editor");
    await page.locator(".ui-toast").getByRole("button", { name: "Open" }).click();
    await expect(page).toHaveURL(/\/edit\/01%20Places\/Salt%20Road\.md/);
    // Put right for the tests that follow.
    await page.unroute("**/api/keep-going/link-it/undo");
    const back = await page.request.post("/api/keep-going/link-it/undo", { data: undo });
    expect(back.ok(), await back.text()).toBe(true);
  });

  test("shows the first three mentions, and the others on request", async ({ page }) => {
    const names = [
      ["03 Things/Brine Works.md", "Brine Works"],
      ["02 People/Ruun.md", "Ruun"],
      ["03 Things/Lantern.md", "Lantern"],
      ["03 Things/Rope.md", "Rope"],
      ["03 Things/Knot.md", "Knot"],
    ] as const;
    await page.route("**/api/keep-going/from-here*", async (route) => {
      const res = await route.fetch();
      const data = await res.json();
      data.unlinked = names.map(([path, title]) => ({
        path,
        title,
        sentence: `The ${title} sits by the Harbor.`,
        at: [title.length + 15, title.length + 21],
        name: "Harbor",
      }));
      data.unlinkedMore = true;
      await route.fulfill({ response: res, json: data });
    });
    await page.goto(entry(HARBOR));
    const card = page.locator(".fh-card", { hasText: "Named here, not linked" });
    await expect(card.locator(".fh-mention")).toHaveCount(3);
    await expect(card).toContainText("5+ entries");
    await card.getByRole("button", { name: "Show the other 2" }).click();
    await expect(card.locator(".fh-mention")).toHaveCount(5);
    await expect(card).toContainText("More entries than these name it");
    await expect(card.getByRole("button", { name: /^Show the other/ })).toHaveCount(0);
  });

  test("emphasises the name as the sentence writes it", async ({ page }) => {
    await page.goto(entry("02 People/Mira.md"));
    const row = page.locator(".fh-mention", { hasText: "Brine Works" });
    await expect(row.locator(".fh-at")).toHaveText("Mira");
  });
});

test.describe("What's missing (AI)", () => {
  test.beforeEach(async ({ page }) => {
    await setUpAi(page, { conversation: "sample/reader" });
  });

  test("reads the entry on request, proposes entries and questions, and drafts one", async ({
    page,
  }) => {
    await page.goto(entry(SALT_ROAD));
    const card = page.locator(".fh-card", { hasText: "What's missing" });
    await expect(card.locator(".fh-ai-tag")).toHaveText("AI");
    // Nothing is read until it is asked for.
    await expect(card.locator(".fh-mention")).toHaveCount(0);
    await card.getByRole("button", { name: "What's missing here?" }).click();
    await expect(card.locator(".fh-mention")).toHaveCount(2);
    await expect(card).toContainText("Salt Road Keeper");
    await expect(card).toContainText("Salt Road Festival");
    await expect(card).toContainText("Open questions.");

    // "Draft this entry" goes through the ordinary draft of an entry.
    await card.getByRole("button", { name: "Draft this entry" }).first().click();
    const draft = page.locator(".fh .ed");
    await expect(draft).toBeVisible({ timeout: 20_000 });
    await expect(draft).toContainText("Salt Road Keeper");
    await noSidewaysScroll(page);
  });

  test("can be stopped, and says why it failed", async ({ page }) => {
    await page.goto(entry(SALT_ROAD));
    const card = page.locator(".fh-card", { hasText: "What's missing" });

    // Held up: Stop puts the button back.
    await page.route("**/api/keep-going/whats-missing", () => new Promise(() => undefined));
    await card.getByRole("button", { name: "What's missing here?" }).click();
    await expect(card).toContainText("Reading this entry and its neighbours");
    await card.getByRole("button", { name: "Stop" }).click();
    await expect(card.getByRole("button", { name: "What's missing here?" })).toBeVisible();

    // No model, with where to put it right.
    await page.unroute("**/api/keep-going/whats-missing");
    await page.route("**/api/keep-going/whats-missing", (route) =>
      route.fulfill({
        status: 409,
        json: {
          error: {
            code: "ai_off",
            message: "No model is chosen for lore conversations.",
            href: "/settings/ai/models/conversation",
          },
        },
      }),
    );
    await card.getByRole("button", { name: "What's missing here?" }).click();
    await expect(card.getByRole("alert")).toContainText("No model is chosen");
    await expect(card.getByRole("link", { name: "Open Settings" })).toHaveAttribute(
      "href",
      "/settings/ai/models/conversation",
    );
    await card.getByRole("button", { name: "Retry" }).click();
    await expect(card.getByRole("alert")).toBeVisible();
  });
});

test.describe("next and previous in the folder", () => {
  test("two links at the foot, and Alt+Up and Alt+Down", async ({ page }) => {
    // The neighbours are the library's to say, whatever other tests have added to the folder.
    const { previous, next } = await neighbours(page, SALT_ROAD);
    expect(previous).not.toBeNull();
    expect(next).not.toBeNull();
    await page.goto(entry(SALT_ROAD));
    const nav = page.getByRole("navigation", { name: "In 01 Places" });
    await expect(nav.getByRole("link", { name: /Previous in 01 Places/ })).toContainText(
      previous!.title,
    );
    await expect(nav.getByRole("link", { name: /Next in 01 Places/ })).toContainText(next!.title);

    await page.keyboard.press("Alt+ArrowDown");
    await expect(page.locator(".entry h1").first()).toHaveText(next!.title);
    await page.keyboard.press("Alt+ArrowUp");
    await expect(page.locator(".entry h1").first()).toHaveText("Salt Road");
    await page.keyboard.press("Alt+ArrowUp");
    await expect(page.locator(".entry h1").first()).toHaveText(previous!.title);
    await nav.getByRole("link", { name: /Next in 01 Places/ }).click();
    await expect(page.locator(".entry h1").first()).toHaveText("Salt Road");
  });

  test("an end of the folder has one link, and its key does nothing", async ({ page }) => {
    // The last entry of the folder, found by following Next.
    let last = SALT_ROAD;
    for (let n = await neighbours(page, last); n.next; n = await neighbours(page, last)) {
      last = n.next.path;
    }
    await page.goto(entry(last));
    await expect(page.locator(".entry h1").first()).toHaveText(
      (last.split("/").pop() ?? "").replace(/\.md$/, ""),
    );
    const nav = page.getByRole("navigation", { name: "In 01 Places" });
    await expect(nav.getByRole("link")).toHaveCount(1);
    await page.keyboard.press("Alt+ArrowDown");
    await expect(page).toHaveURL(entry(last));
  });
});

test("the backlinks are one line that opens to the full list", async ({ page }) => {
  await page.goto(entry(HARBOR));
  const line = page.locator(".backlinks");
  await expect(line).toContainText(/^Linked from \d+ entries: .+ and \d+ more/);
  const full = line.locator("details");
  await expect(full).not.toHaveAttribute("open", "");
  await line.locator("summary").click();
  await expect(full).toHaveAttribute("open", "");
  await expect(line.getByRole("link", { name: "Old Quay" })).toBeVisible();
  // An entry few link to names them all, with links.
  await page.goto(entry("01 Places/Salt Flats.md"));
  await expect(page.locator(".backlinks")).toContainText(/^Linked from 3 entries: /);
  await expect(page.locator(".backlinks").getByRole("link", { name: "Ruun" })).toBeVisible();
});

test.describe("after Publish", () => {
  /** A draft of Salt Road to publish; Publish itself is held back, so the library stays as it is. */
  async function draftToPublish(page: Page, id: string): Promise<void> {
    const now = await (
      await page.request.get(`/api/entries?path=${encodeURIComponent(SALT_ROAD)}`)
    ).json();
    const saved = await page.request.put("/api/drafts", {
      data: {
        id,
        path: SALT_ROAD,
        kind: "edit",
        text: `${now.text}\nA line for the nudge.\n`,
        revision: 0,
        baseBlob: now.blob,
      },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    await page.route("**/api/publish/confirm", (route) =>
      route.fulfill({ json: { commit: "0123456789abcdef" } }),
    );
  }

  async function publish(page: Page): Promise<void> {
    await review(page);
    await page.fill(".field input", "A line for the nudge");
    await page.locator(".plan button.big").click();
  }

  test("offers up to three next steps, which Open, Write and Roll act on", async ({ page }) => {
    const id = "kgnudge00001";
    await draftToPublish(page, id);
    try {
      await publish(page);
      const nudge = page.locator(".nudge");
      await expect(nudge).toContainText("Published.");
      // A stub it links to, a missing link, and a random entry untouched for six months.
      await expect(nudge.locator("li")).toHaveCount(3);
      await expect(nudge.locator(".nudge-stub")).toContainText("Salt Road links to");
      await expect(nudge.locator(".nudge-missing")).toContainText(/does not exist yet/);
      await expect(nudge.locator(".nudge-old")).toContainText("6 months");
      // It keeps the banner's frame, so Publish's end is still found as before.
      await expect(page.locator(".banner-ok")).toBeVisible();

      await nudge.getByRole("button", { name: "Write it" }).click();
      const dialog = page.getByRole("dialog", { name: "New entry" });
      await expect(dialog.getByLabel("Name")).toHaveValue(/The Sunken Gate|Tide Singers/);
      await dialog.getByRole("button", { name: "Cancel" }).click();

      await nudge.getByRole("button", { name: "Open" }).click();
      await expect(page).toHaveURL(/\/e\//);
      await expect(page.locator(".entry h1").first()).toBeVisible();
      await noSidewaysScroll(page);

      await publish(page);
      await page.locator(".nudge").getByRole("button", { name: /Roll/ }).click();
      await expect(page).toHaveURL(/\/e\//);
      await expect(page.locator(".entry h1").first()).toBeVisible();
    } finally {
      await page.request.delete(`/api/drafts/${id}`);
    }
  });

  test("goes away on the first key pressed, and after ten seconds", async ({ page }) => {
    const id = "kgnudge00002";
    await draftToPublish(page, id);
    await page.clock.install();
    try {
      await publish(page);
      await expect(page.locator(".nudge")).toBeVisible();
      // Moving the focus is not "going on".
      await page.keyboard.press("Tab");
      await expect(page.locator(".nudge")).toBeVisible();
      // A key pressed on the nudge's own links is for them; one pressed elsewhere is not.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("a");
      await expect(page.locator(".nudge")).toHaveCount(0);

      await publish(page);
      await expect(page.locator(".nudge")).toBeVisible();
      await page.clock.fastForward(9_000);
      await expect(page.locator(".nudge")).toBeVisible();
      await page.clock.fastForward(2_000);
      await expect(page.locator(".nudge")).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/drafts/${id}`);
    }
  });

  test("waits while the focus is on it, and leaves the plain notice when it goes", async ({
    page,
  }) => {
    const id = "kgnudge00004";
    await draftToPublish(page, id);
    await page.clock.install();
    try {
      await publish(page);
      const nudge = page.locator(".nudge");
      await expect(nudge).toBeVisible();
      // The pointer may rest where the box appeared; it is moved off, so only the focus holds it.
      await page.mouse.move(0, 0);
      // The focus in the box stops the clock: well past ten seconds it is still there.
      await nudge.getByRole("button").first().focus();
      await page.clock.fastForward(25_000);
      await expect(nudge).toBeVisible();
      // Out of the box, the ten seconds start over; then the notice stays in its place.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.clock.fastForward(9_000);
      await expect(nudge).toBeVisible();
      await page.clock.fastForward(2_000);
      await expect(nudge).toHaveCount(0);
      await expect(page.locator(".banner-ok")).toContainText("Published as commit 0123456789");
    } finally {
      await page.request.delete(`/api/drafts/${id}`);
    }
  });

  test("with no steps it is the plain end as before", async ({ page }) => {
    const id = "kgnudge00003";
    await draftToPublish(page, id);
    await page.route("**/api/keep-going/after-publish", (route) =>
      route.fulfill({ json: { steps: [] } }),
    );
    try {
      await publish(page);
      await expect(page.locator(".banner-ok")).toContainText("Published as commit 0123456789");
      await expect(page.locator(".nudge")).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/drafts/${id}`);
    }
  });
});
