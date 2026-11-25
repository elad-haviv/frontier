# Stage 20: space maps

- **Author:** Elad Haviv
- **Status:** 20a (star map) built; 20b (system model) and 20c (layered view) to build
- **Date:** 2026-11-25
- **Parents:** [Stage 13, maps](stage-13-maps.md), [stage 7, more map views](stage-7-more-map-views.md),
  [stage 6, maps in time](stage-6-maps-in-time.md)
- **Mockup:** the interactive mockup the design was approved from showed three screens (star map,
  system model, layered world) on desktop and phone. This file is its written form.

---

## Overview

Maps today are drawn over an image: a globe, or a flat picture. This stage adds maps that are not.
It ships in three releases:

- **20a, star map.** Stars as light dots or pins in open space, placed in three numbers, joined by
  routes. No image. Built.
- **20b, system model.** A star and what circles it: planets, moons, belts, comets, stations, and a
  second star. Orbits move as the years play.
- **20c, layered view.** A globe and the globes set to lie under it (Derdama under Ezob), drawn as a
  stack, with passages between layers.

Terms: **plane** is the flat level places are put on; **height** is how far a place is above it (or
below, when negative); **lane** is the kind of a route; a **light dot** is a star drawn as a glowing
point; a **pin** is today's marker look.

## What is wrong today

- Every map needs an image, and a place is a point on it. There is nowhere to put a star above or
  below another.
- A marker can revolve around one other marker on a schematic map, but orbits do not chain (no
  moons), have no shape, and time cannot be played.
- Distances in space cannot be measured, so routes carry no lengths.

## Decisions (approved with the recommendations)

1. **Canvas tone.** Dark in both themes, like a map's image. The bar, tools, side bar and time bar
   keep the page's own colours. Light dots only work on dark.
2. **Dots or pins.** Light dots by default, set per layer ("Drawn as" in the Layers tab), with a pin
   as a per-marker choice.
3. **Placing in 3D.** Click the plane to put a star down, then drag its ↕ handle to lift it. Dragging
   the star itself slides it level, keeping its height. Across, Along and Height fields give exact
   numbers.
4. **Playing time.** Play is allowed on system models only (20b), with the chronicle optional.
5. **Name.** "Star map" and "System model".
6. **Derdama.** A "Layers stacked" view of globes that already exist, plus passages (20c), drawn as
   flat-lying layers. Open: whether Derdama's real shape in the lore differs (rings, shells, a sun
   inside, layers that stop lining up with Ezob).

## 20a: the star map

### The file

A star map is an ordinary map file whose `space` is `{ kind: "stars", unit, speed? }`. `unit` is
light-years by default; `speed` is how far ships go in a day, which gives routes a travel time. It
has no images. Its features:

- **Star**: a `marker`. `at` is its place on the plane (x across, y along); new optional fields
  `z` (height), `look` (`dot` or `pin`), `tone` (a `#rrggbb` colour) and `size` (1 small, named on
  hover; 2 normal; 3 large, always named).
- **Route**: a new feature kind `route`, with `stops` (star ids, at least two) and `lane` (`jump`,
  `trade` or `patrol`). Its length is computed from the places, never stored.
- Layers gain an optional `look` (`dot` or `pin`). A new star map has two: Stars (dots) and
  Stations and ports (pins).

Saving, merging item by item, drafts, offline copies and publishing are the existing map machinery.
The server makes a star map from the title alone (`POST /api/maps` with `kind: "stars"`).

### The screen

- **Camera.** Drag empty space to turn the view; wheel or pinch zooms; Shift-drag, right-drag or two
  fingers slide it. Double-click a star centres on it. Arrows turn the view, `0` shows the whole
  map, `+` and `−` zoom. The zoom cluster has Look from above / Tilt the view.
- **Depth.** The plane is always drawn, with distance rings at 5 and 10 and "coreward / spinward"
  captions. Every star has a thin line down to a foot on the plane (dashed below it); the line is the
  main depth cue. Far stars fade and shrink.
