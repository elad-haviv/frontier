import { expect, test } from "./test.ts";
import {
  commitCount,
  hasBranch,
  lastBody,
  onMain,
  publish,
  pushProposal,
  review,
  proj,
} from "./helpers.ts";

test("CUJ 6: reviews an agent's proposal file by file and publishes what was accepted", async ({
  page,
}, info) => {
  const who = info.project.name;
  const branch = `proposal/architect/${who}`;
  const kept = `02 People/Netmender ${who}.md`;
  const refused = `02 People/Impostor ${who}.md`;
  pushProposal(
    branch,
    { [kept]: "# Netmender\n\nMends nets by the [[Old Quay]].\n", [refused]: "# Impostor\n" },
    `Propose two people (${who})`,
  );
  const before = commitCount();

  await page.goto(proj("/"));
  // The bar shows that something waits; the fetch that finds the branch runs when the inbox opens.
  await page.goto(proj("/inbox"));
  await page.reload();
  const section = page.locator(".proposal", { hasText: `architect/${who}` });
  await expect(section).toBeVisible();
  await expect(section.locator(".proposal-commits")).toContainText(`Propose two people (${who})`);

  const keptRow = section.locator(".changes > li", { hasText: kept });
  await keptRow.locator("summary").click();
  await expect(keptRow.locator(".diff")).toContainText("Mends nets by the [[Old Quay]].");
  await keptRow.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(keptRow).toContainText("Accepted");
  // Accepting publishes nothing.
  expect(commitCount()).toBe(before);
  expect(hasBranch(branch)).toBe(true);

  await section
    .locator(".changes > li", { hasText: refused })
    .getByRole("button", { name: "Reject" })
    .click();
  await expect(page.locator(".banner-ok")).toContainText("The branch was removed");
  expect(hasBranch(branch)).toBe(false);

  await review(page);
  await publish(page, `Take the netmender (${who})`);
  expect(commitCount()).toBe(before + 1);
  expect(onMain(kept)).toContain("Mends nets");
  expect(onMain(refused)).toBeNull();
  expect(lastBody()).toContain(`Frontier-Proposal: ${branch}`);
});
