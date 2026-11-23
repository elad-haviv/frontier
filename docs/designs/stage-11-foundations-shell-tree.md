# Stage 11: foundations, the shell and the folder tree

*   **Author:** Elad Haviv
*   **Status:** Approved after a five-stage Goldfish review (2026-11-22)
*   **Date:** 2026-11-22
*   **Parent:** [Frontier](frontier.md), [Frontier's own library](own-library.md).
    Comes from [`concepts_brief.md`](../../concepts_brief.md) (stages 11 to 15). Review:
    [`consolidated_review_report.md`](../../consolidated_review_report.md) and
    [`goldfish_review_report.md`](../../goldfish_review_report.md).

--------------------------------------------------------------------------------

## Overview

Frontier is a web app, used by one author, for writing and exploring the fantasy world Avalymia. The
world is kept as a library of Markdown notes ("entries"), images and Frontier's own files (maps,
chronicles, settings). The library is a Git repository on Frontier's server, and Frontier is the only
program that writes to it ([own-library.md](own-library.md)). The author reads it in Obsidian through an
exported copy.

Stage 11 is the first of five stages that rework Frontier's interface and let it work on a bad or
missing connection. It ships in four releases, in order:

*   **11a-1, fixes and shared pieces.** The quick fixes from the UX review
    ([`ux-review/expert-review.md`](../../ux-review/expert-review.md)), together with the building blocks
    every later screen uses: icons, styled tooltips, menus, a combobox, and one keys registry. Nothing in
    it changes how changes are saved.
*   **11a-2, saving and connection.** One save queue on the device, saves that say what they started
    from, one kept copy per device on the server, and one connection signal.
*   **11b, the shell.** The top bar goes. A collapsible left side bar holds navigation, with an app
    menu at the bottom. A right side bar with tabs, whose width can be changed, holds each screen's
    panels. On a phone they become a drawer and a bottom sheet.
*   **11c, the folder tree.** Folders can be added, nested, moved, reordered, renamed, styled and
    deleted, by drag and drop, by buttons beside the name, or by a context menu.

Stages 12 (entries and editor), 13 (maps), 14 (graph) and 15 (offline) each get their own design and
build on what this stage provides.

## Terms

*   **Draft.** A change held on the server that is not yet in the library's history. Each draft has an
    id, a **revision** (a number that rises with every save of it) and the **base**: the hash ("blob") of
    the library file it was started from.
*   **Unpublished.** Held as a draft on the server. "Save a version" records every chosen draft in the
    library's history as one Git commit. ("Publish" is the same step in GitHub mode.)
*   **Unsent.** Held only on this device, in the save queue, because the server has not confirmed it yet.
*   **Kept copy.** When a save arrives from a device that started from older text, the server does not
    overwrite anything: it keeps that device's text beside the draft as a kept copy, for the author to
    compare and merge. The word "version" is kept for "Save a version".
*   **Rename intent.** A rename or move stored on the server and applied, with the links that point to
    it, when the next version is saved. It can be cancelled until then.
*   **Folder note.** A note named after its folder (for example `Islands/Islands.md`); the tree opens it
    from the folder's name.
*   **Item file.** A file Frontier stores as one item per line and merges item by item: maps,
    chronicles and, from 11c, the folder file.

## The Problem

*   **Navigation is a row of eleven links** across the top, repeated at the foot of the folder list. The
    folder list cannot be edited at all: folders exist only because notes sit in them, and "New entry"
    asks for a name in a plain prompt and cannot choose its folder.
*   **Controls have no names.** The editor toolbar is a row of symbols (`▣`, `✎`, `[[ ]]`) with no
    tooltips. There are no context menus anywhere. Ctrl+B, Ctrl+I and Ctrl+S do nothing. Tab does not
    indent. Four document-level key listeners and several element-level ones each handle their own keys.
*   **Some screens break on a phone.** On an iPhone the map editor's Done, Undo and Delete are off the
    screen, so the author can enter edit mode and not find the way out.
*   **Some things are hard to read or easy to hit by mistake.** Secondary text is 3.25:1 against the
    page, below the 4.5:1 minimum. Delete and Discard sit next to Done; "Delete map" sits next to Undo.
    The editor body is monospace even in its preview, and the front matter shows twice.
*   **A bad connection looks like a broken app.** Pages go blank on failure. Search shows nothing when
    the server cannot be reached. Each page has its own retry timer and its own words for "not saved".
*   **Saving can lose work, today.** Four save paths exist (entry text, maps, chronicles, and the
    server's single spare slot for a clashing save), and they fail in different ways:
    *   a save does not say which library file it started from, so an old save can quietly replace text
        that was saved as a version from another device;
    *   the editor clears the text it kept in the browser when it learns of a newer draft, and ignores
        it without a word when that draft was saved as a version elsewhere;
    *   a third device's clashing save replaces the second's in the spare slot;
    *   after a reload, the map and chronicle merge keeps "mine" on every clash, because its base copy
        lived only in memory.

    Each case needs two devices editing the same file. Offline work (stage 15) would make that common,
    and every later stage would add save paths of its own unless one shared path exists first.

The solution: ship the quick fixes at once; build the shared pieces and one save path before the
screens that need them; then rebuild the shell and the tree on top.

## Goals

*   **G1. The review's top ten are closed or scheduled**, as listed in Technical Plan section 8: seven
    are closed in this stage, and three are moved, each to a named stage.
*   **G2. Every icon-only control has a name.** A styled tooltip shows its name and shortcut on hover and
    on keyboard focus, and its accessible name is the same text. A disabled control says why.
*   **G3. One keys registry**, with scopes (app, editor, table, map, dialog), holds every shortcut
    Frontier binds itself. The "?" key opens a sheet generated from it, which also lists the keys that
    the menus, the combobox and the tree handle themselves. Ctrl+K stays the switcher; Ctrl+B, Ctrl+I,
    Ctrl+S, Ctrl+Enter (Done) and Tab work in the editor; Esc then Tab leaves the editor.
*   **G4. One save queue** in the browser's IndexedDB carries every save of entry text (including
    deletes), maps, chronicles and the folder file. Each record says what it started from and carries its
    own id. It stays on the device until the server confirms it, survives a reload, and is never cleared
    or skipped without being shown. Comments, renames, folder deletes and "apply type" stay direct calls
    to the server, refused while offline; stage 15 decides whether they join the queue.
*   **G5. The server never builds a draft on text that has moved on.** An entry save that started from
    older text is stored as a kept copy and reported. One kept copy per device is held, not one in all.
    Maps, chronicles and the folder file are merged item by item in the browser instead.
*   **G6. One connection signal**: online, offline or signed out, shown in one place with a Retry. Pages
    keep their content while reloading, with a thin progress line, and a failure shows its reason.
*   **G7. The shell.** No top bar. A left side bar that collapses to an icon rail that still shows
    search, the unpublished, inbox and attention counts, and the connection state. A right side bar with
    tabs and a width the author sets. On a phone, a drawer and a bottom sheet.
*   **G8. Folders are editable**: add (an empty folder lasts), nest, move, reorder, rename, delete, give
    an icon and a colour, and set the default type (the `type` given to entries in that folder,
    section 7). By drag and drop, by buttons beside the name, and by a context menu; on touch, by a long
    press or the "⋯" button.
