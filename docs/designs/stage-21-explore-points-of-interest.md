# Explore along paths: points of interest on roads, rivers and crossroads

- **For:** the owner's ask, "In exploration mode, one may discover points of interest along roads,
  crossroads, rivers, river deltas, etc."
- **Status:** approved; see "Approved decisions" at the end for what the owner chose.
- **Mockup:** `ux/explore-paths-mockup.html`. It is a working page. It reuses the generated world of the Find paths
  mockup (`autopaths-run/world.js`) and turns it into what a Frontier map holds: five town markers;
  rivers in the River style, with remembered joins: two tributaries end on their rivers (`endOn`),
  and the Greywater has two delta arms that start on it (`startOn`). It also has Lake Merrow (a zone
  in the Water style), three roads (the painted King's Road, the High Road that branches off it at
  Calder Bridge, and the Salt Way, built in year 410, which crosses it on a shared corner), and a
  realm border along the Grey Peaks. The points of interest are worked out for real from those features
  and the height field, not drawn in by hand. The AI's answers are canned, but they are written from
  the same context the real call would send. The top strip has "Map with no paths", "Offline" and
  "Phone view". Sources are in `ux/explore-run/` (`feats.js`: features and spot finding; `stub.js`:
  canned answers; `ui.js`; `build.sh`; `check.cjs`). Screenshots are in `ux/explore-shots/` (desktop `d00`–`d21`,
  phone `p0`–`p6`).
- **Read for this:** stage 8d (discovery) and stage 13 (maps), `ai/discover.ts`, `routes/discover.ts`,
  `map/useDiscovery.ts`, `DiscoveryPins.tsx`, `DiscoveryCard.tsx`, `MapBar.tsx`, `keys.ts`; stage 19
  feature groups; the approved `ux/auto-paths.md` (joins, "counts as") and `ux/terrain-dialog.md`
  (the height map).

## What's wrong today

Explore is a blind tap. The author taps somewhere and the server sends the AI the entries of the six
nearest linked features and the names of the ten nearest unlinked ones, each with a distance and a
compass direction. That is all it sends. It never says *what the place is*. A tap on the King's
Road where the Salt Way crosses it reaches the model as "King's Road: a path, here; Salt Way: a
path, here". The model has to guess that this is a crossroads, and it usually proposes something
generic. Nothing shows the author where interesting places might be, and asking about the length of
a road means tapping, waiting and paying once for every spot. Since Find paths, the map knows a
lot that Explore ignores: path styles that count as Road or River, joins between paths, and heights.

## The idea in one line

Frontier reads its own roads, rivers, joins and heights and marks the places where something would
naturally be: crossroads, fords, river mouths, passes, a day's ride. Showing these is free and works
offline. The author asks the AI about one of them, several, or all of them along a road in **one**
call. The AI is told what each place is, so an inn at a crossroads names both roads.

## What Frontier recognises (free, no AI)

All of this comes from map features: paths by their style's **counts as** (Road, River; Trail counts
as Road), zones that count as Water, the **remembered joins** (`startOn`/`endOn`, shared corners),
and heights from the Terrain dialog (or the guess, marked as such).

| Spot | Found from | Kind (family) |
| --- | --- | --- |
| **Crossroads** | Two roads cross on a shared corner | roads |
| **Junction** | A road's end joined to another road (`startOn`/`endOn`): a branch | roads |
| **Bridge or ferry / Ford** | Road × River. A bridge or ferry on a main river more than a third of the way to the sea, on a Road. A ford on a tributary, near the source, or on a Trail. | crossings |
| **Confluence** | A river's end joined to a river (a tributary) | waters |
| **Delta** | A river that arms start from (rivers only split at deltas) | waters |
| **River mouth** | A river that ends in the sea, has no arms and does not end on another river | waters |
| **Lake outlet** | A river leaving a zone that counts as Water | waters |
| **River bend** | The sharpest bend of a river, if it turns more than about 70° on low ground | waters |
| **Pass** | A road's highest point, if it is above about 780 m and not at either end | heights |
| **Spring** | A river's start that is not joined to another river | heights |
| **Border crossing** | A road crosses a Border path (or leaves a realm zone) | edges |
| **Road meets the sea** | A road end on the coast with no marker: a landing or harbour | edges |
| **A day's travel** | Along each road, from each town, junction and crossroads: every 8 hours of travel on foot, on horse or by cart. Slopes slow the traveller, as in Find paths' Route. | stops |

