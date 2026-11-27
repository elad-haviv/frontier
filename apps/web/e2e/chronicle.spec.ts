import { expect, type Page, test } from "@playwright/test";
import { noSidewaysScroll, proj } from "./helpers.ts";

const SHOTS = process.env.CH_SHOTS;

/** Makes a chronicle through the API with the stage 17 example, and opens it. */
async function makeExample(page: Page, title: string) {
  await page.goto(proj("/chronicles"));
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
  await page.goto(proj(`/chronicle/${id}`));
  await expect(page.locator(".ch-bar h1")).toHaveText(title);
  return id;
}

/** Throws chronicles and maps away, and every draft, so the next test finds nothing unsaved. */
const cleanUp = (page: Page, chronicles: string[], maps: string[] = []) =>
  page.evaluate(
    async ({ chronicles, maps }) => {
      for (const id of maps) await fetch(`/api/maps/${id}`, { method: "DELETE" });
      for (const id of chronicles) await fetch(`/api/chronicles/${id}`, { method: "DELETE" });
      const un = await (await fetch("/api/unpublished")).json();
      for (const d of un.drafts) await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
    },
    { chronicles, maps },
  );

const here = (page: Page) => page.url().split("/chronicle/")[1]!.split("?")[0]!;

/** The chronicle as the server holds it now, once the page has saved. */
async function stored(page: Page) {
  await expect(page.locator(".ch-saving")).toHaveText("Saved as a draft");
  return page.evaluate(async (id) => {
    const r = await (await fetch(`/api/chronicles/${id}`)).json();
    return r.chronicle as {
      origin: string | null;
      spans: {
        id: string;
        name: string;
        lane: string;
        start: { low: number; high: number } | "open" | null;
        end: { low: number; high: number } | "open" | null;
        length: { low: number; high: number } | null;
        startFrom?: { span: string; edge: string; plus: { low: number; high: number } };
        entry: string | null;
        note: string;
      }[];
    };
  }, here(page));
}

const details = (page: Page) => page.locator(".ch-details");
const bar = (page: Page, name: string) =>
  page.locator(`[data-bar][aria-label^="${name},"]`).first();
const when = (page: Page, name: string) =>
  page.locator(".tl-cell", { hasText: name }).locator(".tl-when");

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Selects an event: its row on a desktop, its bar on a phone. */
async function open(page: Page, name: string, phone: boolean) {
  if (phone) await bar(page, name).click();
  else await page.locator(".tl-cell", { hasText: name }).locator(".tl-name").click();
  await expect(details(page).locator("h2")).toHaveText(name);
}

/** Types into one of the details' date boxes and leaves it. */
async function typeIn(page: Page, label: string, text: string) {
  const box = details(page).getByLabel(label, { exact: true });
  await box.fill(text);
  await box.press("Enter");
}

