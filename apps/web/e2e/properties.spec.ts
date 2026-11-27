import { expect, type Page, test } from "./test.ts";
import { api, discardDraft, edit, entry, rightPanel, saved } from "./helpers.ts";

/** The text the server holds for an entry: its draft once one is saved. */
async function serverText(page: Page, path: string): Promise<string> {
  const res = await page.request.get(api(`/entries?path=${encodeURIComponent(path)}`));
  return ((await res.json()) as { text: string }).text;
}

test("adds, changes, renames and removes properties of the author's own", async ({
  page,
}, info) => {
  // A new entry for each kind of device, so the two runs do not meet.
  const name = `Wellhouse ${info.project.name}`;
  const path = `03 Things/${name}.md`;
  await page.goto(`${edit(path)}?new=1`);
  await expect(page.locator(".cm-content")).toBeVisible();
  const panel = await rightPanel(page, "Properties");
  // The fields with places of their own come first; the author's own are a group below.
  await expect(panel.getByRole("heading", { name: "More properties" })).toBeVisible();
  await expect(panel.getByText("None yet.")).toBeVisible();

  const add = async (prop: string, kind: string) => {
    await panel.getByRole("button", { name: "Add a property" }).click();
    await panel.getByLabel("Name", { exact: true }).fill(prop);
    await panel.getByLabel("Kind").selectOption({ label: kind });
    await panel.getByRole("button", { name: "Add", exact: true }).click();
    await expect(panel.getByLabel(`Name of ${prop}`)).toHaveValue(prop);
  };

  await add("Population", "Number");
  // The new property's value is the next thing to fill in.
  await expect(panel.getByLabel("Value of Population")).toBeFocused();
  await page.keyboard.type("1200");
  await page.keyboard.press("Enter");
  await add("Walled", "Checkbox");
  await panel.getByLabel("Value of Walled").check();
  await add("Founded", "Date");
  await panel.getByLabel("Value of Founded").fill("2026-03-01");
  await add("Rulers", "List of text");
  await panel.getByLabel("Value of Rulers").fill("Mira, Oren");
  await panel.getByLabel("Value of Rulers").press("Enter");
  await add("Capital", "Link to an entry");
  await panel.getByRole("combobox", { name: "Value of Capital" }).click();
  await page.getByPlaceholder("Find an entry").fill("Mir");
  await page.getByRole("option", { name: "Mira", exact: true }).click();
  await expect(panel.getByRole("combobox", { name: "Value of Capital" })).toHaveText("Mira");

  // A name the entry has already, or one with a field of its own, is refused in place.
  await add("Motto", "Text");
  await panel.getByRole("button", { name: "Add a property" }).click();
  await panel.getByLabel("Name", { exact: true }).fill("tags");
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("has a field of its own");
  await panel.getByLabel("Name", { exact: true }).fill("motto");
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("already a property called");
  await panel.getByRole("button", { name: "Cancel" }).click();

  // Renamed in place, and removed.
  await panel.getByLabel("Name of Population").fill("People");
  await panel.getByLabel("Name of Population").press("Enter");
  await expect(panel.getByLabel("Name of People")).toHaveValue("People");
  await panel.getByRole("button", { name: "Remove Motto" }).click();
  await expect(panel.getByLabel("Name of Motto")).toHaveCount(0);

  // Each change went into the entry's frontmatter and was saved as typing is.
  await saved(page);
  await expect
    .poll(() => serverText(page, path))
    .toContain(
      [
        "People: 1200",
        "Walled: true",
        "Founded: 2026-03-01",
        "Rulers:",
        "  - Mira",
        "  - Oren",
        'Capital: "[[Mira]]"',
        "---",
        `# ${name}`,
      ].join("\n"),
    );
  expect(await serverText(page, path)).not.toContain("Motto");

  // The entry's page shows them under its title, the link going to its entry.
  await page.goto(entry(path));
  const fields = page.locator(".custom-fields");
  await expect(fields.locator("dt")).toHaveText([
    "People",
    "Walled",
    "Founded",
    "Rulers",
    "Capital",
  ]);
  await expect(fields.locator("dd")).toHaveText([
    "1200",
    "Yes",
    "2026-03-01",
    "Mira, Oren",
    "Mira",
  ]);
  await fields.getByRole("link", { name: "Mira" }).click();
  await expect(page.locator(".entry h1").first()).toHaveText("Mira");

  // Back in the editor they read back with their kinds; then the new entry goes.
  await page.goto(edit(path));
  // The panel is declared once the text is in; on a desktop it opens again by itself.
  await expect(page.locator(".cm-content")).toBeVisible();
  const again = await rightPanel(page, "Properties");
  await expect(again.getByLabel("Value of Walled")).toBeChecked();
  await expect(again.getByLabel("Value of Founded")).toHaveValue("2026-03-01");
  await expect(again.getByLabel("Value of People")).toHaveValue("1200");
  await discardDraft(page);
});
