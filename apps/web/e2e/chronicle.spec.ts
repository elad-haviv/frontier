import { expect, type Page, test } from "@playwright/test";
import { noSidewaysScroll } from "./helpers.ts";

const SHOTS = process.env.CH_SHOTS;

/** Makes a chronicle through the API with the stage 17 example, and opens it. */
async function makeExample(page: Page, title: string) {
  await page.goto("/chronicles");
  const id = await page.evaluate(async (title) => {
    const json = { "content-type": "application/json" };
    const made = await (
      await fetch("/api/chronicles", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ title }),
      })
    ).json();
    const { chronicle, revision } = await (await fetch(`/api/chronicles/${made.id}`)).json();
    const humans = chronicle.lanes[0].id;
    chronicle.lanes[0].name = "Humans";
    chronicle.lanes.push({ id: "nirani01", name: "Nirani", color: "#2f6f73", clock: "ezob" });
    const at = (low: number, high = low) => ({ words: "", low, high });
    const span = (id: string, lane: string, name: string, more: object) => ({
      id,
      lane,
      name,
      point: false,
      start: null,
      end: null,
      length: null,
      entry: null,
      note: "",
      ...more,
    });
    chronicle.origin = "landing1";
    chronicle.units = [{ id: "gen00001", name: "generation", low: 20, high: 35 }];
    chronicle.spans = [
      span("landing1", humans, "First Landing", { point: true, start: at(0) }),
      span("fading01", humans, "Earth memory fades", {
        length: {
          words: "3-5 generations",
          low: 60,
          high: 175,
          clock: "ezob",
          unit: "gen00001",
          count: [3, 5],
        },
      }),
      span("kingdom1", humans, "The kingdom", { start: at(0), end: at(380, 450) }),
      span("war00001", humans, "The war", { start: at(270, 290), end: at(300) }),
      span("treaty01", humans, "The treaty", { point: true, start: at(300) }),
      span("nirani01", "nirani01", "Nirani presence", { start: "open", end: at(380, 450) }),
      span("unknown1", "nirani01", "The Adyni", {}),
    ];
    chronicle.relations = [
      { id: "rel00001", a: "fading01", kind: "starts_with", b: "landing1" },
      { id: "rel00002", a: "war00001", kind: "during", b: "kingdom1" },
    ];
    await fetch(`/api/chronicles/${made.id}`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ chronicle, revision }),
    });
    return made.id as string;
  }, title);
  await page.goto(`/chronicle/${id}`);
  await expect(page.locator(".ch-bar h1")).toHaveText(title);
  return id;
}

const remove = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    await fetch(`/api/chronicles/${id}`, { method: "DELETE" });
  }, id);

test("the timeline draws the example", async ({ page }, info) => {
  const id = await makeExample(page, `Example ${info.project.name}`);
  await expect(page.locator(".tl-bar", { hasText: "The war" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tl-${info.project.name}.png` });
  await noSidewaysScroll(page);
  await remove(page, id);
});
