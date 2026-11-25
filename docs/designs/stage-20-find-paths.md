# Find paths: rivers, routes and traced lines from the map's picture and its heights

- **For:** the owner's ask, "Like you made auto zones, can you make a mockup for an automatic path
  tool where I decide on a type of path like rivers, routes, etc? Maybe if I provide height maps you
  could have an easier time making rivers, and by choosing two points on a map you could also infer
  from the graphics/height map the best travelling route."
- **Status:** approved and built; see "Approved decisions" at the end for what the owner chose and how release 20 built it
- **Mockup:** `ux/auto-paths-mockup.html`. A working page, not a picture. It makes a height field,
  paints a fantasy map *from* it (sea, coast, lowland, forest, mountains with symbols, three painted
  rivers with tributaries, a dashed painted road with a bridge, five towns, parchment grain), then
  looks at that picture the way the real tool would. River, Route and Trace all work, with the height
  map on or off. "Phone view" in the top strip opens it at iPhone width. Screenshots:
  `ux/autopaths-shots/` (desktop `d00`–`d31`, phone `p0`–`p11`).
- **Read for this:** the approved Find areas design (`stage-19-find-areas.md`) and its code
  (`apps/web/src/map/findAreas/`, `FindAreas.tsx`), feature groups (`stage-19-feature-groups.md`),
  maps (`stage-4`, `stage-13`), `packages/schema/src/maps.ts` and `mapStyles.ts`, `map/snap.ts`,
  `curveSetting.ts`, `lengthText.ts`, `keys.ts`, `packages/geo`.

## What's wrong today

A path is drawn one point at a time with the Path tool (P). A river on a painted map has dozens of
bends; a road wanders between towns. Tracing either is slow, and inventing one (a river that looks
right for the terrain, the way a cart would really go from Harbor to Ostmere) is guesswork: the map
knows nothing about hills, water or roads. Find areas taught the map to read its picture for *areas*.
This is the same idea for *lines*, with one addition: a **height map**, which the picture cannot
replace.

## The tool

**Find paths** sits beside Find areas in the map tools, with key **D** (free in the map scope, and
the key next to F, so the pair sits under two fingers) and the Lucide `Route` icon. It acts only
while editing. Its bar has the same shape as Find areas': options above, and a bottom line with a
switch on the left, the status in the middle, and **Make path** on the right.

The switch on the left is the **kind of path**, chosen first (keys 1, 2, 3):

| Kind | You do | It gives |
| --- | --- | --- |
| **River** | Click where a river rises (or where it meets the sea) | The river's course downhill to the sea, a lake, another river or the map's edge |
| **Route** | Click the start, the end, and stops on the way if wanted | The quickest way for a chosen way of travelling, with its length and a rough travelling time, and other ways to choose from |
| **Trace** | Click a river, road, coast or border already painted in the picture | That painted line as a path, to its ends or to a second click, with side branches offered |

In all three, what would be made is shown first, in the selection colour with marching dashes and its
points as dots, exactly as Find areas shows a zone before Make zone. Things that are *offered* but
not yet taken (likely rivers, other routes, side branches) are thin grey or blue dashes, "ghosts";
pointing at one lights it and a click takes it. **Make path** (Enter) makes the path in the current
layer with the path style chosen in the bar, selects it and opens its Edit feature tab with the label
ready to type over. The tool stays on.

### River

- **Point:** a faint dashed line shows the course a river would take from under the pointer, live
  (mockup: `d01`). **Click** and it becomes the proposed river: from the click down to the sea
  (`d02`). The bar says "River · 184 km · reaches the sea · 13 points".
- **From its source | From its mouth** (key X switches). From its mouth: click the coast where the
  river comes out, and it is followed uphill along the branch that carries the most water to where
  the stream begins (`d09`).
- **Show likely rivers:** every stream that drains at least the area set by **Above** (80 to
  1500 km² in the mockup) is drawn as a blue ghost (`d05`); the status counts them. Click one to take
  it. Rivers already made drop out of the ghosts, so a river system is built by clicking: main stem,
  Make path, tributary, Make path.
- **Meander** (straight … winding): how much the river winds. It winds more on flat ground and
  hardly at all in the mountains (`d03`).
- **Tributaries:** with snapping on, a river that reaches a river already on the map **ends exactly
  on it** and the bar says "joins River 1" (`d06`). The water of later rivers is drawn towards rivers
  already made, so tributaries find them.
- **Lakes:** a river that reaches a hollow in the heights runs to the lowest point, crosses the
  hollow in a straight line and leaves over its lowest rim. A zone in the Water style counts as a lake
  to stop at ("ends in Lake Wyn"). The mockup's map has no lake; this is in the build plan.

### Route

- **Click the start, then the end.** A click near a marker snaps to it and takes its name, so the
  route is "Harbor → Ostmere" (`d15`). A third click adds a **stop** where it fits best along the way.
  **Drag** a stop or an end to move it and the route follows the finger (`d18`); Alt-click a stop
  removes it.
- **Travelling:** On foot · Horse · Cart · Ship. This changes what is slow and what is impossible:

  | | Open land | Forest | Road | River without a bridge | Slopes | Sea |
  | --- | --- | --- | --- | --- | --- | --- |
  | On foot | 4 km/h | 2.8 | 5 | ford, slow | Tobler's walking rule | no |
  | Horse | 7.5 | 3.4 | 10 | ford, slow | steeper penalty | no |
  | Cart | 2.3 | 0.9 | 5 | nearly impassable | very steep penalty | no |
  | Ship | as on foot | | | | | 9 km/h |

  In the mockup, Harbor → Ostmere on foot takes the painted road as far as it helps and then a pass
  over the Grey Peaks (306 km, about 10½ days); by cart it keeps to the road, crosses the river at
  the painted bridge and goes round the mountains by the east coast (478 km, 27 days; `d16-route-cart`);
  by ship it sails round the north cape (6½ days; `d16-route-ship`). The numbers are defaults the
  owner can change per world later (decision 2).
