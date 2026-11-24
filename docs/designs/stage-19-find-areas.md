# Find areas: zones from the map's own picture

- **For:** the owner's ask, "an automatic zone mapping tool: click automatically detected areas in a
  graphic map and combine them into a zone without tracing manually"
- **Status:** approved on 2026-11-24, with the decisions in "Approved decisions" below; built in release 19a
- **Mockup:** `auto-zones-mockup.html` (kept with the proposal, not in the repo). It is a working page, not a picture: it draws a small fantasy
  map, looks at it the way the real tool would, and lets you hover, click, Alt-click, change the
  options and make zones. "Phone view" in its top strip opens it at iPhone width. Screenshots are in
  `ux/autozone-shots/`.

## What's wrong today

A zone is drawn one corner at a time with the Zone tool (Z). A realm on a painted map has hundreds of
bends along its coast and borders, so tracing it is slow, and the result follows the painted line only
as well as the clicks do. Snapping (`apps/web/src/map/snap.ts`) helps a second zone share the first
one's border, but it only snaps to features. Its header comment says why: "The map's pictures are not
looked at: finding a coast in the pixels would mean analysing the image, which is not done here." This
proposal adds that analysis.

## How it works for the author

### The tool

**Find areas** is a new map tool next to Zone, with key **F** (free in the map scope; `f` is used only
by the chronicle) and the Lucide `WandSparkles` icon. It acts only while editing, like the other tools.
When the tool is chosen on a map, the page looks at the map's picture once. That takes under a second
for a normal map, and "Looking at the picture…" shows in the bar meanwhile. After that, every hover
and click answers at once.

1. **Point.** The area under the pointer lights up as a whole: a soft orange tint with a firm edge, in
   the selection colour `--map-select`. A tag next to the pointer says what a click will do: "+ Add
   this area", "− Remove this area", or "Already chosen · Alt-click removes it". Over text or a mark
   that is not being ignored, it says "Text or a mark: turn on Ignore text & marks to look past it".
2. **Click to add.** The chosen areas are shown as **one outline**, the zone they would make: marching
   dashes, a light fill and its corners as small dots. The bar counts them: "3 areas → 2 pieces, 1 hole
   · 64 points".
3. **Remove.** Alt-click (Option-click) removes an area. Shift-click always adds. The bar's
   **Add | Remove** switch (key X) sets what a plain click or tap does. In Remove mode an area is shown
   hatched in red before the click. Clicking an area that is already chosen does nothing in Add mode,
   so a slip of the finger never undoes work.
4. **Make zone** (Enter) turns the outline into a zone in the **current layer** (the highlighted row
   in Layers, also shown in the bar) with the **zone style** chosen in the bar. It is selected and its
   Edit feature tab opens with the label ready to type over. The tool stays on, so the next country can
   be clicked straight away, as the Marker tool stays on.
5. **Add to "‹zone›"**: while a zone is selected, the chosen areas can be merged into it instead. This
   is how a realm gets its islands, or a border that was traced by hand gets its coast filled in.
6. **Undo** (Ctrl/⌘+Z) takes back the last click, Make zone or Add to, through the map's own history.
   **Esc** clears the chosen areas; a second Esc deselects; a third returns to Select. Drag pans, the
   wheel zooms, and Space+drag or the middle button pan as everywhere else on the map.

### The options (in the tool's bar)

