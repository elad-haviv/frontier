import { expect, type Page, test } from "@playwright/test";
import { newMapInForm, pickEntry } from "./helpers.ts";

const IMAGE = "map one.png";

/** Makes the main chronicle of CUJ 16 through the API and returns the ids of its spans. */
async function makeChronicle(page: Page, title: string, entryPath: string) {
  await page.goto("/chronicles");
  return page.evaluate(
    async ({ title, entryPath }) => {
      const json = { "content-type": "application/json" };
      const made = await (
        await fetch("/api/chronicles", {
          method: "POST",
          headers: json,
          body: JSON.stringify({ title }),
        })
      ).json();
      const { chronicle, revision } = await (await fetch(`/api/chronicles/${made.id}`)).json();
      const lane = chronicle.lanes[0].id;
      const at = (low: number, high = low) => ({ words: "", low, high });
      const span = (id: string, name: string, extra: object) => ({
        id,
        lane,
        name,
        point: false,
        start: null,
        end: null,
        length: null,
        entry: null,
        note: "",
        ...extra,
      });
      chronicle.origin = "kingdom1";
      chronicle.spans = [
        span("kingdom1", "The kingdom", { start: at(0) }),
        span("thewar01", "The war", { start: at(270, 290), end: at(300) }),
        span("treaty01", "The treaty", { point: true, start: at(300) }),
      ];
      await fetch(`/api/chronicles/${made.id}`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({
          chronicle,
          revision,
          link: [{ span: "thewar01", path: entryPath }],
        }),
      });
      await fetch(`/api/chronicles/${made.id}/main`, { method: "POST", headers: json, body: "{}" });
      return made.id as string;
    },
    { title, entryPath },
  );
}

/** What the topmost element at a point is: "map" when a tap there reaches the map's surface. */
function whatIsAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px!, py!);
      if (el?.closest(".map-top")) return "map";
      return el ? `${el.tagName.toLowerCase()}.${String(el.className)}` : "nothing";
    },
    [x, y],
  );
}

async function centre(page: Page) {
  const box = (await page.locator(".map-top").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const stored = (page: Page) =>
  page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    const res = await fetch(`/api/maps/${id}`);
    return (
      (await res.json()) as {
        map: {
          features: {
            kind: string;
            span?: string;
            entry: string | null;
            points?: number[][];
            shapes?: { from: string; points?: number[][] }[];
          }[];
        };
      }
    ).map;
  });

/** The map is drawn on the next frame after a change; taps are tested against what was drawn. */
const drawn = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

async function year(page: Page, value: number) {
  await page.getByLabel("Year", { exact: true }).fill(String(value));
  await expect(page.getByLabel("Year", { exact: true })).toHaveValue(String(value));
  await drawn(page);
}