*   **G9. Folder style, order and type are versioned.** They live in one library file under
    `.frontier/`, go through drafts and "Save a version", appear in history, and travel in the export.
*   **G10. No regressions.** Every existing unit and browser test passes, changed only where a selector
    or a word on screen changed.

## Non-Goals

*   **Offline reading and editing.** Stage 15. This stage builds the queue offline work needs, keeps
    today's behaviour of holding unsent text, and adds no offline copy of the library.
*   **Entry, editor and map features** from the author's list (sticky headings, the new toolbar, the image
    dialog, map styles, curves, map hover). Stages 12 and 13.
*   **Folder order in Obsidian.** The custom order is seen only in Frontier. Obsidian keeps sorting by
    name after an export.
*   **A folder note for every folder.** A folder note is made only when the author asks for one.
*   **Moving or renaming while offline.** These need the server to work out which links change.
*   **Panels that stack freely or float**, as in Obsidian. The right side bar has a fixed set of tabs per
    screen.
*   **Several people, or real-time co-editing.** One author, on more than one device.

## Decisions

| Decision | Date | Source |
| --- | --- | --- |
| Folder icon, colour and order are versioned in the library | 2026-11-22 | [brief, "Answered by the author"](../../concepts_brief.md) |
| No folder note by default; empty folders are lines in the folder file | 2026-11-22 | same |
| Moves, renames, URL import, AI, history need a connection | 2026-11-22 | same |
| A folder's default type lives in the folder file, not `schema.yaml` | 2026-11-22 | author's answer during drafting; brief updated |
| 11a ships as fixes first, foundations second; map hover and selection move to stage 13 | 2026-11-22 | author's answer to the review (item 14 of [goldfish_review_report.md](../../goldfish_review_report.md)) |

## Critical User Journeys (CUJs)

### CUJ 1: Make a folder and fill it

*   **Covers:** G8, G9.
*   **Given**: the author is reading an entry in `03 Gazetteer`.
*   **When**: he right-clicks `03 Gazetteer` (or presses "⋯" beside it), chooses "New folder", types
    "Islands", gives it the waves icon and the sea colour, and sets its default type to `place`. Then he
    chooses "New entry" while viewing the new folder.
*   **Then**: the empty folder appears at once and is still there after a reload, marked unpublished.
    The new-entry dialog offers "Islands" as the folder; the entry is made there with `type: place` in
    its front matter. After "Save a version" the folder, its icon, colour and type are in the history.

### CUJ 2: Reorganise by dragging, and take it back

*   **Covers:** G8.
*   **Given**: a folder `Old Coast` with 14 entries that 6 other entries link to.
*   **When**: he drags it into `Islands`.
*   **Then**: the tree shows the folder in its new place, marked unpublished, and a toast says "Moved 14
    entries; links in 6 other entries will be updated when you save a version", with Undo. Undo, or
    Discard in the list of unpublished changes at any time before saving, puts everything back. Otherwise
    the move is saved with the next version, links rewritten.

### CUJ 3: Two devices, one entry

*   **Covers:** G4, G5.
*   **Given**: the author edits entry `Harbor` on his phone on a train; the connection drops while the
    change is unsent. Meanwhile, at home, the laptop edits `Harbor` and he saves a version.
*   **When**: the phone gets a connection again.
*   **Then**: the phone's change reaches the server, which sees it started from the older text. The
    server keeps it as the phone's kept copy beside a draft of the current text, instead of building on
    it. The phone shows "Harbor: two texts to compare". The laptop's attention count rises within seconds.
    Opening the item shows both texts on the compare screen. Nothing either device typed is lost.

### CUJ 4: Find any control without knowing the app

*   **Covers:** G2, G3.
*   **Given**: the editor is open.
*   **When**: he hovers or tabs onto the toolbar's image button; then presses "?".
*   **Then**: a tooltip reads "Add an image" with its shortcut. "?" opens a sheet listing every shortcut
    for the current screen and for the whole app.

### CUJ 5: Map on a phone

*   **Covers:** G1 (MO-1).
*   **Given**: the iPhone, 390 px wide, a map open.
*   **When**: he taps Edit, adds a marker, and wants to finish.
*   **Then**: Done, Undo and a "⋯" menu (holding Delete map) are on screen; the tools sit in a bar at the
    bottom.

### CUJ 6: A bad connection

*   **Covers:** G4, G6.
*   **Given**: the server is unreachable for twenty seconds.
*   **When**: he opens another entry, then types in the current one.
*   **Then**: the connection mark turns to "Not connected" with a Retry; the open page stays as it was; the
    new page shows "Can't reach Frontier" with Retry instead of a blank page; the typed text shows as
    "Unsent: kept on this device" and is sent when the server returns, without his doing anything.

### CUJ 7: Delete a folder

*   **Covers:** G8.
*   **Given**: a folder with 2 subfolders and 14 entries, one of which has an unpublished edit.
*   **When**: he chooses Delete from the folder's menu.
*   **Then**: Frontier refuses: "1 entry here has unpublished changes. Save a version or discard them
    first." After he discards that edit, Delete asks "Delete 2 folders and 14 entries?" and marks them
    for deletion; Discard in the unpublished list takes it back until a version is saved.

## Technical Plan (Architecture)

### Shape of the change

```text
 Browser                                                     Server
 ------------------------------------------------------      -----------------------------
 Pages (Entry, Edit, Map, Chronicle, Tree, ...)
   |  register panels ------> Shell (left bar | main | right bar)
   |  register shortcuts ---> Keys registry ---> "?" sheet, tooltip hints
   |  read  ------------------------------------------------> GET /api/...   (as today)
   |  write --> Save queue (IndexedDB, one sender per browser)
   |              one record per file: base, op, kind, link --> PUT /api/drafts       base check
   |              merges maps/chronicles itself            --> PUT /api/maps/:id     base check
   |              survives reload                          --> PUT /api/chronicles/  base check
   |                                                        --> PUT /api/folders      (11c)
   |              <-- stale entry: kept copy stored            versions/<device>      one per device
   +- Connection service <-- EventSource /api/status/events <-- status stream + heartbeat
                         <-- request failures; one probe of /api/status when the stream fails
```

The shared pieces (sections 1 to 4) come first; 11b, 11c and stages 12 to 15 use them.

### 1. The save queue (11a-2)

Today each page saves on its own: `Edit.tsx` with a `localStorage` buffer and a retry timer,
`MapPage.tsx` with its own timer and merge, `useItemFile` (chronicles) with a base copy held in
memory, and `Maps.tsx` and `History.tsx` with direct calls. They are replaced by one queue.

**A record.** One record per file. A later change to the same file replaces the record's value and
gets a new `op`, but keeps its base:

| Field | Meaning |
| --- | --- |
| `key` | `entry:<path>`, `map:<id>`, `chronicle:<id>` or `folders` |
| `kind` | entries only: `edit`, `create` or `delete` |
| `draftId`, `revision` | the draft this device last knew of, and its revision (0 for none) |
| `baseBlob` | the hash of the library file this device started from (`""` for a new file) |
| `base` | item files only: the value the server last confirmed, for a three-way merge |
| `value` | the text or file to send |
| `link` | maps and chronicles only: features or spans to link to entries by path; two changes in a row are combined by feature or span id |
| `op` | an id made on the device for this send; a retry sends the same `op` |
| `state`, `error`, `tries`, `nextTry` | for sending and backing off, per record |

