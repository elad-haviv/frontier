# Stages 11 to 15: a calmer interface, and work that survives a bad connection

- **Author:** Elad Haviv
- **Date:** 2026-11-22

## Overview

Frontier works, but it reads as a set of separate admin pages. An 11-link top bar sits above a folder
list that cannot be edited. The editor toolbar is a row of symbols with no names. Maps give no sign of
what is under the pointer. A weak connection shows up only as pages that go blank. The author listed
about 45 changes (kept whole in `docs/BACKLOG.md`, 2026-11-22). An independent UX review of the running
app (`ux-review/expert-review.md`) found most of the same problems without seeing his list, and added
some he had not named: on a phone the map editor's Done and Undo are off the screen; the editor body is
monospace; Delete sits next to Done; secondary text is too faint to meet contrast rules.

The author wants all of it, with the general interface first. He also wants to keep working when the
network drops: editing the files he opened recently, adding entries, and changing maps and chronicles,
with the differences sent when the connection returns.

Seven fresh reviewers examined the concept. Their notes are in `.egm/reviews/`. This brief merges them.

## Analysis

### What all seven agreed on

**1. Offline work cannot be added last on top of today's saving. It has to be prepared first.**
Saving works four different ways now:

- entry text, with a small buffer in the browser's `localStorage`;
- maps, with a three-way merge whose base copy lives only in memory;
- chronicles, the same through `useItemFile`;
- on the server, one spare slot (`content.v2`) for a clashing version.

Each page also calls the server directly and has its own retry timer.

Several of these already lose work in edge cases, and offline use would make those cases common:

- **A published change can be undone silently.** A save never says which version of the entry it
  started from. The phone edits an entry offline, the laptop edits and publishes the same entry, and
  the phone reconnects. The server takes the phone's old text as a fresh draft based on the laptop's
  version, and Publish then overwrites the laptop's change without showing a conflict. Maps and
  chronicles have the same gap (`drafts.ts:198-216`, `maps/store.ts:183-191`,
  `chronicles/store.ts:184-189`).
- **Kept text is cleared, or ignored, today.**
  - When the editor learns a newer draft exists, it clears the text kept in the browser
    (`Edit.tsx:224-228`).
  - When that draft was published from another device, the kept text is skipped and never mentioned
    again (`Edit.tsx:182-189`).
- **A third version overwrites the second.** The spare slot holds one clashing version, so a third
  device's save replaces the second's text.
- **A reload turns the merge into "mine wins".** Without its in-memory base, the map merge keeps
  "yours" on every clash. That is harmless after seconds offline and destructive after days.

The agreed answer is one data layer, built in stage 11, that every page saves through:

- a queue of changes on the device (IndexedDB), each carrying the version it started from and its own
  id, so a retry is never stored twice;
- one connection service built on the status stream the server already sends
  (`/api/status/events`, which the web app never listens to today);
- on the server, a check that the base still matches before a save becomes a draft;
- room for several clashing versions, one per device;
- conflict records that survive a reload and can be opened by link.

Stage 15 then adds the offline cache and the sync rules, and does not touch every page again.

**2. Offline and the graph reverse two written non-goals.** `frontier.md:186-190` says "Full offline
use" is out ("Obsidian remains available for writing with no connection") and "the graph view … is not
rebuilt". The author has now asked for both. The master design must record that change, with the date,
or later reviews will meet two answers.

**3. A per-folder default type already exists.** `.frontier/schema.yaml` maps each type to its folders,
and the editor already shows "type from folder". A second mapping in a new folder file would make two
answers that can disagree. The folder's "default type" setting must edit the schema, and folder
renames must update the schema's folder paths too.

**4. An empty folder cannot exist yet.** Git keeps no empty folders, and the tree is built from notes
alone. A folder made with nothing in it disappears on reload and in the export.

**5. Fetching an image from a URL on the server is a real security risk.** The server sits on the
Coolify network next to other services. A "download this address" endpoint can be pointed at internal
addresses unless it does all of the following:

- accepts http and https only;
- refuses private and local addresses, checking again after each redirect;
- caps size and time;
- checks the bytes are really an image;
- saves through the existing upload path.

**6. "Kind" is already taken in maps.** It is the field that says marker, path or zone. Path and zone
categories (river, road, border) need another name, and a stated rule for whether their style or the
layer's colour wins.

**7. Use libraries for the shared parts.** The app has no icon set, tooltip, menu, combobox, splitter
or shortcut layer today, and eight separate key listeners in four files. Writing these by hand would
be the largest single cost of stages 11 to 13, and the hand-made versions would lack keyboard and
screen-reader support.

