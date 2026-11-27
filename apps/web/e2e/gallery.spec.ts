import { expect, test } from "@playwright/test";
import sharp from "sharp";
import {
  discardDraft,
  noSidewaysScroll,
  openEditor,
  openImageDialog,
  saved,
  at,
} from "./helpers.ts";

/** The test server's stand-in for a site on the web, at its port plus 100 (e2e/server.mjs). */
const PICTURES = Number(process.env.E2E_PORT ?? 3987) + 100;

test("the gallery shows images by folder, finds one by its entry and opens it large", async ({
  page,
}) => {
  await page.goto(at("/gallery"));
  const tiles = page.locator(".gallery-tile");
  await expect(tiles.first()).toBeVisible();
  const used = await tiles.count();

  // Every image shown first is used by an entry, and says which.
  await expect(page.locator(".gallery-used a").first()).toBeVisible();
  expect(await page.locator(".gallery-used").count()).toBe(used);

  await page.getByRole("tab", { name: /^All/ }).click();
  expect(await tiles.count()).toBeGreaterThanOrEqual(used);
  await noSidewaysScroll(page);

  await page.getByRole("tab", { name: /^In entries/ }).click();
  const entry = (await page.locator(".gallery-used a").first().textContent())!;
  await page.getByLabel("Find an image by its name or its entry").fill(entry);
  await expect(tiles.first()).toContainText(entry);

  // Folders down the side narrow the grid.
  await page.getByRole("button", { name: /^All folders/ }).click();
  await tiles.first().getByRole("button").click();
  await expect(page.locator(".lightbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".lightbox")).toHaveCount(0);

  await page.locator(".gallery-used a").first().click();
  await expect(page).toHaveURL(/\/e\//);
});

test("CUJ 4: adds an image three ways: from the library, by upload, by paste and from a web address", async ({
  page,
}, info) => {
  const tag = info.project.name;
  const png = await sharp({
    create: { width: 30, height: 20, channels: 3, background: { r: 40, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();
  await openEditor(page, "03 Things/Scalar.md");
  const text = () => page.locator(".cm-content").innerText();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.keyboard.type("\n");

  // From the library: found by name, chosen, inserted at the cursor.
  let dialog = await openImageDialog(page);
  await dialog.getByLabel("Find an image by its name or its entry").fill("sample");
  await dialog.getByRole("button", { name: "Choose Sample world.png" }).click();
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(text).toContain("![[Sample world.png]]");

  // Two files uploaded: one embed per line, each a new unpublished image.
  await page.keyboard.type("\n");
  dialog = await openImageDialog(page);
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Upload…" }).click();
  await (
    await chooser
  ).setFiles([
    { name: `Tide one ${tag}.png`, mimeType: "image/png", buffer: png },
    { name: `Tide two ${tag}.png`, mimeType: "image/png", buffer: png },
  ]);
  await expect(dialog).toHaveCount(0);
  await expect.poll(text).toContain(`![[Tide one ${tag}.png]]\n![[Tide two ${tag}.png]]`);

  // Pasted while the dialog is open.
  await page.keyboard.type("\n");
  dialog = await openImageDialog(page);
  await page.evaluate(
    async ({ bytes, name }) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], name, { type: "image/png" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    },
    { bytes: [...png], name: `Pasted ${tag}.png` },
  );
  await expect(dialog).toHaveCount(0);
  await expect.poll(text).toContain(`![[Pasted ${tag}.png]]`);

  // A web address that fails says so plainly and inserts nothing; one that works is inserted.
  await page.keyboard.type("\n");
  dialog = await openImageDialog(page);
  const address = dialog.getByLabel("From a web address");
  await address.fill("http://10.0.0.1/secret.png");
  await address.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText(
    "Frontier could not get an image from that address.",
  );
  await address.fill(`http://127.0.0.2:${PICTURES}/web/Harbor%20Light%20${tag}.png?size=large`);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(text).toContain(`![[Harbor Light ${tag}.png]]`);
  expect(await text()).not.toContain("secret");

  // The new images are unpublished, and marked so in the dialog.
  await page.keyboard.type("\n");
  dialog = await openImageDialog(page);
  await dialog.getByLabel("Find an image by its name or its entry").fill(`Tide one ${tag}`);
  await expect(dialog.locator(".gallery-tile")).toHaveCount(1);
  await expect(dialog.locator(".gallery-tile")).toContainText("Unpublished");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await saved(page);
  await page.getByRole("button", { name: "Live preview" }).click();
  await discardDraft(page);
  // The images go too, so later tests start from the library as it was.
  const { drafts } = (await (await page.request.get("/api/unpublished")).json()) as {
    drafts: { id: string; path: string }[];
  };
  for (const d of drafts.filter((d) => d.path.includes(tag) && /\.png$/.test(d.path))) {
    expect((await page.request.delete(`/api/drafts/${d.id}`)).ok()).toBe(true);
  }
});
