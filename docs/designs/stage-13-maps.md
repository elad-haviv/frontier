# Stage 13: maps

- **Author:** Elad Haviv
- **Status:** Approved after a Goldfish review (2026-11-23; findings in .egm/review-13/)
- **Date:** 2026-11-23
- **Parent:** [Stage 11](stage-11-foundations-shell-tree.md), which provides the shared pieces this stage
  uses: icons, tooltips, menus, the combobox, the keys registry, the save queue, the right side bar
  (the bottom sheet on a phone) and, from release 11c, the pipeline for library item files that
  `.frontier/folders.json` uses. [Stage 12](stage-12-entries-editor.md) provides, in release 12b, the
  image dialog (`ImagePicker`), the entry combobox (`EntryCombobox`) and context-menu submenus. Earlier
  map stages: [4](stage-4-maps.md), [6](stage-6-maps-in-time.md), [7](stage-7-more-map-views.md),
  [8](stage-8-ai-companion.md#8d-discovery-on-a-map-with-concept-art). Comes from
  [`concepts_brief.md`](../../concepts_brief.md) (stages 11 to 15) and the author's list of 2026-11-22
  in [`BACKLOG.md`](../BACKLOG.md). Review IDs (MP-1 and so on) are from
  [the UX review](../../ux-review/expert-review.md).

---

## Overview

Frontier is a single-author web app for writing the world of Avalymia as a library of Markdown entries,
with maps drawn over the author's own images. Terms from
[Stage 11, Terms](stage-11-foundations-shell-tree.md#terms) apply (a **draft** is a change kept on the
server until "Save a version" writes it to the library; an **item file** is a JSON file of items with
ids, merged item by item). Terms from the earlier map stages that this document uses:

- **Space.** A map's `space` says what its positions are: on a **sphere** (a globe) they are longitude
  and latitude; on a **flat** map they are pixels of the map's image. A schematic map is a flat map
  without measuring (stage 7).
- **Feature.** A marker, a path or a zone. Its **kind** is one of those three words.
- **Map of this place.** A feature's `child`: another map that shows the place in more detail, opened
  from the feature (stage 4).
- **This map lies under.** A globe may lie under another globe, as caves under a surface; the bar
  then has buttons to go up and down between them (stage 7b). The field keeps this label.
- **Discovery.** In viewing, "Explore" and then a tap asks the AI what might be found at that place,
  drawing on the entries of the features near it and of the zones it lies in. Proposals show as "?"
  pins with a card (stage 8d).
- **The Turn panel and the focus box.** On a globe laid out in a projection, the Turn panel (a small
  card) turns the globe about three axes; its Focus button makes the next drag mark a box, and the view
  turns and zooms to fit it (stage 7a).
- **Paper.** The light colour drawn under paths and around markers so they read on any image. It is
  the overlay's own fixed colour (`#fbf7f0`, close to the page's light `--paper`), the same in both
  themes, because the map's image does not change with the theme and a saved picture must match the
  screen.