async function addEvent(
  page: Page,
  phone: boolean,
  name: string,
  more: { starts?: string; ends?: string; group?: string; moment?: boolean } = {},
) {
  if (phone) {
    if (await details(page).isVisible())
      await details(page).getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Add an event" }).click();
  } else await page.getByRole("button", { name: "+ Add", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name or entry").fill(name);
  if (more.moment) await dialog.getByLabel("A single moment").check();
  if (more.starts) await dialog.getByLabel(more.moment ? "When" : "Starts").fill(more.starts);
  if (more.ends) await dialog.getByLabel("Ends").fill(more.ends);
  if (more.group) await dialog.getByLabel("Group").selectOption({ label: more.group });
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(details(page).locator("h2")).toHaveText(name);
}

async function moreMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("CUJ 14 on the timeline: what is too quick and what is too slow", async ({ page }, info) => {
  const phone = info.project.name === "phone";
  if (phone) await page.setViewportSize({ width: 375, height: 740 });
  const title = `Ezob trial ${info.project.name}`;
  await page.goto(proj("/chronicles"));
  await page.locator(".new-map input[type=text]").fill(title);
  await page.getByRole("button", { name: "Make the chronicle" }).click();
  await expect(page.locator(".ch-bar h1")).toHaveText(title);
  await expect(page.locator(".ch-start")).toContainText("Lay out a history");
  await noSidewaysScroll(page);

  // The author's unit, and a second group.
  await moreMenu(page, "Units…");
  await page.getByLabel("New unit").fill("generation");
  await page.getByLabel("Lowest years", { exact: true }).fill("20");
  await page.getByLabel("Highest years", { exact: true }).fill("35");
  await page.getByRole("button", { name: "Add the unit" }).click();
  await expect(page.getByLabel("Unit name")).toHaveValue("generation");
  await page.getByRole("button", { name: "Done" }).click();
  await moreMenu(page, "Add a group");
  await page.getByRole("dialog").getByRole("textbox").fill("Nirani");
  await page.getByRole("dialog").getByRole("button", { name: "Add" }).click();

  await addEvent(page, phone, "First Landing", { moment: true, starts: "0" });
  // A tie and a length in the author's unit place the fading at once.
  await addEvent(page, phone, "Earth memory fades", { starts: "with First Landing" });
  await typeIn(page, "Lasts", "3-5 generations");
  await expect(details(page).getByLabel("Ends", { exact: true })).toHaveAttribute(
    "placeholder",
    "60–175 (worked out)",
  );
  await expect(bar(page, "Earth memory fades")).toContainText("⛓");
  await addEvent(page, phone, "Earth technology is lost");
  const rule = async (kind: string, other: string) => {
    await details(page).getByLabel("Rule").selectOption(kind);
    await details(page).getByLabel("The other event").selectOption({ label: other });
    await details(page).getByRole("button", { name: "Add the rule" }).click();
  };
  await rule("during", "Earth memory fades");
  await addEvent(page, phone, "Nirani presence", { group: "Nirani" });
  await rule("longer_than", "Earth memory fades");
  await typeIn(page, "Lasts", "about 400 years");
  await expect(details(page).locator(".dt-rule")).toContainText(
    "Nirani presence is longer than Earth memory fades",
  );
  await expect(details(page).locator(".dt-rule")).toHaveClass(/is-ok/);
  if (!phone) await expect(when(page, "Earth memory fades")).toHaveText("0 → 60–175");
  await shot(page, `cuj14-${info.project.name}`);
  await noSidewaysScroll(page);

  // Comparing lengths with real history is one menu away, unchanged inside.
  await details(page).getByRole("button", { name: "Close" }).click();
  await moreMenu(page, "Compare lengths with real history…");
  await page
    .locator(".ch-compare-add select")
    .first()
    .selectOption({ label: "Earth memory fades" });
  await expect(page.locator(".ch-bars li").first()).toContainText("60 to 175 years");
  await page.getByRole("button", { name: "Done" }).click();

  // The fading made much longer: the Nirani rule may not fit, and says which range decides.
  await open(page, "Earth memory fades", phone);
  await typeIn(page, "Lasts", "15-30 generations");
  await open(page, "Nirani presence", phone);
  await expect(details(page).locator(".dt-rule")).toHaveClass(/is-amber/);
  await expect(details(page).locator(".dt-rule")).toContainText(
    "Nirani presence is longer than Earth memory fades only if",
  );

  // Undo takes it back (Ctrl+Z on a desktop).
  await details(page).getByRole("button", { name: "Close" }).click();
  if (phone) {
    await moreMenu(page, "Undo");
  } else {
    await page.getByRole("button", { name: "Undo" }).click();
  }
  await open(page, "Nirani presence", phone);
  await expect(details(page).locator(".dt-rule")).toHaveClass(/is-ok/);

  // A rule about an event that is deleted doesn't fit any more, and says so in the header.
  await open(page, "Earth memory fades", phone);
  await details(page).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: /doesn.t fit/ }).click();
  await expect(page.locator(".ch-fits")).toContainText("This names a span that was removed.");
  await page.keyboard.press("Escape");

  // Main: maps use this one.
  if (phone) await moreMenu(page, "Make main");
  else await page.getByRole("button", { name: "Make main" }).click();
  if (!phone) await expect(page.locator(".ch-pill.is-main")).toHaveText("★ Main · maps use this");
  await expect(page.locator(".ch-saving")).toHaveText("Saved as a draft");
  await cleanUp(page, [here(page)]);
});

