# Stage 14: the graph

- **Author:** Elad Haviv
- **Status:** Approved after a Goldfish review (2026-11-23; findings in .egm/review-14/)
- **Date:** 2026-11-23
- **Parent:** [Stage 11](stage-11-foundations-shell-tree.md), which provides the shared pieces this stage
  uses: icons, tooltips, the keys registry, the save queue, the connection service, the shell with its
  left-bar places and right-bar panels (`usePanel`), and, from release 11c, the folder file with its
  colours. [Stage 12](stage-12-entries-editor.md) (12a) provides the entry page's side-bar tabs and
  `openPanel`. [Stage 13](stage-13-maps.md) (13b) changes the keys parser so a bare "-" can be bound;
  this stage makes that change itself if 13b has not landed. Comes from
  [`concepts_brief.md`](../../concepts_brief.md) (stage 14, the "Further risks" on offline links, and
  Alternatives Weighed) and the author's list of 2026-11-22 in [`BACKLOG.md`](../BACKLOG.md). The
  master design's non-goal "the graph view … is not rebuilt" was reversed by the author on 2026-11-22;
  the dated note is in [frontier.md](frontier.md#non-goals).

---

## Overview

Frontier is a single-author web app for writing the world of Avalymia as a library of Markdown entries.
Terms (draft, unpublished, rename intent) are as in
[Stage 11, Terms](stage-11-foundations-shell-tree.md#terms). The author asked for "a screen where I can
see the graph like in Obsidian", to look at the library and go from entry to entry, and for a local
graph, one entry with its neighbours. His answers: the nodes are entries; the graph is for looking and
going to other entries, never for editing.

Other names used here:

- **The folder file:** `.frontier/folders.json`, one line per folder with its icon, colour, order and
  type ([stage 11 §6](stage-11-foundations-shell-tree.md#6-the-folder-tree-and-the-folder-file-11c)).
- **Excluded folders:** `.git`, `.obsidian`, `.claude`, `.gemini` and `.frontier`
  (`EXCLUDED_FOLDERS` in `packages/vault/src/paths.ts`); Markdown in them is not a note.
- **The status stream:** the server's `/api/status/events`, which sends a status snapshot after every
  change on the server; the browser's connection service listens to it
  ([stage 11 §3](stage-11-foundations-shell-tree.md#3-the-connection-service-11a-2)).
- **The save queue:** the browser's list of changes not yet confirmed by the server
  (`apps/web/src/sync/queue.ts`,
  [stage 11 §1](stage-11-foundations-shell-tree.md#1-the-save-queue-11a-2)).
- **The slim line** is the phone's one-line top bar (menu, page title, the page's main action); **the
  rail** is the left side bar folded to a 48 px column of icons
  ([stage 11 §5](stage-11-foundations-shell-tree.md#5-the-shell-11b)).
- **`Problem`:** the shared "reason with Retry" component (`apps/web/src/components/ui/Problem.tsx`).
- **13b:** stage 13's viewing release ([Release 13b](stage-13-maps.md#release-13b-viewing)).
- **`overlay()`:** the helper in `apps/server/src/routes/entries.ts` that lists the paths drafts add
  (new notes and uploaded images) and remove (deleted notes), against which the entry page resolves a
  draft's links. This stage moves it into a shared module (§1).

Stage 14 ships in two releases and an optional third:

- **14a, the graph screen.** One `GET /api/graph` built from the server's link index; a `/graph` screen,
  reached from the left side bar's places, drawing every entry as a dot coloured by its folder and every
  link as a line; hover with the existing preview card, select (a card on the canvas), open; the Entries
  list as the keyboard and screen-reader way in; a find field; a folder filter; touch. **Needs 11c
  merged** (`FolderColor`, the folder store, `sortFolders`).
- **14b, the local graph.** A "Graph" tab in the right side bar of every entry page, showing the entry
  and its neighbours (depth 1, with a switch to depth 2) with the same drawing code. **Needs 12a merged**
  (the entry page's side-bar tabs) and comes after 14a.
- **14c (optional), more filters.** Type, "Hide orphans" and "Show top-level notes" filters, remembered
  on the device. Built only if the author asks for them after using 14a.

The order is 11c → 14a → 14b, with 12a before 14b. The graph works online in this stage. Stage 15
caches the same response so it works offline.

## The Problem

- **The library's shape is invisible.** About 430 entries link to each other, but Frontier shows links
  only one entry at a time: its links in the text and its backlinks below. The author cannot see which
  places gather many people, which entries stand alone, or how one folder ties into another.
- **Obsidian has the view; Frontier does not.** The author reads the exported copy in Obsidian to see the
  graph, which means leaving Frontier and an export that may be out of date.
- **Moving between related entries takes many steps.** From an entry, reaching an entry two links away
  means opening a link, scrolling for the next, and opening that.

## Goals

- **G1.** One `GET /api/graph` returns every entry as a compact node (path, title, type, aliases,
  whether unpublished) and every link between two entries as an edge, built from the published link
  index with the author's drafts changing only themselves (§1), and the top-level folders with their
  colours.
- **G2.** A `/graph` screen, a place in the left side bar (and the rail and the phone's drawer), draws
  the graph on a canvas: node size by the number of linked entries, colour by folder, labels by zoom
  level and on hover; pan and zoom.
- **G3.** Hovering a node (mouse) highlights it and its neighbours and, after a pause, shows the existing
  hover preview card. Clicking selects; a card on the canvas shows the entry's name, folder and "Open".
  Double-click, Enter or "Open" opens the entry.
- **G4.** Everything can be done from the keyboard: "/" focuses a find field that selects and centres a
  node; the Entries tab in the right side bar lists the shown entries; Enter opens; Esc clears; 0 fits;
  = and - zoom.
- **G5.** On touch: a tap selects, a second tap on the selected node opens it, pinch zooms, one finger
  pans.
- **G6.** By default the graph leaves out the appendices folder and, at the top level, `README.md` and
  `AGENTS.md`; it never shows unresolved or ambiguous links, images or other files. A folder filter
  (top-level folders) changes what is shown. When nothing remains, the screen says so.
- **G7.** The layout runs on the main thread in slices of about 8 ms a frame, so the page stays
  responsive and the settle is shown as an animation. Each node starts from a place seeded by its path,
  so the same graph lays out the same way on every visit and device, without storing positions. With
  reduced motion asked for, the layout is computed to the end and drawn once.
- **G8.** Every entry page has a "Graph" tab (14b) with the entry and its neighbours (depth 1, or 2 by a
  switch), drawn by the same code, with the same hover, select and open, and a list of the neighbours.
- **G9.** No regressions; first-load JavaScript, read by hand from Vite's build output, grows by no more
  than 2 KB, because the graph is a lazy route; the browser tests cover each journey below.

## Non-Goals

- Editing in the graph: no making links, renaming, moving or deleting from it (the author's answer).
- Nodes for things that are not entries: images, maps, chronicles, unresolved link targets ("ghost"
  nodes in Obsidian), tags. Unresolved links are counted on the Status page as today.
- Obsidian's canvas, groups, and graph "forces" settings for the author to tune. The forces are fixed
  in code.
- A 3D graph, a time slider, or saving a named view.
- Pending renames in the graph: a node keeps its published path and name until the version is saved
  (§1).
- Working offline. In this stage the graph needs a connection; stage 15 caches it (§10).
- What the review cut from this design's first draft, listed under "Future improvements".

## Decisions

| Decision | Date | Source |
| --- | --- | --- |
| Nodes are entries; no editing in the graph | 2026-11-23 | author |
| A local graph as a right-side-bar tab on entry pages | 2026-11-23 | author, brief |
| One `/api/graph` from the server's link index; the local graph is the same data filtered | 2026-11-22 | brief, Alternatives Weighed |
| Published links, with each draft changing only itself (a delete removes its node; an edit or create replaces its own outbound links through `analyse`); no other note re-resolved; pending renames not applied | 2026-11-23 | Goldfish review (zoom-out M2, readiness B1, M1); matches the entry page, whose backlinks are published-only |
| Rebuilt on every request; no `ETag`, memo or gzip | 2026-11-23 | Goldfish review (zoom-out M3): a build takes milliseconds |
| Canvas, not SVG; `d3-force` on the main thread, time-sliced; no Web Worker | 2026-11-23 | Goldfish review (zoom-out M4, readiness M9) |
| Start positions seeded by a hash of the path; no stored positions | 2026-11-23 | Goldfish review (zoom-out M5) |
| Pan and zoom maths from `@frontier/geo`'s flat view; a small graph-only pointer hook | 2026-11-23 | Goldfish review (zoom-out M8, readiness M7) |
| Colour: a folder's own colour, else its top-level folder's; a top-level folder without one gets one of the 8 colours no folder uses, in folder order; neutral when they run out | 2026-11-23 | Goldfish review (zoom-out M6), for the author; was open question 1 |
| Orphans are shown, as in Obsidian | 2026-11-23 | for the author; was open question 2 |
| Appendices, and `README.md` and `AGENTS.md` at the top level, hidden by default | 2026-11-23 | this design; the names are matched so the author's own library (one `Welcome.md`) still shows |
| One selection surface: the card on the canvas | 2026-11-23 | Goldfish review (zoom-out nits) |
| The existing `HoverPreview`, unchanged | 2026-11-23 | for the author; no dependency on 13b |
| Keys in scope `graph`, bound while the screen is mounted | 2026-11-23 | Goldfish review (readiness M6) |
| CI checks only deterministic quantities; timings by hand on an iPhone | 2026-11-23 | Goldfish review (zoom-out M7, readiness M3) |
| Select first, then open | 2026-11-22 | brief; matches stage 13's maps |
| `/graph` is a main place in the left side bar | 2026-11-23 | this design: the author asked for "a screen" |

## Critical User Journeys (CUJs)

### CUJ 1: See the whole library and go to an entry

- **Covers:** G1, G2, G3, G7.
- **Given**: the library with about 430 entries; on desktop.
- **When**: he chooses "Graph" in the left side bar, waits, scrolls to zoom in on a cluster, hovers a
  large dot, then clicks it and presses Enter.
- **Then**: the dots spread and come to rest; each top-level folder has its own colour, chosen by him in
  the folder file or given automatically. Zooming in brings up names. Hovering "Harbor" dims everything
  but Harbor and its neighbours and, after a moment, shows Harbor's opening in the hover card. The click
  selects it; the card on the canvas shows "Harbor", its folder `01 Places/Harbor` and "Open". Enter
  opens `/e/01 Places/Harbor/Harbor.md`. Back returns to the graph with Harbor still selected and in the
  middle.

### CUJ 2: Find an entry with the keyboard

- **Covers:** G4.
- **When**: on `/graph` he presses "/", types "quay", presses Enter, then Enter again; later he opens
  the Entries tab, moves down with the arrow keys and presses Enter twice.
- **Then**: the find field listed "Old Quay"; the first Enter selected and centred it, announced as "Old
  Quay, 01 Places/Harbor, 2 links out, 3 in"; the second opened it. In the Entries tab, the first Enter
  selected and centred the entry, the second opened it.

### CUJ 3: Narrow it down

- **Covers:** G6.
- **When**: he opens the Filters tab, unticks "03 Things" and ticks "99 Appendices".
- **Then**: the things vanish with their lines; "Session" in the appendices appears, linked to Harbor and
  Old Quay. The Entries tab lists the same entries as the canvas.

### CUJ 4: An entry's neighbours (14b)

- **Covers:** G8.
- **When**: on Mira's page he opens the "Graph" tab, hovers "Harbor", chooses "Depth 2", then
  double-clicks "Old Quay" (or chooses it in the list under the drawing).
- **Then**: the tab showed Mira in the middle, ringed, with Harbor, Old Quay, Shade and Ledger around her
  and listed below; depth 2 added Harbor's and Old Quay's neighbours; Old Quay opened, with its Graph tab
  open and Old Quay in the middle. "Open in full graph" goes to `/graph?focus=…` with the entry
  selected.

### CUJ 5: On a phone

- **Covers:** G5, G7.
- **When**: he opens the drawer, chooses Graph, pinches to zoom, drags with one finger, taps a dot, then
  taps it again.
- **Then**: the graph settled while he watched; pinching zoomed around his fingers; the drag panned. The
  first tap selected the dot and showed the card at the bottom with its name, folder and "Open"; the
  second tap opened the entry.

### CUJ 6: A link just written (14b)

- **Covers:** G1, G8.
- **When**: in the editor he adds `[[Lantern]]` to Mira and goes straight to Mira's page and its Graph
  tab, before the save queue has sent the change; then creates a new entry "Gull" in `02 People` linking
  to Mira.
- **Then**: Lantern appears among Mira's neighbours as soon as the change is sent, before any version is
  saved. Gull appears among Mira's neighbours, marked unpublished (a dashed ring, "unpublished" in the
  list).

## Technical Plan (Architecture)

### 1. The data: `GET /api/graph` (14a)

**Built from the index.** `VaultIndex` already holds every note's links with their resolution
(`note`, `file`, `unresolved`, `ambiguous`, `outside`) and builds the backlink map from them. The graph
uses the same links:

- **A node** for every note in `allNotes()` (Markdown outside the excluded folders), changed by the
  drafts as below. Images and other files never become nodes.
- **An edge** for every pair of different notes where the first has a link whose resolution is `note`
  to the second. Four links from Old Quay to Harbor (with or without a heading or a label) are one edge.
  `unresolved`, `ambiguous`, `outside` and `file` links make no edge. Links anywhere in the text, front
  matter included, count, as they do for backlinks.

**Drafts change only themselves.** The graph must agree with the entry page, which shows a draft's own
links resolved against the drafts' file list and its backlinks from the published index only
(`backlinks: s.index.backlinks(path)` in `routes/entries.ts`). So, with `{ added, removed } =
overlay()`:

- a `delete` draft removes its node and every edge to or from it;
- an `edit` or `create` draft of a note (not binary) takes its outbound edges from its own text,
  resolved through `index.analyse(path, text, added, removed)`, the call the entry page makes for a
  draft; they replace that note's published outbound edges. Its `type` and `aliases` come from the
  draft text too. A `create` draft adds a node; both mark the node `unpublished`;
- **no other note's links are resolved again.** A published note keeps its published edges, minus those
  to deleted notes. So a new note does not pick up older unresolved links to it (Unwritten's
  `[[The Drowned Bell]]` stays without an edge while "The Drowned Bell" is only a draft) until a version
  is saved, exactly as the new note's backlinks on its entry page are empty until then. A delete does not
  re-route other notes' links either: Ledger's `[[Shade]]` simply loses its edge when `02 People/Shade.md`
  is deleted, and does not jump to `99 Appendices/Agents/Shade.md`;
- **pending renames are not applied.** A node keeps its published path and title until the version is
  saved; opening it goes to that path, which shows the pending name as the entry page does. Folder lines
  are read as stored, so their paths match the nodes' published paths (the folder file is rewritten by
  the rename's save, through `renameInFolders`).

`overlay()` moves from `routes/entries.ts` to `apps/server/src/entries/overlay.ts` as
`overlay(s: Pick<Services, "drafts" | "index">)`, used by the entry routes and the graph route; it is
not copied. Each draft's `analyse` builds one resolver over about a thousand files; drafts are few, so a
build stays in milliseconds.

**Shape.** Compact, because the real library has ~430 nodes and a few thousand edges, and stage 15 keeps
it on the device. The folder, whether a node is in the appendices or at the top level, and each node's
number of neighbours are derived in the browser from the path and the edges:

```ts
GraphResponse = {
  nodes: {
    path: string; // the published path; opens the entry: /e/<path>
    title: string; // the file name without .md
    type: string | null; // field `type`, else the folder's type, as the entry page decides
    aliases?: string[]; // only when there are some; the find field searches them
    unpublished?: true; // an edit or create draft
  }[];
  edges: [from: number, to: number][]; // indexes into nodes; one per linking pair and direction
  folders: { path: string; color: FolderColor | null }[]; // top-level folders holding a node, in order
  nested: { path: string; color: FolderColor }[]; // deeper folders with a colour of their own
};
```

Nodes are sorted by path. The body is about 60 KB for the real library; compression for every route,
if wanted, is a separate change. The server sends everything, appendices included, and the browser
filters: one response serves the screen, every local graph and stage 15's cache. It is rebuilt on every
request, with no cache headers, like the other routes.

**Folders and colours.** From `FolderStore.file()` (11c: the draft, else the library's copy), the read
`/api/tree` uses.

- `folders` lists the top-level folders that hold at least one node, ordered as the tree orders them:
  `sortFolders` from `@frontier/schema` (the folder file's `order`, else by name). This is also the
  folder filter's order.
- A top-level folder with its own colour keeps it. The others, in that order, take the palette colours
  (`FOLDER_COLOR_NAMES`, in their fixed order) that no line of the folder file uses, one each; once
  those run out, `null` (neutral). `99 Appendices` is never given one automatically.
- `nested` lists the deeper folders with their own colour.

### 2. The browser model and filters (14a)

`graph/model.ts` turns the response into a `GraphModel`: nodes by index and by path, each node's folder,
top-level folder and neighbour lists (out, in and both), derived from the path and the edges. Pure
functions, unit tested:

- `filterGraph(model, ticked)` returns the shown node indexes and edges. A node is shown when its
  top-level folder is ticked; a node at the top level is shown unless it is `README.md` or `AGENTS.md`.
  An edge is shown when both ends are.
- `neighbourhood(model, path, depth)` for the local graph: the centre, and the entries within `depth`
  links either way, with every edge among them (as Obsidian does). It leaves out what the screen hides
  by default (the appendices, `README.md` and `AGENTS.md` at the top level), but never the centre.

**Defaults:** every top-level folder ticked except `99 Appendices`. The ticks are kept for the visit in
the page's module state, not across reloads (remembering them is 14c). A folder that no longer exists is
ignored; a new folder starts ticked. When no node is shown, the canvas is replaced by "Nothing to show"
with the reason (an empty library, or every folder unticked) and, for the latter, "Tick all folders".

### 3. Layout (14a)

- **`d3-force` on the main thread, time-sliced.** Each animation frame runs ticks until about 8 ms have
  passed, then draws. Pointer and key input are handled between frames, so pan and zoom work while the
  graph settles, and the settle shows as an animation. No Web Worker: at ~430 nodes the whole layout is
  a second or two of frames on a phone, and the main thread keeps the code in one place.
- **Forces:** `forceLink` over each linked pair once (distance 40, d3's default strength of 1 / smaller
  degree), `forceManyBody` (strength -60, `theta` 0.9, `distanceMax` 400), weak `forceX` and `forceY`
  (0.05) so orphans and small clusters stay near the middle, and `forceCollide` (node radius + 2).
  `velocityDecay` 0.4; `alphaDecay` is `1 - 0.001 ** (1 / 200)`, so a cold start (alpha 1 to d3's
  `alphaMin` 0.001) ends in exactly 200 ticks. The forces are written once in `graph/layout.ts`, which
  the tests run directly in Node.
- **Same picture each visit.** Each node starts at a point seeded by a 32-bit FNV-1a hash of its path
  (two halves of the hash give an angle and a radius in a disc of radius 10·√n), and d3-force's random
  source is its fixed-seed default. So the same graph and filters lay out the same way on every visit
  and every device, with nothing stored. A new entry, or a changed link, changes the forces, so it may
  shift its neighbourhood slightly (and the rest a little).
- **Changes during a visit.** When the shown graph changes (a filter, or a refetch that changed nodes or
  edges), nodes already placed keep their places, new ones start at their seeded points, and the
  simulation restarts warm: alpha 0.1 until it falls below 0.01, which with the decay above is 67
  ticks. The model and the positions are kept in a module variable for the visit, so Back to `/graph`
  shows the settled picture at once.
- **The local graph** uses the same code with the centre fixed at the middle (`fx`, `fy`); it is small
  and settles in a cold start's 200 ticks within a few frames.
- **Reduced motion.** With `prefers-reduced-motion: reduce`, the slices run without drawing; the canvas
  shows "Arranging…" (and `aria-busy="true"`) until the layout ends, then draws once.
- **Ceiling.** Time-sliced main-thread layout is comfortable to about 2,000 nodes and 10,000 edges; past
  that, each tick no longer fits a slice on a phone and the settle takes too long. Then the layout moves
  to a Web Worker (see Future improvements) with the same `layout.ts`; the drawing and the response need
  no change.

### 4. Drawing (14a)

- **Canvas.** One `<canvas>`, sized to its box at `devicePixelRatio`, redrawn only when something changed
  (positions, view, hover, selection, theme), at most once a frame. Order: edges as one path in the faint
  line colour; highlighted edges; nodes in one path per colour; rings for the selected, centre and
  unpublished (dashed) nodes; labels. SVG would make 3,500 DOM elements to move every tick.
- **Size:** radius `3 + 1.6 × √n` CSS pixels, where `n` is the number of distinct shown neighbours, at
  most 14, scaled with zoom but never below 2 on screen.
- **Colour:** the colour of the node's nearest folder in `nested`, else its top-level folder's in
  `folders`, using the light or dark value from `FOLDER_COLORS` as the page's theme is. A node at the top
  level, or whose colour is `null`, is drawn in `--ink-faint`. The theme is read when drawing starts and
  when `prefers-color-scheme` changes. Each of the 8 colours meets 5.4:1 against both page colours.
- **Labels:** in the UI font at 12 CSS pixels, not scaled with zoom, below the node, with a halo in the
  page colour. Shown for the hovered and selected nodes and their neighbours always; for the 12 nodes
  with most neighbours at any zoom; and for every node once the zoom is 1.4 or more. Labels are placed
  largest node first; one that would overlap a placed label is skipped (a coarse grid of placed boxes),
  and nodes outside the view are skipped.
- **Highlight:** while a node is hovered or selected, other nodes and edges are drawn at 20% opacity.

### 5. Pointer and view (14a)

**View maths from `@frontier/geo`.** The view is the flat `ViewState` `{ kind: "flat", x, y, k }` from
`packages/geo/src/view.ts`; `zoomAt`, `panBy` and `centreOn` do the maths, and the graph clamps `k` to
0.2–6 around them. "Fit" computes the box of the shown nodes and the `k` that fits it.

**The pointer hook** (`graph/usePanZoom.ts`, with its state changes in a pure `graph/pointer.ts`) is
written for the graph and is not shared with maps: maps have their own pointer code, which stage 13's
gesture machine (`map/gesture.ts`, 13a-2) replaces, and that machine may take this one in later. It keeps
a map of active pointers:

- **Mouse:** drag on empty space or on a node pans; the wheel zooms around the pointer; a press that
  moves less than 4 px is a click, which selects the node under it, or clears the selection on empty
  space; a double-click opens.
- **Touch:** one finger pans; two pinch, zooming around their middle (`zoomAt` by the change in their
  distance, `panBy` by the move of their middle); a tap (less than 10 px of movement) selects; a tap on
  the selected node opens it; a tap on empty space clears. `dblclick` is ignored when the last press was
  a touch, so a double tap does not open twice. The canvas has `touch-action: none`, so the browser
  neither scrolls nor zooms the page.
- **Hit-testing:** a `d3-quadtree` of the current positions, rebuilt after each slice of ticks. A point is
  searched within the largest node radius plus the slop (4 px for a mouse, 12 px for touch, in screen
  pixels divided by `k`); of the nodes found, those within their own radius plus the slop are kept, and
  the one with the smallest distance minus radius wins.

**Where the view is kept.** On the screen, the view is written to `sessionStorage` key
`frontier.graph.view` when it stops moving, and the selection to the address as `?focus=<path>`
(replaced, not pushed). On arrival, `?focus=` wins: the node is selected and centred at the remembered
zoom (or at 1.4 with none), once the layout has ended or at once when the positions are held. Without
`?focus=`, the remembered view is used; with neither, the view fits the graph when the layout ends.

### 6. Interaction (14a)

- **Hover (mouse only):** the node and its neighbours highlight at once. The preview card is the
  existing `HoverPreview`, unchanged: the canvas sits in a stage element given to it as its `scope`, and
  while a node is hovered the graph puts one transparent `<a class="link-resolved graph-hit"
  href="/e/<path>" tabindex="-1" aria-hidden="true">` over the node's circle. `HoverPreview` hears the
  `mouseover` on that link and, after its 350 ms pause, shows its card below it with `api.preview`. The
  stage's pointer handlers receive the link's events as the canvas's, and its click is prevented, so a
  click still selects. Before the graph moves or removes the link (the pointer leaves the node, a wheel,
  a pan), it dispatches `mouseout` on it, which closes the card as leaving a link does. An unpublished
  new entry has no published text, so no card appears, as for a link to it in the reader. Touch gets no
  hover card, as `HoverPreview` already decides.
- **Selection:** one surface, a card at the bottom of the canvas on every size: the name, the folder
  (with its colour), "Unpublished" when it is, and "Open". The canvas is described by `role="img"` and an
  `aria-label` ("Graph of 312 entries and 1,204 links. The Entries tab lists them."); `aria-busy` is true
  while arranging. A polite live region announces the selected entry ("Harbor, 01 Places/Harbor, 2 links
  out, 5 in", counting the shown entries).
- **Open:** double-click, Enter, a second tap, or "Open" goes to `/e/<path>`.
- **The Entries tab** is the keyboard and screen-reader way through the graph: a listbox of the shown
  entries in name order (name, folder, "unpublished"), following the filters. Up and Down move, Enter
  selects and centres, a second Enter opens. The selected node is marked there (`aria-selected`) and
  scrolled into view.
- **The find field** (`graph/FindField.tsx`) is its own small cmdk component, not the stage 11
  `Combobox`, which needs unique labels, has no keywords and cannot be focused from outside. It sits
  over the canvas's top-left corner. Its options are the shown nodes, keyed by path (`value`), labelled
  by title; titles that occur more than once also show their folder. cmdk filters on an item's value and
  keywords, not its text, so `keywords` holds the title, the aliases and the path. Choosing an option
  selects and centres the node and returns focus to the canvas's stage; Esc closes the list.

**Keys.** A new scope `graph` (between `map` and `editor` in `SCOPES`, named "Graph"). The screen binds
its keys while it is mounted, so the "?" sheet lists them on `/graph` only. The registry already ignores
plain keys while the focus is in a typing field, so "/" or "-" typed into the find field are text.

| id | keys | label |
| --- | --- | --- |
| `graph.find` | `/` | Find an entry in the graph |
| `graph.open` | `Enter` | Open the selected entry |
| `graph.clear` | `Escape` | Clear the selection |
| `graph.fit` | `0` | Fit the graph |
| `graph.zoomIn`, `graph.zoomOut` | `=`, `-` | Zoom in, out |

`graph.open` and `graph.clear` return `false` (so the key passes on) when nothing is selected, or when
the focus is on a button, a link or inside a side-bar panel, so Enter still presses a focused button and
the Entries list handles its own Enter. The keys parser splits a spec on "-", so today a bare "-"
throws; stage 13 (13b, [§4](stage-13-maps.md#4-context-menu-and-keys-13b-13c)) teaches `parse` that a
spec ending in "-" names the minus key. If 13b has not landed when 14a is built, 14a makes that same
change (item 17); 13b then finds it done.

### 7. Where it lives (14a, 14b)

- **The screen (14a):** route `/graph` (lazy, `React.lazy`), a place in `PLACES` after Chronicles, with
  the lucide `Waypoints` icon, so it is in the left side bar, the rail and the phone's drawer. The shell
  gains the screen kind `graph`, which, like maps, starts with the left bar folded to the rail. The right
  side bar's panels: Entries and Filters (the top-level folders in order, each with its colour and a
  tick). On a phone, the slim line shows "Graph" and a Filters button, which opens the bottom sheet at
  Filters. The find field, zoom in, zoom out and Fit sit over the canvas's top-left corner.
- **The local graph (14b):** `EntryPage` registers `usePanel({ id: "graph", title: "Graph", icon:
  Waypoints, render })`. The panel is a lazy component, so an entry page that never opens it loads none
  of the graph code. It holds a square canvas the width of the side bar (or the bottom sheet), a "Depth
  1 | 2" pair (`aria-pressed`, remembered in `localStorage` as `frontier.graph.depth`, read in a `try`),
  "Open in full graph" (`/graph?focus=<path>`), the selection card, and under the canvas the neighbours
  as a list of links (name, folder, "unpublished"), which is the tab's keyboard and screen-reader way.
  The centre is ringed and fixed in the middle. Hover, select, open and pan and zoom work as on the
  screen; the screen's keys are not bound in the tab. Opening an entry from the tab keeps the Graph tab
  open on the next page, because the shell remembers the open tab per screen kind. The editor page does
  not get the tab: the author reads links, he does not navigate, while writing.

### 8. Loading and refetching (14a, 14b)

`graph/data.ts` holds the model for the visit and fetches `api.graph()` when the screen or the tab first
needs it. It fetches again, with at most one request in flight and one more queued behind it:

- on every status-stream event (each new snapshot from `connection.subscribe`), which covers "Save a
  version", an index rebuild and changes from other devices;
- whenever the save queue's list changes (`queue.subscribeList`) and an `entry:` record has gone or
  carries a new revision since the last look, which means the server stored a send. A draft save does
  not change the status snapshot, so this is what brings a link just written into the graph.

So when the local graph tab opens while the queue still holds unsent records for notes, it shows what
the server has, and fetches again once they are sent (CUJ 6's race, tested in the browser). When a
refetch changes the shown nodes or edges, the layout restarts warm (§3); otherwise nothing moves.

### 9. Performance and scale (14a)

CI checks only quantities that do not depend on the machine:

| What | How it is checked |
| --- | --- |
| A cold layout ends in 200 ticks, a warm restart in 67, for a generated 500-node, 3,000-edge graph (fixed seed) | `layout.test.ts`, in Node |
| The same graph gives the same positions | `layout.test.ts` |
| First-load JavaScript grows by no more than 2 KB | read by hand from Vite's build output; the graph is a lazy route, so `d3-force`, `d3-quadtree` and the graph code are in lazy chunks |

Timings are checked by hand on a real iPhone with the real library (~430 entries) after each release:
the settle finishes within about 3 seconds, panning and pinching stay smooth while it runs, and tap and
second tap work. If the settle is too slow, the levers are, in order: fewer ticks (150), `theta` 1.2, and
the worker. The ceiling is about 2,000 nodes (§3).

### 10. Offline (stage 15)

In this stage the graph needs a connection. Offline, the screen and the tab show `Problem` with "The
graph needs a connection" and Retry, unless the model is already held from earlier in the visit, in
which case it is shown as it was. Stage 15 keeps the latest `/api/graph` response on the device, so the
graph works offline from the cached index, as the brief's "Further risks" ask. The response holds only
what the compact offline index holds (paths, names, types and links), so stage 15 may instead build it on
the device from that index with the same `GraphResponse` shape. Drafts made offline then show in the
graph only when stage 15's index carries them; that is stage 15's to decide.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The layout is slow on a phone or stalls input | Time-sliced at ~8 ms a frame, Barnes–Hut with `theta` 0.9, a 200-tick cap; checked by hand on an iPhone; the worker is the next step past ~2,000 nodes (§3, §9) |
| A hairball: 430 nodes in one mass | The folder filter, appendices and `README.md`/`AGENTS.md` hidden by default, highlight on hover and selection, labels by zoom |
| The layout changes each visit and the author loses his bearings | Start positions seeded by path and a fixed random source: the same graph gives the same picture; within a visit, warm restarts keep placed nodes in place |
| The graph and the entry page disagree about links | One rule for both: published links, drafts changing only themselves, through the same `overlay()` and `analyse` (§1) |
| A new entry's incoming links are missing until a version is saved | Said in §1; the same as its backlinks on the entry page |
| A canvas is invisible to screen readers and the keyboard | The Entries tab, the find field, the keys, a live region, and the local graph's list of neighbours (§6, §7) |
| The graph shows a link the published library does not have | Unpublished nodes are ringed (dashed); the card and the lists say "unpublished" |
| The graph lags the library | Fetched again on every status-stream event and after each send from the save queue (§8) |
| Pan and select fight on touch | A tap only selects; a move of 10 px or more pans; no node dragging |
| The hover link steals a click or leaves a card behind | Its click is prevented and its events go to the stage's handlers; `mouseout` is dispatched before it moves or goes (§6) |
| Storage full or blocked | Only the view (`sessionStorage`) and the depth (`localStorage`) are stored, in `try`, with defaults when missing |
| The bundle grows | All graph code, `d3-force` and `d3-quadtree` are in lazy chunks; the first-load size is read from the build |

## Alternatives Considered

### Alternative A: Build the graph in the browser from every entry's text

- **Cons**: Needs every entry's text on the device; repeats the server's link resolution.
- **Reason for Rejection**: Rejected in the brief; the server's index already resolves every link.

### Alternative B: Published links only

- **Pros**: The simplest rule; the same graph as the export.
- **Cons**: A link just written, or a new entry, is missing from the local graph until a version is
  saved, though the entry page already shows it.
- **Reason for Rejection**: Letting drafts change only themselves costs one `analyse` per draft and
  agrees with the entry page.

### Alternative C: Drafts laid over everything, with every note's links resolved again

- **Pros**: A new entry picks up older unresolved links to it at once.
- **Cons**: It disagrees with the entry page, whose backlinks are published-only. The review showed it is
  subtle (readiness B1): a new note can make other notes' links ambiguous, and a delete re-routes them
  (Ledger's `[[Shade]]` would jump to the appendix's `Shade.md`); renames would need several intents
  reduced and the folder lines moved.
- **Reason for Rejection**: Too much new resolution logic for a view that only looks; each draft changing
  only itself is consistent and simple.

### Alternative D: SVG, or a WebGL library (Sigma.js, Cosmos)

- **Pros**: SVG gives DOM events and accessibility per node; WebGL scales to tens of thousands.
- **Cons**: SVG must move ~3,500 elements each tick; WebGL libraries are large and bring their own layout
  and input, unlike the rest of the app.
- **Reason for Rejection**: A 2D canvas draws 500 nodes and 3,000 lines well within a frame; accessibility
  comes from the Entries tab.

### Alternative E: `d3-zoom` for pan and zoom

- **Pros**: Tested, well-known gestures.
- **Cons**: Brings `d3-selection`, `d3-transition`, `d3-drag` and `d3-interpolate`, beside
  `@frontier/geo`'s view maths that the maps already use.
- **Reason for Rejection**: `zoomAt`, `panBy` and `centreOn` already exist; the pointer hook is small.

### Alternative F: Layout on the server, positions in the response

- **Pros**: No work on the phone.
- **Cons**: Positions would depend on the filters; offline needs the layout on the device anyway.
- **Reason for Rejection**: The main thread, time-sliced, is enough at this size.

### Alternative G: The local graph as a separate request (`/api/graph?path=&depth=`)

- **Pros**: Smaller answers.
- **Cons**: A second route, and no offline answer without the whole graph.
- **Reason for Rejection**: The brief: the local graph is the same view filtered; the whole graph is
  about 60 KB.

### Alternative H: Nodes for unresolved links, as Obsidian does

- **Pros**: Shows entries still to be written.
- **Reason for Rejection**: Mixes things that are not entries with entries (the author's "nodes are
  entries"); unresolved links are already listed on the Status page.

### Alternative I: Graph in the app menu, not a main place

- **Reason for Rejection**: The author asked for a screen; it is a way of navigating, like Maps.

## Future improvements

Cut from the first draft by the review; each can be added on its own if the author asks or the library
outgrows the simple form.

- **Response cache:** an `ETag` per version, a memo of the last build and gzip; rebuilding takes
  milliseconds today.
- **Web Worker layout:** `layout.ts` in a worker with a small message protocol; the step past ~2,000
  nodes.
- **Stored positions:** positions kept per device so a new entry moves nothing else.
- **Timed CI budgets:** settle and frame times under CPU throttling, with test hooks; today a hand check
  on an iPhone.
- **Arrow keys** that move the selection to the neighbour in that direction.
- **A Selected side-bar tab** and a phone Details sheet with links out and in.
- **Dragging a node** to pull its neighbours about.
- **Search dimming:** nodes matching a search drawn full, the rest dimmed.
- **More fields in the response:** an edge's link count, a node's neighbour count, a version.
- **The filters of 14c,** if 14c is not built: type, orphans, top-level notes, remembered.

---

## Detailed Implementation Plan

Two releases and an optional third. Each must pass the Verification Plan before it is merged and
deployed. 14a starts after 11c is merged; 14b after 14a and 12a.

### Release 14a: the graph screen

1. `packages/schema/src/graph.ts` (Create): `GraphNode`, `GraphResponse` (§1), using `FolderColor` from
   `folders.ts` (11c). `packages/schema/src/index.ts` (Modify): export it.
   `packages/schema/test/schemas.test.ts` (Modify): a response parses; an edge with a bad index does not.
2. `apps/server/src/entries/overlay.ts` (Create): `overlay()`, moved from `routes/entries.ts` (Modify),
   which now imports it; behaviour unchanged.
3. `apps/server/src/index/graph.ts` (Create): `buildGraph({ index, drafts, texts, added, removed,
   folders })`, pure, returning `GraphResponse` (§1), with the automatic colours.
4. `apps/server/src/routes/graph.ts` (Create): `GET /api/graph`: reads the drafts' texts and
   `s.folders.file()`, calls `overlay()` and `buildGraph`. `apps/server/src/app.ts` (Modify): registers
   it.
5. `apps/server/test/graph.test.ts` (Create), on the fixture vault (`packages/vault/test/fixture-vault`,
   through `test/helpers/repo.ts`):
   - nodes are the notes only: no `99 Appendices/Images/lamp.png`, `99 Appendices/Icons/Lamp.png`,
     `notes.json` or `.obsidian/Hidden.md`; `README.md` and `AGENTS.md` are nodes at the top level;
     `99 Appendices/Logs/Session.md` is a node;
   - Old Quay → Harbor is one edge however many of its links resolve to Harbor, and Old Quay → Mira
     comes from the Markdown link; Mira → Harbor is one edge for its three spellings, and Mira → Old Quay
     comes from `[[Harbor/Old Quay]]`;
   - no edge from Lantern's ambiguous `[[Twin]]`, Unwritten's unresolved links, Gallery's images, Mira's
     `[[.obsidian/app.json]]`, `[[notes.json]]` and `[[01 Places/Nowhere/Gone]]`, or Old Quay's
     `[[#Tides]]`; Unwritten has no edge;
   - delete: a delete draft of `02 People/Shade.md` removes the node, Shade → Mira and Ledger → Shade,
     and Ledger gains no edge to `99 Appendices/Agents/Shade.md`;
   - edit: an edit of Mira whose text is "Lives at [[Harbor]]. Carries a [[Lantern]]." gives Mira the
     out-edges Harbor and Lantern only, marks it unpublished, keeps Shade → Mira, Ledger → Mira, Harbor →
     Mira and Old Quay → Mira, and takes its aliases from the draft text;
   - create: a create of `02 People/Gull.md` linking `[[Mira]]` adds an unpublished node and Gull →
     Mira; an edit of Mira linking `[[Gull]]` at the same time gives Mira → Gull; a create of
     `01 Places/The Drowned Bell.md` adds its node, and Unwritten still has no edge to it;
   - a rename intent changes nothing: the node keeps its path and title;
   - colours: a folder's own colour; top-level folders without one take the unused colours in the
     folder file's order, else by name; `null` once the 8 run out; `99 Appendices` gets none; nested
     colours listed.
6. `apps/server/vitest.config.ts` (Modify): `"src/index/graph.ts": { branches: 90 }` in
   `coverage.thresholds`.
7. `apps/web/package.json` (Modify): `d3-force@^3.0.0`, `d3-quadtree@^3.0.1`; dev `@types/d3-force@^3.0.10`,
   `@types/d3-quadtree@^3.0.6`.
8. `apps/web/src/api.ts` (Modify): `graph()`.
9. `apps/web/src/graph/model.ts` (Create): `GraphModel`, `filterGraph`, `neighbourhood` (§2), each
   node's folder and neighbour counts. `apps/web/src/graph/model.test.ts` (Create): the defaults hide
   `99 Appendices` and `README.md` and `AGENTS.md` at the top level only (a `03 Things/README.md` stays);
   a folder filter removes nodes and their edges; the empty state; the local centre always kept; depth 1
   and 2 with edges among neighbours; the local graph leaves out the appendices.
10. `apps/web/src/graph/colours.ts` (Create): `nested`, then the top-level folder's colour, the light or
    dark value, the neutral fallback. `apps/web/src/graph/colours.test.ts` (Create).
11. `apps/web/src/graph/layout.ts` (Create): the forces, the seeded start, the warm restart (§3).
    `apps/web/src/graph/runner.ts` (Create): the 8 ms slices, reduced motion. `apps/web/src/graph/
    layout.test.ts` (Create): on a generated 500-node, 3,000-edge graph with a fixed seed, a cold start
    ends in 200 ticks and a warm restart in 67; the same input gives the same positions; a node's start
    depends only on its path.
12. `apps/web/src/graph/draw.ts` (Create): §4. `apps/web/src/graph/pointer.ts` (Create): the pointer
    states of §5, pure, with hit-testing. `apps/web/src/graph/usePanZoom.ts` (Create): the hook, using
    `zoomAt`, `panBy` and `centreOn` from `@frontier/geo`. `apps/web/src/graph/pointer.test.ts` (Create):
    tap versus pan thresholds for mouse and touch, a second tap opens, `dblclick` after a touch ignored,
    pinch zooms about the middle, hit-testing picks a large node whose centre is farther than a small
    one's, the zoom clamp.
13. `apps/web/src/graph/GraphCanvas.tsx` + `.css` (Create): the component the screen and the tab share:
    `{ model, shown, centre?, selected, onSelect, onOpen }`; `touch-action: none`; `aria-busy`; the
    hover link and `HoverPreview` (§6).
14. `apps/web/src/graph/SelectionCard.tsx`, `graph/EntriesPanel.tsx`, `graph/FiltersPanel.tsx` + `.css`
    (Create): the card, the Entries and the Filters tabs (§6, §7).
15. `apps/web/src/graph/FindField.tsx` + `.css` (Create): §6's cmdk field.
16. `apps/web/src/graph/data.ts` (Create): the model for the visit and the refetches of §8.
    `apps/web/src/graph/settings.ts` (Create): `frontier.graph.view` and `frontier.graph.depth`, read and
    written in `try`. `apps/web/src/graph/data.test.ts` (Create): a status event and a sent `entry:`
    record each fetch again, one request in flight and one queued. `apps/web/src/graph/settings.test.ts`
    (Create, with `// @vitest-environment happy-dom` at its top): storage that throws, missing values.
17. `apps/web/src/keys.ts` (Modify): scope `graph` and the keys of §6; if 13b has not landed, `parse`
    accepts a bare "-" and "Mod--" as stage 13 item 20 describes. `apps/web/src/keys.test.ts` (Modify):
    "-" parses; the sheet lists the graph keys only while they are bound; "/" and "-" in a typing field
    are left alone; Enter passes on when the action returns `false`.
18. `apps/web/src/pages/Graph.tsx` + `.css` (Create): the screen: data, filters, find field, zoom and Fit
    buttons, panels, the keys, `?focus=` and the remembered view, the empty state, the offline
    `Problem`. `apps/web/src/App.tsx` (Modify): lazy route `/graph`.
19. `apps/web/src/components/shell/LeftBar.tsx` (Modify): Graph in `PLACES` after Chronicles.
    `apps/web/src/components/shell/panels.tsx` (Modify): screen kind `graph`, rail by default.
20. `apps/web/e2e/graph.spec.ts` (Create). Canvas pixels are not read; the tests act through `?focus=`
    (which centres the node, so its place on screen is the canvas's middle once `aria-busy` is false),
    the find field, the Entries tab and the Filters tab, and read `sessionStorage` for the view:
    - CUJ 1 (desktop only, `test.skip` for the phone project): Graph from the side bar; `?focus=` Harbor;
      the hover card at the middle; Esc clears the selection and a click on the middle selects again;
      the card shows "Harbor" and its folder; Enter opens `/e/01 Places/Harbor/Harbor.md`; Back shows
      Harbor selected. The colours are not checked here (`colours.test.ts` and the server test do), so
      the fixture needs no folder file;
    - CUJ 2 (desktop only): "/", "quay", Enter selects Old Quay and the live region names it, Enter
      opens; the Entries tab's Enter, Enter;
    - CUJ 3 (both projects): untick "03 Things", and the Entries tab no longer lists Lantern; tick "99
      Appendices", and it lists Session;
    - CUJ 5 (phone only): the drawer, Graph; a tap on the middle with `?focus=` opens; a tap on empty
      space clears and a tap on the middle selects; a pinch through two touch points with the DevTools
      protocol raises the view's `k`.
21. `playwright.config.ts` (Modify): the desktop project's `testMatch` gains `graph`.
22. `docs/designs/SITEMAP.md` (Modify): this design registered.

### Release 14b: the local graph

23. `apps/web/src/graph/LocalGraphPanel.tsx` + `.css` (Create): §7's tab: the depth pair, "Open in full
    graph", the card, the list of neighbours, the refetch of §8.
24. `apps/web/src/pages/Entry.tsx` (Modify): `usePanel` for "Graph", lazy.
25. `apps/web/e2e/graph.spec.ts` (Modify). Names are per project (`Gull ${info.project.name}`), every
    draft a test makes is discarded at its end, since both projects share one server, and lists are
    checked for what they contain, since other test files publish entries into the same library:
    - CUJ 4 (both projects): the tab on Mira lists Harbor, Old Quay, Shade and Ledger; "Depth 2" adds
      The Marsh, Lantern, Broken and Rope, and not Session (appendices); choosing Old Quay in the list
      opens it with the tab open; "Open in full graph" selects Mira on `/graph`;
    - CUJ 6 (both projects): type `[[Lantern]]` into Mira and go to Mira's Graph tab at once, before the
      queue's pause ends; Lantern appears once the change is sent. Create `Gull ${info.project.name}` in
      `02 People` linking to Mira; it appears in Mira's tab marked unpublished. Both drafts are
      discarded.
26. `docs/BACKLOG.md` (Modify): the graph item marked done.

### Release 14c (optional): more filters

27. `apps/web/src/graph/filters.ts` (Create): types (and "No type"), "Hide orphans" (a node with no shown
    edge after the other filters), "Show top-level notes", in `localStorage` key
    `frontier.graph.filters`, read with a fallback; "Reset filters". `filters.test.ts` (Create).
28. `apps/web/src/graph/FiltersPanel.tsx`, `model.ts` (Modify) and `graph.spec.ts` (Modify): the filters
    and a reload that keeps them.

### Verification Plan

- `npm run typecheck && npm run lint && npm run format && npm test && npm run build && npm run e2e`, the
  browser tests in the `phone` and `desktop` projects.
- Server coverage thresholds kept, with `apps/server/src/index/graph.ts` at 90% branch coverage.
- First-load JavaScript: read by hand from Vite's build output; it must not grow by more than 2 KB in
  either release, because the graph is a lazy route. The graph chunk's size is recorded in the pull
  request.
- By hand on a real iPhone with the real library (~430 entries): the graph settles within about 3
  seconds, panning and pinching are smooth while it settles, tap and second tap work, and Back keeps the
  selection.
- Screens at desktop and phone size, light and dark: the whole graph, a selected node with its card, the
  Filters tab, the empty state, and an entry's Graph tab.