**Time on a map** ([stage 6](stage-6-maps-in-time.md#terms)). A **chronicle** is a timeline of the world
made of **spans**, each the period of one entry (a reign, a war), with a start and an end that may be
rough (stage 5). With **time on** (the map's Time switch), the map is shown at one year of one
chronicle, and each feature tied to a span has a **presence** at that year: _not yet_ and _gone_
(not drawn), _perhaps_ (drawn faint), _there_, or _undated_ (the chronicle cannot say; drawn dotted).
While editing, **Show everything** in the time bar draws the _not yet_ and _gone_ features too. A path,
zone or marker may have **later shapes**, each in force from the start of a span; the **first shape**
is the one it has had since stage 4.

This stage adds:

- **Shape on screen.** The shape of a feature that the map shows and that edits change. With time off,
  it is the first shape. With time on, it is the shape in force at the year shown, unless the author
  has **pinned** one: choosing a shape in the Edit feature tab's list of shapes pins it, so it is shown
  and edited whatever the year, until another feature is selected, the selection is cleared or the
  year moves (stage 6, "Which shape is edited").
- **Control point.** A point stored in a path or zone. A straight feature runs from one to the next;
  a curved feature passes through them.
- **Outline.** The line actually drawn for a path or zone: its control points joined by great circles
  on a globe or straight lines on a flat map, or by the curve when the feature is curved.
- **Picked point.** The corner of the selected path or zone that the last click chose; it is drawn
  larger, and Delete and "Remove this point" act on it.
- **Style.** A named look for paths or for zones (river, road, border, realm), kept once for the whole
  library. The word "kind" stays for marker, path or zone.

Stage 13 ships in five releases, in order:

- **13a-1, moving the code.** `MapPage.tsx` (1,664 lines) is cut into hooks and components with no
  change to any logic: the same markup, class names, words, timings and thresholds. Every map browser
  test passes without a change to its spec file. The map page becomes its own chunk, loaded when first
  opened.
- **13a-2, the pointer state machine.** First, new browser tests for the gestures the suite does not
  yet cover, passing on 13a-1's code. Then the pointer handling is rewritten as one state machine,
  which is new code, and those tests and the existing ones must still pass.
- **13b, viewing.** Hover shows what is under the pointer (cursor, halo, name, a floating entry
  preview), selection is clearly marked, a right-click menu acts on what was clicked, the map tools get
  keys, and every map control has a tooltip.
- **13c, editing tools.** A line from the last point to the cursor while drawing, straight or curved
  paths and zones, a "+" in the middle of each segment of the selected feature, dragging a whole zone,
  comboboxes for the entry, "Map of this place" and "This map lies under", and the image dialog for
  map images.
- **13d, styles.** Path and zone styles kept once for the library, an editor for them in the side bar,
  and a legend.

The collapsible right side bar the author asked for is 11b's: the map declares its tabs through
`usePanel`, and the bar shows whichever is open. Layers (with the Legend at its top from 13d) is always
there; Selected (viewing) or Edit feature (editing) is there while a feature is selected and opens when
one is chosen; Styles (13d) is there while editing. The bar folds away like any other, and L shows or
hides Layers.

## The Problem

- **The map gives no sign of what is under the pointer.** The cursor stays `grab` over a marker; paths
  and zones do not highlight; a marker without a label shows no name (MP-1). The selected marker looks
  like the others (MP-2).
- **`MapPage.tsx` is one component with about 64 pieces of state.** Pointer handling (`onPointerDown`
  to `onPointerUp`, lines 700–851) mixes panning, pinching, dragging markers and corners, the focus
  box and tool taps in one set of refs and flags. Hover, menus, a rubber band, midpoint handles and zone
  dragging would each add more branches to the same functions.
- **Drawing is hard to learn and to finish.** The hint says "Tap to add points." on a desktop; a path
  ends only by clicking its last point again or pressing the hint's "Done", which sits near the bar's
  "Done" (the one that ends editing); nothing shows where the next segment will go (MP-3). The marker
  tool turns itself off after each marker (MP-4).
- **Shapes cannot be adjusted easily.** A point can be added only by drawing the feature again; a zone
  can only be moved corner by corner; every line is straight, which suits borders but not rivers or
  coasts.
- **All paths look the same, and all zones.** Colour comes only from the layer; there is no width,
  dash or fill per kind of path, so a road and a river in one layer cannot be told apart.
- **The pickers are plain lists.** The entry field is a search box with six results; "Map of this
  place" and "This map lies under" are `<select>`s of every map; a map's image is chosen from a
  `<select>` of every image path, or a bare file input.
- **Few names and no keys.** The zoom buttons (`+`, `−`, `⤢`) and the layer and image rows (`⌖ ↑ ↓ ✕`)
  have no tooltips (IC-2); the icon picker is nearly invisible (IC-3); "Picture" is a select that means
  "Save a picture" (MP-5); there is no Delete, no Ctrl+Z and no tool key (DI-2).

## Goals

- **G1.** 13a-1 moves the map page's code into the modules listed in Technical Plan §1 with no change
  in behaviour: every existing map browser test passes without a change. 13a-2 replaces the pointer
  handling with one state machine, covered by unit tests and by new browser tests for each gesture,
  written and passing before the machine replaces the old code.
- **G2.** While viewing, with a mouse, pointing at a feature changes the cursor to a hand, draws a hover
  halo, and shows its name in a tooltip; after a short pause a feature linked to an entry shows a
  floating preview of that entry in place of the tooltip, made by the same code as link previews in
  the reader. (MP-1)
- **G3.** The selected feature has one clear look in every view: an accent ring around a marker, an
  accent halo along a path, an accent outline around a zone, and its handles while editing. (MP-2)
- **G4.** Right-clicking the map on desktop opens a menu for what is under the pointer (a feature, a
  point of the selected feature, or an empty place), in viewing and in editing. Shift+right-click gives
  the browser's menu. Touch has no long-press menu; each action has a touch home, listed in §4.
- **G5.** The map scope of the keys registry holds a key for each map tool and action named in
  Technical Plan §4, shown in tooltips and in the "?" sheet, and each says whether it acts in viewing,
  in editing or both. (DI-2)
- **G6.** Every map control has a name in a tooltip with its key: the bar, the tools, the zoom
  buttons, the layer and image rows (whose delete moves into a row "⋯"), and the marker icons.
  "Picture" becomes three "Save a picture" items in the map's "⋯" menu. (IC-2, IC-3, MP-5)
- **G7.** While drawing a path, zone or measured line with a mouse, a line runs from the last point to
  the cursor (and, for a zone, back to the first point). Drawing ends with a double-click, Enter, the
  hint's "Finish path" or "Finish zone" button, or a click on the last point; Esc cancels; Backspace
  takes back the last point. The marker tool stays on after a marker is placed; the path and zone
  tools return to Select after finishing. (MP-3, MP-4)
- **G8.** A path or zone is straight or curved, chosen while drawing and changeable later. The curve is
  computed by one function in `packages/geo`, so the overlay, hit-testing, the fill, the globe, the
  saved picture and the length shown all use the same line. Discovery keeps today's test, on the
  control points of the first shape (§6).
- **G9.** On the selected path or zone, while editing, a "+" at the middle of each segment, on the line
  as drawn, adds a point there, by a click or by dragging it out. A click leaves the line where it was.
- **G10.** While editing, pressing inside the selected zone and dragging moves the whole zone. Pressing
  inside a zone that is not selected still pans, and panning stays possible over the selected zone by
  two fingers on touch and by the middle button or Space+drag on desktop.
- **G11.** Every shape edit (a corner, a "+", a zone drag, removing a point) changes the shape on
  screen, whichever of the feature's shapes that is.
- **G12.** The entry field is stage 12's entry combobox and can be changed in the side bar; "Map of
  this place" and "This map lies under" are map comboboxes; the image of a new map and an added map
  image are chosen in the image dialog of stage 12.
- **G13.** Path styles and zone styles are kept once for the library, in `.frontier/map-styles.json`,
  saved through the save queue and versioned like the folder file. Each has a name, a colour (or the
  layer's), a width, a dash pattern and, for zones, a fill. A feature uses at most one. A legend at the
  top of the Layers tab lists the styles in use on the map.
- **G14.** On a phone, the right side bar is the bottom sheet of 11b; a tap selects; pinch zooms; two
  fingers pan; zone drag, "+" handles and the curve switch work by touch.
- **G15.** No regressions. The map file stays at version 1 and every new field is optional; the
  browser tests cover each journey below.

## Non-Goals

- **Labels drawn for paths and zones.** A path or zone shows its name in the hover tooltip and the
  side bar, as today; drawing it on the map (at a path's middle, a zone's centre, or along a river's
  bends) is deferred to a later stage, with the saved picture.
- **Dragging a whole path.** Not on the author's list, and rarely wanted: a river or road moves point
  by point.
- **Styles for markers.** Markers already have icons from the marker sets; the author asked for kinds of
  paths and zones.
- **A colour of its own for one feature.** A feature's colour comes from its style or its layer; a
  one-off colour is a style used once.
- **A list of the map's features** for keyboard users (AX-3). Not on the author's list; it stays in the
  backlog. Keys act on the feature selected with the pointer.
- **Moving the Turn panel and the discovery card into the side bar.** They are small cards tied to the
  view and to one place on the map, and stay where stages 7 and 8 put them.
- **A segmented "Globe | Flat | Projection" switch** (MP-5, first half). The View select keeps its
  label and gains a tooltip; it holds eight choices, which a segmented control cannot fit on a phone.
- **Discovery on the curved line.** Discovery keeps its test on the first shape's control points (§6).
- **Snapping, splitting a path, or joining two paths.**

## Decisions

| Decision | Date | Source |
| --- | --- | --- |
| Path and zone kinds are library-wide styles, not per map and not on layers | 2026-11-22 | author's list; brief, "Alternatives Weighed" |
| The new field is `style`, user-facing "path style" and "zone style"; "kind" stays marker, path or zone | 2026-11-22 | brief, "What all seven agreed on", 6 |
| Split `MapPage.tsx` before adding behaviour (13a) | 2026-11-22 | brief, "Further risks" |
| 13a ships as 13a-1 (pure moves) and 13a-2 (the state machine, after new gesture tests) | 2026-11-23 | Goldfish review (zoom-out M5) |
| Curves are a flag plus control points; the outline is computed in `packages/geo` | 2026-11-22 | brief, "Further risks" |
| Zone drag only once selected; "+" handles only on the selected feature; edits act on the shape on screen | 2026-11-22 | brief, "Further risks" |
| The map file stays at version 1 with optional fields | 2026-11-22 | brief, "Further risks" |
| Colour: the style's, else the layer's. No colour of a feature's own | 2026-11-23 | Goldfish review (zoom-out M3) |
| A style has one colour, not one per theme, and no contrast check | 2026-11-23 | this design: features are drawn over the author's image, which does not change with the theme, and a saved picture must match the screen (§9) |
| A style is deleted at once, with Undo in the toast; no count of its uses | 2026-11-23 | Goldfish review (zoom-out M2) |
| The styles file is a second library item file, through the pipeline 11c builds for the folder file | 2026-11-23 | Goldfish review (zoom-out M4) |
| No labels drawn for paths and zones in this stage | 2026-11-23 | Goldfish review (zoom-out) |
| The curve is a centripetal Catmull-Rom spline through the control points, on the unit sphere for globes | 2026-11-23 | this design (§6) |
| Discovery keeps today's test on the first shape's control points | 2026-11-23 | Goldfish review (zoom-out M1) |
| A zone on a sphere moves by a turn about the poles plus a change of latitude, so it stays upright | 2026-11-23 | Goldfish review (design M7); Alternative H |
| No long-press menu on the map; touch uses the side-bar panels and tools | 2026-11-23 | this design: a long press on the map is the start of a pan, as stage 12 decided for text |
| Edit / Done stays one button; viewing is the map's mode whenever it is not being edited | 2026-11-23 | this design (Alternative C) |
| A saved picture has no legend: it shows the map exactly as on screen | 2026-11-23 | was open question 1; Goldfish review |
| The path and zone tools return to Select after finishing, so the new shape can be adjusted at once | 2026-11-23 | was open question 2; Goldfish review |
| The map page is loaded lazily, as its own chunk | 2026-11-23 | Goldfish review (readiness M15) |

## Critical User Journeys (CUJs)

### CUJ 1: Read a map by pointing

- **Covers:** G2, G3, G4.
- **Given**: on desktop, the globe of Avalymia with a marker for Greywater Harbor linked to its entry,
  and a river named "Saltwash" with no entry.
- **When**: he moves the pointer onto the marker and waits; then onto the river; then clicks the
  river; then right-clicks the marker.
- **Then**: over the marker the cursor became a hand, a halo appeared, a tooltip read "Greywater
  Harbor", and after a moment a card with the name and the entry's opening lines took the tooltip's
  place. Over the river the line was haloed and the tooltip read "Saltwash"; it has no entry, so no
  card. The click gave the river an accent halo and opened the Selected tab. The right-click menu
  offered "Open the entry", "Open the map of this place" (disabled, with its reason), "Copy a link to
  this place" and "Edit this feature".

### CUJ 2: Draw a curved river and refine it

- **Covers:** G7, G8, G9, G5.
- **Given**: the same globe, in editing.
- **When**: he presses P, turns on "Curved" in the hint, clicks five points while a line follows the
  cursor from the last one, presses Backspace once, clicks again and double-clicks to finish. Then he
  drags the "+" between the second and third points outward, and presses Ctrl+Z.
- **Then**: the line to the cursor followed the curve the next click would make. The river was saved
  with five points and `curve: "smooth"`, drawn as a smooth line through them, and selected with its
  handles and four "+" signs, each on the line. Dragging the "+" added a sixth point where it was
  dropped; Ctrl+Z took it away in one step.

### CUJ 3: Move a border at a later year

- **Covers:** G10, G11.
- **Given**: a zone tied to "The kingdom", with a later shape from "The treaty"; time on at year 310,
  where the later shape is in force.
- **When**: he presses inside the zone while it is not selected and drags; then clicks it, presses
  inside it and drags it east; then holds Space and drags inside it.
- **Then**: the first drag panned the map. The second moved the later shape as a whole, still upright;
  the first shape is unchanged in the file. The Space drag panned. One Ctrl+Z put the zone back.

### CUJ 4: Place five towns and link them

- **Covers:** G7, G12.
- **When**: he presses M and clicks five places; on each, in the Edit feature tab, he opens the Entry
  combobox, types "har" and picks "Greywater Harbor"; on the last one he changes the entry to
  "Old Harbor" and sets "Map of this place" by typing "port" and picking "Port quarter".
- **Then**: the marker tool stayed on for all five; each marker opened its tab when placed. The last
  marker is linked to Old Harbor, and its card offers "Open the map of this place".

### CUJ 5: Give rivers and borders their own look

- **Covers:** G13.
- **Given**: two maps with rivers and borders, all in their layers' colours.
- **When**: in editing he opens the Styles tab, chooses "Add the usual styles", changes "River" to a
  blue, width 3, and "Border" to dash-dot with the layer's colour; then he gives two rivers on each map
  the River style and one border the Border style; then he deletes the River style, and presses Undo in
  the toast; then deletes it again.
- **Then**: after each step both maps showed the change. The Legend at the top of the Layers tab
  listed River and Border with samples. The first delete happened at once, with a toast "Deleted the
  style River" and Undo, which brought it back with its look. After the second delete the four rivers
  were drawn in their layers' colours, and their tabs read "Style: deleted". `.frontier/map-styles.json`
  and both map files are unpublished changes, saved together with the next version.

### CUJ 6: A new map from the image dialog

- **Covers:** G12.
- **When**: on Maps he names a new map, chooses "Flat", presses "Choose an image…", searches "coast",
  picks one and presses "Make the map". In editing he opens Layers and adds a second image by pasting
  a web address in the same dialog.
- **Then**: the map opens drawn over the chosen image; the second image is fetched by the server
  (stage 12, §7), added to the map over the whole extent, and shown.

### CUJ 7: On a phone

- **Covers:** G14.
- **Given**: the iPhone, 390 px wide, a map with a selected zone in editing.
- **When**: he taps a marker; long-presses the map without moving; drags inside the selected zone;
  drags with two fingers inside it; taps a "+".
- **Then**: the tap selected the marker and opened its tab in the bottom sheet; the long press was a
  tap (it selected what was under it) and opened no menu; the one-finger drag moved the zone; the
  two-finger drag panned; the "+" added a point.

## Technical Plan (Architecture)

### 1. The split (13a-1 and 13a-2)

Today one component holds loading and saving, the view and its address, time, drawing, the pointer
gestures, every tool and the page's markup. 13a-1 moves each into its own module and changes nothing
else: the same markup, class names, words, timings and thresholds. 13a-2 then replaces the moved
pointer handlers with the state machine.

```text
 pages/MapPage.tsx           composes the hooks and components below (target: under 350 lines);
                             loaded lazily from App.tsx
 map/useMapFile.ts           loading, the queue subscription, change / setFeature / undo / redo /
                             reloadMap / removeMap, the undo stamps, pending entry links
 map/useMapView.ts           view state, frame size, wheel zoom, the first view, the address,
                             goLayer (the address of another layer at the same place and year)
 map/useMapTime.ts           chronicles, year, pin, show-all, `resolve()` results, timeLine
 map/useMapDraw.ts           the WebGL renderer and the overlay, icons, titleOf
 map/useDiscovery.ts         explore mode, proposals on this map, the one open, explore(at)
 map/useMapKeys.ts           the map's shortcuts and the Esc cascade (§4)
 map/gesture.ts              13a-2: the pointer state machine: pure, no React, no DOM
 map/tools.ts                each tool as pure functions of (map, input) -> change
 map/usePointer.ts           13a-1: today's handlers, moved; 13a-2: binds the machine to the
                             canvas and carries out its effects
 map/layersBeneath.ts        above, below and lies(): which maps this one lies under
 map/savePicture.ts          the PNG of the map as shown
 map/askSize.ts              the radius of a world, or the scale from a measured line (setSize2)
 map/lengthText.ts           a length in words
 components/map/             MapBar, MapTools, MapHints, MapZoom, DiscoveryPins, MapSetup,
                             FeaturePanel, FeatureCard, FeatureEditor, LayerPanel
 components/EntryPicker.tsx  today's entry search, used by the chronicle's span form
```

**Where today's page functions go.** Every function of `MapPage.tsx` lands in one place:

| Today in `MapPage.tsx` | Goes to |
| --- | --- |
| `tap`'s explore branch (lines 636–654) | `useDiscovery().explore(position)`; the tap effect calls it while exploring |
| `tap`'s marker, sketch and select branches | `tools.ts`: `placeMarker`, `addSketchPoint`, `finishSketch`, `tapSelect` |
| the drag of a marker or corner, including a revolving marker turned back by its orbit (lines 799–820) | `tools.ts`: `dragShape(map, drawn, position, year)` |
| `savePicture` | `map/savePicture.ts`: `savePicture(input)`, with the overlay input built by `useMapDraw` |
| `setSize2` | `map/askSize.ts`: `askSize(map, measured, dialogs)` → a changed map or null |
| `remove` | `useMapFile().removeMap()` |
| `goLayer` | `useMapView().goLayer(id)` |
| `lies`, `above`, `below` | `map/layersBeneath.ts`: `lies(id, other, maps)`, `aboveAndBelow(map, id, maps)` |
| `timeLine`, `stops`, `spanName` | `useMapTime` |
| `reloadMap` | `useMapFile` |
| the Selected / Edit feature markup and its callbacks (lines 1177–1292) | `components/map/FeaturePanel.tsx` |
| the Layers markup and its setup block (lines 1086–1176) | `components/map/LayerPanel.tsx` and `MapSetup.tsx` |
| the bar, tools, hints and zoom buttons | `MapBar.tsx`, `MapTools.tsx`, `MapHints.tsx`, `MapZoom.tsx` |
| the "?" pins of discovery | `DiscoveryPins.tsx` |
| the `map.stopFocus` binding | `useMapKeys.ts` |

**FeaturePanel** is the Selected tab in viewing and the Edit feature tab in editing: it chooses
`FeatureCard` or `FeatureEditor` for the selected feature and wires their callbacks (link, delete,
remove a point, shapes, orbit) to `useMapFile`.

**EntryPicker** moves out of `MapPanels.tsx` into `components/EntryPicker.tsx` unchanged, with its
class `.entry-picker`, because `chronicle/SpanForm.tsx` uses it and `chronicle.spec.ts` reads that
class. `MapPanels.tsx` is then split into `components/map/FeatureCard.tsx`, `FeatureEditor.tsx` and
`LayerPanel.tsx`, and deleted. `overlay.ts`'s `styles` option (the time look: opacity and dashes) is
renamed `presence`, so that 13d's styles do not share its name.

**Lazy loading.** `App.tsx` loads `MapPage` with `React.lazy` inside a `Suspense` whose fallback is
today's "Opening the map…" line, so the map page, its renderer and d3 are their own chunk and the main
entry chunk can be measured on its own (Verification Plan).

**The state machine** (`gesture.ts`, 13a-2). One function, `step(state, event, ctx) → { state, effects }`,
where `ctx` gives what the machine may look at (mode, tool, focusing, the selection, the picked point,
whether Space is held, and a `pick(at, pointerKind)` that answers what lies under a screen point) and
`effects` is a list the hook carries out:

| Effect | What the hook does |
| --- | --- |
| `pan(dx, dy)` | moves the view |
| `zoom(cx, cy, factor)` | zooms about a screen point |
| `tap(at, pointerKind)` | the tool's tap: select, place a marker, add a sketch point, explore |
| `beginStep` | remembers the map once, before the first move of a drag, so the whole drag is one undo step (with the year, as undo stamps do: undo returns to the year at which the change was made) |
| `dragTo(target, at)` | moves the dragged target to the pointer |
| `box(rect)`, `focus(rect)` | draws the focus box; fits the view to it |
| `hover(target)`, `cursor(name)` | 13b |

Only the primary button of a mouse starts a gesture in 13a-2; other buttons are ignored (13c gives the
middle button a pan). A touch or pen press always counts. States and their transitions:

| State | Entered on | Left on |
| --- | --- | --- |
| `idle` | start, every release | a press → `press`, or `box` while focusing |
| `press` | a press: remembers where, when, by which pointer kind, and what `pick` found there | moving past 6 px (mouse) or 10 px (touch, pen) from the press → `drag` if `pick` found a draggable target, else `pan`; release → `tap` effect, `idle`, however long the press lasted; a second finger → `pinch` |
| `pan` | a press on nothing draggable that moved; or one finger left after a pinch | release → `idle`; a second finger → `pinch` |
| `drag` | a press on a draggable target that moved: emits `beginStep` once, then `dragTo` | release → `idle`; a second finger → `pinch` (the drag so far stays, as one undo step) |
| `pinch` | a second finger in `press`, `pan` or `drag` | each move zooms about the fingers' midpoint (and, from 13c, pans by the midpoint's movement); one finger lifted → `pan` with the other, never a tap; both lifted → `idle` |
| `box` | a press while focusing on a region | release → `focus` if the box is at least 12 px each way, which ends focusing; a smaller box is ignored and focusing stays on; a second finger → `boxCancelled` |
| `boxCancelled` | a second finger during `box` | the last finger lifted → `idle`; no focus, and focusing stays on |

A `pointercancel` ends any state as a release that never taps. (Today it is handled as a release, so a
cancelled press could tap; this is the one deliberate change in 13a-2.) A press held still for any time
is a tap, so there is no long-press behaviour: per tool, a still long press selects (Select), places a
marker (Marker), adds a point or finishes on the last point (Path, Zone, Measure) or explores
(Explore), exactly as a short one.

**`pick`** is the only place that decides what a press is on, in this order:

1. a corner of the selected feature's shape on screen, within 18 px (`vertexAt`'s reach); corners on the
   far side of a globe are not pickable (they are found with `project`, which gives nothing there,
   instead of today's `projectClamped`, which pulls them to the edge);
2. (13c) a "+" handle of the selected feature, within 18 px;
3. the selected feature's body: the selected marker within 24 px (as today), (13c) the inside of the
   selected zone;
4. any feature, by `shapeAt` (markers within 22 px, paths within 11 px, zones by their inside);
5. nothing.

13b and 13c add targets and effects to this one function instead of new branches in the page.

**Tools** (`tools.ts`): `placeMarker`, `addSketchPoint`, `finishSketch`, `tapSelect` and `dragShape` as
functions that return the next map and selection; the page applies them through `useMapFile().change`.
13a-1 only moves today's logic, including the return to Select after a marker.

### 2. Hover (13b)

- **Who gets it:** decided by the event's `pointerType`: pointer moves from a mouse hover; touch and pen
  moves do not (a touch screen has no hover; a tap selects). The hint's words (§5) are chosen before
  any pointer moves, by `(hover: hover) and (pointer: fine)`, as `HoverPreview` checks.
- **Finding:** on a mouse move in `idle`, once per animation frame, `pick` is asked what is under the
  pointer. This is the same hit-test a click uses, so what lights up is what a click selects, in the
  globe, the flat view of a globe, every projection and on flat maps, including repeats of a globe laid
  flat. Features on the far side of the ball are never drawn, so never found.
- **Cursor:** set on `.map-top` directly, not through React state: `pointer` over a feature, `grab` over
  nothing, `grabbing` while panning, `crosshair` with a drawing tool; in editing, `move` over a corner,
  the selected marker or inside the selected zone, and `copy` over a "+". The `tool-*` classes stay on
  `.map-top` for the drawing tools' cursor.
- **Halo:** drawn on a third canvas above the overlay (`.map-live`), which also carries 13c's rubber
  band. Hovering redraws only that canvas, so moving the pointer never redraws every feature.
- **Events stay on `.map-top`.** `.map-live`, the tooltip and the floating preview have
  `pointer-events: none`, so every press, move and right-click reaches `.map-top`, which holds the
  handlers.
- **Tooltip:** the feature's name (`titleOf`), or "Unnamed path" and so on, placed at the marker or at
  the point where the pointer met the path or zone, shown at once and kept until the hover changes.
  While editing, over a corner it reads "Drag to move · Delete to remove"; over a "+", "Add a point".
- **Floating preview:** in viewing only, after 350 ms over a feature linked to an entry, a card with the
  entry's name and opening takes the tooltip's place, kept inside the frame. `HoverPreview.tsx` is split
  into its parts: `usePreviewText(path)` (the shared cache and `api.preview`) and `PreviewCard` (the name
  and the cleaned text). The reader's link preview keeps using them unchanged; the map's `MapHover` uses
  them with a point instead of a link's box. A feature with a map of its place adds a line "Map of this
  place: Port quarter". The preview closes on a press, a wheel, a pan or leaving the frame.

### 3. Selection and viewing (13b)

- **Viewing** is the map whenever Edit has not been pressed: nothing can be changed by a slip, a click
  selects and opens the Selected tab (the `FeatureCard`), hover shows names and previews. While editing,
  hover shows the cursor, the halo and the tooltip, but no floating preview, so cards do not cover the
  shapes being worked on.
- **The selection look** uses one colour, `--map-select` (defined in `styles.css` for light and dark,
  read once per draw), sized from the feature's own width `w` (2.5 px for a path without a style, 1.5 px
  for a zone's edge): a marker gets a paper ring and an accent ring outside it; a path gets an accent
  casing `w + 6` px wide under its line; a zone gets an accent outline `w + 2` px wide under its own edge.
  Hover uses the same look at half strength. Saved pictures draw no selection or hover, as today.
- **The Selected tab** gains "Copy a link to this place" and "Edit this feature" (enters editing with it
  selected). Its "Close" stays. The link is the map's address with `f=<feature id>`, and with `t` and `c`
  when time is on, but never `v`: the page centres on `f` only when the address has no view (today's
  rule, `MapPage.tsx` 347–351). Opening it centres on the shape in force at that year (a marker's place,
  or the first point of a path or zone), not on the first shape as today.

### 4. Context menu and keys (13b, 13c)

**The context menu** wraps `.map-top` in `ContextMenu` (stage 11). Radix opens its menu on a right-click
and on a 700 ms touch long press unless its trigger is `disabled`; it calls the child's own
`contextmenu` handler first. So:

- The page's `pointerdown` handler records the press's pointer kind and whether Shift was held. While
  the last press was a touch or held Shift, the trigger is `disabled`: Radix starts no long-press timer
  and leaves the right-click alone, so Shift+right-click shows the browser's menu and touch shows none.
- The page's `contextmenu` handler returns early in those two cases. Otherwise it calls `pick` at the
  event's point and stores the target; Radix then opens the menu at that point. The menu's `open` is
  held by the page (`open`, `onOpenChange`), so hover pauses while it is open, and closing it clears the
  target and returns the focus to the map frame.
- Changes to the wrapper (`ui/ContextMenu.tsx`): `disabled` passed to the trigger; `open` and
  `onOpenChange` passed to the root; `ContextMenuItem` gains `disabledReason`, shown as the menu items'
  tooltip as `MenuItem` already does.

| Under the pointer | Viewing | Editing | On touch |
| --- | --- | --- | --- |
| a feature | Open the entry · Open the map of this place · Copy a link to this place · Edit this feature | Edit in the side bar · Straight / Curved (13c) · Path style ▸ / Zone style ▸ (13d) · Move to layer ▸ · Bring forward · Send back · Delete | tap the feature: each item is in its Selected or Edit feature tab |
| a corner of the selected feature | — | Remove this point (disabled at the minimum, with the reason) | tap the corner, then "Remove this point" in the Edit feature tab |
| a "+" of the selected feature | — | Add a point here | tap the "+" |
| nothing | Copy a link to this view · Explore here (when discovery is on) | Add a marker here · Start a path here · Start a zone here | "Copy a link to this view" in the map's "⋯"; Explore, then tap; the Marker, Path and Zone tools |

Items that cannot be used are shown disabled with their reason, as in stage 11.

**Deleting.** Delete (the key, the menu item or the tab's button) removes the picked point if there is
one, else the selected feature, in one undo step and without a confirm. A point cannot be removed when
the shape on screen has its minimum, 2 points for a path and 3 for a zone, whichever of the feature's
shapes it is (later shapes too): the menu item and "Remove this point" are disabled with "A path needs
at least 2 points" or "A zone needs at least 3 points", and the key does nothing but show that reason
in the hint line. While drawing, Delete and Backspace take back the last point instead (13c).

**Keys** (scope `map`, bound by `map/useMapKeys.ts`). Plain letters are not taken in a typing field (the
registry's rule). Keys that a focused control also uses (arrows, Enter, Delete, Backspace, Space) act
only when the focus is on the map frame (which becomes focusable, `tabIndex=0`) or on nothing;
otherwise the action returns `false` and the control keeps the key. Pressing the canvas focuses the
frame (`focus({ preventScroll: true })`), so the keys work again after using one of the hint's or the
bar's buttons. Undo and redo follow the same rule: in a side-bar tab (Edit feature, Styles), Ctrl+Z is
the text field's own undo, or nothing. No key uses Alt, so AltGr on European keyboards cannot trigger
one; none is a key the browser keeps (Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Shift+W, Ctrl+plus and Ctrl+minus
are left alone).

| Id | Keys | Label | Viewing | Editing | Release |
| --- | --- | --- | --- | --- | --- |
| `map.edit` | `e` | Edit the map | yes | — | 13b |
| `map.done` | `Mod-Enter` | Done editing | — | yes | 13b |
| `map.select` | `v` | Select tool | — | yes | 13b |
| `map.marker` | `m` | Marker tool | — | yes | 13b |
| `map.path` | `p` | Path tool | — | yes | 13b |
| `map.zone` | `z` | Zone tool | — | yes | 13b |
| `map.measure` | `r` | Measure tool | — | yes | 13b |
| `map.undo` | `Mod-z` | Undo | — | yes | 13b |
| `map.redo` | `Shift-Mod-z`, `Mod-y` | Redo | — | yes | 13b |
| `map.delete` | `Delete`, `Backspace` | Delete the picked point or the selection; while drawing, take back the last point | — | yes | 13b (the "last point" part in 13c) |
| `map.cancel` | `Escape` | Stop, one step at a time (below) | yes | yes | 13b (replaces `map.stopFocus`) |
| `map.zoomIn` | `=`, `+` | Zoom in | yes | yes | 13b |
| `map.zoomOut` | `-` | Zoom out | yes | yes | 13b |
| `map.fit` | `0` | Show the whole map | yes | yes | 13b |
| `map.pan` | `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` | Move the map | yes | yes | 13b |
| `map.panFar` | `Shift-ArrowUp`, `Shift-ArrowDown`, `Shift-ArrowLeft`, `Shift-ArrowRight` | Move the map further | yes | yes | 13b |
| `map.layers` | `l` | Show or hide the Layers tab | yes | yes | 13b |
| `map.time` | `t` | Turn time on or off | yes | yes | 13b |
| `map.finish` | `Enter` | Finish the path or zone | — | while drawing | 13c |
| `map.curve` | `c` | Straight or curved, while drawing or for the selected feature | — | yes | 13c |

In viewing, the tool keys, Delete, undo and redo do nothing (their actions return `false`).

**Esc, one step at a time.** An open context menu closes first (Radix handles that). Then
`map.cancel` takes the first of these that applies, and returns `false` when none does, so the shell's
own Esc can act: (1) the focus box: stop focusing; (2) a drawing in progress (path, zone or measured
line): cancel it, keeping the tool; (3) a tool other than Select: back to Select; (4) the picked point;
(5) the selection. In viewing only (1) and (5) can apply.

**The keys parser** (`keys.ts` `parse`) splits a spec on "-", so today a bare "-" throws. It learns that
a spec ending in "-" names the minus key: `"-"` is minus alone and `"Mod--"` is Mod with minus. The
Shift-Arrow specs are their own entry (`map.panFar`), since the registry matches Shift exactly for
named keys.

`map.turn` (Enter in the Turn panel) stays a label-only entry. Each tool button's and zoom button's
tooltip shows its key from the registry.

### 5. Drawing: the line to the cursor and finishing (13c)

- **The rubber band**, while a path, zone or measured line is being drawn and the pointer is a mouse:
  on `.map-live`, the outline of the sketch's points plus the pointer's position, drawn with the same
  function as a finished feature, so on a globe it follows the great circle and with "Curved" it shows
  the curve the next click will make. For a zone a fainter line closes back to the first point. When
  the pointer is off the globe (`unproject` gives nothing) no band is drawn.
- **Finishing:** a click within 16 px of the last point finishes, as today. A double-click finishes
  through that same rule: its first click adds a point and its second lands on that point. Measuring
  has no such need, since a click on its last point adds nothing. Enter and the hint's "Finish path" or
  "Finish zone" button finish too. A path needs two points and a zone three; until then the button is
  disabled with that reason. The finish button replaces the hint's "Done", so "Done" means only the
  bar's button that ends editing.
- **The hint** reads, where the pointer can hover: "Click to add points · Double-click or Enter to
  finish · Esc to cancel"; on touch: "Tap to add points. Tap the last point again to finish." Both carry
  the Straight / Curved switch and the finish button. The switch's choice is remembered on the device
  under `frontier:map-curve`, read and written only by `map/curveSetting.ts` (`useCurveSetting()`,
  with a fallback when storage is refused). The measure hint keeps its words and has no curve switch:
  measuring is along straight lines.
- **After a marker** the Marker tool stays on, and the new marker is selected with its Edit feature tab
  open, so it can be linked while the next one waits (MP-4). Esc or V returns to Select. After a path
  or zone the tool returns to Select, because the next step is usually adjusting the shape just drawn
  (Decisions).
- **MP-6:** the layer new features go into is marked "Drawing into" in the Layers tab, and named in the
  hint.

### 6. Curves (13c)

**Stored:** an optional `curve: "smooth"` on a path or zone. Without it the feature is straight, as
every feature is today. The flag belongs to the feature: all its shapes, the first and the later ones,
are drawn curved or straight together, because a river does not change between curved and straight
over time. A later shape added from the screen starts with the points on screen, so it looks the same
when made. The points of each shape are its control points.

**The curve:** a centripetal Catmull-Rom spline (parameter exponent 0.5) through the control points.
Centripetal parametrisation is chosen because it never forms a cusp or a loop within a segment, unlike
the uniform form, and because the line passes through every control point, so the handles always sit
on the line. A path's ends use a mirrored point beyond each end (so the curve leaves along the first
segment); a zone is a closed loop.

**Where it is computed:** `packages/geo/src/curve.ts`:

```ts
export interface Outline {
  /** The positions to draw, after `densify`; for a closed outline the first is repeated last. */
  line: Position[];
  /** One entry per stored segment (a path's n − 1, a zone's n): the index in `line` where it starts. */
  spans: number[];
}
export function outline(
  space: Space,
  points: Position[],
  options: { curve: boolean; closed: boolean },
): Outline;
```

- **Repeated points.** Points equal to the one before (and, for a zone, the last equal to the first) are
  set aside before the spline, and put back as zero-length segments in `spans`, so `spans` still has
  one entry per stored segment and stays aligned with the stored points. A zero-length segment gets no
  "+" handle.
- **Too few points**, after setting repeats aside: one distinct point gives a `line` of that point (a
  dot, no fill); two distinct points give the straight line between them (for a zone, there and back,
  with no fill), whether curved or not.
- On a **flat map** the spline is computed in the map's own units (image pixels), with
  `clamp(ceil(chord / 8), 8, 64)` samples per segment.
- On a **sphere** each control point is turned into a unit vector in 3D; the spline is computed on those
  vectors, and each sample is scaled back onto the sphere and turned into longitude and latitude. Working
  in 3D makes the curve independent of where the 180th meridian and the poles fall, and the same in the
  globe, the flat view and every projection. A segment whose two ends are more than 90° apart is drawn
  as the great circle instead, since the spline is not well defined near opposite points. Samples:
  `clamp(ceil(angle / 1°), 8, 64)` per segment.
- The samples are then passed through the existing `densify`, which adds great-circle steps of at most
  3° and keeps longitudes continuous; `spans` is computed after this, so its indices point into the
  final `line`.
- Straight features go through the same function (it returns today's `densify` result), so there is
  one way to get a feature's line.

**Accepted limits.** The sample counts depend on the map's space only, never on the zoom, so the same
feature always has the same line and the same length. The price is that at a deep zoom a curve shows
as short straight pieces: on a flat map a piece is up to 1/8 of a short segment's chord, or 1/64 of a
long one's; on a globe up to 1°. And a curved feature with a segment longer than 90° has a corner where
that segment, drawn as a great circle, meets its neighbours. Both are accepted: such zooms and such
segments are rare on hand-drawn maps, and the author can add a point to smooth either.

**Who uses it:**

| User | How |
| --- | --- |
| Overlay (screen and saved picture) | `lines()` in `overlay.ts` draws `outline().line` instead of `densify(points)`, computed for each shape at each draw |
| Hit-testing and hover | `shapeAt` works on the screen lines the overlay drew, which are now the outline; on a globe, zones are found as §7 says |
| Zone fill | the globe's d3 fill, `zoneOnPlate` and the projections' `view.rings` take the closed outline instead of the control points |
| Length | the Edit feature tab shows a path's length, `measure(space, outline().line)` |
| "+" handles and the rubber band | §7 and §5 |
| Discovery (server) | unchanged: it tests the first shape's control points, in longitude and latitude as stored (`apps/server/src/ai/discover.ts`) |

**No cache.** The outline is computed for every shape at every draw. At the sample counts above a map of
a few hundred features costs well under a millisecond a draw; a cache is added only if a measured
frame shows the need, keyed by the feature's points and its curve flag together.

**`zoneOnPlate`** changes from `zoneOnPlate(points, centre)`, which closed and densified the control
points itself, to `zoneOnPlate(ring: Position[], centre: number): Position[][]`, which takes the closed
outline (`outline(space, points, { curve, closed: true }).line`) as it is. Its two callers change with
it: `overlay.ts` (the globe laid flat) and `view.ts` line 94, whose `rings(points)` becomes
`rings(ring)` and turns the outline (`ring.map(frame.turn)`) before passing it on; turning keeps great
circles great circles, so the steps of at most 3° survive.

### 7. "+" handles and zone drag (13c)

- **"+" handles** appear only on the selected path or zone, while editing with Select: one at the middle
  of each segment of the shape on screen (for a zone, the closing segment too). The middle is taken on
  the line as drawn: for a curved feature, the outline's point halfway along the segment's run between
  its two `spans` indices; for a straight one, the great-circle midpoint on a sphere or the average on a
  flat map. Clicking one inserts a control point at exactly that position and picks it; since the new
  point lies on the line already drawn, a plain click leaves the line where it was (the bends either
  side of it may shift by a pixel or two, since a Catmull-Rom curve's direction at a point depends on
  its neighbours). Pressing and dragging inserts it and drags it, one undo step.
- **When a "+" is shown.** Not on the far side of a globe. Not when its segment is too short on screen
  for the handle to sit clear of the corners at its ends: under 24 px with a mouse, and under
  2 × 18 + 14 = 50 px with touch (two corner reaches plus the 14 px handle), decided by the pointer kind
  of the last press. Pick order (§1) puts corners first, so a corner is never hidden by a "+".
- **Zone drag:** `pick` answers "inside the selected zone" when the press is inside the selected zone
  and not on a corner or "+" (corners and "+" come first, so CUJ 16 of stage 6, which drags a corner,
  behaves as before). Only the selected zone can be dragged; a press inside any other zone pans. Over
  the selected zone, panning stays available: by two fingers on touch (a pinch pans by its midpoint's
  movement from 13c), by the middle mouse button or by holding Space while dragging on desktop, and by
  dragging anywhere outside the zone.
- **How a zone moves.** Every point of the shape on screen moves from the shape as it was at the press,
  not step by step, so it does not drift:
  - on a **flat map**, by the difference between the press position and the pointer's, in map units;
  - on a **sphere**, by a turn about the polar axis by the change in longitude (taken between −180° and
    180°) plus the change in latitude added to each point's latitude. The zone stays upright (north
    stays up) wherever it goes, and crossing the 180th meridian is a plain turn. The latitude change is
    limited so that no point goes past a pole: the zone stops at the pole instead of folding over it.
    In the flat view and projections the positions come from `unproject`, so the same move applies.
    When the pointer leaves the globe the zone stays where it last was. A zone moved north or south
    keeps its spread in degrees, so its true size changes with latitude, as a shape traced on a world
    map would; Alternative H weighs the rigid turn instead.

  `packages/geo/src/move.ts` holds `moveBy(space, points, from, to): Position[]` for both.

- **Zones on a globe are found by what is filled.** The globe fills a zone with d3 (`fillOnGlobe`),
  which cuts it cleanly at the edge of the disc; the screen runs the overlay draws for its edge are cut
  differently, so testing a press against them can disagree with the fill. On a globe, a zone's inside
  is therefore tested with d3 `geoContains` on the unprojected press, against the same oriented ring the
  fill uses (`zonePolygon(ring)` in `packages/geo/src/zone.ts`, shared by both). `Shape`'s zone variant
  in `hit.ts` gains an optional `inside(p)` that `shapeAt` uses when present; the overlay gives it for
  globe zones. The flat view and projections keep testing their screen rings, which are what they fill.
- **The shape on screen:** every edit goes through `writeShape(feature, onScreen.shape, …)`, as corner
  drags do today, so at a year where a later shape is in force the later shape changes and the first
  stays. The curve switch is the one edit that applies to the whole feature (§6), and its control says
  so ("All of this feature's shapes").

### 8. The fields and the image dialog (13c)

- **Entry:** the Edit feature tab's Entry field becomes stage 12b's entry combobox
  (`apps/web/src/components/EntryCombobox.tsx`, props `{ labelledBy, value: path | null, onChange(path |
  null, title), allowNone?: boolean }`, over the names search `api.names(query)`), with `allowNone` so
  it can be set to "No entry". It shows the linked entry and can be changed to another, in one undo
  step; the link travels with the save as today (`link` in the queue record). Until the server
  confirms a new link, the tab shows the title chosen in the combobox (the pending title), as today.
- **"Map of this place"** and **"This map lies under"** become map comboboxes over the same list of
  other maps, with "None" first; the second keeps its accessible name "This map lies under". It keeps
  today's rule that a map cannot lie under one that lies under it (`lies()`).
- **Map images:** the new-map form on the Maps page and "Add an image…" in the Layers tab open
  `ImagePicker` (stage 12b) with one new prop, `forMap`, which makes it single-choice and leaves out the
  marker icon folder (`GET /api/gallery` already marks those images `icon: true`). Upload, paste and web
  address work there as in the editor; the new-map form's own file input is removed. `GET
  /api/map-images` and `api.mapImages` (used today by `Maps.tsx` line 29 and `MapPanels.tsx` line 423)
  are removed.

### 9. Styles (13d)

**The file:** `.frontier/map-styles.json`, a library item file like `.frontier/folders.json`.

**One pipeline for library item files.** Release 11c builds the folder file's store, routes and queue
sender. This stage asks that they be built once, configured by a small table, so that the styles file
is a second entry in it rather than a copy:

```ts
// packages/schema/src/libraryFiles.ts
export interface LibraryFileKind<F> {
  name: "folders" | "map-styles"; // the queue key and the route's :name
  path: string; // ".frontier/folders.json", ".frontier/map-styles.json"
  label: string; // "Folders", "Map styles": the file's name in lists
  schema: z.ZodType<F>;
  list: string; // the list of items: "folders", "styles"
  key: (item: unknown) => string; // path for folders, id for styles
  conflict: ConflictReason; // "folders_changed_on_both", "map_styles_changed_on_both"
  empty: () => F; // what a missing file reads as
}
export const LIBRARY_FILES: LibraryFileKind<unknown>[];
export function libraryFileOf(path: string): LibraryFileKind<unknown> | undefined;
export function parseLibraryFile<F>(kind: LibraryFileKind<F>, text: string): ParsedLibraryFile<F>;
export function serialiseLibraryFile<F>(kind: LibraryFileKind<F>, file: F): string; // one item per line
export function mergeLibraryFile<F>(kind: LibraryFileKind<F>, base: F, mine: F, theirs: F): {
  file: F;
  clashes: string[];
}; // through mergeItemLists with kind.key
```

What each part does with it:

| Part | Folder file (11c) and styles file (13d), the same code |
| --- | --- |
| Server store (`apps/server/src/library/files.ts`, `LibraryFileStore`) | loads the draft, then the library copy, then `empty()`; saves as a draft with `revision`, `baseBlob` and `op` through `saveFrom`/`serverChange`, as maps do; `resolve(name, keep)` |
| Routes (`apps/server/src/routes/libraryFiles.ts`) | `GET /api/library-files/:name` → `{ file, revision, blob }`; `PUT /api/library-files/:name` `{ file, revision, baseBlob, op }`; `POST /api/library-files/:name/resolve` `{ keep: "mine" \| "theirs" }` |
| Server wiring | `app.ts` (around line 237, beside `new MapStore`) makes one `LibraryFileStore` for `LIBRARY_FILES`; `Services` (line 94) gains `libraryFiles` |
| Publishing | `publish.ts`'s `FILE_KINDS` (line 628) gains one entry per library file: `mine` is the path, `conflict` the kind's, `merge` through `mergeLibraryFile`, `entryIds` returns none (the files name no entries) |
| Save queue | the key is the kind's `name`; the sender saves and, on `stale_revision`, loads the server's copy and merges with `mergeLibraryFile` from the stored base, as for maps (stage 11, §1) |
| Unpublished page | the draft is listed by the kind's `label`, with Discard and no "Keep editing" link; a held-back clash shows the reason text, "Keep my styles" (or "Keep my folders") and "Take the vault's", and no "Resolve" link |
| Web API (`api.ts`) | `libraryFile(name)`, `saveLibraryFile(name, file, revision, sent)`, `resolveLibraryFile(name, keep)` |

The save queue's changes, in `apps/web/src/sync/`:

- `db.ts` line 11: `QueueKey` gains `"map-styles"`.
- `queue.ts` `kindOf`: today its default is `"folders"`, so any new key would be taken for the folder
  file. It gets an explicit case for each library file name, returning `"library"`, and its default
  becomes an error.
- `nameOf`: the kind's `label` ("Map styles") instead of the `"folders"` special case.
- `SenderApi` gains `saveLibraryFile` and `libraryFile`; the tests' fake gives them.
- `call()`: its `default` case, which today refuses the folder file, becomes the `library` case.
- `merge()`: a third branch, for `library`, through `mergeLibraryFile`; the notice names clashing styles
  by name, as `clashNames` does for map items.

**When a clash is held back.** `map_styles_changed_on_both` occurs at "Save a version" when the
library's copy of the styles file changed after this draft was based on it (another device saved a
version, or the file was changed in GitHub) and the same style was changed in both. Saves from devices
never reach this: the queue merges those (above). The Unpublished page lists it under "Held back" with
"The map styles were changed here and in the vault in the same places. Keep one of the two." and the
buttons "Keep my styles" and "Take the vault's", which call `resolveLibraryFile`. The folder file gets
the same, with its own words, if 11c has not already given it them.

**The fields**, in `packages/schema/src/mapStyles.ts`:

```ts
export const DASHES = { solid: [], dashed: [4, 3], long: [7, 3], "dash-dot": [5, 2, 1, 2] } as const;
export const MapStyle = z
  .object({
    id: z.string().regex(/^[a-z0-9]{8}$/), // made with makeId, as map items
    name: z.string().trim().min(1).max(60),
    for: z.enum(["path", "zone"]),
    color: z.string().regex(/^#[0-9a-f]{6}$/).nullable(), // null: the layer's colour
    width: z.number().min(0.5).max(12).multipleOf(0.5), // px
    dash: z.enum(["solid", "dashed", "long", "dash-dot"]),
    fill: z.number().min(0).max(0.8).optional(), // zones only
  })
  .passthrough()
  .refine((s) => s.for === "zone" || s.fill === undefined, "Only a zone style has a fill");
export const MapStylesFile = z
  .object({ version: z.literal(1), styles: z.array(MapStyle).max(200) })
  .passthrough();
export const MAP_STYLES: LibraryFileKind<MapStylesFile>; // its entry in LIBRARY_FILES
export const STARTER_STYLES: MapStyle[]; // River, Road, Border; Realm, Forest, Water, Marsh
```

```json
{ "version": 1, "styles": [
  { "id": "k3v9x2pa", "name": "River", "for": "path", "color": "#2f6f9f", "width": 3, "dash": "solid" },
  { "id": "q8m1z0tr", "name": "Border", "for": "path", "color": null, "width": 2, "dash": "dash-dot" },
  { "id": "a7d2w5ne", "name": "Realm", "for": "zone", "color": null, "width": 1.5, "dash": "solid", "fill": 0.2 }
] }
```

A name is unique among the styles for the same `for`: the editor refuses a duplicate; a merge that
makes one shows both. `for` cannot change once the style exists. The server checks every field with
these schemas; a missing file reads as an empty one.

**On a feature:** an optional `style` (a style id) on paths and zones:
`style: z.string().regex(/^[a-z0-9]{8}$/).optional()` in `maps.ts`'s path and zone shapes, and
`"style"` in `ITEM_KEYS.features` after `"icon"`.

**What is drawn**, in this order of precedence. A feature's style counts only if it exists and its
`for` matches the feature's kind; otherwise the feature is drawn as if it had none.

| Property | Taken from |
| --- | --- |
| colour | its style's `color`, else its layer's colour |
| width, dash, fill | its style, else today's look (path 2.5 px solid; zone edge 1.5 px solid, fill 0.2) |
| shown at all | the layer's visibility, then time (stage 6) |
| strength | time's opacity (perhaps, and the faint look under Show everything); styles have no opacity of their own |
| "undated" | the line drawn in its style, then a second, narrower stroke on top in the paper colour, dotted (half the width, at least 1 px; dots 1 × width long, 2 × width apart), so the line looks perforated. Dotted is not one of the styles' patterns, so it is never mistaken for one. Today's undated dash (7, 5) changes to this |

**How lines are drawn.**

- **Dashes scale with width:** a style's pattern (`DASHES`, in units of the line's width) is multiplied
  by the width, so a wide border keeps the same rhythm as a thin one.
- **Butt caps for dashes.** Today every line has round caps, which fill the gaps of a short dash; a
  dashed line is drawn with butt caps, and solid lines keep round caps and joins.
- **Casing:** every path keeps its paper casing under the line, whatever its colour, `width + 3` px
  wide (for today's 2.5 px path, 5.5 px instead of 5), so a line reads on any image; this is why a style
  needs no contrast check against the page. A zone's edge has no casing, as today.
- The hover halo and the selection outline take their widths from the style's (§3).

A style has one colour for both themes because the features are drawn over the map's own image, which
is the same in both, and the saved picture must look like the screen.

**A deleted style:** a feature whose `style` names no style in the file is drawn as if it had none
(its layer's colour, today's look), and its tab shows "Style: deleted" with the choice of another. The
id stays in the map file, so restoring the style brings the look back without touching any map.

**The Styles tab** (a right-side-bar panel on the map screen, in editing): path styles, then zone
styles, each row a sample, the name, and a "⋯" with Edit, Rename and Delete; "Add a path style", "Add a
zone style", and, while the file is empty, "Add the usual styles" (`STARTER_STYLES`), which the author
can then change. The form: name; colour (eight named swatches, "The layer's colour", and a custom
colour, as layers have); width (a slider); dash (four samples); fill (zones). Each change is put into
the queue at once, so the open map shows it.

- **Delete** happens at once, with a toast "Deleted the style River" and Undo, which puts the style
  back as it was. There is no count of the features that use it and no question first: nothing on any
  map changes, and features fall back as above.
- **Undoing style edits.** The tab has no undo of its own. A change is taken back by changing it again,
  a delete by the toast's Undo, and everything since the last version by Discard on the styles draft in
  the unpublished list. Ctrl+Z while the focus is in the tab does nothing beyond a text field's own
  undo (§4); the map's undo history holds only map changes.

**On the feature:** the Edit feature tab gains "Path style" or "Zone style": a combobox of that kind's
styles, "None" first, and "Edit styles…" opening the Styles tab.

**The legend:** a "Legend" section at the top of the Layers tab, in viewing and editing: each style used
by a feature drawn now (layers shown, present at the year shown), with a sample drawn by the same canvas
code as the overlay, and its name. A style without a colour shows "in its layer's colour". Saved
pictures have no legend (Decisions).

**Loading:** the web app loads the file once and shares it among map pages through `useMapStyles()`,
which subscribes to the queue key `map-styles`, so a merged copy from the sender reaches every open map.

**Precedence with the layer, restated for the brief:** the layer still decides what is shown together
and in what order; its colour is the fallback. A style says what kind of thing a feature is.

### 10. Phone (13b to 13d)

- The right side bar is the bottom sheet of 11b; the map's tabs (Layers, Selected or Edit feature,
  Styles) open in it, and `useSheetFloor` keeps it above the tool bar, as today.
- A tap selects; there is no hover, tooltip on the map or floating preview (the Selected tab shows the
  entry's opening, as today). A long press held still is a tap; one that moves is a pan or a drag. No
  menu opens.
- Pinch zooms in every state except `box`, as today; from 13c two fingers also pan. Zone drag, corners
  and "+" handles work by touch on the selected feature. The Straight / Curved switch and "Finish path"
  are in the hint, above the tools.
- MO-4 (an empty band under the globe) is checked in the 13b phone screenshots; if it remains, the
  first view fits the frame's height.

### 11. Review items

| Item | Where |
| --- | --- |
| MP-1 hover | 13b (§2) |
| MP-2 selection and docked panel | 13b (§3); the docked panel came with 11b |
| MP-3 finishing a path | 13c (§5) |
| MP-4 marker tool stays on | 13c (§5) |
| MP-5 labelled header controls | 13b: three "Save a picture" items in "⋯"; the View select keeps its label (Non-Goals) |
| MP-6 layer panel | 13b: rows with icons, tooltips and a row "⋯"; 13c: "Drawing into" |
| MP-7 canvas moves when editing starts | 13b: on desktop the tool strip lies over the top of the canvas, so the frame keeps its size |
| MO-1 phone header | done in 11a-1 |
| MO-4 empty band | checked in 13b (§10) |
| IC-2, IC-3 | 13b |
| DI-2 map keys | 13b and 13c (§4) |
| AX-3 features list | not in this stage (Non-Goals) |

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The move changes behaviour by accident | 13a-1 moves code only; every map browser test (maps, mapstime, mapviews, the map tests in export and ai) passes with no change to its spec file before 13a-1 merges |
| The new state machine breaks a gesture no test covers | 13a-2 first adds browser tests for pinch, a second finger during the focus box, a touch corner drag, the tap thresholds, a second finger during a drag or pan, and one finger left after a pinch, and they pass on 13a-1's code before the machine replaces it; `gesture.test.ts` covers every row of the state table |
| Hover redraws make the map slow | Hit-testing once per frame; the halo and the rubber band on their own canvas; the overlay redraws only when the map, view or selection changes |
| Computing every outline at every draw is slow | Measured on the largest sample map in 13c; a cache keyed by points and curve flag together is added only if a frame shows the need (§6) |
| A curve loops or bulges at a sharp corner | Centripetal Catmull-Rom has no cusps or loops within a segment; the author can switch the feature back to Straight; unit tests for sharp turns, repeated points and closed loops |
| Curves on a globe go wrong near the poles or the 180th meridian | Computed on unit vectors in 3D, not in longitude and latitude; segments over 90° fall back to great circles; tests at a pole, across 180°, and for two points 179° apart |
| A curve looks faceted at a deep zoom | Accepted (§6): the samples do not depend on the zoom, so the line and its length are the same everywhere |
| Discovery disagrees with the drawn line of a curved zone | Accepted: discovery tests the first shape's control points, in longitude and latitude, as today; a place in a curve's bulge, near ±180° or a pole, or inside a later shape may not count as inside the zone. It only chooses which entries the AI reads |
| An older build opens a map with curves or styles | `.passthrough()` keeps the unknown fields when it saves; it draws such features straight, in the layer's colour. Nothing is lost |
| A map edited on two devices: one changes a style while the other uses it | Styles and maps are separate item files, each merged by item; a feature naming a missing style falls back (§9) |
| 11c builds the folder file's pipeline for that file alone | 13d depends on 11c. Stage 11's plan (items 77, 78 and 81) describes it for the folder file; if it ships that way, 13d's first item turns it into the table-driven pipeline of §9, with the folder tests unchanged, before adding the styles entry |
| A new queue key is taken for the folder file | `kindOf`'s default becomes an error, and `queue.test.ts` checks each key's kind |
| Zone drag catches a press meant as a pan | Only on the selected zone, only in editing, only inside it; two fingers, the middle button, Space+drag and dragging outside it pan |
| A zone dragged north or south changes its true size | Accepted, so it stays upright (§7; Alternative H) |
| The "+" handles crowd a dense zone, or sit under a finger beside a corner | Hidden on segments shorter than 24 px (mouse) or 50 px (touch); corners come first in `pick` |
| The map's single-letter keys fire while typing | The registry ignores plain keys in typing fields; arrows, Enter, Delete, Backspace and Space act only when the map frame or nothing has the focus |
| A context menu on touch fights panning | The trigger is disabled after a touch press, so Radix starts no long-press timer |
| The undated look changes from dashes to dots | Words in the Selected tab ("Undated: …", stage 6) are unchanged; the mapstime test reads those, not pixels |
| The bundle grows | No new package; the curve is about 80 lines. The map page is loaded lazily from 13a-1, so the main entry chunk stays within stage 11's limit and the map chunk's growth is measured on its own |

## Alternatives Considered

### Alternative A: Add the features to `MapPage.tsx` as it is

- **Pros**: No release without visible change.
- **Cons**: Hover, menus, the rubber band, handles and zone drag each add branches to the same three
  pointer functions and more state to a 1,664-line component.
- **Reason for Rejection**: The brief asked for the split first; one state machine is also the only
  practical way to test gestures without a browser.

### Alternative B: Bézier curves with stored handles

- **Pros**: Exact control of each bend, as in drawing programs.
- **Cons**: Two extra points per control point in the file, handles to show and drag on a globe, and a
  file that no longer reads as "the points the line passes through".
- **Reason for Rejection**: A flag plus control points (the brief) gives smooth rivers with the handles
  the author already knows; a sharper bend is made by adding a point.

### Alternative C: A "View | Edit" pair of buttons

- **Pros**: Both modes always visible.
- **Cons**: Done is what stage 11 put on the phone's top line; it also sends the changes at once.
- **Reason for Rejection**: Edit / Done stays one button; viewing is everything the map does when not
  being edited, and the bar's tooltip names both.

### Alternative D: Styles per map, in each map file, or width and dash on layers

- **Pros**: No new file; styles travel with the map; layers already exist.
- **Cons**: The same river style defined again on every map, and changed on each; layers mix "what
  group" with "what look".
- **Reason for Rejection**: The author chose library-wide styles for paths and zones (Decisions), and a
  library file reuses the folder file's pipeline.

### Alternative E: A colour per theme with a contrast check

- **Pros**: Follows the rule stage 11 used for folder colours.
- **Cons**: The map's image does not change with the theme, so contrast with the page means nothing;
  a picture saved in dark mode would differ from one saved in light.
- **Reason for Rejection**: One colour per style, with the paper casing for legibility (§9).

### Alternative F: A long-press menu on touch

- **Pros**: The same menu everywhere.
- **Cons**: A long press is the start of a pan or a drag on the map; the menu would open under the
  finger in the middle of moving.
- **Reason for Rejection**: Every action has a touch home (§4), one tap away.

### Alternative G: Curves computed in screen space

- **Pros**: Simple, and smooth on screen at any zoom.
- **Cons**: The line would change with the view: the length and the saved picture would each see a
  different line.
- **Reason for Rejection**: The curve is in the map's space, the same everywhere (§6).

### Alternative H: Move a zone on a sphere by the shortest-arc turn

- **Pros**: The turn about the axis `a × b` that carries the press position to the pointer keeps the
  zone's shape and true size exactly, anywhere on the globe.
- **Cons**: It tilts the zone: dragged far east or west at a high latitude, a kingdom comes out leaning,
  its north no longer up, and dragged back it does not return to how it was. It is undefined when the
  press and the pointer are opposite points, and nearly so near them.
- **Reason for Rejection**: Authors drag borders east and west far more than over a pole, and expect
  them upright; a turn about the poles plus a change of latitude does that (§7), at the cost of a size
  change north and south.

### Alternative I: The spline in longitude and latitude, or across long segments

- **Pros**: Simpler: the flat map's code would serve the globe.
- **Cons**: In longitude and latitude a curve bends differently near the poles and breaks at the 180th
  meridian, and differs between the globe and its projections. A spline across a segment of 90° or
  more on the sphere swings wide or is undefined between opposite points.
- **Reason for Rejection**: The spline runs on unit vectors in 3D, and segments over 90° are great
  circles, with the corner that leaves accepted (§6).

---

## Detailed Implementation Plan

Five releases, in order. Each must pass the Verification Plan before it is merged and deployed.
13a-1, 13a-2 and 13b may start before stage 12b is deployed, except 13b's side-bar panel parts (item 27),
which wait for 12b so that the two stages do not change the same panel and menu code at once. 13c needs
12b (`ImagePicker`, `EntryCombobox`, context-menu submenus). 13d needs 11c (the library item file
pipeline).

### Release 13a-1: moving the code

1. `apps/web/src/App.tsx` (Modify): `MapPage` through `React.lazy` and `Suspense`, the fallback today's
   "Opening the map…".
2. `apps/web/src/map/useMapFile.ts`, `useMapView.ts`, `useMapTime.ts`, `useMapDraw.ts`,
   `useDiscovery.ts`, `useMapKeys.ts`, `usePointer.ts` (Create): the hooks of §1, moved from
   `MapPage.tsx` with their logic unchanged; `usePointer` holds today's three pointer handlers as they
   are.
3. `apps/web/src/map/tools.ts` (Create): `placeMarker`, `addSketchPoint`, `finishSketch`, `tapSelect`,
   `dragShape`, moved from `MapPage.tsx` 602–698 and 799–820. `apps/web/src/map/tools.test.ts`
   (Create): each, including a revolving marker dropped at a year.
4. `apps/web/src/map/layersBeneath.ts`, `savePicture.ts`, `askSize.ts`, `lengthText.ts` (Create): moved
   as the table in §1 says. `apps/web/src/map/layersBeneath.test.ts` (Create): `lies` with a loop.
5. `apps/web/src/components/map/MapBar.tsx`, `MapTools.tsx`, `MapHints.tsx`, `MapZoom.tsx`,
   `DiscoveryPins.tsx`, `MapSetup.tsx`, `FeaturePanel.tsx` (Create): the markup, with today's class
   names and words.
6. `apps/web/src/components/map/FeatureCard.tsx`, `FeatureEditor.tsx`, `LayerPanel.tsx` (Create), moved
   from `apps/web/src/components/MapPanels.tsx` (Delete). `apps/web/src/components/EntryPicker.tsx`
   (Create): `EntryPicker`, moved unchanged. `apps/web/src/components/chronicle/SpanForm.tsx` (Modify):
   imports it from there.
7. `apps/web/src/pages/MapPage.tsx` (Rewrite): composes the above.
8. `apps/web/src/map/overlay.ts` (Modify): `styles` renamed `presence`; its callers in `useMapDraw` and
   `savePicture` pass it under the new name. (`picture.ts` passes the overlay input through and does
   not change.)
9. No e2e change: `git diff --stat apps/web/e2e` is empty for the release.

### Release 13a-2: the pointer state machine

10. `apps/web/e2e/mapgestures.spec.ts` (Create), merged first and passing on 13a-1's code. Touch
    gestures use Chromium's `Input.dispatchTouchEvent` through a CDP session, since Playwright's own
    touch has one finger:
    - phone (`test.skip(info.project.name !== "phone", "Needs touch")`): a pinch zooms (the `v=` scale
      grows); a second finger during the focus box cancels it and focusing stays on; a touch drag of a
      corner of the selected zone moves it, and one Undo puts it back; a touch moved 9 px taps (the
      feature is selected), 11 px pans; a second finger during a corner drag becomes a pinch and the
      drag so far is one undo step; a second finger during a pan becomes a pinch; one finger left after
      a pinch pans and does not tap;
    - desktop (`test.skip(info.project.name !== "desktop", "Needs a mouse")`): a mouse moved 5 px taps,
      7 px pans; a right-button or middle-button press and drag neither pans nor selects.
11. `apps/web/src/map/gesture.ts` (Create): the states and `step()` of §1; `pick` order.
    `apps/web/src/map/gesture.test.ts` (Create): every row of the state table, with mouse, touch and pen;
    the thresholds; a drag as one `beginStep`; the focus box and its 12 px minimum; `pointercancel`
    never taps; a still press of any length is a tap; only the primary mouse button.
12. `apps/web/src/map/usePointer.ts` (Rewrite): binds the machine to `.map-top` and carries out its
    effects.
13. `playwright.config.ts` (Modify): the desktop project's `testMatch` gains `mapgestures`.

### Release 13b: viewing

14. `apps/web/src/map/gesture.ts` (Modify): `hover` and `cursor` effects in `idle` for mouse moves; the
    context-menu target; the picked point in `ctx`. `gesture.test.ts` (Modify): no hover from touch or
    pen; the cursor for each target.
15. `apps/web/src/map/live.ts` (Create): draws `.map-live`: the hover halo.
16. `apps/web/src/map/overlay.ts` (Modify): the selection look (§3) with `--map-select`, sized from the
    feature's width; globe corners found with `project`.
17. `apps/web/src/components/HoverPreview.tsx` (Modify): exports `usePreviewText` and `PreviewCard`;
    its own behaviour unchanged.
18. `apps/web/src/components/map/MapHover.tsx` + `.css` (Create): tooltip and floating preview, the card
    replacing the tooltip; `pointer-events: none`.
19. `apps/web/src/components/ui/ContextMenu.tsx` (Modify): `disabled` on the trigger, `open` and
    `onOpenChange` on the root, `disabledReason` on `ContextMenuItem` (§4).
    `apps/web/src/components/map/MapContextMenu.tsx` (Create): the table in §4 for 13b's items.
20. `apps/web/src/keys.ts` (Modify): `parse` accepts a bare "-" and "Mod--"; the 13b rows of §4, with
    `map.panFar`; `map.stopFocus` removed in favour of `map.cancel`. `apps/web/src/keys.test.ts`
    (Modify): "-" and "Mod--" parse; no map key uses Alt; arrows pass on when a control has the focus.
21. `apps/web/src/map/useMapKeys.ts` (Modify): the bindings with the viewing and editing columns of §4;
    the Esc cascade in its order; Delete as §4 says.
22. `apps/web/src/map/tools.ts` (Modify): `removePoint` (refused at the minimum, with the reason) and
    `deleteFeature`. `tools.test.ts` (Modify): the minimum on a later shape.
23. `apps/web/src/components/map/MapBar.tsx` (Modify): "Save a picture at screen size", "Save a picture
    at twice the size" and "Save a picture at four times the size" as three plain items in "⋯" while
    viewing, and "Copy a link to this view"; Time, Explore, Layers and Turn as `IconButton`s with labels
    and keys. `MapZoom.tsx` (Modify): `IconButton`s. `MapTools.tsx` (Modify): keys in tooltips; on
    desktop the strip lies over the canvas (MP-7).
24. `apps/web/src/map/useMapView.ts` (Modify): `placeLink(feature)` (the `f=` address without `v`, with
    `t` and `c` when time is on); the first view centres on the shape in force at `t`.
25. `apps/web/src/pages/MapPage.tsx` (Modify): `.map-live`; the frame's `tabIndex`, focused on a press;
    the menu around `.map-top`; the hover.
26. `apps/web/src/styles.css` (Modify): `--map-select` (light and dark), cursors, `.map-live` with
    `pointer-events: none`.
27. After 12b is deployed: `apps/web/src/components/map/LayerPanel.tsx` (Modify): `IconButton`s for
    place, up and down; delete in a row "⋯" (IC-2). `FeatureEditor.tsx` (Modify): icon choices at 24 px
    with tooltips and a clear picked state (IC-3); "Remove this point" always shown for a picked point,
    disabled at the minimum. `FeatureCard.tsx` (Modify): "Copy a link to this place", "Edit this
    feature".
28. E2E:
    - `apps/web/e2e/export.spec.ts` (Modify): "saves a picture of a map at twice the size of the screen"
      chooses "Save a picture at twice the size" from "More actions".
    - `apps/web/e2e/maps.spec.ts` (Modify): "adds a second image, places it by its extent, hides it and
      takes it off" takes the image off through the row's "⋯".
    - `apps/web/e2e/mapsread.spec.ts` (Create): on desktop (`test.skip(info.project.name !== "desktop",
      …)`), CUJ 1 (cursor, tooltip text, preview text, menu items), Shift+right-click opens no menu of
      ours, every map control has a tooltip, keys V, M, P, Z, R, Delete (a picked point, then the
      feature), Ctrl+Z, "-", Esc in its order, "?" listing them, and in viewing M and Delete doing
      nothing; on the phone (`test.skip(info.project.name !== "phone", …)`), CUJ 7's tap and still long
      press.
    - `playwright.config.ts` (Modify): the desktop project's `testMatch` gains `mapsread`.

### Release 13c: editing tools

29. `packages/geo/src/curve.ts` (Create): `outline()` of §6. `packages/geo/src/move.ts` (Create):
    `moveBy()` of §7. `packages/geo/src/hit.ts` (Modify): `vertexAt` generalised to `handleAt(handles,
    p, reach)`, kept as a wrapper; the zone `Shape` gains an optional `inside(p)`.
    `packages/geo/src/zone.ts` (Modify): `zoneOnPlate(ring, centre)` takes the closed outline;
    `zonePolygon(ring)`. `packages/geo/src/view.ts` (Modify): `rings(ring)` takes the closed outline
    (line 94). `packages/geo/src/index.ts` (Modify).
30. `packages/geo/test/curve.test.ts`, `packages/geo/test/move.test.ts` (Create): the line passes every
    control point; straight input gives today's `densify`; `spans` has one entry per stored segment and
    points into the densified line, with repeated points; one and two distinct points; the same samples
    at any zoom; a pole, the 180th meridian, points 179° apart, a segment over 90°; a closed loop; the
    length of a curve is above its chord; a "+" midpoint lies on the line; a sphere move by longitude
    keeps the area (d3 `geoArea`) and stays upright; a move toward a pole stops at it; across 180° the
    longitudes stay continuous; a flat move is a translation. `packages/geo/test/geo.test.ts` (Modify):
    `zoneOnPlate` with an outline; `zonePolygon`'s orientation.
31. `packages/schema/src/maps.ts` (Modify): `curve: z.literal("smooth").optional()` on paths and zones;
    `"curve"` in `ITEM_KEYS.features` after `"points"`. `packages/schema/test/maps.test.ts` (Modify): a
    map without the field serialises to the same bytes; `curve` survives a merge.
32. `apps/web/src/map/overlay.ts` (Modify): `outline()` for every path and zone at each draw, "+"
    handles, globe zones given `inside` through `geoContains`. `apps/web/src/map/live.ts` (Modify): the
    rubber band.
33. `apps/web/src/map/gesture.ts` (Modify): `pick` adds "+" handles (reach by pointer kind) and the
    inside of the selected zone; drag targets `insert` and `zone`; the middle button and Space+drag pan;
    a pinch pans by its midpoint. `gesture.test.ts` (Modify).
34. `apps/web/src/map/tools.ts` (Modify): the marker tool stays on; `insertPoint`, `moveZone`,
    `setCurve`, `takeBackPoint`, each through `writeShape` on the shape on screen. `tools.test.ts`
    (Modify): at a year where a later shape is in force, each edit changes that shape only; a double
    click finishes through the last-point rule.
35. `apps/web/src/map/curveSetting.ts` (Create): `useCurveSetting()`, the only reader and writer of
    `frontier:map-curve`.
36. `apps/web/src/components/map/MapHints.tsx` (Modify): the words of §5, the curve switch, "Finish
    path" and "Finish zone".
37. `apps/web/src/keys.ts` (Modify): `map.finish`, `map.curve`. `apps/web/src/map/useMapKeys.ts`
    (Modify): those, and Delete taking back the last point while drawing.
38. `apps/web/src/components/map/FeatureEditor.tsx` (Modify): the Entry field is `EntryCombobox` with
    `allowNone`; "Map of this place" combobox; Straight / Curved; the path's length.
    `apps/web/src/components/map/FeaturePanel.tsx` (Modify): the Edit feature tab for a marker selected
    under the Marker tool. `apps/web/src/pages/MapPage.tsx` (Modify): `showsFeature` (line 947 today)
    is also true under the Marker tool, so the new marker's tab opens while the tool stays on.
    `apps/web/src/components/map/MapSetup.tsx` (Modify): "This map lies under" combobox.
    `apps/web/src/components/map/LayerPanel.tsx` (Modify): "Add an image…" opens `ImagePicker`;
    "Drawing into"; `api.mapImages` no longer used.
39. `apps/web/src/components/images/ImagePicker.tsx` (Modify): the `forMap` prop.
    `apps/web/src/pages/Maps.tsx` (Modify): "Choose an image…" opens it; the file input and
    `api.mapImages` go.
40. `apps/server/src/routes/maps.ts` (Modify): `/api/map-images` removed. `apps/web/src/api.ts`
    (Modify): `mapImages` removed. (`apps/server/test/maps.test.ts` has no test of it.)
41. E2E helpers: `apps/web/e2e/helpers.ts` (Modify): `newMapInForm(page, title, space)`, with
    `space` one of `"flat"`, `"sphere"` or `"schematic"`, through the form and the image dialog;
    `pickEntry(scope, name)` through the entry combobox. (The name is not `makeMap`, which
    `mapviews.spec.ts` keeps for its own maps made through the API.)
42. E2E (Modify):
    - `maps.spec.ts`: its own `makeMap` gives way to `newMapInForm`; "CUJ 7: places a marker for an
      entry…" links through `pickEntry`; "draws a path and a zone, hides a layer, and undoes" finishes
      with "Finish path"; "brings one of two markers on the same spot above the other" presses Select
      (V) before tapping, since the marker tool stays on; "a zone around a pole…" finishes with "Finish
      zone"; "adds a second image…" adds it through the image dialog. "CUJ 5" and "CUJ 10" do not
      change.
    - `mapstime.spec.ts`, "CUJ 16: a fort appears and goes…": the new-map form through the helper, the
      hint's new words on desktop, "Finish zone", `pickEntry` (line 166).
    - `mapviews.spec.ts`: "CUJ 18: steps down to a layer…" sets "This map lies under" (line 48) through
      the combobox; "CUJ 19: a world on a schematic map revolves…" makes its map with
      `newMapInForm(page, …, "schematic")` (lines 146–152). "CUJ 17" does not change.
    - `ai.spec.ts`, "CUJ 13: explores a map…": the new-map form through the helper, and the entry
      through `pickEntry` instead of `.entry-picker` (line 316).
    - `chronicle.spec.ts` does not change: the span form keeps `EntryPicker` and `.entry-picker`.
43. `apps/web/e2e/mapsedit.spec.ts` (Create): on desktop, CUJ 2 (rubber band seen by a screenshot
    difference while the mouse moves; Backspace; double-click; the stored `curve`; a "+" click leaves
    the line in place; "+" drag; Ctrl+Z), CUJ 3 (pan on an unselected zone; drag of the later shape;
    first shape unchanged; Space+drag pans), CUJ 4 and CUJ 6; on the phone, CUJ 7's zone drag,
    two-finger pan and "+". `playwright.config.ts` (Modify): the desktop project's `testMatch` gains
    `mapsedit`.

### Release 13d: styles

44. If 11c shipped the folder file's store, routes and sender for that file alone: make them the
    table-driven pipeline of §9, with no change to the folder file's behaviour or tests.
    `packages/schema/src/libraryFiles.ts` (Create or Modify), `apps/server/src/library/files.ts`,
    `apps/server/src/routes/libraryFiles.ts` (Create or Modify).
45. `packages/schema/src/mapStyles.ts` (Create): the schemas and constants of §9, and `MAP_STYLES` added
    to `LIBRARY_FILES`. `packages/schema/src/index.ts` (Modify). `packages/schema/test/mapStyles.test.ts`
    (Create): parse, one style per line, merge of two edits to different styles, field limits, a fill
    on a path style refused.
46. `packages/schema/src/maps.ts` (Modify): `style` on paths and zones, in `ITEM_KEYS.features` after
    `"icon"`. `packages/schema/src/api.ts` (Modify): `ConflictReason` gains `map_styles_changed_on_both`.
47. `apps/server/src/app.ts` (Modify): the store made for `LIBRARY_FILES` (beside line 237); `Services`
    gains `libraryFiles` (line 94), if 11c has not.
48. `apps/server/src/publish/publish.ts` (Modify): a `FILE_KINDS` entry (line 628) for each library
    file. `apps/server/test/libraryFiles.test.ts` (Create or Modify): a missing styles file reads as
    empty; a stale save; field checks; the 200 cap; resolve. `apps/server/test/publish.test.ts`
    (Modify): two devices' edits to different styles merge on publish; the same style changed in the
    library and in the draft is held back with `map_styles_changed_on_both`, then settled by "Keep
    mine" and by "Take the vault's".
49. `apps/web/src/sync/db.ts` (Modify): `QueueKey` gains `"map-styles"`. `apps/web/src/sync/queue.ts`
    (Modify): `kindOf`, `nameOf`, `SenderApi`, `call()` and `merge()` as §9 lists.
    `apps/web/src/sync/queue.test.ts` (Modify): each key's kind; a stale styles save merges.
50. `apps/web/src/api.ts` (Modify): `libraryFile`, `saveLibraryFile`, `resolveLibraryFile`.
    `apps/web/src/pages/Unpublished.tsx` (Modify): `REASON` gains `map_styles_changed_on_both`; library
    files get "Keep my styles" (or "Keep my folders") and "Take the vault's", no "Resolve" link, and no
    "Keep editing" link in the drafts list (lines 221–225).
51. `apps/web/src/map/mapStyles.ts` (Create): `useMapStyles()` and `paintOf(feature, layer, styles)`,
    the precedence table of §9. `apps/web/src/map/mapStyles.test.ts` (Create): each row of the table; a
    deleted style; a style whose `for` does not match; dashes scaled by width; undated over a dashed
    style.
52. `apps/web/src/map/overlay.ts` (Modify): draws with `paintOf`; dashes with butt caps; the casing at
    `width + 3`; undated as the second dotted stroke; `drawSample()` for the tab and legend.
53. `apps/web/src/components/map/StylesPanel.tsx` + `.css`, `StyleForm.tsx`, `StyleSample.tsx`,
    `Legend.tsx` (Create): the tab, with delete and the toast's Undo. `FeatureEditor.tsx` (Modify): the
    style combobox and "Style: deleted". `LayerPanel.tsx` (Modify): the Legend at its top.
    `MapContextMenu.tsx` (Modify): "Path style ▸", "Zone style ▸".
54. `apps/web/src/pages/MapPage.tsx` (Modify): the Styles tab through `usePanel` while editing.
55. `apps/web/vitest.config.ts` (Modify): coverage with thresholds for the new pure modules (Verification
    Plan). `packages/schema/vitest.config.ts` (Modify): a threshold for `src/mapStyles.ts`.
56. `apps/web/e2e/mapstyles.spec.ts` (Create): on desktop, CUJ 5 on two maps; the deleted-style
    fallback and Undo; the legend; two browser contexts editing different styles merge.
    `playwright.config.ts` (Modify): the desktop project's `testMatch` gains `mapstyles`.

### Verification Plan

- `npm run typecheck && npm run lint && npm run format && npm test && npm run build && npm run e2e`,
  in the `phone` and `desktop` projects. The phone project runs every spec; the desktop project runs
  those in its `testMatch`, which gains one spec per release as listed. A test that needs one of the
  two skips the other by `info.project.name`.
- 13a-1: the map specs (`maps.spec.ts`, `mapstime.spec.ts`, `mapviews.spec.ts`) and the map tests in
  `export.spec.ts` and `ai.spec.ts` pass with no change to any spec file (`git diff --stat
  apps/web/e2e` is empty for the release).
- 13a-2: `mapgestures.spec.ts` passes on 13a-1's code before item 11 merges, and on the machine after.
- Coverage: `packages/geo` keeps its 85% branch coverage; vault, time and server keep theirs. The web
  app gains coverage thresholds of 90% branches for `src/map/gesture.ts`, `src/map/tools.ts` and
  `src/map/mapStyles.ts`; schema gains 90% branches for `src/mapStyles.ts`.
- Bundle (Vite's build output, gzipped): the main entry chunk stays at or below 586.32 kB (stage 11's
  limit: 506.32 kB plus 80 KB). The map page's chunk, separate from 13a-1, is measured after 13a-1 and
  after each later release, and grows by no more than 25 KB over the stage.
- Screens at desktop and phone size after 13b and 13c: a hovered marker with its preview, a selected
  path with handles and "+", a path being drawn with its rubber band, the Styles tab, the legend. The
  review items in Technical Plan §11 are no longer visible in them.
- By hand on a real iPhone: tap selects; a still long press selects and opens no menu; a zone drag, a
  two-finger pan over the selected zone and a "+" by finger.

## Open questions

None. The two earlier questions (a legend in saved pictures; the path and zone tools after finishing)
are decided in the Decisions table.
