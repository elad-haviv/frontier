# Terrain: a dialog for the map's height map

- **For:** the owner's choice in Find paths, decision 1: "A separate Terrain dialog: a dedicated
  place to upload and adjust the height map, apart from the map's pictures."
- **Status:** proposal, waiting for the owner's approval of the design and the four decisions at the end.
- **Mockup:** `ux/terrain-dialog-mockup.html`. A working page. It reuses the generated world of the
  Find paths mockup, so the picture and the height field agree, and it measures the height map
  against the picture the way the real dialog would. Four height maps are in its library: a good
  one, an old export (black is high, cut differently), a grainy scan, and one with only nine greys.
  "Phone view" in the top strip opens it at iPhone width; "Show a map with no height map" shows the
  empty state. Screenshots: `ux/terrain-shots/` (desktop `d00`–`d26`, phone `p0`–`p13`).
- **Read for this:** `ux/auto-paths.md` (approved), `stage-13-maps.md`, `stage-19-find-areas.md`,
  `stage-15-offline.md`, `ImagePicker.tsx` / `MapImagePicker.tsx` / `LibraryView.tsx`,
  `LayerPanel.tsx` (Images, `ExtentForm`), `MapBar.tsx`, `Dialogs.tsx` (`DialogFrame`),
  `packages/schema/src/maps.ts` and `mapStyles.ts`, `keys.ts`.
- **This replaces** the "Height maps → How the owner gives one" part of `auto-paths.md` (a picture
  with a Height map role). Everything else there stands.

## What's wrong today

Nothing exists yet. Without a place for a height map, Find paths can only guess terrain from the
picture, and its rivers are rough. The earlier proposal hid the height map among the map's images;
the owner asked for one clear place instead. That place has to answer the four questions a height
map always raises (which way up is it, where does it lie, where is the sea, how high is high) and
say plainly whether the result can be trusted, because a height map that is 30 km off gives rivers
that cross the painted coast and nobody can tell why.

## Where it opens from

Terrain is a setting of the map, not a drawing tool, so it gets no tool button and no key.

| From | When | What it says |
| --- | --- | --- |
| **Map bar → ⋯ → Terrain…** | editing | Always there. The one place a new user is told to look. (`d02`, `p12`) |
| **Layers tab → Terrain** | editing | A section between Images and Layers. With terrain: the image's thumbnail, name, "sea at 0 m · coast 98%", an eye (relief) and **Adjust…**. Without: "No height map. Find paths guesses the terrain from the picture." and **Add a height map…** (`d00`, `d22`, `p1`) |
| **Find paths bar, the terrain line** | Find paths on | "Terrain from “Greywater heights”" (a quiet link) or the amber **Guessing terrain from the picture**. Both open the dialog. On a phone the line is an icon in the strip: a mountain, or the amber warning. |
| **The Terrain chip on the map** | editing, terrain set | Below. |

**What the map shows when terrain is set.** A small chip at the bottom left of the map (top left
on a phone, clear of the tools): **⛰ Terrain · Greywater heights** opens the dialog, and its second
half, **Relief** (key **H**), draws the terrain over the map as soft light and shade (`d00`, `d01`,
`p0`). When there is no terrain there is no chip: most maps never need one, and the amber line in
Find paths is the reminder where it matters. The height map itself is never drawn as a picture and
is not listed under Images.

## The dialog

One dialog, `DialogFrame`-style, wide on a desktop (about 1140 × 740): the **preview** on the left,
the settings in a column on the right, and a foot with **Remove terrain**, the one-line verdict,
**Cancel** and **Done** (`d03`).

### The preview

The map's picture with the height map over it, in the place it would be used.

- **Heights · Relief · Contours** (`d03`, `d04`, `d05`): the greys as they are; light and shade;
  lines of equal height (every fifth one stronger). With real heights given, a caption says what one
  line is worth ("a line every 150 m").
- **Strength**: how strongly the height map is drawn over the picture, 0 to 100%.
- **Show flooding** (on): **blue** where the sea level floods what the picture shows as land,
  **sand** where it leaves dry what the picture shows as sea, and the height map's own shore as a
  thin orange line. This is the alignment and sea-level feedback in one.
