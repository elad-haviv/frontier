# Frontier

*   **Author:** Elad Haviv
*   **Status:** Draft
*   **Date:** 2026-11-20

--------------------------------------------------------------------------------

## Overview

Frontier is a web app for one author. In it he writes, reads and explores Avalymia, a fantasy multiverse
kept as about 500 Markdown notes in the `elad-haviv/avalymia` GitHub repository. It runs in desktop and
phone browsers and is hosted on the author's own server.

Frontier does four jobs in one place:

1.  **Write and read entries** at the level of Obsidian, the tool used today: wikilinks, backlinks, search,
    images, folders.
2.  **Review changes** proposed by AI and by agents, and approve or reject them before they become canon.
3.  **Explore space**: maps with markers, paths, zones and layers that link to entries, from the
    cosmological map down to a city, including a globe view and reprojection.
4.  **Explore time**: entries carry dates in several calendars, vague dates and relative order; timelines
    show overlaps; maps can show a chosen moment.

It also exports the work to other formats.

The Markdown files in the `avalymia` repository remain the source of truth. Frontier is a way of working on
those files. It does not own them.

**Scope of this document.** This is the master specification for the whole app. It defines the product, the
architecture and the data formats for all nine build stages listed in `concepts_brief.md`. Its detailed
implementation plan covers stages 1 and 2 (foundation, reader and editor) down to individual files. Each
later stage gets its own short design document before it is built, written against the architecture fixed
here. The reason: a file-by-file plan for stages 3 to 9 written now would be wrong by the time those stages
start, because stages 1 and 2 will change what is known.

## The Problem

The author has built Avalymia for 10 to 15 years across Photoshop, Illustrator, Leaflet web maps, Google
Docs, Word, Notion, Obsidian and AI chat tools. The current setup is an Obsidian vault mirrored to GitHub,
with a Hindsight memory bank that is refreshed on every push to `main`.

That setup fails him in four ways:

1.  **Places and events cannot be followed.** No note carries a date or a position that a program can read.
    Numbered dates appear about ten times in the whole vault. He cannot see which events overlap, what
    happened in the same era in two places, or where things were at a given time. This is the main pain he
    reported.
2.  **Maps are separate from the lore.** The maps are image files. Nothing links a point on a map to the
    entry about that place. The Obsidian Leaflet plugin is installed and holds no markers.
3.  **AI-written lore has no review surface.** Agents made 48 of the vault's 55 commits. The vault rules
    require that AI proposes and the author approves, but approval today happens in chat sessions, away from
    the text and awkward on a phone.
4.  **The work is spread over tools.** Writing is in Obsidian, maps in image editors, AI work in chat,
    recall in Hindsight. No single place shows the world.

Existing products do not fit. Hosted worldbuilding tools keep the data in their own storage, which breaks
"Markdown in Git is canon". Obsidian plugins cover simple maps and single-calendar timelines, but not
overlap across calendars or maps that change with time.

The proposed solution is a custom app that works directly on the vault's files, adds structured time and
standalone maps as further files in the same repository, and keeps a rebuildable index for fast lookups.

## Goals

Each goal states how it is checked.

*   **G1. Canon stays in the repository.** Every piece of content the author creates (entries, fields, maps,
    calendars) is a text file in `elad-haviv/avalymia`. Check: delete Frontier's index and server state,
    rebuild from a fresh clone, and no published content is missing.
*   **G2. Frontier never damages a file.** Opening and saving a note without edits leaves it byte-for-byte
    unchanged. Check: an automated test opens and saves every note in the vault and expects an empty Git
    diff.
*   **G3. Obsidian keeps working on the same vault.** Frontier writes only syntax Obsidian reads, and stores
    its own data where Obsidian ignores it. Check: the vault opens in Obsidian with all links resolving as
    before.
*   **G4. Links resolve the way Obsidian resolves them.** Check: a test runs Frontier's link resolver over
    the real vault and compares the resolved and unresolved lists with a checked-in baseline.