- **Other ways** as ghosts with a label on each, and as a switch in the bar: **Fastest**,
  **Flattest** (avoids climbing even when longer; on foot it goes round by the west coast, 14 days,
  `d17`), **Avoid water** (no fords, no sea: bridges only). One that is the same as Fastest says
  "same"; one that does not exist says "none". Click a ghost, its button, or press X to take it.
- **The bar says** "Harbor → Ostmere · 478 km · about 27 days by cart · 1 bridge". Fords,
  bridges and where a ship is boarded are marked on the route with small tags.
- **Existing roads are quicker, existing rivers are in the way.** Both the ones painted in the
  picture (when *Follow drawn lines* is on) and the map's own paths: a path in the River style is a
  river to later routes; a path in the Road or Trail style is a road (decision 4).

### Trace

- **Point** at a painted line and it lights up end to end with "Click to follow this river" (`d23`).
  **Click**: the line is followed through dashes, a bridge and a town's ring to both of its ends.
- **Click the same line again** and the trace stops there instead (`d27`): the stretch between the
  two clicks.
- **Side branches** (tributaries, forks) appear as grey ghosts; click one to add it (`d24`). Each
  added branch becomes its own path ending exactly on the main one, and Make path becomes "Make 2
  paths".
- **A closed line** (a coast, a lake shore) is followed all the way round (`d30`: the island's
  coast, 996 km, 86 points).
- The path style is guessed from the line's colour (blue: River; red or brown: Road; otherwise
  Border) and can be changed in the bar before Make path.

### After Make path

