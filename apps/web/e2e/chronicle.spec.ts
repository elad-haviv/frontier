import { expect, type Page, test } from "@playwright/test";
import { answerDialog, noSidewaysScroll } from "./helpers.ts";

const sheet = (page: Page) => page.locator(".ch-sheet");
const tab = (page: Page, name: RegExp | string) =>
  page.locator(".ch-tabs").getByRole("tab", { name });

async function closeSheet(page: Page) {
  if (await sheet(page).isVisible())
    await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect(sheet(page)).toBeHidden();
}

async function add(page: Page, kind: "Span" | "Event", name: string) {
  await closeSheet(page);
  await page.getByRole("button", { name: `+ ${kind}` }).click();
  await answerDialog(page, "Add", name);
  await expect(sheet(page).locator("h2")).toHaveText(name);
}

/** Opens a span's form from the order view. */
async function open(page: Page, name: string) {
  await closeSheet(page);
  await tab(page, "Order").click();
  await page.locator(".ch-order [data-span]", { hasText: name }).first().click();
  await expect(sheet(page).locator("h2")).toHaveText(name);
}

async function relate(page: Page, kind: string, other: string) {
  const box = sheet(page).locator(".ch-add-relation");
  await box.getByLabel("How it relates").selectOption(kind);
  await box.getByLabel("The other span").selectOption({ label: other });
  await box.getByRole("button", { name: "Add" }).click();
}

async function length(page: Page, unit: string | RegExp, low: string, high: string) {
  await sheet(page)
    .locator("#ch-length-unit")
    .selectOption({ label: unit as string });
  await sheet(page).locator("#ch-length").fill(low);
  await sheet(page).locator(".ch-range").first().getByLabel("Highest").fill(high);
}