**Storage.** IndexedDB, one database with a `queue` store and a `meta` store. `meta` holds this
device's id and name, made once. Today's `localStorage` buffer keys are moved into the queue on first
start and deleted. Every `put` is written at once. If IndexedDB cannot be opened, the queue runs in
memory, the device id is kept in `localStorage`, and the unsent mark says "Changes are not kept on this
device".

**Sending.** One sender per browser, however many tabs are open: a tab sends only while it holds a Web
Lock named `frontier-sender`, and the others take over when it closes. Records for different files are
independent: each has its own back-off, and a record that is waiting or needs attention does not hold
up the others. The sender pauses entirely only while the connection service says offline or signed out.

| Answer | What happens |
| --- | --- |
| saved | the record is removed if its value did not change meanwhile; otherwise it is sent again with the new revision |
| no connection | the record stays; it is sent when the connection returns |
| 401 | sending pauses; the login dialog opens over the page; after login, sending resumes. Nothing is cleared |
| `stale_revision` on an entry | the server has stored the kept copy, so the record is removed. The attention count rises, and the item opens `/versions/:id` |
| `stale_revision` on a map or chronicle | the sender loads the server's copy, merges with `mergeMaps` or `mergeChronicles` using the stored `base`, updates `base`, `baseBlob` and `revision`, and sends the result. No page needs to be open. A clashing item keeps this device's side; the notice names the items that clashed |
| `stale_revision` on the folder file | the same, with the folder merge |
| any other 4xx | the record stays and is marked "needs attention", with the server's message; it is not retried until the author chooses Retry or Discard in the unsent list |

Pages do not call the save functions themselves. They call `queue.put(key, value, meta)` and subscribe
to their key. A subscription gives the page the record's state (for the one save-status component) and,
after a save, the value the server returned and any links it could not make, so an open map or
chronicle takes them in as it does today.

**The unsent list.** The unsent count opens a small list of records still on the device: each with its
file, age and any error, and Retry and Discard for those that need attention.

### 2. Saves that say what they started from (11a-2)

Entry loads, map loads and chronicle loads return the library file's `blob`. Every save from the queue
sends `baseBlob` and `op`, and a device header (section 1, "Device").

**The server's rules for an entry save** (`DraftStore.save`). The `op` check comes first: a save whose
`op` equals the draft's last accepted `op` returns the stored record and writes nothing. Then:

| Draft on the server | Sent revision | `baseBlob` | Result |
| --- | --- | --- | --- |
| none | 0 | equals the library file's hash, or missing | a new draft, based on the current library file (today's behaviour) |
| none | 0 | differs (the device began editing, perhaps offline, before another device saved a version) | as the "differs" row below: a draft of the library text, this text kept as the device's copy, `stale_revision` |
| none | above 0 | equals the library file's hash | a new draft from this text (the old draft was discarded elsewhere) |
| none | above 0 | differs, or the file was deleted or moved | a draft holding the current library text, with this text as the device's kept copy; answer `stale_revision` |
| none | above 0 | missing (an older build) | `invalid`, as today |
| yes, same id | equal | any | saved; revision rises |
| yes | older, or another id | any | stored as the device's kept copy; answer `stale_revision` |

A draft whose only difference from the library is its kept copies is not cleared when versions are
saved, so the kept copies stay until merged.

**Maps and chronicles** follow the same first three rows, but answer `stale_revision` without storing a
kept copy: the browser merges (section 1). They also record the last `op`.

**Kept copies.** The single `content.v2` slot becomes a folder `versions/` in the draft's folder, one
text and one small record per device. A second stale save from the same device replaces only that
device's copy. The compare screen lists them all with the device's name and time; merging clears them
all. An old `content.v2` is read as a copy from an earlier device.

