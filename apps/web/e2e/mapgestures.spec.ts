import { type CDPSession, expect, type Page, test } from "@playwright/test";
import { at } from "./helpers.ts";

/**
 * The gestures on a map that the other map tests do not make: pinches, second fingers, the tap
 * thresholds and buttons other than the primary one. Touch goes through Chromium's own touch
 * input, since Playwright's touchscreen has one finger.
 */

const IMAGE = "99 Appendices/Images/map one.png";

type Point = { x: number; y: number };

const plus = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });

const makeMap = (page: Page, title: string) =>
  page.evaluate(
    async ({ title, image }) => {
      const res = await fetch("/api/maps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, kind: "sphere", image }),
      });
      return ((await res.json()) as { id: string }).id;
    },
    { title, image: IMAGE },
  );

/** Throws the map away, so the next test finds nothing unpublished. */
const cleanUp = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    await fetch(`/api/maps/${id}`, { method: "DELETE" });
    const un = await (await fetch("/api/unpublished")).json();
    for (const d of un.drafts) await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
  }, id);

/** Opens a new globe of the sample image, editing or not, once its view is laid out. */
async function openMap(page: Page, title: string, edit = false) {
  await page.goto(at("/maps"));
  const id = await makeMap(page, title);
  await page.goto(at(`/map/${id}${edit ? "?edit=1" : ""}`));
  await expect(page.locator(".map-top")).toBeVisible();
  await expect(page).toHaveURL(/v=/);
  return id;
}

/** The middle of the map's canvas, in page coordinates. */
async function centre(page: Page): Promise<Point> {
  const box = (await page.locator(".map-top").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * The view in the address, as its parts. The maps here are globes, since the sample image is one
 * pixel: a globe's view is `g,lon,lat,k`, a projection's `x,name,λ,φ,γ,k,x,y`.
 */
const viewOf = (page: Page) =>
  decodeURIComponent(new URL(page.url()).searchParams.get("v") ?? "").split(",");
const scaleOf = (page: Page) => {
  const v = viewOf(page);
  return Number(v[0] === "x" ? v[5] : v[3]);
};
const placeOf = (page: Page) => viewOf(page).slice(1, 3).join(",");

type Stored = { features: { kind: string; points?: [number, number][] }[] };

/** The open map as the server has it. */
const stored = (page: Page) =>
  page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    return ((await (await fetch(`/api/maps/${id}`)).json()) as { map: Stored }).map;
  });
const zonePoints = async (page: Page) =>
  (await stored(page)).features.find((f) => f.kind === "zone")?.points ?? [];

/**
 * Places a marker at a distance from the middle of the map while editing, then stops editing with
 * nothing selected. The frame grows when the tools go away and the globe stays in its middle, so
 * the marker's place on the page is returned.
 */
async function placeMarker(page: Page, dx: number, dy: number): Promise<Point> {
  const at = plus(await centre(page), dx, dy);
  await page.getByRole("button", { name: "Marker", exact: true }).click();
  // The marker tool's hint: for a mouse, or for a finger.
  await expect(
    page.locator(".map-hint", {
      hasText: /Click where each marker goes|Tap where the marker goes/,
    }),
  ).toBeVisible();
  await page.mouse.click(at.x, at.y);
  await expect(page.locator(".feature-editor")).toBeVisible();
  await expect(page.locator(".save-saved")).toBeVisible();
  await page.locator(".feature-editor .card-close").click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".map-tools")).toHaveCount(0);
  await expect(page.locator(".feature-card")).toHaveCount(0);
  return plus(await centre(page), dx, dy);
}

/** Draws a zone through three points while editing; it is left selected. */
async function drawZone(page: Page, corners: Point[]) {
  await page.getByRole("button", { name: "Zone", exact: true }).click();
  await expect(
    page.locator(".map-hint", { hasText: /Click to add points|Tap to add points/ }),
  ).toBeVisible();
  for (const p of corners) await page.mouse.click(p.x, p.y);
  // A tap on the last point finishes the shape.
  await page.mouse.click(corners.at(-1)!.x, corners.at(-1)!.y);
  await expect(page.locator(".feature-editor")).toBeVisible();
  await expect.poll(async () => (await zonePoints(page)).length).toBe(3);
}

