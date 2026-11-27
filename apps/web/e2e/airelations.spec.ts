import { expect, type Page, test } from "@playwright/test";
import { setUpAi } from "./helpers.ts";

// Stage 31: the AI reads relations from an entry's text. The stand-in model proposes "parent" for
// "daughter of X" and "partner" for "married X", quoting the sentence.

const ADA = "Zz Kin/Ada Rook.md";
const BRAM = "Zz Kin/Bram Rook.md";
const COLE = "Zz Kin/Cole Ash.md";

/** Makes the three entries and publishes only them, so no other test's drafts are published. */
async function publishFamily(page: Page) {
  const texts: Record<string, string> = {
    [ADA]: "# Ada Rook\n\nAda was the daughter of Bram Rook. She married Cole Ash on the shore.\n",
    [BRAM]: "# Bram Rook\n\nA salt carter.\n",
    [COLE]: "# Cole Ash\n\nA net maker.\n",
  };
  const ids: string[] = [];
  let n = 0;
  for (const [path, text] of Object.entries(texts)) {
    const id = `kinseed${n++}`.padEnd(12, "0");
    const res = await page.request.put("/api/drafts", {
      data: { id, path, kind: "create", text, revision: 0, baseBlob: "" },
    });
    expect(res.ok(), await res.text()).toBe(true);
    ids.push(id);
  }
  const plan = await page.request.post("/api/publish/plan", {
    data: { draftIds: ids, renameIds: [] },
  });
  expect(plan.ok(), await plan.text()).toBe(true);
  const { planId, merges } = (await plan.json()) as { planId: string; merges: { id: string }[] };
  const done = await page.request.post("/api/publish/confirm", {
    data: { planId, confirmedMergeIds: merges.map((m) => m.id), message: "Add the Rooks" },
  });
  expect(done.ok(), await done.text()).toBe(true);
}

test("relations read from the text: decide in the inbox and the tree, and undo", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "The AI settings are one per server.");
  await page.goto("/");
  await publishFamily(page);
  await setUpAi(page, { extraction: "openrouter:sample/reader" });
  const made = await page.request.post("/api/proposals/fields", { data: { path: ADA } });
  expect(made.ok(), await made.text()).toBe(true);

  // The inbox: the relation, how its person was matched, and the words that state it.
  await page.goto("/inbox");
  await page.getByRole("button", { name: /^Relations · / }).click();
  const section = page.locator(".proposal", { hasText: "Ada Rook" });
  const parent = section.locator(".rp", { hasText: "Bram Rook" });
  await expect(parent.locator(".rp-match")).toHaveText("→ entry");
  await expect(parent.locator("mark")).toHaveText("daughter of Bram Rook");
  await parent.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Saved on Ada Rook's entry: parent [[Bram Rook]].")).toBeVisible();
  const text = async () =>
    (
      (await (await page.request.get(`/api/entries?path=${encodeURIComponent(ADA)}`)).json()) as {
        text: string;
      }
    ).text;
  expect(await text()).toContain('what: parent\n    who: "[[Bram Rook]]"');

  // Undo takes it back, and the proposal waits again.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(text).not.toContain("relations:");
  await page.reload();
  await page.getByRole("button", { name: /^Relations · / }).click();
  await expect(
    page.locator(".proposal", { hasText: "Ada Rook" }).locator(".rp", { hasText: "Bram Rook" }),
  ).toBeVisible();

  // A tree from Bram draws the proposals dotted, each with a ? that opens it.
  await page.goto("/trees");
  await page
    .getByRole("button", { name: /^New tree/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "New tree" });
  await dialog.getByLabel("Name").fill("The Rooks");
  await dialog.getByRole("combobox").click();
  await page.getByPlaceholder("Find an entry").fill("Bram Rook");
  await page.getByRole("option", { name: "Bram Rook", exact: true }).click();
  await dialog.getByRole("button", { name: "Make the tree" }).click();
  await expect(page).toHaveURL(/\/tree\/[a-z0-9]{8}$/);
  await expect(page.getByRole("button", { name: /Proposed · 2/ })).toBeVisible();
  const mark = page.getByRole("button", { name: /^Proposed: Ada Rook, partner Cole Ash/ });
  await mark.focus();
  await page.keyboard.press("Enter");
  const box = page.locator(".tr-proposal-box");
  await expect(box.locator("mark")).toHaveText("married Cole Ash");
  await box.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByRole("button", { name: /Proposed · 1/ })).toBeVisible();

  // The entry's Relations tab lists what was read in its text.
  await page.goto("/e/Zz%20Kin/Ada%20Rook.md");
  await page.getByRole("button", { name: "Relations", exact: true }).first().click();
  await expect(page.getByText(/Proposed from the text · 1/)).toBeVisible();
});
