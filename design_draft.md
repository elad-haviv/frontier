# Stage 11: foundations, the shell and the folder tree

*   **Author:** Elad Haviv
*   **Status:** Draft
*   **Date:** 2026-11-22
*   **Parent:** [Frontier](docs/designs/frontier.md), [Frontier's own library](docs/designs/own-library.md).
    Comes from `concepts_brief.md` (stages 11 to 15), which seven fresh reviewers examined.

--------------------------------------------------------------------------------

## Overview

Stage 11 is the first of five stages that rework Frontier's interface and let it work on a bad or
missing connection. It has three parts, built in order:

*   **11a, urgent fixes and foundations.** The ten most serious problems from the UX review
    (`ux-review/expert-review.md`). Shared building blocks that every later stage uses: icons, styled
    tooltips, menus, a combobox, a list of keyboard shortcuts, and one way of saving changes that keeps
    them on the device until the server has them.
*   **11b, the shell.** The top bar goes. A collapsible left side bar holds navigation, with an app
    menu at the bottom. A right side bar with tabs, whose width can be changed, holds each screen's
    panels. On a phone they become a drawer and a bottom sheet.
*   **11c, the folder tree.** Folders can be added, nested, moved, reordered, renamed, styled and
    deleted, by drag and drop, by buttons beside the name, or by a context menu.

Stages 12 (entries and editor), 13 (maps), 14 (graph) and 15 (offline) each get their own design, and
build on what this stage provides.

## The Problem

Frontier's parts were built one stage at a time, and it shows:

*   **Navigation is a row of eleven links** across the top, repeated at the foot of the folder list. The
    folder list cannot be edited at all: folders exist only because notes sit in them, and "New entry"
    cannot choose where the entry goes (from the README it lands at the top of the library).
*   **Controls have no names.** The editor toolbar is a row of symbols (`▣`, `✎`, `[[ ]]`) with no
    tooltips. There are no context menus anywhere. Ctrl+B, Ctrl+I and Ctrl+S do nothing. Tab does not
    indent. Eight separate key listeners in four files each handle their own keys.
*   **Some screens break on a phone.** On an iPhone the map editor's Done, Undo and Delete are off the
    screen, so the author can enter edit mode and not find the way out.
*   **Some things are hard to read or easy to hit by mistake.** Secondary text is 3.25:1 against the
    page, below the 4.5:1 minimum. Delete sits next to Done; "Delete map" sits next to Undo. The editor
    body is monospace even in its preview.
*   **A bad connection looks like a broken app.** Pages go blank while loading. Search shows nothing
    when the server cannot be reached. Each page has its own retry timer and its own words for "not
    saved".
*   **Saving can lose work, today.** Four save paths exist (entry text, maps, chronicles, and the
    server's single spare slot for a clashing version), and they fail in different ways:
    *   a save does not say which version of the entry it started from, so an old save can quietly
        replace text that was published from another device;
    *   the editor clears the text it kept in the browser when it learns of a newer draft, and ignores
        it without a word when that draft was published elsewhere;
    *   a third device's clashing save replaces the second's in the spare slot;
    *   after a reload, the map and chronicle merge keeps "mine" on every clash, because its base copy
        lived only in memory.

    These are rare while every device is online and quick. Offline work (stage 15) would make them
    common, and every later stage would add more save paths of its own unless one shared path exists
    first.

The proposed solution: fix the worst review findings at once; build the shared parts (components,
shortcuts, one save queue and one connection signal) before the screens that need them; then rebuild
the shell and the tree on top.

## Goals

*   **G1. The review's top ten are fixed.** In particular: the phone map header keeps Done, Undo and
    the menu on screen at 390 px wide; map features show a pointer cursor, a highlight and their name
    on hover, and a clear outline when selected; "New entry" asks for a folder (defaulting to the
    folder in view); text meets 4.5:1 contrast; Delete actions move into a "⋯" menu; the editor's live
    preview uses the reading font.
*   **G2. Every icon-only control has a name.** A styled tooltip shows its name and shortcut on hover and
    on keyboard focus, and its accessible name is the same text.
*   **G3. One list of keyboard shortcuts**, with scopes (whole app, editor, table cell, map, dialog), is
    the only place keys are bound. The "?" key opens a sheet generated from it. Ctrl+K stays the
    switcher; Ctrl+B, Ctrl+I, Ctrl+S and Tab work in the editor; Esc then Tab leaves the editor.
*   **G4. One save queue.** Every change the web app sends (entry text, maps, chronicles, comments,
    folder changes) goes through one queue kept in the browser's IndexedDB. Each queued change carries
    the version it was made from and its own id. A change stays on the device until the server confirms
    it, survives a reload, and is never cleared or skipped without being shown.
*   **G5. The server refuses stale saves instead of guessing.** A save whose base no longer matches the
    published file or the current draft is kept as a separate version and reported, never turned into
    a fresh draft. Up to one version per device is kept, not one in total.
*   **G6. One connection signal.** The app knows whether the server is reachable, slow or gone, from the
    server's status stream and from failed requests, and shows it in one place, with a Retry. Pages
    keep their old content with a thin progress line while loading.
*   **G7. The shell.** No top bar. A left side bar that collapses to an icon rail which still shows
    search, the unpublished and inbox counts, and the connection state. A right side bar with tabs and a
    width the author sets. On a phone, a drawer and a bottom sheet.
*   **G8. Folders are editable**: add (an empty folder lasts), nest, move, reorder, rename, delete, give
    an icon and a colour, and set the default type. By drag and drop with undo, by buttons beside the
    name, and by a context menu; on touch, by a long press or the "⋯" button.
*   **G9. Folder style and order are versioned.** They live in one library file under `.frontier/`, go
    through drafts and "Save a version", appear in history, and travel in the export.
*   **G10. No regressions.** Every existing unit and browser test passes, rewritten where only selectors
    changed.

## Non-Goals

*   **Offline reading and editing.** Stage 15. This stage builds the queue offline work needs, and keeps
    today's behaviour of holding unsent text, but adds no offline cache of the library.
*   **Entry, editor and map features** from the author's list (sticky headings, the new toolbar, the image
    dialog, map styles, curves). Stages 12 and 13. This stage fixes only the review's top findings on
    those screens.
*   **Folder order in Obsidian.** The custom order is seen only in Frontier. Obsidian keeps sorting by
    name after an export.
*   **A folder note for every folder.** A folder note is made only when the author asks for one.
*   **Moving or renaming while offline.** These need the server to work out which links change.
*   **Panels that stack freely or float**, as in Obsidian. The right side bar has a fixed set of tabs per
    screen.
*   **Several people, or real-time co-editing.** One author, on more than one device.

## Open Questions

*   None open. The default type's home was decided by the author (Technical Plan, section 7).

## Critical User Journeys (CUJs)

### CUJ 1: Make a folder and fill it

*   **Given**: the author is reading an entry in `03 Gazetteer`.
*   **When**: he right-clicks `03 Gazetteer` (or presses "⋯" beside it), chooses "New folder", types
    "Islands", gives it a wave icon and a blue colour, and sets its default type to `place`. Later he
    chooses "New entry" while viewing the new folder.
*   **Then**: the empty folder appears at once and is still there after a reload, marked as an unsaved
    change. The new-entry dialog offers "Islands" as the folder; the entry is created there with
    `type: place`. After "Save a version" the folder, its icon and colour are in the history.

### CUJ 2: Reorganise by dragging, and take it back

*   **Given**: a folder `Old Coast` with 14 entries that other entries link to.
*   **When**: he drags it into `Islands`.
*   **Then**: a confirmation names the count ("Move 14 entries; 9 links in 6 other entries will be
    updated"). After he confirms, the tree shows the folder in its new place, marked unsaved, and a
    toast offers Undo for ten seconds. Undo puts everything back as it was. Without Undo, the move is
    saved with the next version, links rewritten.

### CUJ 3: Two devices, one entry

*   **Given**: the author edits entry `Harbor` on his phone on a train; the connection drops while the
    change is unsent. Meanwhile, at home, the laptop edits `Harbor` and he saves a version.
*   **When**: the phone gets a connection again.
*   **Then**: the phone's change reaches the server, which sees it was made from the older text and keeps
    it as a separate version instead of a new draft. The phone shows "Harbor: two versions to compare",
    and the same notice appears in the side bar on the laptop. Opening it shows both texts side by side
    on the existing compare screen. Nothing either device typed is lost.

### CUJ 4: Find any control without knowing the app

*   **Given**: the editor is open.
*   **When**: he hovers or tabs onto the toolbar's image button; then presses "?".
*   **Then**: a tooltip reads "Add an image" with its shortcut. "?" opens a sheet listing every shortcut
    for the current screen and for the whole app, from the same list the tooltips use.

### CUJ 5: Map on a phone

*   **Given**: the iPhone, 390 px wide, a map open.
*   **When**: he taps Edit, adds a marker, and wants to finish.
*   **Then**: Done, Undo and a "⋯" menu (holding Delete map) are on screen; the tools sit in a bar at the
    bottom; the feature panel opens as a bottom sheet that does not cover the marker.

### CUJ 6: A bad connection

*   **Given**: the server is unreachable for twenty seconds.
*   **When**: he opens another entry, then types in the current one.
*   **Then**: the side bar's connection mark turns to "Not connected" with a Retry; the open page stays as
    it was instead of going blank; the new page shows "Can't reach Frontier: Retry" instead of a blank
    page; the typed text is shown as "Kept on this device, not yet sent" and is sent when the server
    returns, without his doing anything.

## Technical Plan (Architecture)

### Shape of the change

```text
 Browser                                                      Server
 ───────────────────────────────────────────────────────      ─────────────────────────────
 Pages (Entry, Edit, Map, Chronicle, Tree, …)
   │  register panels ─────────► Shell (left bar │ main │ right bar)
   │  register shortcuts ──────► Keys registry ──► "?" sheet, tooltip hints
   │  read  ─────────────────────────────────────────────────► GET /api/…  (as today)
   │  write ──► Save queue (IndexedDB)                        PUT /api/drafts       base check
   │              one record per file, base + op id ────────► PUT /api/maps/:id     base check
   │              sends in order, survives reload             PUT /api/chronicles/… base check
   │                                                          PUT /api/folders      new
   │              ◄─── stale: kept as a version, reported      versions/<device>    N kept
   └─ Connection service ◄── EventSource /api/status/events ── status stream (exists, unused)
                         ◄── request failures and timings
```

Four shared pieces are built in 11a; 11b and 11c, and stages 12 to 15, only use them.

### 1. The save queue

Today each page saves on its own: `Edit.tsx` with a `localStorage` buffer and a 5-second retry,
`MapPage.tsx` with its own timer and merge, `useItemFile` (chronicles) with a base copy held in
memory. They are replaced by one queue in `apps/web/src/sync/`.

**What a queued record is.** One record per file, not per keystroke. A later change to the same file
replaces the record's value but keeps its base:

| Field | Meaning |
| --- | --- |
| `key` | `entry:<path>`, `map:<id>`, `chronicle:<id>` or `folders` |
| `draftId`, `revision` | the draft this device last knew of, and its revision (0 for none) |
| `baseBlob` | the hash of the published file this device started from (`""` for a new file) |
| `base` | maps, chronicles and the folder file only: the value last confirmed by the server, for a three-way merge |
| `value` | the text or file to send |
| `op` | an id made on the device for this send; a retry sends the same `op` |
| `state` | `waiting`, `sending`, `needs-attention`, `paused` |
| `error`, `tries`, `updatedAt` | for the "waiting changes" list and for backing off |

**Storage.** IndexedDB through the `idb` package (about 1 KB; the master design already named it).
One database `frontier`, stores `queue` and `meta` (holding this device's id, made once). The old
`frontier:draft:<path>` keys in `localStorage` are moved into the queue on first start and deleted.
If IndexedDB cannot be opened (a private window in some browsers), the queue runs in memory and the
side bar says "Changes are not kept on this device".

**Sending.** One sender for the whole app. It sends records one at a time, oldest first, waits while
the connection service says the server is gone, and backs off after failures (2, 4, 8 … up to 60
seconds). Each request carries the header `Frontier-Device: <id>`.

| Answer | What happens |
| --- | --- |
| saved | the record is removed if its value did not change meanwhile; otherwise it is sent again with the new revision |
| no connection | stays `waiting`; sent when the connection returns |
| 401 | the whole queue is `paused`; the login dialog opens over the page; after login, sending resumes. Nothing is cleared |
| `stale_revision` on a note | `needs-attention`; the text stays in the queue and on the server as a version (section 2) |
| `stale_revision` on a map, chronicle or folder file | the page's merge runs with the saved `base` (now kept across reloads), and the result is sent. Clashing items keep this device's side, as today, and a notice "Merged with changes from another device" is shown with a link to the history |
| other 4xx | `needs-attention` with the server's message; not retried until the author acts |

Pages no longer call `api.saveDraft`, `api.saveMap` or `api.saveChronicle`. They call
`queue.put(key, value)` and subscribe to that key's state, which drives the one save-status component.

### 2. Saves that carry their base

`SaveDraftRequest` gains an optional `baseBlob`, and the map and chronicle save bodies gain the same.
`GET /api/entries` (and the map and chronicle loads) return the published file's `blob`, so the
browser knows what it started from.

On the server (`state/drafts.ts`, `maps/store.ts`, `chronicles/store.ts`):

*   **No draft, and `baseBlob` differs from the published file's hash:** the file was changed since this
    device read it. The text is kept as a version and the answer is `stale_revision`, instead of
    starting a fresh draft on top of the newer file. A draft is made holding the published text, so the
    versions screen has two sides to compare.
*   **A draft, and an older revision or another id:** as today, `stale_revision`.
*   **`baseBlob` missing:** today's behaviour, so a browser still running an older build is not refused.

**Several versions.** The single `content.v2` slot becomes a folder `versions/` inside the draft's
folder, one file per device id (`versions/<device>.txt` with a small JSON record beside it). A second
stale save from the same device replaces only that device's version. `GET /api/drafts/:id/versions`
returns all of them with the device's name and time; `merge-versions` clears them all. A draft with an
old `content.v2` is read as one version from "an earlier device".

**Repeated sends.** Each draft record keeps the last `op` it accepted. A save whose `op` equals it is
answered with the current revision and changes nothing, so a retry after a lost answer is not saved
twice.

**Needs attention.** `GET /api/attention` (already the place for things needing the author) lists
drafts with versions. The side bar shows the count; each item opens `/versions/:id`, which loads
from the server and so works from a link or after a reload.

### 3. The connection service

`apps/web/src/sync/connection.ts` holds one state for the app: `online`, `slow`, `offline` or
`signed-out`.

*   It listens to `/api/status/events` (sent by the server today, unused by the web app). The stream
    also replaces the shell's one-time status fetch, so counts update without a reload.
*   A request that cannot reach the server, or a stream that drops and does not reconnect within 5
    seconds, means `offline`. Any answer from the server means online again.
*   A request slower than 4 seconds marks `slow` until one finishes in under 1 second.
*   `navigator.onLine` is used only as a hint to retry at once when the device says it is back.

Pages read it through `useConnection()`. Loading uses one pattern: the old content stays, a thin
progress line runs at the top of the main area, and a failure shows the reason with Retry instead of a
blank page. The switcher shows "Can't reach Frontier" instead of an empty list.

### 4. Shared interface pieces

New packages for parts the app does not have, all with keyboard and screen-reader support built in:

| Need | Package | Used for |
| --- | --- | --- |
| icons | `lucide-react` | every icon; one `Icon` wrapper fixes size and stroke |
| tooltip, context menu, dropdown menu, popover | `@radix-ui/react-tooltip`, `-context-menu`, `-dropdown-menu`, `-popover` | `Tip`, `ContextMenu`, `Menu`, popovers |
| combobox | `cmdk` inside a Radix popover | one `Combobox`: choose a folder, an entry, a map |
| resizable side bars | `react-resizable-panels` | the shell |
| tree | `react-arborist` | the folder tree: drag and drop, inline rename, keyboard, virtual rows |

`Dialogs.tsx` stays as the one dialog component. `IconButton` requires a label; it shows it as a
tooltip with the shortcut from the keys registry, and uses it as the accessible name.

**Keys registry** (`apps/web/src/keys.ts`). Every shortcut is declared once: id, keys, scope
(`app`, `editor`, `table`, `map`, `dialog`), label, action. One listener on the document runs the
action for the innermost active scope; a typing field takes only `app` keys with a modifier. The eight
existing `keydown` listeners (Shell, MapPage, ChroniclePage, Lightbox) move into it. CodeMirror's
keymap for the editor scope is built from the same list, so the "?" sheet is complete. In the editor:
Ctrl+B, Ctrl+I, Ctrl+K stays the switcher (a link is `[[`), Ctrl+S sends the queue at once, Tab moves
between table cells inside a table and indents elsewhere (`indentWithTab`), Esc then Tab leaves the
editor.

**Styles.** New components get their own CSS files beside them. `styles.css` gains tokens for
z-index layers (base, sticky, side bars, popover, menu, tooltip, dialog, toast), spacing and icon size.
`--ink-faint` and the other text tokens are darkened to at least 4.5:1 against `--paper` in light and
dark.

### 5. The shell (11b)

```text
 ┌──────────────┬─────────────────────────────────────┬──────────────┐
 │ FRONTIER  «  │                                     │ Outline │ ⋯  │
 │ 🔍 Search ⌘K │                                     │──────────────│
 │ ＋ New entry  │            page                     │  panel of    │
 │ ─ Library ── │                                     │  the open    │
 │  ▸ 01 Places │                                     │  tab         │
 │  ▸ 02 People │                                     │              │
 │ ─────────────│                                     │              │
 │ 🗺 Maps       │                                     │              │
 │ ⏳ Chronicles │                                     │              │
 │ 🖼 Gallery    │                                     │              │
 │ 💬 Ask        │                                     │              │
 │ ● Connected  │                                     │              │
 │ ✎ 3 unsaved  │                                     │              │
 │ 📥 Inbox 1 ⋯ │                                     │              │
 └──────────────┴─────────────────────────────────────┴──────────────┘
```

*   **Left side bar**: search, New entry, the tree, then the main places (Maps, Chronicles, Gallery,
    Ask), then a fixed footer: connection, unsaved count, inbox count, and the app menu "⋯" (Import,
    Export, History of the library, Settings, Status, Log out). Collapsed, it is a 48 px rail of the
    same icons with their badges, so nothing that the top bar showed disappears.
*   **Right side bar**: pages declare panels with `usePanel({ id, title, icon, render })`; the shell
    shows them as tabs. Its width and the open tab are kept per kind of screen (entry, editor, map,
    chronicle) in `localStorage`; this is a setting of the device and is never synced. In 11b the
    existing panels move in: Properties, Comments and Writing help on the editor; Layers and the
    selected feature on maps. Other panels come with their stages.
*   **Phone (below 768 px)**: a single slim line on top holds the menu button, the page title and the
    page's main action. The left bar opens as a drawer; the right bar opens as a bottom sheet at half
    height, draggable to full.
*   **Destructive actions** (Delete entry, Delete map, Discard) move into each page's "⋯" menu, each
    with its confirm. One main button per page.

### 6. The folder tree and the folder file (11c)

**The file.** `.frontier/folders.json`, an item file like the maps: `version: 1` and one line per
folder, saved and merged item by item (the code in `packages/schema/src/itemFile.ts` already does this
for maps and chronicles). It goes through drafts and "Save a version" like any file, so it is in the
history and the export.

```json
{ "version": 1, "folders": [
  { "path": "03 Gazetteer/Islands", "icon": "waves", "color": "sea", "order": "a0" },
  { "path": "03 Gazetteer/Old Coast", "order": "a1" }
] }
```

*   **Keyed by path.** Frontier is the only writer of its library (own-library.md), so a folder's path
    changes only through Frontier's own rename, which can rewrite the file. Lines for paths that no
    longer exist and are not empty folders are dropped when the file is read.
*   **`icon`** is a name from a curated set of about 60 lucide icons; **`color`** a name from a fixed
    palette of 8 that meets contrast in light and dark. Free colours would break the contrast work.
*   **`order`** is a fractional key among its siblings (`a0`, `a0V`, `a1` …), so moving one folder
    changes one line. Folders without an `order` follow the ordered ones, by name with numbers in
    order, as today. Entries keep name order.
*   **An empty folder** is any listed path with no files under it. The tree shows it. It becomes an
    ordinary folder when its first entry is saved. The export of the library writes no empty
    directories (Git cannot hold them), and the folder file travels with it.
*   **Route**: `GET /api/folders` and `PUT /api/folders` with revision and `baseBlob`, like a map. The
    drafts route keeps refusing `.frontier/` paths.

**Actions.**

| Action | How it is stored |
| --- | --- |
| New folder, nest | a line in the folder file |
| Rename, move (drag or "Move to…") | one rename intent (`POST /api/renames`, which already handles folders and folder notes). Before it is made, the author sees `previewRename`'s count: entries moved, links rewritten. Undo in the toast deletes the intent. Publishing rewrites the folder file's paths in the same version |
| Reorder | the `order` of one line |
| Icon, colour | one line |
| Delete | one confirm naming the counts ("2 folders, 14 entries, 3 images"); then delete drafts for every file and the removal of the lines, as one group that Undo in the toast discards. Refused, with the reason, when the folder holds append-only files under `99 Appendices` or a file with mixed line endings |

Moves and renames are refused while the connection service says `offline`, with "Needs a connection".

**The tree shows what is pending.** `/api/tree` today overlays new and deleted drafts but not
renames. It will also apply rename intents (through `movedPath`), so a moved folder shows in its new
place, marked unsaved, and adds the empty folders from the folder file.

**Controls.** Built on `react-arborist`: drag and drop with a drop line and a hover delay before a
closed folder opens; inline rename on F2 or double-click; arrow-key navigation with tree roles. Beside
each folder on hover or focus: "+" (new entry here) and "⋯" (the same items as the context menu). On
touch: long press or "⋯" opens the menu; "Move to…" with the folder combobox replaces dragging.

**New entry** opens a small dialog: a name, and the folder combobox set to the folder in view. It
offers "New folder '…'" when nothing matches.

### 7. Default type: in the folder file

Decided by the author on 2026-11-22: a folder's default type is a `type` on its line in
`.frontier/folders.json`. One file says everything about a folder.

*   **Today** the mapping lives in the `folders` lists of `.frontier/schema.yaml`, or of the built-in
    schema when that file is absent, and `typeFromFolder` (`packages/vault/src/fields.ts`) reads it.
*   **The move.** When `folders.json` does not exist yet, the server builds it in memory from the
    schema's folder lists, so nothing changes for the reader. The first time the author saves a folder
    change, that file is written with those types in it. From then on `folders.json` is the only
    source: `typeFromFolder` takes the folder file's types, and the schema's `folders` lists are
    ignored. Frontier does not rewrite `schema.yaml`; the status page notes "Folder types now come
    from folders.json; the folder lists in schema.yaml are no longer read" while those lists remain.
*   **Rule unchanged:** an entry's type comes from the longest matching folder path; a `type:` in the
    entry's own front matter wins.
*   **New entries** made in a folder with a type get `type:` written into their front matter (through
    `setFrontmatterKey`), so the type travels to Obsidian. The folder menu offers "Set type on the N
    entries here without one", which makes ordinary drafts.
*   **Renames** rewrite the folder file's paths in the same version, so types follow their folders.
*   **Older builds** reading a library that has `folders.json` fall back to the schema's lists. That
    is acceptable: Frontier is deployed as one server, and a rollback is the only way to meet it.

### 8. The review fixes in 11a

| Finding | Change |
| --- | --- |
| Phone map header (MO-1) | title, Done and "⋯" on one line; Undo and Redo in the tool bar, which moves to the bottom on a phone |
| Map hover and selection (MP-1, MP-2) | the existing hit test (`shapeAt`) runs on pointer move: pointer cursor, a halo on the hovered feature, its name in a tooltip; the selected feature gets a two-tone outline |
| New entry and folder (TR-1) | the dialog in section 6, without the folder file at first |
| Contrast (VH-3) | the text tokens in section 4 |
| Editor reads like the page (ED-1, ED-2) | live preview uses the reading font; the front matter is folded to one line ("Properties: 2 aliases") that opens the Properties panel |
| Destructive buttons (VH-2) | the "⋯" menus in section 5 |
| Keys (DI-2, IC-1) | the keys registry; tooltips |
| Saving and connection (ED-5, FB-1 to FB-3) | sections 1 and 3, with one save-status component |

### 9. Documents

`docs/designs/frontier.md` records, dated, that the non-goals "Full offline use" and "The graph view
… is not rebuilt" are reversed by the author on 2026-11-22, pointing to this design and the brief. Its
note that the browser buffer uses IndexedDB becomes true. `SITEMAP.md` lists this design; `BACKLOG.md`
moves the 2026-11-22 ideas into stages 11 to 15.

--------------------------------------------------------------------------------

*Drafted with EGM*
