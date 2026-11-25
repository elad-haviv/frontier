# Biome zones: deserts, forests, tundra and the rest, as zones that mean something

- **For:** the owner's request "Also we need to add biome zones."
- **Status:** approved; see "Approved decisions" at the end for what the owner chose. Where they differ from the proposal above, the approved decisions win.
- **Mockup:** `ux/biome-zones-mockup.html`. It is a working page that reuses the generated world of the Find paths
  and Terrain mockups (`autopaths-run/world.js`), so the picture, the heights, the rivers and the road all
  agree. **Suggest biomes** really classifies that world from its heights, the latitude and the wind. You can
  accept or skip the ghosts, and the route check really re-runs A\* with the accepted biomes' speeds. "Phone
  view" opens the page at iPhone width. Screenshots are in `ux/biome-shots/`: desktop `d00`–`d18`, phone
  `p00`–`p04`.
- **Read for this:** `maps.ts`, `mapStyles.ts` (and the "counts as" field being added), `stage-13-maps.md`,
  `stage-19-feature-groups.md`, `stage-19-find-areas.md`, `stage-6-maps-in-time.md`, `ux/auto-paths.md`,
  `ux/terrain-dialog.md`, `apps/server/src/ai/discover.ts` (Explore's context), `keys.ts`.

## What's wrong today

A desert can only be drawn as a zone in some style with a sandy colour. Nothing else in Frontier knows it is a
desert:

- Routes do not slow down in it.
- Rivers do not dry up in it.
- Explore only reads "Tharn" if someone happened to name the zone.
- A reader sees a beige patch with no legend.

The "counts as" field covers four kinds of ground: Water, Forest, Marsh and Mountains. That is not enough for
tundra, steppe, savanna or the owner's Blightlands. Every painted map also has biomes in its picture, and
there is no quick way to turn them into zones. A map with a height map has everything needed to *suggest*
biomes, but nothing does.

## 1. What a biome is in Frontier

### Recommendation: a biome is a kind of zone style, not a new field on the zone

A map style already gives a zone its look (colour, fill, edge), and "counts as" already gives it a meaning for
routes and terrain. A biome is exactly those two things plus a texture and a few numbers, so it belongs on
the style:

- **Styles are library-wide.** "Desert (sand)" looks and behaves the same on every map of the world. Change
  cart speed in the desert once, and every map's routes follow.
- **The zone stays a plain zone.** Everything that works on zones also works on biome zones: groups, time
  spans, later shapes, entries, snapping, Find areas and the saved picture.
- **One field per idea.** The other option, a `biome` field on the zone next to its `style`, would let a zone
  be "Realm style, biome desert". It would also make the reader guess which of the two they are looking at,
  and it gives two places to set the colour of a desert.

A **biome style** is a zone style with a `biome` block (§5). It names a **base biome**, one of the fifteen
built-in kinds below. The base biome gives defaults for speeds, rivers, Explore's words and "counts as". The
style can override each of them.

The owner's own biomes are styles too. "Blightlands" is a style with its own colour and pattern that
**behaves like** Volcanic/wasteland, with slower speeds and "rivers dry out" (mockup `d14`). The Styles tab
gets **+ New biome**.

**"Counts as" follows the biome.** Forest kinds count as Forest, Wetland as Marsh, Ocean as Water, and
Alpine and Ice as Mountains. The Styles panel shows this as read-only text ("Counts as: Forest (from the
biome)") so the two fields never disagree. A zone style without a biome keeps its own "counts as" as
planned. The planned starter style "Mountains" **becomes** the "Mountains / alpine" biome.

### The starter set ("Add the usual biomes" in Styles, as for the usual styles)

Speeds are multipliers on open-ground speed for each way of travelling, from the approved Find paths
defaults (foot 4.8, horse 7.5, cart 2.3 km/h). "No way" means the ground cannot be crossed, though a road
through it still can. Slope still comes from the height map on top of this: a biome is ground cover, not
relief.

| Biome | Look: fill · pattern | Foot | Horse | Cart | Rivers | Explore reads |
| --- | --- | --- | --- | --- | --- | --- |
| Ocean / sea | slate blue · small waves | no way | no way | no way | — | "at sea" (Ship sails it) |
| Coast / beach | pale sand · fine stipple | 0.9 | 0.8 | 0.6 | normal | "on the shore" |
| Ice / glacier | blue-white · short crevasse strokes | 0.35 | no way | no way | rivers rise here (melt) | "on the ice" |
| Tundra | grey-green · sparse dashes | 0.8 | 0.75 | 0.5 | normal | "on the open tundra" |
| Taiga / boreal forest | dark green · small conifers | 0.65 | 0.45 | 0.35 | normal | "in the taiga" |
| Temperate forest | green · round trees | 0.7 | 0.45 | 0.4 | normal | "in the forest" |
| Rainforest / jungle | deep green · dense canopy bumps | 0.4 | 0.2 | no way | rivers rise here | "in the jungle" |
| Grassland / steppe | yellow-green · grass tufts | 1.0 | 1.1 | 1.0 | normal | "on the grassland" |
| Savanna | ochre · tufts, a few flat-topped trees | 1.0 | 1.05 | 0.9 | normal | "on the savanna" |
| Scrubland | olive · low bush arcs | 0.85 | 0.8 | 0.7 | normal | "in the scrubland" |
| Desert (sand) | sand · dots | 0.6 | 0.55 | 0.35 | **dry out** | "in the sand desert" |
| Desert (rock) | tan · pebbles | 0.8 | 0.7 | 0.6 | **dry out** | "in the stony desert" |
| Wetland / marsh | grey-green · reeds on a waterline | 0.45 | 0.3 | no way | **spread into marsh** | "in the marshes" |
| Mountains / alpine | grey · hatched peaks | 0.55 | 0.4 | 0.2 | rivers rise here | "high in the mountains" |
| Volcanic / wasteland | dark ash · specks | 0.6 | 0.5 | 0.4 | normal | "in the wasteland" |

The forest speeds match Find paths' existing Forest numbers (3.3/4.8 ≈ 0.7 on foot, 0.45 horse, 0.4
cart), so nothing approved changes.