test("CUJ 16: a fort appears and goes, and a border changes shape, as the years move", async ({
  page,
}, info) => {
  const chronicle = await makeChronicle(
    page,
    `Kingdom years ${info.project.name}`,
    "02 People/Mira.md",
  );

  await newMapInForm(page, `Kingdom ${info.project.name}`, "flat", IMAGE);

  // Time on: the main chronicle, at the latest year it knows.
  await page.getByRole("button", { name: "Time", exact: true }).click();
  await expect(page.getByLabel("Chronicle")).toHaveValue(chronicle);
  await expect(page.getByLabel("Year", { exact: true })).toHaveValue("300");
  await year(page, 310);

  // A border, tied to the kingdom, with a later shape from the treaty.
  let c = await centre(page);
  await page.getByRole("button", { name: "Zone" }).click();
  // The tool is ready for taps once its hint shows; a tap before that would select instead.
  // Its words follow the pointer: a mouse clicks and double-clicks, a finger taps.
  const words =
    info.project.name === "desktop"
      ? "Click to add points · Double-click or Enter to finish · Esc to cancel"
      : "Tap to add points. Tap the last point again to finish.";
  await expect(page.locator(".map-hint", { hasText: words })).toBeVisible();
  for (const [dx, dy] of [
    [-90, -110],
    [90, -110],
    [0, -50],
  ] as const) {
    await expect
      .poll(() => whatIsAt(page, c.x + dx, c.y + dy), { message: "a tap must land on the map" })
      .toBe("map");
    await page.mouse.click(c.x + dx, c.y + dy);
  }
  await page.locator(".map-hint").getByRole("button", { name: "Finish zone" }).click();
  const editor = page.locator(".feature-editor");
  await expect(editor).toContainText("Timeless");
  await editor.getByLabel("Tie to a span").selectOption({ label: "The kingdom" });
  await expect(editor).toContainText("Tied to The kingdom");
  await editor.getByLabel("Add a shape from").selectOption({ label: "The treaty" });
  await expect(editor.locator(".shape-editing")).toHaveText("Editing the shape from The treaty.");
  await expect(page.locator(".save-saved")).toBeVisible();

  // Dragging a corner changes the later shape only.
  c = await centre(page);
  await page.mouse.move(c.x - 90, c.y - 110);
  await page.mouse.down();
  await page.mouse.move(c.x - 110, c.y - 125, { steps: 4 });
  await page.mouse.move(c.x - 130, c.y - 140, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(".save-saved")).toBeVisible();
  let zone = (await stored(page)).features.find((f) => f.kind === "zone")!;
  expect(zone.span).toBe("kingdom1");
  expect(zone.shapes).toHaveLength(1);
  expect(zone.shapes![0]!.from).toBe("treaty01");
  const first = zone.points![0]!;
  const laterCorner = zone.shapes![0]!.points![0]!;
  expect(laterCorner[0]).toBeLessThan(first[0]!);
  expect(zone.shapes![0]!.points![1]).toEqual(zone.points![1]);

  // Undo takes the drag back and leaves the first shape as it was.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".save-saved")).toBeVisible();
  zone = (await stored(page)).features.find((f) => f.kind === "zone")!;
  expect(zone.shapes![0]!.points![0]).toEqual(first);
  await page.getByRole("button", { name: "Redo" }).click();

  // A fort, linked to the entry whose span is the war. It is gone at year 310, yet stays in
  // sight while it is the selected feature.
  await editor.getByRole("button", { name: "Close" }).click();
  c = await centre(page);
  await page.getByRole("button", { name: "Marker" }).click();
  await page.mouse.click(c.x, c.y + 20);
  await pickEntry(editor, "Mira");
  await expect(editor).toContainText("Follows The war, the span of its entry.");
  await expect(page.locator(".save-saved")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  // Reading through the years.
  const card = page.locator(".feature-card");
  const tapFort = async () => {
    const m = await centre(page);
    await page.mouse.click(m.x, m.y + 20);
  };
  await year(page, 0);
  await tapFort();
  await expect(card).toHaveCount(0);

  await page.getByRole("button", { name: /^Later/ }).click();
  await expect(page.getByLabel("Year", { exact: true })).toHaveValue("270");
  await drawn(page);
  await tapFort();
  await expect(card.locator("h2")).toHaveText("Mira");
  await expect(card.locator(".card-reason")).toHaveText("Perhaps: begins year 270 to 290.");
  await card.getByRole("button", { name: "Close" }).click();

  await year(page, 295);
  await tapFort();
  await expect(card.locator("h2")).toHaveText("Mira");
  await expect(card.locator(".card-reason")).toHaveCount(0);
  await card.getByRole("button", { name: "Close" }).click();

  await year(page, 310);
  await tapFort();
  await expect(card).toHaveCount(0);

  // The border has its later shape now: the corner that was dragged out is part of it at 310
  // and not at 0.
  const tapOut = async () => {
    const m = await centre(page);
    await page.mouse.click(m.x - 110, m.y - 131);
  };
  await tapOut();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Close" }).click();
  await year(page, 0);
  await tapOut();
  await expect(card).toHaveCount(0);

  // The year is kept in the address, and the address opens the same moment.
  await year(page, 280);
  await expect(page).toHaveURL(/t=280/);
  await page.reload();
  await expect(page.getByLabel("Year", { exact: true })).toHaveValue("280");
  await expect(page).toHaveURL(/v=/);
  await page.waitForTimeout(300);
  await tapFort();
  await expect(card.locator(".card-reason")).toHaveText("Perhaps: begins year 270 to 290.");
  await card.getByRole("button", { name: "Close" }).click();

  // The layer panel says how the features stand to the chronicle.
  await page.getByRole("button", { name: "Layers" }).click();
  await expect(page.locator(".time-line")).toContainText("2 follow the chronicle");
  await page.getByRole("button", { name: "Layers" }).click();

  // Time off: the map is as it always was, and the fort is there.
  await page.getByRole("button", { name: "Time off" }).click();
  await expect(page.locator(".time-bar")).toHaveCount(0);
  // The frame grows when the bar goes, and the map is drawn again a moment later.
  await expect(async () => {
    await drawn(page);
    await tapFort();
    await expect(card.locator("h2")).toHaveText("Mira", { timeout: 500 });
  }).toPass();
  await expect(page).not.toHaveURL(/t=/);

  await page.evaluate(async (chronicle) => {
    await fetch(`/api/maps/${location.pathname.split("/").pop()}`, { method: "DELETE" });
    await fetch(`/api/chronicles/${chronicle}`, { method: "DELETE" });
    const un = await (await fetch("/api/unpublished")).json();
    for (const d of un.drafts) await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
  }, chronicle);
});