/**
 * Fingers on the screen. A start or a move sends every finger that is down, as a touch screen
 * does; Chromium releases only the fingers an end names, so one can be lifted while others stay.
 */
class Fingers {
  private down = new Map<number, Point>();
  private constructor(private cdp: CDPSession) {}

  static async on(page: Page) {
    return new Fingers(await page.context().newCDPSession(page));
  }

  private send(type: "touchStart" | "touchMove" | "touchEnd", ids = [...this.down.keys()]) {
    const touchPoints = ids.map((id) => ({ id, ...this.down.get(id)! }));
    return this.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  }

  async press(id: number, at: Point) {
    this.down.set(id, at);
    await this.send("touchStart");
  }

  /** Moves one finger in even steps, so the page sees the way it went. */
  async move(id: number, to: Point, steps = 5) {
    const from = this.down.get(id)!;
    for (let i = 1; i <= steps; i++) {
      this.down.set(id, {
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
      });
      await this.send("touchMove");
    }
  }

  /** Lifts one finger; the others stay where they are. */
  async lift(id: number) {
    await this.send("touchEnd", [id]);
    this.down.delete(id);
  }
}

test.describe("touch", () => {
  test("a pinch zooms the map", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "Needs touch");
    const id = await openMap(page, `Pinched ${info.project.name}`);
    const c = await centre(page);
    const k = scaleOf(page);
    const fingers = await Fingers.on(page);
    await fingers.press(1, plus(c, -30, -60));
    await fingers.press(2, plus(c, 30, -60));
    await fingers.move(1, plus(c, -110, -60));
    await fingers.move(2, plus(c, 110, -60));
    await fingers.lift(2);
    await fingers.lift(1);
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(k * 2);
    await cleanUp(page, id);
  });

  test("a second finger during the focus box cancels it, and focusing stays on", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "phone", "Needs touch");
    const id = await openMap(page, `Boxed ${info.project.name}`);
    await page.getByLabel("View").selectOption("robinson");
    await expect(page).toHaveURL(/v=x%2Crobinson|v=x,robinson/);
    await page.getByRole("button", { name: "Turn" }).click();
    await page.getByRole("button", { name: "Focus on a region" }).click();
    await page.locator(".turn-panel").getByRole("button", { name: "Close" }).click();
    const hint = page.locator(".map-hint", { hasText: "Drag a box around the place" });
    await expect(hint).toBeVisible();
    const k = scaleOf(page);

    const m = await centre(page);
    const fingers = await Fingers.on(page);
    await fingers.press(1, plus(m, -40, -30));
    await fingers.move(1, plus(m, 10, 5));
    await expect(page.locator(".focus-box")).toBeVisible();
    await fingers.press(2, plus(m, 60, 60));
    await expect(page.locator(".focus-box")).toHaveCount(0);
    await fingers.move(1, plus(m, 40, 30));
    await fingers.move(2, plus(m, 90, 90));
    await fingers.lift(2);
    await fingers.lift(1);
    await expect(page.locator(".focus-box")).toHaveCount(0);
    await expect(hint).toBeVisible();
    await page.waitForTimeout(300);
    expect(scaleOf(page)).toBe(k);

    // Focusing is still on: the next box focuses.
    await fingers.press(1, plus(m, -40, -30));
    await fingers.move(1, plus(m, 40, 30));
    await fingers.lift(1);
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(k * 2);
    await expect(hint).toHaveCount(0);
    await cleanUp(page, id);
  });

  test("a touch drag of a corner of the selected zone moves it, and one Undo puts it back", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "phone", "Needs touch");
    const id = await openMap(page, `Cornered ${info.project.name}`, true);
    const c = await centre(page);
    const corners = [plus(c, -60, -90), plus(c, 60, -90), plus(c, 0, -30)];
    await drawZone(page, corners);
    const before = await zonePoints(page);

    const fingers = await Fingers.on(page);
    await fingers.press(1, corners[0]!);
    await fingers.move(1, plus(corners[0]!, -30, -30));
    await fingers.lift(1);
    await expect.poll(async () => (await zonePoints(page))[0]).not.toEqual(before[0]);
    const after = await zonePoints(page);
    expect(after[0]![0]).toBeLessThan(before[0]![0]);
    expect(after.slice(1)).toEqual(before.slice(1));

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => zonePoints(page)).toEqual(before);
    await cleanUp(page, id);
  });

  test("a touch moved 9 px taps, and 11 px pans", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "Needs touch");
    const id = await openMap(page, `Tapped ${info.project.name}`, true);
    const marker = await placeMarker(page, 0, -60);
    const place = placeOf(page);
    const fingers = await Fingers.on(page);

    await fingers.press(1, marker);
    await fingers.move(1, plus(marker, 9, 0));
    await fingers.lift(1);
    await expect(page.locator(".feature-card")).toBeVisible();
    expect(placeOf(page)).toBe(place);
    await page.locator(".feature-card .card-close").click();
    await expect(page.locator(".feature-card")).toHaveCount(0);

    await fingers.press(1, marker);
    await fingers.move(1, plus(marker, 11, 0));
    await fingers.lift(1);
    await expect.poll(() => placeOf(page)).not.toBe(place);
    await expect(page.locator(".feature-card")).toHaveCount(0);
    await cleanUp(page, id);
  });

  test("a second finger during a corner drag becomes a pinch, and the drag so far is one undo step", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "phone", "Needs touch");
    const id = await openMap(page, `Dragged ${info.project.name}`, true);
    const c = await centre(page);
    const corners = [plus(c, -60, -90), plus(c, 60, -90), plus(c, 0, -30)];
    await drawZone(page, corners);
    const before = await zonePoints(page);
    const k = scaleOf(page);

    const fingers = await Fingers.on(page);
    await fingers.press(1, corners[0]!);
    await fingers.move(1, plus(corners[0]!, -30, 0));
    await expect.poll(async () => (await zonePoints(page))[0]).not.toEqual(before[0]);
    const dragged = (await zonePoints(page))[0];
    // The second finger pinches; the first no longer drags the corner.
    await fingers.press(2, plus(c, 40, -60));
    await fingers.move(2, plus(c, 120, -60));
    await fingers.move(1, plus(corners[0]!, -60, 0));
    await fingers.lift(2);
    await fingers.lift(1);
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(k);
    await expect(page.locator(".save-saved")).toBeVisible();
    expect((await zonePoints(page))[0]).toEqual(dragged);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => zonePoints(page)).toEqual(before);
    await cleanUp(page, id);
  });

  test("a second finger during a pan becomes a pinch", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "Needs touch");
    const id = await openMap(page, `Panned ${info.project.name}`);
    const c = await centre(page);
    const place = placeOf(page);
    const k = scaleOf(page);
    const fingers = await Fingers.on(page);
    await fingers.press(1, plus(c, -40, -60));
    await fingers.move(1, plus(c, -40, -20));
    await expect.poll(() => placeOf(page)).not.toBe(place);
    await fingers.press(2, plus(c, 40, -20));
    await fingers.move(2, plus(c, 120, -20));
    await fingers.lift(2);
    await fingers.lift(1);
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(k * 1.5);
    await cleanUp(page, id);
  });

  test("one finger left after a pinch pans, and never taps", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "Needs touch");
    const id = await openMap(page, `Lifted ${info.project.name}`, true);
    const marker = await placeMarker(page, 0, 0);
    const c = await centre(page);
    const fingers = await Fingers.on(page);
    const k0 = scaleOf(page);
    await fingers.press(1, marker);
    await fingers.press(2, plus(marker, 60, -40));
    await fingers.move(2, plus(marker, 120, -80));
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(k0);
    await fingers.lift(2);
    await page.waitForTimeout(100);
    await fingers.lift(1);
    await page.waitForTimeout(300);
    await expect(page.locator(".feature-card")).toHaveCount(0);
    // A pinch also pans by its middle (from release 13c), so the marker has moved with the map. A
    // plain tap where it now is selects it, so the lifted finger would have found it.
    const [, lon0, lat0, k1] = viewOf(page).map(Number);
    const box = (await page.locator(".map-top").boundingBox())!;
    const at = ((await stored(page)).features.find((f) => f.kind === "marker") as { at: number[] })
      .at;
    const r = Math.PI / 180;
    const [l, f, f0] = [(at[0]! - lon0!) * r, at[1]! * r, lat0! * r];
    const now = {
      x: box.x + box.width / 2 + k1! * Math.cos(f) * Math.sin(l),
      y:
        box.y +
        box.height / 2 -
        k1! * (Math.cos(f0) * Math.sin(f) - Math.sin(f0) * Math.cos(f) * Math.cos(l)),
    };
    await fingers.press(1, now);
    await fingers.lift(1);
    await expect(page.locator(".feature-card")).toBeVisible();
    await page.locator(".feature-card .card-close").click();
    await expect(page.locator(".feature-card")).toHaveCount(0);

    // Lifting one finger and moving the other pans.
    const place = placeOf(page);
    const k = scaleOf(page);
    await fingers.press(1, plus(c, -40, -40));
    await fingers.press(2, plus(c, 40, -40));
    await fingers.lift(2);
    await fingers.move(1, plus(c, -40, 0));
    await fingers.lift(1);
    await expect.poll(() => placeOf(page)).not.toBe(place);
    expect(scaleOf(page)).toBe(k);
    await expect(page.locator(".feature-card")).toHaveCount(0);
    await cleanUp(page, id);
  });
});

