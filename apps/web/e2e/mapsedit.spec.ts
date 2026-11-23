import { type CDPSession, expect, type Page, test } from "@playwright/test";
import { midpointOn, outline, type Position } from "@frontier/geo";
import { newMapInForm, pickEntry } from "./helpers.ts";

/**
 * The editing tools of stage 13c: the line to the cursor while drawing, curves, the "+" handles,
 * dragging the selected zone, the entry and map comboboxes, and the image dialog for maps.
 */

const IMAGE = "99 Appendices/Images/map one.png";
const PICTURES = Number(process.env.E2E_PORT ?? 3987) + 100;
const SPHERE = { kind: "sphere", radius: null, unit: "km" } as const;

type Point = { x: number; y: number };
type Feature = {
  id: string;
  kind: string;
  curve?: string;
  entry: string | null;
  child: string | null;
  at?: Position;
  points?: Position[];
  shapes?: { id: string; from: string; points?: Position[] }[];
};
type Stored = {
  space: { kind: string; width: number; height: number };
  images: { name: string }[];
  features: Feature[];
};

/** Makes a map through the API, with these features, and returns its id. */
const makeMap = (page: Page, title: string, kind: "sphere" | "flat", features: unknown[] = []) =>
  page.evaluate(
    async ({ title, kind, image, features }) => {
      const json = { "content-type": "application/json" };
      const made = await fetch("/api/maps", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ title, kind, image }),
      });
      const { id } = (await made.json()) as { id: string };
      if (features.length === 0) return id;
      const loaded = await (await fetch(`/api/maps/${id}`)).json();
      const map = loaded.map;
      const layer = map.layers[0].id;
      map.features = (features as Record<string, unknown>[]).map((f) => ({
        layer,
        entry: null,
        label: null,
        child: null,
        ...f,
      }));
      await fetch(`/api/maps/${id}`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ map, revision: loaded.revision, baseBlob: loaded.blob }),
      });
      return id;
    },
    { title, kind, image: IMAGE, features },
  );

/** Throws maps and chronicles away, so the next test finds nothing unpublished. */
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

const stored = (page: Page) =>
  page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    return ((await (await fetch(`/api/maps/${id}`)).json()) as { map: Stored }).map;
  });
const featureOf = async (page: Page, id: string) =>
  (await stored(page)).features.find((f) => f.id === id);

const viewOf = (page: Page) =>
  decodeURIComponent(new URL(page.url()).searchParams.get("v") ?? "").split(",");

async function frameBox(page: Page) {
  // A side-bar tab that just opened or closed changes the frame; the map follows on the next draw.
  await page.waitForTimeout(150);
  return (await page.locator(".map-top").boundingBox())!;
}

/** Where a position is on the page, on a globe seen as a ball centred on 0, 0. */
async function onGlobe(page: Page, [lon, lat]: Position): Promise<Point> {
  const box = await frameBox(page);
  const k = Number(viewOf(page)[3]);
  const r = Math.PI / 180;
  return {
    x: box.x + box.width / 2 + k * Math.cos(lat * r) * Math.sin(lon * r),
    y: box.y + box.height / 2 - k * Math.sin(lat * r),
  };
}

/** Where a position is on the page, on a flat map, from the view in the address. */
async function onFlat(page: Page, [x, y]: Position): Promise<Point> {
  const box = await frameBox(page);
  const [, vx, vy, k] = viewOf(page).map(Number);
  return {
    x: box.x + box.width / 2 + (x - vx!) * k!,
    y: box.y + box.height / 2 + (y - vy!) * k!,
  };
}

async function open(page: Page, id: string, query = "edit=1") {
  await page.goto(`/map/${id}?${query}`);
  await expect(page.locator(".map-top")).toBeVisible();
  await expect(page).toHaveURL(/v=/);
  await page.waitForTimeout(300);
}

const pressed = (page: Page, name: string) =>
  expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
const cursor = (page: Page) =>
  page.locator(".map-top").evaluate((el) => getComputedStyle(el).cursor);
const near = (a: Position, b: Position, by = 1e-6) =>
  Math.abs(a[0] - b[0]) < by && Math.abs(a[1] - b[1]) < by;

/** Drags the mouse from one point to another in steps, with a button held. */
async function drag(page: Page, from: Point, to: Point, button: "left" | "middle" = "left") {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up({ button });
}

