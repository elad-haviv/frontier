import { expect, type Page, test } from "@playwright/test";
import { answerDialog, AUTH_FILE, noSidewaysScroll, setUpAi } from "./helpers.ts";

// The AI settings are one per server: these tests take turns and put back what they change.
test.describe.configure({ mode: "serial" });

const isPhone = (name: string) => name === "phone";

/** Takes the Anthropic key off this device, if it holds one. */
async function removeAnthropic(page: Page) {
  await page.goto("/settings/device/ai-keys");
  const row = page.locator(".provider-row", { hasText: "Anthropic" });
  // The row is always listed; wait for it before looking for what it offers.
  await expect(row).toBeVisible();
  const remove = row.getByRole("button", { name: "Remove from this device" });
  if ((await remove.count()) === 0) return;
  await remove.click();
  await answerDialog(page, "Remove");
  await expect(row).toContainText("No key on this device");
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
    await expect(menu.getByRole("link", { name: /AI keys/ })).toContainText(
      "1 key in this browser",
    );
    await menu.getByRole("link", { name: /Your AI spending/ }).click();
    await expect(page).toHaveURL(/\/settings\/you\/ai-spending$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your AI spending");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/you\/ai-spending$/);
    await noSidewaysScroll(page);
  } else {
    // `/settings` opens a section; the rail marks it.
    await expect(page).toHaveURL(/\/settings\/you\/ai-models$/);
    await menu.getByRole("link", { name: "Signing in" }).click();
    await expect(page).toHaveURL(/\/settings\/account$/);
    await expect(menu.getByRole("link", { name: "Signing in" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  }
  // A deep link to a task opens its picker.
  await page.goto("/settings/you/ai-models/conversation");
  await expect(
    page.getByRole("combobox", { name: "Find a model for Lore conversations" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/settings\/you\/ai-models$/);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  // An unknown section goes back to Settings.
  await page.goto("/settings/nowhere");
  await expect(page).toHaveURL(/\/settings(\/you\/ai-models)?$/);
});

test("the old addresses of the AI sections lead to where they are now", async ({ page }) => {
  for (const [old, now] of [
    ["/settings/ai/providers", "/settings/device/ai-keys"],
    ["/settings/ai/models", "/settings/you/ai-models"],
    ["/settings/ai/models/extraction", "/settings/you/ai-models/extraction"],
    ["/settings/ai/spending", "/settings/you/ai-spending"],
    ["/settings/ai/folder-run", "/settings/you/folder-run"],
    ["/settings/device", "/settings/device/offline"],
  ] as const) {
    await page.goto(old);
    await expect(page, old).toHaveURL(new RegExp(`${now}$`));
  }
});

test("adds a key: a refused key is said under the field, a good one is tested and kept on this device", async ({
  page,
}, info) => {
  test.skip(isPhone(info.project.name), "One server: the phone runs the picker test instead.");
  await setUpAi(page, { conversation: "sample/reader" });
  await removeAnthropic(page);
  await page.goto("/settings/device/ai-keys");
  const row = page.locator(".provider-row", { hasText: "Anthropic" });
  await expect(row).toContainText("No key on this device");
  await row.getByRole("button", { name: "Add a key" }).click();
  const key = row.getByLabel("Key", { exact: true });
  await key.fill("sk-ant-wrong-key-0001");
  await row.getByRole("button", { name: "Test and keep on this device" }).click();
  await expect(row.getByRole("alert")).toContainText("(401)");
  // The field keeps its text, to fix a typo; nothing was kept.
  await expect(key).toHaveValue("sk-ant-wrong-key-0001");
  await page.reload();
  await expect(page.locator(".provider-row", { hasText: "Anthropic" })).toContainText(
    "No key on this device",
  );

  await page
    .locator(".provider-row", { hasText: "Anthropic" })
    .getByRole("button", { name: "Add a key" })
    .click();
  await key.fill("sk-ant-good-key-0002");
  await row.getByRole("button", { name: "Test and keep on this device" }).click();
  await expect(row).toContainText("Working");
  await expect(row).toContainText("sk-…0002");
  expect(await page.content()).not.toContain("sk-ant-good-key-0002");
  // It stays through a reload, as the device holds it.
  await page.reload();
  await expect(page.locator(".provider-row", { hasText: "Anthropic" })).toContainText("Working");
  // And the server never had it.
  expect(await (await page.request.get("/api/settings")).text()).not.toContain(
    "sk-ant-good-key-0002",
  );

  // Its model is listed, priced from OpenRouter's list, and can be chosen.
  await page.goto("/settings/you/ai-models/extraction");
  const search = page.getByRole("combobox", { name: "Find a model for Proposing fields" });
  await search.fill("claude");
  // Listed twice: directly, and through OpenRouter under its own name.
  const option = page.getByRole("option", { name: /^Claude Sample 1/ });
  await expect(option).toContainText("≈ $3 / $15");
  await option.hover();
  await expect(page.locator(".mp-details")).toContainText("Estimated from the price");
  await expect(page.locator(".mp-details")).toContainText("(OpenRouter's list)");

  // Removed from this device, it is gone from the list of models too.
  await removeAnthropic(page);
  await page.goto("/settings/you/ai-models/extraction");
  await page.getByRole("combobox", { name: "Find a model for Proposing fields" }).fill("claude");
  await expect(page.getByRole("option", { name: /^Claude Sample 1/ })).toHaveCount(0);
});

test("keys stay on the device: another device has none, and a key removed is gone", async ({
  page,
  browser,
}, info) => {
  test.skip(isPhone(info.project.name), "One server: the phone runs the picker test instead.");
  await setUpAi(page, { conversation: "sample/reader" });
  await page.goto("/settings/device/ai-keys");
  await expect(page.getByRole("note")).toContainText("Your keys stay in this browser.");
  await expect(page.getByRole("note")).toContainText(
    "The server never saves them and other members never see them.",
  );
  await expect(page.getByRole("note")).toContainText(
    "You pay your provider directly for what you use.",
  );
  await expect(page.getByRole("note")).toContainText(
    "On another phone or computer add the key again, and clearing this browser's data removes it.",
  );
  await expect(page.locator(".settings-section")).toContainText(
    "What changes without a server key: AI work happens only while you have Frontier open.",
  );
  const row = page.locator(".provider-row", { hasText: "OpenRouter" });
  await expect(row).toContainText("key sk-…-key");

  // Another device, signed in the same way, has no key.
  const other = await browser.newContext({
    storageState: AUTH_FILE,
    serviceWorkers: "block",
    baseURL: `http://localhost:${process.env.E2E_PORT ?? 3987}`,
  });
  const second = await other.newPage();
  await second.goto("/settings/device/ai-keys");
  await expect(second.locator(".provider-row", { hasText: "OpenRouter" })).toContainText(
    "No key on this device",
  );
  await expect(second.locator(".provider-row", { hasText: "OpenRouter" })).toContainText(
    "Used for",
  );
  await other.close();

  // Remove from this device asks first, then takes the key off.
  await row.getByRole("button", { name: "Remove from this device" }).click();
  await answerDialog(page, "Remove");
  await expect(row).toContainText("No key on this device");
  await page.reload();
  await expect(page.locator(".provider-row", { hasText: "OpenRouter" })).toContainText(
    "No key on this device",
  );
  expect(await page.evaluate(() => localStorage.getItem("frontier.aiKeys"))).not.toContain(
    "sk-or-browser-test-key",
  );
});

test("chooses a model through the picker with search, keys and details, then undoes it", async ({
  page,
}, info) => {
  await setUpAi(page, { conversation: "sample/reader" });
  await page.goto("/settings/you/ai-models");
  const row = page.locator("#task-conversation");
  await expect(row.locator(".model-chip")).toContainText("Sample reader");
  await row.getByRole("button", { name: "Change", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/you\/ai-models\/conversation$/);
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
    await expect(page.locator(".mp-details")).toContainText("charges you");
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
