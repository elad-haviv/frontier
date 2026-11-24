import { expect, type Page, test } from "@playwright/test";
import { discardDraft, edit } from "./helpers.ts";

// Writing help in the editor at desktop size (stage 17): a card under the passage. The AI
// settings are one per server, so these take turns and put the model back as they found it.
test.describe.configure({ mode: "serial" });

const NOTE = "02 People/Twin.md";
const PICTURES = Number(process.env.E2E_PORT ?? 3987) + 100;

async function conversationModel(page: Page, model: string | null) {
  const res = await page.request.put("/api/settings/ai", {
    data: { ...(model ? { key: "sk-or-browser-test-key" } : {}), models: { conversation: model } },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

let before: string | null = null;
test.beforeAll(async ({ browser }, info) => {
  if (info.project.name !== "desktop") return;
  const page = await browser.newPage({ storageState: "test-results/.auth.json" });
  const res = await page.request.get(
    `http://localhost:${process.env.E2E_PORT ?? 3987}/api/settings`,
  );
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
  await conversationModel(page, before);
  await page.close();
});

/** Puts the cursor in the paragraph that starts with these words. */
async function cursorIn(page: Page, words: string) {
  await page.locator(".cm-content").getByText(words).click();
}

test("with no model chosen, Help says how to turn it on", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "The AI settings are one per server.");
  await conversationModel(page, null);
  await page.goto(edit(NOTE));
  await cursorIn(page, "The person.");
  // Help is on the toolbar with its name even so.
  await page.locator(".edit-toolbar").getByRole("button", { name: "Help", exact: true }).click();
  const card = page.getByRole("region", { name: "Writing help" });
  await expect(card).toContainText("Writing help needs an AI model");
  await expect(page.locator(".cm-help-passage")).toContainText("The person.");
  await card.getByRole("link", { name: "Open Settings" }).click();
  // Straight to the model for lore conversations and writing help.
  await expect(page).toHaveURL(/\/settings\/ai\/models\/conversation$/);
});

test("Help from the keyboard: a ready-made request, Keep and Undo, Try again, Discard", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "The AI settings are one per server.");
  await conversationModel(page, "sample/reader");
  await page.goto(edit(NOTE));
  await cursorIn(page, "The person.");
  await page.keyboard.press("Control+j");
  const card = page.getByRole("region", { name: "Writing help" });
  await expect(card.getByLabel("What should change?")).toBeFocused();
  await expect(page.locator(".cm-help-passage")).toContainText("The person. Carries a");

  // A chip sends at once; the suggestion reads as prose, and Keep has the focus.
  await card.getByRole("button", { name: "Fix spelling and grammar" }).click();
  await expect(card.locator(".help-card-suggestion")).toContainText(
    "A rewritten passage (Correct spelling, grammar and punctuation only",
  );
  await expect(card.getByRole("button", { name: "Keep" })).toBeFocused();
  // Most words changed, so it opens on the clean text; Changes shows them word by word.
  await expect(card.getByRole("button", { name: "Clean" })).toHaveAttribute("aria-pressed", "true");
  await card.getByRole("button", { name: "Changes" }).click();
  await expect(card.locator(".help-card-suggestion del")).not.toHaveCount(0);
  await expect(card.locator(".help-card-suggestion ins")).not.toHaveCount(0);

  // Try again asks for a different one; the earlier one is still there.
  await card.getByRole("button", { name: "Try again" }).click();
  await expect(card.locator(".help-card-suggestion")).toContainText("Another rewritten passage");
  await expect(card).toContainText("2 of 2");
  await card.getByRole("button", { name: "Earlier suggestion" }).click();
  await expect(card).toContainText("1 of 2");
  await expect(card.locator(".help-card-suggestion")).not.toContainText("Another");
  await card.getByRole("button", { name: "Later suggestion" }).click();

  // Enter on Keep keeps it, as one edit, with a way back.
  await card.getByRole("button", { name: "Keep" }).focus();
  await page.keyboard.press("Enter");
  await expect(card).toHaveCount(0);
  const text = page.locator(".cm-content");
  await expect(text).toContainText("Another rewritten passage");
  await expect(text).not.toContainText("The person.");
  await page.locator(".ui-toast").getByRole("button", { name: "Undo" }).click();
  await expect(text).toContainText("The person.");
  await expect(text).not.toContainText("Another rewritten passage");

  // Discard leaves the text as it was.
  await cursorIn(page, "The person.");
  await page.keyboard.press("Control+j");
  await card.getByRole("button", { name: "Shorter" }).click();
  await expect(card.locator(".help-card-suggestion")).toBeVisible();
  await card.getByRole("button", { name: "Discard" }).click();
  await expect(card).toHaveCount(0);
  await expect(text).toContainText("The person.");
  await expect(page.locator(".cm-help-passage")).toHaveCount(0);
  await discardDraft(page);
});

test("own words, Stop, and the passage changing while the card is open", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "The AI settings are one per server.");
  await conversationModel(page, "sample/reader");
  await page.goto(edit(NOTE));
  await cursorIn(page, "The person.");
  await page.locator(".edit-toolbar").getByRole("button", { name: "Help", exact: true }).click();
  const card = page.getByRole("region", { name: "Writing help" });

  // A slow answer can be stopped, and stopping reaches the AI call on the server.
  const slow = async () =>
    (await (await page.request.get(`http://127.0.0.2:${PICTURES}/ai-slow`)).json()) as {
      started: number;
      stopped: number;
    };
  const was = await slow();
  await card.getByLabel("What should change?").fill("Tell it slowly, as a legend");
  await page.keyboard.press("Enter");
  await expect(card).toContainText("Writing a suggestion…");
  await expect.poll(async () => (await slow()).started).toBe(was.started + 1);
  await card.getByRole("button", { name: "Stop" }).click();
  await expect(card.getByLabel("What should change?")).toBeVisible();
  await expect.poll(async () => (await slow()).stopped).toBe(was.stopped + 1);

  // A suggestion, then the passage is typed in: the card says so instead of replacing it.
  await card.getByLabel("What should change?").fill("As a legend");
  await page.keyboard.press("Enter");
  await expect(card.locator(".help-card-suggestion")).toContainText("A rewritten passage (As a");
  await page.locator(".cm-help-passage").getByText("The person.").click();
  await page.keyboard.type(" Tall");
  await expect(card).toContainText("You changed this passage after asking");
  await expect(page.locator(".cm-help-passage")).toContainText("Tall");
  await card.getByRole("button", { name: "Ask again with the new wording" }).click();
  await expect(card.locator(".help-card-suggestion")).toContainText("A rewritten passage (As a");
  // Esc closes it, and the text keeps what was typed.
  await card.getByRole("button", { name: "Keep" }).focus();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("Tall");

  // The right-click menu has Help and Ask the lore.
  const line = page.locator(".cm-line", { hasText: "The person" });
  const box = (await line.boundingBox())!;
  await page.mouse.click(box.x + 30, box.y + box.height / 2, { button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: /^Ask the lore about this/ })).toBeVisible();
  await menu.getByRole("menuitem", { name: /^Help with this/ }).click();
  await expect(card.getByLabel("What should change?")).toBeVisible();
  await card.getByRole("button", { name: "Close" }).click();
  await expect(card).toHaveCount(0);
  await discardDraft(page);
});
