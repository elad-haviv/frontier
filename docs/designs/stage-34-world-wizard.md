# Stage 34: the World Wizard

- **For:** the owner's ask, "When creating a new project, can you add an option for 'Start with'
  that is a 'World Wizard' which generates a world", and his outline of it: a star system; a base
  world (basic parameters, land and sea rolled or drawn, tectonic plates drawn or automatic and
  simulated "for as long as the user wants", a height map, precipitation, biomes) on a globe or
  flat; then suggested entries about life, sapient species and locations. "Of course it would then
  create maps as well."
- **Status:** approved by the owner (2026-11-27) with all four recommendations. **All three
  releases are built**: the world and its map; the star system, the calendar and rivers; life and
  lore.
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
| Orbit, day length, moons | An entry on the sky and the calendar: days in a year, months, seasons | Entries | 2 |
| Heights and rain | Rivers as paths | Paths, the River style | 2 |
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
- From release 2 the wizard begins at the star system, not at Basics.

### Known limits

- (Plates slid along the grid at first, which smeared them near the poles. They now turn about
  a point on the globe: see "Drift on the globe" below.)
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

## Release 2, as built (2026-11-28)

The star system, the calendar and rivers. Again no server change.

- **Star system** is the first part of the wizard (`pages/world/SystemPart.tsx`,
  `world/system.ts`): the star's kind, a second star, planets (kind, distance on a slider that
  multiplies, which one is the world, remove, add), the world's moons, and "Keep it able to hold
  life / Ignore that". The system is drawn from above with the band where water stays liquid.
  **Roll a system** puts the world on the warm side of the band, where Earth is.
