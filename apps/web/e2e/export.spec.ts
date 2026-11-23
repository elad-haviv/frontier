import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { openMenu, rightPanel } from "./helpers.ts";

test("exports a folder as web pages, and an entry as a Word document", async ({ page }) => {
  await page.goto("/export");
  await page.getByRole("combobox", { name: "Folder" }).selectOption("02 People");
  await expect(page.locator(".export-preview")).toContainText("will be exported");
  const [site] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Web pages" }).click(),
  ]);
  expect(site.suggestedFilename()).toBe("Avalymia.zip");
  const bytes = await (await site.createReadStream()).toArray();
  expect(Buffer.concat(bytes).subarray(0, 2).toString()).toBe("PK");

  const [md] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Markdown" }).click(),
  ]);
  expect(md.suggestedFilename()).toBe("Avalymia.zip");
  const [data] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "JSON" }).click(),
  ]);
  expect(data.suggestedFilename()).toBe("Avalymia.json");
  const parsed = JSON.parse(
    Buffer.concat(await (await data.createReadStream()).toArray()).toString(),
  );
  expect(parsed.entries.length).toBeGreaterThan(0);

  // From an entry's page, one entry, in its Export tab.
  await page.goto("/e/02%20People/Mira.md");
  await openMenu(page, "More actions");
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  const tab = await rightPanel(page, "Export");
  await expect(tab.getByRole("button")).toHaveText([
    "Web page",
    "Word",
    "PDF",
    "Markdown",
    "Slides",
  ]);
  const [word] = await Promise.all([
    page.waitForEvent("download"),
    tab.getByRole("button", { name: "Word" }).click(),
  ]);
  expect(word.suggestedFilename()).toBe("Mira.docx");
  // The Export page still exports one entry from its address.
  await page.goto("/export?path=" + encodeURIComponent("02 People/Mira.md"));
  await expect(page.locator(".export")).toContainText("One entry");
  await expect(page.getByLabel("Title")).toHaveValue("Mira");
});

test("saves a picture of a map at twice the size of the screen", async ({ page }, info) => {
  await page.goto("/maps");
  const id = await page.evaluate(async () => {
    const res = await fetch("/api/maps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Pictured",
        kind: "flat",
        image: "99 Appendices/Images/map one.png",
      }),
    });
    return ((await res.json()) as { id: string }).id;
  });
  await page.goto(`/map/${id}`);
  await expect(page.locator(".map-top")).toBeVisible();
  await expect(page).toHaveURL(/v=/);
  // The bar's buttons fit a phone without the page scrolling sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const frame = (await page.locator(".map-top").boundingBox())!;
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByLabel("Save a picture").selectOption("2"),
  ]);
  expect(download.suggestedFilename()).toBe("Pictured.png");
  const png = Buffer.concat(await (await download.createReadStream()).toArray());
  const meta = await sharp(png).metadata();
  const ratio = info.project.name === "phone" ? 3 : 1;
  expect(meta.width).toBe(Math.round(Math.round(frame.width * 2) * ratio));
  // The picture is the map, not an empty canvas: the sample image is a pale blue.
  const { data } = await sharp(png)
    .extract({
      left: Math.floor(meta.width! / 2),
      top: Math.floor(meta.height! / 2),
      width: 4,
      height: 4,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(data[2]! - data[0]!).toBeGreaterThan(30);

  await page.evaluate(async (id) => {
    await fetch(`/api/maps/${id}`, { method: "DELETE" });
    const un = await (await fetch("/api/unpublished")).json();
    for (const d of un.drafts) await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
  }, id);
});
