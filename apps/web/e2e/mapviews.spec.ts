import { expect, type Page, test } from "@playwright/test";
import sharp from "sharp";

const IMAGE = "99 Appendices/Images/map one.png";

const makeMap = (page: Page, title: string, kind: "sphere" | "flat") =>
  page.evaluate(
    async ({ title, kind, image }) => {
      const res = await fetch("/api/maps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, kind, image }),
      });
      return ((await res.json()) as { id: string }).id;
    },
    { title, kind, image: IMAGE },
  );

const cleanUp = (page: Page, maps: string[], chronicles: string[] = []) =>
  page.evaluate(
    async ({ maps, chronicles }) => {
      for (const id of maps) await fetch(`/api/maps/${id}`, { method: "DELETE" });
      for (const id of chronicles) await fetch(`/api/chronicles/${id}`, { method: "DELETE" });
      const un = await (await fetch("/api/unpublished")).json();
      for (const d of un.drafts) await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
    },
    { maps, chronicles },
  );

async function centre(page: Page) {
  const box = (await page.locator(".map-top").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const viewOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get("v") ?? "");

test("CUJ 18: steps down to a layer under a globe at the same place, and back up", async ({
  page,
}, info) => {
  await page.goto("/maps");
  const top = await makeMap(page, `Surface ${info.project.name}`, "sphere");
  const layer = await makeMap(page, `Labyrinth ${info.project.name}`, "sphere");

  // The layer is set to lie under the surface.
  await page.goto(`/map/${layer}?edit=1`);
  await page.getByRole("button", { name: "Layers" }).click();
  await page
    .getByLabel("This map lies under")
    .selectOption({ label: `Surface ${info.project.name}` });
  await expect(page.locator(".save-saved")).toBeVisible();

  // The list says so.
  await page.goto("/maps");
  const row = (title: string) =>
    page
      .locator(".map-list li")
      .filter({ has: page.getByRole("link", { name: title, exact: true }) });
  await expect(row(`Labyrinth ${info.project.name}`)).toContainText(
    `lies under Surface ${info.project.name}`,
  );
  await expect(row(`Surface ${info.project.name}`)).toContainText("1 layer below");

  // From the surface, turned to some place, Down keeps the place.
  await page.goto(`/map/${top}?v=g,40,10,200`);
  await expect(page.locator(".map-top")).toBeVisible();
  const c = await centre(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x - 40, c.y + 20, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const there = viewOf(page.url());
  expect(there).not.toBe("g,40,10,200");
  await page.getByRole("button", { name: "▼ Down" }).click();
  await expect(page).toHaveURL(new RegExp(`/map/${layer}`));
  expect(viewOf(page.url())).toBe(there);
  // The layer's own picture is drawn: the map's surface is not left blank.
  await expect(page.locator(".map-top")).toBeVisible();
  await expect(async () => {
    const box = await page.locator(".map-frame").boundingBox();
    expect(box).not.toBeNull();
    const shot = await page.screenshot({
      clip: {
        x: box!.x + box!.width / 2 - 20,
        y: box!.y + box!.height / 2 - 20,
        width: 40,
        height: 40,
      },
    });
    // The sample image is a pale blue; the empty frame behind a map is paper.
    const { data } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    let red = 0;
    let blue = 0;
    for (let i = 0; i < data.length; i += 3) {
      red += data[i]!;
      blue += data[i + 2]!;
    }
    expect(blue - red).toBeGreaterThan((data.length / 3) * 30);
  }).toPass();
  await expect(page.getByRole("button", { name: "▼ Down" })).toHaveCount(0);

  await page.getByRole("button", { name: "▲ Up" }).click();
  await expect(page).toHaveURL(new RegExp(`/map/${top}`));
  expect(viewOf(page.url())).toBe(there);

  await cleanUp(page, [top, layer]);
});

test("CUJ 19: a world on a schematic map revolves as the years move, and there is no measuring", async ({
  page,
}, info) => {
  await page.goto("/chronicles");
  const chronicle = await page.evaluate(async (title) => {
    const json = { "content-type": "application/json" };
    const made = await (
      await fetch("/api/chronicles", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ title }),
      })
    ).json();
    const { chronicle, revision } = await (await fetch(`/api/chronicles/${made.id}`)).json();
    const at = (low: number) => ({ words: "", low, high: low });
    const span = (id: string, start: number) => ({
      id,
      lane: chronicle.lanes[0].id,
      name: id,
      point: true,
      start: at(start),
      end: null,
      length: null,
      entry: null,
      note: "",
    });
    chronicle.origin = "begin001";
    chronicle.spans = [span("begin001", 0), span("later001", 1000)];
    await fetch(`/api/chronicles/${made.id}`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ chronicle, revision }),
    });
    await fetch(`/api/chronicles/${made.id}/main`, { method: "POST", headers: json, body: "{}" });
    return made.id as string;
  }, `Heavens years ${info.project.name}`);

  // A schematic map, made from the form.
  await page.goto("/maps");
  await page.locator(".new-map input[type=text]").fill(`Heavens ${info.project.name}`);
  await page.locator(".new-map select").nth(0).selectOption("schematic");
  await page.locator(".new-map select").nth(1).selectOption(IMAGE);
  await page.getByRole("button", { name: "Make the map" }).click();
  await expect(page.locator(".map-top")).toBeVisible();
  await expect(page).toHaveURL(/v=/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByRole("button", { name: "Measure" })).toHaveCount(0);

  // Ezob at the centre, Korr beside it, revolving around it once every 1000 years.
  const c = await centre(page);
  const editor = page.locator(".feature-editor");
  await page.getByRole("button", { name: "Marker" }).click();
  await page.mouse.click(c.x, c.y);
  await editor.getByLabel("Label").fill("Ezob");
  await editor.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Marker" }).click();
  await page.mouse.click(c.x + 80, c.y);
  await editor.getByLabel("Label").fill("Korr");
  await editor.getByLabel("Revolves around").selectOption({ label: "Ezob" });
  await expect(editor.getByLabel("Years for one turn")).toHaveValue("1000");
  await expect(page.locator(".save-saved")).toBeVisible();
  await editor.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Done" }).click();

  const card = page.locator(".feature-card");
  const tap = async (dx: number, dy: number) => {
    const m = await centre(page);
    await page.mouse.click(m.x + dx, m.y + dy);
  };
  const year = async (value: number) => {
    await page.getByLabel("Year", { exact: true }).fill(String(value));
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  };

  await page.getByRole("button", { name: "Time", exact: true }).click();
  await year(0);
  await tap(80, 0);
  await expect(card.locator("h2")).toHaveText("Korr");
  await card.getByRole("button", { name: "Close" }).click();

  // A quarter of a turn later Korr is above Ezob, and no longer beside it.
  await year(250);
  await tap(80, 0);
  await expect(card).toHaveCount(0);
  await tap(0, -80);
  await expect(card.locator("h2")).toHaveText("Korr");

  await cleanUp(page, [id], [chronicle]);
});

