import { expect, type Page, test } from "@playwright/test";
import yazl from "yazl";
import { proj, openLibrary, openSideBar, PROJECT } from "./helpers.ts";

/**
 * Stage 27b: projects. The e2e server's first project is "Sample" (its address is `sample`). The
 * tests make others, and each one is taken away again (and the first made the one used last) so
 * the specs after this one find the library as they left it.
 */

const HARBOR = "01 Places/Harbor/Harbor.md";

/** Makes a project through the server, for a test that needs one to exist already. */
async function made(page: Page, name: string, slug: string, start = "empty"): Promise<void> {
  const res = await page.request.post("/api/projects", { data: { name, slug, start } });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Every project but the first goes, and the first is the one used last. */
async function tidy(page: Page): Promise<void> {
  const res = await page.request.get("/api/projects");
  const list = (await res.json()) as { projects: { slug: string; name: string }[] };
  for (const p of list.projects) {
    if (p.slug === PROJECT) continue;
    await page.request.delete(`/api/p/${p.slug}/project`, { data: { name: p.name } });
  }
  await page.request.put("/api/projects/last", { data: { slug: PROJECT } });
  await page.request.delete(`/api/p/${PROJECT}/pins?path=${encodeURIComponent(HARBOR)}`);
}

test.afterEach(async ({ page, context }) => {
  await context.setOffline(false);
  await tidy(page);
});

/** Opens the side bar (the phone's drawer) unless it is open already. */
async function sideBar(page: Page): Promise<void> {
  if (await page.getByRole("dialog", { name: "Side bar" }).isVisible()) return;
  await openSideBar(page);
}

/** Opens the switcher at the head of the side bar and waits for its list. */
async function openSwitcher(page: Page, name = "Sample") {
  await sideBar(page);
  await page.getByRole("button", { name: `${name}, switch project` }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** The side bar's folders, wherever they are (the phone's drawer opens its Library panel). */
async function folders(page: Page) {
  await openLibrary(page);
  return page.getByRole("region", { name: "Library" });
}

test("the switcher lists your projects with your role and the entries, then All projects and New project", async ({
  page,
}) => {
  await page.goto(proj("/"));
  await expect(page.locator(".home h1")).toBeVisible();
  await sideBar(page);
  // At the head of the left bar, the project's name replaces the wordmark; the foot says who you are here.
  await expect(page.locator(".left-head").getByText("FRONTIER")).toHaveCount(0);
  const foot = page.locator(".left-person");
  await expect(foot).toContainText("Owner here");
  await expect(page.getByRole("button", { name: `Search ${"Sample"}` }).first()).toBeVisible();

  const menu = await openSwitcher(page);
  const row = menu.getByRole("menuitem", { name: /^Sample/ });
  await expect(row).toContainText("Owner");
  await expect(row).toContainText(/\d+ entries/);
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(menu.getByRole("menuitem", { name: /^All projects/ })).toContainText("g p");
  await expect(menu.getByRole("menuitem", { name: "New project" })).toBeVisible();
  // An ordinary menu: Escape closes it and the focus goes back to the button.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sample, switch project" })).toBeFocused();
});

test("All projects shows a card for each project, and is reached from the switcher and with g p", async ({
  page,
}) => {
  await made(page, "Salt Coast", "salt-coast");
  await page.goto(proj("/"));
  await expect(page.locator(".home h1")).toBeVisible();
  const menu = await openSwitcher(page);
  await menu.getByRole("menuitem", { name: /^All projects/ }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { name: "Your projects" })).toBeVisible();
  const sample = page.getByRole("link", { name: "Sample, Owner" });
  await expect(sample).toContainText(/\d+ entries · \d+ maps?/);
  // Who is in it, as avatars, and who saved the last version.
  await expect(sample.locator(".ui-avatar")).not.toHaveCount(0);
  await expect(sample).toContainText(/saved a version/);
  await expect(page.getByRole("link", { name: "Salt Coast, Owner" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  // The wordmark and your avatar with the account menu; no side bar here.
  await expect(page.locator(".outside-bar .wordmark")).toBeVisible();
  await expect(page.locator(".left-bar")).toHaveCount(0);
  await page.getByRole("button", { name: /account menu/ }).click();
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Salt Coast, Owner" }).click();
  await expect(page).toHaveURL(/\/p\/salt-coast$/);
  // g p, from inside a project.
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page).toHaveURL(/\/projects$/);
});

test("the account menu of All projects opens your settings with no project", async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("button", { name: /account menu/ }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings(\/[a-z/-]+)?$/);
  // Only what is yours and the device's: the project's sections need a project.
  const nav = page.getByRole("navigation", { name: "Settings" });
  if (await nav.isVisible()) {
    await expect(nav.getByText("This project")).toHaveCount(0);
    await expect(nav.getByText("This device")).toBeVisible();
  }
  await page.goto("/settings/device/offline");
  await expect(page.locator(".on-this-device")).toBeVisible();
});

test("makes an empty project, checking its address as it is typed, and moves into it", async ({
  page,
}) => {
  await page.goto("/projects?new=1");
  const dialog = page.getByRole("dialog", { name: "New project" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("Salt Coast");
  // The address comes from the name, and is shown in full.
  await expect(dialog.getByLabel("Address")).toHaveValue("salt-coast");
  await expect(dialog).toContainText("/p/salt-coast");
  await expect(dialog).toContainText("This address is free.");
  // A taken address, and a reserved one, say why.
  await dialog.getByLabel("Address").fill("sample");
  await expect(dialog.getByRole("status").last()).not.toContainText("free");
  await expect(dialog.getByLabel("Address")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("button", { name: "Make the project" })).toBeDisabled();
  await dialog.getByLabel("Address").fill("api");
  await expect(dialog.getByLabel("Address")).toHaveAttribute("aria-invalid", "true");
  await dialog.getByLabel("Address").fill("Bad Address!");
  await expect(dialog).toContainText(/lowercase letters/);
  await dialog.getByLabel("Address").fill("salt-coast");
  await expect(dialog).toContainText("This address is free.");
  await dialog.getByRole("button", { name: "Make the project" }).click();

  await expect(page).toHaveURL(/\/p\/salt-coast$/);
  await expect(page.locator(".home h1")).toBeVisible();
  await sideBar(page);
  await expect(page.getByRole("button", { name: "Salt Coast, switch project" })).toBeVisible();
  // It starts with one welcome entry, and none of the sample's.
  const tree = await folders(page);
  await expect(tree).toContainText("Welcome");
  await expect(tree).not.toContainText("Places");
});

test("makes a project from the sample", async ({ page }) => {
  await page.goto("/projects?new=1");
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Name").fill("Second Sample");
  await dialog.getByRole("radio", { name: /^The sample/ }).check();
  await expect(dialog).toContainText("This address is free.");
  await dialog.getByRole("button", { name: "Make the project" }).click();
  await expect(page).toHaveURL(/\/p\/second-sample$/);
  const tree = await folders(page);
  await expect(tree).toContainText("Places");
});

/** A vault zip with one note in it. */
function zipOf(note: string, text: string): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(text), note);
  zip.end();
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    zip.outputStream.on("data", (c: Buffer) => parts.push(c));
    zip.outputStream.on("end", () => resolve(Buffer.concat(parts)));
    zip.outputStream.on("error", reject);
  });
}