### Where reviewers disagreed

- **How much to cut.** The cost-cutting reviewer would drop:
  - URL import, custom folder order, library-wide path styles, stacked panels and the graph;
  - offline creation and offline map editing.

  The others treat them as wanted and say how to build them safely. The author has already chosen:

  - library-wide styles for paths and zones;
  - folder order that only Frontier sees;
  - gallery search over his own images;
  - offline editing of recent files, new entries, maps and chronicles.

  This brief keeps those choices and adds the safety rules.
- **Where folder style and order live.**
  - In the library as a file: versioned and exported, but every drag becomes an unpublished change.
  - In Frontier's own state: instant, but outside history and export.

  Open question 1.
- **Empty folders.**
  - Make each new folder with its folder note (a note named after the folder, which Frontier already
    treats as the folder's page and Obsidian shows).
  - Or keep empty folders as a list in Frontier's state until a first entry arrives.

  Open question 2.

### Further risks to carry into the designs

- **Phone and touch.** Much of the concept assumes a mouse: hover tooltips, right-click, dragging in the
  tree, a resizable side bar, dragging a zone. Each needs a touch equivalent:
  - a long press or a "⋯" button for menus;
  - tap to select, then "Move" in place of dragging;
  - on a phone, the right side bar becomes a bottom sheet and the left a drawer.
- **The collapsed side bar must keep the signals the top bar carried:** search, the unpublished and
  inbox counts, and the connection state.
- **Maps.**
  - A zone moves by dragging its inside only once it is selected; elsewhere a drag still pans.
  - The "+" handles at segment middles show only on the selected feature.
  - Edits act on the shape in force at the time on screen, since paths and zones have later shapes.
  - Curves are stored as a flag plus control points. A densified line is worked out once in
    `packages/geo`, so measuring, hit-testing, the globe and the exports all agree.
  - The map file stays at version 1, and every new field is optional.
- **MapPage.tsx is 1,618 lines with about 64 pieces of state.** Before stage 13 adds a view mode, hover,
  menus, rubber-band lines and handles, its tools and gestures should be split into separate modules
  with one clear state machine.
- **Shortcuts.**
  - One list of shortcuts with scopes (app, editor, table, map), from which the "?" sheet and the
    tooltip hints are made.
  - Ctrl+K stays the switcher.
  - Tab moves between table cells, indents in lists and text, and Esc then Tab leaves the editor.
- **Underline.** `<u>` is HTML, not Markdown. The reader strips it today, and each export needs
  handling. Ctrl+U opens view-source in browsers, so the editor must take that key. Obsidian does show
  `<u>`.
- **Offline storage on a phone.** Safari clears a site's storage after about 7 days without use unless
  the site is installed to the home screen. So:
  - ask the browser to keep storage (`navigator.storage.persist()`);
  - never evict an unsent change;
  - show what is on the device and what is waiting to be sent.
  - This cannot be tested in CI, which runs Chromium only; it must be checked on a real iPhone.
- **Offline login and updates.**
  - An expired session pauses the queue rather than clearing it.
  - An app update waits until the queue is empty.
  - Logout warns about unsent work, then wipes the device copy.
- **Offline links.** Offline, links, `[[` completion and map names need a small index of every
  entry's name, aliases, id and links. That index is cached whole, with only the bodies limited to
  recent files. The same index feeds the graph, so the graph works offline too.
- **Moves while offline.** Moving or renaming folders and entries needs the server to work out which
  links change, so these are online only.
- **E2E tests.** Removing the top bar will break selectors in most browser tests. `e2e/helpers.ts` is
  rewritten first.

### Ideal result

Stage 11 delivers four shared pieces: the save queue and connection service, the shortcut list, the
side-bar panel registry, and the shared components (icons, tooltip, menu, combobox). Stages 12 to 14
plug into them. Stage 15 adds the cache, the base copies for merging and the sync rules. Nothing typed
on any device is lost without the author seeing it, and only real overlaps reach a conflict screen.

## Goals vs. Non-Goals

- **In-scope goals:**
  - every item in the author's list of 2026-11-22;
  - the UX review's top ten;
  - fixing today's paths that clear or ignore kept text;
  - saves that carry their base.
- **Out of scope:**
  - several people using one library (one author only);
  - real-time co-editing;
  - offline AI, search across uncached entries, export, import and history;
  - folder or entry moves while offline;
  - URL image import while offline;
  - rebuilding Obsidian's canvas.

## Alternatives Weighed

- **Build stage 15 last on today's saving:** rejected by all seven reviewers; every page would be redone
  and several paths lose work.
- **A second folder-to-type mapping in a new file:** rejected; the schema already holds one.
- **Reorder folders by renaming their number prefixes:** rejected by the author; the order is to be
  seen in Frontier only.
- **Folder kinds as layers (add width and dash to layers):** offered by the cost-cutting reviewer;
  rejected by the author's choice of library-wide styles. Layers keep their colour, and the precedence
  is stated in the stage 13 design.
- **Panels that stack freely, as in Obsidian:** rejected; tabs in one resizable side bar, a fixed set
  per screen.
- **Three outlines (in-page contents, heading breadcrumb, contents pane):** merged into one sticky line
  (folder › entry › heading) and one contents tab in the right side bar.
- **A status bar naming the hovered tool:** dropped; styled tooltips show the name and shortcut and also
  work with the keyboard.
- **Hand-made tooltips, menus, comboboxes, tree and splitters:** rejected in favour of libraries:
  `lucide-react` for icons, Radix primitives for tooltips and menus, one combobox, `react-arborist` for
  the tree, and `react-resizable-panels`. The design confirms each choice.
- **A graph computed in the browser from every entry's text:** rejected; one `/api/graph` from the
  server's link index. The local graph is the same view filtered to one entry.
- **Server-side URL import with no guards:** rejected; it is kept only with the guards in point 5.

## Key Decisions & Staging for Next Steps

The order is changed from the concept, to put the review's urgent fixes and the shared foundations
first:

1. **Stage 11a: urgent fixes and foundations.**
   - Fixes:
     - the phone map header;
     - map hover and selection;
     - New entry choosing its folder;
     - contrast;
     - a live preview with prose font;
     - Delete moved out of the main row;
     - Ctrl+B/I/S and Tab.
   - Foundations:
     - shared components and icons;
     - the shortcut list;
     - the save queue and connection service;
     - saves carrying their base, with several clashing versions kept.
   - Moving today's `localStorage` buffer into the queue.
2. **Stage 11b: the shell.**
   - The top bar goes.
   - A collapsible left side bar with the app menu at the bottom, and an icon rail that keeps the
     counts and connection state.
   - A tabbed, resizable right side bar that pages fill through a registry.
   - Phone: a drawer and a bottom sheet.
   - Loading states that keep the old page with a progress line.
3. **Stage 11c: the folder tree.**
   - Add, nest, move, reorder, rename, style and delete, with drag and drop, quick buttons, a context
     menu, and undo for moves.
   - The default type is kept in the folder file (decided by the author after this brief; see the stage 11 design) and is written into each new entry.
   - A folder move is one rename plan.
4. **Stage 12: entries and editor.**
   - Sticky folder › entry › heading line, a contents tab, full width, inline rename, move combobox.
   - History, export and properties as side-bar tabs.
   - New toolbar and style picker, lists, code and quotes, strikethrough and underline, context menu
     with comment.
   - One image dialog over the Gallery's data, with browse, upload or drop, paste, guarded URL import
     and search.
5. **Stage 13: maps.**
   - Split MapPage first.
   - Then the gallery, combobox and side bar.
   - A view mode with hover previews (reusing `HoverPreview`).
   - Library-wide path and zone styles.
   - Curves, rubber-band line, midpoint handles, zone drag, context menu and keys.
6. **Stage 14: the graph.** Global and local, read and navigate, coloured by folder, with filters.
7. **Stage 15: offline.**
   - The app cached through a service worker.
   - The compact index always on the device, bodies for recent and pinned files.
   - Base copies for three-way merge, with a resolver per kind of file (text, map by feature, chronicle
     by span).
   - An "N changes waiting" list.
   - Storage kept and shown.

Answered by the author on 2026-11-22:

1. **Folder icon, colour and order are versioned.** They live in a library file under `.frontier/`, go
   through drafts and "Save a version" like maps, and are kept in history and in the export. The file
   is stored one item per line and merged item by item, so two devices reordering different folders do
   not clash. A folder rename rewrites its keys in the same version; keys for folders that no longer
   exist are dropped when the file is read.
2. **No folder note by default.** A new empty folder is listed in that same file, so it lasts and is
   versioned, and it becomes an ordinary folder when its first entry arrives. A folder note is made
   only when the author asks for one. In an Obsidian export an empty folder does not appear.
3. **The offline limits are accepted:** moves and renames, URL image import, AI, search over entries not
   on the device, and history need a connection; on an iPhone Frontier must be installed to the home
   screen to keep its offline copy.
