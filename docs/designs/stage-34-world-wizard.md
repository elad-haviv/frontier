# Stage 34: the World Wizard

- **For:** the owner's ask, "When creating a new project, can you add an option for 'Start with'
  that is a 'World Wizard' which generates a world", and his outline of it: a star system; a base
  world (basic parameters, land and sea rolled or drawn, tectonic plates drawn or automatic and
  simulated "for as long as the user wants", a height map, precipitation, biomes) on a globe or
  flat; then suggested entries about life, sapient species and locations. "Of course it would then
  create maps as well."
- **Status:** approved by the owner (2026-11-27) with all four recommendations. **Release 1 is
  built** (the world and its map); releases 2 and 3 are designed here and not built.
- **Mockup:** the working mockup the design was approved from was shared in the session (star
  system, the six parts of the world, life and lore, and what gets made, on desktop and phone). Its
  simulation was a simplified stand-in; this file is its written form.

## What's wrong today

"Start with" in New project has three choices: an empty library, a vault zip, or the sample.
Someone with an idea and no notes gets one welcome entry. Maps need a picture the owner already
has; nothing in Frontier makes one. A height map can be built from a picture's hints (stage 21)
and biomes suggested from a height map, but there is no way to begin from nothing.

## The design

A wizard that builds a world from the star down, then makes the things Frontier already keeps:

| From | Becomes | Already in Frontier as | Release |
| --- | --- | --- | --- |
| Land, plates, heights | A globe map with a painted picture and its height map, sea level set | Globe maps, Terrain (stage 20) | 1 |
| Biomes | Biome zones on that map | Biome zones (stage 21) | 1 |
| Star system | A system model with the star, planets and moons | System model (stage 22) | 2 |
| Orbit, day length, moons | A calendar: days in a year, months, seasons | Chronicle calendars (stage 5) | 2 |
| Heights and rain | Rivers and lakes as paths | Find paths (stage 20) | 2 |
| Life and lore | Entries, each place with a marker; species with a home range | Entries, markers, zones | 3 |
| All of it | A World brief entry the AI reads later | New | 3 |

### The steps

1. **Star system** (release 2). The star (red dwarf, orange, yellow, white; an optional second
   star), planets with their kind and distance, which one is the world, its moons. A band shows
   where water stays liquid; "Keep it able to hold life / Ignore that". It sets the year, the
   warmth the climate starts from, and the sky.
2. **The world**, in six parts, each with a Globe / Flat switch:
   1. **Basics**: tilt of the axis, length of a day, size, which way it spins.
   2. **Land and sea**: rolled (how much land; a few large lands or many small ones), drawn with a
      brush (white is land, black is sea), or both.
   3. **Plates**: rolled or painted; each with a direction and a speed; **Play**, **Step** and
      **Back to the start**, for as long as wanted.
   4. **Heights**: from the plates; sea level, mountain height, roughness; in colours or as the
      grey height map.
   5. **Climate**: rain and temperature, with wind arrows; warmer or colder, wetter or drier.
   6. **Biomes**: Frontier's fifteen kinds with their share of the surface; pick one and paint to
      overrule.
3. **Life and lore** (release 3). Places found on the world (the highest range, the driest basin,
   a sheltered coast) as numbered pins; sapient species with where each arose; life by biome; a few
   questions first (how many species, how much magic, the present age). Uses the person's AI key.
4. **Make it**: the list of what is made, a name, and one button.

Also in the design: one **seed** and a roll in every part, so a world can be rebuilt; **Surprise
me**, which rolls everything; every rule is advice and never a lock (a jungle at the pole stays if
painted).

### Phone, keyboard, states

- **Phone**: the view on top, the part's controls under it, the way on stuck to the bottom. On the
  globe a **Paint / Turn** switch says what a drag does.
- **Keyboard**: parts are buttons; sliders use the arrow keys; `v` switches globe and flat, `p`
  plays and pauses the drift, `[` and `]` change the brush. Painting needs a pointer, so every
  painted part also has a rolled start that needs none. When a part opens, its heading takes the
  focus.
- **States**: leaving keeps everything, and Home says "is waiting at Climate: Carry on". The world
  parts need no AI and no connection until the last step, which needs one to send the pictures.

## Decisions (as approved)

1. **How true to physics?** Believable and fast, in the browser; every result can be painted over.
2. **When an earlier part changes after later ones:** later parts are rebuilt, after asking where
   something would be lost, and hand painting is kept where it still fits.
3. **Build order:** the world first, then the star system and calendar, then life and lore. Three
   releases, each usable alone.
4. **Where:** both a start option of New project and **New world…** on the Maps page.

## Release 1, as built (2026-11-27)

The world and its map. No server change: the wizard uses the routes that exist.

### Where it is