test("moving, stretching and typing on the timeline; ties follow; a fix is one click", async ({
  page,
}, info) => {
  const phone = info.project.name === "phone";
  test.skip(phone, "Dragging with a mouse is a desktop thing; the phone holds and drags below.");
  const id = await makeExample(page, `Drag ${info.project.name}`);

  // The one-time offer turns "starts with" into a tie.
  await page.getByRole("button", { name: "Place them" }).click();
  await expect(when(page, "Earth memory fades")).toHaveText("0 → 60–175");
  await expect(page.getByRole("button", { name: "Place them" })).toBeHidden();

  // Typing a tie: the treaty comes 10 years after the war.
  await open(page, "The treaty", false);
  await typeIn(page, "When", "10 after The war");
  await expect(when(page, "The treaty")).toHaveText("310");

  // Drag the war 10 years later: it moves, and the treaty follows its tie.
  await page.getByRole("button", { name: "Years", exact: true }).click();
  await open(page, "The war", false);
  const box = (await bar(page, "The war").boundingBox())!;
  const perYear = 7;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 10 * perYear, box.y + box.height / 2, { steps: 4 });
  await expect(page.locator(".tl-drag-label")).toContainText("(+10 yrs)");
  await page.mouse.up();
  await expect(when(page, "The war")).toHaveText("280–300 → 310");
  await expect(when(page, "The treaty")).toHaveText("320");

  // Stretch its end by its handle.
  const after = (await bar(page, "The war").boundingBox())!;
  const grip = page.locator(".tl-bar.is-selected .tl-grip.is-end");
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 10, g.y + g.height / 2, { steps: 3 });
  await page.mouse.move(g.x + g.width / 2 + 5 * perYear, g.y + g.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect(when(page, "The war")).toHaveText("280–300 → 315");
  expect((await bar(page, "The war").boundingBox())!.x).toBeCloseTo(after.x, 0);

  // Keys: right moves by one step; undo takes it back.
  await bar(page, "The war").focus();
  await page.keyboard.press("ArrowRight");
  await expect(when(page, "The war")).toHaveText("281–301 → 316");
  await page.keyboard.press("Control+z");
  await expect(when(page, "The war")).toHaveText("280–300 → 315");

  // Typing in the When cell.
  await when(page, "The war").dblclick();
  await page.getByLabel("When: The war").fill("270-290 → 300");
  await page.getByLabel("When: The war").press("Enter");
  await expect(when(page, "The war")).toHaveText("270–290 → 300");
  await expect(when(page, "The treaty")).toHaveText("310");

  // Untie keeps the number.
  await open(page, "The treaty", false);
  await details(page).getByRole("button", { name: "⛓ Untie" }).click();
  await expect(details(page).getByLabel("When", { exact: true })).toHaveValue("310");

  // The kingdom ends too early: the war no longer fits inside it, and the fix is one click.
  await open(page, "The kingdom", false);
  await typeIn(page, "Ends", "250");
  await expect(page.getByRole("button", { name: "1 doesn't fit" })).toBeVisible();
  await expect(bar(page, "The war")).toHaveClass(/is-red/);
  await page.getByRole("button", { name: "1 doesn't fit" }).click();
  await page
    .locator(".ch-fits")
    .getByRole("button", { name: /^Move The war/ })
    .click();
  await expect(page.getByRole("button", { name: /doesn't fit/ })).toBeHidden();

  // A box with no dates is dragged onto the timeline.
  const adyni = (await bar(page, "The Adyni").boundingBox())!;
  await page.mouse.move(adyni.x + 20, adyni.y + adyni.height / 2);
  await page.mouse.down();
  await page.mouse.move(adyni.x + 40, adyni.y + adyni.height / 2, { steps: 3 });
  await page.mouse.move(adyni.x + 120, adyni.y + adyni.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect(when(page, "The Adyni")).not.toHaveText("No dates yet");

  // The blue line is the year the maps show; its flag drags it, and the address keeps it.
  await page.getByRole("button", { name: "Years", exact: true }).click();
  const flag = (await page.locator(".tl-mapflag").boundingBox())!;
  await page.mouse.move(flag.x + 4, flag.y + flag.height / 2);
  await page.mouse.down();
  await page.mouse.move(flag.x + 24, flag.y + flag.height / 2, { steps: 3 });
  await page.mouse.move(flag.x + 4 + 10 * perYear, flag.y + flag.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator(".tl-mapflag")).toHaveText("Maps: 10");
  await expect(page).toHaveURL(/t=10/);

  // The List view reads it in order, by century, with the map year between.
  await page.getByRole("button", { name: "List", exact: true }).click();
  const list = page.locator(".ch-listview");
  await expect(list.locator("h3").first()).toHaveText("Older than anything shown");
  await expect(list).toContainText("Year 300 to 399");
  await expect(list.locator(".ch-list-mapyear")).toContainText("Maps: year 10");
  await list.getByRole("button", { name: /The war/ }).click();
  await expect(details(page).locator("h2")).toHaveText("The war");
  await shot(page, "list-desktop");
  const saved = await stored(page);
  expect(saved.spans.find((s) => s.name === "Earth memory fades")!.startFrom).toMatchObject({
    span: "landing1",
    edge: "start",
  });
  await cleanUp(page, [id]);
});

test("on a phone: press and hold to move a bar, the sheet, and the list", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "Touch only");
  await page.setViewportSize({ width: 375, height: 740 });
  const id = await makeExample(page, `Touch ${info.project.name}`);
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Yrs", exact: true }).click();
  await bar(page, "The war").scrollIntoViewIfNeeded();
  // Only the timeline scrolls: the page around it, with its header, stays put.
  const scrolled = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .filter((e) => (e.scrollTop > 0 || e.scrollLeft > 0) && !e.closest(".tl-scroll"))
        .map((e) => `${e.tagName}.${e.className}`),
    );
  expect(await scrolled()).toEqual([]);

  // A tap selects and opens the sheet; the bar stays in sight above it.
  await bar(page, "The war").tap();
  await expect(details(page).locator("h2")).toHaveText("The war");
  const sheet = (await details(page).boundingBox())!;
  const before = (await bar(page, "The war").boundingBox())!;
  expect(before.y + before.height).toBeLessThanOrEqual(sheet.y);
  await expect(details(page).getByLabel("Starts", { exact: true })).toHaveValue("270–290");
  await shot(page, "sheet-phone");
  expect(await scrolled()).toEqual([]);
  await expect(page.locator(".ch-bar h1")).toBeInViewport();

  // A swipe pans and moves nothing; a press and hold then a drag moves the bar.
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type: string, x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  const x = before.x + before.width / 2;
  const y = before.y + before.height / 2;
  await touch("touchStart", x, y);
  await page.waitForTimeout(500);
  for (let i = 1; i <= 5; i++) await touch("touchMove", x + i * 14, y);
  await touch("touchEnd", x + 70, y);
  const saved = await stored(page);
  const war = saved.spans.find((s) => s.name === "The war")!;
  expect(war.start).toMatchObject({ low: 280, high: 300 });
  await noSidewaysScroll(page);

  // The list is the way to read it on a phone.
  await details(page).getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".ch-listview")).toContainText("Year 200 to 299");
  await page
    .locator(".ch-listview")
    .getByRole("button", { name: /The treaty/ })
    .click();
  await expect(details(page).locator("h2")).toHaveText("The treaty");
  await shot(page, "list-phone");
  await noSidewaysScroll(page);
  await cleanUp(page, [id]);
});