**Patterns** are drawn by code and are not images: 16 small glyph tiles, each drawn in a darker shade of the
fill colour. They keep a constant size on screen (like line widths), so the texture does not turn to mush
when zoomed out or blow up when zoomed in. The mockup's Styles tab and style picker show every one
(`d13`, `d15`).

**What "Rivers" means for Find paths** (approved design; this adds a small rule):

- **Dry out:** water gathered in the biome counts for little (desert runoff), and a river loses flow for
  each km it crosses. A small river ends in the sand with the bar saying "dries out in the Tharn Desert". A
  big one crosses as an exotic river, like the Nile.
- **Spread into marsh:** a river that reaches a wetland zone ends in it as an inland delta ("ends in the
  Mire of Ost"), the way a Water zone already ends a river as a lake.
- **Rivers rise here:** wetter runoff, so "Show likely rivers" finds more sources in it.

**Explore.** Today the place's context lists "a zone the place lies inside" only for named zones. Biome
zones add a line even when they are unnamed: *"The land here: sand desert (in the Tharn Desert), 31 km
inland, east of the Grey Peaks, about 300 m up; rivers lose water."* The model gets the base biome's words
(or the owner's own Explore words for a custom biome), the zone's name if it has one, and two facts already
computed for terrain: distance to the coast and height. The mockup shows this text in the Edit tab (`d12`).
It is map context, not an entry, so it is never quoted as lore.

## 2. Making them

### (a) By hand: the Zone tool in a biome style

- The Zone tool's bar gets the **style picker** shown in the mockup (`d15`). It is a listbox with pattern
  swatches, grouped Water · Cold · Temperate · Warm · High · Made by you, then "Other zone styles". Each
  option shows its cart speed so the choice has visible weight.
- The arrow keys move through it, Enter picks and Esc closes.
- New zones go to the **Biomes** layer when the style is a biome style, whatever layer is current, and the
  bar says so ("New zone in **Biomes**").
- Snapping (S) already lands on neighbouring zones. That is how two hand-drawn biomes share a border.

### (b) Find areas, with a biome in its bar

Nothing new in the tool. Its existing "New zone in ‹layer› ‹style›" uses the same picker, so it lists the
biome styles. Clicking the painted desert, then **Make zone**, gives a Desert (sand) zone in Biomes. Its
neighbours share borders through the approved wall share-out and snapping.

One small addition: when the chosen style is a biome, the layer follows to Biomes, as in (a).

### (c) Suggest biomes, from the terrain

A tool, key **B**, leaf icon, between Find areas and the time controls. It is only enabled when the map has
terrain (Terrain dialog). Without terrain the tooltip reads "Suggest biomes needs terrain: add a height
map".

**What it does** (`d00`):

1. **Temperature** comes from latitude and height. Sea-level temperature is about 27 − 0.0075·lat² °C (the
   real curve: 27 °C at the equator, 0 °C at 60°). It drops 6.5 °C per km of height, and the
   **Temperature** slider (−10 … +10 °C) shifts it.
2. **Rainfall** comes from the wind. The air crosses the map in the **prevailing wind**'s direction (an
   8-way dial plus "none"). It takes up water over the sea, loses a little per km over land, and rains hard
   where the ground rises under it. What is left behind a range is dry: that is the **rain shadow**. Coasts
   get a little sea-breeze rain. With "none", rain falls by distance to the sea. The **Wetness** slider
   (×0.4 … ×2.5) scales it. The rain field is softened so it does not run in stripes along the wind.
3. **Classification** is a Whittaker-style table of temperature against rainfall: ice, tundra, alpine (cold
   and high), taiga, temperate forest, grassland, scrubland, the two deserts, savanna and rainforest.
   **Wetland** is added where the ground is low and flat, a lot of water gathers (flow accumulation from
   Find paths' hydrology) and it is not dry.
4. **Regions.** A majority filter removes speckle. Patches smaller than **Smallest zone** (80–2,500 km²)
   join the neighbour they share most border with. Each region becomes one ghost: a dashed edge, a lighter
   fill and its pattern. Holes are filled and one zone is made per piece, as Find areas approved. The
   enclosed region is simply drawn on top (§3).
5. **Coasts** come from the terrain's own sea-level line (the Terrain dialog's), so a suggested biome stops
   exactly at the coast the height map agrees with.

**The bar** (desktop at the top, phone as a strip with Options, `p00`/`p01`):

- The wind dial.
- **Latitude** of the map's middle and the **N–S span**. Its least value is what the map's scale gives (the
  mockup's 320 km map spans 2.9°). The owner widens it for a continent drawn without a scale. On a child of a
  globe map both come from the globe and the controls are hidden.
- Temperature, Wetness and Smallest zone.
- The terrain source line.
- **Show: Biomes · Temperature · Rainfall** (keys 1, 2, 3). The last two draw the fields behind the
  suggestion, with a scale in the legend, so "why is this a desert?" has a visible answer (`d02`, `d03`,
  `d04`: with the wind from the east the shadow moves to the west side).
- The count ("21 suggestions · 5 biomes · 53,250 km²"), **Skip all** and **Accept all** (⇧Enter).

Every change re-runs live, in about 0.1–0.2 s in the mockup on a 480 × 320 grid. The mockup shows the range
from latitude 12° with +2 °C (savanna, jungle, sand desert, `d06`) to 62° (taiga, tundra, `d07`), and a 30°
span that bands the map (`d08`).

**Accepting:**

- **Click a ghost** to accept it. It becomes an ordinary zone in Biomes, unnamed, in that biome's style
  (`d09`). Hover says "Suggested: Desert (sand) · 5,680 km² · on foot 0.6× · horse 0.55× · cart 0.35× ·
  Click to accept" (`d01`).
- Accept and Skip are also in the **Suggest** tab of the side bar. That tab lists the ghosts by biome with
  area and cart speed. Hovering a row lights its ghost.
- **Delete** skips the ghost under the pointer, and **Show them again** brings skipped ghosts back.
- Each accept, skip and Accept all is one Undo step.
- **Ghosts never cover a biome already on the map**, whether drawn or accepted. Accepted zones stay as they
  are when the settings change; only the ghosts move. So the owner can draw the Blightlands first, then
  suggest the rest around them, as the mockup's "The Withering" shows.

**Honest about what it is.** The first line of the Suggest tab says: "A starting point, not a survey.
Worked out from the height map, the latitude and the prevailing wind… Accept what fits; repaint or skip the
rest." It ignores ocean currents, seasons, monsoons and soil, and it says so in its help. Seas are never
suggested (the picture's sea is the sea), and neither is Coast, which is too thin to be a region; it is
drawn by hand or made with Find areas.

**With an inferred height map.** Another proposal (in progress) infers a height map from the picture: the
owner reviews suspected high and low points, lines and zones, and Frontier generates a height map with
noise. Suggest biomes takes that generated height map exactly like a real one, because it only reads the
map's terrain. The terrain source line then reads "Terrain generated from the picture" in the amber
"guessed" style, so a suggestion built on a guess is marked as such. No design is needed here beyond that
line.

### Which ship first

**(a) and (b) together first, then (c).**

- (a) and (b) are mostly the biome style itself: the schema field, patterns, the picker, routes and Explore
  reading it. They work on every map, painted or schematic, with or without terrain.
- (c) needs terrain, which only maps with a height map (or, later, an inferred one) have. It is the most
  impressive part but serves fewer maps at first.
- Shipping the style first also means (c)'s ghosts already have real styles, the legend, routes and
  Explore to land in.

## 3. How biomes sit with the rest of the map

- **The Biomes layer.** The first biome zone (or "Add the usual biomes") creates a layer named **Biomes**,
  put first in the map's layer list so that it is drawn first, under everything else (layers are drawn in
  file order). It is an ordinary layer: it can be renamed, hidden, locked or made a sublayer, and its row
  says "drawn under the rest" (`p03`).
  - Biome zones may live in other layers too. What makes a zone a biome is its style, not its layer.
  - Fills are drawn with a multiply blend so the painted picture's lines and names stay readable through
    them (`d10`).
- **One biome per place.**
  - Where biome zones overlap, the **smallest one containing the place** wins, for routes, rivers, Explore
    and the hover tag. That is the natural reading of "an oasis inside the desert" or "a marsh inside the
    forest", and it is also the drawing order (larger first), so what you see is what counts. The mockup
    rasterises this way for its route check.
  - Non-biome zones (realms, provinces) overlap biomes freely and change nothing.
- **A forest on mountains.** A forest on mountains is a **Temperate forest** zone on ground that the
  **terrain** makes steep: the biome gives the cover, the height map gives the slope, and the costs
  multiply. On a map without terrain, a zone in a non-biome style that counts as Mountains plays the role of
  relief and overlaps the forest. Alpine is for ground above the tree line.
- **Shared borders.**
  - Suggest builds every region from one label grid. The real build traces it as **arcs between junctions**
    and simplifies each arc once, so two neighbours store the same points along their border. (The mockup
    contours each region from the same grid; neighbours match to within a pixel.)
  - Hand-drawn and Find areas zones share borders by snapping, as approved.
  - Moving a shared corner with the existing snap moves both.
- **Transitions.** **Soft edges** is a view option in Layers → Biomes (with Patterns, Relief and Legend,
  `d18`). It blurs the fills' edges into each other for an ecotone look. It is a per-device view setting
  that is not saved in the file, and it is drawn in the saved picture when on. Data never stores gradients;
  if a wide transition matters, it is its own zone (a "Forest edge" scrubland).
- **Labels.** Biome zones are usually unnamed and the legend explains them. A named biome zone ("Tharn
  Desert") gets its name in the map's italic lettering at a point well inside it (the region's deepest
  cell). Several desert pieces can be one feature group with one name, using groups as built.
- **Legend.** A small card at the bottom-left of the map (top-left on a phone, collapsed by default). It
  lists the biome styles of visible zones, and while suggesting the ghosts' biomes too, marked as dashed.
  In the Temperature and Rainfall views it becomes the colour scale. Readers see it as well, and it can be
  included in the saved picture.
- **Relief.** With terrain, the existing Relief view (H) shades over the biome fills. That is what makes a
  biome map read as a physical map (`d18`).
- **Route check.** This is a small card in the side bar (Suggest, Layers and Edit tabs) that ships with
  Find paths' routes: "Harbor → Ostmere by cart: 28½ days without biomes, 35 with the biomes drawn,
  +6½", plus the km crossed in each biome with its multiplier. Both routes are drawn: dashed without
  biomes, solid with them (`d10`, `d12`).
  - It makes the meaning of a biome visible the moment it is accepted.
  - In the mockup the cart's route abandons the open interior for the coast road once the scrub and
    deserts are accepted. On foot the trip goes from 10 to 11½ days.
  - It can be the Find paths Route itself rather than a separate card (decision 3).

## 4. Time, offline, phone, keyboard

**Biomes in time.** Nothing new is needed; this is stage 6 as built.

- A forest that is cleared is a Temperate forest zone tied to a span that ends ("Gone: ended year 340").
- A spreading desert is one zone with **later shapes** ("From the Long Drought, year 512"). Routes,
  rivers, Explore and the legend use the shape in force at the time bar's year.
- Suggest biomes works on one climate, today's. Ghosts are never tied to time. A different climate per era
  ("the Ice Age map") is a separate map or later shapes drawn by hand.
- Later, if asked for: "Suggest for this era" with its own temperature shift.

**Offline.**

- Biome styles, patterns, the legend and the route check need no connection: they are code and library
  files.
- Suggest biomes runs in Find paths' worker on the terrain, which is available offline whenever the height
  map is on the device (Terrain dialog, Offline). When the height map is not on the device, the tool is
  disabled with "The height map isn't on this device".
- Accepting zones goes through the save queue like any edit.
- Explore needs a connection, as today.

**Phone (installed iPhone app).**

- The tools sit at the bottom: Select, Zone and Suggest. Find areas is on the phone too, as approved; the
  mockup hides it for room.
- Suggest's strip sits above them: Biomes/Temperature/Rainfall, "21 suggestions", **Options** and **Accept
  all**. Options opens the wind dial and the sliders above the strip (`p01`).
- **A tap accepts** the ghost under the finger and shows a toast, "Accepted: Temperate forest · Undo"
  (`p02`). One finger pans and two fingers zoom, as always.
- The Suggest list, Styles and Layers are in the bottom sheet (`p03`).
- The style picker opens as a sheet above the strip (`p04`).
- There is no hover on a phone, so a tap on an accepted zone selects it and its Edit tab shows the speeds
  and the Explore line.

**Keyboard.**

| Key | What it does |
| --- | --- |
| B | Suggest biomes |
| 1 / 2 / 3 | Biomes / Temperature / Rainfall view |
| Enter | Accept the ghost under the pointer |
| ⇧Enter | Accept all |
| Delete | Skip the ghost under the pointer |
| Esc | Back to Select |
| H | Relief |
| Z, Enter | Finish a hand-drawn zone |
| ⌘/Ctrl+Z, ⇧⌘/Ctrl+Z | Undo, redo |

- Arrow keys turn the wind dial, which works as a radio group with one tab stop.
- Sliders are ordinary range inputs.
- Every ghost can be reached without a pointer through the Suggest list's Accept and Skip buttons, which
  have labels such as "Accept Desert (sand), 5,680 km²".
- The status line is `role="status"`.
- All of these go in the "?" sheet and the tooltips. B is free in the map scope.

## 5. Data (additive; old files keep their bytes)

**A biome style** is one optional object on a map style. The file stays `version: 1`, `biome` goes at the
end of `itemKeys`, and styles merge per style by id as today:

```jsonc
{ "id": "strsand1", "name": "Desert (sand)", "for": "zone", "color": "#e6c47a", "width": 1, "dash": "solid", "fill": 0.5,
  "pattern": "dots",                       // optional, any zone style may have one; left out: none
  "biome": {
    "like": "desert-sand",                 // the base biome: one of the 15 built-in keys
    "speed": { "foot": 0.6, "horse": 0.55, "cart": 0.35 },  // optional; left out: the base biome's
    "rivers": "dry",                       // optional: normal | dry | marsh | source
    "explore": "in the sand desert"        // optional: Explore's words
  } }
```

- `countsAs` on a biome style is derived from `biome.like` and not stored. If both are present, the biome
  wins and the Styles panel shows it read-only.
- An older app keeps the `biome` and `pattern` keys (`passthrough`) and draws the zone in its colour.
- **Zones do not change.** A biome zone is a zone whose `style` is a biome style.
- **No layer field.** The Biomes layer is an ordinary layer and is recognised by nothing but its name, for
  defaults.
- **Climate settings** (Suggest's wind, latitude, span, temperature, wetness and smallest zone) are one
  optional object at the end of the map file's `TOP`, merged as one value like `terrain`:
  `"climate": { "wind": "W", "lat": 34, "span": null, "temp": 0, "wet": 1, "minArea": 150 }`. They are saved
  only when the owner accepts something, so opening and closing the tool changes nothing. On a child of a
  globe map, `lat` and `span` come from the globe.
- Ghosts and skipped ghosts are never saved.
- Route speeds per way of travelling stay where Find paths' decision 2 put them. Per-world travel settings,
  if they come later, scale the biome multipliers; they do not replace them.

## Decisions for the owner

1. **Where a biome lives.**
   - **(a, recommended)** On the style: a `biome` block on a zone style (base biome plus optional
     overrides), with "counts as" derived from it. One place for look and meaning, library-wide, and zones
     unchanged.
   - (b) A `biome` field on each zone, independent of its style. This is more flexible ("Realm style,
     desert"), but it means two sources of colour and meaning, and a desert can look like a forest.
2. **Which ships first.**
   - **(recommended)** First: biome styles with patterns, the starter set, the style picker for Zone and
     Find areas, the Biomes layer, the legend, routes and Explore reading biomes, and "dry out"/"marsh"
     for rivers. Second: Suggest biomes, once terrain (and, later, inferred terrain) is in.
   - Or all at once (about 4 more days before anything ships).
3. **Showing what a biome does to travel.**
   - **(a, recommended)** No separate route card in the product. The Find paths Route already gives times;
     its bar gains "+6½ days from biomes" and the km crossed per biome. The hover tag gives each biome's
     multipliers.
   - (b) The mockup's standalone route check card. It is clear for teaching, but it is a second route tool.
4. **One biome per place.**
   - **(recommended)** Overlaps are allowed, and the smallest containing zone wins (oasis in the desert).
     The rule matches the drawing order and needs no validation.
   - Or forbid overlaps: Make zone would clip new biome zones against existing ones. That is tidier data,
     but an oasis means cutting a hole, which zones do not have (Find areas decision 1).

## Build plan (one engineer, about 11–13 days; the first release about 7)

1. **Schema (1 day).** `pattern` and `biome` on `MapStyle` (zod, `itemKeys`, the refine "zone only"),
   `BIOME_KINDS` with the defaults table in `packages/schema` (shared with the server for Explore), the
   starter biome styles and "Add the usual biomes", and derived `countsAs`. Tests: old styles files
   round-trip byte for byte, merge per style, and a derived counts-as.
2. **Drawing (1.5 days).** `map/patterns.ts` (16 glyph tiles, cached per colour and device pixel ratio,
   screen-constant), the renderer's zone fill with pattern and multiply, area-descending order within a
   layer, Soft edges, the legend component (map and saved picture), and the Biomes layer created on first
   use. Tests: pattern tiles are seamless (edge pixels empty), and the legend lists only visible biome
   styles.
3. **Style picker and Styles panel (1.5 days).** A `StylePicker` listbox with swatches and groups, used by
   Zone, Find areas and the Edit tab; the biome editor in Styles (behaves like, speeds, rivers, Explore
   words, reset); + New biome. Keyboard as above.
4. **Meaning (2 days).** `biomeAt(map, point, year)` (the smallest containing zone, the shape in force),
   used by:
   - Find paths' `cost.ts`: the multipliers.
   - `hydro.ts`: runoff weight, loss per km, marsh endings.
   - the server's discovery context: the "land here" line.
   - the hover tag.

   Tests: oasis in desert, a time-shaped desert, a cart blocked by jungle except on the road, a river ending
   in a marsh.
5. **Suggest biomes (3 days, second release).** In Find paths' worker: `climate.ts` (temperature, the
   wind sweep with lateral mixing, the rain blur, the Whittaker table, wetland from accumulation),
   `regions.ts` (majority filter, merge of small regions, labels, arcs between junctions simplified once,
   coast from the terrain's sea-level contour). The tool, its bar and the Suggest tab follow the mockup,
   with accept, skip and Accept all as history steps, and `climate` on the map file.
   Tests: a west wind over a north–south ridge gives a wetter west and a drier east; a cold top gives
   alpine/ice; neighbours share identical border points; skipped and accepted ghosts survive a slider change.
6. **Browser tests (1 day).** A fixture map with terrain. Desktop: Add the usual biomes, draw a desert by
   hand, a route by cart gets slower, Explore's request carries the biome line; Suggest: wind east moves the
   desert, accept one, Accept all, undo. Phone: tap to accept, Options, sheet.
7. **Docs.** `docs/designs/stage-<n>-biome-zones.md` from this proposal once approved.

## Approved decisions

The owner approved the design with these choices. Where they differ from the proposal above, these win.

1. **All at once.** Everything ships together, including **Suggest biomes**: terrain, latitude and
   temperature, moisture with the rain shadow, the world settings for wind direction, temperature and
   wetness, and ghost zones accepted one by one or all at once. It works with a real height map, with the
   guess from the picture, and later with an inferred height map: it reads the height field through the
   same terrain function Find paths uses, so whatever that function returns is what it classifies.
2. **A biome is a field on each zone, independent of its style** (the owner chose the proposal's option
   (b) over (a)). So that it stays sensible:
   - The zone's **style keeps giving its colour and look**. The **biome gives meaning**: route speeds,
     river behaviour and Explore's words.
   - The biome **draws its pattern over the zone's fill**. Patterns are on by default and can be switched
     off for one zone or for the whole map view.
   - A set of **starter biome styles** ("Add the usual biomes") is offered as a convenience, so new biome
     zones look right; picking a biome for a zone in Zone, Find areas or the Edit tab also picks its
     starter style when the zone has none. But a zone in any style can carry any biome.
   - **"Counts as"** for a zone comes from its biome when it has one, else from its style.
   - The field lives on the zone in `packages/schema/src/maps.ts` (additive: old files keep their bytes,
     merged per item, checked by the server), and the biome kinds and their defaults table live in
     `packages/schema`, shared with the server for Explore. Custom biomes (the owner's own, such as the
     Blightlands) are kept once for the library, as styles are, in `.frontier/biomes.json`, and behave
     like one of the built-in kinds with their own numbers and words.
3. **Overlaps are allowed; the smallest containing zone wins** (an oasis in a desert).
4. **Travel: no separate route card.** Find paths' Route bar gains "+6½ days from biomes" and the km
   crossed in each biome; the hover tag gives each biome's multipliers.

### What release 21b built

**Data.**

- A zone's `biome` (a built-in key such as `desert-sand`, or the id of one of the owner's biomes) and
  `pattern: false` (its pattern not drawn) go last on the zone; the map's `climate` goes last in the
  file. Old files keep their bytes; both merge with their item, the climate as one value. A biome
  that is not there is kept and counts as none.
- `packages/schema/src/biomes.ts` holds the fifteen kinds with their speeds, river rules, Explore words
  and usual styles (ids `bio…`), the sixteen patterns, the owner's biomes file (a third library item
  file, `.frontier/biomes.json`, merged biome by biome and kept on the device like the styles file),
  and `featureCountsAs`: a zone counts as its biome's ground, else as its style says.
- An owner's biome behaves like a kind, with its own pattern, speeds, river rule, Explore words and
  the colour of new zones; its usual style is a zone style under the biome's own id.

**Look.**

- The pattern is drawn over the zone's own fill in a darker shade of its colour, 32 screen pixels a
  tile at any zoom, anchored to the map. Patterns are on unless turned off for a zone (its Edit tab)
  or for the view (Layers → Biomes: Patterns, Soft edges, Legend on the map, kept on the device).
- Within a layer, biome zones are drawn under its other zones, the largest first.
- Soft edges blurs biome fills (a canvas filter: browsers without one draw them sharp).
- The legend card sits at the bottom left (top left on a phone, below the terrain chip), lists the
  biomes drawn now in their zones' usual colour and, while suggesting, the ghosts' biomes as
  "suggested"; in the Temperature and Rainfall views it is the scale. The saved picture draws it.
- The Biomes layer is made first in the layer list on the first biome zone, and its row says "drawn
  under the rest".
- Fixed on the way: a zone on a flat map is filled by its flat area. A large zone in a picture's
  pixels (its positions read as latitudes beyond 90°) was left unfilled.
- **Not built:** a named biome zone's name written in italics at its deepest point (zones are named
  as before); the multiply blend (the features' canvas lies above the picture's, so a blend there
  would not reach the picture).

**Making them.**

- The biome picker (swatches, groups Water · Cold · Temperate · Warm · High · Made by you, each with
  its cart speed; typing narrows it; a sheet on a phone) is in the Zone tool's hint bar, in Find
  areas' bar beside the style, and in a zone's Edit tab. The Zone tool and Find areas share one choice.
  A zone made with a biome goes to the Biomes layer in the biome's usual style (added to the library
  the first time); a style chosen in Find areas is kept. Choosing a biome in the Edit tab keeps the
  zone's style when it has one.