- The new path is selected with its Edit feature tab open (label, layer, Straight/Curved, path
  style, length, and a note such as "Fastest way by cart: about 27 days at 8 hours a day (1 bridge).
  Terrain from the height map.").
- **Add to "‹path›"**: while a path is selected, the proposed one can be joined to it end to end
  instead (extending a river upstream, continuing a road).
- **Group n paths** (Ctrl/⌘+G) appears in the bar once two or more paths have been made in a row
  (`d07`, `d08`): a river and its tributaries become one group, ready for a name. This uses feature
  groups as built; nothing new.
- **Undo** (Ctrl/⌘+Z) takes back the last click, drag, Make path, Add to or Group. **Esc** clears
  what is proposed; again deselects; again returns to Select.

## Height maps

### How the owner gives one

A height map is **a picture added to the map like any other, marked as its height map**: greyscale,
white is high, black is low. In Layers → Pictures it shows with a "Height map" badge and a closed
eye (mockup: the "Greywater heights" row):

- **Add:** "Add a picture" as today, then "Use as: Picture | Height map" (or a row menu, "Use as
  height map"). One height map per map; marking a second asks which to keep.
- **Where it lies:** a picture already has an `extent`. A height map starts with the **same extent
  as the map's main picture**, which is right when both came out of one program (Wonderdraft,
  Azgaar, Gaea, a painting with a height layer). If it does not line up, the picture's existing
  position fields move and scale it, with the height map shown half-transparent over the map while
  they are open.
- **Sea level:** a slider in the tool's bar. It starts at the grey that best matches the picture's
  coast (the level at which the height map's shoreline lies closest to the painted one), so most
  owners never touch it. Moving it shows at once what floods (blue wash) or dries (sand wash)
  (`d13`), and everything proposed is worked out again.
- **Top height:** "White is ‹2600› m" in the picture's row, used for slopes and for "falls about
  1410 m". Optional; without it slopes are relative, which is enough to order routes but not to
  time them well.
- **Never drawn as a picture.** It is hidden from the normal view and from viewing. **Show relief**
  (key H) in the bar draws the terrain *in use* over the map as soft shading and contour lines
  (`d10`), so the owner can see what the tool believes.

In the map file this is one optional field on an image, `role: "height"` (and `seaLevel`, `top`
beside it). Images are `.passthrough()` already, the file stays version 1, and an older app draws
nothing new (the image is `visible: false`).

### Without one

The tool still works, and **says so**: where the bar normally reads "Terrain from ‹picture name›" it
shows an amber "Guessing terrain from the picture", and made paths carry "terrain guessed" in their
note. The guess (mockup: height map chip off, `d11`, `d12`, `d19`):

- **Sea and lakes** by colour (blue-grey, large); **forest** by colour (green, darker); **high
  ground** where the picture is painted as upland or crowded with mountain symbols.
- **Heights**: rising gently with distance from the sea, plus a dome over the high ground.
- **Painted rivers are evidence**: water is drawn along them ("stream burning"), so a new river
  that reaches a painted one follows it to the sea.

What that is good for, honestly: Trace is unaffected (it never uses heights). Routes are reasonable
(water, forest, roads, bridges and "mountains are slow" are all there; in the mockup the guessed
route differs little from the true one). **Rivers are rough**: they run straight to the nearest
coast and miss real valleys (`d11` beside `d10`, and the angular ghosts in `d12`). Show relief makes
the guess visible, which is the honest way to explain why.

### Should Frontier make a height map, or let the owner paint hints?

**Recommended, in this order:**

1. **Reuse what the map already says.** Zones in the Water, Forest and Marsh styles (they exist in
   the starter styles) count as water, forest and marsh; a zone in a new starter style "Mountains"
   counts as high ground. These are certain where the picture is a guess, cost nothing new to
   learn, and Find areas makes them in two clicks. Paths in River and Road styles count likewise.
2. **"Keep this guess as a height map"** (later, small): saves the guessed terrain as a greyscale
   picture in the vault, marked as the height map, so the owner can open it in any paint program,
   fix it, and from then on have a real one. This turns the guess from a hidden heuristic into
   something editable.
3. **No terrain brushes in Frontier.** A mountains/water/forest brush is a paint program inside the
   map editor: a large new surface (brush sizes, undo, storage of a raster) for something zones and
   an external editor already do.

## Controls

| Control | What it does | Default |
| --- | --- | --- |
| **River · Route · Trace** (1, 2, 3) | The kind of path. Changing it clears what is proposed. | last used |
| River: **From its source / From its mouth** (X) | What a click means. | source |
| River: **Meander** | How winding, more on flat ground. | 3 of 8 |
| River: **Show likely rivers**, **Above** ‹n km²› | Ghosts for every stream draining at least that much land. | off, 220 km² |
| Route: **On foot · Horse · Cart · Ship** | What is slow, what is impossible. | on foot |
| Route: **Fastest · Flattest · Avoid water** (X) | Which of the ways found is the proposed one. | fastest |
| **Height map** | Use the map's height map. Off: guess from the picture. Disabled with "This map has no height map: add one in Layers" when there is none. | on when there is one |
| **Sea level** | Heights below it are sea. Only with a height map. | matched to the painted coast |
| **Show relief** (H) | Draws the terrain in use as shading and contours. | off |
| **Follow drawn lines** | On: painted rivers pull water and block travellers; painted roads are quick; bridges are found where a road crosses a river. Off: "ignore the picture's lines", only terrain counts. | on |
| **Points** (fewer … more) | How closely the path follows what was found (0.5 to 7 px). The count shows live. | middle |
| **Straight / Curved** (C) | The map's existing curve setting (`frontier:map-curve`). Curved paths are thinned further, since a curve needs fewer points. | as last set |
| **New path in** ‹layer› ‹style› | Where Make path puts it, and its path style. Remembered per kind (rivers to Waters in River, routes to Routes in Road). | current layer |
| **Snapping** (S, the existing magnet) | Rivers end exactly on rivers; routes start, stop and end on markers and on the ends of paths; a traced border lands on the corners of zones beside it, as Find areas' zones do. | on |
| **Clear** (Esc), **Add to "‹path›"**, **Group n paths** (Ctrl/⌘+G), **Make path** (Enter) | As described above. | |

**Keys (map scope, editing):** D Find paths · 1 2 3 kind · X the kind's switch · C curved · H relief ·
S snapping · Enter Make path · Esc clear, deselect, Select · Ctrl/⌘+Z, Shift+Ctrl/⌘+Z · Ctrl/⌘+G
group. F stays Find areas. All go in the "?" sheet and the tooltips.

## On a phone

- The tools sit in the bottom bar; Find paths is the route icon beside the wand (`p0`).
- Just above is the same one-line strip as Find areas': the three kinds as icons, a short status
  ("357 km · 9½ days · 1 bridge"), **Options**, and **Make path** (`p4`). Options opens the rest
  above the strip, the kind's own controls first (`p2`, `p5`), scrolling if tall.
- **A tap is a click**: tap a source; tap start, then end; tap a painted line. There is no hover, so
  the proposed path is the feedback, and River shows its ghosts only when Show likely rivers is on.
- **Drag a stop with one finger** (`p7`): a finger that goes down on a stop (a 24 px reach) moves
  it; anywhere else it pans. Pinch zooms. The route is worked out again as the finger moves (about
  20 ms a time), and the other ways when it lifts.
- Tapping a ghost takes it; ghosts have a 14 px reach for fingers.
- Make path opens the bottom sheet on the new path's Edit feature tab (`p3`).

## Empty and edge states

- **No picture and no height map:** the tool is disabled, "Find paths needs a map image or a height
  map".
- **A height map but no picture** (or the picture hidden): River and Route work; Trace is disabled,
  "Trace needs a picture".
- **A schematic map:** Trace only (positions mean nothing physical).
- **No scale on the map:** lengths show in map units as today, and a route shows no time but
  "Set the map's scale to see travelling time" with a link to the Measure tool's "set the scale".
- **Before any click:** "Click where a river rises: it runs downhill to the sea" / "Click the
  start, then the end · markers are snapped to" / "Click a river, road or coast painted in the
  picture".
- **Viewing mode:** the tool is not there.

## The technique

Everything runs in the browser, in **Find areas' worker**, reusing its decode, working copy, Lab
colour, ink detection and frame code. No server, no AI. The mockup runs the same steps on the main
thread in plain JavaScript; its timings, in headless Chromium on a 960×640 picture with a 480×320
grid: looking at the picture 150 ms, terrain and water 25–40 ms, one route 15–25 ms, a trace 2–35 ms.

### 1. Looking at the picture (once per image; shared with Find areas)

1. Working copy of at most 2 MP, to **Lab**, **ink** by black top-hat (`lab.ts`, `ink.ts`, as now).
2. **Ground classes** from the smoothed colour: water (blue-grey hue, pieces smaller than a pond
   dropped), forest (green and darker than the land's median), upland (the painted upland tint, plus
   the density of small dark marks that are not letters: mountain symbols and hatching). Thresholds
   are relative to the picture's own colour clusters, not fixed, and the owner's zones override them.
3. **Line families** from the ink's colour: blue ink on land is river, red and brown ink is road,
   the rest is coast, border or text. A traced line teaches the tool that line's colour for the map.
4. **The cell grid.** Terrain, water flow and routes use a coarser grid (the mockup: 2×2 pixels;
   the real tool: about 0.5 MP of cells, e.g. 900×560). Thin lines are kept when shrinking by
   *any-pixel* pooling, and a river is thickened to be closed for four-way steps so a diagonal step
   cannot slip through it.
5. **Height map**, when there is one: resampled onto the same grid through its own extent
   (bilinear), lightly blurred (one cell) to hide 8-bit steps.

One finding from the mockup that also matters to Find areas: closing gaps with a **square**
dilate-then-erode does not close gaps in thin *diagonal* dashed lines (the eroding square never
fits). Tracing therefore grows the line's mask by 3 px instead of closing it, and centres the result
on the ink afterwards.

### 2. Rivers: D8 flow with pits handled, and flow accumulation

1. **Surface:** the height map, or the guess. Sea is everything below sea level (or the water
   class). With *Follow drawn lines*, painted river cells are lowered a little (**stream burning**),
   as are rivers already on the map.
2. **Priority-flood** (Barnes et al.): start from every sea cell on a shore and every cell on the
   map's edge, and always take the lowest cell reached so far from a heap. A cell lower than the one
   it was reached from is in a pit; it is raised to just above (by a tiny step), which is the same as
   filling the pit to its lowest rim and gives the flat a slope towards the outlet. No river ever
   stops in a hollow, and no cell needs visiting twice.
3. **D8:** each cell drains to the steepest of its eight neighbours on the filled surface.
4. **Flow accumulation:** walking the flood order backwards, each cell adds its count to the cell
   it drains to. A cell's count is the land upstream of it; "likely rivers" are the cells above the
   chosen count, cut into stems and tributaries (longest first).
5. **A click** follows the drain directions from that cell (a few hundred steps: under a
   millisecond). From a mouth it follows the largest inflow upstream.
6. **Lakes:** a filled pit deeper and wider than a threshold is a lake; the river is cut at its
   shore and resumes at the outlet (build plan step 3).
7. **To a path:** cell centres → three passes of 1-2-1 smoothing → resampled every 2 px →
   **meander** (a sideways wobble of mixed wavelengths along the normal, scaled by flatness, tapered
   at both ends) → **Douglas–Peucker** (`simplify.ts`, made to take open lines) → stored as `points`
   with `curve: "smooth"` when Curved is on. The app's curve already passes through every stored
   point (`packages/geo/src/curve.ts`), so no separate curve fitting is needed: thinning *is* the
   fit, and its tolerance is measured against the curve when Curved is on.

D-infinity or multiple-flow methods spread water more naturally on open slopes, but a map river is a
single line and D8 gives exactly that. On the guessed surface, large flats make straight parallel
streams; that is the visible cost of guessing, not a fault of the method.

### 3. Routes: least time over a cost surface (A*)

1. **Speed in each cell** for the way of travelling: by ground class, by road, by river (ford
   speed unless a road is on the same cell: a **bridge**), sea (impassable, or sailing speed for
   Ship). Zones can add cost: a border crossing as a fixed delay when a route's two cells lie in
   different Realm zones (an option, off by default).
2. **Slope between two cells** scales the step, so the cost depends on direction (anisotropic). On
   foot this is **Tobler's hiking function**, speed ∝ exp(−3.5·|slope + 0.05|): fastest slightly
   downhill, about half speed at 20%. Horse and cart use the same shape with a steeper constant and
   no downhill bonus.
3. **A\*** on the eight-connected grid with a binary heap; time for a step is the distance times the
   mean of the two cells' hours-per-km times the slope factor. The heuristic is straight-line
   distance at the fastest speed there is (admissible, so the route is the true least-time one).
   Stops split the search into legs. **Flattest** multiplies each step by (1 + c·|slope|) and
   reports the real time; **Avoid water** makes fords and sea impassable.
4. **Any-angle:** eight-way paths have a staircase look and are up to 8% long. Rather than Theta\*
   (which assumes uniform cost between line-of-sight cells and so cuts corners across forest and
   slopes), the grid path is smoothed and thinned, then its length and time are measured again along
   the thinned line. That is what the mockup does; the stated length is of the path as drawn.
5. **No way:** if A\* exhausts the reachable cells, the tool runs the same search with sailing
   allowed and offers it (below).
6. **To a path:** as rivers, without the meander; stops stay exact points of the path. When a route
   runs along a painted road, the full-size refinement (below) pulls it onto the road's ink.

### 4. Trace: following the ridge of a painted line

1. **Seed:** the nearest ink within 6 px of the click; its Lab colour is the line's colour.
2. **Mask:** ink within ΔE 20 of that colour, grown by 3 px so dashes, a bridge or a town's ring do
   not break it (cached per colour: 10–25 ms the first time, then instant for hover).
3. **Main line:** breadth-first search from the seed to the farthest pixel A, then from A to the
   farthest pixel B; the path A–B is the longest way along the line (the classic two-sweep
   diameter). With a second click, simply the path between the two clicks.
4. **Closed lines:** cut the found half out of the mask; if A still reaches B, the other half
   completes the loop.
5. **Branches:** search outward from the main line; the farthest pixel more than ~26 px away is the
   tip of a branch, its path back is the branch; add it to the sources and repeat.
6. **Centre and smooth:** each point is moved to the middle of the ink measured across the line
   (the ridge), then smoothed and thinned as above. A thinning skeleton (Zhang–Suen) would give the
   same centre line with all branches at once; the search above is simpler, visits only the one line
   clicked, and orders the branches by length for free.

### 5. Working small, finishing sharp

As in Find areas: analysis on the working copy, then **refinement on the full-size image only along
the path**. For each point of a traced line or of a route on a painted road, read a short strip
across the line from the full image (tiles of 512×512, `refine.ts`) and move the point to the ink's
centre. Rivers and routes over open terrain need no refinement: nothing in the picture says where
within a cell they should be.

### 6. Globes

Find areas already analyses a globe's picture as the equirectangular plate it is stored as and
converts pixels to longitude and latitude (`frame.ts`). The same holds here, with three additions:

- **Distances.** A cell at latitude φ is cos φ as wide as it is tall. Step lengths in A\* and slopes
  in D8 use the true size (east–west steps × cos φ), and the heuristic is the **great-circle**
  distance, so routes near the poles are not penalised for crossing many narrow cells.
- **Wrap.** When the picture goes all the way round (`goesRound`), column 0 and the last column are
  neighbours in the flood, the A\* and the trace. A path that crosses the 180th meridian is written
  with `wrapRing`'s rule (longitudes kept continuous while building, wrapped when stored).
- **Poles.** The top and bottom rows are each one point; cells there are joined to all of that row.
  Lengths and times come from `measure(space, …)` as for any path.

In the first release the tool is disabled in a globe view with "Find paths works on flat maps for
now", unless decision 3 says otherwise; the grid code is written with a `neighbours(cell)` and
`stepLength(a, b)` pair so that the globe is an added frame, not a rewrite.

### Performance targets

| Step | Desktop | iPhone 13 |
| --- | --- | --- |
| Look at the picture (once, shared with Find areas, cached) | < 400 ms | < 1 s |
| Ground classes, line families, cell grid | < 150 ms | < 400 ms |
| Terrain and water (after the height map, sea level or Follow drawn lines changes) | < 80 ms | < 250 ms, debounced while the slider moves |
| A river from a click; hover preview | < 5 ms | < 10 ms (no hover) |
| A route (one A\* over ~0.5 MP of cells) | < 60 ms | < 200 ms; the other two ways follow one at a time |
| Dragging a stop | one route per frame at the working grid; at a half-size grid if a search takes over 50 ms | same |
| A trace (first click on a colour / later) | < 60 ms / < 10 ms | < 150 ms / < 25 ms |
| Memory in the worker, beyond Find areas' | ≈ 25 MB (heights, flow, three speed surfaces) | same; released on leaving the tool |

Searches report progress and can be cancelled by the next request, as Find areas' are.

### Is an AI step worth it?

**No, for the same reason as in Find areas, and one more.** The three jobs here are geometry on a
grid: classic methods are exact, instant, private and work offline on the phone. A chat model cannot
return an accurate polyline. The places a model could help:

- **A height map from the picture** (depth-estimation or image-to-heightmap models): results on
  hand-painted fantasy maps are plausible-looking but not consistent with the painted rivers, and it
  costs about $0.01–0.05 an image through a hosted image model plus a new provider key. The cheap
  guess plus the owner's zones gets most of the benefit.
- **Reading the legend** ("the dotted red lines are roads, blue are rivers"): one vision call to
  the app's existing chat provider, about $0.01, could set the line families and ground classes
  better than hue rules on an unusual palette. Worth considering later as "Ask AI what the colours
  mean", behind the same interface; not needed for the first version because one Trace click teaches
  the same thing.

## When it goes wrong, and what the UI does

| Case | What happens | What the UI offers |
| --- | --- | --- |
| **No way: water between the two points** | A\* finds nothing by land. | The bar turns red: "No way on foot from Harbor → Skerra: the sea is in the way. **Go by ship (6½ days)**", and the ship's route is drawn as a ghost with its boarding and landing points (`d21`, `d22`). A river with no bridge never blocks: it is forded, slowly, and the ford is marked; **Avoid water** shows the dry way if there is one. |
| **A point in the sea (or on a peak a cart cannot reach)** | The nearest passable cell within 5 cells is used; farther than that, "That is sea. Click on land" / the ship offer. | |
| **Flat height map** (a lowland, a plateau, an 8-bit map with wide steps) | Priority-flood still drains every cell, but flats give straight, parallel streams. | Meander hides it on a single river; the status adds "flat ground: the course here is a guess" when more than a third of the river lies on filled flats. Follow drawn lines or a Water zone pins it down. |
| **Noisy height map** (JPEG blocks, dithering, a photo) | Many tiny pits; streams wriggle cell to cell. | The one-cell blur at load, and thinning, remove most. "Points: fewer" smooths the rest. If over 10% of land cells were pits, the bar says "This height map is rough: rivers may wander". |
| **The height map does not line up with the picture** | Rivers cross painted coasts; the default sea level cannot match the shoreline. | When the best shoreline match is poor, a note on first use: "The height map's coast does not match the picture's. Check its position" with a link to the picture's position fields. Show relief makes it obvious. |
| **A painted river that runs uphill** on the height map (the artist's river and the heights disagree) | With Follow drawn lines on, the painted river wins: its cells are lowered until it drains, so new rivers join it and follow it. | The status notes "follows the painted river, against the height map, for 12 km". Off: the heights win and the new river leaves the painted one; the two visibly part. The owner chooses which is canon. |
| **Parchment texture, stains, grain** | Handled as in Find areas (smoothed colour for classes; ink is relative to its surroundings). Strong stains can flip a patch of ground class. | Classes only change speeds a little; zones override them. Trace is unaffected unless a stain crosses the line with the line's own colour. |
| **A label or symbol across a river or road** | The line's ink is interrupted for the width of a letter. The trace jumps gaps up to ~6 px; a wider label ends the trace there. | The trace visibly stops at the label; click the line beyond it and press **Add to "‹path›"**, which joins the two end to end. For routes and rivers, the broken painted line still counts on both sides. |
| **A label that touches a line of the same ink** (a coast and "Harbor") | The letters are offered as a short grey branch. | Branches are only offered, never taken without a click; ones shorter than ~26 px are not shown. |
| **Dashed and dotted lines** | Gaps up to ~6 px are jumped. Sparse dots are not a line. | Trace says "A mark, not a line"; draw it with the Path tool with snapping. |
| **Two lines of the same colour crossing** (two roads) | The trace takes the longest way through and offers the rest as branches. | Second click to say where it should stop. |
| **Coast or lake shore** | Followed all the way round and closed. | The status says so; if a zone was wanted, it suggests Find areas (F). |
| **Guessed terrain** | Rivers are rough, as shown. | The amber indicator, the note on the made path, Show relief. |
| **Very large pictures, slow phones** | The bar says "Looking at the picture…", then "Working out the water…"; clicks wait. | Esc or another tool cancels. |

## Decisions for the owner

1. **How a height map is given.**
   - **(a, recommended) As one of the map's pictures, marked "Height map".** One optional field on
     an image; it reuses adding, replacing, position and the vault's file handling; it is listed
     where the owner already looks. Sea level and top height sit on that picture.
   - (b) A separate "Terrain…" dialog with its own upload. Clearer for a first-time user, but a
     second place for pictures and a second position editor.
2. **Travelling time.**
   - **(a, recommended) Kilometres (the map's unit) and "about n days at 8 hours a day", with the
     speeds built in** for foot, horse, cart and ship, shown in a tooltip. Enough to compare ways
     and to write "ten days' walk". Needs only the map's scale, which exists.
   - (b) Per-world travel settings: speeds, hours travelled a day, and the chronicle's own units
     (a world with 10-hour days or named watches). Right for the lore, but it is a settings screen,
     a library file, and a link to chronicles; worth doing after the tool has been used.
3. **What ships first.**
   - **(recommended) Trace and Route first, River with them only if a height map can be added in the
     same release; flat maps only.** Trace is the surest win (every painted map has rivers and roads
     to pick up, and it needs no height map). Route works acceptably on a guess. River without a
     height map is the weakest part and would disappoint on its own. Coast/Border tracing comes free
     with Trace. "Trail" is a path style, not a separate kind.
   - Later: globes, lakes as zones, "Keep this guess as a height map", per-world travel settings.
4. **Do rivers and roads made here count for later routes?**
   - **(recommended) Yes, by style:** a path in the River style is a river (ford or bridge needed);
     a path in Road or Trail is a road (quicker); zones in Water, Forest, Marsh and Mountains styles
     are that ground. The map then gets smarter as it is drawn, and the owner's features outrank the
     picture's guess. It needs a "counts as" field on a style (River, Road, Water, Forest, Marsh,
     Mountains, nothing) so that renamed or new styles can take part.
   - Or: only the picture and the height map count. Simpler, but a river the owner has just made
     would be walked across as if it were not there.

## Build plan (one engineer, about 15–18 days; Trace + Route alone about 9–10)

1. **Worker groundwork (2 days).** Move the shared look (decode, working copy, Lab, ink) behind one
   cache used by both tools; `findPaths/classes.ts` (ground classes, line families), `grid.ts` (cell
   grid, any-pixel pooling, river thickening, `neighbours` and `stepLength` for a frame). Unit tests
   on small synthetic pictures (a blue line on tan, a dashed red diagonal, a sea and an island).
2. **Trace (2.5 days).** `trace.ts`: seed, mask, two-sweep main line, loop, branches, centring;
   `simplify.ts` gains open lines; full-size refinement along the line. Tests: a straight dashed
   diagonal comes back whole; a Y gives a main line and one branch ending on it; a ring closes; a
   word is "too short".
3. **Height map and water (3 days).** Schema: `role`, `seaLevel`, `top` on an image (`ITEM_KEYS`
   and the merge of item lists); Layers → Pictures: the badge, "Use as height map", hidden from drawing and
   from the saved picture; shoreline match for the default sea level. `hydro.ts`: heap,
   priority-flood, D8, accumulation, stream burning, lakes; the guess. Tests: a cone drains
   radially; a bowl fills and spills at its lowest rim; accumulation at a mouth equals the basin's
   area; no cycles.
4. **Routes (2.5 days).** `cost.ts` (speed surfaces per way of travelling, features and zones by
   their "counts as"), `route.ts` (A\*, legs, Flattest and Avoid water, fords, bridges and boardings
   along the result, the ship fallback). Tests: a wall with one gap is passed at the gap; a road is
   taken when it is at most a set detour; Tobler's times on a known slope; no way gives null and the
   ship offer.
5. **The tool in the page (3 days).** `Tool` gains `"paths"`; `map.paths` = D and the keys above in
   `keys.ts`; `FindPaths.tsx` and its bar (desktop and phone layouts from the mockup, sharing Find
   areas' strip styles); ghosts, the proposed path and stops on the overlay canvas; `gesture.ts`
   learns "a drag that starts on a stop moves it"; snapping to markers, path ends, rivers; Make
   path, Add to, Group through `tools.ts` and the save queue; each a history step; Show relief and
   the sea wash as overlay layers.
6. **"Counts as" on styles (1 day, if decision 4 is yes).** One optional field on a map style, a
   select in the Styles panel, the starter styles filled in, a "Mountains" starter style.
7. **Browser tests (1.5 days).** A fixture map with a painted river, a dashed road and a bridge,
   and a small height map. Desktop: trace the river and its branch, make two paths, group; route
   foot vs cart differ and the cart's uses the bridge; no way → ship; height map off shows the
   indicator. Phone: tap, tap, drag a stop, Options, Make path, sheet opens; pinch still zooms.
8. **Docs (0.5 day).** `docs/designs/stage-<n>-find-paths.md` from this proposal once approved; the
   "?" sheet.

Then, separately: globes (about 3 days: wrap, cos φ, great-circle heuristic, poles), "Keep this guess
as a height map" (1 day), per-world travel settings (decision 2b, about 3 days), the optional "Ask
AI what the colours mean".

## Approved decisions

What the owner decided, in the order it was decided, and how release 20 built each. "Built" means
in the app with unit and browser tests. Items 1–6, 8, 9 were built in 20a; 7, 10, 11 and 12, and
the Path tool's crossroads, in 20b.

### The first five (the proposal's own)

1. **Approved as proposed:** key D, the kinds River / Route / Trace, the same vocabulary as Find
   areas. Built.
2. **The height map is given in a separate Terrain dialog**, not as one of the map's pictures with
   a "Height map" role. The "Height maps → How the owner gives one" part above is replaced by
   `stage-20-terrain-dialog.md`. The map file holds one optional `terrain` item. Built.
3. **First release: all three kinds, flat maps only.** On a globe the tool is off, with "Find paths
   works on flat maps for now". Built.
4. **Made rivers and roads count for later routes**, through a "counts as" field on map styles
   (Water, Forest, Marsh, Mountains, River, Road), one select in the style's form. A usual style
   added before the field existed counts by its id until the owner says otherwise; a new usual
   style, Mountains, is added. Built.
5. **Travelling time:** the map's length and "about n days at 8 hours a day", with built-in speeds
   shown in each way of travelling's tooltip. Built. The time needs the map's scale in km, m,
   miles, leagues or feet; a world's own unit gives a length and no time.

### How paths connect

6. **Joins stay attached.** A new path that ends on another path, from Find paths or from the Path
   tool with snapping on, puts a corner into the other path at the meeting point (the same
   coordinates; on a curved path, on the curve as drawn) and remembers the join on its own end:
   `startOn` / `endOn` hold the other path's id. Old files keep their bytes; joins merge with their
   path; a join to a path that is gone is dropped on reading, on merging and on saving. Moving the
   shared corner moves both paths; moving or reshaping the other path re-places the joined end;
   deleting the shared corner, or the joined path's own end point, lets the join go. No path is
   ever split. Built (`apps/web/src/map/joins.ts`).
   - A road found across a road gets a crossroads corner in both. Built for Find paths' routes in
     a style that counts as Road. The crossroads corner is shared by its coordinates only: it is
     not remembered as a join, so dragging it in one road does not move the other. Built for the
     Path tool too: a path drawn by hand has no style while it is drawn, so it becomes a road
     when its path style is set to one that counts as Road, and at that moment (snapping to paths
     on) it and every road it crosses get the shared corner (`roadCrossings` in `joins.ts`).
   - Rivers never cross rivers: a new river stops on the first made river it reaches. Built.
7. **A route that runs partly along an existing road** (a made path that counts as Road, or a
   road painted in the picture, with Follow drawn lines on) asks each time: the bar's main
   button becomes two, **Make new stretches** (Enter) and **Make whole route**. New stretches are
   the parts of the route off the road, each a path of its own whose ends lie exactly on the
   made road (at the curve as drawn), so each is joined to it at both ends and the shared part is
   not drawn twice; on a painted road the ends are where the route meets its line. The bar always
   gives the whole journey: "Start → End · 300 km · about 16 days by cart · 1 bridge · uses
   82 km of King's Road · 218 km new". Built. How: the engine notes which road each cell of the
   way is on, evens out crossings (a run along a road shorter than 8 cells, or 3% of the way, is a
   crossing, not a way along it) and makes each run into points by itself, so where the route
   joins and leaves a road is a point of the path.
8. **Meeting the end of a path of the same kind:** the bar's main button becomes "Continue
   ‹path›", which makes the two one path; "Make separate path" makes it a path of its own, joined
   to the other at the end they share. Built for Find paths.

### Snapping and branches

9. **Snapping has targets.** A menu beside the magnet has Paths, Zones and Markers & labels, all on
   at first, each remembered on the device; S still turns snapping on or off as a whole, and the
   magnet's tooltip says what it snaps to. With Paths off, a new path neither snaps to nor joins
   another: no shared corner, no remembered join, no Continue, no crossroads corner. Built.
10. **Diverging roads.**
    - By hand: a path started on another path, with snapping to paths on, is joined at its start.
      Built.
    - Right-click a path → "Branch a path from here" starts the Path tool on it. Built.
    - Find paths' Route started (or ended) on a made road, with snapping to paths on, leaves it
      wherever is best: the search starts from every cell of the road at no cost (a multi-source
      A\*; an end on a road is a set of targets). The bar says "branches from King's Road at
      Millford" (a marker or label near the branch point) or "… 140 km along it", and the route
      is joined to the road there, at an exact point of its curve. Built.
    - A branch leaves a road (or joins one) smoothly: its second point follows the road's
      direction for a short way before turning off, so there is no hard 90° spur on a curved road.
      Built for Find paths' branches; a branch drawn by hand goes where it is drawn.
    - Rivers do not branch, except into a delta. Kept: nothing makes a river branch.

### Steep ground

11. **A steepest grade for each way of travelling, with switchbacks; cliffs; "Allow a tunnel" and
    "Allow steps" when there is no way; a height profile and chevrons on steep stretches.** Built.
    - **Steepest grade:** cart 12%, horse 20%, on foot (and a ship's walk to the coast) 35%,
      changed in the route options ("Steepest", 5–60%, remembered per way of travelling while the
      app is open). A step steeper than that is closed; the slope still slows each step as before
      (Tobler's rule on foot). The grade is measured along the step, so going across a slope is
      gentle (anisotropic).
    - **Switchbacks:** the search has sixteen ways out of a cell (the eight neighbours and the
      eight knight's moves), so a climb too steep to take straight winds across the slope at
      gentle angles. A knight's move is judged by its two halves through the height at its middle,
      so no ridge is stepped over. Smoothing and thinning keep the limit: a point is smoothed only
      where both pieces it then makes are within it (else it stays where it was found), and
      Douglas–Peucker splits any straight piece that would be too steep, so a switchback keeps its
      corners. The grade of every piece is measured again after smoothing, a cell at a time.
    - **Cliffs** are impassable: in the heights, a drop steeper than 120% between two cells; in
      the picture, ink crowded over half of a neighbourhood a hundredth of the picture across, in
      pieces of some size (cliff marks, dense hatching), never on water or a road.
    - **No way within the limit:** the same search is run again with any grade short of a cliff;
      when it finds a way, the bar says where it is steepest, by the name of a marker or label
      near it: "No way by cart: Grey Pass is 19% at its steepest" ("the climb is 19%" when no
      name is near), with the grade marked on the map. It offers only **Allow a tunnel** and, on
      foot, **Allow steps**; when no way is found even then, water is in the way and the ship is
      offered as before.
    - **Tunnels** (a "Tunnel" toggle in the route options, off by default, with "Longest tunnel"
      1–20 km, 5 km at first): from where the ground ahead is too steep, straight through high
      ground (both mouths well below what is above them, never under the sea) to where the way
      on is within the limit. A tunnel costs the search 20 hours a km, so it is taken only where
      there is no way over or round; once there it is travelled at 4 km an hour. Its two mouths
      are points of the path, the stretch is stored on the made path as a `tunnel` stretch and
      drawn dashed, and the bar says "a tunnel of 3.2 km".
    - **Steps** (on foot only, a "Steps" toggle, off by default): steeper steps up to 80%, for at
      most about 300 m in a row, three times slower; stored as a `steps` stretch and drawn with
      short bars across the line.
    - **Height profile:** below the route options while a route is proposed: the heights along
      the way, the parts from 12% amber and from 20% red, and "Climbs 1,240 m · highest 1,690 m
      · steepest 18%". Without real heights (none given, the map has no scale, or the terrain is
      guessed or a kept guess) the metres are left out and grades say "about … (grades
      approximate: no real heights)".
    - **Chevrons** on climbs, pointing uphill: › from 12% to 20%, ›› above. A climb is a run of
      the line steeper than 12% the same way up, measured a cell at a time; a point is put in
      where one starts or ends, and it is stored as a `climb` stretch with its steepest grade.
      **Show steepness** beside the profile (on by default) decides whether a route made by Find
      paths shows them; the path's Edit feature tab has the same checkbox afterwards.
    - In the map file, a path's `stretches` hold each tunnel, flight of steps and climb between two
      of its corners by their coordinates (a corner put in elsewhere leaves them alone; dragging
      one of their corners moves them with it; deleting one lets the stretch go), and
      `steepShown: false` hides the chevrons. Older files keep their bytes.

### Rivers that end inland

12. **Basins, with a lake to accept and five ways for the river to end there; the terrain winning
    over a painted river's inland end.** Built.
    - A river that reaches a hollow of meaningful size, at least a 2,500th of the map (25 cells at
      the least) and deeper than 1% of the land's relief below where it spills, meets a basin.
      Smaller hollows, a noisy height map's pits, are still filled and crossed without a word. The
      basin is the hollow filled to its spill level (the cells the flood raised, measured against
      the heights before rivers were drawn into them, so a painted river's trench is no hollow).
    - The bar's River options then show **How it ends in the basin**: Lake drains · Lake keeps
      the water · Marsh · Sinks underground · Dries out, each shown at once:
      - *Lake drains*: the lake fills and the river carries on from its lowest rim.
      - *Lake keeps the water*: the river ends at the shore.
      - *Marsh / inland delta*: the river ends at the shore and three channels fan out into the
        basin, each fading (made as paths that taper); the basin is offered as a ghost Marsh zone.
      - *Sinks underground*: the river runs on to the hollow's lowest place and tapers away; the
        made path stores `endAs: "sinks"`.
      - *Dries out*: it runs half way there, and its last stretch thins and turns dashed
        (`endAs: "dries"`).
    - **The rule for the default** ("usual" on the switch): the lake **drains** when the land
      draining into the basin (besides the lake itself) is at least twenty times the lake's area,
      enough water to fill it to its rim; otherwise it **keeps the water**. Twenty is about where
      real lakes with no outlet sit in a dry climate; the map has no climate, so the owner's choice
      wins.
    - The lake (for Lake drains and Lake keeps the water) or marsh is drawn as a ghost outline
      with a pale wash; a click in it, or "Make the lake too" / "Make the marsh too", takes it, and
      Make path then also makes a zone in the current layer in the usual zone style that counts as
      Water (or Marsh), snapped to the zones beside it as Find areas' zones are. There is no
      separate "click where it ends" control.
    - A painted river that ends inland: the terrain wins, and a river followed down it carries on
      past its end to the sea. Trace still follows the painted line exactly.

### Also in 20a

- **Find areas' gaps.** The proposal's note was right: closing ink's gaps with a square did not
  close them in a thin slanted dashed line, so a dashed diagonal border did not stop an area. Find
  areas now also joins pieces of ink within eight pixels of each other by a stroke, whichever way
  the line runs.
- **Room for a made height picture.** The map's `terrain` keeps `guessed: true` for a height
  picture that was made rather than given (the proposal's "Keep this guess as a height map", or a
  height map inferred from the picture later). Nothing makes one yet; a terrain so marked has its
  grades called approximate.
- **Not built, from the proposal itself:** a note kept on the made path (it is said once, over the
  map); pulling a route onto a painted road's ink on the full-size picture; a traced line teaching
  the tool that line's colour; globes; per-world speeds.