Two rules keep the map clean:

- **A spot within about 7 km of a marker belongs to that marker.** It is not offered again, because
  the place already exists. Calder Bridge's bridge and the High Road's junction show in the Explore
  along list as "also bridge, junction" on the town's row. When the owner keeps a discovery as a
  marker, the spots around it disappear for the same reason.
- **Spots within about 8 km of each other are one spot with several reasons.** The King's Road's pass
  is also the border crossing, so one pin carries both, with a small count on it. The pin's icon
  comes from the highest-ranked reason: crossroads before bridges before waters before heights.

In the mockup's world this finds 21 places with a day's ride on horseback, and 31 on foot.

## How the owner explores

Explore is still the telescope button in the map bar, and still works only while viewing. It gets a
key, **X**. When Explore is on, a bar appears at the top of the map. It is the same card as Find
areas' bar.

- **Points of interest** (key I), a chip that is on by default. Beside it are family chips with
  counts: Crossroads, Bridges & fords, Waters, Passes & springs, Day's travel, Coasts & borders. Each
  chip shows or hides its family. Next comes **A day's travel: On foot · Horse · Cart**, set to Horse
  by default.
- A status line: "21 places worth a look along 3 roads and 5 rivers · found from the map's paths and
  heights, nothing sent".

The spots show as **ghost pins**: dashed rings in their family's colour with an icon. Pointing at one
(or focusing it with the keyboard) shows its reason, for example "Crossroads · Crossroads of the King's Road and
the Salt Way · The King's Road and the Salt Way cross here, on a shared corner."

There are three ways in:

1. **Click a spot.** It is chosen and the tray (below) opens. Shift-click adds or removes a spot.
2. **Click a road or river.** It gets a soft band and the side bar shows **Along ‹path›**. This is a list in
   order from the start (for a river, from the source), with km and the spots on the path. Each spot
   has a checkbox. Towns on the path and the ends appear as milestones that cannot be chosen. **Choose
   all n** (key A) picks every spot. While exploring along a path, clicking a pin adds or removes it,
   and pins on other paths are dimmed. Clicking the path again asks about that point on it.
3. **Click anywhere else.** This chooses *this place* (a pin), described from what is near: "On the
   King's Road · 3 km from the crossroads of …", or "67 km north-west of Calder Bridge". It is today's
   tap, but now the place is described to the AI.

The side bar's **Explore** tab lists the roads and rivers (with length and number of spots), then
the spots grouped by family, then **Found, waiting** (the discoveries not yet kept) and **Kept on
this map**.

### The tray: what will be sent, and Ask

The tray sits at the foot of the side bar (on a phone, at the foot of the sheet). It shows the chosen
places as removable chips. A **What Frontier sends** section opens to show, for each place:

> What is here: Crossroads of the King's Road and the Salt Way. On: the King's Road (road, an entry),
> the Salt Way (road, a name on the map). Towns: Wynmouth, 66 km to the north-east; … Ground: open
> farmland, about 90 m up (from the height map). Realm: the Wyn Marches. The moment: year 450.

Under that come *Entries (may be quoted)* and *Names on the map (never quoted)*. Then the button,
**Ask what is there** or **Ask about 4 places** (Enter), and the cost line: "One call · about $0.02 ·
$3.12 of $10 spent this month".

## What the AI gets and returns

- **One call for up to six places.** Each place gets its own context block as above. The entries are
  shared and given once: those of the paths it lies on, the nearest towns, the zones and groups it
  lies in, and the entries they link to, twelve at most, as today. More than six places means one
  call per six. The estimate says how many.
- **Answer:** for each place, one or two candidates (two when only one place is asked about). Each
  candidate keeps today's fields (kind: settlement, place, creature, person, thing; name;
  description; basis; conflicts). It adds **what it is** (`role`): free text, with suggestions given
  to the model by spot kind. Inn, market or shrine at a crossroads; bridge town, toll or ferry at a
  crossing; mill or fort at a confluence; fishing village at a delta; fort or hospice at a pass; toll
  or border post at a border; inn, camp or post-house at a day's travel; port or cove where a road
  meets the sea; shrine at a spring. The card shows "Proposed place · inn · not in the lore".
