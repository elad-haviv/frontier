# Stage 13: maps

- **Author:** Elad Haviv
- **Status:** Draft for review
- **Date:** 2026-11-23
- **Parent:** [Stage 11](stage-11-foundations-shell-tree.md), which provides the shared pieces this stage
  uses: icons, tooltips, menus, the combobox, the keys registry, the save queue and the right side bar
  (the bottom sheet on a phone). [Stage 12](stage-12-entries-editor.md) provides the image dialog
  (`ImagePicker`), the entry combobox and context-menu submenus. Earlier map stages:
  [4](stage-4-maps.md), [6](stage-6-maps-in-time.md), [7](stage-7-more-map-views.md). Comes from
  [`concepts_brief.md`](../../concepts_brief.md) (stages 11 to 15) and the author's list of 2026-11-22
  in [`BACKLOG.md`](../BACKLOG.md). Review IDs (MP-1 and so on) are from
  [the UX review](../../ux-review/expert-review.md).

---

## Overview

Frontier is a single-author web app for writing the world of Avalymia as a library of Markdown entries,
with maps drawn over the author's own images. Terms from
[Stage 11, Terms](stage-11-foundations-shell-tree.md#terms) apply; this stage adds:

- **Shape on screen.** A path or zone may have later shapes, each in force from a span of a chronicle
  (stage 6). The shape on screen is the one in force at the year shown, or the one pinned for editing.
- **Control point.** A point stored in a path or zone. A straight feature runs from one to the next;
  a curved feature passes through them.
- **Outline.** The line actually drawn for a path or zone: its control points joined by great circles
  on a globe or straight lines on a flat map, or by the curve when the feature is curved.
- **Style.** A named look for paths or for zones (river, road, border, realm), kept once for the whole
  library. The word "kind" is already the field that says marker, path or zone.

Stage 13 ships in four releases, in order:

- **13a, the split.** `MapPage.tsx` (1,664 lines) is cut into modules: one interaction state machine for
  pointers, one module per tool, hooks for the map file, the view, time and drawing, and small
  components for the bar, tools and hints. Nothing changes on screen; every map test passes unchanged.
- **13b, viewing.** Hover shows what is under the pointer (cursor, halo, name, a floating entry
  preview), selection is clearly marked, a right-click menu acts on what was clicked, the map tools get
  keys, and every map control has a tooltip.
- **13c, editing tools.** A line from the last point to the cursor while drawing, straight or curved
  paths and zones, a "+" in the middle of each segment of the selected feature, dragging a whole zone,
  comboboxes for the entry, "Map of this place" and "Lies under", and the image dialog for map images.
- **13d, styles.** Path and zone styles kept once for the library, an editor for them in the side bar,
  and a legend.

The collapsible right side bar the author asked for is 11b's: the map declares its tabs through
`usePanel`, and the bar shows whichever is open. Layers (with the Legend from 13d) is always there;
Selected (viewing) or Edit feature (editing) is there while a feature is selected and opens when one is
chosen; Styles (13d) is there while editing. The bar folds away like any other, and L shows or hides
Layers.

## The Problem

- **The map gives no sign of what is under the pointer.** The cursor stays `grab` over a marker; paths
  and zones do not highlight; a marker without a label shows no name (MP-1). The selected marker looks
  like the others (MP-2).
- **`MapPage.tsx` is one component with about 64 pieces of state.** Pointer handling (`onPointerDown`
  to `onPointerUp`, lines 700–851) mixes panning, pinching, dragging markers and corners, the focus
  box and tool taps in one set of refs and flags. Hover, menus, a rubber band, midpoint handles and zone
  dragging would each add more branches to the same functions.
- **Drawing is hard to learn and to finish.** The hint says "Tap to add points." on a desktop; a path
  ends only by clicking its last point again or pressing a "Done" that sits beside the other "Done";
  nothing shows where the next segment will go (MP-3). The marker tool turns itself off after each
  marker (MP-4).
- **Shapes cannot be adjusted easily.** A point can be added only by drawing the feature again; a zone
  can only be moved corner by corner; every line is straight, which suits borders but not rivers or
  coasts.
- **All paths look the same, and all zones.** Colour comes only from the layer; there is no width,
  dash, fill or label per kind of path, so a road and a river in one layer cannot be told apart.
- **The pickers are plain lists.** The entry field is a search box with six results; "A map of this
  place" and "Lies under" are `<select>`s of every map; a map's image is chosen from a `<select>` of
  every image path, or a bare file input.
- **Few names and no keys.** The zoom buttons (`+`, `−`, `⤢`) and the layer and image rows (`⌖ ↑ ↓ ✕`)
  have no tooltips (IC-2); the icon picker is nearly invisible (IC-3); "Picture" is a select that means
  "Save a picture" (MP-5); there is no Delete, no Ctrl+Z and no tool key (DI-2).

## Goals

- **G1.** 13a splits the map page into the modules listed in Technical Plan §1 with one pointer state
  machine, covered by unit tests, with no change in behaviour: every existing map browser test passes
  without a change.
- **G2.** While viewing, on a device with a mouse, pointing at a feature changes the cursor to a hand,
  draws a hover halo, and shows its name in a tooltip; after a short pause a feature linked to an entry
  shows a floating preview of that entry, made by the same code as link previews in the reader. (MP-1)
- **G3.** The selected feature has one clear look in every view: an accent ring around a marker, an
  accent halo along a path, an accent outline around a zone, and its handles while editing. (MP-2)
- **G4.** Right-clicking the map on desktop opens a menu for what is under the pointer (a feature, a
  point of the selected feature, or an empty place), in viewing and in editing. Shift+right-click gives
  the browser's menu. Touch has no long-press menu; the same actions are in the side-bar panels.
- **G5.** The map scope of the keys registry holds a key for each map tool and action named in
  Technical Plan §4, shown in tooltips and in the "?" sheet. (DI-2)
- **G6.** Every map control has a name in a tooltip with its key: the bar, the tools, the zoom
  buttons, the layer and image rows (whose delete moves into a row "⋯"), and the marker icons.
  "Picture" becomes "Save a picture" in the map's "⋯" menu. (IC-2, IC-3, MP-5)
- **G7.** While drawing a path, zone or measured line with a mouse, a line runs from the last point to
  the cursor (and, for a zone, back to the first point). Drawing ends with a double-click, Enter, the
  hint's "Finish path" or "Finish zone" button, or a click on the last point; Esc cancels; Backspace
  takes back the last point. The marker tool stays on after a marker is placed. (MP-3, MP-4)
- **G8.** A path or zone is straight or curved, chosen while drawing and changeable later. The curve is
  computed by one function in `packages/geo`, so the overlay, hit-testing, the fill, the globe, the
  saved picture, the length shown and the server's discovery all use the same line.
- **G9.** On the selected path or zone, while editing, a "+" at the middle of each segment adds a point
  there, by a click or by dragging it out.
- **G10.** While editing, pressing inside the selected zone and dragging moves the whole zone. Pressing
  inside a zone that is not selected still pans.
- **G11.** Every shape edit (a corner, a "+", a zone drag, removing a point) changes the shape on
  screen, whichever of the feature's shapes that is.
- **G12.** The entry field is the shared entry combobox and can be changed in the side bar; "Map of
  this place" and "Lies under" are map comboboxes; the image of a new map and an added map image are
  chosen in the image dialog of stage 12.
- **G13.** Path styles and zone styles are kept once for the library, in `.frontier/map-styles.json`,
  saved through the save queue and versioned. Each has a name, a colour (or the layer's), a width, a
  dash pattern, a label placement and, for zones, a fill. A feature uses at most one. A legend lists the
  styles in use on the map.
- **G14.** On a phone, the right side bar is the bottom sheet of 11b; a tap selects; pinch zooms; zone
  drag, "+" handles and the curve switch work by touch.
- **G15.** No regressions. The map file stays at version 1 and every new field is optional; the
  browser tests cover each journey below.

## Non-Goals

- **Text set along a path.** A path's label sits at its middle, level. Lettering that follows a river's
  bends is a separate piece of work for the canvas and the saved picture.
- **Dragging a whole path.** A thin line is hard to press on without catching a point or a "+"; a path
  is moved point by point.
- **Styles for markers.** Markers already have icons from the marker sets; the author asked for kinds of
  paths and zones.
- **A list of the map's features** for keyboard users (AX-3). Not on the author's list; it stays in the
  backlog. Keys act on the feature selected with the pointer.
- **Moving the Turn panel and the discovery card into the side bar.** They are small cards tied to the
  view and to one place on the map, and stay where stages 7 and 8 put them.
- **A segmented "Globe | Flat | Projection" switch** (MP-5, first half). The View select keeps its
  label and gains a tooltip; it holds eight choices, which a segmented control cannot fit on a phone.
- **Snapping, splitting a path, or joining two paths.**

## Decisions

| Decision | Date | Source |
| --- | --- | --- |
| Path and zone kinds are library-wide styles, not per map and not on layers | 2026-11-22 | author's list; brief, "Alternatives Weighed" |
| The new field is `style`, user-facing "path style" and "zone style"; "kind" stays marker, path or zone | 2026-11-22 | brief, "What all seven agreed on", 6 |
| Split `MapPage.tsx` before adding behaviour (13a) | 2026-11-22 | brief, "Further risks" |
| Curves are a flag plus control points; the outline is computed in `packages/geo` | 2026-11-22 | brief, "Further risks" |
| Zone drag only once selected; "+" handles only on the selected feature; edits act on the shape on screen | 2026-11-22 | brief, "Further risks" |
| The map file stays at version 1 with optional fields | 2026-11-22 | brief, "Further risks" |
| Colour: the feature's own colour, else the style's, else the layer's | 2026-11-23 | this design (§9) |
| A style has one colour, not one per theme, and no contrast check | 2026-11-23 | this design: features are drawn over the author's image, which does not change with the theme, and a saved picture must match the screen (§9) |
| The curve is a centripetal Catmull-Rom spline through the control points, on the unit sphere for globes | 2026-11-23 | this design (§6) |
| No long-press menu on the map; touch uses the side-bar panels | 2026-11-23 | this design: a long press on the map is the start of a pan, as stage 12 decided for text |
| Edit / Done stays one button; viewing is the map's mode whenever it is not being edited | 2026-11-23 | this design (Alternative C) |

## Critical User Journeys (CUJs)

### CUJ 1: Read a map by pointing

- **Covers:** G2, G3, G4.
- **Given**: on desktop, the globe of Avalymia with a marker for Greywater Harbor linked to its entry,
  and a river with the label "Saltwash".
- **When**: he moves the pointer onto the marker and waits; then onto the river; then clicks the
  river; then right-clicks the marker.
- **Then**: over the marker the cursor became a hand, a halo appeared, a tooltip read "Greywater
  Harbor", and after a moment a card showed the entry's opening lines. Over the river the line was
  haloed and the tooltip read "Saltwash"; it has no entry, so no card. The click gave the river an
  accent halo and opened the Selected tab. The right-click menu offered "Open the entry", "Open the map
  of this place" (disabled, with its reason), "Copy a link to this place" and "Edit this feature".

### CUJ 2: Draw a curved river and refine it

- **Covers:** G7, G8, G9, G5.
- **Given**: the same globe, in editing.
- **When**: he presses P, turns on "Curved" in the hint, clicks five points while a line follows the
  cursor from the last one, presses Backspace once, clicks again and double-clicks to finish. Then he
  drags the "+" between the second and third points outward, and presses Ctrl+Z.
- **Then**: the line to the cursor followed the curve the next click would make. The river was saved
  with five points and `curve: "smooth"`, drawn as a smooth line through them, and selected with its
  handles and four "+" signs. Dragging the "+" added a sixth point where it was dropped; Ctrl+Z took it
  away in one step.

### CUJ 3: Move a border at a later year

- **Covers:** G10, G11.
- **Given**: a zone tied to "The kingdom", with a later shape from "The treaty"; time on at year 310,
  where the later shape is in force.
- **When**: he presses inside the zone while it is not selected and drags; then clicks it, presses
  inside it and drags it east.
- **Then**: the first drag panned the map. The second moved the later shape as a whole; the first
  shape is unchanged in the file. One Ctrl+Z put it back.

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
  the River style and one border the Border style; then he deletes the River style.
- **Then**: after each step both maps showed the change. The Legend in the Layers tab listed River and
  Border with samples. Deleting River asked first ("4 features on 2 maps use River…"); after it the four
  rivers were drawn as before, in their layers' colours. `.frontier/map-styles.json` and both map files
  are unpublished changes, saved together with the next version.

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
- **When**: he taps a marker; long-presses the map; drags inside the selected zone; taps a "+".
- **Then**: the tap selected the marker and opened its tab in the bottom sheet; the long press began a
  pan and opened no menu; the drag moved the zone; the "+" added a point.

## Technical Plan (Architecture)

### 1. The split (13a)

Today one component holds loading and saving, the view and its address, time, drawing, the pointer
gestures, every tool and the page's markup. 13a moves each into its own module. Nothing else changes in
13a: the same markup, class names, words, timings and thresholds.

```text
 pages/MapPage.tsx           composes the hooks and components below (target: under 350 lines)
 map/useMapFile.ts           loading, the queue subscription, change / setFeature / undo / redo /
                             reloadMap, the undo stamps, pending entry links
 map/useMapView.ts           view state, frame size, wheel zoom, the first view, the address
 map/useMapTime.ts           chronicles, year, pin, show-all, `resolve()` results
 map/useMapDraw.ts           the WebGL renderer and the overlay, icons, titleOf
 map/gesture.ts              the pointer state machine: pure, no React, no DOM
 map/tools.ts                each tool as pure functions of (map, input) -> change
 map/usePointer.ts           binds the machine to the canvas and carries out its effects
 components/map/             MapBar, MapTools, MapHints, MapZoom, DiscoveryPins, MapSetup,
                             FeatureCard, FeatureEditor, LayerPanel, FeaturePanel
```

**The state machine** (`gesture.ts`). One function, `step(state, event, ctx) → { state, effects }`,
where `ctx` gives what the machine may look at (mode, tool, selection, and a `pick(at)` that answers
what lies under a screen point) and `effects` is a list the hook carries out (`pan`, `zoom`, `tap`,
`beginStep`, `dragTo`, `box`, `focus`). States:

| State | Entered on | Left on |
| --- | --- | --- |
| `idle` | start, every release | press |
| `press` | a press: remembers where, by which pointer kind, and what `pick` found there | moving past 6 px (mouse) or 10 px (touch) → `pan` or `drag`; release → `tap` effect, `idle`; a second finger → `pinch` |
| `pan` | a press on nothing draggable that moved | release |
| `pinch` | a second finger | both fingers up |
| `drag` | a press on a draggable target that moved: emits `beginStep` once, then `dragTo` | release |
| `box` | a press while focusing on a region (stage 7) | release: `focus` if the box is at least 12 px each way |

The thresholds and the order of the checks are today's (`MapPage.tsx` 700–851), written down in
`gesture.test.ts`. `pick` is the only place that decides what a press is on, in this order: a handle of
the selected feature (13a: a corner; 13c adds "+" handles), the selected marker (within 24 px), the
selected zone's inside (13c), any feature (by `shapeAt`), nothing. 13b and 13c add states and targets
to this one function instead of new branches in the page.

**Tools** (`tools.ts`): `placeMarker`, `addSketchPoint`, `finishSketch`, `tapSelect` as functions that
return the next map and selection; the page applies them through `useMapFile().change`. 13a only moves
today's logic, including the return to Select after a marker.

**Panels** move with the components: `MapPanels.tsx` is split into `components/map/FeatureCard.tsx`,
`FeatureEditor.tsx` and `LayerPanel.tsx`. `overlay.ts`'s `styles` option (the time look: opacity and
dashes) is renamed `presence`, so that 13d's styles do not share its name.

### 2. Hover (13b)

- **Who gets it:** pointers that can hover (`(hover: hover) and (pointer: fine)`, as `HoverPreview`
  checks), in viewing and in editing. A touch screen has no hover; a tap selects.
- **Finding:** on pointer move in `idle`, once per animation frame, `pick` is asked what is under the
  pointer. This is the same hit-test a click uses (`shapeAt` over the screen shapes the overlay last
  drew), so what lights up is what a click selects, in the globe, the flat view of a globe, every
  projection and on flat maps, including repeats of a globe laid flat and the far side of the ball
  (whose shapes are never drawn, so never found).
- **Cursor:** set on the canvas element directly, not through React state: `pointer` over a feature,
  `grab` over nothing, `grabbing` while panning, `crosshair` with a drawing tool; in editing, `move`
  over the selected marker or inside the selected zone, and `copy` over a "+".
- **Halo:** drawn on a third canvas above the overlay (`.map-live`), which also carries 13c's rubber
  band. Hovering redraws only that canvas, so moving the pointer never redraws every feature.
- **Tooltip:** the feature's name (`titleOf`), or "Unnamed path" and so on, placed at the marker or at
  the point where the pointer met the path or zone, shown at once and kept until the hover changes.
  While editing, over a corner it reads "Drag to move · Delete to remove"; over a "+", "Add a point".
- **Floating preview:** in viewing only, after 350 ms over a feature linked to an entry, a card with
  the entry's name and opening, beside the tooltip and kept inside the frame. `HoverPreview.tsx` is
  split into its parts: `usePreviewText(path)` (the shared cache and `api.preview`) and `PreviewCard`
  (the name and the cleaned text). The reader's link preview keeps using them unchanged; the map's
  `MapHover` uses them with a point instead of a link's box. A feature with a map of its place adds a
  line "Map of this place: Port quarter". The preview closes on a press, a wheel, a pan or leaving the
  frame.

### 3. Selection and viewing (13b)

- **Viewing** is the map whenever Edit has not been pressed: nothing can be changed by a slip, a click
  selects and opens the Selected tab (the `FeatureCard`), hover shows previews. Editing shows names
  only on hover, so the previews do not cover the shapes being worked on.
- **The selection look** uses one colour, `--map-select` (defined in `styles.css` for light and dark,
  read once per draw): a marker gets a paper ring and an accent ring outside it; a path gets an accent
  casing under its line; a zone gets an accent outline 3 px wide over its own. Hover uses the same
  look at half strength. Saved pictures draw no selection, as today.
- **The Selected tab** gains "Copy a link to this place" (the map's address with `f=<feature id>`, which
  already centres on a feature and selects it) and "Edit this feature" (enters editing with it
  selected). Its "Close" stays.

### 4. Context menu and keys (13b, 13c)

**The context menu** wraps the map frame in `ContextMenu` (stage 11, with stage 12b's submenus). Its
target is found by `pick` at the `contextmenu` event's point, before the menu opens. The trigger is
disabled after a touch press, so touch never opens it; Shift+right-click is left to the browser.

| Under the pointer | Viewing | Editing |
| --- | --- | --- |
| a feature | Open the entry · Open the map of this place · Copy a link to this place · Edit this feature | Edit in the side bar · Straight / Curved (13c) · Path style ▸ / Zone style ▸ (13d) · Move to layer ▸ · Bring forward · Send back · Delete |
| a corner of the selected feature | — | Remove this point |
| a "+" of the selected feature | — | Add a point here |
| nothing | Copy a link to this view · Explore here (when discovery is on) | Add a marker here · Start a path here · Start a zone here |

Items that cannot be used are shown disabled with their reason, as in stage 11. Each item is also
reachable without a right-click: in the Selected and Edit feature tabs, the tools, or the "⋯" menu.

**Keys** (scope `map`). Plain letters are not taken in a typing field (the registry's rule). Keys that
a focused control also uses (arrows, Enter, Delete, Backspace) act only when the focus is on the map
frame (which becomes focusable, `tabIndex=0`) or on nothing; otherwise the action returns `false` and
the control keeps the key. No key uses Alt, so AltGr on European keyboards cannot trigger one; none is
a key the browser keeps (Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Shift+W, Ctrl+plus and Ctrl+minus are left alone).

| Id | Keys | Label | Release |
| --- | --- | --- | --- |
| `map.edit` | `e` | Edit the map | 13b |
| `map.done` | `Mod-Enter` | Done editing | 13b |
| `map.select` | `v` | Select tool | 13b |
| `map.marker` | `m` | Marker tool | 13b |
| `map.path` | `p` | Path tool | 13b |
| `map.zone` | `z` | Zone tool | 13b |
| `map.measure` | `r` | Measure tool | 13b |
| `map.undo` | `Mod-z` | Undo | 13b |
| `map.redo` | `Shift-Mod-z`, `Mod-y` | Redo | 13b |
| `map.delete` | `Delete`, `Backspace` | Delete the selection; while drawing, take back the last point | 13b (the "last point" part in 13c) |
| `map.cancel` | `Escape` | Stop: the focus box, then the drawing, then the picked point, then the selection | 13b (replaces `map.stopFocus`) |
| `map.zoomIn` | `=`, `+` | Zoom in | 13b |
| `map.zoomOut` | `-` | Zoom out | 13b |
| `map.fit` | `0` | Show the whole map | 13b |
| `map.pan` | `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` (Shift for a larger step) | Move the map | 13b |
| `map.layers` | `l` | Show or hide the Layers tab | 13b |
| `map.time` | `t` | Turn time on or off | 13b |
| `map.finish` | `Enter` | Finish the path or zone | 13c |
| `map.curve` | `c` | Straight or curved, while drawing or for the selected feature | 13c |

`map.turn` (Enter in the Turn panel) stays a label-only entry. Each tool button's and zoom button's
tooltip shows its key from the registry.

### 5. Drawing: the line to the cursor and finishing (13c)

- **The rubber band**, while a path, zone or measured line is being drawn and the pointer can hover: on
  `.map-live`, the outline of the sketch's points plus the pointer's position, drawn with the same
  function as a finished feature, so on a globe it follows the great circle and with "Curved" it shows
  the curve the next click will make. For a zone a fainter line closes back to the first point. When
  the pointer is off the globe (`unproject` gives nothing) no band is drawn.
- **Finishing:** a double-click (its second click adds no point: a click whose `detail` is 2 finishes),
  Enter, the hint's "Finish path" or "Finish zone" button, or a click within 16 px of the last point, as
  today. A path needs two points and a zone three; until then the button is disabled with that reason.
- **The hint** reads, where the pointer can hover: "Click to add points · Double-click or Enter to
  finish · Esc to cancel"; on touch: "Tap to add points. Tap the last point again to finish." Both carry
  the Straight / Curved switch (remembered on the device under `frontier:map-curve`) and the finish
  button. The measure hint keeps its words and has no curve switch: measuring is along straight lines.
- **After a marker** the Marker tool stays on, and the new marker is selected with its Edit feature tab
  open, so it can be linked while the next one waits (MP-4). Esc or V returns to Select. After a path
  or zone the tool returns to Select, because the next step is usually adjusting the shape just drawn
  (Open question 2).
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
segment); a zone is a closed loop. Points that repeat are dropped first.

**Where it is computed:** `packages/geo/src/curve.ts`:

- `outline(space, points, { curve, closed }) → { line: Position[]; spans: number[] }` returns the line
  to draw and the index in it where each segment starts (for "+" handles).
- On a **flat map** the spline is computed in the map's own units (image pixels), with
  `clamp(ceil(chord / 8), 8, 64)` samples per segment.
- On a **sphere** each control point is turned into a unit vector in 3D; the spline is computed on those
  vectors, and each sample is scaled back onto the sphere and turned into longitude and latitude. Working
  in 3D makes the curve independent of where the 180th meridian and the poles fall, and the same in the
  globe, the flat view and every projection. A segment whose two ends are more than 90° apart is drawn
  as the great circle instead, since the spline is not well defined near opposite points. Samples:
  `clamp(ceil(angle / 1°), 8, 64)` per segment. The result is then passed through the existing
  `densify`, which adds great-circle steps of at most 3° and keeps longitudes continuous.
- Straight features go through the same function (it returns today's `densify` result), so there is
  one way to get a feature's line.

The sample counts depend on the map's space only, never on the zoom, so the same feature always has the
same line and the same length.

**Who uses it:**

| User | How |
| --- | --- |
| Overlay (screen and saved picture) | `lines()` in `overlay.ts` draws `outline().line` instead of `densify(points)` |
| Hit-testing and hover | unchanged code: `shapeAt` works on the screen lines the overlay drew, which are now the outline |
| Zone fill | `zoneOnPlate`, the globe's d3 fill and the projections' `view.rings` take the closed outline instead of the control points |
| Length | the Edit feature tab shows a path's length, `measure(space, outline().line)` |
| Discovery (server) | "which zones a place lies in" (`apps/server/src/ai/discover.ts`) tests the closed outline; the server gains `@frontier/geo` as a dependency |
| "+" handles and the rubber band | §7 and §5 |

The web app keeps the outline of each shape in a `WeakMap` keyed by its points array, which
`resolve()` passes on unchanged, so a frame draws without recomputing curves that did not change.

### 7. "+" handles and zone drag (13c)

- **"+" handles** appear only on the selected path or zone, while editing with Select: one at the middle
  of each segment of the shape on screen (for a zone, the closing segment too). For a curved feature the
  middle is the outline's sample halfway between the segment's two `spans` indices; for a straight one,
  the great-circle midpoint on a sphere or the average on a flat map. A handle is left out when its
  segment is shorter than 24 px on screen or lies on the far side of the globe. Clicking one inserts a
  point there and picks it; pressing and dragging inserts it and drags it, one undo step. Touch uses
  the same handles with the 22 px reach that corners have.
- **Zone drag:** `pick` answers "inside the selected zone" when the press is inside one of that zone's
  screen shapes and not on a corner or "+" (corners and "+" come first, so CUJ 16 of stage 6, which
  drags a corner, behaves as before). The drag moves every point of the shape on screen from the shape
  as it was at the press, not step by step, so it does not drift:
  - on a **flat map**, by the difference between the press position and the pointer's, in map units;
  - on a **sphere**, by the rotation that carries the press position to the pointer's position (about
    the axis `a × b` of their unit vectors), so the zone keeps its shape and size anywhere on the globe,
    including across the 180th meridian and near a pole. In the flat view and projections the positions
    come from `unproject`, so the same rotation applies. When the pointer leaves the globe the zone stays
    where it last was.
  `packages/geo/src/move.ts` holds `moveBy(space, points, from, to)` for both.
- **The shape on screen:** every edit goes through `writeShape(feature, onScreen.shape, …)`, as corner
  drags do today, so at a year where a later shape is in force the later shape changes and the first
  stays. The curve switch is the one edit that applies to the whole feature (§6), and its control says
  so ("All of this feature's shapes").

### 8. The fields and the image dialog (13c)

- **Entry:** the Edit feature tab's Entry field becomes the entry combobox of stage 12
  (`apps/web/src/components/ui/EntryCombobox.tsx`: the stage 11 `Combobox` given its options by
  `api.names(query)`; 13c makes it if 12b has not). It shows the linked entry and can be changed to
  another, or set to "No entry", in one undo step; the link travels with the save as today (`link` in
  the queue record). The pending title is shown until the server confirms, as today.
- **`Combobox`** gains a searching form: `onSearch(text)` supplies the options and the list does not
  filter them again (cmdk's `shouldFilter={false}`).
- **"Map of this place"** and **"Lies under"** become map comboboxes over the same list of other maps,
  with "None" first. "Lies under" keeps today's rule that a map cannot lie under one that lies under it.
- **Map images:** the new-map form on the Maps page and "Add an image…" in the Layers tab open
  `ImagePicker` (stage 12b) in a single-choice mode, which leaves out the marker icon folder. Upload,
  paste and web address work there as in the editor; the new-map form's own file input is removed.
  `GET /api/gallery` marks images in the marker icon folder (`icon: true`); `GET /api/map-images` and
  `api.mapImages` are removed.

### 9. Styles (13d)

**The file:** `.frontier/map-styles.json`, an item file like a map, saved through the save queue under
the key `map-styles`, merged item by item, kept as a draft and saved with "Save a version", so it is in
history and in the export.

```json
{ "version": 1, "styles": [
  { "id": "k3v9x2pa", "name": "River", "for": "path", "color": "#2f6f9f", "width": 3, "dash": "solid", "label": "middle" },
  { "id": "q8m1z0tr", "name": "Border", "for": "path", "color": null, "width": 2, "dash": "dash-dot", "label": "none" },
  { "id": "a7d2w5ne", "name": "Realm", "for": "zone", "color": null, "width": 1.5, "dash": "solid", "fill": 0.2, "label": "centre" }
] }
```

| Field | Values |
| --- | --- |
| `id` | 8 characters, made with `makeId`, as map items |
| `name` | 1–60 characters; unique among the styles for the same `for` (the editor refuses a duplicate; a merge that makes one shows both) |
| `for` | `path` or `zone`, fixed once a feature uses the style |
| `color` | `#rrggbb`, or `null` for "the layer's colour" |
| `width` | 0.5 to 12 px, in steps of 0.5 |
| `dash` | `solid`, `dashed` (8, 6), `long` (14, 6), `dash-dot` (10, 4, 2, 4) |
| `fill` | zones only: 0 to 0.8 |
| `label` | paths: `none` or `middle`; zones: `none` or `centre` |

The server checks every field, caps the file at 200 styles, and treats a missing file as an empty one.

**On a feature:** optional `style` (a style id) and `color` (`#rrggbb`) on paths and zones.

**What is drawn**, in this order of precedence:

| Property | Taken from |
| --- | --- |
| colour | the feature's `color`, else its style's `color`, else its layer's colour |
| width, dash, fill, label | its style, else today's look (path 2.5 px solid on a 5 px paper casing; zone 1.5 px outline, fill 0.2; no label) |
| shown at all | the layer's visibility, then time (stage 6) |
| strength | time's opacity (not yet, gone, perhaps) multiplies the style's |
| "undated" | drawn dotted (2, 5) over the style's own pattern; dotted is not one of the styles' patterns, so it is never mistaken for a style. Today's undated dash (7, 5) changes to this |

Every path keeps its paper casing, whatever its colour, so a line reads on any image; this is why a
style needs no contrast check against the page. A style has one colour for both themes because the
features are drawn over the map's own image, which is the same in both, and the saved picture must look
like the screen.

**Labels:** a path's label sits level at the point halfway along its outline on screen; a zone's at the
point of its largest screen ring farthest from the ring's edge (searched on an 8 × 8 grid over the
ring's box). Both join the markers' labels in the existing rule that a label is left out where it would
cover another, markers first. The label is the feature's `titleOf`.

**A deleted style:** a feature whose `style` names no style in the file is drawn as if it had none (its
own colour or the layer's, today's look), and its tab shows "Style: deleted" with the choice of
another. The id stays in the map file, so restoring the style (Undo in the Styles tab, Discard in the
unpublished list, or a merge from another device) brings the look back without touching any map.
Deleting a style that is in use asks first, with the count from the server ("4 features on 2 maps use
River. They will be drawn in their layers' colours.").

**The Styles tab** (a right-side-bar panel on the map screen, in editing): path styles, then zone
styles, each row a sample, the name, and a "⋯" with Edit, Rename and Delete; "Add a path style", "Add a
zone style", and, while the file is empty, "Add the usual styles" (River, Road, Border; Realm, Forest,
Water, Marsh), which the author can then change. The form: name; colour (eight named swatches, "The
layer's colour", and a custom colour, as layers have); width (a slider); dash (four samples); fill
(zones); label. Each change is saved at once, so the open map shows it; Undo in the tab takes back the
last change to the file.

**On the feature:** the Edit feature tab gains "Path style" or "Zone style" (a combobox of that kind's
styles, "None" first, and "Edit styles…" opening the Styles tab) and "Own colour" (off, or a colour).

**The legend:** a "Legend" section at the top of the Layers tab, in viewing and editing: each style used
by a feature drawn now (layers shown, present at the year shown), with a sample drawn by the same canvas
code as the overlay, and its name. A style without a colour shows "in its layer's colour".

**Loading:** `GET /api/map-styles` → `{ file, revision, blob, used }`, where `used` counts, per style id,
the features using it across every map (drafts first). `PUT /api/map-styles` takes `{ file, revision,
baseBlob, op }` and follows the first three rows of stage 11's §2 table, as maps do. The web app loads
the file once and shares it among map pages through `useMapStyles()`.

**Precedence with the layer, restated for the brief:** the layer still decides what is shown together
and in what order; its colour is the fallback. A style says what kind of thing a feature is; a
feature's own colour is the exception for one feature.

### 10. Phone (13b to 13d)

- The right side bar is the bottom sheet of 11b; the map's tabs (Layers, Selected or Edit feature,
  Styles) open in it, and `useSheetFloor` keeps it above the tool bar, as today.
- A tap selects; there is no hover, tooltip on the map or floating preview (the Selected tab shows the
  entry's opening, as today). A long press starts a pan and opens nothing.
- Pinch zooms in every state except `box`, as today. Zone drag, corners and "+" handles work by touch on
  the selected feature. The Straight / Curved switch and "Finish path" are in the hint, above the tools.
- MO-4 (an empty band under the globe) is checked in the 13b phone screenshots; if it remains, the
  first view fits the frame's height.

### 11. Review items

| Item | Where |
| --- | --- |
| MP-1 hover | 13b (§2) |
| MP-2 selection and docked panel | 13b (§3); the docked panel came with 11b |
| MP-3 finishing a path | 13c (§5) |
| MP-4 marker tool stays on | 13c (§5) |
| MP-5 labelled header controls | 13b: "Save a picture" moves to "⋯"; the View select keeps its label (Non-Goals) |
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
| The split changes behaviour by accident | 13a moves code only; the thresholds and checks are pinned in `gesture.test.ts` before the move; every map browser test (maps, mapstime, mapviews, the map tests in export and ai) passes without an edit before 13a merges |
| Hover redraws make the map slow | Hit-testing once per frame; the halo and the rubber band on their own canvas; the overlay redraws only when the map, view or selection changes |
| A curve loops or bulges at a sharp corner | Centripetal Catmull-Rom has no cusps or loops within a segment; the author can switch the feature back to Straight; unit tests for sharp turns, repeated points and closed loops |
| Curves on a globe go wrong near the poles or the 180th meridian | Computed on unit vectors in 3D, not in longitude and latitude; segments over 90° fall back to great circles; tests at a pole, across 180°, and for two points 179° apart |
| Places on screen, in measuring and in discovery disagree about a curved line | One `outline()` in `packages/geo` used by all of them (§6 table) |
| An older build opens a map with curves or styles | `.passthrough()` keeps the unknown fields when it saves; it draws such features straight, in the layer's colour. Nothing is lost |
| A map edited on two devices: one changes a style while the other uses it | Styles and maps are separate item files, each merged by item; a feature naming a missing style falls back (§9) |
| Zone drag catches a press meant as a pan | Only on the selected zone, only in editing, only inside it; everywhere else a drag pans, as today |
| The "+" handles crowd a dense zone | Hidden on segments shorter than 24 px on screen |
| The map's single-letter keys fire while typing | The registry ignores plain keys in typing fields; arrows, Enter, Delete and Backspace act only when the map frame or nothing has the focus |
| A context menu on touch fights panning | The trigger is disabled after a touch press |
| The undated look changes from dashes to dots | Words in the Selected tab ("Undated: …", stage 6) are unchanged; the mapstime test reads those, not pixels |
| The bundle grows | No new package; the curve is about 80 lines. First-load JS stays within stage 11's limit; the map page is its own chunk |

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

### Alternative D: Styles per map, or width and dash on layers

- **Pros**: Fewer files; layers already exist.
- **Cons**: The same river style defined again on every map; layers mix "what group" with "what look".
- **Reason for Rejection**: The author chose library-wide styles for paths and zones (Decisions).

### Alternative E: A colour per theme with a contrast check

- **Pros**: Follows the rule stage 11 used for folder colours.
- **Cons**: The map's image does not change with the theme, so contrast with the page means nothing;
  a picture saved in dark mode would differ from one saved in light.
- **Reason for Rejection**: One colour per style, with the paper casing for legibility (§9).

### Alternative F: A long-press menu on touch

- **Pros**: The same menu everywhere.
- **Cons**: A long press is the start of a pan or a drag on the map; the menu would open under the
  finger in the middle of moving.
- **Reason for Rejection**: Every action is in the Selected or Edit feature tab, which is one tap away.

### Alternative G: Curves computed in screen space

- **Pros**: Simple, and smooth on screen at any zoom.
- **Cons**: The line would change with the view: measuring, discovery and the saved picture would
  each see a different line.
- **Reason for Rejection**: The curve is in the map's space, the same everywhere (§6).

---

## Detailed Implementation Plan

Four releases, in order, after stage 12b is deployed (13c needs `ImagePicker`, the entry combobox and
context-menu submenus). Each must pass the Verification Plan before it is merged and deployed.

### Release 13a: the split

1. `apps/web/src/map/gesture.ts` (Create): the states and `step()` of §1; `pick` order.
   `apps/web/src/map/gesture.test.ts` (Create): a tap under 6 px (mouse) and 10 px (touch), a pan past
   them, pinch from a second finger, a drag of the selected marker and of a corner as one undo step, the
   focus box and its 12 px minimum, a second finger ending the box.
2. `apps/web/src/map/tools.ts` (Create): `placeMarker`, `addSketchPoint`, `finishSketch`, `tapSelect`,
   moved from `MapPage.tsx` 602–698. `apps/web/src/map/tools.test.ts` (Create).
3. `apps/web/src/map/useMapFile.ts`, `useMapView.ts`, `useMapTime.ts`, `useMapDraw.ts`, `usePointer.ts`
   (Create): the hooks of §1, moved from `MapPage.tsx`.
4. `apps/web/src/components/map/MapBar.tsx`, `MapTools.tsx`, `MapHints.tsx`, `MapZoom.tsx`,
   `DiscoveryPins.tsx`, `MapSetup.tsx`, `FeaturePanel.tsx` (Create): the markup, with today's class names.
5. `apps/web/src/components/map/FeatureCard.tsx`, `FeatureEditor.tsx`, `LayerPanel.tsx` (Create), moved
   from `apps/web/src/components/MapPanels.tsx` (Delete); `lengthText` to
   `apps/web/src/map/lengthText.ts` (Create).
6. `apps/web/src/pages/MapPage.tsx` (Rewrite): composes the above.
7. `apps/web/src/map/overlay.ts`, `apps/web/src/map/picture.ts` (Modify): `styles` renamed `presence`.
8. No e2e change.

### Release 13b: viewing

9. `apps/web/src/map/gesture.ts` (Modify): hover in `idle` for hovering pointers; the context-menu
   target; the cursor for each target. `gesture.test.ts` (Modify).
10. `apps/web/src/map/live.ts` (Create): draws `.map-live`: the hover halo.
11. `apps/web/src/map/overlay.ts` (Modify): the selection look (§3) with `--map-select`.
12. `apps/web/src/components/HoverPreview.tsx` (Modify): exports `usePreviewText` and `PreviewCard`;
    its own behaviour unchanged.
13. `apps/web/src/components/map/MapHover.tsx` + `.css` (Create): tooltip and floating preview.
14. `apps/web/src/components/map/MapContextMenu.tsx` (Create): the table in §4.
15. `apps/web/src/keys.ts` (Modify): the 13b rows of §4; `map.stopFocus` removed in favour of
    `map.cancel`. `apps/web/src/keys.test.ts` (Modify): no map key uses Alt; arrows pass on when a
    control has the focus.
16. `apps/web/src/components/map/MapBar.tsx` (Modify): "Save a picture ▸" in "⋯"; Time, Explore,
    Layers and Turn as `IconButton`s with labels and keys. `MapZoom.tsx` (Modify): `IconButton`s.
    `MapTools.tsx` (Modify): keys in tooltips; on desktop the strip lies over the canvas (MP-7).
17. `apps/web/src/components/map/LayerPanel.tsx` (Modify): `IconButton`s for place, up and down; delete
    in a row "⋯" (IC-2). `FeatureEditor.tsx` (Modify): icon choices at 24 px with tooltips and a clear
    picked state (IC-3). `FeatureCard.tsx` (Modify): "Copy a link to this place", "Edit this feature".
18. `apps/web/src/pages/MapPage.tsx` (Modify): `.map-live`, the frame's `tabIndex`, the menu, the hover.
19. `apps/web/src/styles.css` (Modify): `--map-select` (light and dark), cursors, `.map-live`.
20. E2E: `apps/web/e2e/export.spec.ts` (Modify): "saves a picture of a map at twice the size of the
    screen" chooses "Save a picture" › "Twice the size" from "More actions".
    `apps/web/e2e/maps.spec.ts` (Modify): "adds a second image, places it by its extent, hides it and
    takes it off" takes the image off through the row's "⋯". `apps/web/e2e/mapsread.spec.ts` (Create):
    CUJ 1 (desktop: cursor, tooltip text, preview text, menu items) and CUJ 7's tap and long press
    (phone); every map control has a tooltip; keys V, M, P, Z, R, Delete, Ctrl+Z, Esc and "?" listing
    them. `playwright.config.ts` (Modify): the desktop project's `testMatch` gains `mapsread`,
    `mapsedit` and `mapstyles`.

### Release 13c: editing tools

21. `packages/geo/src/curve.ts` (Create): `outline()` of §6. `packages/geo/src/move.ts` (Create):
    `moveBy()` of §7. `packages/geo/src/hit.ts` (Modify): `vertexAt` generalised to `handleAt(handles,
    p, reach)`, kept as a wrapper. `packages/geo/src/zone.ts` (Modify): `zoneOnPlate` takes the closed
    outline. `packages/geo/src/index.ts` (Modify).
22. `packages/geo/test/curve.test.ts`, `packages/geo/test/move.test.ts` (Create): the line passes every
    control point; straight input gives today's `densify`; the same samples at any zoom; a pole, the
    180th meridian, points 179° apart; repeated points; a closed loop; length of a curve is above its
    chord; a zone moved by rotation keeps its area (d3 `geoArea`); a flat move is a translation.
    `packages/geo/test/geo.test.ts` (Modify): `zoneOnPlate` with an outline.
23. `packages/schema/src/maps.ts` (Modify): `curve: z.literal("smooth").optional()` on paths and zones;
    `"curve"` in `ITEM_KEYS.features` after `"points"`. `packages/schema/test/maps.test.ts` (Modify): a
    map without the field serialises to the same bytes; `curve` survives a merge.
24. `apps/web/src/map/overlay.ts` (Modify): `outline()` everywhere, the outline cache, "+" handles.
    `apps/web/src/map/live.ts` (Modify): the rubber band.
25. `apps/web/src/map/gesture.ts` (Modify): `pick` adds "+" handles and the inside of the selected zone;
    drag targets `insert` and `zone`; a click with `detail` 2 finishes. `gesture.test.ts` (Modify).
26. `apps/web/src/map/tools.ts` (Modify): the marker tool stays on; `insertPoint`, `moveZone`,
    `setCurve`, `takeBackPoint`, each through `writeShape` on the shape on screen. `tools.test.ts`
    (Modify): at a year where a later shape is in force, each edit changes that shape only.
27. `apps/web/src/components/map/MapHints.tsx` (Modify): the words of §5, the curve switch, "Finish
    path" and "Finish zone".
28. `apps/web/src/keys.ts` (Modify): `map.finish`, `map.curve`; `map.delete` takes back the last point
    while drawing.
29. `apps/web/src/components/ui/Combobox.tsx` (Modify): `onSearch` and no second filtering.
    `apps/web/src/components/ui/EntryCombobox.tsx` (Create, unless 12b made it).
30. `apps/web/src/components/map/FeatureEditor.tsx` (Modify): Entry combobox; "Map of this place"
    combobox; Straight / Curved; the path's length. `apps/web/src/components/map/MapSetup.tsx` (Modify):
    "Lies under" combobox. `apps/web/src/components/map/LayerPanel.tsx` (Modify): "Add an image…" opens
    `ImagePicker`; "Drawing into".
31. `apps/web/src/components/images/ImagePicker.tsx` (Modify): a single-choice mode and `forMap` (leaves
    out marker icons). `apps/web/src/pages/Maps.tsx` (Modify): "Choose an image…" opens it; the file
    input goes.
32. `apps/server/src/routes/images.ts` (Modify): `/api/gallery` marks `icon`. `apps/server/src/routes/
    maps.ts` (Modify): `/api/map-images` removed. `apps/web/src/api.ts` (Modify): `mapImages` removed.
    `apps/server/test/maps.test.ts` (Modify).
33. `apps/server/src/ai/discover.ts` (Modify): zone membership on the closed outline.
    `apps/server/package.json` (Modify): `@frontier/geo`. `apps/server/test/lore.test.ts` (Modify; it
    holds the discovery tests): a place inside a curve's bulge but outside its control polygon is
    inside.
34. E2E helpers: `apps/web/e2e/helpers.ts` (Modify): `makeMap(page, title, kind)` through the form and
    the image dialog; `pickEntry(scope, name)` through the entry combobox.
35. E2E (Modify):
    - `maps.spec.ts`: its own `makeMap` gives way to the helper; "CUJ 7: places a marker for an entry…"
      links through `pickEntry`; "draws a path and a zone, hides a layer, and undoes" finishes with "Finish
      path"; "brings one of two markers on the same spot above the other" presses Select (V) before
      tapping, since the marker tool stays on; "a zone around a pole…" finishes with "Finish zone";
      "adds a second image…" adds it through the image dialog. "CUJ 5" and "CUJ 10" do not change.
    - `mapstime.spec.ts`, "CUJ 16: a fort appears and goes…": the new-map form through the helper, the
      hint's new words on desktop, "Finish zone", `pickEntry`.
    - `mapviews.spec.ts`: "CUJ 18: steps down to a layer…" sets "Lies under" through the combobox;
      "CUJ 19: a world on a schematic map revolves…" chooses the image in the dialog. "CUJ 17" does not
      change.
    - `ai.spec.ts`, "CUJ 13: explores a map…": the new-map form through the helper.
36. `apps/web/e2e/mapsedit.spec.ts` (Create): CUJ 2 (rubber band seen by a screenshot difference while
    the mouse moves; Backspace; double-click; the stored `curve`; "+" drag; Ctrl+Z), CUJ 3 (pan on an
    unselected zone; drag of the later shape; first shape unchanged), CUJ 4, CUJ 6, and CUJ 7's zone drag
    and "+" on the phone.

### Release 13d: styles

37. `packages/schema/src/mapStyles.ts` (Create): `MapStyle`, `MapStylesFile`, `MAP_STYLES_PATH`, `DASHES`,
    `parseMapStyles`, `serialiseMapStyles` (one style per line), `mergeMapStyles` (by id),
    `STARTER_STYLES`. `packages/schema/src/index.ts` (Modify). `packages/schema/test/mapStyles.test.ts`
    (Create): parse, bytes, merge of two edits to different styles, field limits.
38. `packages/schema/src/maps.ts` (Modify): `style` (an item id) and `color` (`#rrggbb`) on paths and
    zones; both in `ITEM_KEYS.features` after `"icon"`. `packages/schema/src/api.ts` (Modify): the
    `/api/map-styles` bodies; `ConflictReason` gains `map_styles_changed_on_both`.
39. `apps/server/src/maps/styles.ts` (Create): loads the file (draft, then library, then empty), counts
    use across maps, saves with `revision`, `baseBlob` and `op` through `saveFrom`/`serverChange` as
    `maps/store.ts` does. `apps/server/src/routes/mapStyles.ts` (Create) and `apps/server/src/app.ts`
    (Modify): the two routes.
40. `apps/server/src/publish/publish.ts` (Modify): a `FILE_KINDS` entry for the styles file, merged with
    `mergeMapStyles`. `apps/server/test/mapStyles.test.ts` (Create): a missing file reads as empty; a
    stale save; use counts with drafts; field checks. `apps/server/test/publish.test.ts` (Modify): the
    file merges on publish.
41. `apps/web/src/sync/db.ts`, `apps/web/src/sync/queue.ts` (Modify): the `map-styles` key and its
    merging sender. `apps/web/src/sync/queue.test.ts` (Modify).
42. `apps/web/src/api.ts` (Modify): `mapStyles()`, and the save body for the queue.
43. `apps/web/src/map/mapStyles.ts` (Create): `useMapStyles()` and `paintOf(feature, layer, styles)`,
    the precedence table of §9. `apps/web/src/map/mapStyles.test.ts` (Create): each row of the table; a
    deleted style; undated dots over a dashed style.
44. `apps/web/src/map/overlay.ts` (Modify): draws with `paintOf`; path and zone labels; undated drawn
    dotted; `drawSample()` for the tab and legend.
45. `apps/web/src/components/map/StylesPanel.tsx` + `.css`, `StyleForm.tsx`, `StyleSample.tsx`,
    `Legend.tsx` (Create). `apps/web/src/components/map/FeatureEditor.tsx` (Modify): style combobox and
    "Own colour". `apps/web/src/components/map/LayerPanel.tsx` (Modify): the Legend.
    `apps/web/src/components/map/MapContextMenu.tsx` (Modify): "Path style ▸", "Zone style ▸".
46. `apps/web/src/pages/MapPage.tsx` (Modify): the Styles tab through `usePanel` while editing.
47. `apps/web/e2e/mapstyles.spec.ts` (Create): CUJ 5 on two maps; the deleted-style fallback; the
    legend; two browser contexts editing different styles merge.

### Verification Plan

- `npm run typecheck && npm run lint && npm run format && npm test && npm run build && npm run e2e`,
  in the desktop and iPhone 13 projects.
- 13a: the map specs (`maps.spec.ts`, `mapstime.spec.ts`, `mapviews.spec.ts`) and the map tests in
  `export.spec.ts` and `ai.spec.ts` pass with no change to any spec file (`git diff --stat
  apps/web/e2e` is empty for the release).
- `packages/geo` keeps its 85% branch coverage; schema and server keep their thresholds.
- First-load JS gzipped stays within stage 11's limit (80 KB above 506.32 kB); the map chunk is measured
  before 13a and after each release, and grows by no more than 25 KB gzipped over the stage.
- Screens at desktop and phone size after 13b and 13c: a hovered marker with its preview, a selected
  path with handles and "+", a path being drawn with its rubber band, the Styles tab, the legend. The
  review items in Technical Plan §11 are no longer visible in them.
- By hand on a real iPhone: tap selects; a long press opens no menu; a zone drag and a "+" by finger.

## Open questions

1. **A legend in saved pictures.** (a) The picture shows the map exactly as on screen, with no legend
   (this design); (b) "Save a picture" offers "with the legend", which draws the Legend in a corner of
   the picture.
2. **The path and zone tools after finishing.** (a) Return to Select, so the new shape can be adjusted
   at once (this design); (b) stay on, like the marker tool, so several paths can be drawn in a row,
   with Esc or V for Select.
