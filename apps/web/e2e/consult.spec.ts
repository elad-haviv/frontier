import { expect, type Page, test } from "@playwright/test";
import { discardDraft, edit } from "./helpers.ts";

// Consult in the editor (stage 24): the AI's opinion in the right side bar. The AI settings are
// one per server, so these take turns and put the model back as they found it.
test.describe.configure({ mode: "serial" });

const NOTE = "02 People/Twin.md";

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

test("with no model chosen, Consult says how to turn it on", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "The AI settings are one per server.");
  await conversationModel(page, null);
  await page.goto(edit(NOTE));
  await page.locator(".cm-content").getByText("The person.").click();
  await page.keyboard.press("Control+Alt+r");
  const panel = page.getByRole("complementary", { name: "Consult" });
  await expect(panel).toContainText("Consult needs an AI model");
  await panel.getByRole("link", { name: "Open Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/ai\/models\/conversation$/);
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
  await expect(opinion).toHaveCount(0);
  await page.locator(".ui-toast").getByRole("button", { name: "Undo" }).click();
  await expect(text).toContainText("The person.");
  await expect(text).not.toContainText("A clearer opening.");

  // Dismiss takes a finding away; the text is untouched.
  await panel
    .locator(".consult-card", { hasText: "I find this opening unclear." })
    .getByRole("button", { name: "Dismiss" })
    .click();
  await expect(panel.locator(".consult-card")).toHaveCount(1);
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