- **Quotes rules are unchanged.** Only entries are quoted, and every quote is checked word for word. Names on the
  map are context only. Frontier's own conflict checks also run against the spot's entries. In the
  mockup: "The King's Road says there is 'no honest inn between Harbor and the bridge'".
- **The spend cap is respected.** Ask is disabled with a reason when the estimate would pass the cap,
  and every call is logged as today.
- **Time:** with time on, a path or zone whose span begins later is not on the map. Its spots,
  crossings and junctions disappear (with year 380 the Salt Way, built in 410, takes its five spots
  with it), and its entry is not drawn on.
- **Offline:** the overlay, the filters, Explore along and choosing all work offline, because they need only the
  map file. Ask is disabled with "Asking needs a connection. The points of interest work offline;
  choose now and ask when you are back." The choice is kept.

## Keeping a discovery

The card is today's card, plus a **where** line with the spot's icon ("Crossroads of the King's Road
and the Salt Way"), and a step through **‹ 1 of 4 found ›**. Keep makes the entry as today, in the
folder chosen, as a draft. It also has a checkbox, on by default: **Put a marker on the King's Road,
joined to it**. The marker is placed on the path at the spot (snapped onto the line) and gets an
`on: <path id>` join. It then moves when the road's corner moves, and it is listed as a milestone in
Along the King's Road. At a river mouth, delta or spring the marker goes on the river's end or split
point. It goes in the Places layer and appears in the Layers tab with a "new" tag. It is **not** put
in a group with the road (decision 3).

## Phone (installed iPhone app)

- The map bar keeps the telescope, Time, Layers and Edit. The explore bar sits at the bottom as one
  line ("21 places worth a look · free"), with a **Kinds** button that opens the family chips and the
  day's travel, and a **List** button that opens the sheet.
- Pins are 30 px, with a 44 px tap area. Tapping a spot, a road or a place opens the sheet (64% high), and
  **the map pans so that what was chosen sits in the strip above the sheet**. Along a road, the whole
  road is fitted into that strip.
- The tray stays at the foot of the sheet, with a full-width Ask button above the home indicator.
  The discovery card is a sheet over it, 72% high. Keep closes the sheet so the new marker can be seen.

## Keyboard

| Key | While exploring |
| --- | --- |
| **X** | Explore on or off (viewing) |
| **I** | Points of interest on or off |
| **] / [** | Next or previous spot: along the path explored, else all spots shown. The reason is shown, and the spot is chosen (along a path, the cursor only moves). |
| **Space** | Add or remove the spot under the cursor |
| **A** | Choose all spots along the path (again: clear them) |
| **Enter** | Ask about the chosen places |
| **Esc** | Close the card, then clear the choice, then leave the path, then close the sheet |
| Tab | Pins are buttons in map order; Enter or Space chooses one |

## Empty states

- **No paths** (mockup: "Map with no paths"): the bar says "No roads or rivers on this map yet, so
  there is nothing to look along. Click any place to explore it." The side bar explains that the spots
  come from paths in styles that count as Road or River, points to the Path tool and Find paths ›
  Trace, and says a click anywhere still works.
- **A path with no spots:** "Nothing along the Ashbrook stands out. Click any place on it to ask what
  is there."
- **All families filtered out / overlay off:** the status says the spots are hidden, and paths and
  places can still be clicked.
- **No heights:** passes and springs come from the Terrain dialog's height map, otherwise from the
  guess. With a guess the status adds "heights guessed from the picture". Without either, no passes
  are found, and springs are kept with no height given.
- **No model chosen:** as today, Explore is not offered.

## Decisions for the owner

1. **Does a click on the map ask straight away, as today?**
   - **(Recommended) No: a click chooses the place, shows what it is and what it will cost, and Enter
     or Ask sends it.** It costs one more click, but every AI call now has a visible price and
     context. It is the same tray for one place or six, and an accidental click on a road no longer
     spends money.
   - Or keep the one-tap ask for a plain click on empty map, and use the tray only for spots and paths.
2. **Which spots show by default?**
   - **(Recommended) All families, with a day's travel by horse (about 55 km).** That gives about 20
     pins on a regional map. On foot doubles the day's-travel pins. The filters remember their state per map.
   - Or start with only crossroads, crossings and waters, and let the owner add the rest.
3. **A kept discovery: joined to the path, or grouped with it?**
   - **(Recommended) A marker joined to the path (`on: <path>`, like startOn/endOn), in the Places
     layer.** A group means "one place drawn as several shapes" (stage 19). An inn is not part of the King's
     Road. The join is enough to move it with the road and list it along the road.
   - Or put it in a group with the road (it would then be selected, hidden and moved with the road).
4. **How many places per call?**
   - **(Recommended) Up to six per call, one or two candidates each.** That is about $0.01–0.03 a call
     with today's model, short enough to stay under the 120 s timeout, and it keeps the answers varied.
   - Or one call per place, which is simpler on the server and costs about three times as much for a
     whole road.

## Build plan (one engineer, about 9–10 days)

1. **Spot finding (3 days).** `packages/geo` or `web/src/map/spots/`: polyline crossing (with an
   index for long paths), joins from `startOn`/`endOn`, river roles (tributary, arm, stem), mouths
   and delta, lake outlets, bends, passes from the terrain sampler shared with Find paths, borders,
   coastal ends, day's travel (Tobler, as in `route.ts`), folding into markers, merging. It is a pure function of
   map + terrain + year + travel mode, run in the browser, so it works offline, memoised per map revision.
   Unit tests on small maps: an X of roads gives one crossroads; a T join gives a junction; a road
   over a tributary gives a ford; a spot next to a marker is folded; a later span removes its spots.
2. **Server (2 days).** `POST /api/maps/:id/discover` takes `spots: [{ at, kind, title, reasons,
   paths }]` (one to six; the old `{ at }` is still accepted as one "here" spot). Each spot's context
   is built from `around()` plus its reasons and the paths it lies on. `role` is added to `Discovery` and
   the schema, and a `spot` (title, kind, path id) to each stored discovery. The cap is checked per call.
   There is an estimate endpoint, or the estimate is worked out on the client from the token counts already logged. Tests:
   quotes still checked; a spot's path entry is given; six spots make one call, seven make two.
3. **Keeping on a path (1 day).** `keep()` gets `marker: { on: pathId | null }`. The marker is snapped
   to the path and gets an `on` join in `maps.ts` (the same machinery as `startOn`/`endOn`, so moving
   the path's corner moves it). Layers shows the join.
4. **Page (2.5 days).** `useDiscovery` gets `chosen`, `along`, `ask(spots)`. There is an `ExploreBar` (chips,
   day's travel, status), `SpotPins` (beside `DiscoveryPins`), an Explore tab in the side bar (lists,
   Along, the tray with "What Frontier sends" and the estimate), the card's where line and ‹ › stepping, keys in
   `keys.ts` (`map.explore` X, `map.spots` I, `]`, `[`, Space, A, Enter, Esc, all only when viewing), the phone sheet and the pan
   above it, and offline disabling through the existing connection state.
5. **Browser tests (1 day).** A fixture map with two crossing roads, a river with a tributary and a
   road over it. Spots appear without a network call; Along lists them in order; choose two → one
   POST with two spots; keep → a marker joined to the road; offline → Ask disabled and the overlay
   still shown; phone: tap a road, the sheet opens and the map pans.
6. **Docs (0.5 day).** `docs/designs/stage-<n>-explore-along-paths.md` from this proposal once it is approved, and the
   "?" sheet.

Later: spots from zones (forest edges, marsh crossings by counts as), sea routes and island landings,
and "Ask about all on this map" with a running total.

## Approved decisions

1. **The design: approved as proposed.**
2. **A click in Explore chooses the place and shows its context and cost; Enter or Ask sends it.**
   No AI call is made on a click.
3. **A kept discovery is not tied to the road.** It is just a marker at the spot: no `on` join and
   no group. (The designer recommended a join; the owner chose not to tie it.)
4. **Up to six places per AI call, one or two candidates each.**

Spots shown by default: all kinds, with a day's travel by horse (the designer's recommendation).