/** A chronicle of the kingdom and its treaty in the year 300, not the main one; its id. */
async function makeChronicle(page: Page, title: string) {
  return page.evaluate(async (title) => {
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
      span("kingdom1", "The kingdom", { start: { words: "", low: 0, high: 0 } }),
      span("treaty01", "The treaty", { point: true, start: { words: "", low: 300, high: 300 } }),
    ];
    await fetch(`/api/chronicles/${made.id}`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ chronicle, revision }),
    });
    return made.id as string;
  }, title);
}

test.describe("with a mouse", () => {
  test.beforeEach(async ({ page }, info) => {
    void page;
    test.skip(info.project.name !== "desktop", "Needs a mouse");
  });

  test("CUJ 2: draws a curved river with the line to the cursor, then refines it", async ({
    page,
  }) => {
    await page.goto("/maps");
    const id = await makeMap(page, "Curved river", "sphere");
    await open(page, id);
    // A press on the map gives it the focus, so the keys act on it.
    const empty = await onGlobe(page, [-60, 45]);
    await page.mouse.click(empty.x, empty.y);
    await page.keyboard.press("p");
    await pressed(page, "Path");
    const hint = page.locator(".map-hint");
    await expect(hint).toContainText(
      "Click to add points · Double-click or Enter to finish · Esc to cancel",
    );
    await expect(hint.getByRole("button", { name: "Finish path" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await hint.getByRole("button", { name: "Curved" }).click();
    await expect(hint.getByRole("button", { name: "Curved" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const river: Position[] = [
      [-40, 0],
      [-20, 15],
      [0, 0],
      [20, -15],
      [40, 0],
    ];
    const at = await Promise.all(river.map((p) => onGlobe(page, p)));
    const frame = page.locator(".map-frame");
    for (const p of at) {
      await page.mouse.move(p.x, p.y, { steps: 4 });
      await page.mouse.click(p.x, p.y);
    }
    // The line follows the cursor: the frame changes as the mouse moves, with nothing clicked.
    await page.mouse.move(at[4]!.x + 30, at[4]!.y + 60, { steps: 4 });
    await page.waitForTimeout(100);
    const before = await frame.screenshot();
    await page.mouse.move(at[4]!.x + 60, at[4]!.y - 40, { steps: 4 });
    await page.waitForTimeout(100);
    expect((await frame.screenshot()).equals(before)).toBe(false);

    // Backspace takes the last point back; a double-click puts one there and finishes.
    await page.keyboard.press("Backspace");
    await page.mouse.dblclick(at[4]!.x, at[4]!.y);
    await pressed(page, "Select");
    await expect(page.locator(".feature-editor")).toBeVisible();
    await expect
      .poll(async () => (await stored(page)).features.find((f) => f.kind === "path")?.points)
      .toHaveLength(5);
    const path = (await stored(page)).features.find((f) => f.kind === "path")!;
    expect(path.curve).toBe("smooth");
    const points = path.points!;
    // The editor says it is curved, and how long it is.
    const editor = page.locator(".feature-editor");
    await expect(editor.getByRole("button", { name: "Curved" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(editor.locator(".feature-length")).toContainText("% of the way round");

    // The "+" of each segment sits on the curve: hovered, it says what it does.
    const line = outline(SPHERE, points, { curve: true, closed: false });
    const mids = points.slice(1).map((_, i) => midpointOn(SPHERE, line, i)!);
    const plus0 = await onGlobe(page, mids[0]!);
    await page.mouse.move(plus0.x, plus0.y, { steps: 3 });
    await expect(page.locator(".map-tooltip")).toHaveText("Add a point");
    await expect.poll(() => cursor(page)).toBe("copy");

    // A click on it adds the point there, on the line; Ctrl+Z takes it away.
    await page.mouse.click(plus0.x, plus0.y);
    await expect.poll(async () => (await featureOf(page, path.id))?.points).toHaveLength(6);
    const added = (await featureOf(page, path.id))!.points![1]!;
    expect(near(added, mids[0]!)).toBe(true);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await featureOf(page, path.id))?.points).toHaveLength(5);

    // Dragging the "+" between the second and third points out adds a point where it is dropped,
    // in one step to undo.
    const plus1 = await onGlobe(page, mids[1]!);
    await drag(page, plus1, { x: plus1.x - 20, y: plus1.y - 50 });
    await expect.poll(async () => (await featureOf(page, path.id))?.points).toHaveLength(6);
    const dropped = (await featureOf(page, path.id))!.points![2]!;
    expect(dropped[1]).toBeGreaterThan(mids[1]![1] + 3);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await featureOf(page, path.id))?.points).toEqual(points);

    // C turns the selected river straight, and back.
    await page.keyboard.press("c");
    await expect.poll(async () => (await featureOf(page, path.id))?.curve).toBeUndefined();
    await page.keyboard.press("c");
    await expect.poll(async () => (await featureOf(page, path.id))?.curve).toBe("smooth");
    await expect(page.locator(".save-saved")).toBeVisible();
    await cleanUp(page, [id]);
  });

  test("CUJ 3: moves a border at a later year; a drag elsewhere, or with Space, pans", async ({
    page,
  }) => {
    await page.goto("/maps");
    const chronicle = await makeChronicle(page, "Border years");
    const square = (a: number, b: number): Position[] => [
      [a, a],
      [b, a],
      [b, b],
      [a, b],
    ];
    const first = square(0.3, 0.7);
    const later = square(0.25, 0.65);
    const id = await makeMap(page, "Moving border", "flat", [
      {
        id: "border01",
        kind: "zone",
        label: "The border",
        span: "kingdom1",
        points: first,
        shapes: [{ id: "later001", from: "treaty01", points: later }],
      },
    ]);
    const space = (await page.evaluate(
      async (id) => (await (await fetch(`/api/maps/${id}`)).json()).map.space,
      id,
    )) as {
      width: number;
      height: number;
    };
    const scaled = (ps: Position[]): Position[] =>
      ps.map(([x, y]) => [x * space.width, y * space.height]);
    // The map was made with fractions of its size; it is set in its own units here.
    await page.evaluate(
      async ({ id, first, later }) => {
        const loaded = await (await fetch(`/api/maps/${id}`)).json();
        const f = loaded.map.features[0];
        f.points = first;
        f.shapes[0].points = later;
        await fetch(`/api/maps/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            map: loaded.map,
            revision: loaded.revision,
            baseBlob: loaded.blob,
          }),
        });
      },
      { id, first: scaled(first), later: scaled(later) },
    );
    await open(page, id, `edit=1&t=310&c=${chronicle}`);
    const zoneNow = async () => (await featureOf(page, "border01"))!;
    const inside = () => onFlat(page, [0.45 * space.width, 0.45 * space.height]);

    // Not selected, a drag inside it pans the map.
    let v = viewOf(page).join(",");
    let c = await inside();
    await drag(page, c, { x: c.x + 50, y: c.y + 20 });
    await expect.poll(() => viewOf(page).join(",")).not.toBe(v);
    expect((await zoneNow()).shapes![0]!.points).toEqual(scaled(later));

    // Selected, a drag inside it moves the shape on screen, the later one, as a whole.
    c = await inside();
    await page.mouse.click(c.x, c.y);
    await expect(page.locator(".feature-editor")).toBeVisible();
    c = await inside();
    await page.mouse.move(c.x + 2, c.y + 2, { steps: 2 });
    await expect.poll(() => cursor(page)).toBe("move");
    const k = Number(viewOf(page)[3]);
    c = await inside();
    await drag(page, c, { x: c.x + 60, y: c.y });
    await expect
      .poll(async () => (await zoneNow()).shapes![0]!.points![0]![0])
      .toBeCloseTo(scaled(later)[0]![0] + 60 / k, 3);
    const moved = (await zoneNow()).shapes![0]!.points!;
    moved.forEach((p, i) => {
      expect(p[0] - scaled(later)[i]![0]).toBeCloseTo(moved[0]![0] - scaled(later)[0]![0], 6);
      expect(p[1]).toBeCloseTo(scaled(later)[i]![1], 6);
    });
    // The first shape is as it was.
    expect((await zoneNow()).points).toEqual(scaled(first));

    // Space held, a drag inside the selected zone pans.
    v = viewOf(page).join(",");
    c = await inside();
    await page.keyboard.down("Space");
    await drag(page, c, { x: c.x - 40, y: c.y + 30 });
    await page.keyboard.up("Space");
    await expect.poll(() => viewOf(page).join(",")).not.toBe(v);
    expect((await zoneNow()).shapes![0]!.points).toEqual(moved);

    // The middle button pans over it too.
    v = viewOf(page).join(",");
    c = await inside();
    await drag(page, c, { x: c.x + 30, y: c.y - 30 }, "middle");
    await expect.poll(() => viewOf(page).join(",")).not.toBe(v);
    expect((await zoneNow()).shapes![0]!.points).toEqual(moved);

    // One Ctrl+Z puts the zone back.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await zoneNow()).shapes![0]!.points).toEqual(scaled(later));
    await expect(page.locator(".save-saved")).toBeVisible();
    await cleanUp(page, [id], [chronicle]);
  });

  test("CUJ 4: places five towns with the marker tool on, and links them", async ({ page }) => {
    await page.goto("/maps");
    const port = await makeMap(page, "Port quarter", "flat");
    const id = await makeMap(page, "Five towns", "flat");
    await open(page, id);
    const box = await frameBox(page);
    const editor = page.locator(".feature-editor");
    await page.mouse.click(box.x + 40, box.y + box.height - 40);
    await page.keyboard.press("m");
    await expect(page.locator(".map-hint")).toContainText("Click where each marker goes");
    await expect(page.locator(".map-hint")).toContainText("Drawing into");
    for (let i = 0; i < 5; i++) {
      await page.mouse.click(box.x + box.width / 2 - 200 + i * 100, box.y + box.height / 2);
      await expect(editor).toBeVisible();
      await pickEntry(editor, "Harbor", "har");
      await pressed(page, "Marker");
    }
    await expect
      .poll(async () => (await stored(page)).features.filter((f) => f.entry !== null).length)
      .toBe(5);

    // The last is changed to another entry, and given a map of its place.
    await pickEntry(editor, "Old Quay", "quay");
    await editor.getByRole("combobox", { name: "A map of this place" }).click();
    await page.getByPlaceholder("Find a map").fill("port");
    await page.getByRole("option", { name: "Port quarter", exact: true }).click();
    await expect(editor.getByRole("combobox", { name: "A map of this place" })).toHaveText(
      "Port quarter",
    );
    await expect(page.locator(".save-saved")).toBeVisible();
    const last = (await stored(page)).features.at(-1)!;
    expect(last.child).toBe(port);

    // Viewing: its card opens the map of this place.
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const town = await onFlat(page, last.at!);
    await page.mouse.click(town.x, town.y);
    const card = page.locator(".feature-card");
    await expect(card.locator("h2")).toHaveText("Old Quay");
    await expect(card.getByRole("link", { name: /Open the map of this place/ })).toBeVisible();
    await cleanUp(page, [id, port]);
  });

  test("CUJ 6: a new map from the image dialog, and a second image from a web address", async ({
    page,
  }) => {
    await newMapInForm(page, "Coast chart", "flat");
    const id = new URL(page.url()).pathname.split("/").pop()!;
    await expect.poll(async () => (await stored(page)).images.length).toBe(1);
    await page.getByRole("button", { name: "Layers" }).click();
    const panel = page.locator(".layer-panel");
    await panel.getByRole("button", { name: "Add an image…" }).click();
    const dialog = page.getByRole("dialog", { name: "Choose an image" });
    await expect(dialog).toBeVisible();
    const tag = Date.now().toString(36);
    await dialog
      .getByLabel("From a web address")
      .fill(`http://127.0.0.1:${PICTURES}/web/Coast%20${tag}.png`);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await stored(page)).images.length).toBe(2);
    await expect(panel.getByLabel(`Show Coast ${tag}`)).toBeChecked();
    await expect(page.locator(".save-saved")).toBeVisible();
    await cleanUp(page, [id]);
  });

  test("the image dialog for a map chooses one image, and the form uses it", async ({ page }) => {
    await page.goto("/maps");
    await page.getByRole("button", { name: "Choose an image…" }).click();
    const dialog = page.getByRole("dialog", { name: "Choose an image" });
    await dialog.getByRole("button", { name: "Choose map one.png", exact: true }).first().click();
    await expect(dialog.locator(".gallery-tile.is-chosen")).toHaveCount(1);
    // One image at a time: choosing another replaces the first.
    await dialog.getByRole("button", { name: "Choose photo.png", exact: true }).first().click();
    await expect(dialog.locator(".gallery-tile.is-chosen")).toHaveCount(1);
    await expect(dialog.locator(".gallery-tile.is-chosen")).toContainText("photo");
    await dialog.getByRole("button", { name: "Choose", exact: true }).click();
    await expect(page.locator(".new-map .chosen-image")).toContainText("photo");
    await expect(page.getByRole("button", { name: "Choose another image…" })).toBeVisible();
  });
});

/**
 * Fingers on the screen. A start or a move sends every finger that is down, as a touch screen
 * does; Chromium releases only the fingers an end names.
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

  /** Moves two fingers together, step by step. */
  async moveBoth(a: number, b: number, by: Point, steps = 6) {
    const fromA = this.down.get(a)!;
    const fromB = this.down.get(b)!;
    for (let i = 1; i <= steps; i++) {
      this.down.set(a, { x: fromA.x + (by.x * i) / steps, y: fromA.y + (by.y * i) / steps });
      this.down.set(b, { x: fromB.x + (by.x * i) / steps, y: fromB.y + (by.y * i) / steps });
      await this.send("touchMove");
    }
  }

  async lift(id: number) {
    await this.send("touchEnd", [id]);
    this.down.delete(id);
  }

  async tap(at: Point) {
    await this.press(1, at);
    await this.lift(1);
  }
}

test.describe("by touch", () => {
  test('CUJ 7: drags the selected zone, pans with two fingers over it, and taps a "+"', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "phone", "Needs touch");
    await page.goto("/maps");
    const id = await makeMap(page, "Touched zone", "sphere", [
      {
        id: "zone0001",
        kind: "zone",
        label: "Reedmarsh",
        points: [
          [-30, 30],
          [30, 30],
          [30, -10],
          [-30, -10],
        ],
      },
    ]);
    await open(page, id);
    const fingers = await Fingers.on(page);
    const zone = async () => (await featureOf(page, "zone0001"))!.points!;
    const start = await zone();

    // A tap inside selects it.
    await fingers.tap(await onGlobe(page, [0, 10]));
    await expect(page.locator(".feature-editor")).toBeVisible();
    // On a phone the tab covers the foot of the map; the zone is above it.

    // One finger inside the selected zone moves it.
    const from = await onGlobe(page, [0, 10]);
    await fingers.press(1, from);
    await fingers.move(1, { x: from.x + 40, y: from.y });
    await fingers.lift(1);
    await expect.poll(async () => (await zone())[0]![0]).toBeGreaterThan(start[0]![0] + 3);
    const moved = await zone();
    moved.forEach((p, i) => expect(p[1]).toBeCloseTo(start[i]![1], 6));

    // Two fingers inside it pan the map, and leave the zone where it is.
    const v = viewOf(page).join(",");
    const mid = await onGlobe(page, [5, 10]);
    await fingers.press(1, { x: mid.x - 30, y: mid.y });
    await fingers.press(2, { x: mid.x + 30, y: mid.y });
    await fingers.moveBoth(1, 2, { x: -50, y: 0 });
    await fingers.lift(2);
    await fingers.lift(1);
    await expect.poll(() => viewOf(page).join(",")).not.toBe(v);
    expect(await zone()).toEqual(moved);

    // A tap on a "+" adds a point there. The view moved: the "+" is found where the map draws it.
    const [, lon, lat, k] = viewOf(page).map(Number);
    const ring = outline(SPHERE, moved, { curve: false, closed: true });
    const top = midpointOn(SPHERE, ring, 0)!;
    const box = await frameBox(page);
    const r = Math.PI / 180;
    // On the ball turned to (lon, lat): the orthographic place of the "+".
    const [l, f] = [(top[0] - lon!) * r, top[1] * r];
    const f0 = lat! * r;
    const x = box.x + box.width / 2 + k! * Math.cos(f) * Math.sin(l);
    const y =
      box.y +
      box.height / 2 -
      k! * (Math.cos(f0) * Math.sin(f) - Math.sin(f0) * Math.cos(f) * Math.cos(l));
    await fingers.tap({ x, y });
    await expect.poll(async () => (await zone()).length).toBe(5);
    expect(near((await zone())[1]!, top, 1e-6)).toBe(true);
    await expect(page.locator(".save-saved")).toBeVisible();
    await cleanUp(page, [id]);
  });
});
