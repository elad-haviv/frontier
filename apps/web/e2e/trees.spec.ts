import { expect, type Page, test } from "@playwright/test";

// Each project (phone, desktop) makes its own family, so the two runs on one server do not meet.
const family = (project: string) => {
  const s = project === "phone" ? "Phone" : "Desk";
  return {
    a: `Arlen ${s}`,
    b: `Brisa ${s}`,
    c: `Cato ${s}`,
    path: (name: string) => `02 People/${name}.md`,
  };
};

async function seed(page: Page, f: ReturnType<typeof family>) {
  const add = async (data: Record<string, unknown>) => {
    const res = await page.request.post("/api/relations", { data });
    expect(res.ok(), await res.text()).toBe(true);
  };
  // Arlen is written first, as an existing entry the relations hang from.
  await add({ path: "02 People/Mira.md", what: "rival", who: f.a, create: true });
  await add({ path: f.path(f.a), what: "partner", who: f.b, create: true });
  await add({ path: f.path(f.a), what: "child", who: f.c, with: f.path(f.b), create: true });
}

test("a family tree: make it, read it, add to it, compare two", async ({ page }, info) => {
  const f = family(info.project.name);
  const phone = info.project.name === "phone";
  await page.goto("/");
  await seed(page, f);

  await page.goto("/trees");
  await (
    phone
      ? page.getByRole("button", { name: /New tree/ }).first()
      : page.getByRole("button", { name: /^New tree/ }).first()
  ).click();
  const dialog = page.getByRole("dialog", { name: "New tree" });
  await dialog.getByLabel("Name").fill(`House ${f.a}`);
  await dialog.getByRole("combobox").click();
  await page.getByPlaceholder("Find an entry").fill(f.a);
  await page.getByRole("option", { name: f.a, exact: true }).click();
  await dialog.getByRole("button", { name: "Make the tree" }).click();
  await expect(page).toHaveURL(/\/tree\/[a-z0-9]{8}$/);

  if (phone) {
    // The phone opens on One at a time, on the tree's start.
    await expect(page.getByRole("button", { name: "One at a time" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".tr-pc.is-me")).toContainText(f.a);
    await page.locator(".tr-pc", { hasText: f.c }).click();
    await expect(page.locator(".tr-pc.is-me")).toContainText(f.c);
    await expect(page.locator(".tr-one-row").first()).toContainText(f.b);
    await page.getByRole("button", { name: "Tree", exact: true }).click();
    await expect(page.locator(`.tr-card[data-key="${f.path(f.c)}"]`)).toBeVisible();
    return;
  }

  const card = (name: string) => page.locator(`.tr-card[data-key="${f.path(name)}"]`);
  await expect(card(f.a)).toBeVisible();
  await expect(card(f.b)).toContainText("MARRIED IN");
  await card(f.c).click();
  const panel = page.getByRole("complementary", { name: "Selected" });
  await expect(panel.getByRole("heading", { name: f.c })).toBeVisible();
  await expect(panel.getByRole("button", { name: f.a })).toBeVisible();
  await expect(panel.getByRole("button", { name: f.b })).toBeVisible();

  // Add a child by name only: saved on the selected entry, drawn as a dashed card.
  await page.locator("svg.tr-svg").focus();
  await page.keyboard.press("a");
  const picker = page.getByRole("dialog", { name: `Add a child of ${f.c}` });
  await picker.getByRole("combobox").fill("Dovey");
  await picker.getByRole("option", { name: /Just the name/ }).click();
  await expect(page.getByText(`Saved on ${f.c}'s entry: child [[Dovey]].`)).toBeVisible();
  await expect(page.locator('.tr-card[data-key="?Dovey"]')).toBeVisible();
  const text = await page.request.get(`/api/entries?path=${encodeURIComponent(f.path(f.c))}`);
  expect(((await text.json()) as { text: string }).text).toContain(
    'what: child\n    who: "[[Dovey]]"',
  );

  // How are they related: C, then pick the second.
  await page.keyboard.press("f");
  await card(f.c).click();
  await page.keyboard.press("c");
  await card(f.a).click();
  await expect(page.getByRole("status").filter({ hasText: "is" })).toContainText(
    `${f.a} is ${f.c}'s parent.`,
  );

  // The entry's Relations tab shows what it writes itself.
  await page.goto(`/e/${encodeURIComponent(f.path(f.a)).replace(/%2F/g, "/")}`);
  await page.getByRole("button", { name: "Relations", exact: true }).first().click();
  await expect(page.locator(".tr-written")).toContainText(f.b);
  await expect(page.locator(".tr-written")).toContainText(`with ${f.b}`);
});
