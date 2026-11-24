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
  pressTool,
  newMapInForm,
  pickEntry,
  setUpAi,
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

  // Settings › Providers: the key is checked with the provider, then stored.
  await page.goto("/settings/ai/providers");
  await page.getByRole("button", { name: /^OpenRouter/ }).click();
  await page.getByLabel("Key for OpenRouter").fill("sk-or-browser-test-key");
  await page.getByRole("button", { name: "Check and save" }).click();
  const row = page.locator(".provider-row", { hasText: "OpenRouter" });
  await expect(row).toContainText("Connected");
  await expect(row).toContainText("sk-…-key");
  // The key itself never comes back to the browser.
  expect(await page.content()).not.toContain("sk-or-browser-test-key");

  // Settings › Models: the picker, as a sheet on the phone.
  await page.goto("/settings/ai/models/extraction");
  const sheet = page.getByRole("dialog", { name: "Model for Proposing fields" });
  await sheet.getByRole("combobox", { name: /Find a model/ }).fill("reader");
  await sheet.getByRole("option", { name: /Sample reader/ }).click();
  await expect(sheet).toHaveCount(0);
  const task = page.locator("#task-extraction");
  await expect(task.locator(".model-chip")).toContainText("Sample reader");
  await task.getByRole("button", { name: "Try it" }).click();
  await expect(task.locator(".field-ok")).toContainText('The model answered "ok"');

  // Settings › Spending: the cap saves on Enter.
  await page.goto("/settings/ai/spending");
  await page.getByLabel("Monthly cap in US dollars").fill("5");
  await page.getByLabel("Monthly cap in US dollars").press("Enter");
  await expect(page.locator(".saved-mark").first()).toContainText("Saved");

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
  expect(lastBody()).toContain("Frontier-Model: openrouter:sample/reader");

  await page.goto("/settings/ai/spending");
  await expect(page.locator(".call-log")).toContainText("sample/reader");
  await expect(page.locator(".call-log")).toContainText("Proposed fields");
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
  await setUpAi(page, { conversation: "sample/reader" });

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
  await expect(turn.locator(".turn-meta > summary")).toContainText(/Read \d+ entr/);

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

test("shows the work while the lore is answered, step by step, and can stop it", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "The AI settings are one per server.");
  await page.setViewportSize({ width: 375, height: 740 });
  await setUpAi(page, { conversation: "sample/reader" });

  // The model asks for more once, then answers: each step shows as it happens.
  await page.goto("/ask");
  await page.getByLabel("A question").fill("Who is Shade? Look further.");
  await page.getByRole("button", { name: "Ask" }).click();
  const live = page.locator(".lore-live");
  await expect(live.locator(".turn-question")).toHaveText("Who is Shade? Look further.");
  const named = live.locator(".lore-step", { hasText: "Looked for entries the question names" });
  await expect(named.locator(".lore-chip", { hasText: "Shade" })).toBeVisible();
  await expect(live.locator(".lore-step.is-active")).toContainText("Asking the model");
  await expect(live.locator(".lore-thinking summary")).toHaveText("Thinking…");
  await expect(live.locator(".lore-thinking-text")).toContainText("Looking at the entries");
  await expect(live.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(
    live.locator(".lore-step", { hasText: "The model asked for more entries" }),
  ).toBeVisible();
  await expect(
    live.locator(".lore-step", { hasText: "Searched the library for “Mira”" }),
  ).toBeVisible();

  // The answer arrives; the work folds to one line, which opens again.
  await expect(page).toHaveURL(/\/ask\/[a-z0-9]{12}$/, { timeout: 30_000 });
  const turn = page.locator(".turn").first();
  await expect(turn.locator(".answer-para").first().locator("blockquote")).toBeVisible();
  const work = turn.locator(".lore-work");
  await expect(work.locator("> summary")).toContainText(/Read \d+ entries · thought for \d+s/);
  await expect(work.locator(".lore-step").first()).toBeHidden();
  await work.locator("> summary").click();
  await expect(work.locator(".lore-step", { hasText: "Checked the quotes" })).toBeVisible();
  await expect(
    work.locator(".lore-step", { hasText: "Searched the library for “Mira”" }),
  ).toBeVisible();
  await work.locator(".lore-thinking summary").click();
  await expect(work.locator(".lore-thinking-text")).toContainText("quote its opening line");
  await work.locator(".lore-chip", { hasText: "Shade" }).first().click();
  await expect(page).toHaveURL(/Shade/);
  await page.goBack();

  // A failure shows in the conversation, in the provider's words.
  await page.getByLabel("Ask again").fill("Will the provider fall over?");
  await page.getByRole("button", { name: "Ask" }).click();
  const failed = page.locator(".lore-live .lore-failed");
  await expect(failed).toContainText("The answer could not be finished.");
  await expect(failed).toContainText("The test provider fell over");

  // Stopped while it thinks: nothing is kept.
  await page.getByLabel("Ask again").fill("Who is Mira, slowly?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.locator(".lore-live .lore-thinking-text")).toContainText("Looking");
  await page.locator(".lore-live").getByRole("button", { name: "Stop" }).click();
  await expect(page.locator(".lore-live")).toContainText("Stopped. Nothing was kept.");
  await expect(page.getByLabel("Ask again")).toHaveValue("Who is Mira, slowly?");
  await page.reload();
  await expect(page.locator(".turn")).toHaveCount(1);
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);

  await page.getByRole("button", { name: "Delete the conversation" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/ask$/);
});

