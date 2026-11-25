# Height map from hints: build a height map from what the picture shows

- **For:** the owner's ask, "A way to generate inferred height maps from graphic maps if I have no
  height map. It marks suspected low / high points/lines/zones and lets me review/modify them. Then
  it builds a realistic height map with noise based on those."
- **Status:** approved; see "Approved decisions" at the end for what the owner chose and what release 21c built.
- **Name:** in the product it is **Build one from the picture** (the Terrain dialog's empty state),
  its first button **Find hints**, the marks are **terrain hints**, and the result is a height map
  marked **Generated from hints**. "Infer" is not a word the owner uses in the app; "hints" says what
  they are: suggestions he can overrule.
- **Mockup:** `ux/infer-height-mockup.html`. A working page. It reuses the Find paths world
  (`ux/autopaths-run/world.js`), adds a lake on the main river and a marsh at a river mouth, paints
  the map, and then looks **only at the painted picture**: the true heights are used for nothing but
  the "True heights" comparison. Finding hints, reviewing, moving, drawing and building are all real.
  "Phone view" in the top strip opens it at iPhone width. Screenshots: `ux/infer-shots/` (desktop
  `d00`–`d25`, phone `p0`–`p8`). Source and the Playwright check: `ux/infer-run/`.
- **Supersedes** "Keep this guess as a height map" in `terrain-dialog.md` (deferred there). Everything
  else in the approved Terrain dialog and Find paths stands, and this sits inside that dialog.
- **Read for this:** `terrain-dialog.md` and its mockup, `auto-paths.md`, `stage-19-find-areas.md`
  and `apps/web/src/map/findAreas/` (worker, `lab.ts`, `ink.ts`, `masks.ts`, `contour.ts`),
  `stage-15-offline.md`, `packages/schema/src/maps.ts` (`mergeItemLists`, `TOP`, groups).

## What's wrong today

A map without a height map gets Find paths' **guess**: sea by colour, land rising away from the
coast, a dome where the picture is painted as upland. It is hidden, it cannot be corrected, and it
ignores most of what the picture plainly says: which way the painted rivers run, where the mountain
symbols are drawn biggest, that a lake sits in a hollow and a marsh is flat. Most hand-painted maps
have no height map and never will. The owner wants Frontier to read the picture the way a person
does, show him what it read, let him fix it, and then make a height map that is as good as a real
one for everything that uses terrain.

## Where it lives

In the **Terrain dialog**, for a map with no height map. Nothing new on the map bar or in the tools.

- **Empty state** (`d01`, `p1`): "No height map yet", then a highlighted block **Build one from the
  picture** with one primary button, **Find hints**, then **Or use a height map you have** (Choose a
  height map…, as approved), then a line about the guess. The preview shows the current guess as
  relief, as approved.
- **Find hints** turns the dialog into the **hints workspace** (`d03`): the preview becomes an
  editor, the right column has two tabs, **Hints** and **Build**, and the foot reads **Start over ·
  verdict · Cancel · Use this height map**.
- **Re-opening:** once used, the Terrain chip, Layers → Terrain (**Adjust…**) and Find paths'
  terrain line ("Terrain from hints (generated)") open the same workspace with the hints and the
  built map as they were, on the Build tab (`d24`). Changing a hint rebuilds in the dialog;
  nothing changes on the map until **Use** again.
- A map that has a **real** height map does not show this. Replacing a generated one with a real
  one is **Replace…** in the normal dialog; the hints are kept (decision 3) in case he goes back.

## 1. Finding hints

**Find hints** looks at the picture once, in Find areas' worker, reusing its working copy, Lab
colour and ink mask. In the mockup: 0.13–0.18 s for a 960 × 640 picture on the main thread.

Each hint has a **kind**, a **shape** (point, line, zone, or "the picture's water"), a **confidence**
and a **reason** in one sentence, shown when it is selected.

| Kind | How it is found | Says about height | Confidence (mockup) and reason, as shown |
| --- | --- | --- | --- |
| **Sea** | The water class (blue-grey) joined to the map's edge | Below 0, deeper away from the shore | 97% "Blue-grey water joined to the map's edge (64% of the picture)." |
| **Coast** | The edge of the sea | Exactly 0: the zero line | 95% "Where the sea meets the land: held at sea level." |
| **Lake** | Water enclosed by land, larger than a pond | A hollow; its water lies flat at its lowest rim | 86% "Blue-grey water enclosed by land (281 km²)…" |
| **River** | Blue ink on land, followed end to end (Find paths' Trace), with its branches | A valley that only ever falls; **direction**: the end at the sea or a lake is the mouth; a branch flows into the river it joins; otherwise the end drawn wider is downstream | 92% "Blue line that reaches the sea at its north-east end: it flows that way." · 84% "Joins a larger river…" · 62% "Drawn wider at its south-west end: probably flows that way." |
| **Highland** | Dense mountain symbols: small dark marks wider than tall, not blue, red or green, counted and smoothed | High ground, a height range from the symbols' sizes | 59–72% "33 mountain symbols drawn close together: high ground." |
| **Ridge** | The spine of a highland: the symbols' main direction, then the size-weighted middle of each stretch along it | A line of high ground | 76% "The spine of a chain of 33 mountain symbols, through where they are drawn largest." |
| **Peak** | The largest mountain symbols, well apart (artists draw higher peaks bigger) | A summit with a height | 77–88% "Mountain symbols drawn largest here (24 px wide, against 15 px elsewhere): likely a summit." |
| **Marsh** | Reed marks: short level greenish strokes with tufts, smoothed into an area | Very low and flat | 72% "37 reed marks…: marsh lies very low and flat." |
| **Road** (weak) | Red-brown ink, followed | Gentle ground: less roughness along it; where it crosses a ridge, a pass | 35% "Roads keep to gentle ground and cross ranges at passes. A weak hint." (waits by default) |
| **Forest** | The forest class | Nothing: shown under **Not used** with the reason | "Forests grow on hills and plains alike: they say nothing about height." |
| **Hills** | Small arcs without an apex (⌒), wider than tall | Moderate height, rolling | Looked for and not found in the mockup's map; the list says so |
| **Cliff** | Rows of short parallel ticks along a line (hachures) | A step, high on the ticks' root side | Not detected in the first build (too easily confused with coast ripples and hatching); a drawing tool instead |
| **Peak names** | "Mt.", "Mount", "Peak" in the **map's own markers and labels** (not in the picture's lettering: that needs text recognition) | A peak at that marker; height from the symbols round it | 60% "A marker named Mt. Corran." (the mockup's map has none) |

**From the map's own features** (by each style's "counts as", as approved in Find paths): a zone
that counts as Water is a lake (or sea, if it touches the edge), as Mountains a highland, as Marsh
a marsh; a path that counts as River is a river, as Road a road. These hints are **tied to their
feature** (they move when it moves, and say "From the zone Grey Peaks"), start accepted at 100%, and
win over a found hint in the same place. The Hints tab lists them under **From your map**; the
mockup's map has none and says what would count (`d03`).

**What starts in use:** found hints at 70% or more are **accepted**; below that they **wait** for
the owner (decision 2). In the mockup 15 of 18 start accepted; 3 wait (a river whose direction is
unsure, a small second highland, the road).

## 2. Reviewing and changing hints

### On the preview

- Hints are drawn over the picture in a **Terrain hints** overlay (`d03`), each kind in its own
  cartographic mark: the coast as a dark blue line; lakes filled blue; rivers blue **with arrows
  downstream**; ridges brown with teeth along the crest; peaks ▲ and hollows ▼ with their height
  ("high peaks", or "2,440 m" when the top height is given); valleys dashed blue with arrows;
  cliffs with ticks down the slope; highland hatched brown; marsh with level dashes; roads dotted.
- **Waiting** hints are dashed and faded, with an amber "62%?" tag (`d04`). **Accepted** hints are
  solid. **Rejected** hints disappear from the preview and are struck through in the list.
- **Hover** lights a hint; **click** selects it (selection colour halo and square handles on its
  points); **drag** a hint to move it, or a handle to move one point (`d14`). Moving a waiting
  suggestion accepts it. Dragging empty ground pans; the wheel or a pinch zooms; ⊕ ⊖ ⤢ at the
  bottom right.
- **Show:** Picture · Heights · Relief · Contours (after a build), **Hints** on/off (H), and
  **Strength**, as in the Terrain dialog. Over a height view the hints are drawn lighter and zones
  lose their fill, so the terrain shows through (`d06`).

### The hint tools (a strip at the top left of the preview)

**Select (V) · Peak (P) · Hollow (O) · Ridge (R) · Valley (Y) · Cliff (C) · Zone (Z) ▾**
(Highland, Lowland, Plain, Marsh), **Undo · Redo**. Tools stay on until Esc, as the map's tools do.

- **Peak / Hollow:** one click. A peak starts a little above the built land there (or "mountains"
  before a build); a hollow at half of it.
- **Ridge / Valley / Cliff:** click points; finish with a click on the last point, a double-click or
  Enter (`d16`, `d17`). A valley falls the way it is drawn; a cliff is high on the left as drawn,
  with **High side the other way**.
- **Zone:** click points; finish on the first point, double-click or Enter (`d18`). Its kind can be
  changed afterwards.
- A banner above the bottom bar says what the next click does ("Click on, then the last point again,
  double-click or Enter to finish · Esc to stop").

### The Hints tab

- A summary: "**15** hints in use, **3** waiting for you. Found in 0.17 s from the picture alone."
  with **Accept the likely ones** (waiting ones at 50% and more), **Next suggestion (N)** and **Find
  again** (looks again; the owner's own hints and moved ones stay).
- **One row per kind** with a symbol, "5 of 6 used · 1 waiting", and **✓ all / ✕ all** for the kind
  (`d03`, `d20`). Expanding a kind lists each hint: a plain name ("River to the sea, flowing
  north-east", "Tributary, flowing west", "Ridge · mountains, 116 km", "Peak · 2,440 m"), its
  confidence bar, and ✓ / ✕ (🗑 for his own) (`d05`).
- **The selected hint** opens at the top (`d04`, `d15`): kind, "found · 88% · in use" or "drawn by
  you", the reason, and its controls:

  | Kind | Controls |
  | --- | --- |
  | Peak, Hollow, Ridge, Lowland, Plain | **Height** (low … high, or metres) |
  | Highland | **From** and **To** (a height range) |
  | Cliff | **Height of the step** (a bank … a wall), **High side the other way** |
  | River, Valley | **Flows the other way** |
  | All but sea, coast, lake, river, marsh, road | **Holds** (loosely: a nudge … exactly) |
  | Zones drawn by him | **Kind** |

  and **Accept (A) / Reject (X)** for a waiting one, **Reject** for an accepted found one, **Put
  back** for a rejected one, **Delete (Del)** for his own. Accept and Reject go to the next
  waiting suggestion, so reviewing is N, A, A, X, A…
- **Heights** are relative words (at sea level, lowland, hills, highland, mountains, high peaks)
  until the **Highest point** is given on the Build tab; then every height reads in metres or feet.
- **Undo / Redo** (Ctrl/⌘+Z, Shift+Ctrl/⌘+Z) cover every change in the dialog: accept, reject,
  drag, draw, slider (`d20` then undo).

## 3. Building the height map

### The Build tab (`d06`, `d21`)

| Control | What it does | Default |
| --- | --- | --- |
| **Roughness** (smooth … rugged) | The rolling detail everywhere, less on plains and marsh | 50 |
| **Mountain sharpness** (rounded … jagged) | Ridged detail where hints say mountains | 55 |
| **Erosion** (none … old, worn land) | Water wears valleys, slopes settle | 45 |
| **Detail** Draft · Normal · Fine | Octaves of detail; Fine also builds the saved image at full size | Normal |
| **Variation #n · Another one** (S) | The same hints, different natural detail (the seed) | #1 |
| **Carve rivers so they drain** | Every river gets a valley that only runs downhill to its mouth | on |
| **Keep lakes as hollows** | Lakes stay basins with flat water | on |
| **Highest point** ‹2600› m/ft | Turns relative heights into real ones; slopes and travelling times become real | empty: relative |
| **Build height map** (B) | Builds; afterwards every change rebuilds by itself, 0.2 s after the slider is let go or the drag ends. The button then reads "Up to date" | |
| **Save as PNG** | Downloads the built map as a grey PNG, white is high | |

Below the button, the **checks**, worst first, as in the Terrain dialog:

- **Lines up with the painted coast: 100%** (the same coast match as the Terrain dialog).
- **Rivers drain correctly: 5/5** — water put at each river's source runs down along it to the
  sea or a lake. With carving off the mockup shows **1/5** in red with **Carve rivers** (`d13`).
- **Lakes hold water: 1/1.** **Peaks reach their heights: 3/3** (or "2/3: two hints pull against
  each other near a peak").
- **3 suggestions not used yet · Review.** **Heights are relative** (when no top height).

The preview's top right shows **Coast 100%** and **Rivers drain 5/5** as badges, and **Hints
changed** when the shown build is older than the hints. The foot repeats the worst check.

**Mockup only:** **True heights** puts the heights the world was painted from beside the built ones,
with "Like the true heights: 87%" (the correlation of the land's heights) (`d09`, `p6`). With
the found hints alone the mockup reaches **86–88%**; rejecting the ridges drops it to 74%, which is
the honest measure of what the hints add.

### How it is built (in the worker)

1. **Targets on a coarse grid** (the mockup: 4 px cells, 240 × 160; the real tool: about 60 000
   cells). Sea cells are fixed below 0, deeper with distance from the shore. Coast cells are fixed
   at 0. Ridge crests and peaks are **fixed** at their heights (ridges taper at their ends); round
   them, a soft pull falls off. Zones are **soft** targets: highland towards its range, lowland and
   plain towards their height, marsh very hard towards almost 0. A faint pull everywhere makes land
   rise with distance from the sea, so land without hints is not left flat. "Holds" scales a hint's
   pull.
2. **Smooth fill (Laplace with soft targets),** solved by Gauss–Seidel over three grid sizes (coarse
   first, then refine). In the mockup 0.1 s. A thin-plate (biharmonic) solve gives rounder
   mountains without cone-shaped peaks; it is the better choice for the real tool if its cost
   allows (twice the work), and the solver is written so that either can be used.
3. **Rivers and valleys, second pass:** the solved heights are read along each river from source to
   mouth, made never to rise (the running minimum), lowered to about 60% to make a valley, fixed, and
   the field is solved again. The land now falls towards every river.
4. **Detail, on the working grid** (the mockup: 2 px cells, 480 × 320): rolling fractal noise
   scaled by height and Roughness, much less on plains and marsh and near rivers; **ridged noise**
   (1 − |noise|, sharpened by Mountain sharpness) where the hints say mountains; none at the coast,
   so the shore stays exactly where it is painted.
5. **Erosion** (0–4 passes by the slider): stream power (each cell is lowered by its slope times the
   square root of the water flowing through it, using Find paths' priority-flood and D8 flow), then
   thermal settling of slopes steeper than a talus angle.
6. **Peaks** are lifted or lowered, with a soft bump, until the land near each reaches its height.
7. **Lakes:** the water level is the lowest point of the rim; the bed is dug below it.
8. **Rivers carved:** each river, longest first, is walked from source to mouth; its cells are made
   to fall all the way (deeper downstream), a tributary stops where it meets a river already carved
   and ends above it, and a V-shaped valley is shaped either side whose walls are steeper than the
   river's own fall, so water beside the river runs into it, not alongside it.
9. **Checks:** D8 flow from each river's source; coast match; peak heights.

**Times in the mockup** (headless Chromium, main thread, 480 × 320): 0.2–0.4 s for a full build,
under the 1 s asked.

### The result

- **Use this height map** saves the built map as an image in the library ("Greywater heights
  (generated)", 16-bit grey PNG, at the picture's size up to 2048 px wide), sets it as the map's
  terrain with `generated` (below), and closes, with one Undo step and the toast "Height map built
  from 18 hints: Find paths, Relief and Suggest biomes now use it · **Undo**" (`d22`, `p8`).
- From then on it **is the map's height map**: Find paths' rivers and routes, Relief (H, `d23`),
  Suggest biomes, the coast match, export. Layers → Terrain shows it with a **generated** tag and
  "from 18 hints · coast 100% · rivers 6/6" (`d22`).
- Find paths' terrain line no longer reads the amber "Guessing terrain from the picture" but
  "Terrain from hints (generated)", without the amber: once he has reviewed and built it, it is his
  terrain, not Frontier's guess. A route's note says "terrain from hints" so it is never mistaken for
  surveyed terrain.
- **Stale:** if the hints are changed elsewhere (another device, a feature that counts as something
  is moved), the built map is not rebuilt silently. The Terrain row and Find paths' line say "Hints
  changed since it was built · **Build again**".
- **Save as PNG** gives him the file to refine in a paint program; choosing it again with Replace
  makes it an ordinary height map (the hints stay).

## 4. Phone, keyboard, performance, offline

### On a phone (`p1`–`p8`)

- A **full-height sheet**, as the Terrain dialog: **Cancel · Terrain · Use** at the top.
- The **preview** in the top 37% with the hint tools as a **column of icons** on its left edge
  (Select, Peak, Hollow, Ridge, Valley, Cliff, Zone) and Picture · Heights · Relief · Lines and
  Hints on its bottom edge. Badges at the top right.
- **Two steps, Hints · Build**, as tabs under the preview; the open step scrolls below.
- **Bottom bar:** on Hints, **Accept likely (n)** and **Build height map** (later **Build ›**); on
  Build, **‹ Hints** and **Use this height map**.
- **Touch:** a tap selects or places; one finger on a selected hint or its handle drags it (a 14 px
  reach); one finger elsewhere pans; two fingers zoom. In a drawing tool a tap adds a point and a
  drag pans, so drawing never fights panning; tapping the last point (or the first, for a zone)
  finishes.
- The selected hint's editor opens at the top of the Hints step with large buttons (`p3`).
- **True heights** (mockup only) replaces the preview instead of sitting beside it.

### Keyboard (in the dialog)

V P O R Y C Z tools · Enter finishes a line or zone · Esc: stops drawing, then back to Select, then
deselects, then closes · **N / Shift+N** next / previous suggestion · **A** accept · **X** or
**Delete** reject (delete his own) · arrows move the selected hint 1 px (Shift: 10) · + − 0 zoom ·
**1–4** Picture, Heights, Relief, Contours · **H** hints on/off · **B** build · **S** another
variation · Ctrl/⌘+Z, Shift+Ctrl/⌘+Z. The list is the full keyboard path: every hint is a row that
Enter selects, and every control in the editor is an ordinary button, slider or select. The focus
stays in the dialog. The preview is `role="application"` and the selected hint's name and state are
announced.

### Performance

- **Worker:** finding and building run in Find areas' worker, sharing its working copy (at most 2 MP)
  and Lab/ink results; nothing is decoded twice. Requests are cancellable: a new build cancels one
  under way.
- **Working sizes:** hints on the analysis grid (about 0.5 MP); the solve on a quarter of that;
  detail and erosion on the analysis grid; the saved image upsampled to full size with one more
  octave of detail (Fine).
- **Targets:**

  | Step | Desktop | iPhone 13 |
  | --- | --- | --- |
  | Find hints (once per picture; cached) | < 400 ms | < 1 s |
  | Build at Normal | < 800 ms | < 2 s (Draft: < 0.8 s) |
  | Rebuild after a slider or a drag | same, 200 ms after release | same |
  | Saving the full-size image (Use) | < 1.5 s | < 3 s, with a progress line |
  | Memory beyond Find areas' | ≈ 20 MB | same; freed when the dialog closes |

### Offline

Finding hints, editing, building, the checks and Save as PNG are **entirely local** and work
offline. **Use** stores an image in the library, and images need a connection (the owner's
decision of 2026-11-23, stage 15): offline the button reads **Keep the hints** and saves only the
hints through the save queue, with "Build and use it when you are back online"; the hints workspace
then reopens exactly as left. A map whose generated image is on the device works offline like any
height map (the device keeper stores it with the map's images).

## 5. Data

```jsonc
// the map file (version 1; both new fields are optional and at the end of TOP)
"terrainHints": [                         // merged per hint, like groups
  { "id": "k3m9p2qa", "kind": "peak", "at": [1106, 642], "h": 0.94, "strength": 0.7,
    "state": "accepted", "by": "found", "conf": 0.88 },
  { "id": "q8w2x0ra", "kind": "river", "points": [[1064, 618], …], "state": "accepted",
    "by": "found", "conf": 0.92 },                       // points run source → mouth
  { "id": "z1v6n4ke", "kind": "lowland", "points": [[1280, 600], …], "h": 0.02,
    "strength": 0.7, "state": "accepted", "by": "you" },
  { "id": "s0a1b2c3", "kind": "sea", "state": "accepted", "by": "found" },   // no shape: the picture's water
  { "id": "f7g8h9j0", "kind": "highland", "by": "feature:ab12cd34", "state": "accepted" } // tied to a zone
],
"terrain": {
  "image": "Maps/Greywater/greywater-heights-generated.png",
  "seaLevel": 0.130, "range": [-390, 2600], "rangeUnit": "m",  // as for any height map
  "generated": { "from": "hints", "seed": 1, "rough": 0.5, "sharp": 0.55, "erosion": 0.45,
                 "detail": 2, "carve": true, "lakes": true, "hints": "c41f…" } // hash of the hints used
}
```

- **Kinds:** sea, coast, lake, river, ridge, peak, hollow, valley, cliff (`flip` for its high side),
  highland (`h`, `h2`), lowland, plain, marsh, road. Heights `h` are 0–1 of the highest point;
  `strength` 0–1; `state` accepted, waiting or rejected; `by` found, you, or `feature:<id>`.
- **Found hints keep `conf`; the reason is not stored** (it is worded again from the kind and the
  picture when shown). Sea and coast hold no outline: they are the picture's water each time, so a
  repainted coast is followed.
- **Rejected found hints are kept** (as `state: "rejected"`), so Find again does not bring back what
  he threw out.
- **Merging:** `terrainHints` goes through `mergeItemLists` like `groups`: two devices accepting
  different hints, or one moving a peak while the other draws a ridge, both keep their work. A
  clash on one hint keeps mine and names it, as for features. `terrain` stays one value (approved).
- **Stale check:** `generated.hints` is a hash of the accepted hints; when it differs from the hints
  now, the terrain is shown as needing a rebuild.
- The generated image is an ordinary library image (offline keeper, export, Replace all work);
  `generated` is the only thing that marks it, and Remove terrain removes it like any other.

## Decisions for the owner

1. **Where the hints are edited.**
   - **(a, recommended) Inside the Terrain dialog**, as in the mockup. One place for terrain; the
     preview already has Heights, Relief and Contours; Cancel means "never mind"; one Undo step on
     the map; the dialog is near full screen on a desktop and full screen on a phone.
   - (b) On the map, as a "Terrain hints" overlay with its own tool. More room and the map's own
     zoom, but a third mode on the map, hints in the Layers tree, and every change saved and synced
     as it is made.
2. **How found hints start.**
   - **(a, recommended) Likely ones in use, unsure ones waiting** (70% and over in use). A first
     build is good at once (87% like the true heights in the mockup with no review), and the review
     is short: three suggestions here.
   - (b) All waiting: he accepts every one. Nothing is used that he has not seen; on a busy map, 30
     clicks before the first build.
   - (c) All in use: fastest, but a wrong guess (the road, a river's direction) goes in unseen.
3. **How hints are stored.**
   - **(a, recommended) Their own list on the map, `terrainHints`, merged per hint** (as groups).
     They are not features: not in layers, not shown to readers, not searchable; and per-hint
     merging keeps two devices' review work.
   - (b) As features in a hidden "Terrain hints" layer. Reuses feature editing and merging, but
     they would need hiding from readers, search, the Layers tree and export everywhere.
   - (c) Inside the `terrain` object. Simplest, but it merges as one value: the later device's
     review wins whole.
4. **What "Use" keeps.**
   - **(a, recommended) A real image in the library, plus the hints and settings to rebuild it.**
     It is then exactly a height map for Find paths, Relief, Suggest biomes, export and other
     programs, on every device, without rebuilding.
   - (b) Only the hints and settings; every device rebuilds the heights itself (0.3–2 s, from the
     same seed). No image to store or upload, works offline at once; but the result depends on the
     app's version (an improved builder changes everyone's terrain), and the PNG must be made on
     demand for other programs.

## Build plan (one engineer, about 10 days)

Builds on the Terrain dialog and Find paths (Trace's line follower, priority-flood and D8). If Find
paths is not built first, add 1.5 days for the line follower and the flow code.

1. **Schema (0.5 day).** `terrainHints` (zod, `TOP`, `mergeItemLists`, repair of hints tied to a
   removed feature), `terrain.generated`; round-trip, merge and older-reader tests.
2. **Finding hints (2 days).** In the worker: sea/lake/coast from the water class; rivers by the
   line follower with the direction rules; mountain symbols (ink components by shape and colour,
   density, spine by principal direction and bins, peaks by size); reed marks; roads; forests;
   hints from styles' "counts as" and markers named Mt./Mount/Peak. Tests on small synthetic
   pictures and on the mockup's world as a fixture (rivers' directions, the peaks within 30 px).
3. **The builder (2 days).** `terrain/build.ts`: targets, the multigrid solve, river pass, seeded
   noise, erosion, peaks, lakes, carving, checks; deterministic for a seed. Tests: rivers drain on
   20 random seeds and slider settings; coast exact; peaks within 0.12; lakes flat; time budget.
4. **The workspace, desktop (2 days).** In `TerrainDialog`: the empty-state block, the preview
   editor (overlay drawing, hit testing, drag, the seven tools, zoom and pan), the Hints tab (kinds,
   items, the selected hint's editor), history, keys.
5. **Build tab and Use (1 day).** Sliders and rebuild-on-release, checks and badges, Save as PNG
   (16-bit encoder), saving the image and `terrain` as one Undo step, the toast; stale marking in
   Layers and Find paths' line; Keep the hints offline.
6. **Phone (1 day).** Tool column, Hints · Build steps, bottom bar, touch rules (tap/drag/pinch).
7. **Browser tests and docs (1.5 days).** Desktop: find, accept likely, drag a peak, draw a ridge
   and a zone, build, rivers 5/5, carving off shows the warning, Use, Undo, reopen. Phone: find,
   build, place a peak, Use. `docs/designs/stage-<n>-terrain-hints.md` from this once approved.

Later, separately: cliff detection from hachures; reading peak names in the picture's lettering
(text recognition); hills symbols tuned on real maps; a thin-plate solve if the Laplace mountains
look conical on real maps.

## Approved decisions

All four approved as recommended. This replaces "Keep this guess as a height map", which
`stage-20-terrain-dialog.md` deferred.

1. **Hints are found, reviewed and edited inside the Terrain dialog** (a). Nothing new on the map,
   in the tools or in the Layers tree.
2. **Likely hints start in use, unsure ones wait** (a): found hints at 70% confidence and over are
   accepted; the rest wait for the owner's review.
3. **Hints are stored as their own list on the map, `terrainHints`, merged per hint** (a), like
   groups; they are not features.
4. **"Use" saves a real height-map image in the library, plus the hints and the settings to
   rebuild it** (a). The terrain is marked `generated`, so Find paths' amber "Guessing terrain from
   the picture" line changes to say "Terrain from hints (generated)".


## What release 21c built

- **Schema:** `terrainHints` (written last, merged hint by hint, a hint tied to a removed feature
  dropped on reading and merging) and `terrain.generated` (the settings and the hash of the hints,
  as the map keeps them). Older readers pass both through.
- **Finding** (`apps/web/src/map/terrainHints/find.ts`, in Find areas' worker, on Find paths'
  ground and Trace): sea and coast, lakes (not a river's wide stretch), rivers with their direction
  and branches, roads (waiting), mountain symbols as a highland with its ridge and peaks, reed
  marks as marsh, forests listed under "Not used". Hints from the map's own features by "counts
  as", and markers named Mt./Mount/…Peak, are tied to their feature (page side, `page.ts`).
- **The builder** (`build.ts`): as in "How it is built", steps 1–9, with Find paths' priority-flood
  and D8 flow for erosion and the drainage check. Draft, Normal and Fine build on about 80 000,
  160 000 and 320 000 cells; Fine adds an octave to the saved image. About 0.5 s for Normal.
- **The workspace** (`TerrainHints.tsx`): as designed, desktop and phone. Use uploads a 16-bit grey
  PNG (at most 2048 px wide) through the library's upload, then sets `terrain` and `terrainHints`
  as one change. Offline, Use reads "Keep the hints" and keeps only the hints.
- **Left for later**, as the plan said: cliffs from hachures, peak names in the picture's lettering,
  hill symbols, a thin-plate solve. Also not done: moving a feature that a hint is tied to does not
  mark the built map stale (the hash covers the hints as the map keeps them, without the feature's
  shape); the toast names Find paths and Relief only (Suggest biomes is not in this release).