test("CUJ 14: finds what is too quick and what is too slow", async ({ page }, info) => {
  if (info.project.name === "phone") await page.setViewportSize({ width: 375, height: 740 });
  const title = `Ezob trial ${info.project.name}`;
  await page.goto("/chronicles");
  await page.locator(".new-map input[type=text]").fill(title);
  await page.getByRole("button", { name: "Make the chronicle" }).click();
  await expect(page.locator(".ch-bar h1")).toHaveText(title);

  // Lanes and the author's own unit.
  await tab(page, /Lanes and units|Set up/).click();
  await page.getByLabel("Lane name").fill("Humans");
  await page.getByLabel("New lane").fill("Nirani");
  await page.getByRole("button", { name: "Add the lane" }).click();
  await page.getByLabel("New unit").fill("generation");
  await page.getByLabel("Lowest years", { exact: true }).fill("20");
  await page.getByLabel("Highest years", { exact: true }).fill("35");
  await page.getByRole("button", { name: "Add the unit" }).click();
  await expect(page.getByLabel("Unit name")).toHaveValue("generation");

  await tab(page, "Order").click();
  await add(page, "Event", "First Landing");
  await add(page, "Span", "Earth memory fades");
  await relate(page, "starts_with", "First Landing");
  await length(page, "In generation (20 to 35 years)", "3", "5");
  await expect(sheet(page)).toContainText("= 60 to 175 years");
  await add(page, "Span", "Earth technology is lost");
  await relate(page, "during", "Earth memory fades");
  await add(page, "Span", "Nirani presence");
  await sheet(page).getByLabel("Lane").selectOption({ label: "Nirani" });
  await relate(page, "longer_than", "Earth memory fades");
  // The lowest number alone is a length: an empty highest means the same.
  await sheet(page).locator("#ch-length-unit").selectOption({ label: "In years" });
  await sheet(page).locator("#ch-length").fill("350");
  await expect(sheet(page)).toContainText("Lasts 350 years");
  await sheet(page).locator(".ch-range").first().getByLabel("Highest").fill("450");
  await expect(sheet(page)).toContainText("Lasts 350 to 450 years");
  await expect(sheet(page).locator(".ch-flag", { hasText: "is longer than" })).toContainText(
    "holds",
  );
  await closeSheet(page);

  // Order: the fading starts at the landing with the loss of technology inside it; the Nirani
  // span is not related to anything yet.
  const order = page.locator(".ch-order");
  await expect(order).toContainText("Order only, not to scale");
  const place = async (name: string) =>
    (await order.locator(".ch-span", { hasText: name }).boundingBox())!;
  const fading = await place("Earth memory fades");
  const tech = await place("Earth technology is lost");
  const along = info.project.name === "phone" ? ("y" as const) : ("x" as const);
  const size = along === "y" ? ("height" as const) : ("width" as const);
  expect(tech[along]).toBeGreaterThan(fading[along]);
  expect(tech[along] + tech[size]).toBeLessThan(fading[along] + fading[size]);
  await expect(page.locator(".ch-loose")).toContainText("Nirani presence");
  await noSidewaysScroll(page);

  // Compare: the fading beside two cases.
  await tab(page, "Compare").click();
  await page
    .locator(".ch-compare-add select")
    .first()
    .selectOption({ label: "Earth memory fades" });
  for (const [name, low, high] of [
    ["A first ruler", "80", "100"],
    ["A second ruler", "300", "500"],
  ] as const) {
    await page.getByRole("button", { name: "Add a case of your own" }).click();
    const form = page.locator(".ch-own-case");
    await form.getByLabel("Name").fill(name);
    await form.getByLabel("Lowest, years").fill(low);
    await form.getByLabel("Highest, years").fill(high);
    await form.getByLabel("Source").fill("A book, page 1");
    await form.getByRole("button", { name: "Add the case" }).click();
  }
  const bars = page.locator(".ch-bars li");
  await expect(bars).toHaveCount(3);
  await expect(bars.nth(0)).toContainText("60 to 175 years");
  await expect(bars.nth(2)).toContainText("300 to 500 years");
  await expect(bars.nth(2)).toContainText("A book, page 1");
  await noSidewaysScroll(page);

  // Nothing is contradicted. Then the fading is made much longer: one statement turns amber.
  await tab(page, "Does not fit").click();
  await expect(page.locator(".ch-flags")).toContainText("Nothing you have stated is contradicted");
  await expect(page.locator(".ch-flags")).not.toContainText("may not fit");
  await open(page, "Earth memory fades");
  await sheet(page).locator("#ch-length").fill("15");
  await sheet(page).locator(".ch-range").first().getByLabel("Highest").fill("30");
  await expect(sheet(page)).toContainText("= 300 to 1,050 years");
  await closeSheet(page);
  await tab(page, "Does not fit").click();
  await expect(page.locator(".ch-flags summary", { hasText: "1 may not fit" })).toBeVisible();
  await expect(page.locator(".ch-flag.is-amber")).toContainText(
    "Nirani presence is longer than Earth memory fades only if",
  );
  await expect(page.locator(".ch-flag.is-amber")).toHaveCount(1);
  await expect(page.locator(".ch-saving")).toHaveText("Saved as a draft");

  // Undo takes the change back.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".ch-flags")).not.toContainText("may not fit");

  // A statement about a span that is deleted is shown as broken.
  await open(page, "Earth memory fades");
  await noSidewaysScroll(page);
  await sheet(page).getByRole("button", { name: "Delete this span" }).click();
  await tab(page, /Does not fit/).click();
  await expect(page.locator(".ch-flags")).toContainText("This names a span that was removed.");

  // Marking it as the main chronicle shows at once and survives the next change.
  await page.locator(".ch-more summary").click();
  await page.getByRole("button", { name: "Make this the main chronicle" }).click();
  await expect(page.locator(".ch-bar .chip")).toHaveText("main");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  // It is among the unsaved changes, with a way back to it.
  await expect(page.locator(".ch-saving")).toHaveText("Saved as a draft");
  await page.goto("/unpublished");
  await page.getByRole("link", { name: "Open the chronicle" }).first().click();
  await expect(page.locator(".ch-bar h1")).toBeVisible();
  await page.evaluate(async () => {
    await fetch(`/api/chronicles/${location.pathname.split("/").pop()}`, { method: "DELETE" });
  });
});

