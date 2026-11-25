import { expect, type Page, test } from "@playwright/test";
import { chooseKind, openNewMap } from "./helpers.ts";

/** Makes star maps and system models, which need no image, and returns their ids. */
async function make(page: Page, titles: string[], kind: "stars" | "system" = "stars") {
  return page.evaluate(
    async ({ titles, kind }) => {
      const ids: string[] = [];
      for (const title of titles) {
        const res = await fetch("/api/maps", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, kind }),
        });
        ids.push(((await res.json()) as { id: string }).id);
      }
      return ids;
    },
    { titles, kind },
  );
}

async function discard(page: Page, ids: string[]) {
  await page.evaluate(async (ids) => {
    for (const id of ids) await fetch(`/api/maps/${id}`, { method: "DELETE" });
  }, ids);
}

/** Every map in the library, so a test can leave nothing behind. */
const allIds = (page: Page) =>
  page.evaluate(async () =>
    ((await (await fetch("/api/maps")).json()) as { maps: { id: string }[] }).maps.map((m) => m.id),
  );

test("each map is one card with its kind, and a map with maps under it is a deck, not a group", async ({
  page,
}, info) => {
  const tag = info.project.name;
  await page.goto("/maps");
  // A top globe and two layers under it, made through the API, with a star map beside them.
  const ids = await page.evaluate(async (tag) => {
    const make = async (title: string, under: string | null) => {
      const res = await fetch("/api/maps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, kind: "sphere", image: "99 Appendices/Images/map one.png" }),
      });
      const { id } = (await res.json()) as { id: string };
      if (under) {
        const got = (await (await fetch(`/api/maps/${id}`)).json()) as {
          map: Record<string, unknown>;
          revision: number;
        };
        got.map.under = under;
        await fetch(`/api/maps/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ map: got.map, revision: got.revision }),
        });
      }
      return id;
    };
    const top = await make(`Top ${tag}`, null);
    const mid = await make(`Middle ${tag}`, top);
    const low = await make(`Bottom ${tag}`, mid);
    return [top, mid, low];
  }, tag);
  const [star] = await make(page, [`Stars ${tag}`]);
  await page.reload();

  const card = (title: string) =>
    page.locator(".map-card").filter({ has: page.getByRole("link", { name: title, exact: true }) });
  // Every map has a card of its own, layers included: nothing is grouped or hidden.
  await expect(card(`Top ${tag}`)).toBeVisible();
  await expect(card(`Middle ${tag}`)).toBeVisible();
  await expect(card(`Bottom ${tag}`)).toBeVisible();
  await expect(card(`Stars ${tag}`)).toContainText("Star map");
  // A map with maps under it is a deck; one with none, or a plain map, is not.
  await expect(card(`Top ${tag}`)).toHaveClass(/deck-2/);
  await expect(card(`Middle ${tag}`)).toHaveClass(/deck-1/);
  await expect(card(`Bottom ${tag}`)).not.toHaveClass(/deck/);
  await expect(card(`Stars ${tag}`)).not.toHaveClass(/deck/);
  await expect(card(`Middle ${tag}`)).toContainText(`lies under Top ${tag}`);
  await expect(card(`Top ${tag}`)).toContainText("2 layers below");

  // The card opens the map; the menu has Layers stacked for a globe in a stack.
  await card(`Middle ${tag}`)
    .getByRole("button", { name: `Actions for Middle ${tag}` })
    .click();
  await expect(page.getByRole("menuitem", { name: "Layers stacked" })).toBeVisible();
  await page.keyboard.press("Escape");
  await card(`Stars ${tag}`)
    .getByRole("button", { name: `Actions for Stars ${tag}` })
    .click();
  await expect(page.getByRole("menuitem", { name: "Layers stacked" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await discard(page, [...ids, star!]);
});

test("a map is renamed and deleted from its menu", async ({ page }, info) => {
  const tag = info.project.name;
  await page.goto("/maps");
  const [id] = await make(page, [`Old name ${tag}`]);
  await page.reload();
  const card = (title: string) =>
    page.locator(".map-card").filter({ has: page.getByRole("link", { name: title, exact: true }) });
  await card(`Old name ${tag}`)
    .getByRole("button", { name: `Actions for Old name ${tag}` })
    .click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill(`New name ${tag}`);
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(card(`New name ${tag}`)).toBeVisible();
  await expect(card(`Old name ${tag}`)).toHaveCount(0);

  await card(`New name ${tag}`)
    .getByRole("button", { name: `Actions for New name ${tag}` })
    .click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await expect(page.getByRole("dialog")).toContainText(`Delete the map "New name ${tag}"?`);
  await page.getByRole("dialog").getByRole("button", { name: "Delete the map" }).click();
  await expect(card(`New name ${tag}`)).toHaveCount(0);
  expect(await allIds(page)).not.toContain(id);
});

test("search appears with twelve maps, finds by title, kind and the world a layer lies under, and clears", async ({
  page,
}, info) => {
  const tag = info.project.name;
  await page.goto("/maps");
  const before = await allIds(page);
  const titles = Array.from({ length: 12 }, (_, i) => `Reach ${String(i).padStart(2, "0")} ${tag}`);
  const ids = await make(page, titles);
  await page.reload();
  const search = page.getByRole("searchbox", { name: "Find a map" });
  // The search is there once the library has grown to twelve; the slash key goes to it.
  await expect(search).toBeVisible();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();

  await search.fill(`reach 03 ${tag}`);
  await expect(page.locator(".maps-count")).toHaveText(/^1 of \d+ maps$/);
  await expect(page.locator(".map-card")).toHaveCount(1);
  await expect(page.locator(".map-card mark").first()).toBeVisible();
  // The kind word finds them too, and a search with no result says so and offers a way back.
  await search.fill("star map");
  await expect(page.locator(".map-card").first()).toBeVisible();
  await search.fill("zzzz nothing");
  await expect(page.getByText("No map is called “zzzz nothing”.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).first().click();
  await expect(search).toHaveValue("");
  await expect(page.locator(".map-card").first()).toBeVisible();
  // Escape clears a search that has words in it.
  await search.fill("reach");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  expect(before.length + 12).toBe((await allIds(page)).length);
  await discard(page, ids);
});

test("the view is a grid or a list, remembered on this device, with the same maps in both", async ({
  page,
}, info) => {
  const tag = info.project.name;
  await page.goto("/maps");
  const ids = await make(
    page,
    Array.from({ length: 5 }, (_, i) => `View ${i} ${tag}`),
  );
  await page.reload();
  await page.getByRole("button", { name: "List" }).click();
  await expect(page.locator(".map-row").filter({ hasText: `View 2 ${tag}` })).toBeVisible();
  await expect(page.locator(".map-card")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Grid of cards" }).click();
  await expect(page.locator(".map-card").filter({ hasText: `View 2 ${tag}` })).toBeVisible();
  await discard(page, ids);
});

test("New map is a dialog with a card for each kind, and the page has no form", async ({
  page,
}, info) => {
  await page.goto("/maps");
  await expect(page.locator(".new-map")).toHaveCount(0);
  await openNewMap(page);
  for (const name of ["Globe", "Flat map", "Star map", "System model"]) {
    await expect(page.getByRole("radio", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  // A kind that needs no image makes the map from a title alone, and opens it.
  await chooseKind(page, "System model");
  await page.locator(".new-map input[type=text]").fill(`Dialog ${info.project.name}`);
  await page.getByRole("button", { name: "Make the map" }).click();
  await expect(page.locator(".star-canvas")).toBeVisible();
  await page.evaluate(async () => {
    await fetch(`/api/maps/${location.pathname.split("/").pop()}`, { method: "DELETE" });
  });
});

test("with filters on, the chips show counts, Needs publishing narrows to unpublished maps, and Show all kinds undoes it", async ({
  page,
}, info) => {
  const tag = info.project.name;
  await page.goto("/maps");
  const stars = await make(
    page,
    Array.from({ length: 16 }, (_, i) => `Star ${i} ${tag}`),
    "stars",
  );
  const systems = await make(
    page,
    Array.from({ length: 16 }, (_, i) => `System ${i} ${tag}`),
    "system",
  );
  await page.reload();
  // Thirty or more: the chips are there, and so is the strip of the maps opened last.
  const chips = page.getByRole("group", { name: "Show" });
  await expect(chips).toBeVisible();
  await chips.getByRole("button", { name: /^Star maps/ }).click();
  await expect(page.locator(".map-card").first()).toContainText("Star map");
  await expect(page.locator(".map-card").filter({ hasText: "System model" })).toHaveCount(0);
  // Everything made here is new, so it needs publishing.
  await chips.getByRole("button", { name: /^Needs publishing/ }).click();
  await expect(page.locator(".map-card").first()).toBeVisible();
  await chips.getByRole("button", { name: /^All/ }).click();
  await chips.getByRole("button", { name: /^Needs publishing/ }).click();
  await expect(page.locator(".map-card").first()).toBeVisible();
  await discard(page, [...stars, ...systems]);
});
