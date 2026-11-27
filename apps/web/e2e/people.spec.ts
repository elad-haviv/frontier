import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  test,
} from "./test.ts";
import { api, edit, entry, onMain, openLibrary, proj, saved, tidyPeople } from "./helpers.ts";

/**
 * Stage 27d: two people in one project. Each has their own unsaved changes; the others are told who
 * has some (never what); who is reading shows; whoever saves second compares the two texts and
 * chooses; every saved version says who saved it.
 *
 * The e2e server keeps its library through a remote that stands in for GitHub (the status says
 * `sample`), so these run the compare screen the way a library on GitHub has it. The library of
 * Frontier's own differs only in its words ("Save a version" for "Publish"), which unit tests cover,
 * and in how a version is kept, which the server's own tests cover for both.
 */
test.describe.configure({ mode: "serial" });

const WORDS = "a long enough password";
const mail = (who: string) => `${who}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
const FOLDER = "People Spec";
const OWNER = "Olive Owner";

/** The entries this spec made, so each test leaves the library as it found it. */
const made = new Set<string>();

interface Someone {
  context: BrowserContext;
  page: Page;
}

/** A new person in the project, logged in in a browser of their own. */
async function person(
  browser: Browser,
  owner: Page,
  role: "writer" | "reader",
  name: string,
): Promise<Someone> {
  const invite = await owner.request.post(api("/invites"), { data: { role } });
  const { code } = (await invite.json()) as { code: string };
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const joined = await context.request.post(`/api/join/${code}`, {
    data: { name, email: mail(role), password: WORDS },
  });
  expect(joined.status(), await joined.text()).toBe(200);
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("frontier.installNotice", "1"));
  return { context, page };
}

const ID = "abcdefghijklmnopqrstuvwxyz0123456789";
const newId = () =>
  Array.from({ length: 12 }, () => ID[Math.floor(Math.random() * ID.length)]).join("");

const entryOf = async (request: APIRequestContext, path: string) => {
  const res = await request.get(api(`/entries?path=${encodeURIComponent(path)}`));
  return res.ok() ? ((await res.json()) as { blob: string; text: string }) : null;
};

/** An unsaved change, made through the server as the browser's save queue makes it. */
async function draft(
  request: APIRequestContext,
  path: string,
  text: string,
  kind: "edit" | "create" | "delete" = "edit",
): Promise<string> {
  const id = newId();
  const baseBlob = kind === "create" ? "" : ((await entryOf(request, path))?.blob ?? "");
  const res = await request.put(api("/drafts"), {
    data: { id, path, kind, text: kind === "delete" ? "" : text, revision: 0, baseBlob },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return id;
}

/** Saves a version of these unsaved changes, as the review does: plan, then confirm. */
async function save(request: APIRequestContext, ids: string[], message: string) {
  const plan = await request.post(api("/publish/plan"), { data: { draftIds: ids, renameIds: [] } });
  expect(plan.ok(), await plan.text()).toBe(true);
  const { planId } = (await plan.json()) as { planId: string };
  return request.post(api("/publish/confirm"), {
    data: { planId, confirmedMergeIds: [], message },
  });
}

/** A new entry in the library, saved. */
async function makeEntry(request: APIRequestContext, name: string, text: string): Promise<string> {
  const path = `${FOLDER}/${name}.md`;
  const id = await draft(request, path, text, "create");
  const res = await save(request, [id], `Add ${name}`);
  expect(res.ok(), await res.text()).toBe(true);
  made.add(path);
  return path;
}

const BODY = [
  "# Shared Notes",
  "",
  "First paragraph about the quay.",
  "",
  "Second paragraph about the tide.",
  "",
  "Third paragraph about the lamp.",
  "",
].join("\n");

/** Puts the library back: this person's unsaved changes discarded, the entries made here deleted. */
test.afterEach(async ({ page }) => {
  try {
    const un = await page.request.get(api("/unpublished"));
    const { drafts } = (await un.json()) as { drafts: { id: string; path: string }[] };
    for (const d of drafts) {
      if (d.path.startsWith(FOLDER)) await page.request.delete(api(`/drafts/${d.id}`));
    }
    const gone: string[] = [];
    for (const path of made) {
      if (await entryOf(page.request, path))
        gone.push(await draft(page.request, path, "", "delete"));
    }
    if (gone.length > 0) await save(page.request, gone, "Remove the entries of the people spec");
    made.clear();
  } finally {
    await tidyPeople(page);
  }
});

/** Types a line at the end of an entry in the editor, and waits until it is saved as unsaved changes. */
async function typeAtEnd(page: Page, path: string, line: string) {
  await page.goto(edit(path));
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(line);
  await saved(page);
}

test("others' unsaved changes show on the entry and in the tree as a notice and a dot, to writers only", async ({
  page,
  browser,
}) => {
  const path = await makeEntry(page.request, "Shared Notes", BODY);
  const wren = await person(browser, page, "writer", "Wren Writer");
  const rhea = await person(browser, page, "reader", "Rhea Reader");

  // Nobody has unsaved changes yet: no notice.
  await page.goto(entry(path));
  await expect(page.locator(".entry h1").first()).toHaveText("Shared Notes");
  await expect(page.getByTestId("others-notice")).toHaveCount(0);

  // Wren starts changing it. The owner's open page learns it from the stream, with no reload.
  await typeAtEnd(wren.page, path, "Wren was here.");
  const notice = page.getByTestId("others-notice");
  await expect(notice).toContainText("Wren Writer has unsaved changes to this entry", {
    timeout: 15_000,
  });
  await expect(notice).toContainText("since");
  // Never what they wrote.
  await expect(page.locator(".entry")).not.toContainText("Wren was here.");
  await expect(notice).not.toContainText("Wren was here.");

  // The tree marks the entry with a dot that has a name, and no text beside it.
  await openLibrary(page);
  const dot = page.getByRole("img", { name: "Wren Writer has unsaved changes to this entry" });
  await expect(dot).toBeVisible();
  await expect(page.locator(".tree-others")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // In the editor the notice also says what will happen.
  await page.goto(edit(path));
  const editing = page.getByTestId("others-notice");
  await expect(editing).toContainText("Wren Writer has unsaved changes to this entry");
  await expect(editing).toContainText("Whoever saves second compares the two texts");

  // A reader is shown none of it.
  await rhea.page.goto(entry(path));
  await expect(rhea.page.locator(".entry h1").first()).toHaveText("Shared Notes");
  await expect(rhea.page.getByTestId("others-notice")).toHaveCount(0);
  await openLibrary(rhea.page);
  await expect(
    rhea.page.getByRole("region", { name: "Library" }).locator(".tree-row").first(),
  ).toBeVisible();
  await expect(rhea.page.locator(".tree-others")).toHaveCount(0);
  const seen = await rhea.page.request.get(api(`/entries?path=${encodeURIComponent(path)}`));
  expect(((await seen.json()) as { othersUnsaved?: unknown[] }).othersUnsaved ?? []).toEqual([]);

  // Wren puts it down: the notice and the dot go while the owner's page stays open.
  await page.goto(entry(path));
  await expect(page.getByTestId("others-notice")).toBeVisible();
  const list = (await (await wren.page.request.get(api("/unpublished"))).json()) as {
    drafts: { id: string; path: string }[];
  };
  for (const d of list.drafts.filter((x) => x.path === path)) {
    await wren.page.request.delete(api(`/drafts/${d.id}`));
  }
  await expect(page.getByTestId("others-notice")).toHaveCount(0, { timeout: 15_000 });
  await wren.context.close();
  await rhea.context.close();
});

test("who is reading shows for writers, clears when they leave, and a reader sees none", async ({
  page,
  browser,
}) => {
  const path = await makeEntry(page.request, "Shared Notes", BODY);
  const wren = await person(browser, page, "writer", "Wren Writer");
  const rhea = await person(browser, page, "reader", "Rhea Reader");

  await page.goto(entry(path));
  await expect(page.locator(".entry h1").first()).toHaveText("Shared Notes");
  await expect(page.getByTestId("reading-now")).toHaveCount(0);

  // Wren opens it: the owner sees Wren, in words as well as initials.
  await wren.page.goto(entry(path));
  const reading = page.getByTestId("reading-now");
  await expect(reading).toContainText("Wren Writer is also here", { timeout: 15_000 });
  await expect(reading.locator("[title='Wren Writer']")).toHaveCount(1);

  // A reader announces too, so writers see them; the reader sees nobody, not even the writers.
  await rhea.page.goto(entry(path));
  await expect(reading).toContainText("Wren Writer and Rhea Reader are also here", {
    timeout: 15_000,
  });
  await expect(rhea.page.locator(".entry h1").first()).toHaveText("Shared Notes");
  await expect(rhea.page.getByTestId("reading-now")).toHaveCount(0);

  // Wren leaves the entry for another page: they are gone from the list.
  await wren.page.goto(proj("/"));
  await expect(reading).toContainText("Rhea Reader is also here", { timeout: 15_000 });
  await expect(reading).not.toContainText("Wren");

  // The reader's tab closes: gone too.
  await rhea.page.close();
  await expect(reading).toHaveCount(0, { timeout: 15_000 });

  // An entry that is only someone's own unsaved new one is never announced.
  const announced: (string | null)[] = [];
  page.on("request", (req) => {
    if (req.method() === "PUT" && req.url().endsWith("/presence")) {
      announced.push((req.postDataJSON() as { path: string | null }).path);
    }
  });
  const fresh = `${FOLDER}/Not Yet.md`;
  await draft(page.request, fresh, "# Not Yet\n\nOnly a draft.\n", "create");
  await page.goto(entry(fresh));
  await expect(page.locator(".entry h1").first()).toHaveText("Not Yet");
  await page.goto(entry(path));
  await expect(page.locator(".entry h1").first()).toHaveText("Shared Notes");
  await expect.poll(() => announced.includes(path), { timeout: 10_000 }).toBe(true);
  expect(announced).not.toContain(fresh);
  await wren.context.close();
  await rhea.context.close();
});

test("a tab that is hidden takes its announcement away, with a beacon, and puts it back when shown", async ({
  page,
  browser,
}) => {
  const path = await makeEntry(page.request, "Shared Notes", BODY);
  const wren = await person(browser, page, "writer", "Wren Writer");
  await page.goto(entry(path));
  await wren.page.goto(entry(path));
  const reading = page.getByTestId("reading-now");
  await expect(reading).toContainText("Wren Writer is also here", { timeout: 15_000 });

  // The page is hidden, as when the tab is closed or put away: the leave goes as a JSON beacon.
  const leaves: { type: string | undefined; body: unknown }[] = [];
  await wren.page.route("**/presence/leave", async (route) => {
    const req = route.request();
    leaves.push({ type: req.headers()["content-type"], body: req.postDataJSON() });
    await route.continue();
  });
  await wren.page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect(reading).toHaveCount(0, { timeout: 15_000 });
  expect(leaves).toHaveLength(1);
  expect(leaves[0]!.type).toContain("application/json");
  expect((leaves[0]!.body as { client: string }).client).toMatch(/^[A-Za-z0-9_-]+$/);

  // Shown again: announced again.
  await wren.page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(reading).toContainText("Wren Writer is also here", { timeout: 15_000 });
  await wren.context.close();
});

/** The owner's review, up to the plan, with the plan's held-back entries. */
async function reviewToPlan(page: Page) {
  await page.goto(proj("/unpublished"));
  await expect(page.locator(".changes > li").first()).toBeVisible();
  await page.locator("button.big").click();
  await expect(page.locator(".plan")).toBeVisible();
}

test("A and B change one entry, A saves, B saves: the compare screen names A, and the merged text keeps both", async ({
  page,
  browser,
}) => {
  const path = await makeEntry(page.request, "Shared Notes", BODY);
  const wren = await person(browser, page, "writer", "Wren Writer");

  // Both start from the same saved version. B (the owner) writes at the end, in the editor.
  await typeAtEnd(page, path, "\nOlive added a line about the lamp.\n");
  // A (Wren) changes the first paragraph and saves a version.
  const text = (await entryOf(wren.page.request, path))!.text;
  const id = await draft(
    wren.page.request,
    path,
    text.replace(
      "First paragraph about the quay.",
      "First paragraph about the quay, as Wren saw it.",
    ),
  );
  expect((await save(wren.page.request, [id], "Wren changes the quay")).ok()).toBe(true);

  // B's review holds the entry back, and says who saved first.
  await reviewToPlan(page);
  await expect(page.locator(".plan .error")).toContainText("Wren Writer saved a newer version");
  await page.locator(".plan a", { hasText: "Compare" }).click();

  // The compare screen: theirs with who and when, mine, and three choices.
  await expect(
    page.getByRole("heading", { name: "Compare two versions of Shared Notes" }),
  ).toBeFocused();
  await expect(page.getByRole("heading", { name: /^Wren Writer saved this at/ })).toBeVisible();
  await expect(page.getByLabel("Wren Writer's version, saved")).toContainText("as Wren saw it");
  await expect(page.getByLabel("Your version, not saved yet")).toContainText("Olive added a line");
  await expect(page.getByRole("button", { name: "Use this choice" })).toBeDisabled();
  await expect(page.getByLabel("Keep mine")).not.toBeChecked();

  // The merged text has both changes, pre-filled and editable.
  await page.getByLabel("Use the merged text").check();
  const merged = page.locator(".compare-merged .cm-content");
  await expect(merged).toContainText("as Wren saw it");
  await expect(merged).toContainText("Olive added a line");
  await page.getByRole("button", { name: "Use this choice" }).click();

  // The save carries on: the review is planned again with the entry ready, and the save goes in.
  await expect(page.locator(".plan")).toBeVisible();
  await expect(page.locator(".plan .error")).toHaveCount(0);
  await page.fill(".field input", "Olive merges the quay and the lamp");
  await page.locator(".plan button.big").click();
  await expect(page.locator(".banner-ok")).toBeVisible({ timeout: 20_000 });
  const saved = onMain(path)!;
  expect(saved).toContain("as Wren saw it");
  expect(saved).toContain("Olive added a line about the lamp.");

  // History says who saved each version.
  await page.goto(proj(`/history/${path.split("/").map(encodeURIComponent).join("/")}`));
  const rows = page.locator(".versions > li");
  await expect(rows.first()).toContainText("by Olive Owner");
  await expect(page.locator(".versions")).toContainText("by Wren Writer");
  // And the entry says who saved the last one.
  await page.goto(entry(path));
  await expect(page.getByTestId("last-version")).toContainText("Last version by Olive Owner");
  // A reader sees the authors too.
  const rhea = await person(browser, page, "reader", "Rhea Reader");
  await rhea.page.goto(entry(path));
  await expect(rhea.page.getByTestId("last-version")).toContainText("Last version by Olive Owner");
  await rhea.page.goto(proj("/versions"));
  await expect(rhea.page.locator(".versions").first()).toContainText("by ");
  await wren.context.close();
  await rhea.context.close();
});

test("A saves again while B is on the compare screen: B is told, and compares again", async ({
  page,
  browser,
}) => {
  const path = await makeEntry(page.request, "Shared Notes", BODY);
  const wren = await person(browser, page, "writer", "Wren Writer");
  await typeAtEnd(page, path, "\nOlive's line, typed before anyone saved.\n");
  const first = await entryOf(wren.page.request, path);
  const one = await draft(
    wren.page.request,
    path,
    first!.text.replace(
      "Second paragraph about the tide.",
      "Second paragraph, Wren's first change.",
    ),
  );
  expect((await save(wren.page.request, [one], "Wren, first change")).ok()).toBe(true);

  await reviewToPlan(page);
  await page.fill(".field input", "Olive keeps her line");
  await page.locator(".plan a", { hasText: "Compare" }).click();
  await expect(page.getByRole("heading", { name: /^Wren Writer saved this at/ })).toBeVisible();
  await expect(page.getByLabel("Wren Writer's version, saved")).toContainText(
    "Wren's first change",
  );

  // While B is looking, A saves again.
  const second = await entryOf(wren.page.request, path);
  const two = await draft(
    wren.page.request,
    path,
    second!.text.replace(
      "Third paragraph about the lamp.",
      "Third paragraph, Wren's second change.",
    ),
  );
  expect((await save(wren.page.request, [two], "Wren, second change")).ok()).toBe(true);

  // B chooses to keep their own text. They are told, nothing was changed, and the new version shows.
  await page.getByLabel("Keep mine").check();
  await page.getByRole("button", { name: "Use this choice" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "saved again while you were comparing" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Wren Writer saved again" }),
  ).toBeFocused();
  await expect(page.getByLabel("Wren Writer's version, saved")).toContainText(
    "Wren's second change",
  );
  await expect(page.getByLabel("Your version, not saved yet")).toContainText("Olive's line");
  // Nothing is chosen for them this time.
  await expect(page.getByLabel("Keep mine")).not.toBeChecked();
  expect(onMain(path)).not.toContain("Olive's line");

  // They choose again, now against the new version, and it goes through.
  await page.getByLabel("Keep mine").check();
  await page.getByRole("button", { name: "Use this choice" }).click();
  await expect(page.locator(".plan")).toBeVisible();
  // The line typed in the review before comparing is still there.
  await expect(page.locator(".field input")).toHaveValue("Olive keeps her line");
  await page.locator(".plan button.big").click();
  await expect(page.locator(".banner-ok")).toBeVisible({ timeout: 20_000 });
  expect(onMain(path)).toContain("Olive's line, typed before anyone saved.");
  await wren.context.close();
});

test("'keep theirs' asks first, throws only the person's own text away, and leaves their version", async ({
  page,
  browser,
}) => {
  const path = await makeEntry(page.request, "Shared Notes", BODY);
  const wren = await person(browser, page, "writer", "Wren Writer");
  await typeAtEnd(page, path, "\nOlive's line that will go.\n");
  const mine = await entryOf(wren.page.request, path);
  const id = await draft(
    wren.page.request,
    path,
    mine!.text.replace("Second paragraph about the tide.", "Second paragraph, by Wren."),
  );
  expect((await save(wren.page.request, [id], "Wren changes the tide")).ok()).toBe(true);

  await reviewToPlan(page);
  await page.locator(".plan a", { hasText: "Compare" }).click();
  await page.getByLabel("Keep theirs").check();
  await page.getByRole("button", { name: "Use this choice" }).click();
  const ask = page.getByRole("dialog", { name: "Keep Wren Writer's version?" });
  await expect(ask).toContainText("What you wrote in this entry is thrown away");
  await ask.getByRole("button", { name: "Keep theirs" }).click();
  // Back at the unsaved changes, saying what was kept, and nothing of the owner's is left for it.
  await expect(
    page.getByRole("status").filter({ hasText: "Kept Wren Writer's version" }),
  ).toBeVisible();
  // The read can meet the server mid-way through clearing the draft: it is asked until it answers.
  await expect
    .poll(async () => (await entryOf(page.request, path))?.text ?? "")
    .toContain("by Wren.");
  const after = await entryOf(page.request, path);
  expect(after!.text).toContain("by Wren.");
  expect(after!.text).not.toContain("Olive's line that will go.");
});

test("a save that finds some entries changed meanwhile saves the rest and says which need comparing", async ({
  page,
  browser,
}) => {
  const alpha = await makeEntry(page.request, "Alpha", "# Alpha\n\nAlpha, as it was.\n");
  const beta = await makeEntry(page.request, "Beta", "# Beta\n\nBeta, as it was.\n");
  const wren = await person(browser, page, "writer", "Wren Writer");
  await draft(page.request, alpha, "# Alpha\n\nAlpha, the owner's change.\n");
  await draft(page.request, beta, "# Beta\n\nBeta, the owner's change.\n");

  await reviewToPlan(page);
  await expect(page.locator(".plan .error")).toHaveCount(0);
  // After the plan, and before the save, Wren saves a newer version of Alpha.
  const id = await draft(wren.page.request, alpha, "# Alpha\n\nAlpha, as Wren has it.\n");
  expect((await save(wren.page.request, [id], "Wren changes Alpha")).ok()).toBe(true);

  await page.fill(".field input", "Olive changes both");
  await page.locator(".plan button.big").click();
  const partial = page.getByRole("status", { name: "Entries to compare" });
  await expect(partial).toBeVisible({ timeout: 20_000 });
  await expect(partial).toContainText(/1 entry (saved|published) \(Beta\)\./);
  await expect(partial).toContainText(
    "1 entry needs comparing, because someone saved a newer version first: Alpha.",
  );
  expect(onMain(beta)).toContain("the owner's change");
  expect(onMain(alpha)).toContain("as Wren has it");
  // The one that needs comparing opens as a compare, naming Wren.
  await partial.getByRole("link", { name: "Compare Alpha" }).click();
  await expect(page.getByRole("heading", { name: /^Wren Writer saved this at/ })).toBeVisible();
  await wren.context.close();
});

test("an entry another person deleted names who did it, and the person's own text is kept", async ({
  page,
  browser,
}) => {
  const path = await makeEntry(page.request, "Shared Notes", BODY);
  const wren = await person(browser, page, "writer", "Wren Writer");
  await draft(page.request, path, BODY + "\nOlive's text, which should not be lost.\n");
  const gone = await draft(wren.page.request, path, "", "delete");
  expect((await save(wren.page.request, [gone], "Wren deletes the entry")).ok()).toBe(true);

  await reviewToPlan(page);
  await expect(page.locator(".plan .error")).toContainText("Wren Writer deleted this entry");
  await page.locator(".plan a", { hasText: "Resolve" }).click();
  await expect(page.locator(".lede")).toContainText("Wren Writer deleted this entry");
  await expect(page.locator(".cm-content")).toContainText(
    "Olive's text, which should not be lost.",
  );
  await wren.context.close();
});

test("removing a person says how many of their unsaved changes are kept, and for how long", async ({
  page,
  browser,
}) => {
  const path = await makeEntry(page.request, "Shared Notes", BODY);
  const wren = await person(browser, page, "writer", "Wren Writer");
  await draft(wren.page.request, path, BODY + "\nWren's unsaved line.\n");

  await page.goto(proj("/settings/members"));
  await page.getByRole("button", { name: "Remove Wren Writer" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Wren Writer was removed. What they wrote stays")).toBeVisible();
  await expect(
    page.getByText(
      "Their 1 unsaved change is kept for 30 days, and come back if they rejoin in that time.",
    ),
  ).toBeVisible();
  await wren.context.close();
});