- **Stars.** Light dots are a solid core with a soft glow, 3, 4.5 or 6 px by size. Large stars are
  always named, normal ones when zoomed in, small ones on hover. Names that collide keep the nearer.
  Hover is an orange ring; selected is a paper ring inside an orange one.
- **Routes.** Jump lane (solid gold), trade route (dashed teal), patrol (dotted rose). A selected
  route shows each leg's length. Routes appear in a legend in the Layers tab.
- **Tools.** Select (`v`), Star (`m`), Route (`p`), Undo, Redo. The Star tool stays on after a star
  is placed. Route: click star after star; "Finish route", Enter, a double-click or a click on the
  last star ends it; Esc cancels; Delete takes back the last stop.
- **Side bar.** Layers (legend, layers with their look, Show switches, the map's unit and ship
  speed, the list of places and routes), and Selected / Edit feature for the chosen star or route.
  The card gives place, nearest stars, routes through it, Open the entry, Open its map of this place,
  Centre the view here. A star's "map of this place" is how a star opens its system model (20b).
- **Find a star** in the bar flies to a star by name, since a small dot is hard to spot.
- **Empty map.** The plane and one button, "Place the first star".
- **Phone.** The canvas fills the screen; the side bar is the bottom sheet; the tools are the
  bottom bar; the hint is a compact card at the top; dots take a 22 px tap.
- **Not accessible by canvas alone.** Every star and route is listed in the Layers tab, and every
  number can be set in the Edit feature tab.

### Left out of 20a

Zones and nebula volumes, curved routes, stars that move over time, importing star catalogues,
Explore with AI, Save a picture, the compass cube, "Place from another star", reordering routes on
the canvas. Route kinds are fixed (`jump`, `trade`, `patrol`) rather than the library's path styles.

### Tests

Unit: `space3d.test.ts` (projection round trip, distances, picking), `starMap.test.ts` (edits),
schema and server tests for the file. Browser: `starmap.spec.ts` (create without an image, place,
route, lift, drag, undo; phone and desktop).

## 20b: the system model (to build)

- Space `{ kind: "system", unit: "AU" }`. Bodies are markers with an orbit: what they circle,
  distance, shape (round to stretched), where they are now. The year follows from the distance by
  Kepler's third law (period in years = √(distance³ ÷ mass)); typing the year back-solves the
  distance. Under More: direction, turning the orbit, rings, mass.
- Kinds: star, rocky planet, ocean world, gas giant, ice giant, dwarf planet, moon, station, belt,
  comet, second star. Moons and stations use their own exaggerated local scale around the planet.
- A second star makes a pair that circles a shared centre, heavier star nearer it. Planets circle
  both.
- Orbits are fixed tracks, not simulated gravity, so any year can be shown at once. Stability notes
  are soft and never block (a moon beyond a third of its planet's Hill radius, orbits that cross).
- Drawn for reading: distances compressed, sizes symbolic, with a "True distances" switch.
- Time uses the time bar plus Play and a speed (1 day, 1 month, 1 year, 10 years a second); Play is
  new to maps and is for system models only. Cards say how far a body is from home now and when it
  is next closest.
- Drag a body outward to change its distance, around to change where it is. Double-click a planet to
  follow it and see its moons.

## 20c: the layered view (to build)

- A globe with globes set to lie under it gains "Layers stacked" in its View menu: the surface and
  each layer as plates, one under the other, built from the maps that already exist. Nothing is
  stored twice.
- A line straight down under the pointer shows what lies above and below any spot, since layers share
  longitude and latitude.
- **Passages** are the one new thing to draw: a link between a place on one layer and a place on
  another, kept on the upper map. Each place's card says where its passages lead.
- You work on one layer at a time; the others dim. Changing a marker's layer drops it straight down.
- Open question: whether Derdama's layers are flat plates as drawn or have another shape.