test("writing help on a phone: a card under the passage, and asking the lore about it", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "The AI settings are one per server.");
  await page.setViewportSize({ width: 375, height: 740 });
  await setUpAi(page, { conversation: "sample/reader" });

  // Asking the lore is in the toolbar's "⋯": the Ask page opens with the passage quoted.
  await openEditor(page, "02 People/Shade.md");
  await page.locator(".cm-content").getByText("A quiet figure.").click();
  await pressTool(page, "Ask the lore about this…");
  await expect(page).toHaveURL(/\/ask$/);
  await expect(page.getByLabel("A question")).toHaveValue(
    /^About this passage of "Shade":\n"""\nA quiet figure\.[^"]*\n"""\n$/,
  );

  // The cursor in the paragraph is enough: the whole paragraph is the passage. Help is the first
  // button on the bar.
  await openEditor(page, "02 People/Shade.md");
  await page.locator(".cm-content").getByText("A quiet figure.").click();
  await page.locator(".edit-toolbar").getByRole("button", { name: "Help", exact: true }).click();
  const card = page.getByRole("region", { name: "Writing help" });
  await expect(page.locator(".cm-help-passage")).toContainText("A quiet figure.");
  await card.getByRole("button", { name: "Shorter" }).click();
  await expect(card.locator(".help-card-suggestion")).toContainText(
    "A rewritten passage (Make it shorter)",
  );
  await expect(card).toBeInViewport();
  await card.getByRole("button", { name: "Keep" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("A rewritten passage (Make it shorter).");
  await expect(page.locator(".cm-content")).not.toContainText("A quiet figure.");

  await discardDraft(page);
});

