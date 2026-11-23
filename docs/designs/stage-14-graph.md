# Stage 14: the graph

- **Author:** Elad Haviv
- **Status:** Draft (2026-11-23), not yet reviewed
- **Date:** 2026-11-23
- **Parent:** [Stage 11](stage-11-foundations-shell-tree.md), which provides the shared pieces this stage
  uses: icons, tooltips, the combobox, the keys registry, the shell with its left-bar places and right-bar
  panels (`usePanel`), and, from release 11c, the folder file with its colours.
  [Stage 12](stage-12-entries-editor.md) provides the entry page's side-bar tabs and `openPanel`.
  [Stage 13](stage-13-maps.md) (13b) splits `HoverPreview` into `usePreviewText` and `PreviewCard`,
  which this stage reuses. Comes from [`concepts_brief.md`](../../concepts_brief.md) (stage 14, the
  "Further risks" on offline links, and Alternatives Weighed) and the author's list of 2026-11-22 in
  [`BACKLOG.md`](../BACKLOG.md). The master design's non-goal "the graph view … is not rebuilt" was
  reversed by the author on 2026-11-22; the dated note is in [frontier.md](frontier.md#non-goals).

---

## Overview

Frontier is a single-author web app for writing the world of Avalymia as a library of Markdown entries.
Terms (draft, unpublished, rename intent, folder file) are as in
[Stage 11, Terms](stage-11-foundations-shell-tree.md#terms). The author asked for "a screen where I can
see the graph like in Obsidian". His answers: the nodes are entries; the graph is for looking and going
to other entries, never for editing; and a local graph, one entry with its neighbours, is wanted too.

Stage 14 ships in two releases:

- **14a, the graph screen.** One `GET /api/graph` built from the server's link index; a `/graph` screen,
  reached from the left side bar's places, drawing every entry as a dot coloured by its folder and every
  link as a line; hover, select, open; a list of entries as the keyboard way in; touch.
- **14b, the local graph and filters.** A "Graph" tab in the right side bar of every entry page, showing
  the entry and its neighbours with the same drawing code; the full Filters panel (types, orphans,
  top-level notes, search) remembered on the device; depth 2.

The graph works online in this stage. Stage 15 caches the same response so it works offline.

## The Problem

- **The library's shape is invisible.** About 430 entries link to each other, but Frontier shows links
  only one entry at a time: its links in the text and its backlinks below. The author cannot see which
  places gather many people, which entries stand alone, or how one folder ties into another.
- **Obsidian has the view; Frontier does not.** The author reads the exported copy in Obsidian to see the
  graph, which means leaving Frontier and an export that may be out of date.
- **Moving between related entries takes many steps.** From an entry, reaching an entry two links away
  means opening a link, scrolling for the next, and opening that.

## Goals

- **G1.** One `GET /api/graph` returns every entry as a compact node (path, title, folder, type, link
  count, whether unpublished, whether in the appendices, whether at the top level) and every link between
  two entries as an edge (from, to, count), built from the server's link index with the author's drafts
  on top. It carries an `ETag`; an unchanged graph answers 304.
- **G2.** A `/graph` screen, a place in the left side bar (and the rail), draws the graph on a canvas:
  node size by link count, colour by the folder file's colour, labels by zoom level and on hover, pan,
  zoom and dragging a node.
- **G3.** Hovering a node (mouse) highlights it and its neighbours and, after a pause, shows the
  entry's preview card. Clicking selects; the selection shows the entry's name, folder, type and its
  links out and in. Double-click, Enter or "Open" opens the entry.
- **G4.** Everything can be done from the keyboard: a find field that selects and centres a node; an
  Entries list in the right side bar that lists the shown nodes; arrow keys move the selection to the
  neighbour in that direction; Enter opens; Esc clears.
- **G5.** On touch: a tap selects, a second tap on the selected node opens it, pinch zooms, one finger
  pans, and a selected node can be dragged.
- **G6.** By default the graph leaves out the appendices folder, notes at the top level (`README.md`,
  `AGENTS.md`), and never shows unresolved or ambiguous links, images or other files. Filters by folder
  (14a) and by type, orphans, top-level notes and a search (14b) change what is shown. The filters are
  remembered on the device (14b).
- **G7.** The layout runs off the main thread, settles in under 2 seconds for 500 nodes on a phone, and
  panning keeps 60 frames a second. A device keeps its positions between visits, so the graph does not
  rearrange itself each time. With reduced motion asked for, nothing animates.
- **G8.** Every entry page has a "Graph" tab (14b) with the entry and its neighbours (depth 1, or 2 by a
  switch), drawn by the same code, small, with the same hover, select and open.
- **G9.** No regressions; first-load JavaScript grows by at most 2 KB (the graph code loads only when
  needed);
  the browser tests cover each journey below.

## Non-Goals

- Editing in the graph: no making links, renaming, moving or deleting from it (the author's answer).
- Nodes for things that are not entries: images, maps, chronicles, unresolved link targets ("ghost"
  nodes in Obsidian), tags. Unresolved links are counted on the Status page as today.
- Obsidian's canvas, groups, and graph "forces" settings for the author to tune. The forces are fixed
  in code.
- A 3D graph, a time slider, or saving a named view.
- Working offline. In this stage the graph needs a connection; stage 15 caches it (see Technical Plan
  §9).

## Decisions

| Decision | Date | Source |
| --- | --- | --- |
| Nodes are entries; no editing in the graph | 2026-11-23 | author |
| A local graph as a right-side-bar tab on entry pages | 2026-11-23 | author, brief |
| One `/api/graph` from the server's link index; the local graph is the same data filtered | 2026-11-22 | brief, Alternatives Weighed |
| Drafts are laid over the published links (new, changed, deleted, moved entries) | 2026-11-23 | this design: the tree and the entry page already show drafts on top, and a link just written should show in the local graph |
| Canvas, not SVG; layout in a Web Worker | 2026-11-23 | this design: ~430 nodes and a few thousand lines |
| `d3-force` for the layout; pan, zoom and pinch written by hand as in `MapPage` | 2026-11-23 | this design (Alternatives C and D) |
| Colour by the folder file's colour; a folder without one is drawn in the neutral ink | 2026-11-23 | brief; the fallback is open question 1 |
| Appendices and top-level notes hidden by default; orphans shown | 2026-11-23 | this design; orphans are open question 2 |
| Select first, then open | 2026-11-22 | brief; matches stage 13's maps |
| `/graph` is a main place in the left side bar | 2026-11-23 | this design: the author asked for "a screen" |

## Open Questions for the Author

1. **Folders without a colour.** This design draws them in the neutral ink, so only the folders he has
   coloured stand out. The other choice is an automatic colour per top-level folder from the same 8,
   which colours everything at once but can repeat a colour he chose for another folder.
2. **Orphans.** Entries with no links are shown by default, as in Obsidian, so entries still to be linked
   are visible. If there are many in the real library, "Hide orphans" could start ticked instead.

## Critical User Journeys (CUJs)

### CUJ 1: See the whole library and go to an entry

- **Covers:** G1, G2, G3, G7.
- **Given**: the library with about 430 entries; on desktop.
- **When**: he chooses "Graph" in the left side bar, waits, scrolls to zoom in on a cluster, hovers a
  large dot, then clicks it and presses Enter.
- **Then**: the dots spread and come to rest in under 2 seconds; places are one colour, people another.
  Zooming in brings up names. Hovering "Harbor" dims everything but Harbor and its neighbours and, after a
  moment, shows Harbor's opening in a card. The click selects it; the side bar's "Selected" tab shows
  Harbor, its folder `01 Places/Harbor` with its colour, its type, and its links out and in. Enter opens
  `/e/01 Places/Harbor/Harbor.md`.
  Back returns to the graph with Harbor still selected and the view where it was.

### CUJ 2: Find an entry with the keyboard

- **Covers:** G4.
- **When**: on `/graph` he presses "/", types "quay", presses Enter; then presses the right arrow twice,
  then Enter.
- **Then**: the find field listed "Old Quay"; Enter selected it and centred it. Each arrow moved the
  selection to the neighbour lying most nearly to the right, announced with its name, folder and link
  counts. Enter opened the selected entry. The Entries tab lists the same entries in name order, and
  Up, Down and Enter work there too.

### CUJ 3: Narrow it down

- **Covers:** G6.
- **When**: he opens Filters, unticks "03 Things", ticks "Show appendices"; later (14b) picks only the type
  "person" and ticks "Hide orphans", then reloads.
- **Then**: the things vanish with their lines; "Session" in the appendices appears, linked to Harbor and
  Old Quay; with only people and no orphans, only people linked to other people remain. After the reload the same filters are
  in force, and "Reset filters" brings back the defaults.

### CUJ 4: An entry's neighbours

- **Covers:** G8.
- **When**: on Mira's page he opens the "Graph" tab, hovers "Harbor", taps "Depth 2", then double-clicks
  "Old Quay".
- **Then**: the tab showed Mira in the middle, ringed, with Harbor, Old Quay, Shade and Ledger around her;
  depth 2 added Harbor's and Old Quay's neighbours; the double-click opened Old Quay, whose Graph tab is
  open with Old Quay in the middle. "Open in full graph" goes to `/graph?focus=…` with the entry selected.

### CUJ 5: On a phone

- **Covers:** G5, G7.
- **When**: he opens the drawer, chooses Graph, pinches to zoom, drags with one finger, taps a dot, then
  taps it again.
- **Then**: the graph settled in under 2 seconds; pinching zoomed around his fingers; the drag panned. The
  first tap selected the dot and showed a card at the bottom with its name, folder and "Open"; the second
  tap opened the entry. A drag that starts on the selected dot moves it.

### CUJ 6: A link just written

- **Covers:** G1, G8.
- **When**: in the editor he adds `[[Lantern]]` to Mira, then opens Mira's page and its Graph tab; then
  creates a new entry "Gull" in `02 People` linking to Mira.
- **Then**: Lantern is among Mira's neighbours before any version is saved. Gull appears, marked
  unpublished (a dashed ring), linked to Mira.

## Technical Plan (Architecture)

### 1. The data: `GET /api/graph` (14a)

**Built from the index.** `VaultIndex` already holds every note's links with their resolution
(`note`, `file`, `unresolved`, `ambiguous`, `outside`) and builds the backlink map from them. The graph
uses the same links:

- **A node** for every note in `allNotes()` (Markdown outside the excluded folders), with the drafts laid
  over them (below). Images and other files never become nodes.
- **An edge** for every link whose resolution is `note`, to a different note: `from → to`, counted, so
  four links from Old Quay to Harbor (with or without a heading or a label) are one edge of count 4.
  `unresolved`, `ambiguous`, `outside` and `file` links make no edge. Links in the front matter (the
  `time` field's dates) count, as they do for backlinks.
- **The link count** of a node is the number of distinct entries it links to or is linked from, after
  the overlay; repeated links do not make a node bigger.

**Drafts on top.** The author's view everywhere else (the tree, the entry page, the switcher) is
"published, with my drafts on top", and the local graph is most useful right after writing a link. So:

- an `edit` or `create` draft of a note replaces (or adds) that note's links with the draft text's,
  resolved through `index.analyse(path, text, added, removed)`, the call the entry page uses;
- a `create` draft adds a node with `unpublished: true`; an `edit` draft marks its node unpublished;
- a `delete` draft removes the node and every edge to or from it;
- when drafts add notes, the published notes' `unresolved` and `ambiguous` links are resolved again
  against the overlay's file list (a few hundred lookups), so a link to a new entry shows;
- a rename intent keeps the node's `path` (the path that opens the entry until a version is saved, as in
  the 11c tree) and gives it the moved `title` and `folder`, through `movedPath` from
  `publish/publish.ts`, marked unpublished.

`VaultIndex` gains `resolverFor(added, removed)`, which `analyse` already builds inline, memoised on the
two lists so one graph build makes one resolver.

**Shape.** Compact, because the real library has ~430 nodes and a few thousand edges, and stage 15 keeps
it on the device:

```ts
GraphResponse = {
  version: string; // the same value as the ETag, without quotes
  nodes: {
    path: string; // opens the entry: /e/<path>
    title: string; // the file name without .md (the moved name for a pending rename)
    folder: string; // "01 Places/Harbor"; "" at the top level
    type: string | null; // field `type`, else the folder's type, as the entry page decides
    links: number; // distinct neighbours
    aliases?: string[]; // only when there are some; the find field searches them
    unpublished?: true;
    appendix?: true; // under 99 Appendices
  }[];
  edges: [from: number, to: number, count: number][]; // indexes into nodes
  folders: { path: string; color: FolderColor }[]; // only folders with a colour, from the folder file
};
```

Nodes are sorted by path, so indexes are stable for one version. Edges as index triples keep the body
near 60 KB for the real library (about 15 KB gzipped), against several hundred KB with paths repeated.
The server sends everything, appendices included, and the browser filters: one response serves the
global graph, every local graph and stage 15's cache.

**Cached by version.** The route keeps the last build in memory with its key: the index's `commit`, every
draft's `id:revision:kind:path`, every rename intent's id, and the folder file's revision. The key is
cheap to compute (drafts are few). When it matches, the stored JSON is sent; otherwise the graph is
rebuilt (a few milliseconds at 430 notes, measured in the server test). The `ETag` is a short hash of
the key; `Cache-Control: private, no-cache` makes the browser revalidate each time, so `fetch` gets the
stored body back on a 304 without any code in the web app. The server gzips the stored JSON once per
version when the request accepts it (`node:zlib`; no new dependency).

**Folder colours.** From the 11c folder store (`apps/server/src/folders/store.ts`), draft first, then
library, the same read `/api/tree` uses. If 14a is built before 11c is merged, `folders` is empty and
every node takes the fallback; nothing else changes.

### 2. The browser model and filters (14a, 14b)

`graph/model.ts` turns the response into a `GraphModel`: nodes by index and by path, neighbours as
arrays (in, out and both), and each node's top-level folder. Pure functions, unit tested:

- `filterGraph(model, filters)` returns the shown node indexes and edges. A node is shown when its
  top-level folder is ticked, its type is ticked (14b), it is not in the appendices unless "Show
  appendices", and not at the top level unless "Show top-level notes" (14b). An edge is shown when both
  ends are. "Hide orphans" (14b) then drops nodes with no shown edge, so an entry linked only to hidden
  entries counts as an orphan.
- `neighbourhood(model, path, depth, filters)` for the local graph: the centre, always shown whatever the
  filters say, and the entries within `depth` links either way, with every edge among them (as Obsidian
  does), respecting only "Show appendices".
- Search (14b) does not hide: nodes whose title or alias contains the text are drawn full, the rest dimmed.

**Defaults:** every folder and type ticked; appendices hidden; top-level notes hidden; orphans shown;
no search. Filters are kept in `localStorage` key `frontier.graph.filters` (14b), read with a fallback to
the defaults, as the shell's settings are. A folder that no longer exists is ignored; a new folder starts
ticked.

### 3. Layout (14a)

- **`d3-force` in a Web Worker.** At 500 nodes and ~3,000 edges each tick costs a few milliseconds on a
  desktop and several times that on a phone; 150 to 300 ticks on the main thread would stall scrolling
  and input. The worker (`graph/layout.worker.ts`) owns the simulation; the page owns drawing and input.
  Vite bundles `new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" })` as a
  separate same-origin file, which the existing `script-src 'self'` policy allows (no blob workers).
- **Forces:** `forceLink` (distance 40, d3's default strength of 1 / smaller degree), `forceManyBody`
  (strength -60, `theta` 0.9, `distanceMax` 400), weak `forceX` and `forceY` (0.05) so orphans and small
  clusters stay near the middle, and `forceCollide` (node radius + 2). `alphaDecay` is set so a cold
  start ends in at most 200 ticks; `velocityDecay` 0.4. The forces are written once in `graph/layout.ts`,
  which the worker imports and the tests run directly in Node.
- **Messages:** page → worker `init { nodes: { r, x?, y?, fixed? }[], links: [s, t][], warm, reduced }`,
  `drag { i, x, y }`, `release { i }`, `stop`; worker → page `tick { positions }` (a `Float32Array`,
  transferred, at most one per animation frame) and `settled { positions, ticks, ms }`.
- **Same positions each visit.** On `settled`, the page stores positions in `localStorage` key
  `frontier.graph.positions` as `{ [path]: [x, y] }` (about 20 KB), written in a `try` so a full or
  blocked storage only loses the convenience. On the next visit, nodes with a stored position start
  there and the simulation starts warm (`alpha` 0.3, about 60 ticks), so little moves. A new node starts
  beside its first stored neighbour, offset by a hash of its path; with nothing stored, d3's
  phyllotaxis start and its fixed random source make the layout the same on every device. Filters change
  the node set, so each filter change starts a warm layout from the stored positions.
- **The local graph** uses the same worker, but does not store positions: it is small, starts with the
  centre fixed at the middle and settles in a few dozen ticks.
- **Reduced motion.** With `prefers-reduced-motion: reduce`, the worker runs every tick at once and sends
  only `settled`; a drag moves the dragged node alone, and the neighbours settle without being drawn in
  between. The page shows "Arranging…" until then.
- **No worker** (blocked or failed to start): the same `layout.ts` runs on the main thread in slices of
  8 ms per frame. The budgets in §8 apply to the worker path.

### 4. Drawing (14a)

- **Canvas.** One `<canvas>`, sized to its box at `devicePixelRatio`, redrawn only when something changed
  (positions, view, hover, selection, theme), at most once a frame. Order: edges as one path in the faint
  line colour; highlighted edges; nodes in one path per colour; rings for the selected, centre and
  unpublished (dashed) nodes; labels. SVG would make 3,500 DOM elements to move every tick.
- **Size:** radius `3 + 1.6 × √links` CSS pixels, at most 14, scaled with zoom but never below 2 on screen.
- **Colour:** the colour of the node's folder or its nearest ancestor with one in `folders`, using the
  light or dark value of that named colour from `FOLDER_COLORS` (stage 11, item 75) as the page's theme
  is. A node with no coloured folder is drawn in `--ink-faint`. The theme's colours are read from CSS
  custom properties at start and when `prefers-color-scheme` changes. Each of the 8 colours meets 5.4:1
  against both page colours, so dots stay visible.
- **Labels:** in the UI font at 12 CSS pixels, not scaled with zoom, below the node, with a halo in the
  page colour. Shown for the hovered and selected nodes and their neighbours always; for the 12 nodes
  with most links at any zoom; and for every node once the zoom is 1.4 or more. Labels are placed largest
  node first and one that would overlap a placed label is skipped (a coarse grid of placed boxes), and
  nodes outside the view are skipped.
- **Highlight:** while a node is hovered or selected, other nodes and edges are drawn at 20% opacity.

### 5. Gestures and view (14a)

`graph/gestures.ts` follows `MapPage`'s pointer model (a map of active pointers, a pinch from two), so the
app has one way of handling touch:

- **Mouse:** drag on empty space pans; the wheel zooms around the pointer (0.2× to 6×); a press on a node
  and a move of more than 4 px drags the node (`drag`, then `release` on lift, which frees it); a click
  selects; a double-click opens.
- **Touch:** one finger on empty space pans; two pinch, zooming around their middle; a tap selects; a tap
  on the selected node opens it; a drag that starts on the selected node moves it, and on any other node
  pans, as stage 13 does for zones.
- **Hit-testing:** a `d3-quadtree` of the current positions, rebuilt when positions arrive; the nearest
  node within its radius plus 4 px (12 px on touch).
- **View:** `{ x, y, k }`. "Fit" (a button and the "0" key) fits the shown nodes. On the screen, the view
  and selection are kept in `sessionStorage` key `frontier.graph.view`, and the selection in the address
  as `?focus=<path>` (replaced, not pushed), so Back from an opened entry returns to the same picture.

### 6. Interaction (14a)

- **Hover (mouse only, by `pointerType`, as stage 13):** the node and its neighbours highlight at once;
  after 350 ms a `PreviewCard` with the entry's name and opening (`usePreviewText(path)`, the shared
  cache and `api.preview`) appears beside the node, kept inside the canvas, with `pointer-events: none`.
  An unpublished new entry has no published text, so the card shows its name and "Not yet published".
  The card closes on a press, a wheel, a pan or leaving the canvas.
- **Selection:** on the screen, the right side bar's "Selected" tab shows the name, folder (with its
  colour), type, "Open", and two lists, "Links out" and "Links in", each entry a button that selects and
  centres it. On desktop, selecting switches the side bar to this tab when the side bar is open; it never
  opens it. A small card at the bottom of the canvas shows the name, folder and "Open" on every size; on a
  phone it is the only one, with "Details" opening the bottom sheet at the Selected tab.
- **Open:** double-click, Enter, a second tap, or "Open" goes to `/e/<path>`.
- **Accessibility:** the canvas is focusable with `role="application"` and an `aria-label` ("Graph of
  312 entries and 1,204 links. The Entries tab lists them."). A polite live region announces the selected
  entry ("Harbor, 01 Places, 2 links out, 6 in"). The Entries tab is the full alternative: a listbox of
  the shown entries in name order (name, folder, link count), with its own filter field; Up and Down move,
  Enter selects and centres, a second Enter opens.

**Keys.** A new scope `graph` (between `map` and `editor` in `SCOPES`, named "Graph"), active while the
canvas or its controls have focus, so the "?" sheet lists them:

| id | keys | label |
| --- | --- | --- |
| `graph.find` | `/` | Find an entry in the graph |
| `graph.left`, `graph.right`, `graph.up`, `graph.down` | arrows | Select the neighbour in that direction |
| `graph.open` | `Enter` | Open the selected entry |
| `graph.clear` | `Escape` | Clear the selection |
| `graph.zoomIn`, `graph.zoomOut` | `=`, `-` | Zoom in, out |
| `graph.fit` | `0` | Fit the graph |

An arrow chooses, among the selected node's shown neighbours, the one whose direction on screen is
within 60° of the arrow's and nearest; with none, the nearest shown node in that direction; with no
selection, the node nearest the middle. The view pans to keep it in sight. The find field is the stage 11
`Combobox` over the shown nodes' titles and aliases; choosing one selects and centres it.

### 7. Where it lives (14a, 14b)

- **The screen:** route `/graph` (lazy, `React.lazy`), a place in `PLACES` after Chronicles, with the
  lucide `Waypoints` icon, so it is in the left side bar, the rail and the phone's drawer. The shell gains
  the screen kind `graph`, which, like maps, starts with the left bar folded to its rail. The right side
  bar's panels: Selected, Entries, Filters. On a phone, the slim line shows "Graph" and a Filters button.
  The find field and Fit sit over the canvas's top-left corner.
- **The local graph (14b):** `EntryPage` registers `usePanel({ id: "graph", title: "Graph", icon:
  Waypoints, render })`. The panel is a lazy component, so an entry page that never opens it loads none of
  the graph code. It holds a square canvas the width of the side bar (or the bottom sheet), a "Depth 1 |
  2" pair (`aria-pressed`, remembered as `frontier.graph.depth`), "Show appendices", "Open in full graph"
  (`/graph?focus=<path>`), and the selection card. The centre is ringed and fixed in the middle. Hover,
  select, open and the keys are the same; opening an entry from the panel keeps the Graph tab open on the
  next page, because the shell remembers the open tab per screen kind. The editor page does not get the
  tab: the author reads links, he does not navigate, while writing.
- **Loading:** the graph is fetched when the screen or tab opens, through `api.graph()`; the model is kept
  in a module variable for the visit, so the tab moving from entry to entry does not fetch again unless
  the version may have changed (on a save or a "Save a version", which the status stream already
  reports, it is fetched again and a 304 costs nothing).

### 8. Performance budgets (14a)

| Budget | How it is checked |
| --- | --- |
| Layout settles in under 2 s for 500 nodes and 3,000 edges, cold, on a phone | `graph.spec.ts` in the phone project, with CPU throttled 4× through the DevTools protocol, serves a generated graph of that size (fixed seed) by `page.route("/api/graph")` and reads the canvas's `data-settle-ms`, set on `settled` |
| Under 300 ms warm (stored positions) | the same test, second visit |
| Panning at 60 fps: each frame drawn in under 8 ms | the same test pans for one second with the mouse API and reads `data-draw-ms` (the slowest frame of the last second), under 4× throttling |
| The layout ends in at most 200 ticks | `layout.test.ts`, on the same generated graph, in Node |
| `/api/graph` builds in under 50 ms for 500 notes | `graph.test.ts` on a generated library of that size |
| First-load JavaScript unchanged | the build output; `d3-force` and the graph code are in lazy chunks |
| On a real iPhone with the real library | by hand, after each release |

`data-settle-ms` and `data-draw-ms` are written on the canvas element in every build; they cost nothing.
If the phone misses 2 s, the levers are, in order: fewer ticks (150), `theta` 1.2, and drawing the first
frames from stored positions only.

### 9. Offline (stage 15)

In this stage the graph needs a connection. Offline, the screen and the tab show the shared `Problem`
with "The graph needs a connection" and Retry, unless the model is already held from earlier in the
visit, in which case it is shown as it was. Stage 15 keeps the latest `/api/graph` response on the
device with its version, so the graph works offline from the cached index, as the brief's "Further
risks" ask. The response is designed for that: it holds only what the compact offline index holds
(paths, names, folders, types and links), so stage 15 may instead build it on the device from that index
with the same `GraphResponse` shape. Drafts made offline then show in the graph only when stage 15's
index carries them; that is stage 15's to decide.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The layout is slow on a phone | Worker, Barnes–Hut with `theta` 0.9, a 200-tick cap, warm starts from stored positions; measured in the phone test with throttling and by hand on an iPhone (§8) |
| A hairball: 430 nodes in one mass | Filters, appendices and top-level notes hidden by default, highlight on hover and selection, labels by zoom, search dimming (14b) |
| The layout changes each visit and the author loses his bearings | Stored positions per device, warm starts, a fixed random source |
| A canvas is invisible to screen readers and the keyboard | The Entries list, the find field, arrow keys among neighbours, a live region (§6) |
| The graph shows a link the published library does not have | Unpublished nodes are ringed (dashed); the Selected tab says "Unpublished" |
| The graph lags the library | `ETag` per version; fetched again after saves; a 304 is cheap |
| Gestures fight: pan, drag a node, select | Drag a node only from a press on it (mouse) or on the selected node (touch); one pointer model shared with maps |
| A worker blocked by the page's security policy | Same-origin worker file, allowed by `script-src 'self'`; a main-thread fallback |
| Storage full or blocked | Positions and filters are conveniences, written in `try`, with defaults when missing |
| 14a lands before 11c's folder file | `folders` empty, every node neutral; no other change |
| The bundle grows | All graph code and `d3-force` are in lazy chunks; the first-load size is checked |

## Alternatives Considered

### Alternative A: Build the graph in the browser from every entry's text

- **Cons**: Needs every entry's text on the device; repeats the server's link resolution.
- **Reason for Rejection**: Rejected in the brief; the server's index already resolves every link.

### Alternative B: Published links only

- **Pros**: Simpler cache key (the commit); same graph as the export.
- **Cons**: A link just written, or a new entry, is missing until a version is saved; the tree and the
  entry page already show drafts.
- **Reason for Rejection**: The overlay costs a few lookups per draft and the result is marked.

### Alternative C: SVG, or a WebGL library (Sigma.js, Cosmos)

- **Pros**: SVG gives DOM events and accessibility per node; WebGL scales to tens of thousands.
- **Cons**: SVG must move ~3,500 elements each tick; WebGL libraries are large and bring their own layout
  and input, unlike the rest of the app.
- **Reason for Rejection**: A 2D canvas draws 500 nodes and 3,000 lines well within a frame; accessibility
  comes from the Entries list.

### Alternative D: `d3-zoom` for pan and zoom

- **Pros**: Tested, well-known gestures.
- **Cons**: Brings `d3-selection`, `d3-transition`, `d3-drag` and `d3-interpolate`; its gesture model
  differs from the maps' select-then-drag rule.
- **Reason for Rejection**: `MapPage` already handles pan, wheel and pinch by hand; the graph follows it.

### Alternative E: Layout on the server, positions in the response

- **Pros**: No work on the phone.
- **Cons**: Positions would depend on the filters, and dragging would need a round trip; offline needs the
  layout on the device anyway.
- **Reason for Rejection**: A worker on the device meets the budget.

### Alternative F: The local graph as a separate request (`/api/graph?path=&depth=`)

- **Pros**: Smaller answers.
- **Cons**: A second route and cache, and no offline answer without the whole graph.
- **Reason for Rejection**: The brief: the local graph is the same view filtered; the whole graph is
  ~15 KB gzipped.

### Alternative G: Nodes for unresolved links, as Obsidian does

- **Pros**: Shows entries still to be written.
- **Reason for Rejection**: Mixes things that are not entries with entries (the author's "nodes are
  entries"); unresolved links are already listed on the Status page.

### Alternative H: Graph in the app menu, not a main place

- **Reason for Rejection**: The author asked for a screen; it is a way of navigating, like Maps.

---

## Detailed Implementation Plan

Two releases. Each must pass the Verification Plan before it is merged and deployed.

### Release 14a: the graph screen

1. `packages/schema/src/graph.ts` (Create): `GraphNode`, `GraphResponse` (§1), using `FolderColor` from
   `folders.ts` (11c). `packages/schema/src/index.ts` (Modify): export it.
   `packages/schema/test/schemas.test.ts` (Modify): a response parses; an edge with a bad index does not.
2. `apps/server/src/index/build.ts` (Modify): `resolverFor(added, removed)`, memoised on the two lists;
   `analyse` uses it.
3. `apps/server/src/index/graph.ts` (Create): `buildGraph({ index, drafts, texts, renames, folders })`,
   pure, returning `GraphResponse` (§1); `graphKey(...)`.
4. `apps/server/src/routes/graph.ts` (Create): `GET /api/graph` with the memo, `ETag`, 304,
   `Cache-Control: private, no-cache` and gzip. `apps/server/src/app.ts` (Modify): registers it.
5. `apps/server/test/graph.test.ts` (Create), on the fixture library (`packages/vault/test/fixture-vault`,
   through `test/helpers/repo.ts`):
   - nodes are the notes only: no `Lamp.png`, `notes.json` or `.obsidian/Hidden.md`; `README.md` and
     `AGENTS.md` are at the top level; `99 Appendices/Logs/Session.md` is marked `appendix`;
   - Old Quay → Harbor is one edge whose count is the number of its links that resolve to Harbor
     (headings, labels and the Markdown link included); Mira → Harbor counts its three spellings;
   - no edge from Lantern's ambiguous `[[Twin]]`, Unwritten's unresolved links, Gallery's images, Mira's
     `[[.obsidian/app.json]]` and `[[notes.json]]`, or Old Quay's `[[#Tides]]`; Unwritten and Empty have
     `links: 0`;
   - `links` counts distinct neighbours;
   - drafts: an edit adding `[[Lantern]]` to Mira adds the edge and marks Mira; a create of
     `02 People/Gull.md` linking to Mira adds an unpublished node and the edge; a create of
     `01 Places/The Drowned Bell.md` gives Unwritten's previously unresolved `[[The Drowned Bell]]` an
     edge; a delete removes Shade and its edges; a rename
     intent keeps the path and gives the new title and folder;
   - the same state gives the same `ETag` and a 304 for `If-None-Match`; a draft save changes it;
   - folder colours from the folder file, nested folders included;
   - builds a generated 500-note library in under 50 ms.
6. `apps/web/package.json` (Modify): `d3-force@^3.0.0`, `d3-quadtree@^3.0.1`; dev `@types/d3-force@^3.0.10`,
   `@types/d3-quadtree@^3.0.6`.
7. `apps/web/src/api.ts` (Modify): `graph()`.
8. `apps/web/src/graph/model.ts` (Create): `GraphModel`, `filterGraph`, `neighbourhood` (§2), and
   `nearestInDirection` (§6). `apps/web/src/graph/model.test.ts` (Create): the defaults hide appendices and
   top-level notes; folder filter removes nodes and their edges; orphans after filters; the local centre
   always kept; depth 1 and 2 with edges among neighbours; arrows pick the neighbour within 60°.
9. `apps/web/src/graph/colours.ts` (Create): nearest coloured ancestor, light/dark value, the neutral
   fallback; theme read from CSS. `apps/web/src/graph/colours.test.ts` (Create).
10. `apps/web/src/graph/layout.ts` (Create): the forces of §3. `apps/web/src/graph/layout.worker.ts`
    (Create): the messages. `apps/web/src/graph/runner.ts` (Create): starts the worker, falls back to the
    main thread, handles reduced motion. `apps/web/src/graph/layout.test.ts` (Create): deterministic for a
    seed; a generated 500/3,000 graph ends in at most 200 ticks; a warm start moves stored nodes little.
    `apps/web/src/graph/testGraph.ts` (Create): the seeded generator used by the unit and browser tests.
11. `apps/web/src/graph/positions.ts` (Create): `frontier.graph.positions` read and write, seeding new
    nodes beside a neighbour. `apps/web/src/graph/positions.test.ts` (Create): storage that throws, a new
    node seeded beside its neighbour.
12. `apps/web/src/graph/draw.ts` (Create): §4. `apps/web/src/graph/gestures.ts` (Create): §5, with the
    view maths (`zoomAt`, `fit`) separate. `apps/web/src/graph/gestures.test.ts` (Create): zoom around a
    point, fit, tap versus drag thresholds, touch drag only from the selected node.
13. `apps/web/src/graph/GraphCanvas.tsx` + `.css` (Create): the component the screen and the tab share:
    `{ model, shown, centre?, selected, onSelect, onOpen, store: boolean }`; hover card; `data-settle-ms`
    and `data-draw-ms`.
14. `apps/web/src/graph/SelectedPanel.tsx`, `graph/SelectionCard.tsx`, `graph/EntriesPanel.tsx`,
    `graph/FiltersPanel.tsx` + `.css` (Create): the Selected, Entries and Filters tabs (folders and "Show
    appendices" in 14a) and the card.
15. `apps/web/src/pages/Graph.tsx` + `.css` (Create): the screen: fetch, filters, find field, Fit, panels,
    `?focus=`, `frontier.graph.view`, the offline `Problem`. `apps/web/src/App.tsx` (Modify): lazy route
    `/graph`.
16. `apps/web/src/components/shell/LeftBar.tsx` (Modify): Graph in `PLACES` after Chronicles.
    `apps/web/src/components/shell/panels.tsx` (Modify): screen kind `graph`, rail by default.
17. `apps/web/src/keys.ts` (Modify): scope `graph` and the keys in §6. `apps/web/src/keys.test.ts`
    (Modify): the sheet lists them only while the graph is in focus; arrows in a typing field are left
    alone.
18. `apps/web/src/components/HoverPreview.tsx` (Modify, only if 13b has not yet done so): exports
    `usePreviewText` and `PreviewCard`, its own behaviour unchanged.
19. `apps/web/vitest.config.ts` (Modify): `happy-dom` for `src/graph/positions.test.ts`.
20. `apps/web/e2e/graph.spec.ts` (Create): CUJ 1 (desktop: Graph from the side bar, hover card, select
    Harbor, Selected tab counts, Enter opens, Back keeps the selection); CUJ 2 (desktop: "/", "quay",
    arrows, Enter; the Entries tab); CUJ 3's folder filter and appendices; CUJ 5 (phone: drawer, tap,
    card, second tap opens; pinch through two touch points with the DevTools protocol); the budgets of
    §8 (phone, throttled). Pixels on a canvas are not read: tests act through `?focus=`, the find field,
    the Entries list, and a read-only hook, `window.__frontierGraph.screenPointOf(path)`, present in every
    build, that gives a node's place on screen for hovering, tapping and dragging.
21. `playwright.config.ts` (Modify): the desktop project's `testMatch` gains `graph`.
22. `docs/designs/SITEMAP.md` (Modify): this design registered.

### Release 14b: the local graph and filters

23. `apps/web/src/graph/filters.ts` (Create): the filter set, defaults and `frontier.graph.filters`.
    `apps/web/src/graph/filters.test.ts` (Create): defaults; a removed folder ignored; a new folder ticked.
24. `apps/web/src/graph/FiltersPanel.tsx` (Modify): types (and "No type"), "Hide orphans", "Show top-level
    notes", the search field (dimming), "Reset filters"; remembered.
25. `apps/web/src/graph/LocalGraphPanel.tsx` + `.css` (Create): §7's tab: depth pair
    (`frontier.graph.depth`), "Show appendices", "Open in full graph", the card.
26. `apps/web/src/pages/Entry.tsx` (Modify): `usePanel` for "Graph", lazy.
27. `apps/web/src/graph/model.ts` (Modify): search dimming; `model.test.ts` (Modify).
28. `apps/web/e2e/graph.spec.ts` (Modify): CUJ 3 in full with a reload (desktop); CUJ 4 (desktop and
    phone: the tab on Mira, depth 2, open Old Quay from it, "Open in full graph"); CUJ 6 (an edit and a new
    entry appear, the new one marked).
29. `docs/BACKLOG.md` (Modify): the graph item marked done.

### Verification Plan

- `npm run typecheck && npm run lint && npm run format && npm test && npm run build && npm run e2e`, the
  browser tests in the `phone` and `desktop` projects.
- Server coverage thresholds kept; `apps/server/src/index/graph.ts` at 90% branch coverage.
- First-load JS gzipped (Vite's build output) unchanged within 2 KB by either release; the graph chunk's
  size is recorded in the pull request.
- The budgets in §8 pass in CI; by hand on a real iPhone with the real library (~430 entries): the graph
  settles in under 2 s, panning and pinching are smooth, tap and second tap work, and positions are kept
  after closing Safari.
- Screens at desktop and phone size, light and dark: the whole graph, a selected node with its card, the
  Filters tab, and an entry's Graph tab.