test("makes a project from a vault zip, with its progress, and says so when the zip fails", async ({
  page,
}) => {
  const buffer = await zipOf("Zipped Note.md", "# Zipped Note\n\nFrom a zip.\n");
  await page.goto("/projects?new=1");
  let dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Name").fill("From Zip");
  await dialog.getByRole("radio", { name: /^A vault zip/ }).check();
  // The button waits for the file.
  await expect(dialog.getByRole("button", { name: "Make the project" })).toBeDisabled();
  await dialog
    .getByLabel("Zip file")
    .setInputFiles({ name: "vault.zip", mimeType: "application/zip", buffer });
  await expect(dialog).toContainText("This address is free.");

  // The first upload fails: the project is there, and the dialog says so with a way to retry.
  await page.route("**/api/p/from-zip/import/vault", (route) => route.abort());
  await dialog.getByRole("button", { name: "Make the project" }).click();
  // The dialog now says the project is made and the zip did not go in.
  dialog = page.getByRole("dialog", { name: "From Zip is made" });
  await expect(dialog.getByRole("alert")).toContainText(
    "The project exists, but the zip did not go in",
  );
  await page.unroute("**/api/p/from-zip/import/vault");
  await dialog.getByRole("button", { name: "Try the zip again" }).click();
  await expect(page).toHaveURL(/\/p\/from-zip$/);
  const tree = await folders(page);
  await expect(tree).toContainText("Zipped Note");
});

