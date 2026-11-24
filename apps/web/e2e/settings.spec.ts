import { expect, type Page, test } from "@playwright/test";
import { answerDialog, noSidewaysScroll, setUpAi } from "./helpers.ts";

// The AI settings are one per server: these tests take turns and put back what they change.
test.describe.configure({ mode: "serial" });

const isPhone = (name: string) => name === "phone";

async function removeAnthropic(page: Page) {
  await page.goto("/settings/ai/providers");
  const row = page.locator(".provider-row", { hasText: "Anthropic" });
  if ((await row.count()) === 0) return;
  await row.getByRole("button", { name: "Remove" }).click();
  await answerDialog(page, "Remove");
  await expect(row).toHaveCount(0);
}

test("the menu: a rail on a wide screen, a list to drill into on a phone, and deep links", async ({
  page,
}, info) => {
  await setUpAi(page, { conversation: "sample/reader" });
  await page.goto("/settings");
  const menu = page.getByRole("navigation", { name: "Settings" });
  if (isPhone(info.project.name)) {
    // The list, each row with its state; a row opens its section, and Back comes home.
    await expect(page).toHaveURL(/\/settings$/);
    await expect(menu.getByRole("link", { name: /Providers/ })).toContainText(
      "Connected: OpenRouter",
    );
    await menu.getByRole("link", { name: /Spending/ }).click();
    await expect(page).toHaveURL(/\/settings\/ai\/spending$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Spending");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/ai\/spending$/);
    await noSidewaysScroll(page);
  } else {
    // `/settings` opens a section; the rail marks it.
    await expect(page).toHaveURL(/\/settings\/ai\/(providers|models)$/);
    await menu.getByRole("link", { name: "Signing in" }).click();
    await expect(page).toHaveURL(/\/settings\/account$/);
    await expect(menu.getByRole("link", { name: "Signing in" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  }
  // A deep link to a task opens its picker.
  await page.goto("/settings/ai/models/conversation");
  await expect(
    page.getByRole("combobox", { name: "Find a model for Lore conversations" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/settings\/ai\/models$/);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  // An unknown section goes back to Settings.
  await page.goto("/settings/nowhere");
  await expect(page).toHaveURL(/\/settings(\/ai\/(providers|models))?$/);
});

test("adds a provider: a refused key is said under the field, a good one is checked and stored", async ({
  page,
}, info) => {
  test.skip(isPhone(info.project.name), "One server: the phone runs the picker test instead.");
  await removeAnthropic(page);
  await page.goto("/settings/ai/providers");
  await page.getByRole("button", { name: /^Anthropic/ }).click();
  const key = page.getByLabel("Key for Anthropic");
  await key.fill("sk-ant-wrong-key-0001");
  await page.getByRole("button", { name: "Check and save" }).click();
  const offer = page.locator(".provider-offers li.open");
  await expect(offer.locator(".field-error")).toContainText("(401)");
  // The field keeps its text, to fix a typo; nothing was stored.
  await expect(key).toHaveValue("sk-ant-wrong-key-0001");
  await expect(page.locator(".provider-row", { hasText: "Anthropic" })).toHaveCount(0);

  await key.fill("sk-ant-good-key-0002");
  await page.getByRole("button", { name: "Check and save" }).click();
  const row = page.locator(".provider-row", { hasText: "Anthropic" });
  await expect(row).toContainText("Connected");
  await expect(row).toContainText("sk-…0002");
  await expect(row).toContainText("costs estimated from prices");
  expect(await page.content()).not.toContain("sk-ant-good-key-0002");

  // Its model is listed, priced from OpenRouter's list, and can be chosen.
  await page.goto("/settings/ai/models/extraction");
  const search = page.getByRole("combobox", { name: "Find a model for Proposing fields" });
  await search.fill("claude");
  // Listed twice: directly, and through OpenRouter under its own name.
  const option = page.getByRole("option", { name: /^Claude Sample 1/ });
  await expect(option).toContainText("≈ $3 / $15");
  await option.hover();
  await expect(page.locator(".mp-details")).toContainText("Estimated from the price");
  await expect(page.locator(".mp-details")).toContainText("(OpenRouter's list)");

  await removeAnthropic(page);
});

test("chooses a model through the picker with search, keys and details, then undoes it", async ({
  page,
}, info) => {
  await setUpAi(page, { conversation: "sample/reader" });
  await page.goto("/settings/ai/models");
  const row = page.locator("#task-conversation");
  await expect(row.locator(".model-chip")).toContainText("Sample reader");
  await row.getByRole("button", { name: "Change", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/ai\/models\/conversation$/);
  const search = page.getByRole("combobox", { name: "Find a model for Lore conversations" });
  // A missing letter is forgiven.
  await search.fill("wrter");
  const listed = page.getByRole("listbox").getByRole("option");
  await expect(listed).toHaveCount(1);
  await expect(listed.first()).toContainText("Sample writer");
  // The painter cannot answer in a fixed form: hidden, then shown greyed when asked for.
  await search.fill("sample");
  await expect(page.getByRole("option", { name: /Sample painter/ })).toHaveCount(0);
  await page.locator(".mp-more").getByRole("button", { name: "Show them" }).click();
  await expect(page.getByRole("option", { name: /Sample painter/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.getByRole("button", { name: "Fits this task" }).click();
  await search.fill("writer");
  if (isPhone(info.project.name)) {
    // The details open from the row's ⓘ, with "Use this model".
    await page.getByRole("button", { name: "Details of Sample writer" }).click();
    const details = page.getByRole("dialog", { name: "Details of Sample writer" });
    await expect(details).toContainText("A larger model for lore conversations.");
    await expect(details).toContainText("1M tokens");
    await details.getByRole("button", { name: "Use this model" }).click();
  } else {
    await search.press("ArrowDown");
    await expect(page.locator(".mp-details")).toContainText(
      "A larger model for lore conversations.",
    );
    await expect(page.locator(".mp-details")).toContainText("Your cap of");
    await search.press("Enter");
  }
  await expect(row.locator(".model-chip")).toContainText("Sample writer");
  await expect(row.locator(".saved-mark")).toContainText("Saved");

  // Undo puts the model before it back.
  await page.locator(".ui-toast").getByRole("button", { name: "Undo" }).click();
  await expect(row.locator(".model-chip")).toContainText("Sample reader");
  const saved = await page.request.get("/api/settings");
  expect((await saved.json()).ai.models.conversation).toBe("openrouter:sample/reader");
});