test("CUJ 15: places spans, takes an offered fix, shifts them, and compares a copy with the original", async ({
  page,
}, info) => {
  const phone = info.project.name === "phone";
  if (phone) await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("/chronicles");
  await page.locator(".new-map input[type=text]").fill(`Scale trial ${info.project.name}`);
  await page.getByRole("button", { name: "Make the chronicle" }).click();

  // The first start given makes its span the one years are counted from.
  await add(page, "Event", "Landing");
  await sheet(page).locator("#ch-start-mode").selectOption("years");
  await expect(sheet(page)).toContainText("Years are counted from its start");

  // A statement about a placed span offers a place.
  await add(page, "Span", "Fading");
  await relate(page, "starts_with", "Landing");
  await sheet(page).getByRole("button", { name: "Place it there" }).click();
  await sheet(page).locator("#ch-length-unit").selectOption({ label: "In years" });
  await sheet(page).locator("#ch-length").fill("100");
  await sheet(page).locator(".ch-range").first().getByLabel("Highest").fill("150");
  await expect(sheet(page)).toContainText("Ends year 100 to 150");

  // A start that contradicts a statement is flagged, and the flag offers the fix.
  await add(page, "Span", "War");
  await relate(page, "after", "Fading");
  await sheet(page).locator("#ch-start-mode").selectOption("years");
  await sheet(page).locator("#ch-start").fill("50");
  await sheet(page).locator("#ch-length-unit").selectOption({ label: "In years" });
  await sheet(page).locator("#ch-length").fill("40");
  await closeSheet(page);
  await tab(page, /Does not fit \(1\)/).click();
  await expect(page.locator(".ch-flag.is-red")).toContainText(
    "War begins before Fading has ended; you said War is after Fading.",
  );
  await page.getByRole("button", { name: /^Move War/ }).click();
  await expect(page.locator(".ch-flags")).toContainText("Nothing you have stated is contradicted");

  // To scale: the war lies after the fading, on a ruler in years.
  await tab(page, "Scale").click();
  const scale = page.locator(".ch-scale");
  await expect(scale.locator(".ch-mark").first()).toBeVisible();
  const box = async (name: string) =>
    (await scale.locator(".ch-span", { hasText: name }).boundingBox())!;
  const along = phone ? ("y" as const) : ("x" as const);
  const size = phone ? ("height" as const) : ("width" as const);
  const fading = await box("Fading");
  const war = await box("War");
  expect(war[along]).toBeGreaterThan(fading[along] + fading[size] / 2);
  // The fading may cover 150 years; the war may start anywhere in 50 and lasts 40, so 90.
  expect(fading[size] / war[size]).toBeCloseTo(150 / 90, 1);
  await noSidewaysScroll(page);
  await scale.getByRole("button", { name: "Zoom in" }).click();
  expect((await box("Fading"))[size]).toBeGreaterThan(fading[size] * 1.3);
  await scale.getByRole("button", { name: "Fit", exact: true }).click();

  // Shifting moves what is chosen and nothing else.
  await page.locator(".ch-shift summary").click();
  await page.getByLabel("Which spans").selectOption("chosen");
  await page.locator(".ch-shift-list").getByLabel("War").check();
  await page.getByLabel("Years to shift by").fill("500");
  await page.getByLabel("Earlier or later").selectOption("earlier");
  await page.getByRole("button", { name: "Shift", exact: true }).click();
  await expect(page.locator(".ch-shift")).toContainText("Moved 1 span 500 years earlier");
  await expect(tab(page, /Does not fit \(1\)/)).toBeVisible();
  await scale.locator(".ch-span", { hasText: "War" }).click();
  await expect(sheet(page)).toContainText("Starts year -400 to -350");
  await closeSheet(page);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(tab(page, "Does not fit")).toBeVisible();
  await expect(page.locator(".ch-saving")).toHaveText("Saved as a draft");

  // Another version: a copy with the war 500 years earlier, beside the original.
  const original = page.url();
  await page.locator(".ch-more summary").click();
  await page.getByRole("button", { name: "Copy, to try another version" }).click();
  await expect(page.locator(".ch-bar h1")).toHaveText(`Copy of Scale trial ${info.project.name}`);
  await tab(page, "Scale").click();
  await page.locator(".ch-shift summary").click();
  await page.getByLabel("Which spans").selectOption("chosen");
  await page.locator(".ch-shift-list").getByLabel("War").check();
  await page.getByLabel("Years to shift by").fill("500");
  await page.getByLabel("Earlier or later").selectOption("earlier");
  await page.getByRole("button", { name: "Shift", exact: true }).click();
  await page
    .getByLabel("Compare with…")
    .selectOption({ label: `Scale trial ${info.project.name}` });
  const versions = page.locator(".ch-version");
  await expect(versions).toHaveCount(2);
  await expect(versions.nth(1)).toHaveText(`Scale trial ${info.project.name}`);
  // The shifted span is marked as different in both; the others are not.
  await expect(page.locator(".ch-span.is-differs", { hasText: "War" })).toHaveCount(2);
  await expect(page.locator(".ch-span.is-differs")).toHaveCount(2);
  await expect(page.getByLabel("Aligned on the start of")).toHaveValue(/.+/);
  // Each lists its own flags: the copy's war now begins before the fading has ended.
  await expect(tab(page, /Does not fit \(1\)/)).toBeVisible();
  await expect(page.locator(".ch-versus-flags")).toContainText("Nothing.");
  await noSidewaysScroll(page);
  await expect(page.locator(".ch-saving")).toHaveText("Saved as a draft");
  await page.evaluate(async () => {
    await fetch(`/api/chronicles/${location.pathname.split("/").pop()}`, { method: "DELETE" });
  });
  await page.goto(original);
  await expect(page.locator(".ch-bar h1")).toHaveText(`Scale trial ${info.project.name}`);
  await page.evaluate(async () => {
    await fetch(`/api/chronicles/${location.pathname.split("/").pop()}`, { method: "DELETE" });
  });
});

