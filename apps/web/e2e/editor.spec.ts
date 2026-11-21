import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import {
  discardDraft,
  edit,
  entry,
  onMain,
  openEditor,
  publish,
  REMOTE,
  review,
  saved,
} from "./helpers.ts";

test("adds an image from the toolbar, shows it before publishing, then publishes it", async ({
  page,
}) => {
  const png = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 120, b: 40 } },
  })
    .png()
    .toBuffer();
  await openEditor(page, "03 Things/Ledger.md");
  await page.keyboard.type("\n");
  await page
    .locator(".edit-toolbar-file input")
    .setInputFiles({ name: "Ledger cover.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".cm-content")).toContainText("![[Ledger cover.png]]");
  await saved(page);

  await page.locator("button.primary").click();
  const shown = page.locator('.prose img[alt*="Ledger cover"]');
  await expect(shown).toBeVisible();
  expect(await shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await page.goto("/unpublished");
  await expect(page.locator(".change-image")).toBeVisible();
  await review(page);
  await publish(page, "Add the ledger cover");
  expect(onMain("03 Things/Ledger.md")).toContain("![[Ledger cover.png]]");
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", "main"], {
    cwd: REMOTE,
    encoding: "utf8",
  });
  expect(files).toContain("Ledger cover.png");
});

test("live preview hides marks away from the cursor and leaves the text as written", async ({
  page,
}) => {
  await openEditor(page, "02 People/Mira.md");
  await page.keyboard.type("\nShe keeps the **old** [[Harbor|quay]] lamp.\n\nLast line.");
  const line = page.locator(".cm-line", { hasText: "She keeps the" });
  await expect(line).toHaveText("She keeps the old quay lamp.");
  await expect(line.locator(".cm-lp-link")).toHaveText("quay");

  // On the line itself the marks come back.
  await line.click();
  await expect(line).toContainText("**old** [[Harbor|quay]]");

  // Switched off, every line shows its source.
  await page.keyboard.press("Control+End");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(line).toContainText("**old** [[Harbor|quay]]");
  await saved(page);
  await page.goto(entry("02 People/Mira.md"));
  await expect(page.locator(".prose")).toContainText("She keeps the old quay lamp.");
  await page.goto(edit("02 People/Mira.md"));
  await discardDraft(page);
});

test("the properties panel writes other names into the frontmatter only", async ({ page }) => {
  await openEditor(page, "03 Things/Ledger.md");
  const before = await page.locator(".cm-content").innerText();
  await page.locator(".props summary").click();
  const field = page.locator(".props-field", { hasText: "Other names" }).locator("input");
  await field.fill("The Grey Book, Tally");
  await field.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("aliases:");
  await expect(page.locator(".cm-content")).toContainText("- The Grey Book");
  await expect(page.locator(".cm-content")).toContainText("- Tally");
  await saved(page);
  // Clearing the field removes the key again and nothing else.
  await field.fill("");
  await field.press("Enter");
  await expect(page.locator(".cm-content")).not.toContainText("The Grey Book");
  expect(
    (await page.locator(".cm-content").innerText()).trim().endsWith(before.trim().slice(-40)),
  ).toBe(true);
  await saved(page);
  await discardDraft(page);
});

test("Tab moves between the cells of a table", async ({ page }) => {
  await openEditor(page, "02 People/Mira.md");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.keyboard.type("\n| a | b |\n| - | - |\n|  |  |");
  // To the start of the last row, then cell by cell.
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  await page.keyboard.type("one");
  await page.keyboard.press("Tab");
  await page.keyboard.type("two");
  await expect(page.locator(".cm-content")).toContainText("| one | two |");
  await saved(page);
  await discardDraft(page);
});

test("dates and a type set in the properties panel show under the entry's title", async ({
  page,
}) => {
  await openEditor(page, "01 Places/Unwritten.md");
  await page.locator(".props summary").click();
  await page.locator(".props-field", { hasText: "Type" }).locator("select").selectOption("place");
  await page.getByRole("button", { name: "+ Add a date" }).click();
  const row = page.locator(".props-time-row").first();
  await row.locator("select").selectOption("founded");
  await row.locator("input").fill("a generation after [[Mira]] came");
  await row.locator("input").press("Enter");
  await expect(page.locator(".cm-content")).toContainText("type: place");
  await expect(page.locator(".cm-content")).toContainText(
    'when: "a generation after [[Mira]] came"',
  );
  await saved(page);

  await page.goto(entry("01 Places/Unwritten.md"));
  const fields = page.locator(".fields");
  await expect(fields).toContainText("place");
  await expect(fields).toContainText("founded");
  await expect(fields.locator("a.link-resolved")).toHaveText("Mira");
  await fields.locator("a.link-resolved").click();
  await expect(page.locator("h1")).toHaveText("Mira");

  await page.goto(edit("01 Places/Unwritten.md"));
  await discardDraft(page);
});

