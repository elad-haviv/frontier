import { expect, type Browser, type BrowserContext, type Page, test } from "./test.ts";
import { api, entry, rightPanel, tidyPeople } from "./helpers.ts";

/**
 * Stage 31e: comments between people. A reader comments on an entry, a writer sees it at once,
 * replies and resolves, the reader sees that at once, and the reader cannot edit or delete what
 * the writer wrote. Comments made here are deleted at the end; the people by `tidyPeople`.
 */
test.describe.configure({ mode: "serial" });
test.afterEach(async ({ page }) => tidyPeople(page));

const WORDS = "a long enough password";
const mail = (who: string) => `${who}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
const OLD_QUAY = "01 Places/Harbor/Old Quay.md";

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
    data: { name, email: mail(role), password: WORDS },
  });
  expect(joined.status(), await joined.text()).toBe(200);
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("frontier.installNotice", "1"));
  return { context, page };
}

/** Types into the box named `label` and sends it with Ctrl+Enter, as the app's other boxes do. */
async function send(panel: ReturnType<Page["getByRole"]>, label: string, words: string) {
  const box = panel.getByRole("textbox", { name: label });
  await box.fill(words);
  await box.press("Control+Enter");
}

test("a reader comments, a writer replies and resolves, and each sees it live", async ({
  page,
  browser,
}) => {
  const reader = await person(browser, page, "reader", "Rhea Reader");
  const writer = await person(browser, page, "writer", "Wren Writer");
  const r = reader.page;
  const w = writer.page;
  const TEXT = `Since when is this custom? ${Date.now()}`;
  try {
    await w.goto(entry(OLD_QUAY));
    await r.goto(entry(OLD_QUAY));
    await expect(w.locator(".entry h1").first()).toHaveText("Old Quay");
    const wp = await rightPanel(w, "Comments");
    const rp = await rightPanel(r, "Comments");

    // The reader has the panel and the form, and no other editing control.
    await expect(r.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await rp.getByRole("button", { name: "Comment on the whole entry" }).click();
    await send(rp, "Your comment", TEXT);
    await expect(rp.getByText(TEXT)).toBeVisible();
    await expect(rp.getByText("Rhea Reader")).toBeVisible();
    await expect(rp.getByRole("button", { name: "Edit your comment" })).toBeVisible();

    // The writer, who did not reload, sees it, with the reader's name.
    await expect(wp.getByText(TEXT)).toBeVisible({ timeout: 15_000 });
    await expect(wp.getByText("Rhea Reader")).toBeVisible();
    await wp.getByRole("button", { name: "Reply to Rhea Reader" }).click();
    await send(wp, "Reply to Rhea Reader", "Harbor says the council ordered it.");
    await expect(wp.getByText("Harbor says the council ordered it.")).toBeVisible();
    await expect(wp.getByText("Wren Writer")).toBeVisible();

    // The reader sees the reply, and cannot edit or delete it.
    await expect(rp.getByText("Harbor says the council ordered it.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(rp.getByRole("button", { name: "Edit your reply" })).toHaveCount(0);
    await expect(rp.getByRole("button", { name: /^Delete Wren Writer/ })).toHaveCount(0);

    // The writer resolves; the reader sees the thread leave the open list.
    await wp.getByRole("button", { name: "Resolve the comment by Rhea Reader" }).click();
    await expect(rp.getByText(TEXT)).toHaveCount(0, { timeout: 15_000 });
    await rp.getByRole("button", { name: /^Show resolved/ }).click();
    await expect(rp.getByText("Resolved by Wren Writer")).toBeVisible();
    await expect(rp.getByRole("button", { name: /^(Reopen|Resolve) the comment/ })).toHaveCount(1); // their own thread: the reader may reopen it

    // A writer's own comment: the reader gets no Edit, no Delete, no Resolve on it.
    await wp.getByRole("button", { name: "Comment on the whole entry" }).click();
    await send(wp, "Your comment", "A note from the writer");
    await expect(rp.getByText("A note from the writer")).toBeVisible({ timeout: 15_000 });
    const theirs = rp.locator("li.comment-thread", { hasText: "A note from the writer" });
    await expect(theirs.getByRole("button", { name: /^(Edit|Delete|Resolve)/ })).toHaveCount(0);
    await expect(theirs.getByRole("button", { name: /^Reply/ })).toBeVisible();
  } finally {
    // Take the comments away again.
    const list = await page.request.get(api(`/comments?path=${encodeURIComponent(OLD_QUAY)}`), {
      timeout: 10_000,
    });
    if (list.ok()) {
      for (const c of ((await list.json()) as { comments: { id: string }[] }).comments) {
        await page.request.delete(api(`/comments/${c.id}`));
      }
    }
    await reader.context.close();
    await writer.context.close();
  }
});
