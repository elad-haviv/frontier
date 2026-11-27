import { expect, type Page, test } from "@playwright/test";
import { setUpAi, at } from "./helpers.ts";
import {
  cleanUp,
  makeMap,
  onMap,
  type Position,
  RIVER_STYLE,
  ROAD_STYLE,
  stored,
  viewOf,
} from "./pathsHelpers.ts";

/**
 * Explore along paths (stage 21): points of interest found from the map's roads, rivers, joins
 * and heights with no AI call; a click chooses, Ask sends; exploring along a road; the tray and
 * its cost; keeping a discovery as a plain marker; offline; and the phone's bar and sheet.
 *
 * The fixture map is Find paths' picture (600 × 400 km, with its height map): the Greywater runs
 * west to the sea, the Brenn joins it; the King's Road runs south over the river, the Salt Way
 * crosses it and fords the Brenn, and the High Road branches off the King's Road.
 */

const GREYWATER: Position[] = [
  [420, 200],
  [380, 200],
  [300, 190],
  [220, 210],
  [96, 200],
];
const FEATURES = [
  { id: "greywatr", kind: "path", label: "Greywater", style: "strriver", points: GREYWATER },
  {
    id: "brenn001",
    kind: "path",
    label: "Brenn",
    style: "strriver",
    points: [
      [335, 90],
      [300, 190],
    ],
    endOn: "greywatr",
  },
  {
    id: "kingsrd1",
    kind: "path",
    label: "King's Road",
    style: "strroad1",
    points: [
      [260, 60],
      [260, 300],
      [260, 340],
    ],
  },
  {
    id: "saltway1",
    kind: "path",
    label: "Salt Way",
    style: "strroad1",
    points: [
      [120, 120],
      [420, 120],
    ],
  },
  {
    id: "highrd01",
    kind: "path",
    label: "High Road",
    style: "strroad1",
    points: [
      [260, 300],
      [400, 330],
    ],
    startOn: "kingsrd1",
  },
  { id: "calder01", kind: "marker", label: "Calder", at: [150, 300], icon: null },
];

async function openExplore(page: Page, title: string) {
  await setUpAi(page, { conversation: "sample/reader" });
  const id = await makeMap(page, title, {
    heights: true,
    features: FEATURES,
    styles: [RIVER_STYLE, ROAD_STYLE],
  });
  await page.goto(at(`/map/${id}`));
  await expect(page.locator(".map-top")).toBeVisible();
  await expect(page).toHaveURL(/v=/);
  await page.waitForTimeout(300);
  return id;
}

/** Counts the calls that ask the AI, as against the estimates of their cost. */
function countAsks(page: Page) {
  const asked: { spots: { kind: string; lines: string[] }[] }[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/maps\/[a-z0-9]+\/discover$/.test(r.url())) {
      asked.push(r.postDataJSON());
    }
  });
  return asked;
}

const pin = (page: Page, name: string | RegExp) =>
  page.locator(".spot-pin").and(page.getByRole("button", { name }));
const bar = (page: Page) => page.getByRole("group", { name: "Explore" });
const tray = (page: Page) => page.getByLabel("Chosen places");