test("dragging an image's edge in live preview writes its width into the embed", async ({
  page,
}) => {
  await openEditor(page, "02 People/Mira.md");
  await page.keyboard.type("\nThe chart: ![[Sample world.png]] as drawn.\n\nAfter the map.");
  const img = page.locator(".cm-lp-image img");
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth))
    .toBeGreaterThan(0);
  const source = page.locator(".cm-line", { hasText: "The chart:" });
  const showSource = async () => {
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.locator(".cm-lp-image")).toHaveCount(0);
  };
  const showPreview = async () => {
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(img).toBeVisible();
  };

  /** Drags the image's right edge sideways by `dx` with the mouse. */
  const drag = async (dx: number) => {
    const box = (await page.locator(".cm-lp-image-handle").boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y, { steps: 4 });
    await page.mouse.move(x + dx, y, { steps: 4 });
    await page.mouse.up();
  };

  const start = (await img.boundingBox())!.width;
  await drag(-100);
  await showSource();
  const written = /!\[\[Sample world\.png\|(\d+)\]\]/.exec(await source.innerText());
  expect(written).not.toBeNull();
  expect(Math.abs(Number(written![1]) - (start - 100))).toBeLessThanOrEqual(1);
  // Only the embed changed.
  await expect(source).toHaveText(`The chart: ![[Sample world.png|${written![1]}]] as drawn.`);
  await expect(page.locator(".cm-line", { hasText: "After the map." })).toHaveText(
    "After the map.",
  );

  // Never narrower than 50 pixels; the reset button takes the width away.
  await showPreview();
  await drag(-2000);
  await showSource();
  await expect(source).toHaveText("The chart: ![[Sample world.png|50]] as drawn.");
  await showPreview();
  await page.getByRole("button", { name: "Use the image's own width" }).click();
  await showSource();
  await expect(source).toHaveText("The chart: ![[Sample world.png]] as drawn.");

  // A double tap on the edge does the same.
  await showPreview();
  await drag(-80);
  await expect(page.getByRole("button", { name: "Use the image's own width" })).toBeVisible();
  const box = (await page.locator(".cm-lp-image-handle").boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await showSource();
  await expect(source).toHaveText("The chart: ![[Sample world.png]] as drawn.");

  // A finger works too.
  await showPreview();
  const before = (await img.boundingBox())!.width;
  const edge = (await page.locator(".cm-lp-image-handle").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y: edge.y + edge.height / 2 }],
    });
  const x0 = edge.x + edge.width / 2;
  await touch("touchStart", x0);
  for (const step of [10, 30, 60]) await touch("touchMove", x0 - step);
  await touch("touchEnd", x0 - 60);
  await showSource();
  const touched = /\|(\d+)\]\]/.exec(await source.innerText());
  expect(Math.abs(Number(touched?.[1]) - (before - 60))).toBeLessThanOrEqual(1);

  // A tap on the image puts the cursor on its line, where the embed shows as written.
  await showPreview();
  await img.click();
  await expect(page.locator(".cm-lp-image")).toHaveCount(0);
  await expect(source).toContainText("![[Sample world.png|");

  await saved(page);
  await discardDraft(page);
});

test("adds and deletes table rows and columns from the toolbar and the keyboard", async ({
  page,
}) => {
  await openEditor(page, "02 People/Mira.md");
  await page.getByRole("button", { name: "Preview" }).click();
  const addRow = page.getByRole("button", { name: "Add a row below" });
  await expect(addRow).toHaveCount(0);
  const table = "| Name | Age |\n| :--- | --: |\n| Ada | 3 |";
  await page.keyboard.type(`\n${table}`);
  await expect(addRow).toBeVisible();
  const text = () => page.locator(".cm-content").innerText();

  // A new row from the keyboard, with the cursor in its first cell.
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.type("Bo");
  await expect.poll(text).toContain(`${table}\n| Bo |  |`);

  // A column to the right of the cursor's, in every row, the separator included.
  await page.getByRole("button", { name: "Add a column to the right" }).click();
  await page.keyboard.type("x");
  await expect
    .poll(text)
    .toContain("| Name |  | Age |\n| :--- | --- | --: |\n| Ada |  | 3 |\n| Bo | x |  |");

  // Deleting it brings back the table as it was, alignment and all.
  await page.getByRole("button", { name: "Delete this column" }).click();
  await expect.poll(text).toContain(`${table}\n| Bo |  |`);
  await page.getByRole("button", { name: "Delete this row" }).click();
  await expect.poll(text).toContain(table);
  expect(await text()).not.toContain("| Bo |");

  // The header is never deleted as a row.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.getByRole("button", { name: "Delete this row" }).click();
  await expect.poll(text).toContain(table);

  // Away from the table the buttons go.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(addRow).toHaveCount(0);

  await saved(page);
  await discardDraft(page);
});
