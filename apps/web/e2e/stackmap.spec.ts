import { expect, type Page, test } from "@playwright/test";
import { rightPanel, at } from "./helpers.ts";

/** Three globes that lie one under the other, with places straight above one another and passages. */
async function seed(page: Page, tag: string) {
  return page.evaluate(async (tag) => {
    const make = async (title: string, under: string | null) => {
      const res = await fetch("/api/maps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, kind: "sphere", image: "99 Appendices/Images/map one.png" }),
      });
      const { id } = (await res.json()) as { id: string };
      const got = (await (await fetch(`/api/maps/${id}`)).json()) as {
        map: Record<string, unknown>;
        revision: number;
      };
      if (under) got.map.under = under;
      return { id, got };
    };
    const marker = (
      id: string,
      layer: string,
      label: string,
      at: number[],
      extra: object = {},
    ) => ({
      id,
      kind: "marker",
      layer,
      at,
      entry: null,
      label,
      icon: null,
      child: null,
      ...extra,
    });
    const save = async (o: Awaited<ReturnType<typeof make>>, features: unknown[]) => {
      o.got.map.features = features;
      const res = await fetch(`/api/maps/${o.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ map: o.got.map, revision: o.got.revision }),
      });
      if (res.status !== 200) throw new Error(await res.text());
    };
    const layerOf = (o: Awaited<ReturnType<typeof make>>) =>
      (o.got.map.layers as { id: string }[])[0]!.id;
    const ezob = await make(`Ezob ${tag}`, null);
    const lab = await make(`Labyrinth ${tag}`, ezob.id);
    const two = await make(`Layer two ${tag}`, lab.id);
    await save(ezob, [
      marker("dudai", layerOf(ezob), "Dudai", [-30, 10], {
        passages: [{ map: lab.id, feature: "under" }],
      }),
      marker("gate", layerOf(ezob), "North Gate", [40, -5]),
    ]);
    await save(lab, [
      marker("under", layerOf(lab), "Under-Dudai", [-30.5, 9.5], {
        passages: [{ map: two.id, feature: "well" }],
      }),
      marker("stair", layerOf(lab), "The First Stair", [40, -5]),
    ]);
    await save(two, [marker("well", layerOf(two), "The Dry Well", [-31, 10])]);
    return { ezob: ezob.id, lab: lab.id, two: two.id };
  }, tag);
}

async function discard(page: Page, ids: string[]) {
  await page.evaluate(async (ids) => {
    for (const id of ids) await fetch(`/api/maps/${id}`, { method: "DELETE" });
  }, ids);
}

const labelsOf = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const got = (await (await fetch(`/api/maps/${id}`)).json()) as {
      map: { features: { label: string | null; passages?: unknown[] }[] };
    };
    return got.map.features.map((f) => [f.label, f.passages?.length ?? 0]);
  }, id);

test("a map with globes under it opens as a stack of layers, with straight above and below and passages", async ({
  page,
}, info) => {
  await page.goto(at("/maps"));
  const ids = await seed(page, info.project.name);
  await page.goto(at(`/map/${ids.lab}`));
  await page.getByRole("link", { name: "Layers stacked" }).first().click();
  await expect(page.locator(".stack-page .star-canvas")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("what lies under it");

  // The layers, top to bottom, and every place.
  const layers = await rightPanel(page, "Layers");
  await expect(layers.locator(".stack-layers li")).toHaveCount(3);
  await expect(layers.getByRole("heading", { name: "Places (5)" })).toBeVisible();

  // A place says what is straight below it, and where its passages lead.
  await layers
    .locator(".star-places")
    .getByRole("button", { name: /^Dudai/ })
    .click();
  const card = await rightPanel(page, "Selected");
  await expect(card.locator(".star-facts")).toContainText("Straight below");
  await expect(card.locator(".star-facts")).toContainText("Under-Dudai");
  await expect(card.locator(".star-facts")).toContainText("Down to Under-Dudai");
  await discard(page, [ids.ezob, ids.lab, ids.two]);
});

test("places are renamed and removed in the stack, and a removed place takes its passages with it", async ({
  page,
}, info) => {
  await page.goto(at("/maps"));
  const ids = await seed(page, info.project.name);
  await page.goto(at(`/stack/${ids.lab}?edit=1`));
  await expect(page.locator(".stack-page .star-canvas")).toBeVisible();
  const layers = await rightPanel(page, "Layers");
  await layers
    .locator(".star-places")
    .getByRole("button", { name: /^Dudai/ })
    .click();
  const edit = await rightPanel(page, "Edit feature");
  await edit.getByRole("textbox", { name: "Name" }).fill("Dudai the Old");
  await rightPanel(page, "Layers");
  await page
    .locator(".star-places")
    .getByRole("button", { name: /^Under-Dudai/ })
    .click();
  const second = await rightPanel(page, "Edit feature");
  await second.getByRole("button", { name: "Remove this place" }).click();
  await page.getByRole("button", { name: "Done" }).first().click();

  // Each layer was saved with its own map: the rename on Ezob, the removal on the Labyrinth, and
  // the passage that led to the removed place is gone from Ezob.
  await expect
    .poll(async () => labelsOf(page, ids.ezob))
    .toEqual([
      ["Dudai the Old", 0],
      ["North Gate", 0],
    ]);
  expect(await labelsOf(page, ids.lab)).toEqual([["The First Stair", 0]]);
  await discard(page, [ids.ezob, ids.lab, ids.two]);
});

test("a marker is put on the layer being worked on, and a passage joins two layers", async ({
  page,
}, info) => {
  await page.goto(at("/maps"));
  const ids = await seed(page, info.project.name);
  await page.goto(at(`/stack/${ids.lab}?edit=1`));
  const canvas = page.locator(".stack-page .star-canvas");
  await expect(canvas).toBeVisible();
  const name = page.getByRole("textbox", { name: "Name" });
  const measure = async () => (await canvas.boundingBox())!;
  const settle = async () => {
    let last = "";
    await expect
      .poll(async () => {
        const now = JSON.stringify(await measure());
        const same = now === last;
        last = now;
        return same;
      })
      .toBe(true);
  };

  // The layer opened is the one worked on: a marker clicked at the middle lands on it.
  await page.getByRole("button", { name: "Marker" }).first().click();
  const first = await measure();
  await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2);
  await expect(name).toBeVisible();
  await name.fill("The Cellar");
  await settle();
  const box = await measure();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // The layer above sits one layer-spacing higher on the screen, at the zoom the stack opened at.
  const zoom = Math.min(
    Math.max(Math.min(first.width / (11 * 2.6), first.height / (5.5 * 5)), 7),
    40,
  );
  const up = 5 * zoom * Math.cos(0.5);

  // Another layer is picked in the Layers tab, and gets a marker of its own.
  const layers = await rightPanel(page, "Layers");
  await layers.locator(".stack-layer").first().click();
  await page.mouse.click(cx, cy - up);
  await expect(name).toBeVisible();
  await name.fill("The Cupola");

  // A passage: click one place, then one on another layer. (On a phone the sheet is put away
  // first, since it covers the foot of the map.)
  if (info.project.name === "phone")
    await page.getByRole("button", { name: "Hide the panel" }).click();
  await page.getByRole("button", { name: "Passage" }).first().click();
  await expect(page.locator(".map-hint")).toContainText("starts");
  await page.mouse.click(cx, cy - up);
  await expect(page.locator(".map-hint")).toContainText("another layer");
  await page.mouse.click(cx, cy);
  const card = await rightPanel(page, "Edit feature");
  await expect(card.locator(".star-facts")).toContainText("Up to The Cupola");
  await page.getByRole("button", { name: "Done" }).first().click();

  // The passage is held by the upper place, on Ezob's own map.
  await expect
    .poll(async () => (await labelsOf(page, ids.ezob)).find(([label]) => label === "The Cupola"))
    .toEqual(["The Cupola", 1]);
  expect((await labelsOf(page, ids.lab)).map(([label]) => label)).toContain("The Cellar");
  await discard(page, [ids.ezob, ids.lab, ids.two]);
});
