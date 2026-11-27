import { expect, test } from "./test.ts";
import { api, openEditor, saved, setUpAi } from "./helpers.ts";

// An entry of the test's own: other tests rename and publish the sample ones before this runs.
const LAMP = "03 Things/Harbor Lamp.md";

test("CUJ 29: generates pictures for an entry and inserts the one chosen", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "The AI settings are one per server.");
  await setUpAi(page, { art: "sample/painter" });
  const made = await page.request.put(api("/drafts"), {
    data: {
      id: "picturelamp1",
      path: LAMP,
      kind: "create",
      text: "# Harbor Lamp\n\nCarried by [[Twin]] at the [[Harbor]].\n",
      revision: 0,
    },
  });
  expect(made.ok(), await made.text()).toBe(true);
  await openEditor(page, LAMP);

  // The last line, selected, is what the picture starts from.
  await page.locator(".cm-line", { hasText: "Carried by" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Control+Alt+i");
  const dialog = page.getByRole("dialog", { name: "Add an image" });
  await expect(dialog.getByRole("tab", { name: "Generate" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const prompt = dialog.getByLabel("Describe the picture");
  await expect(prompt).toHaveValue("Carried by Twin at the Harbor.");
  await dialog.getByRole("button", { name: "Use the opening instead" }).click();
  await expect(prompt).toHaveValue("Harbor Lamp. Carried by Twin at the Harbor.");
  // A look at the library keeps what was written.
  await dialog.getByRole("tab", { name: "Library" }).click();
  await expect(prompt).toBeHidden();
  await dialog.getByRole("tab", { name: "Generate" }).click();
  await expect(prompt).toHaveValue("Harbor Lamp. Carried by Twin at the Harbor.");
  await expect(dialog.getByText("Your picture appears here.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Insert" })).toBeDisabled();

  // One picture per press; the second press is Again.
  await dialog.getByRole("button", { name: "Wide" }).click();
  await dialog.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(dialog.locator(".generate-stage img")).toBeVisible();
  await expect(dialog.getByText("Tries for this entry (1)")).toBeVisible();
  await expect(dialog.getByLabel("Save as")).toHaveValue("Harbor Lamp");
  await prompt.press("Control+Enter");
  await expect(dialog.getByRole("option")).toHaveCount(2);
  await expect(dialog.getByRole("option", { name: "Try 2" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Insert keeps the chosen one as an unpublished image, named as the field says.
  await dialog.getByLabel("Save as").fill("Lamp at dusk");
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(dialog).toHaveCount(0);
  // It goes under the text it was made from, which stays.
  await expect(page.locator(".cm-content")).toContainText("Carried by");
  await expect(page.locator(".cm-content")).toContainText("![[Lamp at dusk.png]]");
  await saved(page);

  // The try not inserted is still there, from the right-click menu, with its cost known.
  await page.locator(".cm-line", { hasText: "Carried by" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Generate an image/ }).click();
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await expect(dialog.getByText(/About 4¢ a picture/)).toBeVisible();
  // The Library tab is the dialog as before.
  await dialog.getByRole("tab", { name: "Library" }).click();
  await expect(dialog.getByRole("button", { name: /Upload/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Leave the vault as it was for the tests after this one: the entry and the picture go.
  await page.evaluate(async () => {
    const { drafts } = (await (await fetch(`${API}/unpublished`)).json()) as {
      drafts: { id: string; path: string }[];
    };
    for (const d of drafts.filter(
      (x) => x.path.endsWith("Lamp at dusk.png") || x.path.endsWith("Harbor Lamp.md"),
    )) {
      await fetch(`${API}/drafts/${d.id}`, { method: "DELETE" });
    }
  });
});
