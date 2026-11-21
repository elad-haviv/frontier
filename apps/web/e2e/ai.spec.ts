import { expect, test } from "@playwright/test";
import { commitCount, entry, lastBody, onMain, publish, review } from "./helpers.ts";

// One test at a time changes the AI settings, which are shared by the whole server.
test.describe.configure({ mode: "serial" });

test("CUJ 5: sets up the AI, asks for fields, corrects one and accepts it into a draft", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "The AI settings are one per server.");
  const note = "02 People/Shade.md";
  const before = commitCount();

  // Nothing about AI is offered before a key and a model are set.
  await page.goto(entry(note));
  await expect(page.locator("h1")).toHaveText("Shade");
  await expect(page.getByRole("button", { name: "Propose fields" })).toHaveCount(0);

  await page.goto("/settings");
  await page.getByLabel(/Provider key/).fill("sk-or-browser-test-key");
  await page.getByLabel("Model for proposing fields").fill("sample/reader");
  await page.getByLabel("Monthly cap in US dollars").fill("5");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".banner-ok")).toHaveText("Saved.");
  await expect(page.locator(".settings")).toContainText("set, ends in -key");
  // The key itself never comes back to the browser.
  expect(await page.content()).not.toContain("sk-or-browser-test-key");
  await page.getByRole("button", { name: "Test" }).click();
  await expect(page.locator(".banner-ok")).toContainText('The model answered "ok"');

  await page.goto(entry(note));
  await page.getByRole("button", { name: "Propose fields" }).click();
  await expect(page.locator(".propose")).toContainText("1 proposed");
  await page.locator(".propose a").click();

  const proposal = page.locator(".proposal", { hasText: "Shade" });
  await expect(proposal.locator(".operation-quote")).not.toBeEmpty();
  await proposal.getByRole("button", { name: "Edit" }).click();
  await proposal.getByLabel("When").fill("in the year of the long tide");
  await proposal.getByRole("button", { name: "Accept" }).click();
  await expect(proposal).toHaveCount(0);
  // Accepting publishes nothing; the field is in a draft and shows in the reader.
  expect(commitCount()).toBe(before);
  await page.goto(entry(note));
  await expect(page.locator(".draft-note")).toBeVisible();
  await expect(page.locator(".fields")).toContainText("in the year of the long tide");

  await review(page);
  await publish(page, "Date Shade");
  expect(onMain(note)).toContain('when: "in the year of the long tide"');
  expect(lastBody()).toContain("Frontier-Model: sample/reader");

  await page.goto("/settings");
  await expect(page.locator(".calls")).toContainText(
    "Sample reader".toLowerCase().replace(" ", "/"),
  );
});

test("a rejected proposal is not made again", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "The AI settings are one per server.");
  const note = "03 Things/Lantern.md";
  await page.goto(entry(note));
  await page.getByRole("button", { name: "Propose fields" }).click();
  await expect(page.locator(".propose")).toContainText("1 proposed");
  // The reader marks it as proposed until it is decided.
  await page.reload();
  await expect(page.locator(".field-proposed")).toContainText("proposed");
  await page.goto("/inbox");
  await page
    .locator(".proposal", { hasText: "Lantern" })
    .getByRole("button", { name: "Reject" })
    .click();
  await expect(page.locator(".proposal", { hasText: "Lantern" })).toHaveCount(0);
  await page.goto(entry(note));
  await expect(page.locator(".field-proposed")).toHaveCount(0);
  await page.getByRole("button", { name: "Propose fields" }).click();
  await expect(page.locator(".propose")).toContainText("Nothing new to propose.");
});
