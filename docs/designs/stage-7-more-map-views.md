# Stage 7: more map views

Status: Draft, 2026-11-21. Author: Elad Haviv. Parents: [Frontier](frontier.md),
[stage 4, maps](stage-4-maps.md), [stage 6, maps in time](stage-6-maps-in-time.md).

## Overview

Stage 4 drew a globe two ways: as a ball, and laid flat in the plain longitude-by-latitude view. The
parent design left three things for this stage: other projections, a space for Derdama, and a space
for the cosmology. The author decided on 2026-11-21:

1.  **Projections** as in his own `map-reprojector`: Mercator, equirectangular, Robinson, Mollweide,
    Winkel Tripel, Fahey and Natural Earth, plus two hemispheres side by side; each with the globe
    turned about three axes before it is laid flat, and a focus that fits the view to a marked region.
2.  **Derdama** is layers under Ezob, and a place on a layer lies directly under the spot of Ezob it
    came from. Layers share Ezob's longitude and latitude.
3.  **The cosmology** is a schematic map: no measuring; each world opens its own map; worlds revolve
    symbolically around the centre as the years move, with no drift that a story would notice.

The parent's `cylinder` and `schematic` spaces are not built. Derdama needs no space of its own,
since its layers are spheres stacked under Ezob; a schematic map is a flat map with measuring off.

## What stage 7 delivers

| Part | The author can |
| --- | --- |
| 7a Projections | Choose how a globe is laid flat; turn it about three axes; focus on a region; keep it all in the address |
| 7b Layers beneath | Say that one globe lies under another; step down and up between them at the same place |
| 7c Schematic maps | Mark a flat map as schematic; open a world's map from it; let a world revolve around another as the years move |

### CUJ 17: Look at Ezob as an atlas does

*   **Given**: The Ezob globe map, with zones for two continents.
*   **When**: On a desktop the author chooses Robinson, drags the map sideways until the Eladonic
    Ocean is in the middle, tilts the north pole 20 degrees towards him, then marks a box around
    Amarah with Focus.
*   **Then**: The image and every zone, path and marker are drawn in Robinson, cut cleanly at the
    map's edge. Dragging sideways turns the globe, so the map never runs out. The tilt bends the
    grid as in map-reprojector. Focus turns the globe so Amarah is in the middle and zooms until it
    fills the screen. Measuring a path gives the same distance as on the ball. The address holds
    the projection, the three angles and the zoom; opening it again shows the same view.

### CUJ 18: Go down into Derdama

*   **Given**: The Ezob globe, and a globe "Derdama, Layer 1: The Labyrinth" set to lie under it.
*   **When**: The author centres Ezob on Dudai, presses "Down", looks around, presses "Up".
*   **Then**: "Down" opens the Labyrinth centred on the same longitude and latitude, in the same
    view and projection and at the same year. "Up" returns to Ezob at the place he moved to.

### CUJ 19: The Layered Heavens

*   **Given**: The Layered Heavens image as a flat map marked schematic, with a marker for Ezob at the
    centre and a marker for Korr set to revolve around it once every 1,000 years, linked to Korr's
    map.
*   **When**: He turns time on and moves from year 0 to year 250, then taps Korr and opens its map.
*   **Then**: Korr moves a quarter of the way around Ezob. There is no Measure tool. The card opens
    Korr's map.

## Non-goals

*   Projections other than the nine listed; projections of a flat map.
*   Dragging the globe's tilt with the pointer. Tilt is set by number, as map-reprojector's panel
    does; dragging turns about the north-south axis only.
*   Drawing features while a projection other than the ball or the plain flat view is shown is
    supported, but a feature that crosses the map's own edge is drawn as two parts there.
*   Worlds drifting between the rings of the cosmology.
*   Exporting a view as an image: stage 9.

## 7a Projections

### The view

A third kind of view of a sphere map, kept in `ViewState`:

```ts
{ kind: "projected"; projection: ProjectionId; rotate: [number, number, number]; k: number; x: number; y: number }
```

*   `projection` is one of `mercator`, `equirectangular`, `robinson`, `mollweide`, `winkel3`,
    `fahey`, `naturalEarth`, `hemispheres`. The first seven come from `d3-geo` and
    `d3-geo-projection` exactly as map-reprojector makes them. `hemispheres` is d3-geo-projection's
    interrupted Mollweide hemispheres: two discs, east and west.