- **New project → Start with → The World Wizard.** The project is made empty first, as for a zip,
  and the wizard opens in it at `/p/<project>/world`. The button reads "Make it and start the
  wizard".
- **Maps → New world…**, beside New map, for a world inside a project that exists.
- **Home** shows a World Wizard card while a world waits on this device, until its map is made.
- Writers and owners only (`WriterOnly`).

### The models (`apps/web/src/world/model.ts`)

The globe is a grid of one-degree cells (360 × 180). Stages are built in order and each is built
again only when something before it changed.

- **Land**: the highest part of a noise field on the sphere, as much as asked for, by area.
- **Plates**: each cell joins the nearest of some random points, with ragged edges; each plate
  gets a direction (eight ways) and a speed in cm a year.
- **Drift**: a step is 2 million years. Each plate moves by whole cells once its drift adds up to
  one. Where two pieces of crust land on one cell they have met: land on land folds into mountains,
  sea floor under land raises a coastal range, sea floor on sea floor an island arc; ranges grow
  more slowly the higher they are. Where no crust lands, new sea floor opens and sinks as it ages.
- **Heights**: the crust softened into shelves and slopes, raised where plates are closing now and
  lowered where they part, plus detail, measured from the sea level. A height of 1 is 9,000 m.
- **Climate**: warmth falls from equator to pole (less on a world that leans far over) and with
  height. Wind blows in three bands each side of the equator, turned round by the spin. Air takes
  up water over the sea and loses it over land, most where the ground rises, so the far side of a
  range is dry.
- **Biomes**: a table of height, warmth and rain giving Frontier's kinds. A biome painted by hand
  is kept where it still fits the ground (water kinds on the sea, land kinds on land, ice on both)
  and waits, unused, where it does not.

### What Make it does (`world/make.ts`, `picture.ts`, `zones.ts`)

1. Paints the world at 2048 × 1024, reading between the grid's cells and adding finer detail so
   coasts are not stair-stepped, shaded by slope; and the height picture to match, with the sea
   level at one grey.
2. Uploads both as images ("<name> map.png", "<name> heights.png").
3. Makes a globe map over the first and gives it: the radius (6,371 km × size), the terrain (the
   height picture, its sea level, a range of −5,400 to 9,000 m), and the biome zones in a Biomes
   layer, outlined with Suggest biomes' own outliner (`findPaths/regions.ts`). The open sea is not
   a zone; ice is. A region that crosses 180° becomes two zones that meet there. Biome styles the
   library lacks are added.
4. Opens the map. All of it is unsaved changes until a version is saved.

### Asking before something is lost

- Changing the land or the plates after the drift has run: "Start the drift again?", once.
- Rolling the land after drawing on it: "Replace the land you drew?".
- Surprise me, on a world already worked on; Start over.
- Painted biomes are never asked about: they are kept where they fit.

### Differences from the mockup

- **Kept on the device, not the server.** A world in progress is in the browser's own storage
  (`world/store.ts`, a database of its own), one for each project. Another device does not see it.
  Nothing reaches the project until Make it.
- **Keys**: `v` for the view and `p` for Play, not G and Space: `g` begins the app's "go to" keys
  and Space presses the focused button.
- **Layout by the page's own width**, so it stacks when the library pane is open beside it.
- **No "bring a picture"** in Land and sea, and no raising or lowering heights by hand: both wait.
- The year, the star's warmth and the calendar are release 2; rivers too.

### Known limits

- Plates slide along the grid, not round a point on the globe, so drift near the poles is
  distorted: a plate can smear along the top or bottom edge of the flat view. It reads better on
  the globe.
- The height picture is 8-bit: steps of about 60 m, which the tools smooth as they read.
- One world waits per project on a device.

### Code and tests

- `apps/web/src/world/`: `model.ts`, `picture.ts`, `zones.ts`, `make.ts`, `store.ts`.
- `apps/web/src/pages/world/`: `WorldWizard.tsx`, `WorldCanvas.tsx`, `WorldWizard.css`.
- Entry points: `pages/projects/NewProjectDialog.tsx`, `pages/Maps.tsx`, `pages/Home.tsx`; the
  route in `App.tsx`; the keys in `keys.ts` (scope "World Wizard").
- Tests: `world/model.test.ts` (same seed same world, land share, mountains where lands meet and
  sea floor where they part, the rain shadow and its turning with the spin, the biome table,
  painted biomes kept where they fit, the brush), `world/zones.test.ts` (outlines on the globe,
  the made map is one Frontier accepts, the two pictures agree on the sea), `e2e/world.spec.ts`
  (both ways in, every part, kept on the device, Make it), on phone and desktop.

## Left for later

Release 2 (star system, calendar, rivers), release 3 (life and lore, the World brief, markers);
then other shapes (a disc, a cylinder like Derdama), ocean currents, resources, naming languages,
history played forward on time-aware maps, and plates that turn about a point.
