import { expect, test } from "@playwright/test";
import { commitCount, entry, onMain, publish, pushToMain, review, proj } from "./helpers.ts";

test("a note pushed straight to the vault waits for the author, who reverts it", async ({
  page,
}, info) => {
  const who = info.project.name;
  const note = `02 People/Stowaway ${who}.md`;
  // An agent pushes to main, against the rules; the sync then lists the note.
  const commit = pushToMain({ [note]: "# Stowaway\n\nNobody approved this.\n" }, "Agent push");
  pushToMain(
    {
      ".frontier/quarantine.json": JSON.stringify({
        version: 1,
        notes: [{ path: note, commit, pushedBy: "hermes-agent", at: "2026-11-21T10:00:00Z" }],
      }),
    },
    "Sync: quarantine",
  );

  // Opening the inbox fetches the vault, which brings the note and the list.
  await page.goto(proj("/inbox"));
  await expect(page.locator(".changes > li", { hasText: note })).toBeVisible();
  await page.goto(entry(note));
  await expect(page.locator(".quarantine-note")).toContainText("pushed by hermes-agent");
  await page.locator(".quarantine-note a").click();

  const row = page.locator(".changes > li", { hasText: note });
  await row.locator("summary").click();
  await expect(row.locator(".diff")).toContainText("Nobody approved this.");
  const before = commitCount();
  await row.getByRole("button", { name: "Revert" }).click();
  await expect(row).toContainText("Reverted, waiting for your next publish");
  // Deciding publishes nothing.
  expect(commitCount()).toBe(before);

  await review(page);
  await publish(page, `Revert the stowaway (${who})`);
  expect(commitCount()).toBe(before + 1);
  expect(onMain(note)).toBeNull();
  expect(onMain(".frontier/review-state.json")).toContain('"decision": "reverted"');
});
