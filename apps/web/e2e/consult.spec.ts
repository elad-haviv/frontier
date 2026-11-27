import { expect, type Page, test } from "@playwright/test";
import { discardDraft, edit, giveDeviceKeys, at } from "./helpers.ts";

// Consult in the editor (stage 24): the AI's opinion in the right side bar. The AI settings are
// one per server, so these take turns and put the model back as they found it.
test.describe.configure({ mode: "serial" });

const NOTE = "02 People/Twin.md";

async function conversationModel(page: Page, model: string | null) {
  const res = await page.request.put("/api/settings/ai", {
    data: { models: { conversation: model } },
  });
  expect(res.ok(), await res.text()).toBe(true);
  // The key is the device's own (stage 27f): the stand-in's goes on this browser.
  if (model) await giveDeviceKeys(page);
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

test("with no model chosen, Consult says how to turn it on", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "The AI settings are one per server.");
  await conversationModel(page, null);
  await page.goto(edit(NOTE));
  await page.locator(".cm-content").getByText("The person.").click();
  await page.keyboard.press("Control+Alt+r");
  const panel = page.getByRole("complementary", { name: "Consult" });
  await expect(panel).toContainText("Consult needs an AI model");
  await panel.getByRole("link", { name: "Open Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/you\/ai-models\/conversation$/);
});

test("reads the whole entry, jumps to a passage, applies a suggestion and undoes it", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "The AI settings are one per server.");
  await conversationModel(page, "sample/reader");
  await page.goto(edit(NOTE));
  const text = page.locator(".cm-content");
  await text.getByText("The person.").click();
  await page.keyboard.press("Control+Alt+r");
  const panel = page.getByRole("complementary", { name: "Consult" });

  // Nothing has changed since it was published, so "My changes" is not offered.
  await expect(panel.getByRole("button", { name: "My changes" })).toBeDisabled();
  await expect(panel).toContainText("A stand-in opinion.");
  const opinion = panel.locator(".consult-card", { hasText: "I find this opening unclear." });
  await expect(opinion).toContainText("Opinion");
  // A claim about the lore is shown as checked or unverified, never as plain fact.
  await expect(
    panel.locator(".consult-card", { hasText: "conflicts with another entry" }),
  ).toContainText(/Checked|Unverified/);

  // Choosing a finding highlights its passage.
  await opinion.locator(".consult-head").click();
  await expect(page.locator(".cm-consult-passage")).toContainText("The person");

  // Apply is one edit, with a way back.
  await opinion.getByRole("button", { name: "Apply" }).click();
  await expect(text).toContainText("A clearer opening.");
  // The finding stays in its review, saying what was done and what it replaced.
  await expect(opinion).toContainText("Applied");
  await expect(opinion.locator(".consult-suggest del")).toContainText("The person.");
  await page.locator(".ui-toast").getByRole("button", { name: "Undo" }).click();
  await expect(text).toContainText("The person.");
  await expect(text).not.toContainText("A clearer opening.");
  await expect(opinion).not.toContainText("Applied");

  // Dismiss folds a finding into "Dismissed", where it can be restored; the text is untouched.
  await opinion.getByRole("button", { name: "Dismiss" }).click();
  const dismissed = panel.locator(".consult-dismissed");
  await expect(dismissed).toContainText("Dismissed (1)");
  await dismissed.locator("summary").click();
  await dismissed.getByRole("button", { name: "Restore" }).click();
  await expect(panel.locator(".consult-dismissed")).toHaveCount(0);
  await expect(opinion).toBeVisible();
  await discardDraft(page);
});

test("keeps its history: a review survives leaving the page, with what was done with each finding", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "The AI settings are one per server.");
  await conversationModel(page, "sample/reader");
  await page.request.delete(`/api/write/reviews?path=${encodeURIComponent(NOTE)}`);
  await page.goto(edit(NOTE));
  const text = page.locator(".cm-content");
  await text.getByText("The person.").click();
  await page.keyboard.press("Control+Alt+r");
  const panel = page.getByRole("complementary", { name: "Consult" });
  const opinion = panel.locator(".consult-card", { hasText: "I find this opening unclear." });
  await expect(opinion).toBeVisible();
  await opinion.getByRole("button", { name: "Apply" }).click();
  await expect(opinion).toContainText("Applied");
  await panel
    .locator(".consult-card", { hasText: "conflicts with another entry" })
    .getByRole("button", { name: "Dismiss" })
    .click();
  await expect(panel.locator(".consult-dismissed")).toContainText("Dismissed (1)");

  // Leave and come back: the review is there as it was left, and nothing runs by itself.
  await page.goto(at("/"));
  await page.goto(edit(NOTE));
  await page.getByRole("tab", { name: "Consult" }).click();
  const back = page.getByRole("complementary", { name: "Consult" });
  await expect(back).toContainText("Latest review");
  await expect(back).toContainText("A stand-in opinion.");
  await expect(
    back.locator(".consult-card", { hasText: "I find this opening unclear." }),
  ).toContainText("Applied");
  await expect(back.locator(".consult-dismissed")).toContainText("Dismissed (1)");

  // A second review is added to the history, newest first; open the older one, then delete it.
  await back.getByRole("button", { name: "Consult again" }).click();
  await expect(back.getByRole("button", { name: /History \(2\)/ })).toBeVisible();
  await back.getByRole("button", { name: /History \(2\)/ }).click();
  const rows = back.locator(".consult-row-btn");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("1 applied");
  await expect(rows.nth(1)).toContainText("1 dismissed");
  await rows.nth(1).click();
  await expect(
    back.locator(".consult-card", { hasText: "I find this opening unclear." }),
  ).toContainText("Applied");
  await back.getByRole("button", { name: "Delete this review" }).click();
  await back.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(rows).toHaveCount(1);

  // Clear history asks first, then empties it.
  await back.getByRole("button", { name: "Clear history" }).click();
  await back.getByRole("button", { name: "Delete all" }).click();
  // Back to the panel as it is before any review: no history, and "Consult" not "Consult again".
  await expect(back.getByRole("button", { name: "Consult", exact: true })).toBeVisible();
  await expect(back.getByText("Latest review")).toHaveCount(0);
  await expect(back.getByRole("button", { name: /History/ })).toHaveCount(0);
  await page.request.delete(`/api/write/reviews?path=${encodeURIComponent(NOTE)}`);
  await discardDraft(page);
});

test("reads my changes against the published text, and notices the text changed since", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "The AI settings are one per server.");
  await conversationModel(page, "sample/reader");
  await page.goto(edit(NOTE));
  const text = page.locator(".cm-content");
  await text.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n\nA new paragraph about the twin.");
  await page.keyboard.press("Control+Alt+r");
  const panel = page.getByRole("complementary", { name: "Consult" });
  await expect(panel.getByRole("button", { name: "My changes" })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "My changes" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // One verdict for the one changed passage.
  await expect(panel.locator(".consult-edits li")).toHaveCount(1);
  await expect(panel.locator(".consult-verdict")).toHaveText("Neutral");
  await expect(panel.locator(".consult-edits")).toContainText("A new paragraph about the twin.");

  await page.keyboard.type(" More.");
  await expect(panel).toContainText("Edited since this review.");
  await discardDraft(page);
});