test("the map and the timeline open each other at the same year", async ({ page }, info) => {
  const phone = info.project.name === "phone";
  if (phone) await page.setViewportSize({ width: 375, height: 740 });
  const id = await makeExample(page, `Bridge ${info.project.name}`);
  const map = await page.evaluate(async (title) => {
    const json = { "content-type": "application/json" };
    const made = await fetch("/api/maps", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ title, kind: "flat", image: "99 Appendices/Images/map one.png" }),
    });
    const { id } = (await made.json()) as { id: string };
    const loaded = await (await fetch(`/api/maps/${id}`)).json();
    const m = loaded.map;
    m.features = [
      {
        id: "fort0001",
        kind: "marker",
        layer: m.layers[0].id,
        at: [10, 10],
        entry: null,
        label: "Fort",
        child: null,
        span: "war00001",
        icon: null,
      },
    ];
    await fetch(`/api/maps/${id}`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ map: m, revision: loaded.revision, baseBlob: loaded.blob }),
    });
    return id;
  }, `Bridge map ${info.project.name}`);

  await page.goto(proj(`/map/${map}?t=290&c=${id}`));
  await page.getByRole("link", { name: "Open timeline ↗" }).click();
  await expect(page.locator(".ch-bar h1")).toHaveText(`Bridge ${info.project.name}`);
  await expect(page.locator(".tl-mapflag")).toHaveText("Maps: 290");
  await expect(bar(page, "The war")).toContainText("🗺");
  await open(page, "The war", phone);
  await expect(details(page).locator(".dt-maps")).toContainText(
    `Bridge map ${info.project.name} · 1 feature follows this`,
  );
  // And back: the map opens at the line's year with this chronicle.
  if (phone) await moreMenu(page, `🗺 Open Bridge map ${info.project.name} at 290`);
  else {
    // The sample library has maps of its own, so the button is a short menu of them.
    await page.getByRole("button", { name: "Open a map at the map year" }).click();
    await page.getByRole("menuitem", { name: `Bridge map ${info.project.name}` }).click();
  }
  await expect(page).toHaveURL(new RegExp(`/map/${map}\\?.*t=290`));
  await expect(page).toHaveURL(new RegExp(`c=${id}`));
  await cleanUp(page, [id], [map]);
});

