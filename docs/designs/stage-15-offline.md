# Stage 15: working offline

- **Author:** Elad Haviv
- **Status:** Approved after a Goldfish review (2026-11-23; findings in .egm/review-15/)
- **Date:** 2026-11-23
- **Parent:** [Stage 11](stage-11-foundations-shell-tree.md), which provides what this stage builds on:
  the save queue with its base check and one kept copy per device, the connection service, the unsent
  list, the shell, and (11c) the folder file through the library item file pipeline.
  [Stage 12](stage-12-entries-editor.md) left image upload offline for this stage to decide (its
  Non-Goals), and (12a) provides `checkEntryName`, which 15c needs. [Stage 13](stage-13-maps.md) (13d)
  adds the map styles file to the same pipeline. [Stage 14](stage-14-graph.md) (14a) builds
  `GET /api/graph`, which this stage extends into the compact index (§5) and left the graph offline for
  this stage to decide (its §10). Comes from [`concepts_brief.md`](../../concepts_brief.md) (stage 15,
  the "Further risks" on offline storage, login, updates, links and moves, and "Answered by the author"
  item 3). The master design's non-goal "Full offline use" was reversed by the author on 2026-11-22; the
  dated note is in [frontier.md](frontier.md#non-goals).

---

## Overview

Frontier is a single-author web app for writing the world of Avalymia as a library of Markdown entries.
Terms (draft, unpublished, unsent, kept copy, rename intent, item file) are as in
[Stage 11, Terms](stage-11-foundations-shell-tree.md#terms). The author asked: "I'm fine with only being
able to edit the last few files I opened (they will be saved on-device for this)", and also to add new
entries and to work on maps and chronicles with no connection, with the changes sent when it returns.
He accepted that moves and renames, image import from a web address, AI, search over entries not on the
device, and history need a connection, and that on an iPhone Frontier must be installed to the Home
Screen to keep its offline copy. On 2026-11-23 he added that images (upload, paste, drop) need a
connection offline, and that the device keeps the last 30 entries, 5 maps and 5 chronicles.

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
- **A kept copy:** as in stage 11, always the **server's** copy of the other side of a clash, stored
  beside a draft and compared on `/versions/:id`. Nothing on the device is called a kept copy in this design.
- **The service worker:** a script the browser keeps beside the app that can answer the app's own
  requests from storage; here it serves the app's files and the images on the device, nothing else
  (§1). **The kill worker:** a fixed worker the server serves instead when the switch is off (§1).
- **The app shell:** the built files in `apps/web/dist`: `index.html`, the JavaScript and CSS chunks
  (the map, chronicle and graph pages included), the manifest and the icons. About 2.0 MB today.
- **The device copy:** what this stage stores in the browser for reading: the device answers and the
  images on the device (§5). Distinct from the save queue, which holds only unsent changes.
- **A device answer:** a successful read's JSON, stored in IndexedDB and returned by `api.ts` when the
  server cannot be reached (§6).
- **The compact index:** every entry's path, title, type, aliases, id, a short version mark and its
  resolved outgoing links, plus the paths of the library's other files. It is the 14a graph response
  with three more fields (§5), always on the device.
- **An item on this device:** an entry, a map or a chronicle whose body is among the device answers,
  because it is among the last 30 entries, 5 maps or 5 chronicles opened.
- **The device keeper:** `apps/web/src/offline/keeper.ts`, which keeps the items on this device, their
  images and the device answers up to date while online (§5).
- **Build id:** the content hash of the built `index.html`, written to `dist/build.json` (§3).
  **Client API number:** an integer in `packages/schema` saying which shape of write requests the app
  sends, sent as the `frontier-api` header (§3). **`DEVICE_SCHEMA`:** one number per route shape,
  stored with each device answer (§6).
- **14a, 13d:** [Release 14a](stage-14-graph.md#release-14a-the-graph-screen) (the graph screen and
  `/api/graph`); [Release 13d](stage-13-maps.md) (map styles).

Stage 15 ships in three releases, each deployable on its own and in this order:

- **15a, the installable app.** A service worker that holds the app shell, so Frontier opens with no
  connection; the web app manifest and icons, so an iPhone can install it; an update flow that never
  reloads by itself; a kill switch the server can serve; the client API number on every request;
  starting offline while signed in; logout that needs a connection and removes the worker. Nothing new
  is stored on the device yet: pages that need the server say so as today.
- **15b, the device copy.** The compact index always stored; the bodies of the last 30 entries, 5 maps
  and 5 chronicles opened, with their images; reads served from the device when the server cannot be
  reached, marked "Offline copy from <time>"; the graph, switcher, `[[` completion and tree from the
  device; "On this device" in Settings; logout wipes all of it. Editing an entry, map or chronicle on
  this device works offline from here, because writes already go through the queue. **Needs 14a
  merged** (the graph route it extends).
- **15c, offline writes beyond editing.** New entries made offline; a path clash found later, an entry
  renamed or moved elsewhere meanwhile, and a name differing only in case all end as kept copies; item
  clashes in maps, chronicles and the library item files keep the other side on the server as a kept
  copy, shown read-only per item. Comes after 15b. **Needs 12a merged** (`checkEntryName`).

## The Problem

- **Frontier does not open without a connection.** The app's files come from the server on every visit,
  and the start checks the session with `/api/session`; when that fails, `App.tsx` shows the login page
  (`() => setLoggedIn(false)`). On a train, the author cannot even reach text he typed an hour ago.
- **Nothing is read from the device.** Every page reads through `api.ts`, and a failed read shows
  "Can't reach Frontier". The queue holds unsent text, but the editor cannot open without the server
  (`Edit.tsx` stops on any load error but a 404), so that text is out of reach until the connection
  returns.
- **Links, the switcher and the tree need the server.** `[[` completion and the switcher call
  `/api/switcher`, the tree `/api/tree`. Offline, all of them are empty.
- **An iPhone forgets.** Safari clears a site's script-written storage after about 7 days without use
  unless the site is installed to the Home Screen, and installing needs a manifest and icons, which
  Frontier does not have (there is no icon, favicon or manifest in the repository today).
- **A new entry made offline can get stuck.** A create whose path was meanwhile published from another
  device is refused as `invalid` ("already exists") by `check()` in `apps/server/src/routes/drafts.ts`,
  because the base check only applies to saves with a revision above 0. The queue then marks the record
  "needs attention" instead of keeping both texts. An edit of an entry renamed elsewhere meanwhile is
  refused ("A draft cannot change which file it belongs to") or, with no draft, brings the old path back
  as a new entry.
- **A long offline gap turns map merges into "mine wins".** The queue merges maps, chronicles and the
  library item files item by item from a stored base, which is right, but an item both devices changed
  keeps this device's side and the other side is gone, named only in a notice. After seconds that is
  rare; after days it is likely.
- **An old app can meet a new server.** Once the app is held on the device, a deploy no longer reaches
  it at once. Today nothing tells the server which shape of writes a client sends.

## Goals

- **G1.** Frontier opens with no connection, on desktop, Android and an iPhone with Frontier installed
  to the Home Screen: the app shell comes from the service worker, and a device that was signed in
  stays signed in for up to 30 days after its last session check, until the server says otherwise.
- **G2.** Frontier can be installed: a web app manifest (name, short name, icons, theme colour,
  standalone display), icons made from one mark, and on an iPhone not yet installed a card that says how
  and why.
- **G3.** An update never reloads the app by itself. "A new version of Frontier is ready" shows with
  Reload when nothing is being sent and no editor has the focus; the new version takes over only when
  the author chooses, in every open tab at once. The server can switch the service worker off.
- **G4.** The compact index is always on the device and kept up to date, so with no connection links
  resolve, `[[` completion and the switcher find every entry by name or alias, the tree shows every
  folder and entry, and the graph works.
- **G5.** The bodies of the last 30 entries, 5 maps and 5 chronicles opened are on the device with their
  images at the size shown, and are refreshed in the background while online.
- **G6.** Storage: the fixed counts bound what is stored; Frontier asks the browser to keep its storage;
  an unsent change is never removed; Settings shows "On this device" (space used, "Remove everything on
  this device", the iPhone card), and that block works offline.
- **G7.** A page read from the device says so: "Offline copy from 14:05". The connection mark stays
  truthful: the service worker never answers the app's data requests. Before the first edit after the
  connection returns, the editor reads the server's copy again.
- **G8.** Offline, the author edits entries on this device, deletes entries, and makes new entries in
  any folder, by the same open-or-create rule as online. A path taken meanwhile on another device (also
  one differing only in letter case), or an entry renamed or moved elsewhere, ends as a kept copy, never
  as a silent merge or a stuck record.
- **G9.** Offline, the author edits maps and chronicles on this device and changes the folder file and
  the map styles file (new empty folders, order, icons, colours, types, styles); the queue merges them
  item by item from the stored base when they are sent.
- **G10.** When an item (a map feature, a chronicle span, a folder line, a style) was changed on both
  sides, the other side is kept on the server as a kept copy, and the compare screen shows it per item,
  read-only.
- **G11.** What needs a connection says so and is disabled while offline: renames, moves, folder
  deletes, creating and deleting maps and chronicles, image upload, paste, drop and import, AI,
  comments, history, export, import, the inbox, "Save a version", full-text search, hover previews and
  logout.
- **G12.** Logout needs a connection. It warns about unsent changes, ends the session, then removes the
  queue, the device copy and the service worker's caches, and unregisters the service worker; other open
  tabs reload. Display settings stay.
- **G13.** No regressions. First-load JavaScript grows by no more than 8 KB gzipped across the stage,
  read by hand from Vite's build output. The browser tests run against a production build with the
  service worker, and cover each journey below that CI can run.

## Non-Goals

- **Image upload, paste and drop while offline.** They need a connection (the author, 2026-11-23; a
  design for later is under "Future improvements"). Text paste works as today.
- **Structural actions offline:** renaming or moving entries and folders, deleting folders, creating,
  copying or deleting maps and chronicles, making a chronicle the main one, applying a folder's type to
  its entries. They stay direct calls to the server, as stage 11 decided.
- **Comments offline.** They stay direct calls (stage 11 left it to this stage); queueing them is under
  "Future improvements".
- **Search, AI, history, export, import, the inbox, Settings other than "On this device", hover
  previews, and URL image import** offline (the author's accepted limits, and the brief's out-of-scope
  list). The switcher and `[[` completion find names offline from the compact index.
- **Choosing which items stay on the device, and a storage budget.** The fixed counts are the rule;
  both are under "Future improvements".
- **Sending while Frontier is closed.** The queue sends while a Frontier tab or the installed app is
  open. Background Sync is not on iOS, and the author opens Frontier to work.
- **An automatic three-way merge of entry text.** A clash of text stays two texts to compare
  ([stage 11, Alternative C](stage-11-foundations-shell-tree.md#alternative-c-resolve-every-stale-save-on-the-server-with-a-three-way-merge)):
  a wrong merge of prose is worse than a shown conflict.
- **Choosing per item on the compare screen.** The other side of an item clash is shown, not applied;
  the author changes the item by hand.
- **The whole library on the device.** Only the compact index is whole; bodies are the recent ones.
- **Several people.** One author on several devices, as in every stage.

## Decisions

| Decision | Date | Source |
| --- | --- | --- |
| Offline work: recent files, new entries, maps and chronicles | 2026-11-22 | author's ask, brief |
| Moves, renames, URL import, AI, search over entries not on the device and history need a connection; on an iPhone Frontier must be installed | 2026-11-22 | brief, "Answered by the author" item 3 |
| Images (upload, paste, drop) need a connection offline | 2026-11-23 | the author; was open question 1; as [stage 12](stage-12-entries-editor.md#non-goals) asked |
| The device keeps the last 30 entries, 5 maps and 5 chronicles opened; no pinning, no budget | 2026-11-23 | the author; was open question 2; Goldfish review (zoom-out M4) |
| A service worker for the app shell, built with `vite-plugin-pwa` in its `injectManifest` mode (our own worker, Workbox's precache) | 2026-11-23 | this design (Alternative A) |
| The service worker answers only navigations, the app's own files and images on the device; never `/api/` data, non-GET requests, auth, settings, status or the status stream | 2026-11-23 | brief ("SW-served GETs can fool offline detection"); this design |
| The normal worker never skips waiting by itself and never claims pages; the kill worker does both, then removes itself | 2026-11-23 | Goldfish review (zoom-out M1, readiness B1) |
| The worker is registered only while signed in, never on `/login` | 2026-11-23 | Goldfish review (readiness B2) |
| Reads from the device go through `api.ts` (a read-through layer), not through the service worker | 2026-11-23 | this design (Alternative B) |
| The update offer shows when nothing is being sent and no editor has the focus; records waiting or needing attention do not hold it back. This refines the brief's "An app update waits until the queue is empty": a reload loses nothing, because every `put` is in IndexedDB | 2026-11-23 | brief; Goldfish review (zoom-out M2, readiness M4) |
| `registration.update()` on focus and on navigation; no build-id comparison | 2026-11-23 | Goldfish review (zoom-out M3) |
| Every request carries the client API number (`frontier-api`); no refusal of old clients in this stage | 2026-11-23 | brief ("version skew"); Goldfish review (zoom-out M3, readiness M2) |
| The build id is the content hash of `index.html` | 2026-11-23 | Goldfish review (readiness nits) |
| Device answers carry a `DEVICE_SCHEMA` number per route shape; one is replaced only when its new read succeeds | 2026-11-23 | Goldfish review (zoom-out M5, readiness M5) |
| 502, 503, 504 and answers that are not JSON count as "cannot reach the server" | 2026-11-23 | Goldfish review (readiness M6) |
| `signedIn` holds `{ until }`, 30 days after the last good session check; no offline start after it | 2026-11-23 | Goldfish review (readiness M8) |
| The compact index is the 14a graph response with `id`, `v` and `files` added, always stored; the graph offline is drawn from it, with unsent changes laid over it | 2026-11-23 | brief ("the same index feeds the graph"); [stage 14 §10](stage-14-graph.md#10-offline-stage-15) left the choice here |
| No full-text search or hover previews offline; the switcher and `[[` rank names from the index with the server's `rankNames` | 2026-11-23 | Goldfish review (zoom-out nits) |
| New entries offline use the online open-or-create rule; no separate name check | 2026-11-23 | Goldfish review (zoom-out M7) |
| A new entry's path clash found on reconnect, a name differing only in case, and an edit of an entry renamed or moved elsewhere become kept copies | 2026-11-23 | brief; Goldfish review (readiness M10, M13); this design changes `check()` |
| Item clashes keep the other side on the server as a kept copy, shown read-only per item; no chooser, no `merge-versions` for item drafts | 2026-11-23 | brief's ideal; Goldfish review (zoom-out M8, readiness M14) |
| "Kept copy" names only the server's conflict copy; device-side things are "device copy", "device answer", "on this device", "the device keeper" | 2026-11-23 | Goldfish review (zoom-out M6) |
| Entry text clashes stay kept copies; no automatic text merge | 2026-11-22 | stage 11, Alternative C |
| Comments stay online-only | 2026-11-23 | this design; stage 11 G4 left it here |
| Logout needs a connection: the session cookie is httpOnly, and only the answer to `POST /api/logout` removes it | 2026-11-23 | Goldfish review (readiness B2) |
| Logout wipes the queue, the device copy, the caches and the service worker | 2026-11-22 | brief; stage 11 Non-Functional Requirements |

## Critical User Journeys (CUJs)

### CUJ 1: Install on the iPhone and keep the library

- **Covers:** G2, G5, G6.
- **Given**: Frontier open in Safari on his iPhone, signed in, never installed.
- **When**: he opens Settings, reads "On this device", follows the card's steps (Share, then "Add to
  Home Screen"), opens Frontier from the Home Screen, logs in once, and opens Harbor, Mira and the Coast
  map.
- **Then**: the card said: "On iPhone, Frontier keeps its offline copy only when it is on your Home
  Screen. The Home Screen app has its own storage: send any waiting changes from here first, and log in
  once there." In the installed app, "On this device" shows no card and "Space used: 41 MB".

### CUJ 2: An entry on a train with no signal

- **Covers:** G1, G4, G5, G7.
- **Given**: the installed app, used yesterday online; Harbor among the recent entries. Now no signal.
- **When**: he opens Frontier from the Home Screen, presses the switcher, types "harb", opens Harbor,
  presses Edit, writes a paragraph with `[[Old` and picks "Old Quay" from the completion, then goes back
  to the reader.
- **Then**: Frontier opened at once, signed in, with "Not connected" in the connection mark. The switcher
  listed every entry by name. Harbor showed "Offline copy from yesterday, 18:40". The completion listed
  "Old Quay", which is not on the device. Back in the reader, Harbor shows the new paragraph. The
  connection mark reads "Not connected · 1 change waiting". When the signal returns, the change is sent
  without his doing anything, and the count goes.

### CUJ 3: A new entry offline, and a clash

- **Covers:** G8, G4.
- **Given**: no connection; at home the laptop is online.
- **When**: on the phone he chooses New entry, types "Gull", picks `02 People`, writes "Sister of
  [[Mira]]." Meanwhile, on the laptop, he makes `02 People/Gull.md` too and saves a version. The phone
  reconnects.
- **Then**: offline, "Gull" opened a new entry, as online. (Had he typed "Mira", Mira would have
  opened, as online.) Gull showed in the tree and in Mira's local graph, drawn as unpublished, since it
  is not in the library yet; leaving and reopening Gull showed his text. After reconnecting, the server
  kept the phone's text as a kept copy beside a draft of the laptop's Gull, and the phone says "Gull:
  two texts to compare". Nothing is lost.

### CUJ 4: A map on the train, changed at home too

- **Covers:** G9, G10.
- **Given**: the Coast map on the phone; no connection.
- **When**: on the phone he moves the marker "Lighthouse" and adds a marker "Wreck". At home, the laptop
  renames "Lighthouse" to "Old Light" and saves a version. The phone reconnects.
- **Then**: the queue merged the two copies: "Wreck" was added, and "Lighthouse" was changed on both
  sides. The phone's side is in the map; the laptop's side was kept on the server beside it. The notice
  reads "Coast: changed in both places: Lighthouse. Yours is in the map; the other version is kept.
  Compare". Compare shows Lighthouse with "This map now" (name Lighthouse, moved) and "Server copy at
  18:02" (name Old Light). He renames the marker to "Old Light" on the map page, then presses Dismiss on
  the compare screen. The map holds "Old Light" at the phone's place, plus "Wreck".

### CUJ 5: Something not on the device

- **Covers:** G7, G11.
- **Given**: no connection.
- **When**: he follows a link to "Shade", which is not on the device; types "lantern" in the switcher;
  hovers a link; opens the entry menu on Harbor.
- **Then**: Shade's page reads "Shade is not on this device. It opens when you are connected." and shows
  its folder and links from the compact index. The switcher lists names matching "lantern" and reads
  "Full-text search needs a connection." The hover card reads "Needs a connection". In the menu, Rename
  and Move read "Needs a connection" and are disabled.

### CUJ 6: A new version while he writes

- **Covers:** G3.
- **Given**: the installed app, two tabs open; the editor has the focus; one change waits for a
  connection; a new Frontier is deployed.
- **When**: the connection returns; he goes on typing, then leaves the editor for the reader; later he
  presses Reload in the update bar.
- **Then**: while the editor had the focus or a change was being sent, no bar showed. Once he was in the
  reader with nothing being sent, "A new version of Frontier is ready · Reload · Later" appeared. Reload
  reloaded both tabs into the new version. Any change still waiting was in IndexedDB and is sent by the
  new version.

### CUJ 7: Logout on a borrowed laptop

- **Covers:** G12.
- **Given**: a laptop at a friend's, with 3 entries on the device and one change waiting.
- **When**: offline, he opens the app menu; then, connected, he logs out.
- **Then**: offline, Log out read "Needs a connection" and was disabled. Connected, Frontier warned "1
  change is not sent yet … Log out and lose them". After he agreed, the session ended and the app
  reloaded to the login page. The browser keeps no library data, no cached app and no service worker;
  only the display settings (side bar width, preview mode, graph depth) stay. Reopening Frontier later
  shows the login page when connected; with no connection it shows the browser's own offline page, which
  is expected.

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
 Service worker (15a)  navigations  -> precached index.html           GET /sw.js, /build.json (own
                       /assets/*    -> precache                         routes, no-cache); kill worker
                       /api/images  -> "frontier-images", if stored     when FRONTIER_SERVICE_WORKER=off
                       everything else: not answered (to the network)
 Pages -> api.ts  read: network ------------------------------------> GET /api/... (as today)
                  unreachable or offline: device answer               GET /api/graph + id, v, files (15b)
                  (IndexedDB "answers") or one made from the index    lists + v; status + drafts count
            write: save queue (as today), with frontier-api --------> PUT drafts/maps/chronicles/
                  maps/chronicles/library files carry clashes (15c)    library files; kept copies (15c)
 Device keeper (15b): recent items, images, refresh by v
 Updates (15a): waiting worker, update bar, reload of every tab
```

### 1. The service worker and the app shell (15a)

**Built with `vite-plugin-pwa` in `injectManifest` mode.** Our own worker source, `apps/web/src/sw/sw.ts`,
is bundled by the plugin, which writes the list of built files with their hashes into it. The worker
uses Workbox's precache, routing and one caching strategy; the plugin also writes the manifest (§2). The
plugin's own registration script and reload are not used: `apps/web/src/offline/updates.ts` registers
the worker and handles updates (§3). The worker is off in `vite dev`, so development is unchanged.
Options and module names are in the Implementation Plan (step 3).

**What it answers.** The rules live in a pure function, `routeOf({ url, method, mode })` in
`apps/web/src/sw/routes.ts`, which returns `"shell"`, `"precache"`, `"image"` or `"none"`; the worker
calls it and does the cache lookups itself, and the unit tests check it:

| Request | `routeOf` | Answer |
| --- | --- | --- |
| A navigation (`mode: "navigate"`) to any path but `/api/…` and `/health` | `shell` | the precached `index.html` (the app then routes) |
| A precached file (`/assets/*.js`, `*.css`, the icons, the manifest) | `precache` | the precache |
| `GET /api/images?path=…&w=…` (no `branch`) | `image` | the copy in `frontier-images` when that exact address is there, refreshed from the network in the background; when it is not there and the network fails, a copy of the same `path` at another width; else the network's failure |
| Anything else: every other `/api/` request, every non-GET request, `/api/session`, `/api/login`, `/api/passkeys/*`, `/api/settings*`, `/api/status`, `/api/status/events`, `/health`, `/sw.js`, `/build.json` | `none` | not answered: the browser goes to the network as if there were no worker |

So the worker never answers a data request, and every failure to reach the server still reaches
`api.ts` and the connection service as a failure. Images are the exception because `<img>` and the map's
image loader do not go through `api.ts`, and an image never tells the connection anything.

**The precache** holds every file Vite builds, including the lazy map, chronicle and graph chunks, so
every page opens offline (about 2.0 MB today). As a side effect, a tab left open across a deploy keeps
loading its own lazy chunks from the precache instead of failing on files the deploy removed.

**Life cycle.** The normal worker never calls `skipWaiting()` by itself and never claims pages. On the
first visit it installs and activates, and pages are controlled from the next load. A newer worker waits
until the author presses Reload (§3).

**Registration.** `updates.register()` registers `/sw.js` (scope `/`) only in a production build, only
in a browser with service workers, and only while signed in: after a login, after a session check that
says logged in, or at an offline start (§4). It is never called on `/login`, so a logged-out browser,
including one just wiped by logout, gets no worker back. A browser without service workers runs as
today.

**Server.** `apps/server/src/web.ts` serves `/sw.js` and `/build.json` with its own routes. They are
left out of `@fastify/static`'s routes: with `wildcard: false` it registers one route per built file at
start, which would otherwise claim `/sw.js` first. Static files get no cache header from the plugin
itself; ours are set per file:

| Path | `cache-control` |
| --- | --- |
| `/sw.js`, `/build.json`, `/index.html` (also when served for `/` and by the not-found handler, as today), `/manifest.webmanifest` | `no-cache` |
| `/assets/*` (hashed names) | `public, max-age=31536000, immutable` |
| the icons | `public, max-age=86400` |

When `build.json` is missing (`vite dev`, and server tests without a built app), the server takes the
build id `"dev"`; `/build.json` still answers with it; `/sw.js` answers 404 unless the switch is off, so
`register()` fails quietly and the app runs as today. When the app is not built at all (`index.html`
missing), none of these routes are registered, as today.

**Content security policy.** The worker is one bundled file from our origin with no `importScripts`
from elsewhere, and the manifest is ours. `worker-src` falls back to `child-src`, then `script-src`, then
`default-src`, so today's `script-src 'self'` already allows the worker; `manifest-src` falls back to
`default-src 'self'`. Both are named so they stay allowed if those are ever narrowed.

**Kill switch.** With `FRONTIER_SERVICE_WORKER=off` in the server's environment (read in
`apps/server/src/config.ts`), `GET /sw.js` answers the kill worker, written in the server's code
(`apps/server/src/killWorker.ts`), instead of the built file. The kill worker:

1. on `install`, calls `skipWaiting()`, so it does not wait for the old worker's pages to close;
2. on `activate`, calls `clients.claim()`, so the open pages are its own; then
3. deletes every Cache Storage cache whose name starts with `workbox-` or `frontier-`;
4. unregisters itself;
5. navigates each window it controls to its own address (`clients.matchAll({ type: "window" })`, which
   lists only controlled pages), so they load from the network.

It never touches IndexedDB, so the queue and its unsent changes stay. The browser fetches `/sw.js` past
the HTTP cache when it checks for an update: on navigations, and whenever the app calls
`registration.update()`, which it does on focus and on navigation (§3). An installed iOS app that was
only suspended does not navigate, so it checks when it comes to the front or is relaunched. The switch
therefore takes effect at the next navigation, focus or reopen. The app also skips registration while
`/build.json` says `"worker": false`. Turning the switch off again lets the next signed-in load register
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

The colours are the page colour `--paper` of `apps/web/src/styles.css`. `index.html` gains the manifest
link, an SVG icon, an Apple touch icon (180 px, which iOS reads instead of the manifest's icons), and
two `theme-color` metas: `#f7f3ea`, and `#171512` for the dark scheme.

**The icons.** The repository has no app icon today, so one mark is drawn: the lucide `Compass` glyph,
already in the app (`apps/web/src/components/tree/folderIcons.ts`), in the accent colour `#9a3b1c` on the
paper colour, as `apps/web/public/icons/icon.svg`. The maskable icon keeps the glyph inside the middle
80%. A small script, `apps/web/scripts/icons.mjs`, makes the PNGs from the SVG with `sharp`, added to
the web app as a dev dependency. It is run by hand, and the PNGs are committed, so the build does not
depend on it.

**Installing on an iPhone.** iOS has no install prompt. In Settings, "On this device" shows a card while
the app runs in Safari on an iPhone or iPad and not standalone (`navigator.standalone !== true` and not
`matchMedia("(display-mode: standalone)")`). The card gives the steps and says the Home Screen app has
its own storage, separate from Safari's: changes waiting in Safari stay there, so he should send them
first, and he logs in once in the installed app. The same card shows once as a dismissible notice the
first time Frontier stores an item on the device in Safari on an iPhone. Android and desktop Chrome get
the browser's own install offer; Frontier adds no button.

### 3. Updates and version skew (15a)

**Build id.** The first 12 hex characters of the SHA-256 of the built `index.html`, which names every
hashed chunk, so it changes exactly when the app does. A small Vite plugin writes it to
`dist/build.json` as `{ "build": "…", "api": 1 }` once `index.html` is written. The server reads that
file once at start, logs it, serves it at `/build.json` with the kill switch's `"worker": false` added
when off (§1), and sends `frontier-build: <id>` on every `/api/` answer, for reading logs and the
browser's network panel. The app does not compare build ids.

**Client API number.** `packages/schema/src/client.ts`: `CLIENT_API = 1`, the shape of writes this
build sends, with the rule beside it: raise it when a write request changes shape or meaning so that an
older server would misread it. `headers()` in `apps/web/src/api.ts` adds `frontier-api` to every
request, beside the device headers, also before the device is known. The queue sends through the same
`api` functions, so its sends carry it too. The server reads nothing from it in this stage. A later
server that must refuse old writes can tell old clients apart; until then, any refusal it gives already
lands as a queue record needing attention with the server's message (`failed()`'s last row in
`queue.ts`), so an old app loses nothing. The refusal itself is under "Future improvements".

**Noticing a new version.** The app calls `registration.update()` when it regains the focus or becomes
visible, and on in-app navigation, at most once a minute. The browser fetches `/sw.js` past the HTTP
cache; a changed precache list means a new worker installs and waits.

**The update bar** (`apps/web/src/components/UpdateBar.tsx`, a strip above the page, in the shell):

| State | What shows |
| --- | --- |
| A new worker is waiting, no record is being sent, and no editor has the focus | "A new version of Frontier is ready" with Reload and Later. Later hides it until a newer worker is found or the app restarts |
| A new worker is waiting, and a record is being sent or an editor has the focus | nothing; it appears once both are over. Records waiting or needing attention do not hold it back |

**Dated note (2026-11-23).** The brief says "An app update waits until the queue is empty". This
design refines it: the offer waits until nothing is being sent and the author is not typing. A record
waiting for a connection, or one needing attention, can wait for days; holding the update for it would
keep an old app indefinitely. A reload loses nothing, because the queue writes every `put` to IndexedDB
and the new build reads the old records (below).

**Reload.** `updates.reload()`:

1. if a worker is waiting, it is sent `{ type: "SKIP_WAITING" }`;
2. else if one is installing, the app waits until it reaches `installed`, then sends the message;
3. else it calls `registration.update()` and waits for an installing worker to reach `installed` the
   same way;
4. if no worker is installed within 10 seconds, or there is no registration (the switch is off), it
   reloads the page plainly.

The worker calls `skipWaiting()` only on that message. Every open Frontier tab listens to
`controllerchange` in `updates.ts` and reloads once when it fires, so all tabs move to the new version
together (the plugin's own helper reloads only the tab that asked).

**Why a reload is safe with changes waiting.** The queue's records are written to IndexedDB on every
`put`, so a reload loses nothing typed. The one danger is a new build that cannot read the old build's
records. So the database keeps its records' shape across builds: a new field is optional, and a change of
shape is an IndexedDB version upgrade that converts the records. A unit test opens a database written in
today's record shape with the new code (Verification Plan).

### 4. Starting offline while signed in (15a)

Today the start asks `/api/session`, and any failure shows the login page. From 15a:

- after a successful login, and after every session check that says logged in, the app writes
  `signedIn: { until }` to the queue database's `meta` store, where `until` is the check's time plus 30
  days, the session cookie's life. It goes through new `queue.meta()` and `queue.setMeta()` accessors,
  so the app uses the queue's one database connection;
- at start, when `meta` holds `signedIn` and `until` is still ahead, `/api/session` gets 3 seconds.
  When it does not answer in time, or cannot be reached (status 0, 502, 503, 504, or an answer that is
  not JSON), the app opens as signed in and calls `connection.startOffline()`, which sets `offline` and
  starts the stream and the probe as usual. A late answer then decides: logged in, and the connection
  turns `online`; logged out, and it turns `signed-out`;
- without `signedIn`, or after `until`, the start is as today: the login page;
- when the server is reached again and says 401, the connection service turns `signed-out`. The queue
  pauses, and the login dialog opens over the page, as stage 11 built. Nothing is cleared;
- logout removes `signedIn` with everything else (§11).

The device copy is readable offline without the server's check for up to 30 days after the last one.
Who can open the device can read what is on it, which is why logout wipes it (Risks).

### 5. What is on the device (15b)

**Where.** The queue's IndexedDB database `frontier` goes from version 1 to 2 (`openStore` in
`apps/web/src/sync/db.ts`). The upgrade branches on the old version: from 0 it makes `queue` and `meta`;
from 1 or less it adds `answers` and `items`. `queue` and `meta` are left as they are:

| Store | Key | Value |
| --- | --- | --- |
| `answers` | the request's address, normalised (`/api/entries?path=…`) | `{ url, at, shape, body, bytes, item? }`: a successful read's parsed JSON, when it was read, its route's `DEVICE_SCHEMA` number (§6), its size, and the item it belongs to |
| `items` | `entry:<path>`, `map:<id>`, `chronicle:<id>` (the queue's keys) | `{ key, opened, bytes, images: string[] }`: when it was last opened, its size, and the image addresses stored for it |

`meta` also holds `signedIn` (§4) and `snapshot`, the last status snapshot received, so an offline cold
start shows the last counts and the device keeper compares against it. Images are stored in Cache
Storage, in the cache `frontier-images`, which the service worker reads (§1). The precache is Workbox's
own cache.

**Several tabs.** The database is opened with a `blocking` handler: when another tab asks for a newer
version, this tab closes its connection, makes the editor read-only and shows "Frontier was updated in
another tab. Reload this tab." with Reload. A tab whose open is `blocked` by an older tab (builds before
15b have no `blocking` handler) waits; after 5 seconds it shows "Close or reload your other Frontier
tabs to finish updating", and goes on when they close. An update reloads every tab anyway (§3), so this
is rare.

**Always stored** (written after every successful read, whatever the item):

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
  draft's revision when there is a draft (`"3f9a0c21be77.4"`). It tells the device which stored bodies
  changed without asking for each one;
- `files: string[]`: the paths of every library file that is not a note (images and other files),
  outside the excluded folders, plus unpublished uploads. With the nodes, they let the browser resolve
  links and embeds with `createResolver` from `@frontier/vault`, the resolver the server's index uses.

One route then serves the graph screen, the local graph and the device; there is no second builder.

**Version marks for the rest.** The items of `GET /api/maps` and `GET /api/chronicles` gain the same
`v` (blob prefix, `.`, draft revision), so the keeper sees which map or chronicle changed. The status
snapshot (`packages/schema/src/status.ts`) gains `drafts`, a counter the server raises on every draft
save, server change or discard, so a draft saved from another device starts a refresh even when the
unpublished count stays the same.

**Items on this device.**

- Opening an entry (its reader or editor), a map or a chronicle makes it recent, with `opened` set to
  now. The device keeps the last 30 entries, 5 maps and 5 chronicles opened. Entries are text and small;
  maps carry large images.
- **What an item's body is:**
  - an entry: `GET /api/entries?path=` (text, draft id and revision, blob, links resolved, backlinks,
    headings, fields, maps, chronicles), and the images it embeds at the reader's width (1280);
  - a map: `GET /api/maps/:id` (map, revision, blob, entry names), its images at the width this device
    asks for (as `MapPage.tsx` chooses), and the marker icons its features use;
  - a chronicle: `GET /api/chronicles/:id` (chronicles carry no images).

**The device keeper** (`apps/web/src/offline/keeper.ts`) runs in one tab, the one holding the sender's
lock `frontier-sender`, so two tabs do not fetch the same things:

- after an item's body is read, it fetches the item's images that are not yet in `frontier-images`, one
  at a time, and records them on the item;
- **refresh while online:** at start, on each status snapshot whose `indexCommit`, `unpublished` or
  `drafts` differs from the stored one, and when the queue's list changes, it reads the compact index
  and the lists again. Then, one request at a time and only while online, it reads again:
  - each entry on this device whose node's `v` differs from its device answer's (`draft.revision` and
    `blob`);
  - each map and chronicle on this device whose list item's `v` differs;
  - the images of each refreshed item that are not yet stored.

  It skips any item with a record in the queue, since the editor's own state is newer.
- **removes** (below) after each change.

**Removal.** No budget: the counts bound the size.

1. never removed: queue records (with their `base` copies), the always-stored answers, the precache,
   and any item with a queue record;
2. a recent item beyond its count (the 31st entry, the 6th map) goes, its body and its entry in `items`;
3. an image goes when no item lists it.

A write to IndexedDB or Cache Storage that fails for want of space removes the least recently opened
item (never one with a queue record) and tries once more; if it still fails, the answer is not stored,
and the page shows it as read.

**Space used** is the sum of the items' bodies and their images, an image shared by two items counted
once, plus the always-stored answers. `navigator.storage.estimate()` reports usage against the quota
the browser grants this site, not the disk's free space; Settings shows usage only.

**Keeping storage.** `navigator.storage.persist()` is asked when the installed app first starts
(`display-mode: standalone`) and the first time an item is stored. Safari clears script-written storage
after about 7 days without use; a Home Screen app is exempt from that rule, but, like any site, its
storage can still be removed under storage pressure unless it is persisted. That is why the card in §2
exists. Chrome usually grants `persist()` to an installed app.

**When IndexedDB cannot be opened** (some private windows), the queue already runs in memory. The device
copy is then off: nothing is stored, reads behave as today, and "On this device" says "This browser does
not let Frontier keep anything on this device."

### 6. Reading offline (15b)

**A read-through layer in `api.ts`.** `call()` gains one step for GET requests to the routes in the table
below, through `apps/web/src/offline/device.ts`:

- **the network answers with JSON:** the answer is returned as today and, when the route is stored,
  written to `answers` (for an item body, opening it makes it recent, so a body read by its page is
  always written);
- **the server cannot be reached:** status 0 (`fetch` failed), a 502, 503 or 504 (a proxy in front of a
  stopped server), or a 2xx answer that is not JSON (a captive portal's or a proxy's page). `call()`
  treats all of them as status 0: it calls `connection.unreachable()` and throws `ApiFailure(0, …)`, and
  for a stored route the device answer is returned instead, if there is one. The queue's sends get the
  same, so they wait and retry;
- **the connection service is not `online`:** a stored route answers from the device at once and asks
  the network in the background; the late answer, if it comes, updates the device copy and is announced
  (`device.onFresh(url)`);
- **online but slow:** when a device answer exists, the request waits at most 6 seconds. After that the
  device answer is returned, `connection.unreachable()` asks the server once, and the late answer is
  handled as above. Without a device answer, the request waits as today;
- **any other 4xx or 5xx answer** is never replaced by the device copy: the server answered, so it is
  shown.

**Route shapes.** `device.ts` holds `DEVICE_SCHEMA`, one number per route shape (`graph`, `tree`,
`maps`, `map`, `chronicles`, `chronicle`, `entry`, `markerSets`, `schema`, `libraryFile`), stored with
each answer. A device answer whose number differs from the running app's is not served (it counts as
absent) and is replaced when the next read of that address succeeds; answers are never dropped in bulk,
so an update made while offline does not empty the device. The rule, written beside it: raise a route's
number when its answer changes in a way the pages cannot read. Adding an optional field needs no raise.

| Route | Offline answer |
| --- | --- |
| `/api/graph`, `/api/tree`, `/api/maps`, `/api/chronicles`, `/api/marker-sets`, `/api/schema`, `/api/library-files/:name` | the device answer, with unsent creates and deletes from the queue laid over the tree and the graph (below) |
| `/api/entries?path=`, `/api/maps/:id`, `/api/chronicles/:id` | the device answer if the item is on this device; else `ApiFailure(0, "not_on_device", …)` |
| `/api/switcher?q=` | made from the compact index by `rankNames` (below) |
| `/api/images/find?name=&from=` | resolved with `createResolver` over the index's nodes and `files` |
| everything else, including `/api/search` and `/api/preview` | no offline answer: the failure as today |

**One rule in two places becomes one function.** The server's switcher ranking (`/api/switcher` in
`apps/server/src/routes/search.ts`) moves to `@frontier/vault` as `rankNames(notes, query, appendices)`.
The route calls it, and the device answer calls the same code, so the offline switcher orders names as
the online one does.

**Unsent changes laid over the index and the tree.** From the queue's records (`queue.current()`):

- a `create` record adds a node (title from the file name, `unpublished: true`) and a tree note (state
  `unpublished`);
- a `delete` record removes them;
- an `edit` or `create` record's text replaces that node's own outgoing edges, found with `findLinks`
  and resolved with `createResolver`, as 14a's server does for a draft.

No other node's links are resolved again, which is 14a's rule.

**Marking device answers.** The device layer records each answer object it returns in a
`WeakMap<object, number>` of the time it was stored. `servedFromDevice(value)` reads it. The entry page,
the editor, the map page, the chronicle page and the graph show one line from it,
`<OfflineCopy at={…} />`: "Offline copy from 14:05" (or "from yesterday, 18:40", or a date). Lists, the
tree and the switcher show nothing more: the connection mark already says "Not connected". The switcher
adds "Full-text search needs a connection." under the names; a hover preview and the map's entry panel
read "Needs a connection".

**Unsent text comes first.** When the queue holds a record for an entry, the reader and the editor show
the record's text, offline or not: the editor already does (`Edit.tsx` lays the unsent text over what it
read); the reader (`Entry.tsx`) does the same from 15b, rendering the record's text with links resolved
by `createResolver` over the compact index, and adds "Not sent yet". So the reader shows a paragraph
written offline, and an entry made offline, which has no device answer, opens from its record in both
the reader and the editor.

**Not on this device.** A page whose body is not on the device and has no queue record shows the new
`<NotOnDevice>` component: "<Name> is not on this device. It opens when you are connected.", the entry's
folder, and its links out and in from the compact index, each a link. `Problem` stays as it is.

**Back online, before the first edit.** The editor opened from a device answer (`servedFromDevice`)
listens to the connection and to `device.onFresh`. When it turns `online`, or a late answer for its
entry arrives, and the queue holds no record for the entry, it reads the entry again. If the draft id,
revision or blob differ from what it opened with, it replaces the text and the known base, as the
existing "coming back to this tab" check in `Edit.tsx` does, and says "Updated from the server". If a
record exists, nothing is replaced: the record carries the base it started from, and the server keeps a
kept copy if that base has moved on (stage 11 §2). The map and chronicle pages do the same with their
loaded copy when no record exists. With a record, the queue's merge covers them.

### 7. "On this device" in Settings (15b)

A new block at the top of `apps/web/src/pages/Settings.tsx`, "On this device". It renders from the
device alone, before and apart from `/api/settings`, so it shows offline; the blocks below it still need
the server and show `Problem` as today when it cannot be reached. It holds:

- the iPhone card (§2) when it applies;
- "Space used: 41 MB" (§5);
- "Remove everything on this device", which asks "Remove the copies of entries, maps and chronicles on
  this device? Changes not sent yet stay." and then empties `answers`, `items` and `frontier-images`.

### 8. Writing offline (15b and 15c)

Writes already go through the queue, which keeps them until the server confirms them. What offline needs
is the page to open (§6) and the rules below.

| What | Offline | Release |
| --- | --- | --- |
| Edit an entry on this device | yes: the editor opens from the device answer; `queue.put` as today, with the stored draft id, revision and blob | 15b |
| Delete an entry (a delete draft) | yes, through the queue as today. A never-sent create is removed from the queue on the device (below) | 15b |
| New entry | yes (below) | 15c |
| Edit a map or chronicle on this device | yes: the page opens from the device answer; its `revision`, `blob` and value are the base of the first record | 15b |
| Link a map feature or chronicle span to an entry | yes: by path through the record's `link`, as today; the entry combobox lists names from the compact index | 15b |
| Folder file: new empty folder, order, icon, colour, type | yes, through the queue as today | 15b |
| Map styles file (13d) | yes, through the queue as today | 15b |
| Rename, move, folder delete, apply a folder's type | no: "Needs a connection" | as today |
| Create, copy, delete a map or chronicle; make a chronicle the main one | no: "Needs a connection" | 15b disables them |
| Image upload, paste, drop, import from a web address | no (below) | 15b disables them |
| Comments, AI, discoveries, history, export, import, inbox, Save a version, Discard a draft already sent, passkeys and sign-in settings, logout | no: "Needs a connection" | 15a (logout), 15b (the rest) |

**Controls that need a connection, by file.** Today `useNeedsConnection()` (stage 11) is read in
`components/ui/ActionButton.tsx`, and so by every `ActionButton` in `CommentsPanel.tsx`,
`WritingPanel.tsx`, `pages/Chronicles.tsx`, `pages/Maps.tsx`, `pages/Rename.tsx`,
`pages/Unpublished.tsx` and `pages/Versions.tsx`; and directly in `components/Tree.tsx`,
`components/EditToolbar.tsx`, `pages/MapPage.tsx` and `pages/Edit.tsx`. These files make direct writes
with plain buttons, and 15b gives each `useNeedsConnection()`:

| File | Controls |
| --- | --- |
| `components/shell/AppMenu.tsx` | Log out (15a) |
| `pages/ChroniclePage.tsx` | Copy, Make main, Delete |
| `pages/MapPage.tsx` | Delete, discoveries (the remaining ones not yet gated) |
| `pages/Maps.tsx` | the new-map form's image upload |
| `pages/Edit.tsx` | Discard of a draft already sent; image paste and drop |
| `pages/Conflict.tsx` | Keep and Discard |
| `pages/Import.tsx` | Import files, import a library |
| `pages/Inbox.tsx` | every decision |
| `pages/Settings.tsx` | AI key and test, the field run, passkeys, the password switch |
| `pages/Ask.tsx`, `pages/Conversation.tsx`, `pages/Talk.tsx` | ask, keep, draft and delete |
| `components/ProposeFields.tsx`, `components/DiscoveryCard.tsx` | propose, keep, drop |
| `components/images/ImagePicker.tsx` (12b, once merged) | Upload and the web address |

The list is checked again when 15b lands by searching for direct calls in `api.ts` (every non-GET
function the queue does not call) and their callers.

**New entries offline (15c).**

- `NewEntry.tsx` is unchanged: it takes its folders from the tree (a device answer offline) and the
  safe-name rule from 12a's `checkEntryName`, which needs no network. Online, a name already used in the
  same folder opens that entry in the editor, and the same name in another folder is allowed; offline
  follows the same rule.
- `Edit.tsx` today treats only a 404 as "a new entry". From 15c, when the read fails with no connection
  (status 0 or `not_on_device`): a queue record for the path opens the editor from it, as today after a
  read; else a node at the path in the compact index shows `<NotOnDevice>`; else it starts a new entry
  as for a 404: `kind: "create"`, `baseBlob: ""`, and the folder's type written into the front matter
  from the folder file's device answer.
- **Deleting a never-sent create.** `remove()` in `Edit.tsx` already drops the record of a create the
  server has not seen (revision 0) without a request, so it works offline. A create sent earlier
  (revision above 0) is a draft on the server, and discarding it needs a connection.

**A clash found on reconnect (15c).** The server must keep the text, not refuse or misplace it. Three
changes in `apps/server/src/routes/drafts.ts` and `DraftStore.save`:

- **A path taken meanwhile.** `check()` refuses a `create` at a published path unless the save "may be
  stale", which it decides by `revision > 0 && baseBlob !== undefined`. 15c widens that to
  `baseBlob !== undefined && (revision > 0 || kind === "create")`. A create from a device that sends a
  base (every build since 11a-2) then reaches `DraftStore.save`, which already handles it: no draft and
  `baseBlob` `""` differing from the published blob gives a draft of the library's text, this text as
  the device's kept copy, and `stale_revision`. The queue already turns that into "Gull: two texts to
  compare". When the path holds another device's unsent create (a draft with another id), `save` already
  keeps the text as a kept copy. A create from a build without `baseBlob` is refused as today.
- **A name differing only in case.** A `create` whose path matches a published note or a draft at
  another path when letter case is ignored (`02 People/gull.md` against `02 People/Gull.md`) is treated
  as a clash on that existing path: the text becomes the device's kept copy on that path's draft (made
  from the published text when there is none), and the answer is `stale_revision` with that draft's id.
  An export to a file system that ignores case can then never hold both.
- **An entry renamed or moved elsewhere.** An edit whose path has no published note and no draft, but
  whose save is stale (it sends a `baseBlob` that is not `""`), or whose `draftId` names a draft now at
  another path, was renamed or moved on another device. The server keeps the device's text as a kept
  copy:
  - at the rename's new path, when a rename record exists: a pending rename intent from that path or
    from a folder above it, the draft the device knew now at another path (`movePath`), or a line in
    `state/drafts/renamed.json`, a list of published renames (`from`, `to`, time; the last 500) that the
    server appends from publish's `onRenamed`. The draft at the new path is used, or made from its
    published text;
  - otherwise at a recovered path, `<folder>/<name> (from <device name>).md` (a number added if taken):
    a new create draft holding the published text the device started from (read from Git by its
    `baseBlob`), or empty if Git no longer has it, with the device's text as its kept copy.

  Either way the answer is `stale_revision` with that draft's id, so the queue shows "Harbor: two texts
  to compare" and later sends from the same record go to the same kept copy (a save whose `draftId`
  names a draft at another path is kept there, not refused). A `create` in a folder renamed elsewhere is
  handled the same way: with a rename record covering its folder, the text becomes a kept copy on a
  draft at the new folder's path (which starts with only the entry's heading). A `delete` of a path
  renamed elsewhere is refused ("Moved to <new path> on another device; delete it there") and waits in
  the unsent list.

**Images: need a connection.** While offline, the editor's image button, the image dialog's Upload,
Paste image and web address, and paste or drop of an image into the editor are disabled or refused:
"Images need a connection. Your text stays." Text paste works. The reasons:

- the author decided so (2026-11-23); he asked for text, new entries, maps and chronicles;
- the server names an upload (`nextFreeName` over the whole library), and the embed in the text names
  the file. An offline upload would need a name chosen on the device, a send that must reach the server
  before the text that embeds it, and a rewrite of every waiting text when the server picks another name;
- photos from a phone are several megabytes each and would sit in the queue, on the device that has the
  least storage.

A design for it is under "Future improvements".

### 9. Conflicts by kind (15c)

| Kind | When both sides changed it | Where it is seen |
| --- | --- | --- |
| Entry text | the server keeps this device's text beside the draft (one kept copy per device), `stale_revision` (stage 11, exists) | `/versions/:id`, two texts compared (exists) |
| New entry at a taken path, a name differing in case, an entry renamed or moved elsewhere | the same, through the `check()` and `save` changes in §8 | the same |
| Map, chronicle, folder file, map styles file: different items changed | the queue merges item by item from the stored `base` (exists) | nothing to settle |
| The same item changed on both sides | the merge keeps this device's item, and from 15c the server keeps the replaced side as a kept copy of the draft | `/versions/:id`, shown per item, read-only (below) |
| A held-back clash at "Save a version" (the library changed under the draft) | "Keep mine" or "Take the vault's" (exists) | the Unpublished page (exists) |

**Keeping the other side of an item clash.** When the queue's `merge()` (in `queue.ts`) finds clashes, it
already sends the merged file with the server's revision. From 15c:

- the record gains `clashes?: string[]`, the keys of the clashing items. `merge()` adds the new keys to
  any already there (a union, so a merge after a failed send keeps the earlier ones); every send of the
  record carries them; a successful save clears them;
- the routes `PUT /api/maps/:id`, `PUT /api/chronicles/:id` and `PUT /api/library-files/:name` accept
  `clashes` as optional. When it is not empty and the save is accepted, the store (maps, chronicles or
  library files):
  1. makes the draft first when there is none (a map, chronicle or library file with no changes since
     the last version), from the published text, as library files already do;
  2. keeps the draft's current text, which is the other side, through a new public
     `DraftStore.keepOther(id, text, clashes, at)`, in the draft's `versions/server` slot. When that
     slot already holds a copy, the store combines the two item by item with its kind's parser: the new
     clashing items come from the new text, earlier ones stay as they were, and `clashes` is the union.
     Nothing from an earlier clash is lost;
  3. saves the merged file as today (`serverChange`);
- the slot's `KeptCopy` gains `source: "server"` and `clashes`, and its `savedAt` is when the other
  side was replaced. The compare screen names it "Server copy at 18:02", not by the sending device;
- the save's answer gains `kept: <draftId>` when a copy was kept;
- the attention count rises (kept copies are already counted).

**The notice.** `merge()` in `apps/web/src/sync/queue.ts` today says "Coast: changes from another device
were merged in. Changed in both places, yours kept: Lighthouse." before the merged file is sent. From
15c it says only "Coast: changes from another device were merged in." when there are clashes, and once
the save answers with `kept`, `answered()` says "Coast: changed in both places: Lighthouse. Yours is in
the map; the other version is kept." with "Compare" linking to `/versions/<draftId>` ("in the
chronicle", "in the folder list", "in the map styles" for the other kinds). Older servers do not answer
`kept`, and the first notice then keeps today's wording.

Older builds do not send `clashes` and keep today's behaviour. `CLIENT_API` is not raised: the field is
optional (§3).

**The compare screen for item files.** `/versions/:id` (`apps/web/src/pages/Versions.tsx`) reads the
draft and its kept copies as today. When the draft's path is a map (`.frontier/maps/…`), a chronicle or a
library item file, it parses both texts with that kind's parser and shows, for each key in the kept
copy's `clashes`:

- the item's name (a feature's or span's label, a folder's path, a style's name);
- a small read-only table of the fields that differ: "This map now" and "Server copy at <time>".
  Positions are shown as "moved" with a "Show on map" link to `mapUrl(id, feature)`;
- an item the other side removed reads "Removed in the server copy".

The author changes the item by hand on its own page if he wants the other side. "Dismiss" removes the
kept copy (`DELETE /api/drafts/:id/versions/server`, a small new route over a public
`DraftStore.dropKept(id, slot)`), which lowers the attention count; publishing the draft removes it too,
as for text. Choosing per item and applying it are under "Future improvements".

### 10. The graph and other views offline (15b)

- **The graph** (14a's `graph/data.ts`) reads `api.graph()`, which offline returns the stored compact
  index with unsent creates, deletes and edited links laid over it (§6). New entries made offline are
  drawn dashed, as unpublished. The screen and the Graph tab show `<OfflineCopy>` over the canvas.
  [Stage 14 §10](stage-14-graph.md#10-offline-stage-15)'s "The graph needs a connection" now shows only
  when no compact index is stored (a first visit offline).
- **Links in an entry on this device** are as its device answer resolved them. A link to an entry that
  is not on the device opens its `<NotOnDevice>` page.
- **`[[` completion and the switcher** use `/api/switcher`, answered from the index (§6).
- **The tree** is the stored tree with unsent creates and deletes laid over it.
- **The map page** shows linked entries' names from its device answer's `entries`, and for links made
  offline from the compact index.
- **The status counts** (unpublished, inbox, attention) show the last snapshot received, stored in
  `meta` (§5).

### 11. Logout (15a, 15b; the warning exists)

The session cookie is httpOnly: the page cannot remove it, and only the server's answer to
`POST /api/logout` does. A logout offline would leave the session in the browser after the device was
wiped, so logout needs a connection. While offline, Log out in the app menu is disabled with "Needs a
connection" (15a).

Online, `logout()` in `apps/web/src/components/Shell.tsx`:

1. warns when changes are unsent (exists);
2. calls `/api/logout`. If that fails, nothing is wiped and the menu says "Could not log out: no
   connection." Today the failure is ignored; from 15a it is not;
3. clears the queue and the device id (`queue.clear()`, exists), which also posts the `cleared`
   broadcast;
4. calls `wipeDevice()` in `apps/web/src/offline/wipe.ts`, which removes `signedIn` and `snapshot` from
   `meta`, deletes every Cache Storage cache whose name starts with `frontier-` or `workbox-`, and
   unregisters the service worker (15a); from 15b it also clears the `answers` and `items` stores;
5. reloads to `/login`, where no worker is registered (§1).

Other open tabs hear the existing `cleared` broadcast; from 15a they stop the device keeper (15b) and
reload, so they show the login page too.

`localStorage` keeps only display settings (side bar width, preview mode, graph depth), which say
nothing about the library, and they stay.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A broken service worker keeps serving a broken app | The worker answers only navigations, built files and images on the device; `/sw.js` is never cached and is checked on navigation and focus; the kill worker (§1) takes over at once and removes it without touching the queue |
| The service worker hides an offline server, so the app thinks it is online | It never answers `/api/` data, the status stream or any non-GET request (§1); the connection service sees every failure as today |
| A proxy or captive portal answers for a stopped server | 502, 503, 504 and answers that are not JSON count as unreachable (§6) |
| An update reloads while the author types | The worker never skips waiting by itself; Reload is the author's; the offer waits until nothing is being sent and no editor has the focus (§3) |
| An update reloads one tab and leaves another on the old app | Every tab reloads on `controllerchange` (§3); an older tab holding the database closes it and asks for a reload (§5) |
| Reload is pressed before the new worker has installed | The reload waits for `installed`, with a 10-second fallback to a plain reload (§3) |
| A new build cannot read the old build's queue records | Records keep their shape across builds; changes are IndexedDB upgrades that convert them; a test opens a version 1 database with the new code |
| A new build cannot read an old device answer | `DEVICE_SCHEMA` per route: an answer of another shape is not served and is replaced on the next good read (§6) |
| An old app writes a shape a new server misreads | `frontier-api` on every request lets a later server tell; until a refusal exists, `CLIENT_API` is raised only with a server that still reads the old shape (§3) |
| Safari clears storage, unsent changes included | The Home Screen card and `persist()`; the author's accepted condition. Checked by hand on a real iPhone; CI runs Chromium only |
| The Home Screen app does not share Safari's storage, so changes waiting in Safari are not in the app | The card says to send waiting changes before switching, and to log in once in the installed app |
| Stored bodies go stale and the author edits an old copy | The refresh by `v` and the `drafts` counter while online (§5); the re-read before the first edit and on a late answer (§6); a stale save becomes a kept copy, never an overwrite (stage 11 §2) |
| A slow connection makes every page wait | Offline, device answers come at once; online, reads with a device answer wait at most 6 seconds (§6); the start's session check waits 3 seconds (§4) |
| Storage fills up | Fixed counts (30, 5, 5); a failed write removes the oldest item and tries once more (§5) |
| A removed body was about to be edited | An item with a queue record is never removed; the editor's text is in the queue on every keystroke |
| Someone with the device reads the library on it | The same as any signed-in browser; offline start only within 30 days of the last session check (§4); logout wipes everything (§11) |
| Logout offline leaves the session cookie behind | Logout needs a connection (§11) |
| A new entry made offline clashes with one made elsewhere, or with a name differing in case | The server keeps it as a kept copy (§8) |
| An entry renamed elsewhere is edited offline | The text goes as a kept copy to the new path, or to a recovered path (§8) |
| An item clash after days offline silently drops the other side | The other side is kept on the server and shown per item (§9) |
| The precache is large on a phone | About 2.0 MB of built files; the map and graph chunks are among them so those pages open offline; listed in the build output |
| Two tabs fetch and remove the same items | Only the tab holding the sender lock runs the device keeper (§5) |
| `vite-plugin-pwa` or Workbox lags Vite | One plugin and three small Workbox modules; the worker source is ours; if the plugin blocks a Vite upgrade, `injectManifest` is replaced by a small Vite plugin that writes the same manifest list (Alternative A) |
| The browser tests break when a service worker controls the page | The `phone` and `desktop` projects block service workers and skip the offline tests; a separate `offline` project allows them (Verification Plan); a spike checks what Playwright sees first (15a step 1) |

## Alternatives Considered

### Alternative A: A hand-written service worker

- **Pros**: No new dependency; every line is ours.
- **Cons**: We would write the list of built files with their hashes into the worker at build time, keep
  one cache per build and delete old ones, and serve `index.html` for navigations. Each has known
  mistakes that leave users on an old build.
- **Reason for Rejection**: `injectManifest` keeps the worker ours (about 60 lines) and takes only the
  tested parts: the precache list, versioned caches and their cleanup.

### Alternative B: Serve offline reads from the service worker (network first, cache fallback)

- **Pros**: No change in `api.ts`; every request is covered.
- **Cons**: A read answered by the worker looks like a success to the page, so the connection service
  thinks it is online (the brief's warning); the page cannot tell an old copy from a fresh one;
  derived answers (switcher, image lookup) need the index inside the worker; keeping and removing items
  would live in two places.
- **Reason for Rejection**: The read-through in `api.ts` knows the connection, marks the copy, and
  derives answers with the same functions the server uses.

### Alternative C: Keep the whole library on the device

- **Pros**: Everything readable offline; full search.
- **Cons**: About 430 entries plus every map and image: hundreds of megabytes on a phone, and a refresh
  that never ends on a weak connection.
- **Reason for Rejection**: The author asked only for the last few files; the whole index is stored so
  names and links work everywhere.

### Alternative D: A separate `/api/offline/index` route for the compact index

- **Pros**: The graph response stays as 14a wrote it.
- **Cons**: Two builders of almost the same data from the same index, and two requests to store.
- **Reason for Rejection**: Three optional fields on the 14a response make it the index; the graph offline
  is then the same answer.

### Alternative E: Queue images offline

- **Pros**: Pasting a photo offline would work.
- **Cons**: See §8: names chosen on the device, ordering between records, rewriting waiting texts,
  megabytes in the queue.
- **Reason for Rejection**: The author decided images need a connection; designed under "Future
  improvements".

### Alternative F: Automatic three-way merge of entry text from a base copy on the device

- **Pros**: Fewer "two texts to compare".
- **Cons**: A wrong merge of prose is silent and worse than a shown conflict; the base text would be
  stored for every edited entry.
- **Reason for Rejection**: Stage 11 chose kept copies; offline makes clashes more frequent, not merges
  safer.

### Alternative G: Item clashes keep "mine" with a notice only (today)

- **Pros**: No server change.
- **Cons**: After a long offline gap the other device's change to that item is gone, named only in a
  notice.
- **Reason for Rejection**: The brief's ideal is that nothing typed is lost; one optional field and a
  kept-copy slot keep it.

### Alternative H: Update automatically when the queue is empty

- **Pros**: The author is always on the newest build.
- **Cons**: A reload while he reads or arranges a map, without warning.
- **Reason for Rejection**: The brief asks for the author's choice.

### Alternative I: Refuse writes from a client too old for the server (`client_outdated`)

- **Pros**: A deploy that changes a write's shape cannot be misread.
- **Cons**: A hook on every write, a new error code, a queue row that pauses all sending and a bar
  state, for a case no change in this stage needs; a hook placed wrongly would also refuse the webhook
  or the login.
- **Reason for Rejection**: Goldfish review (zoom-out M3). 15a sends `frontier-api` so the refusal can
  be added when a change needs it.

### Alternative J: Pinning ("Keep offline") and a storage budget

- **Pros**: The author chooses what stays; a bound he sets.
- **Cons**: A menu item on four pages, a list and a budget in Settings, eviction by size, refusals when
  pins exceed the budget.
- **Reason for Rejection**: The author fixed the counts (2026-11-23); with no pins the counts bound the
  size.

### Alternative K: Background Sync to send while Frontier is closed

- **Pros**: Changes leave as soon as a connection appears.
- **Cons**: Not on iOS, where the offline need is greatest; the sender would move into the worker.
- **Reason for Rejection**: The queue sends whenever Frontier is open, which is when the author works.

## Future improvements

Each can be added on its own if the author asks.

- **Images offline:** a queue record `image:<op>` holding the file as a Blob, with the name chosen on the
  device by `nextFreeName` over the index's `files` and other waiting images. An entry record that embeds
  it waits until it is sent. `POST /api/images` accepts the wanted name and an `op`, and answers the
  name it used. When that name differs, the queue rewrites the embed in every waiting record before
  sending them. Images on the device count against a separate cap.
- **"Keep offline" pinning and a storage budget setting** (Alternative J).
- **A `client_outdated` refusal** for writes below a minimum client API number, with its queue row and
  bar state (Alternative I).
- **Comparing build ids** on each answer to notice a new version sooner than focus and navigation do.
- **Choosing per item on the compare screen** ("Use the other"), with `merge-versions` accepting map,
  chronicle and library item file drafts.
- **Full-text search offline** over the entries on this device (MiniSearch, which the server uses).
- **Hover previews offline** from the entries on this device.
- **A name check in New entry offline** against the compact index and the queue's creates.
- **Comments offline** through the queue, with their anchors checked on send.
- **Links to entries that are not on the device** drawn with a faint mark while offline.
- **A three-way view on the compare screen** for text, when the device still holds the base.
- **Drawing both sides of a map clash on the map** instead of the item list.
- **A recent count the author sets,** and per-folder keeping.
- **Background Sync** on browsers that have it.
- **Offline folder renames and moves,** if the server's link planning can run on the device.

---

## Detailed Implementation Plan

Three releases, in order. Each must pass the Verification Plan before it is merged and deployed. 15b
starts after 14a is merged; 13d is not required (the styles file is stored once it exists). 15c starts
after 15b and after 12a is merged. Releases 11c and 13a-1 are being built at the same time; this stage
reads their files as they land and changes none of their code but where a step names it.

Tests in `apps/web/src/offline/` and `apps/web/src/components/` that need a browser start with
`// @vitest-environment happy-dom`: the web app's `vitest.config.ts` gives happy-dom only to
`src/sync/**`. Tests of pure functions run in Node.

### Release 15a: the installable app

1. **Spike** (a throwaway spec, not merged; its findings go in the pull request): with the installed
   `@playwright/test` 1.63.0, against the production build, confirm that `context.setOffline(true)`
   makes both the page's and the service worker's fetches fail, and list which requests
   `context.route` sees while a worker controls the page (the worker's own fetches; navigations and
   images the worker answers from its cache). If `context.route` does not see what the tests need, the
   fallback is: assert the worker's work from the page with `caches.match(…)` and
   `navigator.serviceWorker.controller`, and route only `/api/` data requests, which the worker never
   answers.
2. `apps/web/package.json` (Modify): dev dependencies `vite-plugin-pwa@^2.0.0`, `workbox-build@^7.4.1`
   and `workbox-window@^7.4.1` (the plugin's peers), `sharp@^0.33.5` (the server's version, for the
   icons script); dependencies `workbox-precaching@^7.4.1`, `workbox-routing@^7.4.1`,
   `workbox-strategies@^7.4.1` (bundled into the worker). `typecheck` and `build` also run
   `tsc -p src/sw/tsconfig.json --noEmit`.
3. `apps/web/vite.config.ts` (Modify): `VitePWA` with `strategies: "injectManifest"`,
   `srcDir: "src/sw"`, `filename: "sw.ts"`, `injectRegister: false`, `devOptions.enabled: false`, the
   manifest of §2, `injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
   maximumFileSizeToCacheInBytes: 5242880 }`; a small plugin whose `writeBundle` hook hashes the
   emitted `index.html` (SHA-256, first 12 hex) and writes `dist/build.json` (`{ build, api:
   CLIENT_API }`).
4. `apps/web/src/sw/sw.ts` (Create): `precacheAndRoute(self.__WB_MANIFEST)`, `cleanupOutdatedCaches()`;
   a `NavigationRoute` to `createHandlerBoundToURL("/index.html")` with `denylist: [/^\/api\//,
   /^\/health$/]`; the image route, `StaleWhileRevalidate({ cacheName: "frontier-images" })` limited to
   addresses already in that cache, with the any-width fallback on a network failure; on the message
   `SKIP_WAITING`, `self.skipWaiting()`; no other `skipWaiting()` and no `clients.claim()`. Each route
   asks `routeOf` first. `apps/web/src/sw/routes.ts` (Create): `routeOf({ url, method, mode })`, pure.
   `apps/web/src/sw/tsconfig.json` (Create): `lib: ["ES2023", "WebWorker"]`, `types:
   ["vite-plugin-pwa/client"]`, including `src/sw/**/*.ts`, so `routes.test.ts` is typechecked there
   (it imports `describe`, `it` and `expect` from `vitest`). `apps/web/tsconfig.json` (Modify): excludes
   `src/sw`.
5. `apps/web/src/sw/routes.test.ts` (Create, Node): navigations to `/`, `/e/…`, `/map/x` give `shell`;
   `/api/…` navigations, every non-GET, `/api/session`, `/api/login`, `/api/passkeys/login/options`,
   `/api/settings`, `/api/status`, `/api/status/events`, `/health`, `/sw.js`, `/build.json` and
   `/api/images?branch=…` give `none`; `/api/images?path=…&w=…` gives `image`; `/assets/a-1.js` gives
   `precache`.
6. `apps/web/public/icons/icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
   `apple-touch-icon.png` (Create): §2. `apps/web/scripts/icons.mjs` (Create): makes the PNGs from the SVG
   with `sharp`.
7. `apps/web/index.html` (Modify): `<link rel="manifest" href="/manifest.webmanifest">`, `<link
   rel="icon" href="/icons/icon.svg">`, `<link rel="apple-touch-icon"
   href="/icons/apple-touch-icon.png">`, `<meta name="theme-color" content="#f7f3ea">` and `<meta
   name="theme-color" content="#171512" media="(prefers-color-scheme: dark)">`.
8. `packages/schema/src/client.ts` (Create): `CLIENT_API` and the rule for raising it.
   `packages/schema/src/index.ts` (Modify): exports it.
9. `apps/server/src/config.ts` (Modify): `serviceWorker: boolean` from `FRONTIER_SERVICE_WORKER` (on
   unless `off`). `apps/server/test/config.test.ts` (Modify).
10. `apps/server/src/killWorker.ts` (Create): `killWorker(self)`, the kill worker of §1 as a function;
    `/sw.js` serves `(${killWorker.toString()})(self);`. `apps/server/src/web.ts` (Create):
    `webRoutes(app, { webDir, serviceWorker })`: reads `build.json` (missing: `{ build: "dev" }`);
    `GET /sw.js` (the kill worker when off; else the built file, or 404 when it is missing); `GET
    /build.json` (with `worker: false` when off); both with `cache-control: no-cache`, set on the reply.
    `apps/server/src/app.ts` (Modify): `fastifyStatic` gains `globIgnore: ["sw.js", "build.json"]`,
    `cacheControl: false`, and `setHeaders` giving `no-cache` to `index.html` and
    `manifest.webmanifest`, `public, max-age=31536000, immutable` to `assets/*`, `public,
    max-age=86400` to `icons/*`; registers `webRoutes` when the app is served; the not-found handler's
    `index.html` keeps `no-cache`; the CSP gains `worker-src 'self'; manifest-src 'self'`; the `onSend`
    hook adds `frontier-build` to `/api/` answers.
11. `apps/server/test/web.test.ts` (Create), with a temporary `webDir` holding `index.html`, `sw.js`,
    `build.json`, `manifest.webmanifest` and `assets/a-123.js`: `no-cache` on `/`, `/index.html`,
    `/sw.js`, a page address, the manifest and `build.json`; `immutable` on the asset; the CSP holds
    `worker-src 'self'`; `frontier-build` on an `/api/` answer. With the switch off, `build.json` says
    `worker: false`, and the kill worker, run against a fake `self` (event listeners, `caches`,
    `clients`, `registration`), calls `skipWaiting()` on `install`, and on `activate` calls
    `clients.claim()`, then deletes only the `workbox-` and `frontier-` caches, unregisters, and
    navigates each window client `matchAll` returns; it never names `indexedDB`. With no `build.json`
    and no `sw.js`: `/build.json` says `build: "dev"`, `/sw.js` is 404.
12. `apps/web/src/api.ts` (Modify): `frontier-api` in `headers()` (sent before the device is known too);
    502, 503, 504 and a 2xx answer that is not JSON become `ApiFailure(0, "offline", …)` with
    `connection.unreachable()`. `apps/web/src/api.test.ts` (Create, happy-dom): each of those is status 0;
    a 500 and a 404 are not.
13. `apps/web/src/sync/connection.ts` (Modify): `startOffline()`: sets `offline`, then `start()`.
    `apps/web/src/sync/connection.test.ts` (Modify): `startOffline()` is `offline` until the probe
    answers.
14. `apps/web/src/sync/queue.ts` (Modify): public `meta<T>(key)` and `setMeta(key, value)` over its
    store; on the `cleared` broadcast, listeners of `onCleared` hear it. `apps/web/src/sync/queue.test.ts`
    (Modify): `meta` round-trips; `onCleared` fires in the other tab.
15. `apps/web/src/offline/start.ts` (Create): `startMode(signedIn, now)` (`"check"` or `"may-start-offline"`)
    and `sessionWithin(ms)`, the 3-second race of §4. `apps/web/src/offline/start.test.ts` (Create, Node):
    no `signedIn`, or `until` past, never starts offline; a timeout or status 0 with a valid `signedIn`
    does; a late "logged out" turns it `signed-out`.
16. `apps/web/src/offline/updates.ts` (Create): `register()` (skipped in dev, without service workers,
    on `/login`, or when `/build.json` says `worker: false`) through `navigator.serviceWorker.register`
    and `workbox-window`'s `Workbox` for the waiting events; `update()` on `focus`,
    `visibilitychange` and route changes, at most once a minute; the offer rule (no record `sending` in
    `queue.current()`, and `document.activeElement` not inside `.cm-editor`); `reload()` (§3);
    `controllerchange` reloads the tab once; a small store `useUpdate()`. `apps/web/src/offline/updates.test.ts`
    (Create, happy-dom, fake timers, a fake `ServiceWorkerContainer`): the offer hidden while a record is
    sending or the editor has the focus, shown with only waiting or attention records; Reload with a
    waiting worker posts `SKIP_WAITING`; with an installing one, posts only after `installed`; after 10
    seconds with no installed worker, reloads; `controllerchange` reloads once.
17. `apps/web/src/components/UpdateBar.tsx` + `.css` (Create): §3's bar. `apps/web/src/components/Shell.tsx`
    (Modify): shows it above the page.
18. `apps/web/src/App.tsx` (Modify): §4 with `start.ts`; `signedIn` written after login and each good
    session check; `updates.register()` once signed in. `apps/web/src/main.tsx` is unchanged.
19. `apps/web/src/offline/wipe.ts` (Create): `wipeDevice()` of §11 (15a part). `apps/web/src/components/Shell.tsx`
    (Modify): `logout()` of §11: stops on a failed `/api/logout`; calls `wipeDevice()` after
    `queue.clear()`; reloads to `/login`; other tabs reload on `onCleared`.
    `apps/web/src/components/shell/AppMenu.tsx` (Modify): Log out disabled offline with "Needs a
    connection". `apps/web/src/offline/wipe.test.ts` (Create, happy-dom, fake-indexeddb, fake `caches`):
    only `frontier-` and `workbox-` caches go; `signedIn` goes; display settings stay.
20. `playwright.config.ts` (Modify): `serviceWorkers: "block"` in the `phone` and `desktop` projects;
    `phone`'s `testIgnore` becomes `/offline\.spec\.ts|auth\.setup\.ts/`; a new project `offline`
    (`devices["iPhone 13"]` with `defaultBrowserType: "chromium"`, `storageState: AUTH`,
    `dependencies: ["setup"]`, `serviceWorkers: "allow"`, `testMatch: /offline\.spec\.ts/`).
21. `apps/web/e2e/offline.spec.ts` (Create), shaped by the spike's findings: after
    `navigator.serviceWorker.ready`, `context.setOffline(true)` and a reload shows the app signed in
    with "Not connected"; the manifest is linked and parses; Log out is disabled offline. Last in the
    file (it ends the context's session): online logout leaves `caches.keys()` empty and no
    registration, and shows the login page, where no worker registers.
22. `docs/designs/SITEMAP.md` (Modify): this design registered.

### Release 15b: the device copy

23. `packages/schema/src/graph.ts` (Modify): `GraphNode` gains `id?` and `v`; `GraphResponse` gains
    `files`. `packages/schema/src/status.ts` (Modify): `StatusSnapshot` gains `drafts`.
    `packages/schema/test/schemas.test.ts` (Modify).
24. `apps/server/src/index/graph.ts` (Modify): fills `id`, `v` (blob prefix and draft revision) and
    `files` (non-note library files outside excluded folders, and unpublished uploads).
    `apps/server/test/graph.test.ts` (Modify): `v` changes with a draft save and with a version; `files`
    lists `99 Appendices/Images/lamp.png` and an unpublished upload, and not `.obsidian` files; `id` comes
    from the field.
25. `apps/server/src/routes/maps.ts`, `routes/chronicles.ts` (Modify): list items gain `v`.
    `apps/server/src/state/drafts.ts` (Modify): a `drafts` counter raised on every save, server change
    and discard; `apps/server/src/status/status.ts` (Modify): sends it.
    `apps/server/test/maps.test.ts`, `chronicles.test.ts`, `state.test.ts` (Modify): `v` changes with a
    save; the counter rises.
26. `packages/vault/src/rank.ts` (Create; not `names.ts`, which 12a creates): `rankNames(notes, query,
    appendices)`, moved from `apps/server/src/routes/search.ts` (Modify), which calls it.
    `packages/vault/src/index.ts` (Modify). `packages/vault/test/rank.test.ts` (Create): the ranking as
    the route gives it today (the route tests in `apps/server/test/search.test.ts` pass unchanged).
27. `apps/web/src/sync/db.ts` (Modify): database version 2 with `answers` and `items`, the upgrade
    branching on `oldVersion`; `blocking` closes the connection and calls an `onBlocking` listener;
    `blocked` calls `onBlocked` after 5 seconds; `Store` gains reads and writes of the new stores (the
    memory store keeps nothing). `apps/web/src/sync/db.test.ts` (Create, fake-indexeddb): a version 1
    database with queue records, `device` and `signedIn` opens as version 2 with all of them intact; `signedIn`
    cleared with `clearMeta`; a second open at a higher version makes the first close.
28. `apps/web/src/offline/device.ts` (Create): the read-through of §6 (stored routes, the offline and
    slow-network rules, `DEVICE_SCHEMA`, `servedFromDevice`, `onFresh`), the derived answers (switcher
    through `rankNames`, image lookup through `createResolver`), the overlay of unsent records on the
    index and the tree, the store clearing used by `wipeDevice()` and "Remove everything on this
    device". `apps/web/src/offline/device.test.ts` (Create, happy-dom, fake-indexeddb): an answer stored
    on success and returned on failure, marked; a 404 never replaced; a 503 and an HTML answer give the
    device answer; offline, the device answer comes at once and a late answer updates it and fires
    `onFresh`; the slow network gives the device answer after 6 seconds (fake timers); an answer with
    another shape number is not served and is replaced by the next good read; the switcher from the
    index orders names as `rankNames` does on the fixture; the overlay adds a create, removes a delete
    and replaces an edited note's edges only.
29. `apps/web/src/api.ts` (Modify): `call()` uses the device layer for GET requests; `maps()` and
    `chronicles()` types gain `v`.
30. `apps/web/src/offline/keeper.ts` (Create): recent items, the counts (30, 5, 5), image storing, the
    refresh by `v`, `drafts` and the last snapshot in `meta`, the removal of §5 and the retry on a full
    store, `persist()`, run in the tab holding the sender's lock, stopped on `onCleared`.
    `apps/web/src/offline/keeper.test.ts` (Create, happy-dom, fake-indexeddb): the 31st entry removes
    the oldest; an item with a queue record is never removed; an image shared by two items stays until
    both go and is counted once in the space used; a full store removes the oldest and retries once;
    refresh fetches only entries whose `v` changed and maps whose list `v` changed, and skips those with
    a record; a changed `drafts` count starts a refresh.
31. `apps/web/src/components/OfflineCopy.tsx` + `.css` (Create): "Offline copy from …".
    `apps/web/src/components/NotOnDevice.tsx` + `.css` (Create): §6's page, with the folder and links
    from the compact index.
32. `apps/web/src/pages/Entry.tsx` (Modify): marks the item opened; `OfflineCopy`; `NotOnDevice`; the
    queued text shown when a record exists, with "Not sent yet" (§6). `apps/web/src/pages/Edit.tsx`
    (Modify): marks the item opened; `OfflineCopy`; reads again on reconnecting and on `onFresh` when no
    record exists (§6); image paste and drop (today `api.upload` in its paste handler) refused offline
    with "Images need a connection. Your text stays."; Discard of a sent draft disabled offline.
    `apps/web/src/pages/MapPage.tsx`, `pages/ChroniclePage.tsx` (Modify): the same marking and re-read.
33. The controls of §8's table (Modify, each file listed there): `useNeedsConnection()`.
    `apps/web/src/components/EditToolbar.tsx` (Modify): the image button disabled offline.
34. `apps/web/src/components/HoverPreview.tsx`, `components/MapPanels.tsx` (Modify): "Needs a
    connection" on a status 0 failure. `apps/web/src/components/Switcher.tsx` (Modify): "Full-text
    search needs a connection." while offline.
35. `apps/web/src/graph/data.ts` and `apps/web/src/pages/Graph.tsx` (Modify, 14a's files): the graph from
    `api.graph()` as before, `OfflineCopy` over the canvas, the offline `Problem` only without a stored
    index.
36. `apps/web/src/pages/Settings.tsx` (Modify): "On this device" (§7) as the first `settings-block`,
    rendered outside `SettingsPage`'s wait for `/api/settings`; its few new rules go in
    `apps/web/src/styles.css` (Modify) beside `.settings-block`. `apps/web/src/components/InstallCard.tsx`
    (Create): the card, also shown once when the first item is stored in Safari on an iPhone.
37. `apps/web/src/offline/wipe.ts` (Modify): also clears `answers` and `items`.
38. `apps/web/src/components/ConnectionMark.tsx` (Modify): "Not connected · N changes waiting" while
    offline with records.
39. `apps/web/e2e/offline.spec.ts` (Modify), in the `offline` project. Entries and maps it makes have
    names unique to the run (a suffix from `Date.now()`) in the shared sample vault, and each test
    discards its drafts at its end:
    - CUJ 2: open Harbor and Mira online; go offline; reload; the switcher finds Harbor and "Old Quay";
      Harbor shows "Offline copy from"; edit and type `[[Old` and pick Old Quay; the reader shows the
      new text; the connection mark counts 1 change; go online; the count goes and the server's entry
      holds the text;
    - CUJ 5: offline, Shade shows "not on this device" with its folder; the switcher says full-text
      search needs a connection; Rename is disabled with "Needs a connection";
    - a map on the device opens offline with its image drawn (checked through the page's own "image
      loaded" state, not pixels); a marker added offline is sent on reconnecting;
    - CUJ 8: offline, `/graph?focus=` Harbor selects it and the Entries tab lists every entry;
    - images: offline, the image button is disabled with "Images need a connection";
    - "On this device" shows offline with the space used;
    - CUJ 7 (last): logout with a waiting change warns; after it, `caches.keys()` is empty, the service
      worker is unregistered and IndexedDB `frontier` has no `answers`.
40. `docs/BACKLOG.md` (Modify): the offline items marked done as they land.

### Release 15c: offline writes beyond editing

41. `apps/server/src/routes/drafts.ts` (Modify): `check()` treats a `create` that sends `baseBlob` as
    possibly stale, and a `create` whose path matches a published note or a draft ignoring case as a
    clash on that path (§8). `apps/server/src/state/drafts.ts` (Modify): `save()` keeps a stale edit of a
    renamed or vanished path as a kept copy at the rename's new path or at the recovered path, and keeps
    a save whose `draftId` names a draft at another path there instead of refusing it; a public
    `keepOther(id, text, clashes, at)` writing the `server` slot; a public `dropKept(id, slot)`;
    `state/drafts/renamed.json` appended from publish's `onRenamed` (`apps/server/src/app.ts`, Modify).
    `apps/server/test/drafts.test.ts` (Create): a create with `baseBlob: ""` at a published path gives a
    draft of the library text, the device's kept copy and `stale_revision`; at a path holding another
    device's create draft, a kept copy; a create without `baseBlob` is refused as today; a create of
    `02 People/gull.md` beside a published `02 People/Gull.md` gives a kept copy on Gull's draft; an
    edit of a path renamed by a pending intent, by a published rename, and by a moved draft goes to the
    new path's draft; an edit of a vanished path with no rename record makes `… (from <device>).md` with
    the started-from text and the device's text as its kept copy; a create in a renamed folder goes to
    the new folder; a delete of a renamed path is refused.
42. `apps/web/src/pages/Edit.tsx` (Modify): the offline open-or-create of §8, with the folder's type from
    the folder file's device answer. `apps/web/src/offline/openOrCreate.ts` (Create): the rule as a pure
    function; `apps/web/src/offline/openOrCreate.test.ts` (Create, Node): record first, then a node in
    the index, then a new entry; a node in another folder with the same name does not stop a create.
43. `packages/schema/src/api.ts` (Modify): the save requests of maps, chronicles and library files gain
    optional `clashes: string[]`, their answers optional `kept`. `packages/schema/src/state.ts` (Modify):
    `KeptCopy` gains optional `source: "server"` and `clashes`.
44. `apps/server/src/maps/store.ts`, `apps/server/src/chronicles/store.ts`,
    `apps/server/src/library/files.ts` (Modify): with `clashes`, make the draft from the published text
    when there is none, combine with an existing `server` slot item by item, `keepOther`, then save.
    `apps/server/src/routes/maps.ts`, `routes/chronicles.ts`, `routes/libraryFiles.ts` (Modify): pass
    `clashes`; answer `kept`. `apps/server/src/routes/drafts.ts` (Modify): `DELETE
    /api/drafts/:id/versions/server`.
45. `apps/server/test/maps.test.ts`, `chronicles.test.ts`, `library.test.ts` (Modify): a save with
    `clashes` on a map with a draft and on one without keeps the replaced text with its clashes and
    `source: "server"`, answers `kept` and raises the attention count; a second clashing save unions the
    clashes and keeps the earlier item's other side; without `clashes`, nothing is kept (older builds);
    the `DELETE` route removes the slot and lowers the count.
46. `apps/web/src/sync/db.ts` (Modify): `QueueRecord` gains optional `clashes`. `apps/web/src/sync/queue.ts`
    (Modify): `merge()` unions `clashes` on the record and says the shorter notice; the sends carry
    them; `answered()` clears them and, with `kept`, gives §9's notice with Compare.
    `apps/web/src/api.ts` (Modify): `saveMap`, `saveChronicle`, `saveLibraryFile` carry `clashes`.
    `apps/web/src/sync/queue.test.ts` (Modify): a clashing merge stores and sends the keys; a second
    merge unions them; a success clears them; the notice texts.
47. `apps/web/src/pages/Versions.tsx` + `Versions.css` (Modify): the read-only per-item view of §9 for
    map, chronicle and library file drafts, and Dismiss. `apps/web/src/offline/itemCompare.ts` (Create):
    the fields that differ per item, pure. `apps/web/src/offline/itemCompare.test.ts` (Create, Node): a
    feature moved on one side and renamed on the other; a style removed on the other side; a folder line.
48. `apps/web/e2e/offline.spec.ts` (Modify), with two browser contexts, one per device, run-unique names
    and every draft discarded at the end:
    - CUJ 3: the phone context offline makes "Gull-<run>" in `02 People`; the desktop context makes the
      same path and saves a version; the phone goes online and shows "two texts to compare", and
      `/versions/…` lists both texts;
    - CUJ 4: both contexts load a map made for the run; the phone goes offline and moves "Lighthouse";
      the desktop renames it and its save is sent; the phone goes online; the notice offers Compare; the
      compare screen shows Lighthouse with "Server copy at"; Dismiss lowers the attention count.

### Verification Plan

- `npm run typecheck && npm run lint && npm run format && npm test && npm run build && npm run e2e`. The
  browser tests run against the production build the server serves, so the service worker under test is
  the one that ships. The `phone` and `desktop` projects block service workers and do not run
  `offline.spec.ts`. The `offline` project allows them, signs in through the `setup` project, and
  makes failures with `context.setOffline` and, as the 15a spike found possible, `context.route`. It
  uses two browser contexts for two devices.
- Unit tests with `fake-indexeddb` (already a dev dependency) for the database upgrade, the device layer,
  the device keeper, the wipe and the queue's new fields; `routes.test.ts` for what the worker answers;
  `updates.test.ts` for the offer and the reload flow; server tests for headers, the kill worker, the
  missing `build.json`, the create and rename clashes and item kept copies. Server coverage thresholds
  are kept.
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
  - in flight mode: the app opens from the Home Screen signed in; a recent entry, a recent map with its
    image and a chronicle open; an entry is edited, a new entry made, a marker moved; the unsent count
    shows 3; Log out reads "Needs a connection"; out of flight mode the count goes to 0 within a minute
    of opening the app;
  - leave the app unopened for 8 days (once, before the stage is called done); the items on the device
    and a change left waiting on purpose are still there;
  - deploy a new build; with the editor focused, no bar; in the reader, "A new version of Frontier is
    ready" appears; Reload takes it;
  - the kill switch: deploy with `FRONTIER_SERVICE_WORKER=off`; after bringing the app to the front
    once, Safari's website data for Frontier lists no service worker, and a change left waiting is still
    there and is sent; switch it back on;
  - log out while connected: the warning, then the login page; reopening the app connected shows the
    login page; reopening it in flight mode shows the browser's own offline page, which is expected.
- Screens at desktop and phone size, light and dark: the update bar, "Offline copy from", "not on this
  device", "On this device" with the iPhone card, the item compare screen.