test("a span linked to an entry opens the entry, and the entry lists the chronicle", async ({
  page,
}, info) => {
  if (info.project.name === "phone") await page.setViewportSize({ width: 375, height: 740 });
  const title = `Linked ${info.project.name}`;
  await page.goto("/chronicles");
  await page.locator(".new-map input[type=text]").fill(title);
  await page.getByRole("button", { name: "Make the chronicle" }).click();
  await add(page, "Span", "Mira's years");

  const entry = sheet(page).locator(".ch-entry");
  await entry.getByLabel("Find an entry").fill("Mira");
  await entry.locator(".entry-picker li button", { hasText: "Mira" }).first().click();
  await expect(entry.getByRole("link", { name: "Mira" })).toBeVisible();
  await expect(page.locator(".ch-saving")).toHaveText("Saved as a draft");
  await expect(entry).not.toContainText("linking");

  // From the entry back to its span.
  await entry.getByRole("link", { name: "Mira" }).click();
  await expect(page).toHaveURL(/\/e\//);
  await page.locator(".on-maps").getByRole("link", { name: title }).click();
  await expect(sheet(page).locator("h2")).toHaveText("Mira's years");

  // Unlinking takes the chronicle off the entry.
  await sheet(page).locator(".ch-entry").getByRole("button", { name: "Unlink" }).click();
  await expect(sheet(page).locator(".ch-entry")).toContainText("Link this to the entry");
  await expect(page.locator(".ch-saving")).toHaveText("Saved as a draft");

  // Nothing is left behind: the chronicle goes, and so does the id written into the entry.
  await page.evaluate(async () => {
    await fetch(`/api/chronicles/${location.pathname.split("/").pop()}`, { method: "DELETE" });
    const un = await (await fetch("/api/unpublished")).json();
    for (const d of un.drafts) await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
  });
});