test("CUJ 15: a copy with one event moved, shown underneath the original", async ({
  page,
}, info) => {
  const phone = info.project.name === "phone";
  if (phone) await page.setViewportSize({ width: 375, height: 740 });
  const id = await makeExample(page, `Versions ${info.project.name}`);
  await page.getByRole("button", { name: "Not now" }).click();
  await moreMenu(page, "Copy, to try another version");
  await expect(page.locator(".ch-bar h1")).toHaveText(`Copy of Versions ${info.project.name}`);
  const copy = here(page);
  await open(page, "The war", phone);
  await typeIn(page, "Starts", "-230 to -210");
  await typeIn(page, "Ends", "-200");
  await expect(page.getByRole("button", { name: "1 doesn't fit" })).toBeVisible();
  await details(page).getByRole("button", { name: "Close" }).click();
  await moreMenu(page, "Show another version underneath…");
  await page
    .getByLabel("Show underneath:")
    .selectOption({ label: `Versions ${info.project.name}` });
  await expect(page.locator(".ch-under-note")).toContainText(`Versions ${info.project.name}`);
  await expect(page.locator(".tl-ghost.is-differs")).toHaveCount(1);
  await expect(page.locator(".tl-ghost").first()).toBeAttached();
  await shot(page, `versions-${info.project.name}`);
  await noSidewaysScroll(page);
  await expect(page.locator(".ch-saving")).toHaveText("Saved as a draft");
  await cleanUp(page, [copy, id]);
});

