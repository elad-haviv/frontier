import { expect, test } from "./test.ts";
import { api, openEditor, proj, setUpAi } from "./helpers.ts";

const BELL = "03 Things/Harbor Bell.md";
const STYLES = "/api/settings/art-styles";

test("CUJ 34: keeps a library of art styles and picks one for a picture", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "The art styles are the person's: one library here.");
  await setUpAi(page, { art: "sample/painter" });
  await page.goto(proj("/settings/you/ai-models"));

  // The library starts as the starter styles, the field notebook the usual one.
  const cards = page.getByRole("radiogroup", { name: /Your art styles/ });
  await expect(cards.getByRole("radio")).toHaveCount(6);
  await expect(cards.getByRole("radio", { name: /Field notebook/ })).toBeChecked();

  // A new style needs a name and words; its sample is drawn by the picture model.
  await page.getByRole("button", { name: "New style" }).click();
  const editor = page.getByRole("dialog", { name: "New style" });
  await editor.getByRole("button", { name: "Add style" }).click();
  await expect(editor.getByText("Give the style a name.")).toBeVisible();
  await editor.getByRole("textbox", { name: "Name" }).fill("Stone relief");
  await editor.getByLabel("How its pictures look").fill("Low relief carved in pale sandstone.");
  await editor.getByRole("button", { name: "Make a sample" }).click();
  await expect(editor.locator(".art-style-sample img")).toBeVisible();
  await editor.getByRole("button", { name: "Add style" }).click();
  await expect(cards.getByRole("radio")).toHaveCount(7);
  await expect(cards.getByRole("radio", { name: /Stone relief/ }).locator("img")).toBeVisible();

  // A click makes a style the usual one; the arrow keys move the choice.
  await cards.getByRole("radio", { name: /Stone relief/ }).click();
  await expect(cards.getByRole("radio", { name: /Stone relief/ })).toBeChecked();
  await page.keyboard.press("ArrowLeft");
  await expect(cards.getByRole("radio", { name: /Gouache poster/ })).toBeChecked();
  await expect(cards.getByRole("radio", { name: /Gouache poster/ })).toBeFocused();

  // A deleted style comes back where it was.
  await page.getByRole("button", { name: "Edit Woodcut print" }).click();
  await page
    .getByRole("dialog", { name: "Edit style" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(cards.getByRole("radio")).toHaveCount(6);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(cards.getByRole("radio")).toHaveCount(7);
  await expect(cards.getByRole("radio").nth(2)).toHaveAccessibleName(/Woodcut print/);

  // The picture dialog starts on the usual style and makes the picture in the one picked.
  const made = await page.request.put(api("/drafts"), {
    data: {
      id: "artstylebell",
      path: BELL,
      kind: "create",
      text: "# Harbor Bell\n\nRung at dusk.\n",
      revision: 0,
    },
  });
  expect(made.ok(), await made.text()).toBe(true);
  await openEditor(page, BELL);
  await page.keyboard.press("Control+Alt+i");
  const dialog = page.getByRole("dialog", { name: "Add an image" });
  const strip = dialog.getByRole("radiogroup", { name: "Style" });
  await expect(strip.getByRole("radio", { name: /Gouache poster · usual/ })).toBeChecked();
  await expect(dialog.getByText("Flat gouache shapes")).toBeVisible();
  await strip.getByRole("radio", { name: /Stone relief/ }).click();
  await dialog.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(dialog.getByText("Style: Stone relief")).toBeVisible();

  // Words changed for one picture are kept as a new style, without leaving the dialog.
  await dialog.getByRole("button", { name: "Change for this picture" }).click();
  await dialog.getByLabel(/For this picture only/).fill("Carved in dark basalt.");
  await dialog.getByRole("button", { name: "Save as a new style" }).click();
  const fresh = page.getByRole("dialog", { name: "New style" });
  await expect(fresh.getByLabel("How its pictures look")).toHaveValue("Carved in dark basalt.");
  await fresh.getByRole("textbox", { name: "Name" }).fill("Basalt relief");
  await fresh.getByRole("button", { name: "Add style" }).click();
  await expect(fresh).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(strip.getByRole("radio", { name: /Basalt relief/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Again" }).click();
  await expect(dialog.getByText("Style: Basalt relief")).toBeVisible();

  // The library is put back as the other tests expect it.
  await page.request.put("/api/settings/ai", { data: { usualArtStyle: "field-notebook" } });
  const { styles } = (await (await page.request.get(STYLES)).json()) as {
    styles: { id: string; name: string }[];
  };
  for (const s of styles) {
    if (/relief/.test(s.name)) await page.request.delete(`${STYLES}/${s.id}`);
  }
  await page.request.delete(api("/drafts/artstylebell")).catch(() => undefined);
});
