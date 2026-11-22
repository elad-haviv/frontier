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

*   **Folder file format.** One record per folder, keyed by path, stored one per line like map files
    (proposed), or keyed by a stable folder id. Paths are simpler and match the schema's folder lists;
    ids survive renames made outside Frontier. To be settled in the Technical Plan.
*   **Default type.** The schema already maps types to folders and infers an entry's type from its
    folder. The brief proposes also writing `type:` into each new entry. Settled in the Technical Plan,
    with the effect on existing entries stated.

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

--------------------------------------------------------------------------------

*Drafted with EGM*