| Control | What it does | Default |
| --- | --- | --- |
| **How alike** (strict … loose) | How close two colours must be to count as one area. Raise it when a painted country breaks into bands; lower it when two neighbours run together. Changing it redraws the areas in about a tenth of a second, and the areas already chosen stay chosen (each click is kept as a point and replayed). | middle |
| **Stop at lines** | Dark thin lines (borders, coasts, rivers) are walls that an area does not cross. Gaps in dashed and dotted borders are closed first. The wall is then shared out down its middle, so two neighbouring zones meet exactly on the line rather than each stopping at its edge. Off: areas are found by colour alone, and a dashed border between two same-coloured countries no longer splits them. | on |
| **Ignore text & marks** | Letters, mountains, trees, a compass and other small marks are looked past: the area flows under them, so the zone has no letter-shaped holes. Off: they are their own little areas, and the outline goes round them. | on |
| **Points** (fewer … more) | How closely the outline follows the edge. The count of points shows in the bar and changes live. The zone can also be set to **Curved** after it is made (the existing curve switch), which looks natural with fewer points. | ~1.5 px |
| **New zone in** ‹layer› ‹style› | Where Make zone puts the zone, and its zone style. The layer follows the highlighted row in Layers. | current layer, last style used |

**Snapping** (the existing magnet, S) also applies: a new outline lands on the corners of zones beside
it and follows their line between two such points, so a hand-drawn neighbour and a found zone share
one border, point for point. The mockup starts with a hand-drawn "Kingdom of Vael" to show this: click
Mereth or Orrund next to it.

**Holes and islands.** A lake inside a country is a hole in the zone; a country with an island is one
zone in two pieces. The bar counts both ("2 pieces, 1 hole"). Holes and pieces smaller than about
30 px² (a fleck of paint) are dropped. Decision 1 covers how a zone stores them.

**What is looked at.** Only the map's picture: the images under the pointer, not markers, paths, zones
or labels drawn on top. A marker in the middle of a country does not cut a hole in it. With several
images on a map, the tool looks at the topmost visible image under the pointer and maps its pixels to
map positions through that image's `extent`.

### On a phone (the installed app on the iPhone)