- **Coast match n%**, top left, always in view: quiet when good, amber when close, red when off.
- Wheel or pinch zooms and a drag pans the preview, as on the map (the mockup shows it fitted only).

### 1. Height map

- The image's thumbnail, name, size, and **Replace…**, which opens **the existing image dialog**
  (`ImagePicker` with `forMap`): the library by folder, name or entry; Upload…; Paste image and
  Ctrl+V; a web address (`d12`, `p7`). Its title reads "Choose a height map". Nothing new to learn.
- **White is high | Black is high.** On choosing an image Frontier tries both and takes the one
  whose sea fits the picture's, sets the sea level the same way, and says so in a line under the
  switch: "Frontier saw that black is high here, and set the sea level to match the picture's
  coast. Change either below." (`d13`)
- A colour picture is accepted but warned about in the check ("This looks like a colour picture,
  not a height map: its brightness is used"). 16-bit PNGs are read at 8 bits in the first version; a
  light blur hides the steps.

### 2. Line it up

It starts **over the whole picture** (the same extent as the map), which is right when both came
out of one program, and says so. If it is not right:

- **Line up for me**: slides (and, in the real tool, resizes by up to ±10%) the height map to where
  its sea best fits the picture's, then matches the sea level again, and reports "coast 60% → 96%"
  (`d15`). About 0.2 s. It needs a sea in the picture.
- **Move by hand**: a dashed frame with corner handles appears. Drag inside to move, drag a corner
  to resize (proportions kept; Shift frees them). The flooding and the match follow the pointer
  (`d08`, `d11`). **Arrow keys** move it one picture pixel (Shift: ten), **+ / −** resize by half a
  percent, **0** puts it back.
- **Match two points…**: for maps with no sea, or a coast that was redrawn. A banner walks through
  four clicks: a place on the height map (shown alone), the same place on the picture (shown alone),
  then a second pair far from the first (`d16`, `d17`, `p10`). Two pairs fix position and size.
  Points too close together are refused. Esc or Cancel leaves it.
- **Put it back over the whole picture**, and **Exact position** (the four numbers, the existing
  `ExtentForm`) folded away for those who know them.
- Not offered: turning or skewing. A height map at an angle to its picture needs a paint program;
  the check says so when no position gives a good match.

A status line says where it is in the map's own units: "Moved 31 km east, 15 km north and drawn at
94.4% of the picture's size."

### 3. Sea level

- A slider, **lower … higher**, with the level shown as a height ("0 m") when real heights are
  given, else as a grey ("12% grey").
- Under it, what it does, live: "Floods **1,250 km²** the picture shows as land · Leaves dry
  **10 km²** the picture shows as sea" (`d06`, `d07`, `p4`).
- **Match the picture's coast** sets it to the best-fitting level. A new image starts there, so
  most owners never touch the slider.
- Moving it on purpose is legitimate (a drowned coast, a different age of the world): the check then
  says "nearly on the coast", not "wrong".

### 4. Real heights (optional) and smoothing

- **Black is** ‹lowest› · **White is** ‹highest› · unit (m or ft; or the map's own unit when it is
  neither km nor miles). The labels swap with the white/black switch. With both given the note
  reads "So the sea lies at 0 m and the land rises 2,600 m above it. Slopes and travelling times are
  real."
- **Left empty**, heights are only relative. Rivers are unaffected (water only needs "lower").
  "Flattest" and the order of routes still work. Travelling times over hills are rough: Frontier
  takes the steepest ground on the map to be a mountain pass (about a 30% slope) and scales the rest
  from it. A river's note leaves out "falls about 1,410 m", and a route's note says "heights not
  given". One of the two filled in is treated as empty, with "Give both, the lowest first."
- Real heights also need the map's scale; without one the note says "Set the map's scale to make
  slopes real" with the Measure tool's link.
- **Smoothing**: None · Light · Medium · Strong · Very strong. For scanned, compressed or banded
  images. It changes how Frontier reads the image, never the image.

### 5. Check

Plain sentences, worst first, each with what to do and a button that does it (`d09`, `d14`, `d18`,
`d20`, `p9`). The worst one is repeated in the dialog's foot, and on a phone as a dot on the Check
step.

| It says | When | Advice and button |
| --- | --- | --- |
| **Lines up with the coast: 98% match** | 85% and over | none |
| **Nearly on the coast: 78% match** | 68–84% | "Try the sea level first, then nudge it. If it fits in one place and not another, the height map was made from another version of the map." **Match the picture's coast** |
| **Doesn't line up with the coast: 62% match** | under 68% | "Rivers would cross the painted shore. Let Frontier slide it into place, or move it by hand." **Line up for me** |
| **Looks upside down** | the other way up fits far better | "The sea is brighter than the land in this image." **Switch to Black is high** |
| **No sea in the picture to check against** | an inland map | "Use Match two points to line it up, and Relief to judge it by eye." |
| **Flat: 72% of the land lies on level steps** | over 30% | "Rivers run straight across them and a route can't tell a hill from a plain. An image with more greys (16-bit, or saved larger) is the real cure; smoothing softens the steps." **Smooth it** |
| **Too noisy: 7% of the land is tiny hollows** | over 2% | "Rivers would wriggle from one to the next. Smoothing removes most of them." **Smooth it** |
| **Enough detail for rivers and routes** | neither | none |
| **Covers 84% of the map** | moved or smaller | "Outside it, terrain is guessed from the picture." |
| **Real heights not given** | empty | "Slopes are relative: fine for rivers and for comparing routes, rough for travelling times." |

**The coast match** is the share of shoreline that agrees: for every cell of the picture's coast,
how near the height map's shore is, and the other way round, falling to nothing at 30 cells
(about 3% of the map's width). In the mockup: lined up 98%; 14 km off 69%; 34 km off 43%; the old
export as it arrives 60%. Nothing in the check ever blocks Done.

### Remove terrain

In the foot (on a phone, at the bottom left of every step). It closes the dialog, takes the terrain
off the map and shows "Terrain removed. The image stays in the library. **Undo**". No confirmation,
because Undo puts it back whole (`d22`).

## No height map

The dialog opens on what Find paths believes now (`d23`, `p13`):

- **Left:** the guess, drawn as relief over the picture, captioned "What Find paths guesses now".
- **No height map yet:** two sentences on what one is and where they come from (Wonderdraft,
  Azgaar's generator, Gaea, a paint program), and the one primary button, **Choose a height map…**.
- **Until then, Find paths guesses:** what the guess is good for (routes and Trace) and not
  (rivers), then **what the owner has drawn that counts**, by each style's "counts as": "Grey Peaks
  (zone, Mountains style) counts as Mountains · Wyn Forest and 1 more zone count as Forest · 3 paths
  in the River style count as River; 1 in Road counts as Road". A closing line: "Draw a zone in a
  style that counts as Mountains, Water, Forest or Marsh and the guess improves at once."
- **Keep the guess** (marked "later" in the mockup): saves the guess as a grey PNG in the library
  and uses it as the height map. Sea level, smoothing and Replace then work on it; the owner can
  paint over the file in any paint program and choose it again.

**Recommendation.**

- **Terrain hints from zones and paths: yes, now.** They come free with "counts as" on styles
  (Water, Forest, Marsh, Mountains, River, Road), they are certain where the picture is a guess, and
  the dialog only has to list them. They also keep working under a real height map: a Forest zone
  slows a route whatever the heights say.
- **Keep the guess: not in the first build; a day's work straight after.** It is honest only if the
  kept guess stays marked: the terrain carries `guessed: true`, the check leads with "This is
  Frontier's guess, not a real height map", and Find paths keeps its amber line, reading "Terrain
  guessed from the picture (kept)" (`d24`). Without that marking it would turn a guess into
  something that looks trusted. The first build should prove the real height map; the owner can
  then say whether the guess is worth keeping.

## On a phone

A **full-height sheet** (`p2`–`p10`):

- **Top:** Cancel · Terrain · **Done**. Done is always there; the steps can be taken in any order.
- **Preview** in the upper 42% of the screen, with Heights · Relief · Contours and Strength on it,
  and the coast match in its corner.
- **Steps** as a row of five tabs: **Image · Line up · Sea · Heights · Check**. Only the open
  step's controls show below, so nothing scrolls under the preview. Check carries an amber or red
  dot when something is wrong.
- **Bottom:** Remove terrain · Back · **Next** (the last step's Next reads Done).
- **Line up** is the only step in which a finger moves the height map: one finger drags it, the
  corner handles are large (a 22 px reach), two fingers zoom the preview. In every other step one
  finger pans the preview. There is no separate Move by hand button.
- **Match two points** fills the preview with the banner across its top (`p10`); a tap is a click.
- The image dialog opens full screen over the sheet, as it does for an entry.
- With no height map the sheet is the preview of the guess and the same three blocks, scrolling.

## Keyboard

- The dialog keeps the focus inside (`DialogFrame`) and gives it back to what opened it.
- **Enter** in a field or on a slider: Done. **Esc**: leaves Match two points, then Move by hand,
  then cancels the dialog. A click beside the dialog closes it only while nothing has changed.
- The preview takes the focus (Tab). There: **arrows** move the height map (Shift: ×10), **+ / −**
  resize, **0** over the whole picture. Pressing one turns Move by hand on.
- Sliders are ordinary range inputs: arrows, Home, End.
- On the map: **H** shows or hides relief (editing and viewing). Nothing else is added; "Terrain…"
  is in the "?" sheet under the map's menu, not as a key.
- Every state is told in words as well as colour: the match as a number, the check as sentences,
  the verdict in a `role="status"` line.

## Offline

- **Using terrain offline needs the height map on the device.** The device keeper already stores a
  kept map's images; it stores the terrain's image with them, at the working size (lossless, not the
  display width's JPEG). Then Find paths, relief and the dialog's sliders all work offline.
- **Not on the device:** Find paths falls back to guessing and says "The height map isn't on this
  device: guessing terrain from the picture". The chip shows the same with a struck-through
  mountain; Relief is disabled with that reason. Nothing is lost; it comes back with the connection.
- **The dialog offline:** adjusting an image that is on the device works, and Done saves through the
  save queue like any map change. **Replace…** and the first choice need a connection, as all image
  upload, paste and web import do (stage 15); the buttons are disabled with "Needs a connection".
- **Remove terrain** works offline (it is a change to the map file).

## Saving

**On Done, as one step, with Undo.** The dialog works on a copy. Nothing reaches the map, the save
queue or the other devices until Done; then `terrain` is written once, the map's history gets one
step ("Terrain"), and a toast says "Terrain set: Find paths now uses the height map · **Undo**"
(`d21`). Ctrl/⌘+Z on the map undoes it, Shift+Ctrl/⌘+Z redoes. Cancel and Esc discard without
asking, with one exception: an image uploaded in this sitting stays in the library as an
unpublished upload either way, and Cancel says so ("The image is in the library; this map does not
use it").

Why not live: every slider tick would be a save, a sync and a rebuild of the water in Find paths'
worker, and half-aligned terrain would be what another device sees. The preview already shows
everything live inside the dialog.

## Data

One optional `terrain` object on the map file (decision 1 of `auto-paths.md` no longer adds
`role` to an image):

```jsonc
"terrain": {
  "image": "Maps/Greywater/greywater-heights.png", // vault path
  "extent": [0, 0, 1920, 1280],   // as an image's; left out: the whole map
  "invert": true,                 // black is high; left out: white is high
  "seaLevel": 0.121,              // 0–1 of the grey scale, after invert
  "range": [-360, 2600],          // heights of the lowest and highest grey; left out: relative
  "rangeUnit": "m",               // with range; "m", "ft" or the map's own unit
  "smoothing": 2,                 // 0–4; left out: 0
  "guessed": true                 // only for a kept guess (later)
}
```

- `MapFile` is `.passthrough()` and the file stays **version 1**; `terrain` goes at the end of
  `TOP`. An older app keeps the field and draws nothing new.
- It merges as one value, like `title` and `under`: two devices changing terrain at once keep the
  later one whole, never half of each.
- Relief shown or hidden is a view setting on the device, like the layers' eyes, not in the file.
- A map with `terrain.image` missing from the vault reads as "The height map is gone from the
  library" in the Layers row, with Replace… and Remove.
- One terrain per map. Globes: the same object, with the extent in longitude and latitude; the
  dialog is flat-maps-only in the first build, as Find paths is.

## Decisions for the owner

1. **When changes apply.**
   - **(a, recommended) On Done, as one Undo step.** Safe to experiment; one save; other devices
     never see a half-aligned height map.
   - (b) Live, each change saved as it is made. No Done to forget, but Cancel can no longer mean
     "never mind", and every slider drag syncs.
2. **Without a height map.**
   - **(a, recommended) Hints now, keep-the-guess next.** The dialog shows the guess and lists what
     counts from zones and paths; "Keep this guess as a height map" follows as a one-day addition,
     always marked as guessed.
   - (b) Both now (one more day). (c) Neither: the empty dialog only offers Choose a height map.
3. **Lining up: which aids in the first build.**
   - **(a, recommended) All three: Line up for me, Move by hand, Match two points** (about 2.5 days
     together). The automatic one covers most coastal maps in one press; by hand covers fine
     nudges; two points is the only help for an inland map.
   - (b) Line up for me and Move by hand only (saves about a day; inland maps are lined up by eye).
   - (c) The four numbers only, as images have today (saves two days; hard to use).
4. **Relief for readers.**
   - **(a, recommended) Relief is a view anyone can turn on**, editing or viewing: the eye in
     Layers → Terrain and key H, off by default, remembered on the device, and drawn in a saved
     picture when it is on. It costs nothing extra and makes a flat painted map read as land.
   - (b) An editing aid only: the chip and the eye are hidden while viewing.

## Build plan (one engineer, about 8 days; 6 with decision 3b)

1. **Schema and plumbing (0.5 day).** `terrain` on `MapFile` (zod, `TOP`, merge as one value,
   tests for round-trip and for an older reader keeping it); `useMapFile` change + history step.
2. **Reading a height map (1 day).** In Find areas' worker: decode at the working size, to greys,
   invert, smoothing (two box passes), resample through the extent onto the cell grid; cache per
   image and settings. Server: serve the image losslessly at the working width. Unit tests on small
   synthetic fields.
3. **Measuring it (1 day).** `terrain/fit.ts`: sea mask against the picture's water class; best
   sea level from two histograms; which way up; coast match (two distance transforms); flat and
   noisy shares; cover. Tests: a shifted copy scores lower and `bestPlace` brings it back; an
   inverted copy is detected; a banded copy reads flat; a noisy one reads noisy and smoothing cures it.
4. **The dialog, desktop (2 days).** `TerrainDialog.tsx` on `DialogFrame`; the preview canvas
   (picture, overlay in three views, flooding, shore, frame and handles, zoom and pan); the five
   sections; `ImagePicker forMap` with its title as a prop; the check list and verdict; Done,
   Cancel, Remove with the Undo toast.
5. **Lining up (1.5 days; 0.5 with 3b).** Line up for me (coarse-to-fine search over position and
   ±10% size, then the sea again), Move by hand with keys, Match two points; `ExtentForm` reused
   for Exact position.
6. **Phone sheet (1 day).** Steps, Back/Next, one-finger drag only in Line up, large handles, the
   full-screen image dialog over it.
7. **On the map (0.5 day).** "Terrain…" in `MapBar`'s ⋯; the Terrain section in `LayerPanel`; the
   chip and relief overlay (`overlay.ts`, `savePicture.ts`); `map.relief` = H in `keys.ts` and the
   "?" sheet; Find paths' terrain line as a button; the offline states and the device keeper
   storing the terrain image.
8. **The empty state and hints (0.5 day).** The guess as relief; the list from styles' "counts
   as" (which Find paths' build adds).
9. **Browser tests and docs (1 day).** Desktop: choose from the library, the old export is flipped
   and warned about, Line up for me fixes it, sea slider floods, Done then Undo, Remove then Undo.
   Phone: steps, drag in Line up, Done. `docs/designs/stage-<n>-terrain.md` from this once approved.

Then, separately: Keep this guess (1 day), 16-bit PNGs, globes with Find paths' own globe work.