**Device.** Each browser has a random id, made once, and a name made from its user agent ("Safari on
iPhone"). The server accepts an id only in Frontier's id format and refuses anything else; a save with
no id (an older build) is kept under `unknown`. The name is sent URI-encoded and cut to 40 characters.

**Attention.** The status snapshot, which the server streams to every open page, gains the number of
drafts with kept copies, and the server sends a new snapshot when a kept copy is stored. `GET
/api/attention` adds the list. So in CUJ 3 the laptop's count rises without a reload.

### 3. The connection service (11a-2)

One state for the app: `online`, `offline` or `signed-out`.

*   It listens to the server's status stream, which also replaces the shell's one-time status fetch. The
    server adds a heartbeat every 20 seconds, so a dead connection is noticed and proxies do not cut an
    idle stream.
*   When the stream fails or a request cannot reach the server, it fetches `/api/status` once: a 401
    means `signed-out`, a network failure means `offline`, and any other answer means `online`. Any
    later answer from the server means online again.
*   `navigator.onLine` is used only as a hint to retry at once.

Pages read it through one hook. Loading uses one pattern: the old content stays with a thin progress
line; a failure keeps any content already shown and adds the reason with Retry; a page with nothing to
show yet shows the reason with Retry. The switcher shows "Can't reach Frontier" instead of an empty list.

### 4. Shared interface pieces (11a-1)

New packages for parts the app does not have:

| Need | Package | Used for |
| --- | --- | --- |
| icons | `lucide-react` | every icon, through one `Icon` wrapper |
| tooltip, context menu, dropdown menu, popover | Radix UI primitives | `Tip`, `ContextMenu`, `Menu`, popovers; each handles keyboard, focus and screen-reader roles |
| combobox | `cmdk` inside a Radix popover | one `Combobox`: choose a folder, an entry, a map |
| resizable side bars | `react-resizable-panels` | the shell (11b) |
| tree | `react-arborist` | the folder tree (11c): drag and drop, inline rename, keyboard; subject to the spike in Risks |

`Dialogs.tsx` stays the one dialog component. `IconButton` requires a label, shows it as a tooltip with
the shortcut from the registry, and uses it as the accessible name. A disabled control's tooltip says
why it is disabled.

**Keys registry.** Every shortcut Frontier binds is declared once: id, keys, scope, label, action. One
document listener runs the action for the innermost active scope; a typing field takes only app keys
with a modifier. The four document-level listeners (Shell, MapPage, ChroniclePage, Lightbox) move into
it. The element-level handlers that belong to one control (Dialogs, Switcher, MapTurn, Properties) stay
where they are, and their keys are listed in the registry as labels only, with the keys the menus,
combobox and tree handle themselves, so the "?" sheet is complete. CodeMirror's editor keymap is built
from the registry at high precedence, so Ctrl+I is italic rather than CodeMirror's default. Tab moves
between table cells inside a table and indents elsewhere; Esc then Tab leaves the editor (CodeMirror
does this already).

**Styles.** New components get their own CSS files beside them. `styles.css` gains tokens for layers
(base, sticky, side bars, popover, menu, tooltip, dialog, toast), spacing and icon size. The faint text
colour is darkened to at least 4.5:1 against the page in light and dark (values in the implementation
plan).

### 5. The shell (11b)

```text
 +----------------+---------------------------------+----------------+
 | FRONTIER    << |                                 | Outline | ...  |
 | [S] Search ^K  |                                 |----------------|
 | [+] New entry  |              page               |  panel of the  |
 | -- Library --- |                                 |  open tab      |
 |  > 01 Places   |                                 |                |
 |  > 02 People   |                                 |                |
 | -------------- |                                 |                |
 | [M] Maps       |                                 |                |
 | [C] Chronicles |                                 |                |
 | [G] Gallery    |                                 |                |
 | [A] Ask        |                                 |                |
 | (o) Connected  |                                 |                |
 | 3 unpublished  |                                 |                |
 | Inbox 1    ... |                                 |                |
 +----------------+---------------------------------+----------------+
   [x] stands for a lucide icon; ^K is Ctrl+K (Cmd+K on a Mac).
```

*   **Left side bar**: search, New entry, the tree, the main places (Maps, Chronicles, Gallery, Ask), then
    a fixed footer: connection, unsent and unpublished counts, inbox and attention counts, and the app
    menu "⋯" (Import, Export, History of the library, Settings, Status, Log out). Every top-bar link is in
    the side bar or the app menu. Collapsed, it is a 48 px rail of the same icons with their badges.
*   **Right side bar**: pages declare panels with `usePanel({ id, title, icon, render })`; the shell
    shows them as tabs. Width and open tab are kept per kind of screen in `localStorage`, as a setting
    of the device. In 11b the existing panels move in: Properties, Comments and Writing help on the
    editor; Layers and the selected feature on maps.
*   **Phone (below 768 px)**: one slim line on top holds the menu button, the page title and the page's
    main action. The left bar opens as a drawer; the right bar opens as a bottom sheet.
*   **Until 11b**, the connection mark, the unsent and attention counts and the login dialog sit in the
    current top bar (11a-2).

### 6. The folder tree and the folder file (11c)

**The file.** `.frontier/folders.json`, an item file: `version: 1` and one line per folder, merged item
by item with the same code as maps and chronicles (keyed by path through a small adapter, since that
code keys by `id`). It goes through drafts and "Save a version", so it is in the history and the export.

```json
{ "version": 1, "folders": [
  { "path": "03 Gazetteer/Islands", "icon": "waves", "color": "sea", "order": "a0", "type": "place" },
  { "path": "03 Gazetteer/Old Coast", "order": "a1" }
] }
```

*   **Keyed by path.** In an own library, Frontier's renames rewrite the file (below). A line whose
    folder was removed some other way (a vault import, or an outside change in GitHub or sample mode)
    is never dropped silently: it shows as an empty folder, which the author can delete.
*   **`icon`** is one of a fixed set of lucide icon names; **`color`** one of 8 named colours that meet
    4.5:1 in light and dark (both lists in the implementation plan).
*   **`order`** is a fractional key among its siblings, so moving one folder changes one line. Folders
    without an `order` follow the ordered ones, by name with numbers in order, as today. Entries keep
    name order.
*   **`type`** is the folder's default type (section 7).
*   **An empty folder** is a listed path with no files under it. The tree shows it. It becomes an
    ordinary folder when its first entry is saved. The export writes no empty directories (Git cannot
    hold them); the folder file travels with it.
*   **Route**: `GET /api/folders` and `PUT /api/folders`, saved through the queue like a map. The server
    checks every field against the allowed values and caps the file at 5,000 lines.

**Actions.**

| Action | How it is stored |
| --- | --- |
| New folder, nest | a line in the folder file |
| Reorder | the `order` of one line |
| Icon, colour, type | one line |
| Rename or move a folder with files | one rename intent (`POST /api/renames`, which already handles folders and folder notes), made when the folder is dropped or the new name is entered. Its answer lists the other entries whose links change; the toast shows that count and the entries moved, with Undo, which deletes the intent. Dragging to a new position also changes the line's `order`, and Undo restores that too. Saving a version rewrites the folder file's paths in the same commit, writing the file first if it existed only in memory |
| Rename or move an empty folder | its line only |
| Delete | refused, with the reason, while any file under the folder has an unpublished draft, is an image, is append-only (under `99 Appendices`) or mixes line endings. Otherwise one confirm with the counts, then a delete draft (a draft that removes its file when a version is saved) for each entry and the removal of the lines, in one server call. Discard in the unpublished list takes it back |

Moves, renames and deletes are direct calls, refused while offline ("Needs a connection") and while the
queue holds unsent records under the folder ("Wait until your changes are sent"). While a folder has a
rename intent, its settings and "New subfolder" are disabled with "Save a version first".

**The tree shows what is pending.** `/api/tree` already shows new and deleted drafts. It will also show
rename intents (a moved folder appears in its new place, marked unpublished) and the folder file's
empty folders, icons, colours, order and type. A moved entry's link still opens its old path until the
version is saved, so it never leads to a missing page.

**Controls.** Drag and drop with a drop line and a short hover delay before a closed folder opens;
inline rename on F2 or double-click; arrow keys with tree roles. Beside each folder on hover or focus:
"+" (new entry here) and "⋯" (the context menu's items). On touch: long press or "⋯" opens the menu,
and "Move to…" with the folder combobox replaces dragging.

**New entry** (11a-1) opens a small dialog: a name, and the folder combobox set to the folder in view.
From 11c it also offers "New folder '…'" when nothing matches.

### 7. Default type: in the folder file (11c)

*   **Today** the mapping lives in the `folders` lists of `.frontier/schema.yaml` (or the built-in
    schema), read by `typeFromFolder`.
*   **One place for the switch.** When the server reads the schema, it lays the folder file's types over
    the schema's `folders` lists: the folder file's draft if there is one, otherwise its library copy.
    Every caller of `typeFromFolder` then sees the result without change. While no folder file exists,
    the schema's lists are used as they are, so nothing changes until the author first edits a folder.
*   **The first folder change** writes `folders.json` with the schema's folder types copied in. From then
    on the schema's `folders` lists are not read; the status page says so while they remain. Frontier
    does not rewrite `schema.yaml`.
*   **Rule unchanged:** an entry's type comes from the longest matching folder path; a `type:` in the
    entry's own front matter wins.
*   **New entries** made in a folder with a type get `type:` written into their front matter by the
    browser when the text is first made, so the type travels to Obsidian. The folder menu offers "Set
    type on the N entries here without one", which makes ordinary drafts.

### 8. The review's top ten

| # | Review items | Where |
| --- | --- | --- |
| 1 | Phone map header (MO-1) | 11a-1: title, Done and "⋯" on one line; Undo, Redo and tools in a bar at the bottom on a phone |
| 2 | Map hover and selection (MP-1, MP-2) | **Stage 13**, after the map page is split. The docked panel part arrives in 11b |
| 3 | New entry chooses its folder; tree context menu (TR-1, DI-1) | TR-1 in 11a-1; DI-1 in 11c |
| 4 | Navigation (IA-1, IA-2, MO-2) | 11b |
| 5 | Editor reads like the page (ED-1, ED-2, ED-3) | ED-1 (reading font) and ED-2 (front matter folded to one line that opens Properties) in 11a-1; ED-3 (Live preview / Source switch) in **stage 12** |
| 6 | Icons, tooltips, shortcuts (IC-1, DI-2) | 11a-1, except map tool keys: **stage 13** |
| 7 | Destructive actions out of main rows (VH-2) | 11a-1: Delete and Discard in the editor's "⋯", Delete map in the map's "⋯" |
| 8 | Contrast and disabled states (VH-3, AX-2) | 11a-1 |
| 9 | Reading aids for long entries (RD-1, RD-2) | **Stage 12** |
| 10 | Saving and connection feedback (ED-5, FB-1 to FB-3) | 11a-2 |

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A browser clears IndexedDB (Safari after about 7 days without use, unless installed to the home screen) and unsent changes go with it | The same exposure as today's `localStorage` buffer. Stage 15 asks the browser to keep storage and covers installing. Unsent changes are shown, so the author knows they exist |
| Kept copies pile up | One per device, cleared by a merge. A browser without IndexedDB keeps its id in `localStorage`, so reloads do not make new devices |
| A login runs out while changes are unsent | Sending pauses, nothing is cleared, and the login dialog opens over the page; sending resumes after login |
| A merge of maps or chronicles keeps this device's side on a clash and loses the other's change to that item | Only items both devices changed can clash, because `base` now survives reloads. The notice names them. Stage 15 keeps the other side as a kept copy |
| `react-arborist` does not fit: it needs fixed row heights, its drag uses `react-dnd`, which has no touch support, and its React 19 support is unproven | A one-day spike at the start of 11c. If it fails: a plain recursive tree with the Radix context menu, keyboard roles and "Move to…", without drag and drop |
| The bundle grows | First-load JavaScript is measured before 11a-1 and after each release; the map and chronicle pages load as separate chunks; the limit is today's size plus 80 KB gzipped |
| Rolling back to an older build | An older build does not read `versions/` (so it would let a draft with unmerged kept copies be saved as a version), the queue, empty folders or the folder file's types. Before a rollback, the author merges all kept copies and lets the unsent list empty |

## Alternatives Considered

### Alternative A: Build the interface first, offline last, on today's saving

*   **Pros**: Visible changes arrive sooner; stage 11 is smaller.
*   **Cons**: Every page from stages 11 to 14 would save on its own and need reworking in stage 15; the
    paths that lose work today stay in place until then.
*   **Reason for Rejection**: Building one save path once, first, avoids reworking every page and fixes
    losses that happen today. Agreed in the [brief](../../concepts_brief.md).

### Alternative B: Keep the `localStorage` buffer and extend it

*   **Pros**: No new dependency; the buffer already works for one entry.
*   **Cons**: About 5 MB; fails without telling anyone; holds only the latest text and a revision, not
    the base; cannot hold maps, chronicles or the folder file.
*   **Reason for Rejection**: IndexedDB holds structured records with their base, and the master
    design ([frontier.md](frontier.md)) already chose it.

### Alternative C: Resolve every stale save on the server with a three-way merge

*   **Pros**: Fewer "two texts to compare" notices.
*   **Cons**: Needs the base text on the server for every save; a wrong automatic merge of prose is worse
    than a shown conflict.
*   **Reason for Rejection**: Deferred to stage 15, where the device keeps base copies. Kept copies lose
    nothing meanwhile.

### Alternative D: One `content.v2` slot, as today

*   **Pros**: No change to the draft folder layout.
*   **Cons**: A third device's stale save overwrites the second's text.
*   **Reason for Rejection**: One kept copy per device removes that loss for the cost of a folder.

### Alternative E: Hand-made tooltips, menus, combobox, tree and splitters

*   **Pros**: No new packages; full control of markup.
*   **Cons**: Keyboard handling, focus return, screen-reader roles, placement at the screen edge and
    touch would each be written and tested by hand; the UX review found the existing hand-made parts
    missing exactly these.
*   **Reason for Rejection**: The packages each do one job, come unstyled, and bring that behaviour
    tested. The tree has a fallback (Risks).

### Alternative F: Reorder folders by renaming their number prefixes

*   **Pros**: Obsidian would show the same order.
*   **Cons**: Every reorder renames every file in the folder and rewrites the links to them; folder names
    change.
*   **Reason for Rejection**: Too costly for a visual preference; the author accepted that the order is
    seen in Frontier only.

### Alternative G: Folder style and order as Frontier's own settings, outside the library

*   **Pros**: Instant; never an unpublished change.
*   **Cons**: Not in history, not in the export, lost if the server's state folder is lost.
*   **Reason for Rejection**: The author wants them kept with the library ([brief](../../concepts_brief.md)).

### Alternative H: A folder note for every new folder

*   **Pros**: An empty folder would be a real file, so Obsidian would show it.
*   **Cons**: Files the author did not write appear in every folder.
*   **Reason for Rejection**: A line in the folder file keeps the folder without adding files
    ([brief](../../concepts_brief.md)).

### Alternative I: Default type in `schema.yaml`

*   **Pros**: The schema already holds the folder lists.
*   **Cons**: Folder actions would write two files, and Frontier would rewrite a file the author has
    edited by hand.
*   **Reason for Rejection**: One file for everything about a folder (author's decision, Decisions table).

### Alternative J: A second folder-to-type mapping beside the schema's

*   **Pros**: Nothing existing changes.
*   **Cons**: Two answers to "what type does this folder give", which can disagree.
*   **Reason for Rejection**: The folder file replaces the schema's lists rather than sitting beside them.

### Alternative K: Panels that stack and float freely, as in Obsidian

*   **Pros**: Any arrangement of panels.
*   **Cons**: Saved layouts, dragging between stacks, panels that must work at any size: a layout manager
    is its own project.
*   **Reason for Rejection**: Tabs in one resizable side bar give the panels room at a fraction of the cost.

### Alternative L: A status bar naming the tool under the pointer

*   **Pros**: Names appear without waiting for a tooltip.
*   **Cons**: Repeats the tooltip, takes a line of screen, does nothing on touch or keyboard.
*   **Reason for Rejection**: Tooltips show the name and shortcut, on hover and on keyboard focus.

### Alternative M: Folder ids instead of paths in the folder file

*   **Pros**: Survives renames made outside Frontier.
*   **Cons**: Every folder needs a stored id, while the schema, renames and the tree all work in paths.
*   **Reason for Rejection**: In an own library only Frontier renames folders, and its renames rewrite
    the file; a line left behind by an outside change shows as an empty folder rather than vanishing.

### Alternative N: Key the queue by draft id instead of path

*   **Pros**: A rename would not move the record.
*   **Cons**: A new entry has no draft until its first save, and pages look files up by path.
*   **Reason for Rejection**: Moves are refused while records are unsent under the folder, which removes
    the case at no cost.

### Alternative O: Poll the server instead of listening to its stream

*   **Pros**: Simpler on proxies; no open connection.
*   **Cons**: Counts and attention arrive late or cost frequent requests.
*   **Reason for Rejection**: The stream already exists; a heartbeat and one probe on failure cover its
    weak points.

## Non-Functional Requirements

*   **Security.** No new route reaches outside the server. The device id is checked against Frontier's
    id format before it is used in a file name. `PUT /api/folders` checks paths with the existing rules,
    refuses `.frontier/`, `.git` and `.obsidian` paths, and checks every field against its allowed values.
    Logout warns when changes are unsent, and then clears the queue and the device's id, as the brief
    asks, so a borrowed device keeps nothing.
*   **Performance.** See Risks (bundle size). The tree renders about 430 entries without virtual rows.
*   **Rollout and rollback.** Every protocol change is optional: without `baseBlob` or the device header
    the server behaves as today. See Risks for what an older build cannot see.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Four releases, in order. Each must pass the Verification Plan before it is merged and deployed.

### Release 11a-1: fixes and shared pieces

1.  `apps/web/package.json` (Modify): add `lucide-react@^1.7`, `@radix-ui/react-tooltip@^1.2`,
    `@radix-ui/react-context-menu@^2.2`, `@radix-ui/react-dropdown-menu@^2.1`,
    `@radix-ui/react-popover@^1.1`, `cmdk@^1.1`. React 19 is within each one's peer range.
2.  `apps/web/src/components/ui/` (Create), each with a CSS file beside it:
    *   `Icon.tsx`: one wrapper for lucide icons (size, stroke, `aria-hidden`).
    *   `IconButton.tsx`: a required `label`; shows `Tip` with the label and the registry's shortcut;
        `disabledReason` shown in the tooltip when disabled.
    *   `Tip.tsx`, `Menu.tsx`, `ContextMenu.tsx`, `Combobox.tsx`: thin wrappers over Radix and `cmdk`.
    *   `Progress.tsx` (the thin line), `Problem.tsx` (a reason with Retry), `Toast.tsx`.

    Later stages must build controls from these.
3.  `apps/web/src/keys.ts` (Create): the registry (`register`, `useShortcut(id, action)`, scopes), the
    document listener, label-only entries for keys owned by Dialogs, Switcher, MapTurn, Properties and the
    libraries, and `editorKeymap()` returning a CodeMirror keymap at `Prec.high`. Editor scope: Ctrl+B,
    Ctrl+I, Ctrl+S (save at once), Ctrl+Enter (Done), Tab via `indentWithTab` after the table keys.
4.  `apps/web/src/keys.test.ts` (Create): scope order, typing fields ignore plain keys, the sheet lists
    label-only entries.
5.  `apps/web/src/components/KeySheet.tsx` (Create): the "?" sheet, built from the registry.
6.  `apps/web/src/components/Shell.tsx` (Modify): its Ctrl+K listener moves to the registry; mounts the
    registry listener and KeySheet; "New entry" opens `NewEntry` instead of the prompt; Log out moves
    into a "⋯" menu with the other admin links.
7.  `apps/web/src/components/NewEntry.tsx` (Create): a name field and the folder combobox (folders from
    `/api/tree`), defaulting to the folder in view; opens `/edit/<folder>/<name>.md?new`.
8.  `apps/web/src/components/Lightbox.tsx`, `apps/web/src/pages/ChroniclePage.tsx` (Modify): their
    document listeners become registry shortcuts.
9.  `apps/web/src/pages/MapPage.tsx` (Modify): its document listener becomes registry shortcuts; the
    phone header (title, Done, "⋯" on one line) and a bottom tool bar holding the tools, Undo and Redo
    below 768 px; Delete map moves into "⋯". No other change to this file before stage 13.
10. `apps/web/src/pages/Edit.tsx` (Modify): Delete and Discard move into a "⋯" menu; Done stays the main
    button; toolbar via item 11.
11. `apps/web/src/components/EditToolbar.tsx` (Modify): `IconButton` with lucide icons and tooltips.
12. `apps/web/src/components/CodeEditor.tsx` (Modify): uses `editorKeymap()`.
13. `apps/web/src/components/livePreview.ts` (Modify): live preview uses the reading font; the front
    matter folds to one line ("Properties: 2 aliases") that opens the Properties panel.
14. `apps/web/src/pages/Entry.tsx` (Modify): Rename, History and Export move into a "⋯" menu beside Edit.
15. `apps/web/src/styles.css` (Modify): layer, spacing and icon-size tokens; `--ink-faint` becomes
    `#6e665a` in light (5.1:1 against `#f7f3ea`) and `#9a917f` in dark (5.8:1 against `#171512`).
16. `apps/web/e2e/helpers.ts` (Modify): `openMenu(name)` for "⋯" menus; `newEntry(folder, name)` for the
    dialog; `discardDraft` opens the menu first.
17. `apps/web/e2e/write.spec.ts` (Modify): Delete (line 150) and Discard (141) through the menu; "creates
    a new entry" (41–43) through the dialog.
18. `apps/web/e2e/navigate.spec.ts` (Modify): the Rename link (27) through the entry's menu.
19. `apps/web/e2e/editor.spec.ts` (Modify): Ctrl+B, Ctrl+I, Tab indents, Tab in a table moves cells,
    every toolbar button has an accessible name and a tooltip.
20. `apps/web/e2e/maps.spec.ts` (Modify): at 390 px, Done, Undo and the menu are visible; Delete map is in
    the menu.
21. `playwright.config.ts` (Modify): the desktop project's `testMatch` gains `editor`, `shell` and
    `tree`.

### Release 11a-2: saving and connection

**Schema**

22. `packages/schema/src/api.ts` (Modify): `SaveDraftRequest` gains optional `baseBlob` and `op`;
    `EntryResponse` gains `blob`; the versions response becomes `{ current, others: { device, deviceName,
    savedAt, text }[] }`; the attention response gains `versions: { draftId, path, count }[]`.
23. `packages/schema/src/state.ts` (Modify): `DraftRecord` gains optional `lastOp`; a `KeptCopy` record
    `{ device, deviceName, savedAt }`.
24. `packages/schema/src/status.ts` (Modify): `StatusSnapshot.attention` gains `keptCopies: number`.
25. `packages/schema/src/itemFile.ts` (Modify): `mergeItemLists` takes an optional key function
    (default `id`).
26. `packages/schema/test/schemas.test.ts` (Modify): the new fields parse; old bodies still parse.

**Server**

27. `apps/server/src/state/drafts.ts` (Modify):
    *   `PublishedInfo` gains `text`.
    *   `save(input, published, device)` checks `op` first, then follows the table in Technical Plan §2;
        for the "differs" row it makes a draft (id from the request) holding `published.text`, writes the
        incoming text as the device's kept copy, and throws `stale_revision` with `{ id }`.
    *   `saveFrom` and `serverChange` take an optional `op`, stored as `lastOp`, and return the stored
        record when it repeats.
    *   Kept copies in `versions/<device>.txt` and `versions/<device>.json`; `hasKeptCopies(id)` replaces
        `hasSecondVersion`; `keptCopies(id)` lists them; `mergeVersions` removes them; an old `content.v2`
        is read as device `earlier`.
28. `apps/server/src/routes/drafts.ts` (Modify): `check()` returns the library text too; reads
    `Frontier-Device` (accepted only if it matches `Id`, else `invalid`; absent means `unknown`) and
    `Frontier-Device-Name` (URI-decoded, 40 characters); passes `baseBlob`, `op` and the device to
    `save()`; after `stale_revision`, calls `s.status.drafts(...)` so the stream carries the new count.
29. `apps/server/src/routes/maps.ts`, `apps/server/src/routes/chronicles.ts` (Modify): their local `Save`
    bodies gain optional `baseBlob` and `op`; loads return `blob`.
30. `apps/server/src/maps/store.ts`, `apps/server/src/chronicles/store.ts` (Modify): `LoadedMap` and
    `LoadedChronicle` gain `blob`; `save()` applies the first three rows of the §2 table and passes `op`
    to `saveFrom`/`serverChange`. `chronicles/store.ts` `makeMain` passes no `op`.
31. `apps/server/src/routes/entries.ts` (Modify): entry loads return `blob`.
32. `apps/server/src/routes/status.ts` (Modify): `/api/attention` adds `versions` from `s.drafts`; the
    event stream writes a comment line every 20 seconds.
33. `apps/server/src/status/status.ts` (Modify): the snapshot's attention count reads the number of
    drafts with kept copies through a callback given at start.
34. `apps/server/src/publish/publish.ts` (Modify): `hasKeptCopies` replaces `hasSecondVersion` at both
    calls; `clearPublished` keeps a draft that has kept copies.
35. `apps/server/src/entries/change.ts`, `apps/server/src/routes/lore.ts` (Modify): `hasKeptCopies`.
36. `apps/server/src/app.ts` (Modify): passes the kept-copy callback to the status service.
37. `apps/server/test/publish.test.ts` (Modify; it holds today's draft tests): the CUJ 3 sequence end to
    end; three devices give three kept copies; a repeated `op` writes nothing; an old `content.v2` is
    read; a save without `baseBlob` behaves as today; a bad device header is refused; `clearPublished`
    keeps a draft with kept copies.
38. `apps/server/test/maps.test.ts`, `apps/server/test/chronicles.test.ts`, `apps/server/test/ai.test.ts`
    (Modify): base checks and `op` for item files; the stale path in the AI tests uses kept copies.

**Web**

39. `apps/web/package.json` (Modify): add `idb@^8`; dev dependencies `fake-indexeddb@^6` and
    `happy-dom@^21`.
40. `apps/web/vitest.config.ts` (Modify): `environment: "happy-dom"` for `src/sync/**`.
41. `apps/web/src/sync/db.ts` (Create): opens the database (`queue`, `meta`) with the in-memory
    fallback; makes the device id once with the same alphabet as `makeId`, and the name from the user
    agent.
42. `apps/web/src/sync/queue.ts` (Create): `put`, `get`, `subscribe`, `list`, `retry`, `drop`; the Web Lock
    sender; per-record back-off (2, 4, 8 … up to 60 seconds); the answer table of §1; per-kind senders:
    entry (`kind`), map and chronicle (`link`, merging with `mergeMaps`/`mergeChronicles`).
43. `apps/web/src/sync/migrate.ts` (Create): moves `frontier:draft:*` keys into the queue once, then
    deletes them.
44. `apps/web/src/sync/connection.ts` (Create): the service of §3 and `useConnection()`.
45. `apps/web/src/sync/queue.test.ts`, `apps/web/src/sync/migrate.test.ts`,
    `apps/web/src/sync/connection.test.ts` (Create), with `fake-indexeddb` and stubbed `fetch` and
    `EventSource`: survives a reopen; one record per file keeps its base and gets a new `op`; per-record
    back-off; pause on 401 and resume; a stale entry record is removed; a stale map merges without a page;
    links from two changes combine; migration moves and removes keys; a 401 probe gives `signed-out`.
46. `apps/web/src/api.ts` (Modify): `call()` adds both device headers and reports reachability to the
    connection service; save functions send `baseBlob` and `op`; `LoadedMap` and the versions type
    follow the schema.
47. `apps/web/src/drafts.ts` (Delete).
48. `apps/web/src/pages/Edit.tsx` (Modify): reads unsent text from the queue; puts every change into it
    with `kind`; Discard calls `queue.drop` then discards the draft; Delete puts a `delete` record; shows
    "Two texts to compare" with a link on `stale_revision`; uses `SaveStatus`.
49. `apps/web/src/hooks/useItemFile.ts` (Modify): saves through the queue; takes the server's returned
    value and `unlinked` from the subscription; keeps its undo stacks.
50. `apps/web/src/pages/MapPage.tsx` (Modify): saves through the queue instead of its own loop; uses
    `SaveStatus`.
51. `apps/web/src/pages/ChroniclePage.tsx` (Modify): uses `SaveStatus`.
52. `apps/web/src/pages/Maps.tsx`, `apps/web/src/pages/History.tsx` (Modify): their saves (`schematic`,
    restoring a version) go through the queue.
53. `apps/web/src/pages/Versions.tsx` (Modify): lists every kept copy with its device and time, one beside
    the current text at a time, with "Keep this one" or a hand merge.
54. `apps/web/src/components/ui/SaveStatus.tsx` (Create): one component for every page, rendering
    today's class names and words (`save-<state>`, `ch-saving`, "Saved as a draft", "Saving…") so
    existing tests keep working, plus "Unsent: kept on this device".
55. `apps/web/src/components/Unsent.tsx` (Create): the unsent list (§1).
56. `apps/web/src/components/LoginDialog.tsx` (Create): the login form in a dialog, shown over the page
    when the connection service says signed out.
57. `apps/web/src/components/Shell.tsx` (Modify): the connection mark, unsent and attention counts in the
    top bar; listens to the status stream through the connection service; logout warns when unsent
    records exist, then clears the queue and `meta`.
58. `apps/web/src/App.tsx` (Modify): mounts `LoginDialog`; runs the migration once at start.
59. `apps/web/src/useAsync.ts` (Modify): adds `reloading`; a failure after a value keeps the value and
    reports the error.
60. `apps/web/src/components/Switcher.tsx` (Modify): "Can't reach Frontier" with Retry.
61. Pages using `useAsync` (Modify), each to show `Progress` while reloading and `Problem` on failure:
    `pages/Entry.tsx`, `pages/Maps.tsx`, `pages/Chronicles.tsx`, `pages/Gallery.tsx`, `pages/History.tsx`,
    `pages/Unpublished.tsx`, `pages/Inbox.tsx`, `pages/Ask.tsx`, `pages/Settings.tsx`, `pages/Status.tsx`,
    `pages/Export.tsx`, `pages/Import.tsx`.
62. `apps/web/e2e/write.spec.ts` (Modify): text typed while the server is unreachable is sent when it
    returns; a reload while unsent keeps the text; two browser contexts give "Two texts to compare" and
    lose nothing; old `localStorage` keys are moved.
63. `docs/designs/frontier.md` (Modify): in Non-Goals (lines 186–190), a dated note that the author
    reversed "Full offline use" and "The graph view and canvas are not rebuilt" (the graph part only) on
    2026-11-22, pointing to the brief; the browser-buffer statements (lines 376, 553, 1077, 1183) point to
    this design's queue.
64. `docs/BACKLOG.md`, `README.md` (Modify): the 2026-11-22 ideas inbox item moves under "Now: stages 11
    to 15"; the status table gains stage 11.

### Release 11b: the shell

65. `apps/web/package.json` (Modify): add `react-resizable-panels@^4`.
66. `apps/web/src/components/Shell.tsx` (Rewrite): no top bar; the left side bar, rail and footer; the
    right side bar through `PanelHost`; the phone line, drawer and bottom sheet.
67. `apps/web/src/components/shell/LeftBar.tsx`, `RightBar.tsx`, `AppMenu.tsx`, `Rail.tsx`, `PhoneBar.tsx`,
    `panels.tsx` (Create): the parts; `panels.tsx` holds `usePanel()`.
68. `apps/web/src/pages/Edit.tsx`, `apps/web/src/components/Properties.tsx`,
    `apps/web/src/components/CommentsPanel.tsx`, `apps/web/src/components/WritingPanel.tsx` (Modify):
    become right-bar panels.
69. `apps/web/src/pages/MapPage.tsx`, `apps/web/src/components/MapPanels.tsx` (Modify): Layers and the
    selected feature become right-bar panels.
70. `apps/web/e2e/helpers.ts` (Modify): `goTo(place)` and `rightPanel(name)`.
71. Specs that touch the shell (Modify): `passkey.spec.ts` (`.topnav`, line 36), `reader.spec.ts`
    (`.menu`, lines 86–87), `write.spec.ts` (`.menu`, `.new-entry`), `library.spec.ts` (the History link at
    line 51 becomes `exact`, since the app menu has "History of the library").
72. `apps/web/e2e/shell.spec.ts` (Create): the rail keeps the counts and connection; the right bar's width
    and tab are remembered; on a phone the drawer and bottom sheet open and close; with the server
    stopped, the mark says "Not connected" and the page does not go blank.

### Release 11c: the folder tree

73. Spike (one day, before item 79): `react-arborist@^4` with React 19 in this app, inside the left bar,
    with drag and drop and keyboard. Record the result in this document; on failure, item 79 uses the
    fallback in Risks.
74. `packages/schema/src/api.ts` (Modify): `TreeFolder` gains `icon?`, `color?`, `order?`, `type?`, `empty?`,
    `moved?`; request and response schemas for `PUT /api/folders` (the file, `revision`, `baseBlob`, `op`),
    `POST /api/folders/delete` (`{ path }` → `{ entries, folders }`, refusals `has_drafts`, `has_images`,
    `append_only`, `read_only_file`) and `POST /api/folders/apply-type` (`{ path }` → `{ made }`).
75. `packages/schema/src/folders.ts` (Create): `FolderFile`; `parseFolders`, `serialiseFolders` (one line
    per folder); `mergeFolders` (through `mergeItemLists` keyed by path); `orderBetween(a, b)`;
    `FOLDER_ICONS`: `folder`, `book`, `book-open`, `scroll`, `feather`, `pen-tool`, `map`, `map-pin`,
    `compass`, `globe`, `mountain`, `mountain-snow`, `trees`, `tree-pine`, `leaf`, `flower`, `waves`,
    `droplet`, `flame`, `sun`, `moon`, `star`, `sparkles`, `cloud`, `snowflake`, `castle`, `landmark`,
    `church`, `house`, `tent`, `ship`, `anchor`, `sword`, `swords`, `shield`, `crown`, `gem`, `coins`,
    `key`, `lock`, `skull`, `ghost`, `eye`, `heart`, `users`, `user`, `baby`, `bird`, `fish`, `bug`,
    `paw-print`, `cat`, `dog`, `rabbit`, `hourglass`, `clock`, `calendar`, `flask-conical`, `wand`,
    `music`, `languages`, `archive`; `FOLDER_COLORS` (light / dark): ember `#9a3b1c`/`#e08a5f`, sea
    `#1f5f8b`/`#7fb6dd`, moss `#3f6b2a`/`#9cc47f`, gold `#7a5a00`/`#d9b24c`, plum `#6b3a7a`/`#c79bd6`,
    slate `#4a5560`/`#a7b2bd`, rose `#9b2f55`/`#e88aa8`, teal `#1d6b63`/`#74c4b9` (each at least 5.4:1
    on both page colours).
76. `packages/schema/src/index.ts` (Modify): export it. `packages/schema/test/folders.test.ts` (Create):
    parse, one line per folder, merge two reorders of different folders, `orderBetween` for any two keys,
    unknown icon or colour refused.
77. `apps/server/src/library/itemFile.ts` (Create): one store for library item files, driven by a table of
    `LibraryFileKind` entries (path, schema, list key, merge key). It loads a file (draft first, then
    library), saves it as a draft with `revision`, `baseBlob` and `op` through `saveFrom`/`serverChange`,
    and resolves a clash, for any kind in the table. `apps/server/src/folders/store.ts` (Create) registers
    the folder file as the first kind (with the in-memory build from the schema's lists) and holds the
    grouped delete and apply-type. Stage 13 adds the map styles file as the second kind
    ([stage 13](stage-13-maps.md)), so nothing here may be folder-only.
78. `apps/server/src/routes/folders.ts` (Create) and `apps/server/src/app.ts` (Modify): the routes in
    item 74, registered.
79. `apps/web/src/components/Tree.tsx` (Rewrite): the tree on `react-arborist` (or the fallback): drag and
    drop with the toast and Undo; inline rename; "+" and "⋯"; the context menu; icons and colours;
    long press on touch; moved and empty folders marked; refusals shown in the toast.
80. `apps/web/src/components/FolderSettings.tsx` (Create): icon, colour and type for one folder, in a
    popover.
81. `apps/web/src/sync/queue.ts` (Modify): a generic library-file sender (key per kind), merging with each kind's merge (`mergeFolders` for folders); `kindOf` no longer defaults to folders.
82. `apps/web/src/components/NewEntry.tsx` (Modify): "New folder '…'"; writes `type:` with
    `setFrontmatterKey` when the chosen folder has one.
83. `apps/server/src/index/build.ts` (Modify): `readSchema` lays the folder file's types over the schema's
    `folders` lists, taking them from the folder store; the status page's note when the schema's lists are
    no longer read. No change to `typeFromFolder` or its callers (`routes/entries.ts:60`,
    `ai/fields.ts:185`).
84. `apps/server/src/routes/entries.ts` (Modify): `/api/tree` adds rename intents through `movedPath`
    (with the link kept on the old path) and the folder file's lines.
85. `apps/server/src/publish/publish.ts` (Modify): saving a rename intent rewrites the folder file's paths
    in the same commit, writing the file first from the schema's lists if it existed only in memory.
86. `apps/server/test/folders.test.ts` (Create): the file built from the schema, then the only source
    after the first change; a draft's type is used before saving; empty folders last; delete refusals
    and counts; apply-type touches only entries without a type. `apps/server/test/publish.test.ts`
    (Modify): a rename rewrites the folder file, and creates it when missing.
87. `apps/web/e2e/reader.spec.ts` (Modify): `.tree-folder` (line 87) becomes the new tree's folder role.
88. `apps/web/e2e/tree.spec.ts` (Create): CUJ 1; CUJ 2 with Undo; reorder survives a reload; CUJ 7;
    keyboard arrows and F2 (desktop); the menu on long press (phone).

### Verification Plan

*   **Build**: `npm run build` (every workspace; for the web app this includes `tsc --noEmit`).
*   **Unit tests**: `npm test`. The server, schema and vault workspaces keep their coverage thresholds,
    including 90% branch coverage on `apps/server/src/publish/**`. The web workspace has no threshold;
    the new `sync/` modules are covered by items 45 and 4.
*   **Lint**: `npm run lint`.
*   **E2E**: `npm run e2e` after each release, in the desktop and iPhone 13 projects.
*   **Bundle**: first-load JavaScript gzipped, measured before 11a-1 and after each release; no more than
    80 KB above the first measurement.
*   **Screens**: after 11a-1 and 11b, the screenshots in `ux-review/shots/` are taken again. A release
    passes when each review item the table in Technical Plan §8 assigns to it is no longer visible in
    them.
*   **By hand on a real iPhone** (not possible in CI, which runs Chromium): unsent text survives closing
    Safari; the drawer and bottom sheet work by touch; long press opens the tree menu.