test("finds points of interest for free, explores along a road, and asks about several places in one call", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== "desktop", "The phone has its own test below.");
  const asked = countAsks(page);
  const id = await openExplore(page, "Explored vale");
  await page.getByRole("button", { name: "Explore" }).click();

  // The spots, worked out from the paths, joins and heights: nothing is sent.
  await expect(bar(page).getByRole("status")).toContainText(
    "worth a look along 3 roads and 2 rivers · found from the map's paths and heights, nothing sent",
  );
  await expect(pin(page, "Crossroads: Crossroads of King's Road and Salt Way")).toBeVisible();
  await expect(pin(page, "Bridge or ferry: King's Road crosses Greywater")).toBeVisible();
  await expect(pin(page, "Junction: Where High Road meets King's Road")).toBeVisible();
  await expect(pin(page, "Confluence: Brenn joins Greywater")).toBeVisible();
  await expect(pin(page, "Ford: Salt Way fords Brenn")).toBeVisible();
  await expect(pin(page, "River mouth: Mouth of Greywater")).toBeVisible();
  await expect(pin(page, /^Spring: Source of Brenn/)).toBeVisible();
  const days = Number(
    await bar(page)
      .getByRole("button", { name: /Day's travel/ })
      .locator("b")
      .textContent(),
  );
  expect(days).toBeGreaterThan(0);

  // Choosing a spot (here from the Explore tab's list; the bar covers its pin) says what it
  // would cost; it asks nothing yet.
  await page
    .getByRole("tabpanel")
    .getByRole("button", { name: /^Crossroads of King's Road and Salt Way/ })
    .click();
  await expect(tray(page)).toContainText("1 place");
  await expect(tray(page).getByRole("button", { name: "Ask what is there" })).toBeVisible();
  await expect(tray(page).locator(".explore-cost")).toContainText(/One call · (about|under)/);
  await tray(page).getByText("What Frontier sends").click();
  await expect(tray(page)).toContainText("What is here: Crossroads of King's Road and Salt Way.");
  await expect(tray(page)).toContainText(
    "On: King's Road (road, a name on the map), Salt Way (road, a name on the map).",
  );
  await expect(tray(page)).toContainText(/Ground: about [\d,]+ m up \(from the height map\)\./);
  expect(asked).toHaveLength(0);

  // On foot, a day's travel is shorter: more stops.
  await bar(page).getByRole("button", { name: "On foot" }).click();
  await expect
    .poll(async () =>
      Number(
        await bar(page)
          .getByRole("button", { name: /Day's travel/ })
          .locator("b")
          .textContent(),
      ),
    )
    .toBeGreaterThan(days);
  await bar(page).getByRole("button", { name: "Horse" }).click();

  // A kind can be hidden, and its pins go.
  await bar(page)
    .getByRole("button", { name: /^Waters/ })
    .click();
  await expect(pin(page, "Confluence: Brenn joins Greywater")).toHaveCount(0);
  await bar(page)
    .getByRole("button", { name: /^Waters/ })
    .click();

  // A click on the King's Road explores along it: its spots in order from its start.
  await page.keyboard.press("Escape");
  const road = await onMap(page, [260, 250]);
  await page.mouse.click(road.x, road.y);
  const side = page.getByRole("tabpanel");
  await expect(side.getByRole("heading", { name: "King's Road" })).toBeVisible();
  const rows = side.getByRole("list", { name: "Along King's Road" }).locator("li");
  const titles = await rows.allInnerTexts();
  const at = (text: string) => titles.findIndex((t) => t.includes(text));
  expect(at("Its start")).toBe(0);
  expect(at("Crossroads of King's Road and Salt Way")).toBeLessThan(
    at("King's Road crosses Greywater"),
  );
  expect(at("King's Road crosses Greywater")).toBeLessThan(at("Where High Road meets King's Road"));
  expect(at("Its end")).toBe(titles.length - 1);
  // Pins off the road are dimmed while exploring along it.
  await expect(pin(page, "Ford: Salt Way fords Brenn")).toHaveClass(/is-dim/);

  // Choose all, then Enter asks about them all in one call.
  await side.getByRole("button", { name: /^Choose all \d+$/ }).click();
  const chosen = Number(/(\d+) places/.exec((await tray(page).innerText()) ?? "")?.[1]);
  expect(chosen).toBeGreaterThan(2);
  expect(chosen).toBeLessThanOrEqual(6);
  await expect(
    tray(page).getByRole("button", { name: `Ask about ${chosen} places` }),
  ).toBeVisible();
  await page.locator(".map-frame").focus();
  await page.keyboard.press("Enter");
  const card = page.locator(".discovery-card");
  await expect(card).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0]!.spots).toHaveLength(chosen);
  expect(asked[0]!.spots[0]!.kind).toBe("crossroads");
  expect(asked[0]!.spots[0]!.lines.join("\n")).toContain("On: King's Road");
  await expect(card).toContainText(`1 of ${chosen} found`);
  await expect(card).toContainText("Proposed settlement · inn · not in the lore");
  await expect(card.locator(".discovery-where")).toContainText(
    "Crossroads of King's Road and Salt Way",
  );
  await card.getByRole("button", { name: "The next one found" }).click();
  await expect(card).toContainText(`2 of ${chosen} found`);
  await expect(card).toContainText("Proposed settlement · camp · not in the lore");
  await card.getByRole("button", { name: "The previous one found" }).click();
  await expect(card).toContainText(`1 of ${chosen} found`);

  // Kept: a plain marker at the spot, joined to nothing and in no group.
  const before = (await stored(page)).features.length;
  await card.getByRole("button", { name: "Keep" }).click();
  await expect(page.locator(".map-notice")).toContainText("Kept as a new entry");
  await expect.poll(async () => (await stored(page)).features.length).toBe(before + 1);
  const kept = (await stored(page)).features.at(-1)! as unknown as Record<string, unknown>;
  expect(kept.kind).toBe("marker");
  expect(kept.group).toBeUndefined();
  expect(kept.startOn).toBeUndefined();
  expect(kept.at).toEqual([260, 120]);

  // Offline: the spots stay, and Ask says why it cannot.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await pin(page, "Junction: Where High Road meets King's Road").click();
  await expect(tray(page).getByRole("button", { name: /Ask/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(tray(page)).toContainText("Asking needs a connection");
  await expect(pin(page, "Bridge or ferry: King's Road crosses Greywater")).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  // The keys: Escape clears the choice and leaves the road; ] steps to a spot and chooses it.
  await page.locator(".map-frame").focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(side.getByRole("heading", { name: "King's Road" })).toHaveCount(0);
  await page.keyboard.press("]");
  await expect(tray(page)).toContainText("1 place");
  await expect(page.locator(".spot-pin.is-cursor")).toHaveCount(1);
  await page.keyboard.press("i");
  await expect(page.locator(".spot-pin:not(.is-chosen)")).toHaveCount(0);
  await expect(bar(page).getByRole("status")).toContainText("Points of interest hidden");
  await page.keyboard.press("i");

  // A click anywhere else chooses that place, described from what is near.
  const nowhere = await onMap(page, [180, 260]);
  await page.mouse.click(nowhere.x, nowhere.y);
  await expect(tray(page)).toContainText(/This place: .*km .* of /);
  await cleanUp(page, [id]);
});

test("on a phone: the bar at the foot, a tap opens the sheet and keeps the place in sight", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "The desktop has its own test above.");
  const asked = countAsks(page);
  const id = await openExplore(page, "Explored on a phone");
  await page.getByRole("button", { name: "Explore" }).click();
  await expect(bar(page).getByRole("status")).toContainText(/\d+ places worth a look · free/);
  // The kinds open from the bar.
  await bar(page).getByRole("button", { name: "Kinds" }).click();
  await expect(bar(page).getByRole("button", { name: "Horse" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await bar(page).getByRole("button", { name: "Kinds" }).click();

  const before = viewOf(page);
  await pin(page, "Bridge or ferry: King's Road crosses Greywater").tap();
  const sheet = page.getByRole("region", { name: "Explore, in a sheet" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Ask what is there" })).toBeVisible();
  // The map moved so the bridge sits above the sheet.
  await expect.poll(() => viewOf(page).join(",")).not.toBe(before.join(","));
  const pinBox = (await pin(page, "Bridge or ferry: King's Road crosses Greywater").boundingBox())!;
  const sheetBox = (await sheet.boundingBox())!;
  expect(pinBox.y + pinBox.height).toBeLessThan(sheetBox.y);
  expect(asked).toHaveLength(0);

  // Ask: the card of what was found takes the place of the sheet.
  await sheet.getByRole("button", { name: "Ask what is there" }).click();
  const card = page.locator(".discovery-card");
  await expect(card.locator("h2")).toHaveText("Test Hollow");
  await expect(sheet).toHaveCount(0);
  expect(asked).toHaveLength(1);
  expect(asked[0]!.spots[0]!.kind).toBe("bridge");
  await card.getByRole("button", { name: "Discard" }).click();
  await expect(card).toHaveCount(0);

  // The List opens the sheet with the roads and rivers; one of them explores along it.
  await bar(page).getByRole("button", { name: "List" }).click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: /^Greywater/ }).click();
  await expect(sheet.getByRole("heading", { name: "Greywater" })).toBeVisible();
  await expect(sheet.getByRole("list", { name: "Along Greywater" })).toContainText("Its source");
  await cleanUp(page, [id]);
});