*   **G5. Writing is at Obsidian parity for the listed features**, on desktop and phone: live editing, `[[`
    autocomplete with aliases and headings, create an entry from an unresolved link, rename and move with
    link rewriting, quick switcher, full-text search, backlinks, outline, hover preview, table editing,
    image upload. Check: each item has an acceptance test.
*   **G6. No keystroke is lost and no draft becomes canon by accident.** Drafts save automatically on the
    server and in the browser. Only an explicit Publish creates a commit. Check: closing the tab, locking the
    phone or losing the connection mid-sentence loses nothing; no commit appears without Publish.
*   **G7. Concurrent writers never overwrite each other.** Obsidian and agents may push to `main` while
    Frontier is in use. Frontier pulls before it pushes, never force-pushes, and stops with a readable
    conflict screen when branches diverge. Check: a test pushes a conflicting change from outside and
    Frontier refuses to publish until the author resolves it.
*   **G8. AI never changes canon without approval.** Every AI or agent proposal waits in a review inbox with
    the source text shown. Check: no code path writes AI output to `main` without an approval record.
*   **G9. Time works without canon numbers.** An entry can hold exact, partial, vague and relative time
    references in any defined calendar. Timelines show order and overlap. Contradictions are reported, not
    fixed. Conversion between calendars appears only where the author has supplied an anchor and a rate.
    Check: a timeline renders from entries that have only relative references.
*   **G10. Maps work for every shape in the setting.** A map declares its coordinate space: sphere,
    cylinder, flat or schematic. Markers, paths and zones link to entries and survive renames. Check: one
    working map of each space type, with a marker that opens its entry and an entry that lists the maps it
    appears on.
*   **G11. Usable on a phone.** Every screen works at 375 px width with touch only, and images are served
    resized. Check: entry pages load under 2 seconds on a 4G connection.
*   **G12. Failures are visible.** The app shows unpublished changes, the last pull and push, failed pushes,
    a stale index and failed AI calls. Check: each failure is triggered in a test and appears in the
    interface.

## Non-Goals

*   **More than one user.** No collaborators, readers, sharing or permissions. There is one login.
*   **Full offline use.** A phone needs a connection. The only offline provision is a draft buffer in the
    browser, so text typed during a dropped connection is kept and sent later. Obsidian remains available
    for writing with no connection.
*   **Retiring Obsidian.** Frontier does not remove or migrate away from the Obsidian setup.
*   **Rendering Obsidian plugin syntax.** The vault contains no Leaflet, Tasks, mind-map, callout or tag
    syntax, so none is supported. The graph view and canvas are not rebuilt.
*   **Mass AI backfill.** Frontier does not run AI over the whole vault and write fields in bulk. Fields
    become canon one confirmation at a time.
*   **Deciding canon.** Frontier does not need, and does not invent, pulse rates, calendar anchors, leap
    rules or the radius of Ezob. It works with whatever the author has defined.
*   **Replacing Hindsight.** The memory bank and its sync agent stay as they are, apart from one change to
    ignore frontmatter-only edits.
*   **Drawing base maps.** Map images are still made in outside tools and imported. Frontier draws markers,
    paths, zones and labels on top of them.
*   **Editing `99 Appendices`.** That folder is append-only by vault rule. Frontier shows it and can add new
    files to it, and cannot edit existing ones.

## Open Questions

*   **Q1. Hindsight sync change.** The sync agent re-ingests a note on any byte change. Adding an `id` and
    time fields to frontmatter would re-ingest most of the bank. Either the sync is changed to ignore
    frontmatter-only changes before stage 3, or one full re-ingest is accepted. The sync agent's code is
    outside this repository and has not been read.
*   **Q2. Duplicate note names.** `Yagon.md` and `Common Ezobian.md` each exist twice, so links to them are
    ambiguous. The author needs to say which is meant, or the notes need renaming, before the link baseline
    (G4) is fixed.
*   **Q3. Existing map file.** `99 Appendices/06 Interactive Maps/Main.json` is an earlier map format with
    empty arrays. Adopt it, or replace it with the format defined here.