- The tools sit in the bottom bar as today; Find areas is the wand.
- Just above them is a one-line strip: **+ | −** (Add or Remove), the count ("3 areas · 64 pts · 1
  hole"), an **Options** button, and **Make zone**. Options opens the rest of the bar above the strip:
  How alike, the two switches, Points, Clear, Add to selected zone, and the layer and style.
- **A tap adds** (or removes, in − mode) and the area flashes so the finger isn't left guessing. There
  is no hover, so the outline is the feedback. Tapping an area that is already chosen says "Already
  chosen. Switch to Remove to take it away."
- **Pinch zooms and two fingers pan, unchanged.** A one-finger drag pans; only a tap that doesn't move
  counts as a click (the gesture machine's threshold: 6 px for a mouse, 10 px for touch).
- Make zone opens the bottom sheet on the new zone's Edit feature tab.

### Empty and edge states

- **No picture** (a schematic map with no image, or every image hidden): the tool is disabled with the
  tooltip "Find areas needs a map image".
- **Before anything is chosen**: the bar says "23 areas found · click one to start". Make zone and
  Clear are disabled, and Add to… is disabled with "Select a zone first".
- **Areas too small to outline** (all specks): "1 area · too small to outline", and Make zone stays off.
- **A globe**: see decision 4.
- **Viewing mode**: the tool isn't there, like every drawing tool.

### Keys (map scope, editing)

F Find areas · X switch Add/Remove · Alt-click remove · Shift-click add · Enter Make zone · Esc clear,
then deselect, then Select · Ctrl/⌘+Z and Shift+Ctrl/⌘+Z undo and redo · S snapping. All are in the
"?" sheet and in the tooltips.

## The technique

Everything runs in the browser, in a **Web Worker** with an `OffscreenCanvas`, so the page never
stutters. No server round trip and no AI is needed for the core tool. The mockup runs the same steps
on the main thread in plain JavaScript. On a 960×640 map (0.6 megapixels) in headless Chromium it
measured about 100 ms for the one-off look and 130–150 ms for each change of How alike.

### 1. Once per map image ("looking at the picture")

1. **Decode and scale down.** Get the image's pixels with `createImageBitmap` and draw them to an
   `OffscreenCanvas` at most **2 megapixels** (for example 1700 px on the long side). Everything below
   runs on this working copy, and the scale factor is kept to map back. Painted maps rarely carry
   detail that matters to a border below that size, and the full-size image is used again at the end
   (step 4).
2. **Perceptual colour.** Convert each pixel from sRGB to **CIE Lab** (linearise, to XYZ with D65, then
   Lab). Distances in Lab (ΔE) follow what the eye sees, so "how alike" means the same thing for
   greens as for ochres, and a painted wash's light and dark patches stay closer than they look in RGB.
3. **Find the ink: thin dark lines.** A pixel is *ink* when its lightness is clearly below the average
   of its neighbourhood: L < mean(L over 13×13) − 9. This is a black top-hat by box filter, done in
   linear time with an integral image. It finds borders, coasts, rivers, hatching and letters, but not
   a dark *area* such as a forest painted dark green, because there the average is dark too.
4. **Close dashed lines.** A morphological **closing** (dilate, then erode, with a 9×9 square) of the
   ink joins dashes and dots up to about 8 px apart into one line.
5. **Lines vs marks.** Label the closed ink's connected pieces (8-connectivity) and sort them:
   - a **line** is long (bounding box over ~90 px across, scaled with the image) and thin (it fills
     less than 30% of its box): the border and coast network, rivers, dashed borders;
   - a **mark** is everything else: letters and words (even when the closing joins them, a word is
     dense in its box), mountain and tree symbols, a compass, specks of texture.

### 2. Each time an option changes ("the areas")

This is a **pre-segmentation**: the whole picture is cut into areas up front, so hovering is a single
array lookup (area id at this pixel) and the whole area can be lit at once. The method is a
graph-based region merge in the manner of Felzenszwalb–Huttenlocher, kept simple:

1. **Walls.** Lines are walls when *Stop at lines* is on; marks are set aside when *Ignore text &
   marks* is on.
2. **Smooth the colour without the walls.** A 5×5 box blur of Lab that leaves wall pixels out
   (integral images of the colour and of a "counts" mask), so grain, parchment speckle and brush
   texture fade, and a black border does not bleed into the countries beside it.
3. **Merge alike neighbours.** Every pair of side-by-side pixels is an edge weighted by ΔE. Edges below
   about half the tolerance are bucket-sorted (no full sort; 0.25 ΔE buckets) and joined smallest-first
   with union–find. Two pieces join only if their **average** colours are also within the tolerance.
   That second test stops a slow gradient, or a chain of slightly different pixels, from walking from
   one country into the next.
4. **Tidy up.** Pieces smaller than ~40 px are crumbs. Pieces made mostly of mark pixels are *ink*:
   they are their own unchosen areas while text isn't ignored.
5. **Share out the walls.** Every wall, set-aside mark and crumb pixel is given to the nearest area by
   a breadth-first flood from all areas at once (a discrete Voronoi split). Two countries either side
   of a border each get half the line, so their outlines meet **in the middle of the painted line**.
   That is what makes zones found separately share a border.
6. **Index.** For each area keep its pixel count, bounding box and a packed list of its pixels (CSR
   arrays), for instant highlighting and masks.

The result is a label image (an `Int32Array`, one id per pixel). The **SLIC superpixels** or
**watershed** that a photo editor might use were considered. SLIC makes many small cells that would
then need merging, and its compactness term rounds off thin necks of land. Watershed over a gradient
image leaks through gaps in lines unless they are closed first, and once they are closed (step 1.4)
the merge above is simpler and gives whole countries directly. Either could replace step 2 behind the
same interface.

### 3. From chosen areas to a zone

1. **Union** the chosen areas' pixel lists into one mask (only within their joint bounding box).
2. **Contour** with **marching squares**: one cell per 2×2 pixels, the edges between inside and outside
   chained into closed rings. The saddle cases are split consistently so that touching corners don't
   join. Each ring is classed as an outer piece or a hole by how many other rings contain it (even:
   piece; odd: hole). Rings under ~30 px² are dropped.
3. **Simplify.** One pass of 1-2-1 smoothing removes the pixel staircase, then **Douglas–Peucker** on
   the closed ring (split at the point farthest from the start, simplify both halves) with ε from the
   Points slider, 0.5–7 px. Visvalingam–Whyatt is the alternative if the owner prefers fewer slivers at
   very low point counts. A country that is 108 points at the default drops to about 50 at "fewer".
4. **Snap** (when the magnet is on): each corner within 5 px of another zone's corner moves onto it;
   failing that, within ~4 px of its edge, onto the edge. Between two corners snapped to the same zone,
   that zone's own corners are inserted, provided they lie along the new segment. The shared border is
   then identical point for point, as the existing snapping promises.
5. **To map positions.** On a flat map a position *is* a pixel of the image, so the working-copy points
   are multiplied by the scale factor and offset by the image's `extent`. On a globe, pixel to
   longitude/latitude through the extent; see decision 4.

**Add to ‹zone›** fills the zone's existing rings into a mask (even-odd), ORs in the chosen areas, and
runs steps 2–4 again with snapping to everything but itself.

### 4. Large images: work small, finish sharp

Analysis on the ≤2 MP copy keeps everything under a second even for a 16-megapixel map. The outline
would then be up to ~2 source pixels off, which shows on a sharp line at high zoom. So after step 3.2,
**refine at full resolution only along the outline**. For each contour point, read a short strip of
the full-size image across the boundary (about ±3 working pixels) and move the point to the darkest
point of the line (when the boundary is a wall) or the steepest colour change (when it's a colour
edge). This reads a thin band, a few hundred kilobytes, not the whole image, and is done in the worker
from a full-size `ImageBitmap` cropped in tiles of 512×512 so an iPhone's canvas memory limit is never
approached.

### Performance targets

| Step | Target (desktop) | Target (iPhone 13) |
| --- | --- | --- |
| Look at the picture (once per image, cached by image path + size + modified time) | < 400 ms | < 1 s |
| Re-find areas after How alike or a switch changes | < 150 ms | < 400 ms (debounced while dragging) |
| Hover: light an area | < 4 ms (one lookup, repaint of that area's box) | n/a |
| Click: outline of the chosen areas | < 30 ms | < 60 ms |
| Memory in the worker | ≈ 60 MB at 2 MP (Lab floats, integral images, labels) | same; released when the tool is left |

The analysis is cached in memory per image for the session; the label image for the current options is
kept until an option changes. Nothing is stored in the vault.

### Is a server or AI step worth it?

**Not for the first version.** Fantasy maps are the easy case for classic methods: flat or lightly
textured fills separated by drawn lines. The failure cases below are mostly settled by the options and
by Remove and Add to, which a model would not remove.

An **AI segmentation model** (Segment Anything–style: click a point, get a mask) would help with maps
that have **no drawn borders** and soft painted transitions. The choices and their cost:

- **In the browser** (SAM-type encoder through onnxruntime-web/WebGPU): a 40–100 MB model download, 1–3 s
  per image on a desktop GPU, and too slow or too large for the iPhone app. No money cost.
- **On the server, CPU**: a new Python or ONNX service of ~400 MB, 3–10 s per 1024² image, then fast
  per-click decoding. Hosting work, no per-use cost.
- **Hosted API** (for example a SAM model on Replicate or fal): about $0.002–0.02 per image and a few
  seconds. It is a new provider beside the app's current chat-model providers (Anthropic and
  OpenAI-compatible), with its own key, and the map image leaves the server.

The app's existing AI providers are chat models. They can describe a map but cannot return accurate
outlines, so they don't help here.

**Recommendation:** build the browser version; give the area-finding step a clean interface (image in,
label image out) so that a "Find areas with AI" option could later replace step 2 for a hard map. Add
it only if the owner's real maps hit the failures below often.

## When it goes wrong, and what the UI does

| Case | What happens | What the UI offers |
| --- | --- | --- |
| **Gradients** (a sea darker away from the coast, a country shaded at its edges) | At a strict setting the area breaks into bands; hover shows the band, not the whole. | Raise **How alike**; or click each band, as they union into one outline. The mockup's sea shows this at the strict end. |
| **Parchment texture, brush grain, stains** | Handled by the masked blur and the average-colour test; strong stains can still make a crumb area or a dent. | Crumbs under 40 px are folded in automatically; Points "fewer" smooths dents; very strong texture: raise How alike. |
| **Regions separated only by a dashed or dotted border** | The closing joins gaps up to ~8 px. Wider gaps leak: two same-coloured countries come up as one area. | The hover shows the leak before the click. The fix is to finish that one border by hand: draw the first zone with the Zone tool or trace part of it, then use Remove. *Stop at lines* off makes them one on purpose (mockup: Upper and Lower Hollin). |
| **Labels crossing a border** | The letters touching the border join the line network and become wall; their pixels are shared out by distance, so the outline wobbles slightly around the letters. | Points "fewer" hides the wobble; the corners can be moved after. In the mockup, "CALDER MARCHES" crosses into Brannoch. |
| **Text inside an area** | With *Ignore text & marks* on, no effect; off, letter-shaped holes. | The switch; the hover over a letter says what it is. |
| **A river across a country** | A river that ends inside the country (as most do) doesn't split it. One that crosses from border to border does. | Click both halves: they union into one zone with the river inside it. |
| **Dark painted areas** (a black forest, a dark sea) | Not mistaken for lines: ink is "darker than the surroundings", and a large dark area is its own surroundings. | n/a |
| **Hatching or stippling as a fill** (no flat colour) | The hatch strokes are marks; with them ignored, the paper between is one area. Dense cross-hatching can come up as line and wall. | Turn off *Stop at lines* for that area, or raise How alike. |
| **Area touches the image edge** | The outline runs along the edge of the image. | Snapping to the map edge is already how a zone would be drawn there. |
| **The image is very large or still loading** | The bar says "Looking at the picture…"; clicks wait. | Esc or another tool cancels the work in the worker. |

## Decisions for the owner

1. **Holes and islands in a zone.** Today a zone is one ring of `points`.
   - **(a, recommended)** Add two optional fields to a zone and to its later shapes: `holes` (rings cut
     out) and `pieces` (more outer rings). The map file stays at version 1, and an older reader still
     draws `points`, the largest piece. The renderer, the hit test, `zoneOnPlate` on a globe, snapping,
     the saved picture and the Edit feature point list all learn about rings. A realm with islands
     stays one feature linked to one entry.
   - (b) Keep one ring: Make zone fills holes and makes one zone per piece. No schema change, so it
     ships sooner, but "Skerra" becomes a second zone with its own entry link.
2. **After Make zone, stay in Find areas or go back to Select?**
   **Stay (recommended)**, as the Marker tool does: mapping a continent is twenty clicks and twenty
   Make zones in a row, and the new zone's tab is already open for its name. (The Path and Zone tools
   return to Select because their shapes usually need adjusting at once; a found zone rarely does.)
3. **An AI segmentation step.** **Not now (recommended)**: browser-only, free, offline-capable, and
   private, with an interface ready for a model later. Or add a hosted SAM-style model as an optional
   "Find areas with AI" at about $0.01 an image plus a new API key.
4. **Globes in the first release?**
   **Flat and schematic maps first (recommended).** On a globe the image is an equirectangular plate,
   and a found outline needs extra points so that its great-circle edges follow the painted line
   (straight on the plate ≠ straight on the globe), plus handling for areas across the date line and
   around a pole. That's a second step (about +2 days) once (1) is settled. In a globe view the tool
   would be disabled with "Find areas works on flat maps for now".

## Build plan (one engineer, about 8–10 days)

1. **Worker and the look at the picture (2 days).** `apps/web/src/map/areas/worker.ts`, with pure,
   unit-tested modules in `areas/`: `lab.ts` (sRGB→Lab), `ink.ts` (top-hat, closing, lines vs marks),
   `segment.ts` (masked blur, bucket-sorted merge, crumbs, wall share-out, CSR index). The worker gets an
   `ImageBitmap` (transferable), downscales on an `OffscreenCanvas`, and caches per image. Messages:
   `analyse`, `segment(options)`, `outline(seeds, options, snapTargets)`, `cancel`. Tests: small
   synthetic images (two squares and a line, a dashed line, a word, a gradient) with exact expected
   area counts.
2. **Outline (1.5 days).** `contour.ts` (marching squares, rings, holes), `simplify.ts` (Douglas–Peucker
   on closed rings), `refine.ts` (full-resolution edge pass in tiles), and reuse of `snap.ts` extended
   with the follow-the-neighbour stretch. Tests: ring counts and orientation, a square with a hole, an
   L-shape, snapping to a hand-drawn zone giving identical shared points.
3. **The tool in the page (2 days).** `Tool` gains `"find"`; key `map.find` = F, `map.findMode` = X in
   `keys.ts`; a `FindBar` component (the strip and its options, phone and desktop layouts from the
   mockup); a hover layer on the overlay canvas (an area tint drawn from the label image); the chosen
   outline drawn by `overlay.ts` in the selection style; the gesture machine (`gesture.ts`) routes a
   tap to the tool as it does for the other tools, with no change to pan and pinch. Each click,
   Make zone and Add to is a history step.
4. **Make zone and Add to (1 day).** `tools.ts`: `makeFoundZone(map, layer, style, rings)` and
   `addToZone(map, id, rings)` through the save queue; the Edit feature tab notes "Made from n areas".
5. **Holes and pieces, if decision 1 is (a) (1.5–2 days).** Schema fields, `orderFeature` key order,
   merge of item files, renderer and fill (even-odd), hit test, saved picture, time shapes.
6. **Browser tests (1 day).** A fixture flat map image in the sample vault with three flat countries, a
   dashed border and a label. Desktop: hover lights an area, three clicks, Alt-click, Make zone, the
   zone is listed in Layers with the expected piece/hole counts, and undo removes it. Phone (the default
   project): tap, tap, Options, Make zone, sheet opens; pinch still zooms.
7. **Docs.** `docs/designs/stage-<n>-find-areas.md` from this proposal once approved; remove the "not
   looked at" sentence in `snap.ts`'s header.

Then, separately: globes (decision 4), and the AI option if it's ever chosen (decision 3).

## Approved decisions

The owner approved the design on 2026-11-24 with these decisions. Where they differ from the
recommendations above, they win.

1. **Holes and islands: not decided yet.** The owner suggested grouping features (a group with a
   label) instead of multi-piece zones, and that is being mocked up separately. For release 19a:
   when the chosen areas form several separate pieces, Make zone makes **one zone per piece**, all in
   the current layer (named "‹name›", "‹name› 2", … when a name is given, unnamed otherwise), and
   selects them all. A **hole** (a lake inside a country) is **filled** for now. The zone schema gets
   no new fields. The tracing returns rings with outer/hole roles, kept apart from the code that
   turns them into zones, so the grouping and holes decision can plug in later.
2. **After Make zone, the tool stays in Find areas.**
3. **AI segmentation: not now.**
4. **Globes are included in the first release.** The globe's image is analysed in its own
   projection (the equirectangular plate it is stored as) and the traced outlines are converted
   from plate pixels to the map's longitude and latitude.
5. **Add to "‹zone›"** merges the chosen areas into the selected zone's outline (a union). If the
   result has several pieces, the selected zone keeps the largest piece and the others become new
   zones as in (1).