test("a switch leaves nothing of the project behind: the tree, the pins, the recents, the search", async ({
  page,
}) => {
  await made(page, "Salt Coast", "salt-coast");
  await page.request.post(`/api/p/${PROJECT}/pins`, { data: { path: HARBOR } });
  await page.goto(proj(`/e/${HARBOR.split("/").map(encodeURIComponent).join("/")}`));
  await expect(page.locator(".entry h1").first()).toHaveText("Harbor");
  // In the sample: the entry is in the tree, pinned, and among the recents.
  await sideBar(page);
  await expect(page.locator(".left-pins")).toContainText("Harbor");
  let tree = await folders(page);
  await expect(tree).toContainText("Places");

  // Move to the other project through the switcher.
  await page.keyboard.press("Escape");
  await sideBar(page);
  const menu = await openSwitcher(page);
  await menu.getByRole("menuitem", { name: /^Salt Coast/ }).click();
  await expect(page).toHaveURL(/\/p\/salt-coast$/);
  await expect(page.locator(".home h1")).toBeVisible();

  // Nothing of the sample shows: not the tree, not the pins, not the recents on Home.
  await sideBar(page);
  await expect(page.locator(".left-pins")).toContainText("Nothing pinned.");
  await expect(page.locator(".left-pins")).not.toContainText("Harbor");
  tree = await folders(page);
  await expect(tree).not.toContainText("Places");
  await expect(page.locator(".home")).not.toContainText("Harbor");
  // The quick switcher finds nothing of it either, by name or by text.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  const find = page.getByRole("dialog", { name: "Find an entry" });
  await find.getByRole("searchbox").fill("Harbor");
  await expect(find).toContainText("Nothing found.");
  await expect(find).not.toContainText("Harbor Master");
  await page.keyboard.press("Escape");
  // An address of the sample's entry, in this project, is not found here.
  await page.goto(`/p/salt-coast/e/${HARBOR.split("/").map(encodeURIComponent).join("/")}`);
  await expect(page.locator(".entry h1")).toHaveCount(0);

  // Back in the sample, all of it is there again.
  await page.goto(proj("/"));
  await sideBar(page);
  await expect(page.locator(".left-pins")).toContainText("Harbor");
});