*   **Q4. Third-party game icons.** 182 images are icons from commercial games. They are fine in a private
    app. They cannot be included in a web export. A replacement marker icon set is needed before stage 9.
*   **Q5. Export targets.** "Web" and "presentations on different topics" need a definition: which content,
    chosen how, in what form.

## Critical User Journeys (CUJs)

### CUJ 1: Write on the phone, publish later

*   **Given**: The author is logged in on his phone and opens the entry for a city.
*   **When**: He adds two paragraphs, types `[[` and picks a character from the autocomplete, then locks the
    phone and walks away.
*   **Then**: The draft is saved on the server. The entry shows "unpublished". Nothing has been committed.
    That evening on desktop he sees the same draft, presses Publish, writes a one-line message, and one
    commit lands on `main`. Hindsight ingests the note once.

### CUJ 2: Follow a link to a note that does not exist yet

*   **Given**: An entry contains `[[The Nirani Exodus]]`, which has no note.
*   **When**: The author clicks the link.
*   **Then**: Frontier offers to create the entry, suggests a folder, and opens the editor. After Publish,
    all eight existing links to that name resolve to the new note.

### CUJ 3: Rename an entry

*   **Given**: A note is linked from 20 other notes, some by bare name and some by path.
*   **When**: The author renames it.
*   **Then**: Frontier shows the list of notes whose links will change. On Publish, the rename and all link
    rewrites are one commit. Markers on maps still point to the entry, because they refer to its `id`.

### CUJ 4: Someone else pushed first

*   **Given**: The author has an unpublished draft of a note. An agent pushes a change to the same note.
*   **When**: He presses Publish.
*   **Then**: Frontier does not publish. It shows his version beside the new version from `main`, marks the
    differences, and lets him merge by hand. It never merges or overwrites on its own.

### CUJ 5: Approve a proposed date

*   **Given**: The author publishes an entry containing "two centuries after the First Landing".
*   **When**: Frontier's AI proposes a time field: "after First Landing, about 200 years, Era of Man".
*   **Then**: The proposal appears as a chip on the entry and in the inbox, with the source sentence
    highlighted. Publishing was not blocked. He accepts with one tap, the field is added to the entry's
    frontmatter, and it enters the next Publish. If he rejects it, it is not proposed again unless the
    sentence changes.

### CUJ 6: Review an agent's lore proposal

*   **Given**: An agent has drafted a new entry and edits to three existing ones.
*   **When**: The author opens the inbox on his phone.
*   **Then**: He sees the proposal as one unit, with each changed file shown as a readable difference. He
    accepts, edits or rejects each file. Accepted files become one commit on `main`.

### CUJ 7: From a map to an entry and back

*   **Given**: The Ezob map is open.
*   **When**: The author taps the marker for a city, reads the preview, opens the entry, then presses back.
*   **Then**: The map returns at the same position and zoom. The entry page lists "appears on maps: Ezob,
    Amarah" beside its backlinks. Tapping a zone marked as having a sub-map opens the continent map.

### CUJ 8: See what overlaps

*   **Given**: Events with dates in the Era of Man, events with only relative references, and one event
    dated in pulses.
*   **When**: The author opens the timeline and selects two regions.
*   **Then**: Events appear in order, each drawn as wide as its uncertainty. Events with no conversion to
    the shared axis appear in their own lane, placed by their relative links, labelled "no conversion
    defined". Two events whose links contradict each other are flagged.

### CUJ 9: Move a map through time

*   **Given**: A map whose markers link to entries with founding and destruction dates.
*   **When**: The author drags the time slider.
*   **Then**: Markers appear and disappear according to their entries' time ranges. Markers with unknown
    dates stay visible and are styled as undated.

### CUJ 10: Measure on a world of unknown size

*   **Given**: The Ezob map, with no radius defined.
*   **When**: The author measures between two cities.
*   **Then**: The result is given as an angle and as a fraction of the circumference. Once a radius is
    entered in the map's settings, the same measurement shows a distance.
