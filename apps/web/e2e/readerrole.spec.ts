import { expect, type Browser, type BrowserContext, type Page, test } from "./test.ts";
import {
  api,
  entry,
  noSidewaysScroll,
  openLibrary,
  openSideBar,
  proj,
  tidyPeople,
} from "./helpers.ts";

/**
 * Stage 27c: a reader's shell. A reader reads everything saved, asks the lore and talks with
 * characters, and sees no control that changes anything; the calls only a writer may make are not
 * made; an address that edits says what the role allows. A writer sees everything but the owner's
 * settings.
 */
test.describe.configure({ mode: "serial" });
test.afterEach(async ({ page }) => tidyPeople(page));

const WORDS = "a long enough password";
const mail = (who: string) => `${who}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
const OLD_QUAY = "01 Places/Harbor/Old Quay.md";

/** A new person in the project with the role, logged in in a browser of their own. */
async function person(
  browser: Browser,
  owner: Page,
  role: "writer" | "reader",
  name: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const made = await owner.request.post(api("/invites"), { data: { role } });
  const { code } = (await made.json()) as { code: string };
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const joined = await context.request.post(`/api/join/${code}`, {
    data: { name, email: mail("reader"), password: WORDS },
  });
  expect(joined.status(), await joined.text()).toBe(200);
  const page = await context.newPage();
  // The browser's own note that the Home Screen card was seen, as the shared session has it.
  await page.addInitScript(() => localStorage.setItem("frontier.installNotice", "1"));
  return { context, page };
}

async function takeOut(owner: Page, name: string) {
  const res = await owner.request.get(api("/members"));
  const list = ((await res.json()) as { members: { id: string; name: string }[] }).members;
  for (const m of list) if (m.name === name) await owner.request.delete(api(`/members/${m.id}`));
}

/** What a reader's app asked of the server, and what it refused them. */
function watch(page: Page) {
  const asked: string[] = [];
  const refused: string[] = [];
  page.on("response", (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith("/api/p/sample/")) return;
    asked.push(`${res.request().method()} ${url.pathname.replace("/api/p/sample", "")}`);
    if (res.status() === 403) refused.push(`${res.request().method()} ${url.pathname}`);
  });
  return { asked, refused };
}

const WRITERS_ONLY =
  /\/(unpublished|inbox|drafts|publish|renames|write\/review|proposals)(\/|$|\?)|\/maps\/[^/]+\/discoveries|\/turns\/\d+\/addition|\/comments\/[^/]+\/(work|share)(\/|$|\?)/;

test("a reader's shell has no control that changes anything, and calls nothing only a writer may", async ({
  page,
  browser,
}) => {
  const reader = await person(browser, page, "reader", "Rhea Reader");
  const r = reader.page;
  const seen = watch(r);

  await r.goto(proj("/"));
  await expect(r.locator(".home h1")).toBeVisible();
  await openSideBar(r);
  const left = r.locator(".left-bar").first();
  await expect(left.locator(".left-person")).toContainText("Reader here");
  await expect(left.locator(".left-reader-note")).toHaveText(
    "You can read, comment and ask here. You cannot change the text.",
  );
  // No new entry, no unsaved changes, no inbox; the places to read are there, Ask among them.
  await expect(left.locator(".new-entry")).toHaveCount(0);
  await expect(left.getByRole("link", { name: /(unsaved|unpublished) changes/i })).toHaveCount(0);
  await expect(left.getByRole("link", { name: /^Inbox/ })).toHaveCount(0);
  await expect(left.getByRole("link", { name: /^Ask/ })).toBeVisible();
  await expect(left.getByRole("link", { name: /^Maps/ })).toBeVisible();
  // The folders are there to browse, with no way to add, rename, move or delete.
  await openLibrary(r);
  const folders = r.getByRole("region", { name: "Library" });
  await expect(folders.locator(".tree-row").first()).toBeVisible();
  await expect(folders.getByRole("button", { name: /^New entry/ })).toHaveCount(0);
  await expect(folders.getByRole("button", { name: "New folder" })).toHaveCount(0);
  await expect(folders.getByRole("button", { name: /^More for / })).toHaveCount(0);
  await r.keyboard.press("Escape");

  // An entry: read, with its history and graph, and nothing to edit, rename or move.
  await r.goto(entry(OLD_QUAY));
  await expect(r.locator(".entry h1").first()).toHaveText("Old Quay");
  await expect(r.locator(".entry-tool-edit")).toHaveCount(0);
  await expect(r.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  // History and Export stay; Rename and Move are the writer's, in the bar or in "More actions".
  await expect(r.getByRole("button", { name: "Rename", exact: true })).toHaveCount(0);
  await expect(r.getByRole("button", { name: /^Move to/ })).toHaveCount(0);
  const more = r.getByRole("button", { name: "More actions", exact: true }).locator("visible=true");
  if ((await more.count()) > 0) {
    await more.first().click();
    await expect(r.getByRole("menuitem", { name: "History", exact: true })).toBeVisible();
    await expect(r.getByRole("menuitem", { name: "Rename", exact: true })).toHaveCount(0);
    await expect(r.getByRole("menuitem", { name: /^Move to/ })).toHaveCount(0);
    await r.keyboard.press("Escape");
  } else {
    await expect(r.getByRole("button", { name: "History", exact: true })).toBeVisible();
  }
  await expect(r.getByRole("button", { name: /^Write / })).toHaveCount(0);
  await expect(r.getByRole("button", { name: /Link it/ })).toHaveCount(0);

  // Maps: no New map, no Edit, `?edit=1` only reads.
  await r.goto(proj("/maps"));
  await expect(r.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
  await expect(r.getByRole("button", { name: /New map/ })).toHaveCount(0);
  const list = (await (await page.request.get(api("/maps"))).json()) as {
    maps: { id: string; kind?: string; space?: { kind: string } }[];
  };
  const flat = list.maps[0]!;
  await r.goto(proj(`/map/${flat.id}?edit=1`));
  await expect(r.locator(".map-bar, .ch-bar, .map-main").first()).toBeVisible();
  await expect(r.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(r.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
  await expect(r.getByRole("button", { name: "Explore", exact: true })).toHaveCount(0);

  // Chronicles: no new chronicle, no add event.
  await r.goto(proj("/chronicles"));
  await expect(r.getByRole("heading", { name: "Chronicles", level: 1 })).toBeVisible();
  await expect(r.getByRole("button", { name: "Make the chronicle" })).toHaveCount(0);
  const chronicles = (await (await page.request.get(api("/chronicles"))).json()) as {
    chronicles: { id: string }[];
  };
  if (chronicles.chronicles[0]) {
    await r.goto(proj(`/chronicle/${chronicles.chronicles[0].id}`));
    await expect(r.locator(".ch-bar h1")).toBeVisible();
    await expect(r.getByRole("button", { name: /Add an event|\+ Add/ })).toHaveCount(0);
    await expect(r.getByRole("button", { name: "Make main" })).toHaveCount(0);
  }

  // Ask is theirs to use, with their own key; the box and the button are there.
  await r.goto(proj("/ask"));
  await expect(r.getByRole("button", { name: "Ask", exact: true })).toBeVisible();
  await expect(r.getByRole("button", { name: "Draft entry" })).toHaveCount(0);

  // Settings: the project's pages are read; their own account and keys are theirs.
  await r.goto(proj("/settings/general"));
  await expect(r.getByText("Only an owner of the project can change these.")).toBeVisible();
  await expect(r.getByRole("button", { name: "Delete this project" })).toHaveCount(0);
  await r.goto(proj("/settings/device/ai-keys"));
  await expect(r.getByRole("heading", { name: "AI keys", level: 1 })).toBeVisible();
  await r.goto(proj("/settings/account"));
  await expect(r.getByRole("heading", { name: "Passkeys" })).toBeVisible();
  await noSidewaysScroll(r);

  // Nothing a writer alone may call was asked for, and nothing was refused.
  expect(seen.asked.filter((a) => WRITERS_ONLY.test(a))).toEqual([]);
  expect(seen.refused).toEqual([]);
  expect(seen.asked.length).toBeGreaterThan(10);

  await reader.context.close();
  await takeOut(page, "Rhea Reader");
});

test("an address that edits, saves or sorts the inbox says what the role allows, and where to read", async ({
  page,
  browser,
}) => {
  const reader = await person(browser, page, "reader", "Rhea Reader");
  const r = reader.page;
  await r.goto(proj(`/edit/${OLD_QUAY.split("/").map(encodeURIComponent).join("/")}`));
  await expect(r.getByRole("heading", { name: "You can read this, not change it" })).toBeVisible();
  await expect(r.getByText("You are a Reader in Sample.")).toBeVisible();
  await expect(r.locator(".cm-content")).toHaveCount(0);
  await r.getByRole("link", { name: "Read Old Quay" }).click();
  await expect(r.locator(".entry h1").first()).toHaveText("Old Quay");
  for (const path of ["/unpublished", "/inbox", "/import"]) {
    await r.goto(proj(path));
    await expect(
      r.getByRole("heading", { name: "You can read this, not change it" }),
    ).toBeVisible();
    await expect(r.getByRole("link", { name: "Back to Home" })).toBeVisible();
  }
  // A reader cannot manage people either; the server says so, and the page does not offer it.
  await r.goto(proj("/settings/members"));
  await expect(r.getByRole("button", { name: "Make an invite link" })).toHaveCount(0);
  await r.context().close();
  await takeOut(page, "Rhea Reader");
});

test("a writer sees everything but the owner's settings", async ({ page, browser }) => {
  const writer = await person(browser, page, "writer", "Walt Writer");
  const w = writer.page;
  await w.goto(proj("/"));
  await openSideBar(w);
  const left = w.locator(".left-bar").first();
  await expect(left.locator(".left-person")).toContainText("Writer here");
  await expect(left.locator(".new-entry")).toBeVisible();
  await expect(left.getByRole("link", { name: /(unsaved|unpublished) changes/i })).toBeVisible();
  await expect(left.getByRole("link", { name: /^Inbox/ })).toBeVisible();
  await expect(left.locator(".left-reader-note")).toHaveCount(0);
  await w.keyboard.press("Escape");

  await w.goto(entry(OLD_QUAY));
  await expect(w.locator(".entry-tool-edit, .edit-link").first()).toBeVisible();
  // The editor opens for a writer.
  await w.goto(proj(`/edit/${OLD_QUAY.split("/").map(encodeURIComponent).join("/")}`));
  await expect(w.locator(".cm-content")).toBeVisible();

  // The project's settings are read-only to a writer: no delete, no invites, Members read-only.
  await w.goto(proj("/settings/general"));
  await expect(w.getByText("Only an owner of the project can change these.")).toBeVisible();
  await expect(w.getByRole("button", { name: "Delete this project" })).toHaveCount(0);
  await w.goto(proj("/settings/members"));
  await expect(w.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(w.getByRole("button", { name: "Make an invite link" })).toHaveCount(0);
  await expect(w.getByLabel("Role of Olive Owner")).toHaveCount(0);
  await writer.context.close();
  await takeOut(page, "Walt Writer");
});