*   `rotate` is d3's `[λ, φ, γ]` in degrees: turning about the poles, tilting towards or away, and
    turning about the centre of view.
*   `k` is d3's scale. `x` and `y` move the drawing from the centre of the screen, in pixels.
*   The map's bar gains one menu, **View**: Globe, Flat (the stage 4 plate view, unchanged) and the
    eight projections. Changing the view keeps the centre: the new view's `rotate` is `[−lon, −lat,
    0]` of the old centre, and its scale shows about the same width.
*   **Moving.** A drag turns the globe about its axis by the horizontal movement (`λ`) and moves the
    drawing by the vertical movement (`y`), so a world map scrolls sideways without end and up and
    down within its height. The wheel and a pinch zoom about the pointer by changing `k` and `x`,
    `y` together.
*   **Turning.** A "Turn" panel, opened from the View menu, has the three angles as numbers with a
    reset. It is map-reprojector's panel in Frontier's style.
*   **Focus.** A Focus button in the same panel; the next drag on the map marks a box. On release the
    globe is turned so the box's centre is in the middle (`λ`, `φ` from that centre, `γ` kept) and
    zoomed so the box fills nine tenths of the screen. Escape or the button again cancels.
*   **Address.** `v=x,<projection>,<λ>,<φ>,<γ>,<k>,<x>,<y>`. An unknown projection reads as the
    plain flat view.

### Drawing the images

The WebGL renderer gains a path for projected views.

*   The grid is laid out in the **turned** frame: longitudes −180 to 180 and latitudes −90 to 90
    after the turn, in cells of 2 degrees (4 while a finger is down on a slow device). The map's edge
    and the hemispheres' cut then fall on cell edges, which is what keeps cells from being stretched
    across the map.
*   Each cell has its own four corners, each nudged a millionth of a degree into the cell, so a
    corner on an edge projects to that cell's side of the edge. Cells are drawn as plain triangles
    without shared corners (`drawArrays`).
*   A corner's place on screen is the projection without its turn applied to the turned position. Its
    place in the image is found by turning it back (`geoRotation(rotate).invert`) and reading the
    image's extent: `u = (lon − west) / (east − west)`, `v = (north − lat) / (north − south)`.
*   An image that covers all longitudes repeats sideways (`REPEAT` on the texture's `u`), and within
    one triangle the corners' `u` are brought within half of each other, so no triangle stretches
    across the image's own seam. The fragment shader discards anything with `v` outside 0 to 1, and
    `u` outside 0 to 1 for an image that does not cover all longitudes, so a part image is cut at its
    extent.
*   A cell whose corners all fall off the screen is left out.

### Drawing features and tapping

*   `makeView` for a projected view builds the d3 projection. `project` is the projection;
    `unproject` is its inverse, accepted only when projecting the result back lands within one pixel
    of the tap, which rejects taps outside the map's outline and in the gaps between hemispheres.
*   Paths and zone outlines are passed through the projection's stream, which cuts them at the map's
    edge and the hemispheres' cut. The pieces become the screen lines the overlay draws and the tap
    test uses. A zone is filled with `geoPath`, after the same winding check the globe uses.
*   Corner handles and markers use `project`; a marker or corner exactly on the edge may be drawn on
    either side.
*   The map's outline (`{type: "Sphere"}`) is drawn as a thin line, as the ball has its rim.

## 7b Layers beneath

*   A map may name the map it lies under: the top-level key `under`, a map id, absent by default.
    Both maps must be sphere maps; the editor offers only sphere maps, and a flat map's `under` is
    ignored.
*   The map's bar shows **Up** when the map has `under` and that map exists, and **Down** when one or
    more maps name this one; with several, Down is a menu.
*   Up and Down open the other map with the same `v`, `t` and `c`. The layers share coordinates, so
    the same view shows the same place.
*   The list of maps shows a stack under its top: "Ezob, then 7 layers below".
*   Set in the Layers panel while editing: "This map lies under…" with a menu of the other sphere
    maps. A map cannot lie under itself or under a map that lies under it.
*   `GET /api/maps` gains `under` on each map.

## 7c Schematic maps

*   A flat map's space gains `schematic: true`. The new-map form offers "Schematic: a diagram, with
    no measuring". The Layers panel can turn it on and off while editing.
*   A schematic map has no Measure tool, no scale and no "Set the scale".
*   Opening a world's map uses what exists: a marker's "A map of this place" and the card's "Open
    the map of this place", which carry the year and chronicle.
*   **Revolving.** A marker on a flat map may hold `orbit: { around, period }`: `around` is the id of
    another marker on the same map and `period` a positive number of years for one turn. With time
    on, at year `y` the marker is drawn at its own position turned about the other marker's
    position by `360 × y / period` degrees, counter-clockwise on the screen. With time off, or before
    a chronicle is chosen, it is drawn where it was placed. Its drawn position is what is tapped.
*   The orbit is applied after the shape in force (stage 6), so a world can be given a later shape
    and still revolve. Orbits do not chain: the centre's own orbit is not applied to the turn of the
    marker around it, which keeps the diagram readable.
*   Dragging a revolving marker while time is on sets its own position so that it lands where it was
    dropped at the year shown.
*   The feature editor of a marker on a flat map has "Revolves around" (a menu of the map's other
    markers, or none) and "Once every … years".

## Map file changes

*   `under`: a map id, top-level, after `space`. Absent or null means none.
*   `space.schematic`: boolean, optional; false when absent.
*   Feature `orbit`: `{ around, period }`, written after `shapes`.
*   All are optional; a map without them is written as before. `orderFeature` places `orbit`.
*   `ViewState` is not stored in the file; only in the address.

## Files

| File | What |
| --- | --- |
| `packages/geo/src/view.ts`, `projections.ts` | The projected view: projection list, `makeView`, `panBy`, `zoomAt`, switching views, focus |
| `packages/geo/src/mesh.ts` | `projectedMesh`: the turned grid with its image places |
| `packages/geo/package.json` | `d3-geo-projection`, with a short type file |
| `apps/web/src/map/renderer.ts` | The projected path, `REPEAT`, discarding outside the extent |
| `apps/web/src/map/overlay.ts` | Cut lines and filled zones in a projected view; the outline |
| `apps/web/src/map/viewUrl.ts` | The `x` form of `v` |
| `apps/web/src/map/time.ts` | Orbits in `resolve`; writing a dragged orbiting marker |
| `apps/web/src/components/MapPanels.tsx`, `MapTurn.tsx` | View menu, Turn panel, focus; Revolves around; This map lies under; schematic switch |
| `apps/web/src/pages/{MapPage,Maps}.tsx` | Up and Down; the stack in the list; no Measure on a schematic map |
| `packages/schema/src/maps.ts`, `apps/server/src/routes/maps.ts` | `under`, `schematic`, `orbit`; `under` in the list |

## Risks

| Risk | Effect | Answer |
| --- | --- | --- |
| Projecting a fine grid every frame is slow on a phone | Dragging stutters | A coarser grid while a finger is down; the grid covers only cells on screen |
| The inverse of Winkel Tripel and Robinson is iterative and imprecise near the edge | A tap or a drawn point lands a little off | The one-pixel round-trip check refuses doubtful points; drawing near the edge is rare |
| A tilt makes the map hard to read | The author is lost | Reset in the Turn panel; the angles are in the address |
| Two layers with different images of the same place | Confusing | Intended: each layer is its own map |

## Verification

*   **geo:** each projection's `project` and `unproject` agree for a grid of positions; points
    outside the outline are refused; the mesh's corners turn back to the positions they came from;
    no triangle spans more than a tenth of the drawing; zoom about a point keeps it in place; focus
    centres a box and fills the screen; switching views keeps the centre.
*   **schema:** `under`, `schematic` and `orbit` read and written; a map without them unchanged.
*   **web unit:** an orbit at years 0, a quarter, a half and a full period; a drop while revolving.
*   **Browser:** CUJ 17 on a desktop and the projection switch on a phone with no sideways scroll;
    CUJ 18; CUJ 19.

## Questions for the author

None blocks the build.

1.  Should Derdama's lower layers, being older and stranger, ever stop lining up with Ezob?
2.  Which way do worlds revolve in the cosmology, and does each have its own period?
