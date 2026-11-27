import { expect, type Page, test } from "./test.ts";
import { api, discardDraft, edit, entry, proj, rightPanel, saved } from "./helpers.ts";

interface Fields {
  text: string;
  fields: { type: string | null; chattable: boolean; props: { key: string }[] };
}

/** What the server holds for an entry: its draft's text, and the fields worked out from it. */
async function onServer(page: Page, path: string): Promise<Fields> {
  const res = await page.request.get(api(`/entries?path=${encodeURIComponent(path)}`));
  return (await res.json()) as Fields;
}

test("a type gives its entries properties, and a rename reaches into them (stage 34)", async ({
  page,
}, info) => {
  // One server holds one types file for the phone and the desktop run: each has words of its own.
  const tag = info.project.name;
  const type = `vessel-${tag}`;
  const renamed = `craft-${tag}`;
  const name = `Wavecutter ${tag}`;
  const path = `03 Things/${name}.md`;

  await page.goto(proj("/settings/types"));
  const settings = page.locator(".types-page");
  // The lists start from the built-in ones: a person can be talked with, as before.
  await expect(settings.getByRole("button", { name: /^person/ })).toContainText(
    "Can be talked with",
  );
  await expect(settings.getByRole("list", { name: "Names for dates" })).toContainText("born");

  // A new type opens at once; a name that is two words, or taken, is refused in place.
  await settings.getByLabel("Add a type").fill("two words");
  await settings.getByRole("button", { name: "Add a type" }).click();
  await expect(settings.getByRole("alert")).toContainText("One word");
  await settings.getByLabel("Add a type").fill(type);
  await settings.getByLabel("Add a type").press("Enter");
  const detail = page.getByRole("group", { name: `The type ${type}` });
  await expect(detail).toContainText("No properties.");

  const addProp = async (key: string, kind: string) => {
    await detail.getByRole("textbox", { name: "Add a property" }).fill(key);
    await detail.getByLabel("Kind of the new property").selectOption({ label: kind });
    await detail.getByRole("button", { name: "Add a property" }).click();
    await expect(detail.locator(`.types-prop[data-key="${key}"]`)).toBeVisible();
  };
  await addProp("captain", "Link to an entry");
  await addProp("rig", "One of a few choices");
  await detail.getByLabel("Choices for rig").fill("sloop, brig");
  await detail.getByLabel("Choices for rig").press("Enter");
  await addProp("home port", "Text");
  await detail.getByLabel(`Value every ${type} gets for home port`).fill("Harbor");
  await detail.getByLabel(`Value every ${type} gets for home port`).press("Enter");
  await detail.getByRole("button", { name: "+ Can be talked with" }).click();
  await expect(detail.getByText("Frontier uses this")).toBeVisible();
  await detail.getByLabel("Add a usual date").selectOption("created");
  await expect(detail.locator(".types-chip", { hasText: "created" })).toBeVisible();
  await expect(settings.getByRole("status")).toContainText("Kept");

  // An entry of the type shows the type's properties as fields, empty until filled.
  await page.goto(`${edit(path)}?new=1`);
  await expect(page.locator(".cm-content")).toBeVisible();
  const panel = await rightPanel(page, "Properties");
  await expect(panel.getByRole("heading", { name: "More properties" })).toBeVisible();
  await panel.getByLabel("Type").selectOption(type);
  await expect(panel.getByRole("heading", { name: `As a ${type}` })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "This entry's own" })).toBeVisible();
  // The value the type gives shows until the entry sets its own.
  await expect(panel.getByLabel("Value of home port")).toHaveValue("Harbor");
  await expect(panel.locator('.given-prop[data-key="home port"]')).toContainText("from the type");
  await expect(panel.getByLabel("Value of Can be talked with")).toBeChecked();
  // The usual date is offered, ready to fill.
  await expect(panel.getByLabel("When created, in the lore's own words")).toBeVisible();

  // A link is found by typing part of the name.
  await panel.getByRole("combobox", { name: "Value of captain" }).click();
  await page.getByPlaceholder("Find an entry").fill("Mir");
  await page.getByRole("option", { name: "Mira", exact: true }).click();
  await expect(panel.getByRole("combobox", { name: "Value of captain" })).toHaveText("Mira");
  await panel.getByLabel("Value of rig").selectOption("brig");
  await panel.getByLabel("Value of Can be talked with").uncheck();
  await expect(panel.locator('.given-prop[data-key="chattable"]')).toContainText(
    "Back to the type's",
  );
  await panel.getByLabel("When created, in the lore's own words").fill("in the long summer");
  await panel.getByLabel("When created, in the lore's own words").press("Enter");

  // Only what the entry itself sets is written: not the type's value, and no empty field.
  await saved(page);
  await expect.poll(async () => (await onServer(page, path)).text).toContain('captain: "[[Mira]]"');
  let held = await onServer(page, path);
  expect(held.text).toContain("rig: brig");
  expect(held.text).toContain("chattable: false");
  expect(held.text).toContain("what: created");
  expect(held.text).not.toContain("home port");
  expect(held.fields.chattable).toBe(false);
  expect(held.fields.props.map((p) => p.key)).toEqual(["captain", "rig", "home port", "chattable"]);

  // Back to the type's value: the entry's own word is taken out again.
  await panel.getByRole("button", { name: "Back to the type's" }).click();
  await expect(panel.getByLabel("Value of Can be talked with")).toBeChecked();
  await saved(page);
  await expect.poll(async () => (await onServer(page, path)).fields.chattable).toBe(true);

  // Readers see the filled properties and the type's value, the link going to its entry.
  await page.goto(entry(path));
  const fields = page.locator(".custom-fields");
  await expect(fields.locator("dt")).toHaveText(["captain", "rig", "home port"]);
  await expect(fields.getByRole("link", { name: "Mira" })).toBeVisible();
  await expect(fields).toContainText("Harbor");

  // Renaming the type says what it reaches, then rewrites the entry that writes the word.
  await page.goto(proj("/settings/types"));
  await settings.getByRole("button", { name: new RegExp(`^${type}`) }).click();
  await detail.getByRole("button", { name: `Rename ${type}` }).click();
  await page.getByLabel(`New name for ${type}`).fill(renamed);
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.locator(".types-page .settings-note")).toContainText(
    `1 entry will say “${renamed}”`,
  );
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const after = page.getByRole("group", { name: `The type ${renamed}` });
  await expect(after).toBeVisible();
  await expect.poll(async () => (await onServer(page, path)).text).toContain(`type: ${renamed}`);
  held = await onServer(page, path);
  expect(held.fields.type).toBe(renamed);
  expect(held.fields.props.map((p) => p.key)).toContain("captain");

  // Deleting the type leaves the entry's word, which the page then lists as not on the list.
  await after.getByRole("button", { name: `Delete ${renamed}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(settings.getByRole("button", { name: new RegExp(`^${renamed}`) })).toHaveCount(0);

  await page.goto(edit(path));
  await discardDraft(page);
});

test("a date name is a start, an end or a moment, and can be added and removed (stage 34)", async ({
  page,
}, info) => {
  const word = `crowned-${info.project.name}`;
  await page.goto(proj("/settings/types"));
  const dates = page.getByRole("list", { name: "Names for dates" });
  await expect(
    dates.getByRole("radiogroup", { name: "born is" }).getByRole("radio", { name: "Start" }),
  ).toBeChecked();
  await expect(
    dates.getByRole("radiogroup", { name: "died is" }).getByRole("radio", { name: "End" }),
  ).toBeChecked();

  await dates.getByLabel("Add a name").fill(word);
  await dates.getByLabel("Add a name").press("Enter");
  const group = dates.getByRole("radiogroup", { name: `${word} is` });
  await expect(group.getByRole("radio", { name: "Moment" })).toBeChecked();
  await group.getByRole("radio", { name: "Start" }).click();
  await expect(group.getByRole("radio", { name: "Start" })).toBeChecked();
  // The arrow keys move the choice, as in any group of radio buttons.
  await group.getByRole("radio", { name: "Start" }).press("ArrowRight");
  await expect(group.getByRole("radio", { name: "End" })).toBeChecked();

  await expect
    .poll(async () => {
      const res = await page.request.get(api("/library-files/types"));
      const file = ((await res.json()) as { file: { what: { name: string; ends?: boolean }[] } })
        .file;
      return file.what.find((w) => w.name === word)?.ends ?? false;
    })
    .toBe(true);

  await dates.getByRole("button", { name: `Delete ${word}` }).click();
  await expect(dates.getByRole("radiogroup", { name: `${word} is` })).toHaveCount(0);
});