- **What it sets.** The year (Kepler's third law, in the world's own days), the months (each
  moon's time round, the nearest first), and the warmth the climate starts from: by the world's
  place in the band, 0 where Earth is, warmer nearer the star and colder further out. Basics and
  Climate say so. With the rule ignored the climate starts from Earth's own warmth.
- **Rivers** (`world/rivers.ts`): every cell of land drains to its lowest way out, hollows filled
  first as lakes fill; the rain is added up down each way and the ways that carry most are rivers,
  each ending at the sea or on the larger river it joins. A drier world has fewer. They are drawn
  over the Climate and Biomes views.
- **Make it now also makes**: the rivers as smooth paths in a Rivers layer of the globe map, in
  the library's River style (added when missing); a **system model** named "<name> system", with
  the star, a companion, the planets and the moons, the world marked as home and opening the globe
  map; and an entry, **"The sky and the calendar of <name>"**, with the day, the year, the months
  and the seasons, as an unsaved new entry. An entry of that name from an earlier world is left
  alone.

### Differences from the design

- **The calendar is an entry, not a calendar object.** The proposal said the calendar would
  become one of the chronicle's calendars. Chronicles as built count years on named clocks and
  hold no days or months, so there is nothing of that kind to fill. The numbers are written as an
  entry the author can name and change.
- **Rivers, not lakes.** Hollows are filled so rivers run through them, but no lake is drawn.
- **Rivers are the wizard's own**, not Find paths': that tool reads a map's picture on a flat
  grid, and the wizard already has the heights and the rain on the globe.
- A river follows the grid's eight directions before it is smoothed, so long straight reaches
  show at one degree a cell.

### Tests added

`world/system.test.ts` (Earth's year, month and warmth from an Earth-like system; too near and too
far; the band by the star's light; one rocky world; rolled worlds lie in the band; the calendar
entry; all land drains to the sea; rivers end at the sea or on a river; a drier world has fewer;
a course is cut at 180°), `world/zones.test.ts` (rivers in their layer and style; the system model
is one Frontier accepts, with the world as home), and `e2e/world.spec.ts` (the star system part;
the system model and the calendar entry are made).

## Release 3, as built (2026-11-28)

Life and lore, the second to last part of the wizard, and the World brief.

- **Places are found without the AI** (`world/lore.ts`): the highest ground, the mouth of the
  greatest river, a sheltered well-watered coast, the wettest forest, the driest basin, cold open
  country by the ice. Fewer on a world that lacks them, none within eight degrees of another. Each
  is a numbered pin on the view and is named for what it is ("The highest range") with a line of
  its climate, until the AI names it.
- **Suggest names and entries** asks the AI once (`POST /api/world/lore`, writers and owners,
  the model chosen for lore conversations, the person's own key). It is told the world in plain
  lines (star, year, moons, tilt, size, land, biomes), the places by key with their climate, how
  many sapient species, how much magic, the present age, and what the author says he already
  knows. It answers a name and one to three paragraphs for each place, each species (with the
  place it arose at) and three to five entries about other life.
- **The answer is checked** (`ai/worldLore.ts`): a place only for a key that was sent, once; no
  more species than asked for; a cradle that is no place is dropped; names are made fit for a
  file name, distinct, and never one to avoid; prose loses headings, links, pictures and tags.
  Nothing is saved by the call.
- **Everything is the author's to change**: each item has a tick and a name that can be typed
  over. When the world changes after suggestions were made, the page says so and offers **Find
  the places again**; places the AI has not written about are found again by themselves.
- **Make it now also makes**: an entry for each ticked item, in `Places/`, `Peoples/` or `Life/`,
  with its type; a marker on the globe map for each place and a homeland (a ring nine degrees
  wide, in a Peoples layer) for each species that arose at a place, each tied to its entry; and
  the **World brief**, "<name> world brief": the world's numbers, the seed, the magic and the age,
  what the author said he knows, and links to the entries kept. The brief is written by the
  wizard, not the AI.
- An entry that already exists at a path is never written over; its item is then left off the map
  too.

### Differences from the design

- **One AI call, not an outline and then a writing step.** Names and prose come together, and the
  author ticks afterwards. It is cheaper and there is nothing to keep a tab open for.
- **A homeland is a plain ring** round the place a species arose at, not the outline of its biome.
- "Suggest more" is "Suggest again": it replaces what was suggested, keeping the ticks on places.

### Tests added

`apps/server/test/worldLore.test.ts` (what is kept and dropped of an answer; the route asks once
and saves nothing; a bad request and an empty answer are refused), `world/lore.test.ts` (places
found on land and apart; none on a world of sea; the stamp that marks a world; items after an
answer; the request; entries by folder; the World brief; the homeland ring), and
`e2e/world.spec.ts` (places without the AI, suggestions with it, a name typed over, an item left
out, and Make it writing the entry, its marker and the brief).

## After the three releases (2026-11-28)

### The AI is told whose world it writes about

Every AI feature's instructions said "his fictional world, Avalymia" and carried Avalymia's rule
about the Nirani, in every project. Now the instructions name the world and its rules through two
marks, filled in for the project of the request (`apps/server/src/ai/worldVoice.ts`):

- A project says what its world is in its **World brief**: an entry whose `type` is
  `world-brief`. Its `world` field is the world's name; each bullet under its **Rules** heading
  is told to the AI whenever it writes for the project ("The world's rules matter: …"), up to
  twelve. The wizard's brief now has both: its Rules begin with the magic and the present age
  chosen in Life and lore, and the author adds his own, one to a line.
- Only the saved brief is read, never one in quarantine. A mark typed into a rule is taken out.
- With no brief the world goes by the project's name and has no rules. The one exception is a
  project named Avalymia, which keeps the rule it has always been given until it has a brief of
  its own; with a brief, the brief's rules are the rules.
- It is done where a project gets its AI provider (`projects/services.ts`), so lore, writing
  help, Consult, drafting, characters, discovery and keep-going all follow without each knowing.

### The height model, reworked

Printing what the wizard sends the AI showed coasts at 800 m and peaks pinned at 9,000 m. Now:

- Land begins as lowland (a few hundred metres); the drift raises the rest. Half the land of a
  rolled world lies under about 400 m, and peaks come out between 3,000 and 7,700 m.
- Land and sea floor are softened apart, so the shore stays where the crust says it is: land
  drawn by hand is land, and the share of land asked for is the share there is. Only the sea
  level moves the shore.
- Ground is rougher the higher it is. Ranges grow more slowly and stop lower. Plates roll at 1 to
  5 cm a year, so less land is lost to collisions (32% falls to between 19% and 31% over 60
  million years, by seed).
- A place by the sea is described to the AI as "low ground by the sea", not by its cell's height;
  where it freezes, what falls is called snow; the sheltered coast is looked for on low ground.

### The lore instructions, after a real model

The instructions were tried twice on a small model with a made-up world. The first answer was
usable in form but borrowed names from myths and real languages, named Earth's animals and
plants, put dunes in a rock desert, praised everything and ignored what the author said he knew.
The instructions (version 2) now ask for invented names that belong together, the world's own
life, plain gazetteer prose, no fact contradicted, each thing the author knows worked into the
entry it fits, and a different cradle for each species. The second answer followed most of that;
it still repeated some numbers. A stronger model than the one tried should do better.

### Drift on the globe

Plates used to slide along the grid by whole cells, east-west and north-south. Near a pole,
where a row of cells is a few kilometres long, that smeared a plate along the edge of the flat
view. Now:

- **Each plate turns about its own point on the globe**, so it follows a great circle. The point
  is the one that sends the plate's middle the way its compass direction says, found when the
  drift is set and found again when the direction is changed.
- **Each plate carries its own crust**, on a grid of its own that never changes, and is shown
  turned by all it has turned so far. The first attempt redrew the crust onto the world's grid at
  every step, and any movement smaller than a cell was rounded away: the part of a plate near its
  turning point never moved and the plate tore. Carried whole, a land that goes past the pole
  arrives on the far side with every cell it began with.
- **Where plates meet**, the crust that goes under is taken off its own plate. Of two lands the
  same plate always rides over the other, so the one under is used up from its edge inward.
  (Deciding cell by cell, by height, left both lands combed with slits.)
- **Back to the start** puts the plates back where they lay, not only the land.
- **Painting a plate's area** is done on the plates as they lie at the start; after a drift the
  wizard asks before it starts the drift again.
- A step takes about 40 ms. The plates' own crust is kept with a world in progress (a few
  megabytes on the device).

### Smaller things

- Make it says which entries it left alone because the library already had one of that name.

## Left for later

Lakes; then other shapes (a disc, a cylinder like Derdama), ocean currents, resources, naming languages,
history played forward on time-aware maps.
