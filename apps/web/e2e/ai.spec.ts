import { expect, test } from "@playwright/test";
import {
  commitCount,
  discardDraft,
  entry,
  lastBody,
  onMain,
  openEditor,
  publish,
  review,
} from "./helpers.ts";

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

test("CUJ 11: asks the lore, reads cited answers, and keeps a drafted addition as a draft", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "The AI settings are one per server.");
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("/settings");
  await page.getByLabel(/Provider key/).fill("sk-or-browser-test-key");
  await page.getByLabel("Model for lore conversations").fill("sample/reader");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".banner-ok")).toHaveText("Saved.");

  await page.goto("/ask");
  await page.getByLabel("A question").fill("Who is Shade?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page).toHaveURL(/\/ask\/[a-z0-9]{12}$/);

  // The supported paragraph quotes its entry and links to it; the other is marked as a guess.
  const turn = page.locator(".turn").first();
  await expect(turn.locator(".turn-question")).toHaveText("Who is Shade?");
  const supported = turn.locator(".answer-para").first();
  await expect(supported.locator("blockquote")).toContainText(
    "A quiet figure. Friend of [[Mira]].",
  );
  await expect(supported.locator(".sources")).toContainText("Shade");
  await expect(turn.locator(".answer-para.is-guess")).toContainText("Bells ring at dawn.");
  await expect(turn.locator(".guess")).toBeVisible();
  await expect(turn.locator(".turn-meta summary")).toContainText(/Read \d+ entr/);

  // A follow-up the lore does not cover: an addition is drafted and kept as a draft.
  await page.getByLabel("Ask again").fill("What is unknown about Shade?");
  await page.getByRole("button", { name: "Ask" }).click();
  const second = page.locator(".turn").nth(1);
  await expect(second.locator(".not-in-lore")).toContainText("This is not in the lore.");
  await second.getByRole("button", { name: "Draft an addition" }).click();
  const addition = second.locator(".addition");
  await expect(addition).toContainText("Written by the AI");
  await expect(addition.locator(".diff, ins, .added").first()).toBeVisible();
  await addition.getByLabel("Where the addition goes").selectOption({ label: "Shade" });
  await addition.getByRole("button", { name: "Keep as a draft" }).click();
  await expect(second.locator(".banner-ok")).toContainText("Kept as a draft of Shade");
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);

  await page.goto("/unpublished");
  const shade = page.locator(".changes li", { hasText: "02 People/Shade.md" });
  await expect(shade).toContainText("Holds an addition the AI drafted");
  await shade.getByRole("button", { name: "Discard" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard", exact: true })
    .click()
    .catch(() => undefined);

  // The conversation is listed, and can be deleted.
  await page.goto("/ask");
  await expect(page.locator(".map-list li", { hasText: "Who is Shade?" })).toContainText(
    "2 questions",
  );
  await page.locator(".map-list a", { hasText: "Who is Shade?" }).click();
  await page.getByRole("button", { name: "Delete the conversation" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/ask$/);
});

test("writing help rewrites a passage in the editor, shown as a difference first", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "The AI settings are one per server.");
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("/settings");
  await page.getByLabel(/Provider key/).fill("sk-or-browser-test-key");
  await page.getByLabel("Model for lore conversations").fill("sample/reader");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".banner-ok")).toHaveText("Saved.");

  await openEditor(page, "02 People/Shade.md");
  // The cursor in the paragraph is enough: the whole paragraph is the passage.
  await page.locator(".cm-content").getByText("A quiet figure.").click();
  await page.getByRole("button", { name: "Writing help" }).click();
  const panel = page.locator(".writing-panel");
  await expect(panel.locator(".writing-passage")).toContainText("A quiet figure.");
  await panel.getByRole("button", { name: "Shorter" }).click();
  await expect(panel.locator(".diff")).toContainText("A rewritten passage (Make it shorter)");
  await panel.getByRole("button", { name: "Replace" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("A rewritten passage (Make it shorter).");
  await expect(page.locator(".cm-content")).not.toContainText("A quiet figure.");

  // Asked about the passage, the lore answers in the panel.
  await page.getByRole("button", { name: "Writing help" }).click();
  await panel.getByLabel("Ask the lore about this passage").fill("Who is this?");
  await panel.getByRole("button", { name: "Ask" }).click();
  await expect(panel.locator(".writing-answer")).toContainText("Open the conversation");
  await panel.getByRole("button", { name: "Close" }).click();

  await discardDraft(page);
});