test("old addresses open the same page in the project last used, keeping the query and the hash", async ({
  page,
}) => {
  await page.goto(proj("/"));
  await expect(page.locator(".home h1")).toBeVisible();
  await page.goto("/maps?x=1#there");
  await expect(page).toHaveURL(/\/p\/sample\/maps\?x=1#there$/);
  await page.goto("/e/02%20People/Mira.md");
  await expect(page).toHaveURL(/\/p\/sample\/e\/02%20People\/Mira\.md$/);
  await expect(page.locator(".entry h1").first()).toHaveText("Mira");
  await page.goto("/settings/library/types");
  await expect(page).toHaveURL(/\/p\/sample\/settings\/types$/);
  // The start page opens the project used last.
  await page.goto("/");
  await expect(page).toHaveURL(/\/p\/sample$/);

  // After using another, the old addresses open that one.
  await made(page, "Salt Coast", "salt-coast");
  await page.goto("/projects");
  await page.getByRole("link", { name: "Salt Coast, Owner" }).click();
  await expect(page).toHaveURL(/\/p\/salt-coast$/);
  // Opened, and the server has been told: the old addresses go there from now on.
  await expect(page.locator(".home h1")).toBeVisible();
  await expect
    .poll(
      async () =>
        ((await (await page.request.get("/api/projects")).json()) as { last: string }).last,
    )
    .toBe("salt-coast");
  await page.goto("/gallery");
  await expect(page).toHaveURL(/\/p\/salt-coast\/gallery$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/p\/salt-coast$/);
});

test("renaming the address keeps the old link working, and says so first", async ({ page }) => {
  await made(page, "Salt Coast", "salt-coast");
  await page.goto("/p/salt-coast/settings/general");
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  const address = page.getByLabel("Address");
  await address.fill("salt-shore");
  await expect(page.getByRole("note")).toContainText("old address keeps working for 90 days");
  await expect(page.locator(".general-note")).toContainText("This address is free.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/p\/salt-shore\/settings\/general$/);
  await expect(page.getByLabel("Address")).toHaveValue("salt-shore");

  // The old link still lands, and the address in the bar becomes the new one.
  await page.goto("/p/salt-coast/e/Welcome.md");
  await expect(page).toHaveURL(/\/p\/salt-shore\/e\/Welcome\.md$/);
  await expect(page.locator(".entry h1").first()).toBeVisible();
  // A name that is taken is said before saving.
  await page.goto("/p/salt-shore/settings/general");
  await page.getByLabel("Address").fill("sample");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
});

test("the project's name and description are changed in General, and its people are listed", async ({
  page,
}) => {
  await made(page, "Salt Coast", "salt-coast");
  await page.goto("/p/salt-coast/settings/general");
  await page.getByLabel("Name", { exact: true }).fill("Salt Coast Atlas");
  await page.getByLabel("Description").fill("The coast, mapped.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await sideBar(page);
  await expect(
    page.getByRole("button", { name: "Salt Coast Atlas, switch project" }),
  ).toBeVisible();
  // Read-only people: name and role.
  await expect(page.locator(".general-members")).toContainText("Olive Owner");
  await expect(page.locator(".general-members")).toContainText("Owner");
});

test("deleting asks for the project's name, and the first project cannot be deleted", async ({
  page,
}) => {
  await made(page, "Salt Coast", "salt-coast");
  await page.goto("/p/salt-coast/settings/general");
  const area = page.locator(".general-danger");
  await expect(area.getByRole("heading", { name: "Delete this project" })).toBeVisible();
  const button = area.getByRole("button", { name: "Delete this project" });
  await expect(button).toBeDisabled();
  await area.getByRole("textbox").fill("Salt");
  await expect(button).toBeDisabled();
  await area.getByRole("textbox").fill("Salt Coast");
  await expect(button).toBeEnabled();
  await button.click();
  // It is gone from the list, and the app is in the other project.
  await expect(page).toHaveURL(/\/p\/sample$|\/projects$/);
  const list = (await (await page.request.get("/api/projects")).json()) as {
    projects: { slug: string }[];
  };
  expect(list.projects.map((p) => p.slug)).toEqual(["sample"]);

  // The library the server started with cannot be deleted, and the page says why.
  await page.goto(proj("/settings/general"));
  const first = page.locator(".general-danger");
  await expect(first).toContainText("started with");
  await expect(first.getByRole("button", { name: "Delete this project" })).toBeDisabled();
  await expect(first.getByRole("textbox")).toBeDisabled();
});

test("a project that is not on this device, with no connection, says so and gives a way back", async ({
  page,
  context,
}) => {
  await made(page, "Far Shore", "far-shore");
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: "Far Shore, Owner" })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("link", { name: "Far Shore, Owner" }).click();
  await expect(page).toHaveURL(/\/p\/far-shore$/);
  const note = page.getByRole("status").filter({ hasText: "is not on this device" });
  await expect(note).toContainText("Far Shore is not on this device");
  await expect(note.getByRole("link", { name: "All projects" })).toBeVisible();
  // The way back leads to what is here.
  await note.getByRole("link", { name: "All projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  // Back online, the project opens.
  await context.setOffline(false);
  await page.getByRole("link", { name: "Far Shore, Owner" }).click();
  await expect(page.locator(".home h1")).toBeVisible();
});