test.describe("mouse", () => {
  test("a mouse moved 5 px taps, and 7 px pans", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "Needs a mouse");
    const id = await openMap(page, `Clicked ${info.project.name}`, true);
    const c = await placeMarker(page, 0, 0);
    const place = placeOf(page);

    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 5, c.y, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator(".feature-card")).toBeVisible();
    expect(placeOf(page)).toBe(place);
    await page.locator(".feature-card .card-close").click();
    await expect(page.locator(".feature-card")).toHaveCount(0);

    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 7, c.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => placeOf(page)).not.toBe(place);
    await expect(page.locator(".feature-card")).toHaveCount(0);
    await cleanUp(page, id);
  });

  // The primary button starts a gesture and the middle one pans (from release 13c); the right
  // one is left to the menu.
  test("a right-button press and drag neither pans nor selects; the middle button pans", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop", "Needs a mouse");
    const id = await openMap(page, `Buttons ${info.project.name}`, true);
    const c = await placeMarker(page, 0, 0);
    const place = placeOf(page);

    await page.mouse.move(c.x, c.y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(c.x + 40, c.y + 30, { steps: 5 });
    await page.mouse.up({ button: "right" });
    await page.keyboard.press("Escape");
    // And held still, it is no tap either; nor is the middle button held still.
    for (const button of ["right", "middle"] as const) {
      await page.mouse.move(c.x, c.y);
      await page.mouse.down({ button });
      await page.mouse.up({ button });
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(500);
    expect(placeOf(page)).toBe(place);
    await expect(page.locator(".feature-card")).toHaveCount(0);

    // The middle button pans, even from the marker.
    await page.mouse.move(c.x, c.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(c.x + 40, c.y + 30, { steps: 5 });
    await page.mouse.up({ button: "middle" });
    await expect.poll(() => placeOf(page)).not.toBe(place);
    await expect(page.locator(".feature-card")).toHaveCount(0);
    await cleanUp(page, id);
  });
});