test("CUJ 17: lays a globe flat in Robinson, turns it, tilts it and focuses on a region", async ({
  page,
}, info) => {
  await page.goto("/maps");
  const id = await makeMap(page, `Atlas ${info.project.name}`, "sphere");
  await page.goto(`/map/${id}`);
  await expect(page.locator(".map-top")).toBeVisible();
  await expect(page).toHaveURL(/v=g/);

  // The picture is drawn in the projection: pale blue in the middle of the frame.
  const drawn = async () => {
    await expect(async () => {
      const box = (await page.locator(".map-frame").boundingBox())!;
      const shot = await page.screenshot({
        clip: {
          x: box.x + box.width / 2 - 20,
          y: box.y + box.height / 2 - 20,
          width: 40,
          height: 40,
        },
      });
      const { data } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
      let red = 0;
      let blue = 0;
      for (let i = 0; i < data.length; i += 3) {
        red += data[i]!;
        blue += data[i + 2]!;
      }
      expect(blue - red).toBeGreaterThan((data.length / 3) * 30);
    }).toPass();
  };

  await page.getByLabel("View").selectOption("robinson");
  await expect(page).toHaveURL(/v=x%2Crobinson|v=x,robinson/);
  await drawn();

  // Dragging sideways turns the globe about its axis.
  const before = viewOf(page.url()).split(",");
  const c = await centre(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 60, c.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => viewOf(page.url()).split(",")[2]).not.toBe(before[2]);
  await drawn();

  // A tilt of 20 degrees, typed.
  await page.getByRole("button", { name: "Turn" }).click();
  const tilt = page.getByLabel("Tilt, in degrees");
  await tilt.fill("20");
  await tilt.press("Enter");
  await expect.poll(() => viewOf(page.url()).split(",")[3]).toBe("20");
  await drawn();

  // Focus: a box around a place; the view turns upright onto it and zooms in.
  const k = Number(viewOf(page.url()).split(",")[5]);
  await page.getByRole("button", { name: "Focus on a region" }).click();
  await page.locator(".turn-panel").getByRole("button", { name: "Close" }).click();
  const m = await centre(page);
  await page.mouse.move(m.x - 40, m.y - 30);
  await page.mouse.down();
  await page.mouse.move(m.x + 10, m.y + 5, { steps: 5 });
  await page.mouse.move(m.x + 40, m.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => Number(viewOf(page.url()).split(",")[5])).toBeGreaterThan(k * 2);
  expect(viewOf(page.url()).split(",")[4]).toBe("0");
  await drawn();

  // The address opens the same view.
  const address = page.url();
  await page.reload();
  await expect(page.getByLabel("View")).toHaveValue("robinson");
  await page.waitForTimeout(500);
  expect(viewOf(page.url())).toBe(viewOf(address));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  // Every projection draws the picture.
  for (const projection of ["mercator", "mollweide", "hemispheres", "winkel3"]) {
    await page.getByLabel("View").selectOption(projection);
    await expect(page).toHaveURL(new RegExp(`v=x(%2C|,)${projection}`));
  }
  await page.getByLabel("View").selectOption("globe");
  await expect(page).toHaveURL(/v=g/);
  await drawn();

  await cleanUp(page, [id]);
});
