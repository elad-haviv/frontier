# Stage 15: working offline

- **Author:** Elad Haviv
- **Status:** Draft, for review (2026-11-23)
- **Date:** 2026-11-23
- **Parent:** [Stage 11](stage-11-foundations-shell-tree.md), which provides what this stage builds on:
  the save queue with its base check and one kept copy per device, the connection service, the unsent
  list, the shell, and (11c) the folder file through the library item file pipeline.
  [Stage 12](stage-12-entries-editor.md) left image upload offline for this stage to decide (its
  Non-Goals). [Stage 13](stage-13-maps.md) (13d) adds the map styles file to the same pipeline.
  [Stage 14](stage-14-graph.md) (14a) builds `GET /api/graph`, which this stage extends into the
  compact index (§5) and left the graph offline for this stage to decide (its §10). Comes from
  [`concepts_brief.md`](../../concepts_brief.md) (stage 15, the "Further risks" on offline storage,
  login, updates, links and moves, and "Answered by the author" item 3). The master design's non-goal
  "Full offline use" was reversed by the author on 2026-11-22; the dated note is in
  [frontier.md](frontier.md#non-goals).

---

## Overview

Frontier is a single-author web app for writing the world of Avalymia as a library of Markdown entries.
Terms (draft, unpublished, unsent, kept copy, rename intent, item file) are as in
[Stage 11, Terms](stage-11-foundations-shell-tree.md#terms). The author asked: "I'm fine with only being
able to edit the last few files I opened (they will be saved on-device for this)", and also to add new
entries and to work on maps and chronicles with no connection, with the changes sent when it returns.
He accepted that moves and renames, image import from a web address, AI, search over entries not on the
device, and history need a connection, and that on an iPhone Frontier must be installed to the Home
Screen to keep its offline copy.

Other names used here:

- **The save queue:** the browser's list of changes not yet confirmed by the server, in IndexedDB
  (`apps/web/src/sync/queue.ts`, [stage 11 §1](stage-11-foundations-shell-tree.md#1-the-save-queue-11a-2)).
  Each record carries the version it started from (`draftId`, `revision`, `baseBlob`) and, for item
  files, its `base`, so a three-way merge survives a reload. It already exists.
- **The connection service:** one state, `online`, `offline` or `signed-out`, from the server's status
  stream and one probe of `/api/status` (`apps/web/src/sync/connection.ts`,
  [stage 11 §3](stage-11-foundations-shell-tree.md#3-the-connection-service-11a-2)).
- **The unsent list:** the count by the connection mark and its list of records with Retry and Discard
  (`apps/web/src/components/Unsent.tsx`). This is the brief's "N changes waiting".
- **Library item files:** `.frontier/folders.json` (11c) and `.frontier/map-styles.json` (13d), read
  and saved through `/api/library-files/:name` and the table in `packages/schema/src/libraryFiles.ts`.
- **The service worker:** a script the browser keeps beside the app that can answer the app's own
  requests from storage; here it serves the app's files and kept images, nothing else (§1).
- **The app shell:** the built files in `apps/web/dist`: `index.html`, the JavaScript and CSS chunks
  (the map, chronicle and graph pages included), the manifest and the icons.
- **The device copy:** what this stage keeps in the browser: the compact index, a few lists, and the
  bodies of kept items (§5). Distinct from the save queue, which holds only unsent changes.
- **The compact index:** every entry's path, title, type, aliases, id, a short version mark and its
  resolved outgoing links, plus the paths of the library's other files. It is the 14a graph response
  with three more fields (§5), kept whole on the device.
- **A kept item:** an entry, a map or a chronicle whose body is on the device, because it is **recent**
  (among the last ones opened) or **pinned** (the author chose "Keep offline").
- **Build id:** a string made at each web build, carried by the app and by the server that serves it
  (§3). **Client API number:** an integer in `packages/schema` saying which shape of write requests the
  app sends (§3).
- **14a, 13d:** [Release 14a](stage-14-graph.md#release-14a-the-graph-screen) (the graph screen and
  `/api/graph`); [Release 13d](stage-13-maps.md) (map styles).

Stage 15 ships in three releases, each deployable on its own and in this order:

- **15a, the installable app.** A service worker that holds the app shell, so Frontier opens with no
  connection; the web app manifest and icons, so an iPhone can install it; an update flow that never
  reloads by itself; a kill switch the server can serve; build ids and the client API number on every
  request, with a typed refusal for a client too old to write; starting offline while signed in.
  Nothing new is kept on the device yet: pages that need the server say so as today.
- **15b, the device copy.** The compact index always kept; the bodies of the last 30 entries, 5 maps
  and 5 chronicles opened, and of pinned ones, with their images; reads served from the device when the
  server cannot be reached, marked "Offline copy from <time>"; the graph, switcher, `[[` completion,
  tree and hover previews from the device; search over kept entries; storage kept and shown in Settings;
  logout wipes all of it. Editing a kept entry, map or chronicle offline works from here, because
  writes already go through the queue. **Needs 14a merged** (the graph route it extends).
- **15c, offline writes beyond editing.** New entries made offline, with their name checked against the
  compact index and a clash found later kept as a kept copy; item clashes in maps, chronicles and the
  library item files keep the other side as a kept copy, with a compare screen per item. Comes after
  15b.

## The Problem

- **Frontier does not open without a connection.** The app's files come from the server on every visit,
  and the start checks the session with `/api/session`; when that fails, `App.tsx` shows the login page
  (`() => setLoggedIn(false)`). On a train, the author cannot even reach text he typed an hour ago.
- **Nothing is read from the device.** Every page reads through `api.ts`, and a failed read shows
  "Can't reach Frontier". The queue keeps unsent text, but the editor cannot open without the server
  (`Edit.tsx` stops on any load error but a 404), so the kept text is out of reach until the connection
  returns.
- **Links, the switcher and the tree need the server.** `[[` completion and the switcher call
  `/api/switcher`, the tree `/api/tree`, hover previews `/api/preview`. Offline, all of them are empty.
- **An iPhone forgets.** Safari clears a site's storage after about 7 days without use unless the site is
  installed to the Home Screen, and installing needs a manifest and icons, which Frontier does not have
  (there is no icon, favicon or manifest in the repository today).
- **A new entry made offline can get stuck.** A create whose path was meanwhile published from another
  device is refused as `invalid` ("already exists") by `check()` in `apps/server/src/routes/drafts.ts`,
  because the base check only applies to saves with a revision above 0. The queue then marks the record
  "needs attention" instead of keeping both texts.
- **A long offline gap turns map merges into "mine wins".** The queue merges maps, chronicles and the
  library item files item by item from a stored base, which is right, but an item both devices changed
  keeps this device's side and the other side is gone, named only in a notice. After seconds that is
  rare; after days it is likely.
- **An old app can meet a new server.** Once the app is held on the device, a deploy no longer reaches
  it at once. Today nothing tells the server which build sent a write.

## Goals

- **G1.** Frontier opens with no connection, on desktop, Android and an iPhone with Frontier installed
  to the Home Screen: the app shell comes from the service worker, and a device that was signed in stays
  signed in until the server says otherwise.
- **G2.** Frontier can be installed: a web app manifest (name, short name, icons, theme colour,
  standalone display), icons made from one mark, and on an iPhone not yet installed a card that says how
  and why.
- **G3.** An update never reloads the app by itself. "A new version of Frontier is ready" shows with
  Reload only while the save queue is empty; the new version takes over only when the author chooses.
  When the server refuses a write from a client too old for it, the queue keeps the change, the app asks
  for a reload, and the new version sends it. The server can switch the service worker off.
- **G4.** The compact index is always on the device and kept up to date, so with no connection links
  resolve, `[[` completion and the switcher find every entry by name or alias, the tree shows every
  folder and entry, hover previews show kept entries, and the graph works.
- **G5.** The bodies of the last 30 entries, 5 maps and 5 chronicles opened, and of every pinned one,
  are on the device with their images at the size shown, and are refreshed in the background while
  online.
- **G6.** Storage: Frontier asks the browser to keep its storage, keeps the device copy within a budget
  the author sets, never evicts an unsent change or a pinned item, evicts the least recently opened
  first, and shows in Settings what is kept and the space used.
- **G7.** A page read from the device says so: "Offline copy from 14:05". The connection mark stays
  truthful: the service worker never answers the app's data requests. Before the first edit after the
  connection returns, the editor reads the server's copy again.
- **G8.** Offline, the author edits kept entries, deletes entries, and makes new entries in any folder,
  with the name checked against the compact index and the unsent queue. A path taken meanwhile on another
  device ends as a kept copy, never as a silent merge or a stuck record.
- **G9.** Offline, the author edits kept maps and chronicles and changes the folder file and the map
  styles file (new empty folders, order, icons, colours, types, styles); the queue merges them item by
  item from the stored base when they are sent.
- **G10.** When an item (a map feature, a chronicle span, a folder line, a style) was changed on both
  sides, the other side is kept as a kept copy, and a compare screen lets the author choose per item.
- **G11.** What needs a connection says so and is disabled while offline: renames, moves, folder
  deletes, creating and deleting maps and chronicles, image upload, paste and import, AI, comments,
  history, export, import, the inbox and "Save a version". Search offline searches the kept entries and
  says that is what it did.
- **G12.** Logout warns about unsent changes, then removes the queue, the device copy, the kept images
  and the service worker's caches, and unregisters the service worker.
- **G13.** No regressions. First-load JavaScript grows by no more than 8 KB gzipped across the stage,
  read by hand from Vite's build output. The browser tests run against a production build with the
  service worker, and cover each journey below that CI can run.

## Non-Goals

- **Image upload, paste and drop while offline.** They need a connection (decided in Decisions, with the
  reason; a design for later is under "Future improvements"). Text paste works as today.
- **Structural actions offline:** renaming or moving entries and folders, deleting folders, creating,
  copying or deleting maps and chronicles, making a chronicle the main one, applying a folder's type to
  its entries. They stay direct calls to the server, as stage 11 decided.
- **Comments offline.** They stay direct calls (stage 11 left it to this stage); queueing them is under
  "Future improvements".
- **Search over entries not on the device, AI, history, export, import, the inbox, Settings other than
  "On this device", and URL image import** (the author's accepted limits, and the brief's out-of-scope
  list).
- **Sending while Frontier is closed.** The queue sends while a Frontier tab or the installed app is
  open. Background Sync is not on iOS, and the author opens Frontier to work.
- **An automatic three-way merge of entry text.** A clash of text stays two texts to compare
  ([stage 11, Alternative C](stage-11-foundations-shell-tree.md#alternative-c-resolve-every-stale-save-on-the-server-with-a-three-way-merge)):
  a wrong merge of prose is worse than a shown conflict.
- **The whole library on the device.** Only the compact index is whole; bodies are recent or pinned.
- **Several people.** One author on several devices, as in every stage.

## Decisions

| Decision | Date | Source |
| --- | --- | --- |
| Offline work: recent files, new entries, maps and chronicles | 2026-11-22 | author's ask, brief |
| Moves, renames, URL import, AI, search over uncached entries and history need a connection; on an iPhone Frontier must be installed | 2026-11-22 | brief, "Answered by the author" item 3 |
| A service worker for the app shell, built with `vite-plugin-pwa` in its `injectManifest` mode (our own worker, Workbox's precache) | 2026-11-23 | this design (Alternative A) |
| The service worker answers only navigations, the app's own files and kept images; never `/api/` data, non-GET requests, auth, settings, status or the status stream | 2026-11-23 | brief ("SW-served GETs can fool offline detection"); this design |
| Reads from the device go through `api.ts` (a read-through layer), not through the service worker | 2026-11-23 | this design (Alternative B) |
| An update takes over only on the author's choice, and is offered only while the queue is empty; a server refusal of an old client is the one case that asks for a reload with changes waiting | 2026-11-23 | brief ("An app update waits until the queue is empty"); this design |
| A kill switch: the server can serve a worker that removes Frontier's caches and unregisters itself, leaving the queue | 2026-11-23 | this design |
| Every request carries the build id and the client API number; writes from a client below the server's minimum get `client_outdated` | 2026-11-23 | brief ("version skew"); this design |
| The compact index is the 14a graph response with `id`, `v` and `files` added, kept whole; the graph offline is drawn from it, with unsent changes laid over it | 2026-11-23 | brief ("the same index feeds the graph"); [stage 14 §10](stage-14-graph.md#10-offline-stage-15) left the choice here |
| Recent: the last 30 entries, 5 maps and 5 chronicles opened; plus pinned ("Keep offline") items | 2026-11-23 | author's "last few files I opened"; numbers by this design (open question 2) |
| A budget for bodies and images, 250 MB by default, set in Settings; unsent changes, the index and pinned items never evicted | 2026-11-23 | brief ("never evict an unsent change"); this design |
| Image upload, paste and drop need a connection | 2026-11-23 | this design, as [stage 12](stage-12-entries-editor.md#non-goals) asked (open question 1) |
| A new entry's path clash found on reconnect becomes a kept copy | 2026-11-23 | brief; this design changes `check()` so it is not refused |
| Item clashes keep the other side as a kept copy of the draft, compared per item | 2026-11-23 | brief's ideal; [stage 11 Risks](stage-11-foundations-shell-tree.md#risks--mitigations) |
| Entry text clashes stay kept copies; no automatic text merge | 2026-11-22 | stage 11, Alternative C |
| Comments stay online-only | 2026-11-23 | this design; stage 11 G4 left it here |
| Logout wipes the queue, the device copy, the caches and the service worker | 2026-11-22 | brief; stage 11 Non-Functional Requirements |

## Critical User Journeys (CUJs)

### CUJ 1: Install on the iPhone and keep the library

- **Covers:** G2, G5, G6.
- **Given**: Frontier open in Safari on his iPhone, signed in, never installed.
- **When**: he opens Settings, reads "On this device", follows the card's steps (Share, then "Add to
  Home Screen"), opens Frontier from the Home Screen, logs in once, opens Harbor, Mira and the Coast map,
  and chooses "Keep offline" on Mira.
- **Then**: the card said: "On iPhone, Frontier keeps its offline copy only when it is on your Home
  Screen. The Home Screen app has its own storage: send any waiting changes from here first, and log in
  once there." In the installed app, "On this device" shows "Storage kept: yes", "Space used: 41 MB of
  250 MB", and lists Mira (pinned), Coast and Harbor (recent) with their sizes.

### CUJ 2: An entry on a train with no signal

- **Covers:** G1, G4, G5, G7.
- **Given**: the installed app, used yesterday online; Harbor among the recent entries. Now no signal.
- **When**: he opens Frontier from the Home Screen, presses the switcher, types "harb", opens Harbor,
  presses Edit, writes a paragraph with `[[Old` and picks "Old Quay" from the completion, then goes back
  to the reader.
- **Then**: Frontier opened at once, signed in, with "Not connected" in the connection mark. The switcher
  listed every entry by name. Harbor showed "Offline copy from yesterday, 18:40". The completion listed
  "Old Quay", which is not on the device. The connection mark reads "Not connected · 1 change waiting".
  When the signal returns, the change is sent without his doing anything, and the count goes.

### CUJ 3: A new entry offline, and a clash

- **Covers:** G8, G4.
- **Given**: no connection; at home the laptop is online.
- **When**: on the phone he chooses New entry, types "Gull", picks `02 People`, writes "Sister of
  [[Mira]]." Meanwhile, on the laptop, he makes `02 People/Gull.md` too and saves a version. The phone
  reconnects.
- **Then**: offline, the new-entry dialog accepted "Gull" (no entry has that path in the compact index or
  the queue) and refused "Mira" ("An entry named Mira is already in 02 People"). Gull showed in the tree
  and in Mira's local graph, marked unpublished. After reconnecting, the server kept the phone's text
  beside a draft of the laptop's Gull, and the phone says "Gull: two texts to compare". Nothing is lost.

### CUJ 4: A map on the train, changed at home too

- **Covers:** G9, G10.
- **Given**: the Coast map kept on the phone; no connection.
- **When**: on the phone he moves the marker "Lighthouse" and adds a marker "Wreck". At home, the laptop
  renames "Lighthouse" to "Old Light" and saves a version. The phone reconnects.
- **Then**: the queue merged the two copies: "Wreck" was added, and "Lighthouse" was changed on both
  sides. The phone's side was kept in the map, and the laptop's side was kept beside it. The notice
  reads "Coast: changes from another device were merged in. Changed in both places: Lighthouse. Compare".
  Compare opens the map's kept copy as a list of items. He chooses the other side's version of the
  marker (name "Old Light", the old place). The map then holds "Old Light" at the old place, plus
  "Wreck".

### CUJ 5: Something not on the device

- **Covers:** G7, G11.
- **Given**: no connection.
- **When**: he follows a link to "Shade", which is not kept; opens search and types "lantern"; opens the
  entry menu on Harbor.
- **Then**: Shade's page reads "Shade is not on this device. It opens when you are connected." and shows
  its folder and links from the compact index. Search reads "Searching the 31 entries on this device. Full
  search needs a connection." and lists the kept entries that mention a lantern. In the menu, Rename and
  Move read "Needs a connection" and are disabled; "Keep offline" works.

### CUJ 6: A new version while changes wait

- **Covers:** G3.
- **Given**: the installed app; two changes waiting; a new Frontier is deployed.
- **When**: the connection returns; later he presses Reload in the update bar.
- **Then**: the changes were sent first; only then "A new version of Frontier is ready · Reload"
  appeared. Had the new server needed a newer app for those writes, the bar would have read "Frontier was
  updated. Reload to send your 2 changes." and, after Reload, the new version sent them.

### CUJ 7: Logout on a borrowed laptop

- **Covers:** G12.
- **Given**: a laptop at a friend's, with 3 entries kept and one change waiting.
- **When**: he logs out.
- **Then**: Frontier warns "1 change is not sent yet … Log out and lose them". After he agrees, the app
  reloads to the login page. The browser holds no Frontier data, cache or service worker.

### CUJ 8: The graph offline

- **Covers:** G4.
- **Given**: no connection; Gull made offline (CUJ 3) and not yet sent.
- **When**: he opens Graph from the side bar, then Mira's Graph tab.
- **Then**: the whole graph is drawn from the compact index, with Gull as a dashed node linked to Mira.
  A line over the canvas reads "Offline copy from 08:12".

## Technical Plan (Architecture)

### Shape of the change

```text
 Browser                                                              Server
 -------------------------------------------------------------        -------------------------------
 Service worker (15a)  navigations  -> precached index.html
                       /assets/*    -> precache (Workbox)
                       /api/images  -> "frontier-images" cache, if kept; else network
                       everything else: not answered (straight to the network)
 Pages -> api.ts  read: network ------------------------------------> GET /api/... (as today)
                  on no answer: device copy (IndexedDB "answers")      + frontier-build header
                  or an answer made from the compact index            GET /api/graph + id, v, files (15b)
            write: save queue (as today) ---------------------------> PUT drafts/maps/chronicles/
                  carries frontier-build, frontier-api                 library files; client_outdated
 Keeper (15b): recent and pinned items, budget, refresh, images       /sw.js, /manifest.webmanifest
 Updates (15a): waiting worker, update bar, outdated pause            FRONTIER_SERVICE_WORKER=off
```

### 1. The service worker and the app shell (15a)

**Built with `vite-plugin-pwa`, `injectManifest` strategy.** Our own worker source,
`apps/web/src/sw/sw.ts`, is bundled by the plugin, which writes the list of built files with their hashes
into it (`self.__WB_MANIFEST`). The worker uses three Workbox modules: `workbox-precaching`
(`precacheAndRoute`, `cleanupOutdatedCaches`, `createHandlerBoundToURL`), `workbox-routing`
(`registerRoute`, `NavigationRoute`) and `workbox-strategies` (`StaleWhileRevalidate`). The plugin also
writes the manifest (§2). Its own registration script is off (`injectRegister: false`); the app registers
through `virtual:pwa-register` with `registerType: "prompt"` (§3). The worker is off in `vite dev`
(`devOptions.enabled: false`), so development is unchanged.

**What it answers.** The rules live in a pure function, `routeOf(request)` in
`apps/web/src/sw/routes.ts`, that the worker calls and the unit tests check:

| Request | Answer |
| --- | --- |
| A navigation (`mode: "navigate"`) to any path but `/api/…` and `/health` | the precached `index.html` (the app then routes) |
| A precached file (`/assets/*.js`, `*.css`, the icons, the manifest) | the precache |
| `GET /api/images?path=…&w=…` (no `branch`) whose exact address is in the `frontier-images` cache | that copy, refreshed from the network in the background (`StaleWhileRevalidate` limited to that cache) |
| The same, not in the cache, while the network fails | a copy of the same `path` at any other width in the cache, else the network's failure |
| Anything else: every other `/api/` request, every non-GET request, `/api/session`, `/api/login`, `/api/passkeys/*`, `/api/settings*`, `/api/status`, `/api/status/events`, `/health`, `/sw.js` | not answered: the browser goes to the network as if there were no worker |

So the worker never answers a data request, and every failure to reach the server still reaches
`api.ts` and the connection service as a failure. Images are the exception because `<img>` and the map's
image loader do not go through `api.ts`, and an image never tells the connection anything.

**The precache** holds every file Vite builds: `globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"]`,
including the lazy map, chronicle and graph chunks, so every page opens offline. The largest chunk sets
`maximumFileSizeToCacheInBytes` (5 MB). As a side effect, a tab left open across a deploy keeps loading
its own lazy chunks from the precache instead of failing on files the deploy removed.

**Registration.** `apps/web/src/offline/updates.ts` registers `/sw.js` (scope `/`) after the first page
has drawn, and only in a production build. A browser without service workers runs as today.

**Server headers** (`apps/server/src/app.ts`):

- `/sw.js`, `/index.html` (also when served for `/` and by the not-found handler, as today),
  `/manifest.webmanifest` and `/build.json`: `cache-control: no-cache`, so an update is seen at once.
- `/assets/*` (hashed names): `cache-control: public, max-age=31536000, immutable`.
- Through `@fastify/static`'s `setHeaders`.
- CSP gains `worker-src 'self'` and `manifest-src 'self'`. Both are already allowed by
  `default-src 'self'`; naming them keeps them allowed if `default-src` is ever narrowed. The worker is
  one bundled file with no `importScripts` from elsewhere, so `script-src 'self'` holds.

**Kill switch.** With `FRONTIER_SERVICE_WORKER=off` in the server's environment (read in
`apps/server/src/config.ts`), `GET /sw.js` answers a fixed worker written in the server's code instead of
the built file. That worker:

1. deletes every Cache Storage cache whose name starts with `workbox-` or `frontier-`;
2. unregisters itself;
3. reloads every page it controls with `client.navigate(client.url)`.

It never touches IndexedDB, so the queue and its unsent changes stay. Browsers check `/sw.js` on every
navigation (at most once a day is allowed, and `no-cache` makes it every time), so the switch takes
effect at the next page load, or at a reopen of the installed app. The app also skips registration
while `/build.json` says `"worker": false`. Turning the switch off again lets the next load register
the normal worker.

### 2. Installing: the manifest and the icons (15a)

**The manifest** (`/manifest.webmanifest`, written by the plugin from `vite.config.ts`):

```json
{
  "name": "Frontier",
  "short_name": "Frontier",
  "description": "Writing Avalymia",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#f7f3ea",
  "theme_color": "#f7f3ea",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

The colours are the page colour `--paper` of `apps/web/src/styles.css`. `index.html` gains
`<link rel="manifest">`, `<link rel="icon" href="/icons/icon.svg">`, `<link rel="apple-touch-icon"
href="/icons/apple-touch-icon.png">` (180 px, which iOS reads instead of the manifest's icons), and two
`theme-color` metas: `#f7f3ea`, and `#171512` with `media="(prefers-color-scheme: dark)"`.

**The icons.** The repository has no app icon today, so one mark is drawn: the lucide `Compass` glyph,
already in the app (`apps/web/src/components/tree/folderIcons.ts`), in the accent colour `#9a3b1c` on the
paper colour, as `apps/web/public/icons/icon.svg`. The maskable icon keeps the glyph inside the middle
80%. A small script, `apps/web/scripts/icons.mjs`, makes the PNGs from the SVG with `sharp` (already a
server dependency). It is run by hand, and the PNGs are committed, so the build does not depend on it.

**Installing on an iPhone.** iOS has no install prompt. In Settings, "On this device" shows a card while
the app runs in Safari on an iPhone or iPad and not standalone (`navigator.standalone !== true` and not
`matchMedia("(display-mode: standalone)")`). The card gives the steps and says the Home Screen app has
its own storage, separate from Safari's: changes waiting in Safari stay there, so he should send them
first, and he logs in once in the installed app. The same card shows once as a dismissible notice the
first time he pins an item in Safari on an iPhone. Android and desktop Chrome get the browser's own
install offer; Frontier adds no button.

### 3. Updates and version skew (15a)

**Build id.** `vite.config.ts` makes one id per build (the build time in UTC and 6 random characters,
for example `20261123T0812-k3v9x2`). It is compiled into the app as `__FRONTIER_BUILD__`, and written to
`dist/build.json` as `{ "build": "…", "api": 1 }`. The server reads that file once at start. It sends
`frontier-build: <id>` on every `/api/` answer, and `build.json` also carries the kill switch's
`"worker": false` (§1).

**Client API number.** `packages/schema/src/client.ts`: `CLIENT_API = 1`, the shape of writes this
build sends, and `MIN_CLIENT_API = 0`, the oldest the server accepts. The rule, written beside them:
raise `CLIENT_API` when a write request changes shape or meaning so that an older server would
misread it. Raise `MIN_CLIENT_API` to an older number only when the server can no longer accept that
shape. Nothing in this stage needs a raise: every change it makes to a write is optional (§9).

**Headers.** `headers()` in `apps/web/src/api.ts` adds `frontier-build` and `frontier-api` to every
request, beside the device headers. The queue sends through the same `api` functions, so its sends carry
them too.

**The refusal.** A server hook (`onRequest`, after the session check) reads `frontier-api` on every
`/api/` request that is not a GET. A missing header counts as 0 (builds before 15a). A number below
`MIN_CLIENT_API` is refused with the new code `client_outdated` (409, "Frontier was updated. Reload to
send your changes."). GETs are never refused, so an old app can still read. In the queue's answer table
(`failed()` in `queue.ts`), `client_outdated` is a new row: the record stays `waiting` with no extra try,
sending pauses for every record, and the queue tells the update service, which shows the outdated bar
(below).

**Noticing a new version.** `api.ts` compares each answer's `frontier-build` with its own. When they
differ, it asks the update service to check, at most once every 10 minutes. The check calls
`registration.update()`, which also runs when the app regains focus.

**The update bar** (`apps/web/src/components/UpdateBar.tsx`, a strip above the page, in the shell):

| State | What shows |
| --- | --- |
| A new worker is waiting and the queue is empty | "A new version of Frontier is ready" with Reload and Later. Later hides it until the next check finds a newer one or the app restarts |
| A new worker is waiting and the queue holds records | nothing; it appears once the unsent list is empty |
| The server refused a write with `client_outdated` | "Frontier was updated. Reload to send your N changes." with Reload, whatever the queue holds |

Reload sends the waiting worker `{ type: "SKIP_WAITING" }`; the worker calls `skipWaiting()`, and every
open Frontier tab reloads on `controllerchange`. If no worker is waiting (the service worker is off, or
the update was not downloaded yet), Reload calls `registration.update()` and then reloads the page. The
worker never calls `skipWaiting()` by itself.

**Why a reload is safe with changes waiting.** The queue's records are written to IndexedDB on every
`put`, so a reload loses nothing typed. The one danger is a new build that cannot read the old build's
records. So the database keeps its records' shape across builds: a new field is optional, and a change of
shape is an IndexedDB version upgrade that converts the records. A unit test opens a database written in
the 15a record shape with the new code (§ Verification).

### 4. Starting offline while signed in (15a)

Today the start asks `/api/session`, and any failure shows the login page. From 15a:

- after a successful login, or a session check that says logged in, the app writes `signedIn: true`
  to the queue database's `meta` store;
- at start, when `/api/session` cannot be reached (an `ApiFailure` with status 0) and `meta` holds
  `signedIn`, the app opens as signed in, with the connection service in `offline`;
- when the server is reached again and says 401, the connection service turns `signed-out`. The queue
  pauses, and the login dialog opens over the page, as stage 11 built. Nothing is cleared;
- logout removes `signedIn` with everything else (§11).

The session cookie lasts 30 days. An expired session found on reconnecting pauses the queue as above.
The device copy is readable offline without the server's check. Who can open the device can read what
is kept on it, which is why logout wipes it (Risks).

### 5. What is on the device (15b)

**Where.** The queue's IndexedDB database `frontier` goes from version 1 to 2 (`openStore` in
`apps/web/src/sync/db.ts`). The upgrade adds two stores and leaves `queue` and `meta` as they are:

| Store | Key | Value |
| --- | --- | --- |
| `answers` | the request's address, normalised (`/api/entries?path=…`) | `{ url, at, build, body, bytes, item? }`: a successful read's parsed JSON, when it was read, by which build, its size, and the kept item it belongs to |
| `items` | `entry:<path>`, `map:<id>`, `chronicle:<id>` (the queue's keys) | `{ key, pinned, opened, bytes, images: string[] }`: when it was last opened, its total size, and the image addresses kept for it |

Images are kept in Cache Storage, in the cache `frontier-images`, which the service worker reads (§1).
The precache is Workbox's own cache.

**Always kept** (written after every successful read, whatever the item):

- **the compact index:** `GET /api/graph`;
- the tree `GET /api/tree`;
- the lists `GET /api/maps`, `GET /api/chronicles`, `GET /api/marker-sets`;
- `GET /api/schema`;
- the library item files `GET /api/library-files/folders` and (with 13d) `map-styles`.

They are small (the index is about 90 KB for the real library), together under 1 MB.

**The compact index is the 14a graph response with three more fields.** 14a's `GraphResponse` already
holds every entry's path, title, type, aliases and whether it is unpublished, its resolved links to other
entries as edges (published links, with each draft changing only itself), and the folders with their
colours. This stage adds, in `packages/schema/src/graph.ts` and `apps/server/src/index/graph.ts`:

- `nodes[].id?`: the entry's `id` field when it has one, so a map feature's linked entry can be named;
- `nodes[].v`: a version mark, the first 12 characters of the library file's blob, then `.` and the
  draft's revision when there is a draft (`"3f9a0c21be77.4"`). It tells the device which kept bodies
  changed without asking for each one;
- `files: string[]`: the paths of every library file that is not a note (images and other files),
  outside the excluded folders, plus unpublished uploads. With the nodes, they let the browser resolve
  links and embeds with `createResolver` from `@frontier/vault`, the resolver the server's index uses.

One route then serves the graph screen, the local graph and the device; there is no second builder.
The graph is drawn from the kept response offline (§10).

**Kept items.**

- **Recent:** opening an entry (its reader or editor), a map or a chronicle makes it recent, with
  `opened` set to now. The device keeps the last 30 entries, 5 maps and 5 chronicles opened. Entries are
  text and small; maps carry large images.
- **Pinned:** "Keep offline" in the item's "⋯" menu (entry page, editor, map page, chronicle page), and
  in the Settings list, pins it. A pinned item is kept until unpinned, whenever it was opened. Pinning is
  per device, kept in `items`, and never sent to the server.
- **What a kept item's body is:**
  - an entry: `GET /api/entries?path=` (text, draft id and revision, blob, links resolved, backlinks,
    headings, fields, maps, chronicles), and the images it embeds at the reader's width (1280);
  - a map: `GET /api/maps/:id` (map, revision, blob, entry names), its images at the width this device
    asks for (`mapImageUrl(path, 2560 | 4096)`, as `MapPage.tsx` chooses), and the marker icons its
    features use;
  - a chronicle: `GET /api/chronicles/:id` (chronicles carry no images).

**The keeper** (`apps/web/src/offline/keeper.ts`) runs in one tab, the one holding the sender's lock
`frontier-sender`, so two tabs do not fetch the same things:

- after a kept item's body is read, it fetches the item's images that are not yet in `frontier-images`,
  one at a time, and adds their sizes to the item;
- **refresh while online:** at start, on each status-stream snapshot whose `indexCommit` or
  `unpublished` count changed, and when the queue's list changes, it reads the compact index again. Then
  it reads again, one request at a time and only while online:
  - each kept entry whose node's `v` differs from the kept answer's (`draft.revision` and `blob`);
  - each kept map and chronicle whose list entry changed;
  - each pinned item's images.

  It skips any item with a record in the queue, since the editor's own state is newer.
- **evicts** (below) after each change.

**The budget.** Settings offers 100 MB, 250 MB (the default), 500 MB and 1 GB for kept bodies and
images, kept in `meta`. The app shell (about 3 MB), the always-kept answers and the queue are outside it.

**Eviction**, run after every write to the device copy and at start:

1. never evicted: queue records (with their `base` copies), the always-kept answers, the precache,
   and any item with a queue record;
2. a recent item beyond its count (the 31st entry, the 6th map) goes, unless pinned;
3. while kept bytes exceed the budget, the least recently opened recent item goes, then the next;
4. pinned items are never evicted by Frontier. When they alone exceed the budget, Settings shows
   "Pinned items need 312 MB; the budget is 250 MB", and pinning more is refused with the same words;
5. an image goes when no kept item lists it.

When `navigator.storage.estimate()` reports less than 10% of the quota free, recent items are evicted
until 20% is free, and Settings says so.

**Keeping storage.** `navigator.storage.persist()` is asked:

- when the installed app first starts (`display-mode: standalone`);
- when the author first pins an item;
- from "Keep storage" in Settings.

The answer (`navigator.storage.persisted()`) is shown as "Storage kept: yes" or "no, the browser may
clear it when space is short". Safari on iOS keeps a Home Screen app's storage. In Safari itself it
clears script-written storage after about 7 days without use whatever is asked. That is why the card
in §2 exists. A browser without `navigator.storage` shows "Not known".

**When IndexedDB cannot be opened** (some private windows), the queue already runs in memory. The device
copy is then off: nothing is kept, reads behave as today, and Settings says "This browser does not let
Frontier keep anything on this device."

### 6. Reading offline (15b)

**A read-through layer in `api.ts`.** `call()` gains one step for GET requests to the routes in the table
below, through `apps/web/src/offline/device.ts`:

- **the network answers:** the answer is returned as today and, when the route is kept, written to
  `answers` (for an item body, only when the item is kept; opening it makes it recent, so a body read
  by its page is always written);
- **the network fails** (`ApiFailure` status 0, the case that already calls `connection.unreachable()`):
  the device answer is returned instead, if there is one;
- **the network is slow:** when a device answer exists, the request waits at most 6 seconds. After that
  the device answer is returned, `connection.unreachable()` asks the server once, and the late network
  answer, if it comes, still updates the device copy. Without a device answer, the request waits as
  today;
- **a 4xx or 5xx answer** is never replaced by the device copy: the server answered, so it is shown;
- **a new build:** device answers carry the build id that wrote them. When the server is reached and the
  app's build id differs from the one that wrote them, they are dropped and read again, so a route that
  changed shape is never read in its old shape by a new app.

| Route | Offline answer |
| --- | --- |
| `/api/graph`, `/api/tree`, `/api/maps`, `/api/chronicles`, `/api/marker-sets`, `/api/schema`, `/api/library-files/:name` | the kept answer, with unsent creates and deletes from the queue laid over the tree and the graph (below) |
| `/api/entries?path=`, `/api/maps/:id`, `/api/chronicles/:id` | the kept answer if the item is kept; else `ApiFailure(0, "not_on_device", …)` |
| `/api/switcher?q=` | made from the compact index by `rankNames` (below) |
| `/api/preview?path=` | made from the kept entry's text by `previewOf` (below); else "not on device" |
| `/api/images/find?name=&from=` | resolved with `createResolver` over the index's nodes and `files` |
| `/api/search?q=` | the kept entries whose title or text contains the words, with a snippet, and `{ partial: N }` |
| everything else | no offline answer: the failure as today |

**One rule in two places becomes one function.** The server's switcher ranking (`/api/switcher` in
`apps/server/src/routes/search.ts`) and its preview cut (600 characters at a word boundary, after the
front matter) move to `@frontier/vault` as `rankNames(notes, query, appendices)` and
`previewOf(text)`. The route calls them, and the device answer calls the same code, so the offline
switcher orders names as the online one does.

**Unsent changes laid over the index and the tree.** From the queue's records (`queue.current()`):

- a `create` record adds a node (title from the file name, `unpublished: true`) and a tree note (state
  `unpublished`);
- a `delete` record removes them;
- an `edit` or `create` record's text replaces that node's own outgoing edges, found with `findLinks`
  and resolved with `createResolver`, as 14a's server does for a draft.

No other node's links are resolved again, which is 14a's rule.

**Marking device answers.** The device layer records each answer object it returns in a
`WeakMap<object, number>` of the time it was kept. `servedFromDevice(value)` reads it. The entry page,
the editor, the map page, the chronicle page and the graph show one line from it,
`<OfflineCopy at={…} />`: "Offline copy from 14:05" (or "from yesterday, 18:40", or a date). Lists, the
tree and the switcher show nothing more: the connection mark already says "Not connected".

**Not on this device.** A page whose body is not kept shows `Problem` with "<Name> is not on this device.
It opens when you are connected.", the entry's folder, and its links out and in from the compact index,
each a link. A hover preview of such an entry reads "Not on this device".

**Back online, before the first edit.** The editor opened from a device answer (`servedFromDevice`)
listens to the connection. When it turns `online` and the queue holds no record for the entry, it reads
the entry again. If the draft id, revision or blob differ from what it opened with, it replaces the text
and the known base, as the existing "coming back to this tab" check in `Edit.tsx` does, and says "Updated
from the server". If a record exists, nothing is replaced: the record carries the base it started from,
and the server keeps a kept copy if that base has moved on (stage 11 §2). The map and chronicle pages do
the same with their loaded copy when no record exists. With a record, the queue's merge covers them.

### 7. "On this device" in Settings, and "Keep offline" (15b)

A new block in `apps/web/src/pages/Settings.tsx`, "On this device", which works offline:

- the iPhone card (§2) when it applies;
- "Storage kept: yes | no | not known", with "Keep storage" when no;
- "Space used: 41 MB of 250 MB" (kept bodies and images) and the browser's estimate of Frontier's total;
- the budget choice;
- the kept items, pinned first, then recent by last opened: name, kind, size, "Pinned" or "Recent",
  with "Keep offline" or "Stop keeping" and, for recent items, "Remove";
- "Remove everything kept on this device", which keeps unsent changes and says so.

"Keep offline" in an item's "⋯" menu is a checkable item. Pinning while offline pins only an item whose
body is already kept.

### 8. Writing offline (15b and 15c)

Writes already go through the queue, which keeps them until the server confirms them. What offline needs
is the page to open (§6) and the rules below.

| What | Offline | Release |
| --- | --- | --- |
| Edit a kept entry | yes: the editor opens from the device answer; `queue.put` as today, with the kept draft id, revision and blob | 15b |
| Delete an entry (a delete draft) | yes, through the queue as today | 15b |
| New entry | yes (below) | 15c |
| Edit a kept map or chronicle | yes: the page opens from the device answer; its `revision`, `blob` and value are the base of the first record | 15b |
| Link a map feature or chronicle span to an entry | yes: by path through the record's `link`, as today; the entry combobox lists names from the compact index | 15b |
| Folder file: new empty folder, order, icon, colour, type | yes, through the queue as today | 15b |
| Map styles file (13d) | yes, through the queue as today | 15b |
| Rename, move, folder delete, apply a folder's type | no: "Needs a connection" | as today |
| Create, copy, delete a map or chronicle; make a chronicle the main one | no: "Needs a connection" | 15b disables them |
| Image upload, paste, drop, import from a web address | no (below) | 15b disables them |
| Comments, AI, discoveries, history, export, import, inbox, Save a version, Discard a draft | no: "Needs a connection" | 15b disables the remaining ones |

Controls that are direct calls already read `useNeedsConnection()` (stage 11) in ten places. 15b adds it
to every remaining direct call that a page offers while offline, found by listing the non-GET calls in
`api.ts` that do not go through the queue.

**New entries offline (15c).**

- `NewEntry.tsx` takes its folders from the tree (kept). When offline, it checks the name against the
  compact index and the queue's `create` records, ignoring letter case as the file system of an export
  may: "An entry named Mira is already in 02 People". Stage 12's `checkEntryName` gives the rules for a
  safe name; the dialog uses it once 12a has landed.
- `Edit.tsx` today treats only a 404 as "a new entry". When the read fails with no connection and the
  compact index has no node at the path, it starts a new entry as for a 404: `kind: "create"`,
  `baseBlob: ""`, and the folder's type written into the front matter from the kept folder file.
- **A clash found on reconnect.** The server must keep the text, not refuse it. Today `check()` in
  `apps/server/src/routes/drafts.ts` refuses a `create` at a published path unless the save "may be
  stale", which it decides by `revision > 0 && baseBlob !== undefined`. 15c widens that to `baseBlob !==
  undefined && (revision > 0 || kind === "create")`. A create from a device that sends a base (every
  build since 11a-2) then reaches `DraftStore.save`, which already handles it: no draft and `baseBlob`
  `""` differing from the published blob gives a draft of the library's text, this text as the device's
  kept copy, and `stale_revision`. The queue already turns that into "Gull: two texts to compare". When
  the path holds another device's unsent create (a draft with another id), `save` already keeps the text
  as a kept copy. A create from a build without `baseBlob` is refused as today.

**Images: need a connection.** While offline, the editor's image button, the image dialog's Upload,
Paste image and web address, and paste or drop of an image into the editor are disabled or refused:
"Images need a connection. Your text is kept." Text paste works. The reasons:

- the author did not ask for it; he asked for text, new entries, maps and chronicles;
- the server names an upload (`nextFreeName` over the whole library), and the embed in the text names
  the file. An offline upload would need a name chosen on the device, a send that must reach the server
  before the text that embeds it, and a rewrite of every waiting text when the server picks another name;
- photos from a phone are several megabytes each and would sit in the queue, on the device that has the
  least storage.

A design for it, if the author wants it, is under "Future improvements" (open question 1).

### 9. Conflicts by kind (15c)

| Kind | When both sides changed it | Where it is settled |
| --- | --- | --- |
| Entry text | the server keeps this device's text beside the draft (one kept copy per device), `stale_revision` (stage 11, exists) | `/versions/:id`, two texts compared (exists) |
| New entry at a taken path | the same, through the `check()` change in §8 | the same |
| Map, chronicle, folder file, map styles file: different items changed | the queue merges item by item from the stored `base` (exists) | nothing to settle |
| The same item changed on both sides | the merge keeps this device's item, and from 15c the server keeps the replaced copy beside the draft as a kept copy | `/versions/:id`, compared per item (below) |
| A held-back clash at "Save a version" (the library changed under the draft) | "Keep mine" or "Take the vault's" (exists) | the Unpublished page (exists) |

**Keeping the other side of an item clash.** When the queue's `merge()` (in `queue.ts`) finds clashes, it
already sends the merged file with the server's revision. From 15c the send also carries
`clashes: string[]`, the keys of the clashing items. The routes `PUT /api/maps/:id`,
`PUT /api/chronicles/:id` and `PUT /api/library-files/:name` accept it as optional. When it is not
empty and the save is accepted, the store first copies the draft's current text, the other side, into
the draft's `versions/<device>` slot (the same `DraftStore.keep` that entry text uses, called before
`serverChange`). Its record gains `clashes`. So:

- the map holds this device's items, as today, and the other device's versions of the clashing items
  are kept, not lost;
- the attention count rises (kept copies are already counted), and the queue's notice links to
  `/versions/<draftId>` with "Compare";
- a second clashing merge from the same device replaces that device's slot, as for text. The slot
  holds the whole other copy, so nothing earlier is lost from it but the device's own previous
  clash, which the author has seen in a notice;
- for a library item file that has no draft yet (the first save after a version), the server makes the
  draft first, as it does now, and then keeps the copy.

Older builds do not send `clashes` and keep today's behaviour. No API raise is needed (§3).

**The compare screen for item files.** `/versions/:id` (`apps/web/src/pages/Versions.tsx`) reads the
draft and its kept copies as today. When the draft's path is a map (`.frontier/maps/…`), a chronicle or a
library item file, it parses both texts with that kind's parser and shows, for each key in the kept
copy's `clashes`:

- the item's name (a feature's or span's label, a folder's path, a style's name);
- a small table of the fields that differ: "This map now" and "<device name>, <time>". Positions are
  shown as "moved" with a "Show on map" link to `mapUrl(id, feature)`;
- a choice per item: "Keep this map's" (the default) or "Use the other".

"Done" builds the file from the current draft with the chosen items replaced (an item the other side
removed is removed) and calls `POST /api/drafts/:id/merge-versions` with its text. That route today
refuses anything but a note (`onlyNotes`). From 15c it accepts a draft of a map, a chronicle or a library
item file when the text parses as that kind, and saves it as it does for text: revision raised, kept
copies dropped. Done is refused while the queue holds a record for the same file ("Wait until your
changes are sent"), because the page would replace a change on its way. After Done, the open map or
chronicle page and the library file client read the file again. This is the minimal compare: a list of
items with a choice each, no drawing of both versions on the map.

### 10. The graph and other views offline (15b)

- **The graph** (14a's `graph/data.ts`) reads `api.graph()`, which offline returns the kept compact index
  with unsent creates, deletes and edited links laid over it (§6). New entries made offline are drawn
  dashed, as unpublished. The screen and the Graph tab show `<OfflineCopy>` over the canvas.
  [Stage 14 §10](stage-14-graph.md#10-offline-stage-15)'s "The graph needs a connection" now shows only
  when no compact index is kept (a first visit offline).
- **Links in a kept entry** are as the kept answer resolved them. A link to an entry that is not kept
  opens its "not on this device" page.
- **`[[` completion and the switcher** use `/api/switcher`, answered from the index (§6).
- **The tree** is the kept tree with unsent creates and deletes laid over it.
- **The map page** shows linked entries' names from the kept map answer's `entries`, and for links made
  offline from the compact index.
- **The status counts** (unpublished, inbox, attention) show the last snapshot received.

### 11. Logout (15b; the warning exists)

`logout()` in `apps/web/src/components/Shell.tsx` already warns when changes are unsent, calls
`/api/logout`, and clears the queue and the device id. From 15b it then calls `wipeDevice()` in
`apps/web/src/offline/device.ts`, which:

- clears the `answers` and `items` stores and removes `signedIn` from `meta`;
- deletes every Cache Storage cache whose name starts with `frontier-` or `workbox-`;
- unregisters the service worker;
- clears `sessionStorage`;
- reloads to `/login`.

`localStorage` keeps only display settings (side bar width, preview mode, graph depth), which say
nothing about the library, and they stay. Logout offline still wipes the device; the server's session
ends when it next sees the cookie expire, or at the next logout.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A broken service worker keeps serving a broken app | The worker answers only navigations, built files and kept images; `/sw.js` is never cached and is checked on every load; the kill switch (§1) removes it without touching the queue |
| The service worker hides an offline server, so the app thinks it is online | It never answers `/api/` data, the status stream or any non-GET request (§1); the connection service sees every failure as today |
| An update reloads while the author types | The worker never skips waiting by itself; Reload is the author's; the offer waits for an empty queue (§3) |
| A new build cannot read the old build's queue records | Records keep their shape across builds; changes are IndexedDB upgrades that convert them; a test opens a 15a-shaped database with the new code |
| An old app writes a shape the new server misreads | The client API number on every write; `client_outdated` holds the queue until the reload (§3) |
| Safari clears storage after 7 days, unsent changes included | The Home Screen card, `persist()`, and "Storage kept" shown in Settings; the author's accepted condition. Checked by hand on a real iPhone; CI runs Chromium only |
| The Home Screen app does not share Safari's storage, so changes waiting in Safari are not in the app | The card says to send waiting changes before switching, and to log in once in the installed app |
| Kept bodies go stale and the author edits an old copy | The refresh by `v` while online (§5); the re-read before the first edit after reconnecting (§6); a stale save becomes a kept copy, never an overwrite (stage 11 §2) |
| A slow connection makes every page wait | Reads with a device answer wait at most 6 seconds, then show the device copy marked (§6) |
| Storage fills up | The budget, eviction order and the 10% check (§5); pinned items above the budget refuse more pins with the reason |
| An evicted body was about to be edited | An item with a queue record is never evicted; the editor's text is in the queue on every keystroke |
| Someone with the device reads the kept library | The same as any signed-in browser; logout wipes everything (§11); the 30-day session pauses writes when it ends |
| A new entry made offline clashes with one made elsewhere | Checked against the index and the queue at creation; a later clash becomes a kept copy (§8) |
| An item clash after days offline silently drops the other side | The other side is kept and compared per item (§9) |
| The precache is large on a phone | About 3 MB of built files; the map and graph chunks are among them so those pages open offline; listed in the build output |
| Two tabs fetch and evict the same items | Only the tab holding the sender lock runs the keeper (§5) |
| The read-through layer serves a device answer for a route that changed shape after an update | Device answers are dropped when the build id changes and the server is reached; until then, the old app reads its own old answers |
| `vite-plugin-pwa` or Workbox lags Vite | One plugin and three small Workbox modules; the worker source is ours; if the plugin blocks a Vite upgrade, `injectManifest` is replaced by a small Vite plugin that writes the same manifest list (Alternative A) |
| The browser tests break when a service worker controls the page | Existing test projects block service workers; a separate `offline` project allows them (Verification Plan) |

## Alternatives Considered

### Alternative A: A hand-written service worker

- **Pros**: No new dependency; every line is ours.
- **Cons**: We would write the list of built files with their hashes into the worker at build time, keep
  one cache per build and delete old ones, serve `index.html` for navigations, and handle the
  waiting-worker life cycle and its messages. Each has known mistakes that leave users on an old build.
- **Reason for Rejection**: `injectManifest` keeps the worker ours (about 60 lines) and takes only the
  tested parts: the precache list, versioned caches and their cleanup, and the registration life cycle.

### Alternative B: Serve offline reads from the service worker (network first, cache fallback)

- **Pros**: No change in `api.ts`; every request is covered.
- **Cons**: A read answered by the worker looks like a success to the page, so the connection service
  thinks it is online (the brief's warning); the page cannot tell an old copy from a fresh one;
  derived answers (switcher, preview, image lookup) need the index inside the worker; per-item keeping
  and eviction would live in two places.
- **Reason for Rejection**: The read-through in `api.ts` knows the connection, marks the copy, and
  derives answers with the same functions the server uses.

### Alternative C: Keep the whole library on the device

- **Pros**: Everything readable offline; full search.
- **Cons**: About 430 entries plus every map and image: hundreds of megabytes on a phone, and a refresh
  that never ends on a weak connection.
- **Reason for Rejection**: The author asked only for the last few files; the whole index is kept so
  names and links work everywhere.

### Alternative D: A separate `/api/offline/index` route for the compact index

- **Pros**: The graph response stays as 14a wrote it.
- **Cons**: Two builders of almost the same data from the same index, and two requests to keep.
- **Reason for Rejection**: Three optional fields on the 14a response make it the index; the graph offline
  is then the same answer.

### Alternative E: Queue images offline

- **Pros**: Pasting a photo offline would work.
- **Cons**: See §8: names chosen on the device, ordering between records, rewriting waiting texts,
  megabytes in the queue.
- **Reason for Rejection**: Not asked for; designed under "Future improvements" for when it is.

### Alternative F: Automatic three-way merge of entry text from a base copy kept on the device

- **Pros**: Fewer "two texts to compare".
- **Cons**: A wrong merge of prose is silent and worse than a shown conflict; the base text would be
  kept for every edited entry.
- **Reason for Rejection**: Stage 11 chose kept copies; offline makes clashes more frequent, not merges
  safer.

### Alternative G: Item clashes keep "mine" with a notice only (today)

- **Pros**: No server change.
- **Cons**: After a long offline gap the other device's change to that item is gone, named only in a
  notice.
- **Reason for Rejection**: The brief's ideal is that nothing typed is lost; one optional field and the
  existing kept-copy slot keep it.

### Alternative H: Update automatically when the queue is empty

- **Pros**: The author is always on the newest build.
- **Cons**: A reload while he reads or arranges a map, without warning.
- **Reason for Rejection**: The brief asks for the author's choice; the outdated refusal covers the case
  where he must update.

### Alternative I: Background Sync to send while Frontier is closed

- **Pros**: Changes leave as soon as a connection appears.
- **Cons**: Not on iOS, where the offline need is greatest; the sender would move into the worker.
- **Reason for Rejection**: The queue sends whenever Frontier is open, which is when the author works.

## Future improvements

Each can be added on its own if the author asks.

- **Images offline:** a queue record `image:<op>` holding the file as a Blob, with the name chosen on the
  device by `nextFreeName` over the index's `files` and other waiting images. An entry record that embeds
  it waits until it is sent. `POST /api/images` accepts the wanted name and an `op`, and answers the
  name it used. When that name differs, the queue rewrites the embed in every waiting record before
  sending them. Kept images count against a separate cap.
- **Comments offline** through the queue, with their anchors checked on send.
- **Links to entries that are not on the device** drawn with a faint mark while offline.
- **A three-way view on the compare screen** for text, when the device still holds the base.
- **Drawing both sides of a map clash on the map** instead of the item list.
- **A recent count the author sets,** and per-folder "Keep offline".
- **Background Sync** on browsers that have it.
- **Full-text search offline** with an index of the kept entries (MiniSearch, which the server uses).
- **Offline folder renames and moves,** if the server's link planning can run on the device.

---

## Detailed Implementation Plan

Three releases, in order. Each must pass the Verification Plan before it is merged and deployed. 15b
starts after 14a is merged; 13d is not required (the styles file is kept once it exists).

### Release 15a: the installable app

1. `apps/web/package.json` (Modify): `vite-plugin-pwa@^1` (dev; its 1.x line supports Vite 7, checked when
   added), `workbox-precaching@^7.3.0`, `workbox-routing@^7.3.0`, `workbox-strategies@^7.3.0`,
   `workbox-window@^7.3.0` (dev, for `virtual:pwa-register`'s types and runtime).
2. `apps/web/vite.config.ts` (Modify): the build id (`__FRONTIER_BUILD__` in `define`); `VitePWA` with
   `strategies: "injectManifest"`, `srcDir: "src/sw"`, `filename: "sw.ts"`, `registerType: "prompt"`,
   `injectRegister: false`, `devOptions.enabled: false`, the manifest of §2, `injectManifest:
   { globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"], maximumFileSizeToCacheInBytes: 5242880 }`;
   a small plugin writing `dist/build.json` (`{ build, api: CLIENT_API }`).
3. `apps/web/src/sw/sw.ts` (Create): `precacheAndRoute(self.__WB_MANIFEST)`, `cleanupOutdatedCaches()`,
   the navigation route to the precached `index.html` with `/api/` and `/health` denied, the kept-image
   route with its any-width fallback, `SKIP_WAITING` on message, never `skipWaiting()` otherwise.
   `apps/web/src/sw/routes.ts` (Create): `routeOf(request)` (§1), pure. `apps/web/src/sw/tsconfig.json`
   (Create): `lib: ["ES2023", "WebWorker"]`. `apps/web/tsconfig.json` (Modify): excludes `src/sw`.
   `apps/web/package.json` (Modify): `typecheck` also runs `tsc -p src/sw/tsconfig.json`.
4. `apps/web/src/sw/routes.test.ts` (Create): navigations to `/`, `/e/…`, `/map/x` go to the shell;
   `/api/…` navigations, every non-GET, `/api/session`, `/api/login`, `/api/passkeys/login/options`,
   `/api/settings`, `/api/status`, `/api/status/events`, `/health`, `/sw.js` and
   `/api/images?branch=…` are not answered; `/api/images?path=…&w=…` goes to the image route.
5. `apps/web/src/vite-env.d.ts` (Create): `/// <reference types="vite/client" />`,
   `/// <reference types="vite-plugin-pwa/client" />`, `declare const __FRONTIER_BUILD__: string`.
6. `apps/web/public/icons/icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
   `apple-touch-icon.png` (Create): §2. `apps/web/scripts/icons.mjs` (Create): makes the PNGs from the SVG
   with `sharp`.
7. `apps/web/index.html` (Modify): manifest, icon, apple-touch-icon and the two `theme-color` metas.
8. `packages/schema/src/client.ts` (Create): `CLIENT_API`, `MIN_CLIENT_API` and the rule for raising
   them. `packages/schema/src/index.ts` (Modify): exports it. `packages/schema/src/errors.ts` (Modify):
   `client_outdated: 409`.
9. `apps/server/src/config.ts` (Modify): `serviceWorker: boolean` from `FRONTIER_SERVICE_WORKER` (on
   unless `off`). `apps/server/test/config.test.ts` (Modify).
10. `apps/server/src/web.ts` (Create): `webRoutes(app, { webDir, serviceWorker })`: reads `build.json`;
    `GET /sw.js` (the built file, or the kill worker of §1 when off); `GET /build.json` (with
    `worker: false` when off); `setHeaders` for `@fastify/static` (§1). `apps/server/src/app.ts` (Modify):
    registers it beside `fastifyStatic`; the not-found handler's `index.html` keeps `no-cache`; the CSP
    gains `worker-src 'self'; manifest-src 'self'`; an `onSend` hook adds `frontier-build` to `/api/`
    answers; an `onRequest` hook after the session check refuses non-GET `/api/` requests whose
    `frontier-api` is below `MIN_CLIENT_API` with `client_outdated`.
11. `apps/server/test/web.test.ts` (Create), with a temporary `webDir` holding `index.html`, `sw.js`,
    `build.json` and `assets/a-123.js`: `no-cache` on `/`, `/index.html`, `/sw.js`, a page address and
    `build.json`; `immutable` on the asset; the CSP holds `worker-src 'self'`; with the switch off,
    `/sw.js` is the kill worker (it names `caches.delete` and `unregister`, never `indexedDB`) and
    `build.json` says `worker: false`; `frontier-build` on an `/api/` answer; a PUT with `frontier-api: 0`
    passes while `MIN_CLIENT_API` is 0 and is refused with `client_outdated` when the test raises it; a
    GET is never refused.
12. `apps/web/src/api.ts` (Modify): `frontier-build` and `frontier-api` in `headers()` (sent before the
    device is known too); compares each answer's `frontier-build` and asks `updates.check()`;
    `ApiFailure` for `client_outdated` passes through.
13. `apps/web/src/offline/updates.ts` (Create): registration through `virtual:pwa-register`
    (`onNeedRefresh`, `onRegisteredSW`), skipped in dev, without service workers, or when `build.json`
    says `worker: false`; `check()` at most every 10 minutes and on focus; `outdated()`; `reload()`;
    a small store `useUpdate()` giving `{ waiting, outdated }`. `apps/web/src/offline/updates.test.ts`
    (Create): the bar's three states from `waiting`, `outdated` and the queue's count; `check()`
    throttled.
14. `apps/web/src/components/UpdateBar.tsx` + `.css` (Create): §3's bar. `apps/web/src/components/Shell.tsx`
    (Modify): shows it above the page.
15. `apps/web/src/sync/queue.ts` (Modify): `client_outdated` in `failed()`: the record stays `waiting`
    without a try, sending pauses until reload, `onOutdated` listeners hear it.
    `apps/web/src/sync/queue.test.ts` (Modify): an outdated answer keeps every record and stops sending.
16. `apps/web/src/main.tsx` (Modify): starts `updates.register()` after the first render.
17. `apps/web/src/App.tsx` (Modify): §4: `signedIn` in `meta` after login or a good session check; an
    unreachable session check with `signedIn` opens the app offline. `apps/web/src/sync/db.ts` (Modify):
    `signedIn` read and written through `meta`. `apps/web/src/sync/db.test.ts` (Create, with fake-
    indexeddb): `signedIn` kept and cleared with `clearMeta`.
18. `playwright.config.ts` (Modify): `serviceWorkers: "block"` in the `phone` and `desktop` projects; a
    new project `offline` (Chromium at phone size, `serviceWorkers: "allow"`, `testMatch:
    /offline\.spec\.ts/`).
19. `apps/web/e2e/offline.spec.ts` (Create): after `navigator.serviceWorker.ready`, `context.setOffline
    (true)` and a reload shows the app signed in with "Not connected"; the manifest is linked and parses;
    a `context.route` that answers a draft save with `client_outdated` once shows "Frontier was updated.
    Reload to send your 1 change.", and after unrouting and Reload the change is sent.
20. `docs/designs/SITEMAP.md` (Modify): this design registered.

### Release 15b: the device copy

21. `packages/schema/src/graph.ts` (Modify): `GraphNode` gains `id?` and `v`; `GraphResponse` gains
    `files`. `packages/schema/test/schemas.test.ts` (Modify).
22. `apps/server/src/index/graph.ts` (Modify): fills `id`, `v` (blob prefix and draft revision) and
    `files` (non-note library files outside excluded folders, and unpublished uploads).
    `apps/server/test/graph.test.ts` (Modify): `v` changes with a draft save and with a version; `files`
    lists `99 Appendices/Images/lamp.png` and an unpublished upload, and not `.obsidian` files; `id` comes
    from the field.
23. `packages/vault/src/names.ts` (Create): `rankNames(notes, query, appendices)` and `previewOf(text)`,
    moved from `apps/server/src/routes/search.ts` (Modify), which calls them. `packages/vault/src/index.ts`
    (Modify). `packages/vault/test/names.test.ts` (Create): the ranking and the cut as the routes give
    them today (the route tests in `apps/server/test/search.test.ts` pass unchanged).
24. `apps/web/src/sync/db.ts` (Modify): database version 2 with `answers` and `items`, upgrading from 1
    without touching `queue` or `meta`; `Store` gains their reads and writes (the memory store keeps
    nothing). `apps/web/src/sync/db.test.ts` (Modify): a version 1 database with queue records and a
    device opens as version 2 with both kept.
25. `apps/web/src/offline/device.ts` (Create): the read-through of §6 (the kept routes, the 6-second
    wait, the device answers, `servedFromDevice`), the derived answers (switcher through `rankNames`,
    preview through `previewOf`, image lookup through `createResolver`, offline search), the overlay of
    unsent records on the index and the tree, `wipeDevice()`. `apps/web/src/offline/device.test.ts`
    (Create, happy-dom and fake-indexeddb): an answer kept on success and returned on failure, marked;
    a 404 never replaced; the slow network gives the device answer after 6 seconds (fake timers); the
    switcher from the index orders names as the server's `rankNames` does on the fixture; the overlay
    adds a create, removes a delete and replaces an edited note's edges only; device answers dropped when
    the build id changed.
26. `apps/web/src/api.ts` (Modify): `call()` uses the device layer for GET requests; `graph()` and
    `search()` types allow the offline extras (`partial`).
27. `apps/web/src/offline/keeper.ts` (Create): recent and pinned items, the counts (30, 5, 5), image
    keeping, the refresh by `v`, the budget, the eviction of §5, `persist()`, run in the tab holding the
    sender's lock. `apps/web/src/offline/keeper.test.ts` (Create): the 31st entry evicts the oldest; a
    pinned item and an item with a queue record are never evicted; over budget evicts by `opened`; an
    image shared by two items stays until both go; pinning over budget is refused; refresh fetches only
    entries whose `v` changed and skips those with a record.
28. `apps/web/src/components/OfflineCopy.tsx` + `.css` (Create): "Offline copy from …".
29. `apps/web/src/pages/Entry.tsx`, `pages/Edit.tsx`, `pages/MapPage.tsx`, `pages/ChroniclePage.tsx`
    (Modify): mark the item opened; show `OfflineCopy`; "not on this device" through `Problem` with links
    from the index; "Keep offline" in the "⋯" menu; the editor and the map and chronicle pages read
    again on reconnecting when no record exists (§6); online-only controls disabled with
    `useNeedsConnection()` (comments, history and export tabs, rename and move, map and chronicle
    create, copy, delete and make main, discoveries).
30. `apps/web/src/components/EditToolbar.tsx` (Modify), and stage 12's image dialog where it exists
    (Modify): the image button, upload, paste and web address disabled offline. `apps/web/src/pages/
    Edit.tsx` (Modify): paste or drop of an image (today `api.upload` at line 134) refused offline with
    "Images need a connection. Your text is kept." `apps/web/src/pages/Maps.tsx` (Modify): the new-map
    form (an upload and a create) disabled offline.
31. `apps/web/src/components/HoverPreview.tsx` (Modify): "Not on this device" for a `not_on_device`
    failure. `apps/web/src/components/Switcher.tsx` (Modify): the offline search's "Searching the N
    entries on this device" line.
32. `apps/web/src/graph/data.ts` and `apps/web/src/pages/Graph.tsx` (Modify, 14a's files): the graph from
    `api.graph()` as before, `OfflineCopy` over the canvas, the offline `Problem` only without a kept
    index.
33. `apps/web/src/pages/Settings.tsx` (Modify): "On this device" (§7) as a `settings-block`, with the
    iPhone card of §2; its few new rules go in `apps/web/src/styles.css` (Modify) beside
    `.settings-block`. `apps/web/src/components/InstallCard.tsx`
    (Create): the card, also shown once on the first pin in Safari on an iPhone.
34. `apps/web/src/components/Shell.tsx` (Modify): `logout()` calls `wipeDevice()` after `queue.clear()`.
35. `apps/web/src/components/ConnectionMark.tsx` (Modify): "Not connected · N changes waiting" while
    offline with records.
36. `apps/web/e2e/offline.spec.ts` (Modify), in the `offline` project:
    - CUJ 2: open Harbor and Mira online; go offline; reload; the switcher finds Harbor and "Old Quay";
      Harbor shows "Offline copy from"; edit and type `[[Old` and pick Old Quay; the connection mark
      counts 1 change; go online; the count goes and the server's entry holds the text;
    - CUJ 5: offline, Shade shows "not on this device" with its folder; search says it searched the
      kept entries; Rename is disabled with "Needs a connection";
    - a kept map opens offline with its image drawn (the canvas's image loader gets the cached image;
      checked through the page's own "image loaded" state, not pixels); a marker added offline is sent
      on reconnecting;
    - CUJ 8: offline, `/graph?focus=` Harbor selects it and the Entries tab lists every entry;
    - images: offline, the image button is disabled with "Images need a connection";
    - CUJ 7: logout with a waiting change warns; after it, `caches.keys()` is empty, the service worker
      is unregistered and IndexedDB `frontier` has no `answers`.
37. `docs/BACKLOG.md` (Modify): the offline items marked done as they land.

### Release 15c: offline writes beyond editing

38. `apps/server/src/routes/drafts.ts` (Modify): `check()` treats a `create` that sends `baseBlob` as
    possibly stale (§8). `apps/server/test/state.test.ts` or the route tests in
    `apps/server/test/library.test.ts` (Modify): a create with `baseBlob: ""` at a published path gives a
    draft of the library text, the device's kept copy and `stale_revision`; at a path holding another
    device's create draft, a kept copy; a create without `baseBlob` is refused as today.
39. `apps/web/src/components/NewEntry.tsx` (Modify): the name checked offline against the index and the
    queue's creates, ignoring case. `apps/web/src/components/NewEntry.test.ts` (Create): the clash
    message; a queued create counts.
40. `apps/web/src/pages/Edit.tsx` (Modify): a new entry starts offline when the index has no node at the
    path, with the folder's type from the kept folder file.
41. `packages/schema/src/api.ts` (Modify): the save requests of maps, chronicles and library files gain
    optional `clashes: string[]`. `packages/schema/src/state.ts` (Modify): `KeptCopy` gains optional
    `clashes`.
42. `apps/server/src/state/drafts.ts` (Modify): `keep()` takes optional `clashes` and stores them in the
    copy's record; `keptCopies()` returns them. `apps/server/src/maps/store.ts`,
    `apps/server/src/chronicles/store.ts`, `apps/server/src/library/files.ts` (Modify): with `clashes`,
    keep the draft's current text as the device's copy before `serverChange`, making the draft first for
    a library file without one. `apps/server/src/routes/maps.ts`, `routes/chronicles.ts`,
    `routes/libraryFiles.ts` (Modify): pass `clashes` and the device.
43. `apps/server/src/routes/drafts.ts` (Modify): `merge-versions` accepts a map, chronicle or library
    item file draft when the text parses as its kind (`parseMap`, the chronicle parser,
    `parseLibraryFile`), refusing it otherwise.
44. `apps/server/test/maps.test.ts`, `chronicles.test.ts`, `library.test.ts` (Modify): a save with
    `clashes` keeps the replaced text with its clashes and raises the attention count; a second one from
    the same device replaces the copy; without `clashes`, nothing is kept (older builds);
    `merge-versions` on a map draft with valid and invalid text.
45. `apps/web/src/sync/queue.ts` (Modify): `merge()` sends `clashes`; the notice links to
    `/versions/<draftId>` with "Compare". `apps/web/src/api.ts` (Modify): `saveMap`, `saveChronicle`,
    `saveLibraryFile` carry `clashes`. `apps/web/src/sync/queue.test.ts` (Modify): a clashing merge sends
    the keys.
46. `apps/web/src/pages/Versions.tsx` + `Versions.css` (Modify): the per-item compare of §9 for map,
    chronicle and library file drafts; Done refused while a record is waiting.
    `apps/web/src/offline/itemCompare.ts` (Create): the fields that differ per item, and the file built
    from the choices, pure. `apps/web/src/offline/itemCompare.test.ts` (Create): a feature moved on one
    side and renamed on the other; a style removed on the other side; a folder line.
47. `apps/web/e2e/offline.spec.ts` (Modify), with two browser contexts, one per device:
    - CUJ 3: the phone context offline makes "Gull" in `02 People` (names per project and run); the
      desktop context makes the same path and saves a version; the phone goes online and shows "Gull:
      two texts to compare", and `/versions/…` lists both texts. Every draft the test makes is discarded
      at its end;
    - CUJ 4: both contexts load the same map; the phone goes offline and moves "Lighthouse"; the desktop
      renames it and its save is sent; the phone goes online; the notice offers Compare; choosing the
      other side and Done gives the map the desktop's name at the old place, with the phone's other
      changes kept.

### Verification Plan

- `npm run typecheck && npm run lint && npm run format && npm test && npm run build && npm run e2e`. The
  browser tests run against the production build the server serves, so the service worker under test is
  the one that ships. The `phone` and `desktop` projects block service workers. The `offline` project
  allows them, and uses `context.setOffline` and `context.route` (which also sees requests that pass
  through a service worker) for failures. It uses two browser contexts for two devices.
- Unit tests with `fake-indexeddb` (already a dev dependency) for the database upgrade, the device layer,
  the keeper and the queue's new rows; `routes.test.ts` for what the worker answers; server tests for
  headers, the kill switch, `client_outdated`, the create clash and item kept copies. Server coverage
  thresholds are kept.
- **Old records:** a test writes a version 1 database in today's record shape (entry, map, folder file
  records) and opens it with 15b's code; every record is read and sent.
- First-load JavaScript: read by hand from Vite's build output before 15a and after each release; it
  grows by no more than 8 KB gzipped across the stage. The precache's total size is recorded in each
  pull request.
- **By hand on a real iPhone, after each release** (CI cannot install to the Home Screen, emulate Safari's
  storage rules or use a passkey in the installed app):
  - install from Safari's Share menu; the icon, name and paper-coloured splash show; the app opens
    standalone;
  - log in inside the installed app with the password and with a passkey;
  - Settings shows "Storage kept: yes" after the first pin;
  - in flight mode: the app opens from the Home Screen signed in; a recent entry, a pinned map with its
    image and a chronicle open; an entry is edited, a new entry made, a marker moved; the unsent count
    shows 3; out of flight mode the count goes to 0 within a minute of opening the app;
  - leave the app unopened for 8 days (once, before the stage is called done); the kept items and a
    change left waiting on purpose are still there;
  - deploy a new build; "A new version of Frontier is ready" appears only after the waiting change is
    sent; Reload takes it;
  - the kill switch: deploy with `FRONTIER_SERVICE_WORKER=off`; after one reopen, Safari's website data
    for Frontier lists no service worker, and a change left waiting is still there and is sent; switch it
    back on;
  - log out: the warning, then the login page; reopening offline shows the login page, not the library.
- Screens at desktop and phone size, light and dark: the update bar (both texts), "Offline copy from",
  "not on this device", "On this device" with the iPhone card, the item compare screen.