test("comments on a passage: one for the author, one the AI works on", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "The AI settings are one per server.");
  await page.setViewportSize({ width: 375, height: 740 });
  await setUpAi(page, { conversation: "sample/reader" });

  await openEditor(page, "02 People/Shade.md");
  await page.locator(".cm-content").getByText("A quiet figure.").click();
  await pressTool(page, "Comment");
  const panel = page.locator(".comments-panel");
  await expect(panel.locator(".writing-passage")).toContainText("A quiet figure.");
  await panel.getByLabel("Your comment").fill("Say what she does at night");
  await panel.getByLabel("For the AI").check();
  await panel.getByRole("button", { name: "Keep the comment" }).click();
  await expect(panel.locator(".comment-list > li")).toHaveCount(1);
  await expect(page.locator(".cm-comment").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Comments (1)" })).toBeVisible();

  // Its suggestion shows in the writing help card, under the passage.
  await panel.getByRole("button", { name: "Suggest a change" }).click();
  const card = page.getByRole("region", { name: "Writing help" });
  await expect(card.locator(".help-card-suggestion")).toContainText(
    "A rewritten passage (Do what this comment on the passage asks)",
  );
  await card.getByRole("button", { name: "Keep" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await expect(panel.locator(".comment-list > li")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("A rewritten passage (Do what");
  await expect(page.locator(".cm-comment")).toHaveCount(0);

  // A comment for the author stays, and the entry's page counts it.
  await page.locator(".cm-content").getByText("A rewritten passage").click();
  await pressTool(page, "Comment");
  await panel.getByLabel("Your comment").fill("Check her age");
  await panel.getByRole("button", { name: "Keep the comment" }).click();
  await expect(panel.locator(".comment-list > li")).toHaveCount(1);
  await panel.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("link", { name: "1 open comment" }).click();
  await expect(panel.locator(".comment-text")).toHaveText("Check her age");
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel.locator(".comment-list > li")).toHaveCount(0);
  await panel.getByRole("button", { name: "Close" }).click();

  await discardDraft(page);
});

test("CUJ 12: drafts a character's profile, approves it, talks, and adds a line to the entry", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "The AI settings are one per server.");
  await page.setViewportSize({ width: 375, height: 740 });
  await setUpAi(page, { conversation: "sample/reader" });

  await page.goto("/talk/02%20People/Shade.md");
  await expect(page.locator("h1")).toHaveText("Talk with Shade");
  await page.getByRole("button", { name: "Draft a profile from the entries" }).click();
  const traits = page.locator(".trait");
  await expect(traits).toHaveCount(2);
  await expect(traits.first()).toContainText("From Shade");
  await expect(traits.nth(1).getByLabel("Kind of trait")).toHaveValue("unknown");
  await traits
    .nth(1)
    .getByLabel("Trait", { exact: true })
    .fill("Where Shade was born is not told.");
  await page.getByLabel("Speaks from").fill("The night of the harbor fire");
  await page.getByRole("button", { name: "Approve the profile" }).click();
  await expect(page.locator(".lede")).toContainText("Speaking from: The night of the harbor fire");

  await page.getByLabel("Say something to Shade").fill("Who are your friends?");
  await page.getByRole("button", { name: "Say it" }).click();
  const lines = page.locator(".talk-character");
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toContainText("A quiet figure. Friend of [[Mira]].");
  await expect(lines.first().locator(".sources")).toContainText("Shade");
  await expect(lines.nth(1)).toHaveClass(/is-improvised/);
  await expect(lines.nth(1)).toContainText("Improvised");
  await lines.nth(1).getByRole("button", { name: "Add to Shade's entry" }).click();
  await expect(lines.nth(1)).toContainText("Added to Shade's entry");
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);

  // The profile, the id it needed, and the line are unsaved changes; they are thrown away here.
  await page.goto("/unpublished");
  await expect(page.locator(".changes")).toContainText(".frontier/profiles/");
  await expect(
    page
      .locator(".changes li")
      .filter({ has: page.locator(".change-path", { hasText: /^02 People\/Shade\.md$/ }) }),
  ).toContainText("Holds an addition the AI drafted");
  await page.evaluate(async () => {
    const un = await (await fetch("/api/unpublished")).json();
    for (const d of un.drafts) await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
  });
});

test("CUJ 13: explores a map, makes concept art when asked, and keeps a discovery", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "The AI settings are one per server.");
  await page.setViewportSize({ width: 375, height: 740 });
  await setUpAi(page, { conversation: "sample/reader", art: "sample/painter" });

  // A map with a marker for Mira near the middle.
  await newMapInForm(page, "Explored coast", "flat");
  const box = (await page.locator(".map-top").boundingBox())!;
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.getByRole("button", { name: "Marker" }).click();
  await page.mouse.click(c.x, c.y);
  const editor = page.locator(".feature-editor");
  await pickEntry(editor, "Mira");
  await expect(page.locator(".save-saved")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  // Explore: a tap on the empty coast nearby proposes a discovery, shown as a provisional pin.
  await page.getByRole("button", { name: "Explore" }).click();
  await page.mouse.click(c.x + 40, c.y - 30);
  const card = page.locator(".discovery-card");
  await expect(card.locator("h2")).toHaveText("Test Hollow");
  await expect(card).toContainText("not in the lore");
  await expect(card.locator(".discovery-basis")).toContainText("Mira");
  await expect(page.locator(".discovery-pin")).toHaveCount(1);
  // No picture until asked for.
  await expect(card.locator(".discovery-art")).toHaveCount(0);
  await card.getByRole("button", { name: "Make concept art" }).click();
  await expect(card.locator(".discovery-art")).toBeVisible();

  await card.getByLabel("Folder for the new entry").selectOption("02 People");
  await card.getByRole("button", { name: "Keep" }).click();
  await expect(page.locator(".map-notice")).toContainText("02 People/Test Hollow.md");
  await expect(page.locator(".discovery-pin")).toHaveCount(0);

  await page.goto("/unpublished");
  const changes = page.locator(".changes");
  await expect(changes).toContainText("02 People/Test Hollow.md");
  await expect(changes).toContainText("Test Hollow.png");

  await page.evaluate(async () => {
    const maps = await (await fetch("/api/maps")).json();
    for (const m of maps.maps)
      if (m.title === "Explored coast") await fetch(`/api/maps/${m.id}`, { method: "DELETE" });
    const un = await (await fetch("/api/unpublished")).json();
    for (const d of un.drafts) await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
  });
});