- The Styles tab has "Add the usual biomes", the built-in biomes with their cart speeds, and the
  owner's biomes with + New biome and an editor (name, behaves like, pattern, colour, speeds, rivers,
  Explore words, Reset).
- **Suggest biomes** (B, leaf icon) reads the terrain in use through Find paths' engine: a height map,
  the guess from the picture (marked in amber), or a height map inferred from the picture once that
  exists. Its bar has the wind dial (a radio group; arrows turn it), latitude, N–S span (no less than
  the scale gives), temperature, wetness, smallest zone, the terrain line, Biomes · Temperature ·
  Rainfall (1, 2, 3), Skip all, List and Accept all (⇧Enter). A click (a tap) accepts the ghost under
  the pointer, Enter too; Delete skips it. The Suggest tab lists the ghosts by biome with Accept and
  Skip, and Show them again. Accepting is a map change undone by Undo; skipping is the tool's own
  step. The climate is kept on the map when something is accepted. It works on a grid of at most
  160,000 cells, so every setting answers at once.
- Neighbouring ghosts are outlined from one grid between the middles of its cells, so they meet to
  within a cell; **not built:** arcs between junctions simplified once (identical shared points).
  Seas and coasts are never suggested. **Not built:** on a child of a globe map, the latitude and span
  taken from the globe (Suggest biomes, like Terrain, is for flat maps).

**Meaning.**

- Find paths: each cell lies in the smallest biome zone that holds it; a biome's multiplier replaces
  the picture's forest and marsh on open ground (0 is no way: a cart crosses the jungle only on its
  road); slope still comes from the heights. A dry biome gives a fifth of the water and takes about
  4 cells' worth a km from a river crossing it, so a small river "dries out in the Tharn Desert" and
  a big one crosses; a river reaching a marsh "ends in the Mire of Ost"; "rivers rise here" doubles
  the water, so likely rivers find more sources. The hooks into `cost.ts` and `hydro.ts` are one call
  each, into `findPaths/biomes.ts`.
- The Route bar adds "+6½ days from biomes" and the km of the route in each biome with its
  multiplier; the hover tag and a zone's Edit tab and card give a biome's speeds and river rule.
- Explore: the land a place lies in ("The land here: in the sand desert (Tharn Desert); rivers lose
  water and can dry out.") is given as map context, from the smallest biome zone that holds it, named
  or not. **Not built:** its distance to the coast and its height, which the server does not work
  out.
