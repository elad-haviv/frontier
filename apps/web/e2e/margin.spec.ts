import { expect, type Page, test } from "@playwright/test";
import { edit, entry } from "./helpers.ts";

const PATH = "01 Places/Harbor/Harbor.md";

/** Keeps a comment on a passage of the entry, as the editor's Comment does, and gives its id. */
async function comment(page: Page, quote: string, text: string): Promise<string> {
  const res = await page.request.get(`/api/entries?path=${encodeURIComponent(PATH)}`);
  const body = ((await res.json()) as { text: string }).text;
  const at = body.indexOf(quote);
  expect(at).toBeGreaterThan(-1);
  const made = await page.request.post("/api/comments", {
    data: {
      path: PATH,
      quote,
      prefix: body.slice(Math.max(0, at - 40), at),
      suffix: body.slice(at + quote.length, at + quote.length + 40),
      text,
      for: "me",
    },
  });
  expect(made.ok()).toBe(true);
  return ((await made.json()) as { comment: { id: string } }).comment.id;
}

/** How far apart two boxes start, top to top. */
const apart = (a: { y: number }, b: { y: number }) => Math.abs(a.y - b.y);

test("comments show as bubbles in the margin, level with their passages", async ({
  page,
  isMobile,
}) => {
  const ids = [
    await comment(page, "Founded by fishers.", "Which fishers? Name the families."),
    await comment(page, "Twice a day.", "Say how high the water comes at the spring tides."),
  ];
  try {
    if (isMobile) {
      // A phone has no margin: the comments are counted under the title, as before.
      await page.goto(entry(PATH));
      await expect(page.getByRole("link", { name: "2 open comments" })).toBeVisible();
      await expect(page.locator(".comment-bubble")).toHaveCount(0);
      await page.goto(edit(PATH));
      await expect(page.locator(".cm-content")).toBeVisible();
      await expect(page.locator(".cm-comment").first()).toBeVisible();
      await expect(page.locator(".comment-bubble")).toHaveCount(0);
      return;
    }
    // A wide screen, so there is a blank margin beside the text.
    await page.setViewportSize({ width: 1680, height: 1000 });

    // Reading: each bubble starts level with the words it is on.
    await page.goto(entry(PATH));
    const bubbles = page.locator(".comment-bubble");
    await expect(bubbles).toHaveCount(2);
    await expect(bubbles.nth(0)).toContainText("Which fishers?");
    await expect(bubbles.nth(1)).toContainText("spring tides");
    const founded = (await page
      .locator(".prose p", { hasText: "Founded by fishers." })
      .boundingBox())!;
    const twice = (await page.locator(".prose p", { hasText: "Twice a day." }).boundingBox())!;
    const first = (await bubbles.nth(0).boundingBox())!;
    const second = (await bubbles.nth(1).boundingBox())!;
    expect(apart(first, founded)).toBeLessThan(8);
    // Never one over another; the second is level with its passage unless the first is in its way.
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    expect(second.y).toBeGreaterThanOrEqual(twice.y - 8);
    // In the margin, right of the text.
    const article = (await page.locator("article.entry").boundingBox())!;
    expect(first.x).toBeGreaterThanOrEqual(article.x + article.width);

    // Pressing one opens the comment in full in the side bar; the bubbles step aside.
    await bubbles.nth(1).click();
    const bar = page.locator(".right-bar");
    await expect(bar.getByRole("tab", { name: /^Comments/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(bar.locator(".comment-list > li.is-focused .comment-text")).toHaveText(
      "Say how high the water comes at the spring tides.",
    );
    await expect(bubbles).toHaveCount(0);
    await page.getByRole("button", { name: "Hide the panels" }).click();
    await expect(bubbles).toHaveCount(2);

    // Writing: the same, level with the lines in the editor.
    await page.goto(edit(PATH));
    await expect(page.locator(".cm-comment").first()).toBeVisible();
    await expect(bubbles).toHaveCount(2);
    const line = (await page
      .locator(".cm-line", { hasText: "Founded by fishers." })
      .boundingBox())!;
    expect(apart((await bubbles.nth(0).boundingBox())!, line)).toBeLessThan(8);
    await bubbles.nth(0).click();
    await expect(page.locator(".right-bar .comment-list > li.is-focused .comment-text")).toHaveText(
      "Which fishers? Name the families.",
    );
    await expect(bubbles).toHaveCount(0);
    await page.getByRole("button", { name: "Hide the panels" }).click();
    await expect(bubbles).toHaveCount(2);

    // With no room beside the text they are not shown; the Comments button still is.
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(bubbles).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Comments (2)" })).toBeVisible();
  } finally {
    for (const id of ids) await page.request.delete(`/api/comments/${id}`);
  }
});