test("an event added by an entry's name is linked, and the entry lists the chronicle", async ({
  page,
}, info) => {
  const phone = info.project.name === "phone";
  if (phone) await page.setViewportSize({ width: 375, height: 740 });
  const title = `Linked ${info.project.name}`;
  await page.goto(proj("/chronicles"));
  await page.locator(".new-map input[type=text]").fill(title);
  await page.getByRole("button", { name: "Make the chronicle" }).click();

  if (phone) await page.getByRole("button", { name: "Add an event" }).click();
  else await page.getByRole("button", { name: "+ Add", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name or entry").fill("Mira");
  await dialog.getByRole("button", { name: /Mira/ }).first().click();
  await expect(dialog).toContainText("Linked to the entry Mira.");
  await dialog.getByLabel("Starts").fill("0");
  await dialog.getByLabel("Ends").fill("80");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  const entry = details(page).locator(".dt-entry");
  await expect(entry.getByRole("link", { name: "Mira" })).toBeVisible();
  await expect(page.locator(".ch-saving")).toHaveText("Saved as a draft");
  await expect(entry).not.toContainText("linking");
  await expect(bar(page, "Mira")).toContainText("📖");

  // From the entry back to its event.
  await entry.getByRole("link", { name: "Mira" }).click();
  await expect(page).toHaveURL(/\/e\//);
  await page.locator(".on-maps").getByRole("link", { name: title }).click();
  await expect(details(page).locator("h2")).toHaveText("Mira");

  // Unlinking takes the chronicle off the entry.
  await details(page).locator(".dt-entry").getByRole("button", { name: "Unlink" }).click();
  await expect(details(page).locator(".dt-entry")).toContainText("Link it to the entry");
  await expect(page.locator(".ch-saving")).toHaveText("Saved as a draft");
  await cleanUp(page, [here(page)]);
});

test("typing in an event while its link is being saved keeps both the link and the words", async ({
  page,
}, info) => {
  const phone = info.project.name === "phone";
  if (phone) await page.setViewportSize({ width: 375, height: 740 });
  await page.goto(proj("/chronicles"));
  await page.locator(".new-map input[type=text]").fill(`Slow link ${info.project.name}`);
  await page.getByRole("button", { name: "Make the chronicle" }).click();
  await addEvent(page, phone, "Shade's years");
  await expect(page.locator(".ch-saving")).toHaveText("Saved as a draft");

  // Saves that carry a link are held for a moment, as on a slow connection.
  let held = 0;
  await page.route("**/api/p/*/chronicles/*", async (route) => {
    const body = route.request().postData() ?? "";
    if (route.request().method() === "PUT" && body.includes('"link":[{')) {
      held += 1;
      await new Promise((r) => setTimeout(r, 2500));
    }
    await route.continue();
  });

  const entry = details(page).locator(".dt-entry");
  await entry.getByLabel("Find an entry").fill("Shade");
  await entry.locator(".entry-picker li button", { hasText: "Shade" }).first().click();
  await expect(page.locator(".ch-saving")).toHaveText("Saving…");
  await expect.poll(() => held).toBe(1);
  // While the link is on its way, a note is typed into the same event.
  await details(page).getByLabel("Note").fill("Written during the save");
  await expect(page.locator(".ch-saving")).toHaveText("Saved as a draft", { timeout: 15_000 });
  await page.unroute("**/api/p/*/chronicles/*");

  const saved = await stored(page);
  expect(saved.spans[0]!.note).toBe("Written during the save");
  expect(saved.spans[0]!.entry).toMatch(/^[a-z0-9]{8}$/);
  await expect(entry.getByRole("link", { name: "Shade" })).toBeVisible();
  await cleanUp(page, [here(page)]);
});
