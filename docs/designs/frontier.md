# Frontier

*   **Author:** Elad Haviv
*   **Status:** Proposed
*   **Date:** 2026-11-20

--------------------------------------------------------------------------------

## Overview

Frontier is a web app for one author. In it he writes, reads and explores Avalymia, a fantasy multiverse
kept as about 500 Markdown notes in the `elad-haviv/avalymia` GitHub repository. It runs in desktop and
phone browsers and is hosted on the author's own server.

Frontier does five jobs in one place:

1.  **Write and read entries** at the level of Obsidian, the tool used today: wikilinks, backlinks, search,
    images, folders.
2.  **Review changes** proposed by AI and by agents, and approve or reject them before they become canon.
3.  **Explore space**: maps with markers, paths, zones and layers that link to entries, from the
    cosmological map down to a city, including a globe view and reprojection.
4.  **Explore time**: entries carry dates in several calendars, vague dates and relative order; timelines
    show overlaps; maps can show a chosen moment.

5.  **Talk with the world and discover more of it**, with AI: hold conversations about the lore that draw
    on the Hindsight memory bank; talk with characters through profiles built from their entries; and
    wander a map to discover places, characters, creatures and items that are not yet in the lore, then
    edit, approve and add the ones he wants to canon.

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

*   **G13. Lore conversations are grounded and cited.** A lore conversation retrieves from the Hindsight
    bank by association, then reads the actual files, and every claim about canon links to the entry it
    came from. Anything the AI adds beyond canon is marked as invention. Check: in a test conversation,
    each canon claim carries a working link, and a question with no answer in the vault gets "not in the
    lore" and an offer to invent, not an unmarked invention.
*   **G14. Characters speak from a profile the author approved.** A character profile (voice, knowledge,
    beliefs, what the character does not know, the moment in time they speak from) is proposed by AI from
    the character's entries and approved by the author like any other proposal. It is a file in the
    repository, in `99 Appendices/09 Agents/`, where one profile (`Yagon.md`) already exists and is kept
    as the model for the format. Check: a character asked about an event after their time of speaking, or outside their
    knowledge, does not answer as if they knew it.
*   **G15. Discovery produces proposals, never canon.** While the author wanders a map, AI generates
    places, characters, creatures and items that fit the surrounding canon. Each discovery is checked
    against the bank for contradictions, shown with what it was based on, and kept outside the repository's
    `main` branch and outside Hindsight until approved. Approved discoveries become entries, and markers
    where relevant, through the review inbox. Check: an unapproved discovery never appears in search of
    canon, in a lore conversation as fact, or in the bank.
*   **G16. AI spending is capped and visible.** All AI calls go through one key with a monthly limit, and
    the interface shows what each conversation and discovery session cost. Check: calls stop with a clear
    message when the limit is reached.

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
*   **Chat as canon.** What a character or the AI says in a conversation is not lore. Nothing said in chat
    enters canon unless the author turns it into a proposal and approves it. Conversations are kept on the
    server as working material, and can be saved on request as a session log under `99 Appendices`, which
    is where AI session logs already live.
*   **Unprompted generation.** AI does not invent lore in the background or fill gaps on its own. Discovery
    runs only while the author is exploring.
*   **Replacing Hindsight.** The memory bank and its sync agent stay as they are, apart from one change:
    the sync is switched off for formatting-only changes. The bank holds canon only.
*   **Drawing base maps.** Map images are still made in outside tools and imported. Frontier draws markers,
    paths, zones and labels on top of them.
*   **Editing `99 Appendices`.** That folder is append-only by vault rule. Frontier shows it and can add new
    files to it, and cannot edit existing ones.

## Open Questions

None at present.

### Answered by the author

*   **Images in discovery (was Q8).** Yes: a discovery comes with generated concept art. The art is part of
    the proposal and is approved, replaced or dropped with it.

*   **Hindsight sync and formatting changes (was Q1).** The sync is switched off for formatting-only
    changes. A change that touches only frontmatter, whitespace or line endings does not re-ingest the
    note. Adding an `id` or time fields therefore does not churn the bank. The sync agent lives outside
    this repository; changing it is a task in stage 3.
*   **Notes with the same name (was Q2).** The folder structure carries meaning, so two notes with the same
    name are two different things. Frontier identifies an entry by its full path and its `id`, never by
    name alone. The two cases today are a lore entry and a non-lore file: `04 Inhabitants/Archdemons/Yagon.md`
    and the chat profile `99 Appendices/09 Agents/Yagon.md`; the live `Common Ezobian.md` and a copy in the
    recycle bin. A link written as a bare name resolves to the note outside `99 Appendices` when exactly
    one candidate is outside it. If more than one lore note shares the name, the link is shown as
    ambiguous and the author picks; Frontier then writes the link with its path.
*   **Existing map file (was Q3).** `99 Appendices/06 Interactive Maps/Main.json` is replaced by the map
    format defined in this document.
*   **Marker icons (was Q4).** The Skyrim icon set already in the vault is the first marker set. Frontier
    has marker set management: several sets can exist side by side, each a folder of icons with a
    manifest, and each map chooses which sets it uses. New sets are added later. Note: the Skyrim icons
    belong to a commercial game, so an export meant for the public needs a different set selected.
*   **Export targets (was Q5).** Three kinds beyond plain files: styled web pages, presentations, and map
    renders (an image of a map as currently shown, with its markers, layers and chosen moment in time).
    Markdown, docx, PDF and JSON remain.
*   **Access to Hindsight (was Q6).** Frontier connects to the bank itself. A settings screen holds the
    bank address, bank name and access key, with a "test connection" button and the limits applied. The
    same screen holds the AI provider key, model choices and the monthly spending cap.
*   **Discovered material and the bank (was Q7).** Only canon is registered in the bank. Discoveries,
    proposals, drafts and chats are never sent to it. A discovery stays in Frontier's own store until the
    author approves or rejects it; it reaches the bank only by becoming a published entry.

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
*   **Then**: The proposal appears as a chip on the entry, in the inbox, and on the timeline as an
    unconfirmed event in a distinct style, with the source sentence highlighted. Publishing was not blocked. He accepts with one tap, the field is added to the entry's
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
    Events that come from unconfirmed AI proposals are drawn outlined; one switch hides them.

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

### CUJ 11: Ask the lore a question

*   **Given**: The author opens a lore conversation on his phone.
*   **When**: He asks how the Nirani keep time and what else in the setting relates to it.
*   **Then**: The answer quotes the relevant entries with links, and lists associated entries the bank
    surfaced that he did not ask about. A follow-up about something the vault does not cover gets "this
    is not in the lore", with an offer to draft a proposal. If he accepts, the draft goes to the review
    inbox, not into the vault.

### CUJ 12: Talk with a character

*   **Given**: A character has several entries but no profile.
*   **When**: The author chooses "talk with" on the character's entry.
*   **Then**: Frontier proposes a profile built from the entries, with each trait linked to its source and
    gaps marked as unknown. He edits and approves it, and it is saved as a file. The chat then opens. The
    character answers in voice, from the moment in time set in the profile, and does not know what happened
    later. When the character says something that is not in canon, the line is marked as improvised. He
    can select any line and send it to the inbox as a proposed addition to the character's entry.

### CUJ 13: Wander and discover

*   **Given**: The map of a continent is open, with an empty stretch of coast between two known cities.
*   **When**: The author switches to explore mode and taps the coast.
*   **Then**: Frontier describes what is found there, drawing on the nearby entries, the region's cultures
    and the era selected on the time slider, and proposes one or more discoveries: a fishing settlement, a
    creature, a named local. Each shows what canon it was based on and any contradiction found. Discoveries
    appear on the map as provisional markers in a distinct style. He edits the settlement, approves it and
    discards the rest. The settlement's concept art was generated when he opened it; he regenerates it once
    in a different predefined style and keeps the second image. The settlement becomes a draft entry with a marker, and enters canon at the next
    Publish.

## Technical Plan (Architecture)

### Decisions made by the author

| Decision | Choice | Consequence accepted |
| --- | --- | --- |
| Working state | Files only, no database: an in-memory index; drafts, chats and settings as files on the server disk; AI proposals and discoveries as branches in the `avalymia` repo | Every query is hand-built on the in-memory index. Unapproved invented material sits in the canon repo, on branches. Heavy exploring creates many branches. |
| Agent proposals | Agents push branches; Frontier lists them and commits what is approved | `AGENTS.md` and each agent's instructions must change. |
| Map drawing | Custom renderer built on the `map-reprojector` maths | The map stage is the largest in the project. Pan, zoom, touch, hit testing, labels, tiling and drawing tools are all built here. |
| Deployment | One container: Fastify serves the API and the built React app | Every interface change restarts the server. |

### Shape of the system

```text
 Browser (desktop / phone)                      Server: one container on Coolify
+----------------------------------+           +------------------------------------------------+
| React app                        |   HTTPS   | Fastify                                        |
|  Reader / Editor (CodeMirror 6)  | <-------> |  API + serves the built React app              |
|  Review inbox                    |   + SSE   |                                                |
|  Map renderer (WebGL + canvas)   |           |  Vault service --- Git gateway --+             |
|  Timeline                        |           |   parse, links,    pull, commit, |             |
|  Chat / Explore                  |           |   rename           push, branches|             |
|  Draft buffer (IndexedDB)        |           |                                  v             |
+----------------------------------+           |  Index            /data/vault  (Git clone)     |
                                               |  (in memory)      /data/state  (drafts, chats) |
                                               |                   /data/assets (tiles, thumbs) |
                                               |  AI service ----> OpenRouter                   |
                                               |              \--> Hindsight `worldbuilding`    |
                                               +------------------------|-----------------------+
                                                                        | push / fetch
   Obsidian (obsidian-git) ---- push main ----> GitHub: elad-haviv/avalymia <---- agents push branches
                                                        ^--- Frontier pushes main and frontier/* branches
                                                        |
                                                        +-- webhook --> Frontier (fetch, reindex)
                                                        +-- webhook --> Hindsight sync (main only)
```

One persistent disk is mounted at `/data`. It holds the Git working copy of `avalymia`, a folder of
working files and derived assets. There is no database. Losing the disk loses unpublished drafts, chats,
the cost log and settings. It does not lose canon, and it does not lose pending proposals or discoveries,
because those are branches on GitHub.

### Where each kind of data lives

| Data | Home | In Hindsight |
| --- | --- | --- |
| Entries (Markdown, frontmatter fields) | `avalymia` repo, existing folders | Yes, on push to `main` |
| Calendars, maps, marker set manifests, art styles, field schema | `avalymia` repo, `.frontier/` | No (not `.md`) |
| Character chat profiles | `avalymia` repo, `99 Appendices/09 Agents/` | As today |
| Saved chat logs (on request) | `avalymia` repo, `99 Appendices/04 AI Conversations/` | As today |
| Existing images | `avalymia` repo, unchanged | No |
| New large map images | `/data/assets/originals`, with a manifest in `.frontier/assets.json` | No |
| Index: links, backlinks, search text, parsed fields | Server memory, rebuilt from the repo at start | No |
| Drafts, chats, cost log, AI result cache, settings | Files in `/data/state` | No |
| Agent proposals | Branches `proposal/...` in the `avalymia` repo | No (not `main`) |
| Frontier's own AI proposals and discoveries | Branches `frontier/...` in the `avalymia` repo | No (not `main`) |
| Tiles, thumbnails | `/data/assets`, regenerated from originals | No |
| Generated concept art, until approved | `/data/assets/generated` | No |

`.frontier/` is a dot-folder, so Obsidian does not show it and the Hindsight sync, which reads `.md` files,
does not ingest it.

**One exception to goal G1.** New large map images are kept outside Git, so a fresh clone alone does not
restore them. The manifest in the repo records each image's name, size and content hash, and `/data/assets/originals`
must be included in the server backup. Everything else in G1 holds.

### Git gateway

One module owns every Git operation. Nothing else touches the working copy.

*   **Fetch.** A GitHub webhook on the `avalymia` repo calls Frontier on every push. Frontier fetches,
    fast-forwards its copy of `main` when it has no local commits, and reindexes the changed files. A timer
    fetches every few minutes in case a webhook is missed.
*   **Drafts are not commits.** A draft is a pair of files in `/data/state/drafts`: the full text, and a
    small record with the file path and the Git blob hash of the version it was based on. Renames, moves, creations and deletions are draft operations too.
*   **Publish.** The author selects drafts (all by default) and writes a message. Frontier fetches; for each
    draft it compares the base hash with the file now on `main`. If none differ, it writes the files, makes
    one commit and pushes. If the push is rejected because `main` moved meanwhile, it repeats once from the
    fetch. It never force-pushes and never rewrites history.
*   **Conflict.** If a file changed on `main` since the draft was started, that draft is not published.
    The interface shows both versions side by side with differences marked. The author edits his draft into
    the merged result and confirms, which resets its base hash.
*   **Credential.** A fine-grained GitHub token limited to the `avalymia` repo, held in a server environment
    variable.
*   **Commit identity.** Commits carry the author's name. Commits that include approved AI content add a
    trailer naming the model and the proposal.

### Vault service

*   **Parsing.** Entries are read as text. Frontmatter is parsed with a YAML library that keeps the original
    document, so changing one key rewrites only that key's lines. Unknown keys, key order, comments and line
    endings (18 files use CRLF) are preserved. The body is never re-serialised: the editor edits the text
    itself, which satisfies goal G2 by construction.
*   **Link resolution.** Rules, in order: a link with a path resolves to that path; a bare name matches a
    note name or a declared alias, ignoring case and surrounding spaces; among several matches, the one
    outside `99 Appendices` wins when it is the only one outside; otherwise the link is ambiguous. Heading
    links resolve to a heading in the target, or in the same note when no target is given. Image embeds
    resolve by bare file name across the vault; the 11 duplicated image names resolve to the nearest folder
    and are listed for the author. The resolver runs over the real vault in a test with a checked-in
    baseline (goal G4).
*   **Rename and move.** Renaming rewrites every link that pointed to the old name or path, as draft changes
    to those files, published together in one commit. Folder notes (a note named after its folder, 77
    today) move with their folder.
*   **Entry identity.** Each entry gets an `id` in frontmatter, a short random string that never changes.
    Maps, timelines, proposals and profiles refer to entries by `id`. Ids are added when an entry is first
    edited or referenced, and in one planned batch commit before stage 4. The Hindsight sync is switched off
    for formatting-only changes first, so the batch does not re-ingest the bank.
*   **Append-only guard.** Existing files under `99 Appendices` cannot be drafted. New files can be added.

### Index and working files

*   **Index.** Held in server memory and built at start by reading the working copy: entries, links,
    aliases, headings, parsed fields, time intervals and relations, map features by entry, and a full-text
    search index. It is updated file by file after each fetch, publish or draft save. A rebuild takes
    seconds at 500 notes. Nothing in it is saved, so it cannot go stale across restarts. Timeline overlap
    and "which markers are visible at this moment" are functions over these in-memory structures, written
    and tested in `packages/time` and `packages/geo`.
*   **Working files** in `/data/state`, all plain JSON or Markdown:
    *   `drafts/`: unpublished text and its base record.
    *   `chats/`: one file per conversation or character session.
    *   `ai-log/`: one line per AI call with tokens and cost, a file per month.
    *   `ai-cache/`: field-proposal results by content hash.
    *   `settings.json`: model choices, spending cap, Hindsight address, the password hash, and the AI and
        Hindsight keys encrypted with a key from an environment variable. Secrets are never sent to the
        browser.
*   Files are written by writing a temporary file and renaming it, so a crash cannot leave half a file.
    One server process is the only writer.
*   `/data/state`, `/data/assets/originals` and `/data/assets/generated` are copied to a backup location
    nightly. They are the only data not recoverable from GitHub.
*   **Limit accepted.** There is no query language. Each new kind of question about the data needs a
    function written for it. If the vault grows past several thousand entries, or start-up indexing passes
    a few seconds, the index is the part to revisit.

### Reader and editor

*   **Editor**: CodeMirror 6 editing the Markdown source, with live preview that hides the syntax of the
    line the cursor is not on, as Obsidian does. Extensions: wikilink autocomplete over names, aliases and
    headings; click-to-follow; create from unresolved link; table editing; image paste and upload to
    `99 Appendices/01 Images`; a properties panel for frontmatter.
*   **Reader**: rendered Markdown with hover previews, backlinks, outline, and panels "appears on maps" and
    "on timeline" that come from the index.
*   **Drafts**: typing saves to the browser's IndexedDB at once and to the server about a second later.
    With no connection, text stays in the browser and is sent when the connection returns. Each entry shows
    one of: published, unpublished, conflict, waiting to send.
*   **Images**: the server returns resized versions by requested width and caches them on disk. Originals
    up to 9 MB are never sent to a phone unless opened at full size.
*   **Phone layout**: a bottom bar with search, entries, maps, inbox and chat; a toolbar above the keyboard
    with link, heading, list and image buttons.

### Review inbox and proposals

Three sources, one inbox:

1.  **Agent branches.** Any branch in `avalymia` other than `main` is listed as a proposal: its name, the
    commit messages, and each changed file as a readable difference against `main`. The author accepts,
    edits or rejects per file. Accepting writes the accepted versions as drafts and publishes them as one
    commit on `main`. The branch is deleted when every file is decided. `AGENTS.md` changes to: agents push
    to a branch named `proposal/<agent>/<topic>` and never to `main`.
2.  **Frontier's own AI.** Field proposals, drafted entries, profile proposals and lines sent from chat
    are pushed as branches named `frontier/proposal/<id>`. One run (for example the field proposals after
    one Publish) is one branch. The branch holds the proposed file changes, plus a record file
    `.frontier/proposals/<id>.json` with the source text each change was based on and the model used.
3.  **Discoveries.** One exploring session is one branch, `frontier/discovery/<date>-<n>`, however many
    discoveries it produced. This keeps the branch count to one per session. Each discovery is a draft
    entry file, with a record of its position, the canon it drew on and the result of the contradiction
    check. Rejecting a discovery removes its file from the branch. Sessions with nothing left are deleted.

Record files exist only on proposal and discovery branches and are left out when accepted content is
committed to `main`.

Accepting any proposal copies the accepted files into drafts. Nothing reaches `main` except through
Publish. This is the single
code path that goal G8 tests.

`main` is not protected in GitHub, because Obsidian pushes to it directly. An agent that pushes to `main`
against the rule is therefore not blocked. Frontier lists any commit on `main` that it did not create and
that Obsidian did not author as "arrived unreviewed", so the breach is visible.

### Structured fields

Fields live in the entry's frontmatter as readable text, so the note still reads sensibly in Obsidian.
Illustrative shape, to be fixed in the stage 3 and stage 5 designs:

```yaml
id: k3f9x2ab
aliases: [The White City]
type: settlement            # optional; otherwise taken from the folder
time:
  - what: founded
    when: "c. 340 EM"
  - what: destroyed
    when: "after [[The Nirani Exodus]], within a generation"
```

A schema file, `.frontier/schema.yaml`, lists field names, the allowed `what` values per entry type, and a
version number. Changes to the schema are scripted, reviewed commits.

### Time

*   **Calendar definitions** are files in `.frontier/calendars/`, one per calendar, each linked to its lore
    note. A definition lists eras, units, month names and lengths, and leap rules. A leap rule may be
    "unspecified" or a list of leap years the author declares. The Ezob calendar's nameless month is a
    month with an empty name.
*   **Stored form.** Each `when` keeps the author's text. The parser turns it into an interval, earliest to
    latest, in that calendar's own units, at the precision given: day, month, year, era, or open-ended.
    Text the parser cannot read is kept and marked unparsed.
*   **Relations.** "Before", "after", "during", "at the same time as", with an optional gap, are links
    between dated things. A solver narrows intervals along these links and reports cycles and impossible
    combinations as contradictions. It never changes a field.
*   **Common axis.** A calendar may declare an anchor (one of its dates equals a pulse count) and a rate
    (pulses per unit). A plane may declare a table of rates over time for dilation. Only calendars with
    both can be placed on one axis; a conversion gives a range and is labelled derived. Calendars without
    them are shown in their own lane, ordered by relations.
*   **Views**: timeline with lanes by place, culture or entry type, each event drawn as wide as its
    interval; an overlap view for a chosen span; a list of contradictions.
*   **Unconfirmed proposals in views.** Timelines and time-aware maps also show time fields that AI has
    proposed and the author has not yet decided. The index reads them from the `frontier/proposal`
    branches and keeps them apart from confirmed fields. They are drawn in a distinct style (outlined, not
    filled, with a marker), can be hidden with one switch, and never take part in contradiction reports or
    in narrowing confirmed intervals. Tapping one shows the source sentence with confirm, edit and reject.
    Confirming writes the field into a draft of the entry. Lore conversations, character chat and
    discovery read confirmed fields only.

### Maps

*   **Map files** are JSON in `.frontier/maps/`, one per map, with a format version. A map has: a title; a
    coordinate space; one or more source images with their extent and projection; layers; features; and
    links to child maps.
*   **Coordinate spaces.** `sphere`: longitude and latitude, radius optional. `cylinder`: angle, height and
    layer number, for Derdama. `flat`: x and y in the image's own units, with an optional scale. `schematic`:
    x and y with no measuring. Each space supplies its own distance and area functions, or none.
*   **Features** are GeoJSON points, lines and polygons in the map's space. A feature may carry an entry
    `id`, a marker set and icon, a style, a label, and a link to a child map. It carries no dates: when it
    is visible comes from its entry's time interval. A path may list several positions with entry events,
    which gives movement.
*   **Marker sets** are folders of icons with a manifest in `.frontier/marker-sets/`. The first set points
    at the Skyrim icons already in `99 Appendices/07 Icons/Skyrim`. A map selects the sets it uses.
*   **Renderer.** A package of pure functions holds the projections and inverse projections, taken from
    `map-reprojector` (`projections.ts`, `reprojection.worker.ts`, `pixelMapper.ts`) and extended with the
    cylinder and flat spaces. The view is drawn in WebGL: for each screen pixel the shader computes which
    point of the map's space is shown there and reads the colour from the source image, which the server
    has cut into a pyramid of tiles in the image's own projection. Markers, paths, zones and labels are
    projected on the processor and drawn on a canvas above. Pan, zoom, rotate, pinch, hit testing, label
    placement and the drawing and measuring tools work in space coordinates, so they behave the same in
    every projection, including the globe.
*   **Order of building**, because this stage is the largest: flat space with markers first; then sphere in
    equirectangular and globe views; then paths, zones, layers and measuring; then cylinder and schematic;
    then the remaining projections. The stage 4 design sets a frame-rate target on a mid-range phone and a
    fallback (lower-resolution tiles while moving) before any drawing tool is built.
*   **Risk accepted.** No existing library is used for interaction or drawing. If phone performance or the
    volume of work blocks later stages, the fallback is to ship flat and globe views only and defer the rest.

### AI service

*   **Provider.** All model calls go through one interface to OpenRouter, with model names per task
    (extraction, conversation, character, discovery) set in the settings screen. Every call is appended to the cost log
    with tokens and cost. A monthly cap stops calls with a clear message.
*   **Hindsight.** A client for the `worldbuilding` bank, configured in settings (address, bank name, key,
    test button). Frontier only reads from the bank. It never writes to it; the bank is fed by the existing
    sync from `main`.
*   **Grounding.** For lore questions and contradiction checks: recall from the bank, then read the actual
    files for the entries recalled, then answer from the file text. Claims cite entries by `id`, which the
    interface shows as links. This follows the vault rule that lore is never quoted from the bank.
*   **Field proposals.** Run on Publish for the changed entries, or on request, against the changed text
    and the schema. Results are cached on disk by content hash. `99 Appendices` and `.frontier/` are excluded.
*   **Character chat.** The system prompt is built from the approved profile file and the character's
    entries. The profile states the moment the character speaks from; entries and events dated after it
    are left out of the context.
*   **Discovery.** Input: the tapped position, nearby features and their entries, the region's cultures,
    the selected moment. Output: structured candidates (kind, name, description, position, the entries it
    drew on). Each candidate is checked against the bank and files before it is shown.
*   **Concept art.** A discovery gets one generated image, made through the same provider interface with an
    image model chosen in settings. The prompt is built from the discovery's description, the visual
    details of the entries it drew on, and an art style. A setting chooses when art is made: for every discovery, only when
    the author opens one (the starting value), or never. Image calls count toward the monthly cap and are
    priced in the cost log; they are expected to be the largest part of discovery cost. Unapproved art is
    kept in `/data/assets/generated`, not on the discovery branch, so rejected images never enter Git
    history. On approval the image is added to `99 Appendices/01 Images` and embedded in the new entry, in
    the same Publish. The author can regenerate or remove the image before approving.
*   **Art styles.** The author defines styles in a settings screen. A style has a name, a style
    description that is added to every prompt, things to avoid, optional reference images, an image model,
    and an aspect ratio. Styles are files in `.frontier/art-styles/` in the vault, so they are versioned
    with the rest of his work; reference images follow the same rule as other new images. A default style
    can be set per kind of discovery (place, character, creature, item) and overridden per map. When
    generating or regenerating, the author can pick any style. The style used is recorded with the image.
*   Stage 8 gets its own design, including prompts, context limits and the marking of improvised lines.

### Login and security

*   One account. Password stored as an argon2id hash; a signed session cookie that is HTTP-only, secure
    and same-site, so no session store is needed. Login attempts are rate-limited. Passkeys can be added later.
*   The GitHub token, AI key and Hindsight key stay on the server.
*   Webhook calls from GitHub are verified by their signature.

### Seeing failures

*   A status area shows: unpublished drafts, last fetch and push, a failed push, index built from which
    commit, agent branches waiting, AI spend this month, and Hindsight reachability.
*   The server pushes status changes to the browser over server-sent events.
*   `/health` reports the same facts for Coolify's health check.

### Export

Stage 9 gets its own design. The planned mechanisms: Pandoc in the container for docx and PDF; styled web
pages generated from selected entries with a theme; presentations as HTML slide decks and, through Pandoc,
pptx; map renders produced by the same renderer at a chosen size, moment and projection.

### Code layout

A single repository, `elad-haviv/frontier`, with workspaces:

```text
apps/server      Fastify API, Git gateway, index, AI service, static file serving
apps/web         React app: reader, editor, inbox, maps, timeline, chat
packages/vault   Markdown and frontmatter parsing, link resolution, rename (used by server and web)
packages/time    Calendar definitions, date parsing, intervals, relation solver
packages/geo     Coordinate spaces, projections, measuring (from map-reprojector)
packages/schema  Shared types and validators for API and file formats
```

`packages/vault`, `packages/time` and `packages/geo` have no dependency on the server or the browser, so
they are tested against the real vault on their own.

### Changes outside this repository

1.  `avalymia/AGENTS.md`: agents push to `proposal/<agent>/<topic>` branches, never to `main`. Branches
    under `frontier/` hold unapproved, partly invented material and are never to be read as canon.
2.  Hindsight sync agent: skip changes that touch only frontmatter, whitespace or line endings.
3.  `avalymia`: add the `.frontier/` folder; later, one batch commit adding `id` to every entry.
4.  GitHub: a webhook from `avalymia` to Frontier, and a fine-grained token.
5.  `99 Appendices/06 Interactive Maps/Main.json` is removed when the first map file exists. This is the
    one edit to an appendix file, approved by the author in the open questions.

## Alternatives Considered

### From the brainstorm

#### Hosted worldbuilding tools (World Anvil, LegendKeeper, Kanka)

*   **Pros**: Maps, timelines and wikis exist today with no build effort.
*   **Cons**: Data lives in the vendor's storage. No cross-calendar overlap, no time dilation, no approval
    flow for AI, no link to Hindsight.
*   **Reason for Rejection**: Rejected by author: he wants a custom tool, and these do not keep Markdown in
    Git as canon.

#### Staying on Obsidian with plugins

*   **Pros**: No new app. The Leaflet, timeline and calendar plugins cover simple cases.
*   **Cons**: No overlap across calendars, no maps that change with time, no review inbox, weak on a phone.
    The installed Leaflet plugin was never used.
*   **Reason for Rejection**: Rejected by author: plugins do not cover cross-calendar overlap or time-aware
    maps.

#### Frontier as a reading companion first, editor later

*   **Pros**: The first release would deliver what Obsidian lacks (a timeline or a map) and skip the hardest
    part, an editor good enough to replace Obsidian.
*   **Cons**: Two tools in daily use for longer. Writing stays outside the app.
*   **Reason for Rejection**: Rejected by author: the app must contain everything, with the editor in the
    first usable release.

#### Canon in Frontier's own database

*   **Pros**: Fast queries, easy structured fields, no Git handling.
*   **Cons**: Breaks the Hindsight sync, Obsidian access, Git history and the agents' workflow.
*   **Reason for Rejection**: Rejected by author: GitHub stays the source of truth.

#### Time data on maps, or map data on entries

*   **Pros**: Everything about a place in one file.
*   **Cons**: Entries fill with coordinates and styling. The same time facts are kept twice and drift apart.
*   **Reason for Rejection**: Rejected by author: maps are standalone and refer to entries; entries carry
    time.

#### Mandatory conversion between calendars

*   **Pros**: One shared axis for every event. Simple timeline maths.
*   **Cons**: Needs canon numbers that do not exist (pulse rates, anchors, leap rules) and would force them
    to be invented before any date could be stored.
*   **Reason for Rejection**: Rejected by author: dates stay in their own calendar and convert only on
    request, where numbers exist.

#### Each autosave is a commit

*   **Pros**: No draft storage. Every keystroke is in Git.
*   **Cons**: Floods the history, breaks the vault rule of one logical change per commit, and triggers a
    Hindsight ingestion of half-written text on every pause.
*   **Reason for Rejection**: Rejected in Goldfish review (six of seven reviewers); the author proceeded on
    that basis.

#### A block-style WYSIWYG editor (TipTap, BlockNote, Milkdown)

*   **Pros**: A polished writing surface with little effort.
*   **Cons**: These convert Markdown to their own model and write it back in their own style, changing lines
    the author did not touch. That breaks goal G2 and triggers needless re-ingestion.
*   **Reason for Rejection**: Rejected in Goldfish review; the author proceeded on that basis.

#### Embedding the `map-reprojector` app as it is

*   **Pros**: Reprojection available at once.
*   **Cons**: Its interface is tied to mouse and keyboard, has no touch input, no tests, and assumes a
    full-globe image.
*   **Reason for Rejection**: Rejected in Goldfish review: only its projection maths is reused. The author's
    later choice of a custom renderer builds on that maths.

### From drafting

#### Working state in Postgres or SQLite

*   **Pros**: A query language, transactions, built-in full-text search. Postgres matches the author's
    other apps.
*   **Cons**: Postgres is a second service to run and back up. SQLite ties data to one file and one
    process. Both hold pending proposals only on the server.
*   **Reason for Rejection**: Rejected by author: he first chose SQLite, then changed to files only, with
    proposals and discoveries as branches.

#### All working files on the server, or in a second private repository

*   **Pros**: Server-only keeps the canon repo free of invented material. A second repository gives history
    and an off-server copy.
*   **Cons**: Server-only loses pending proposals and discoveries with the disk. A second repository adds
    another set of Git operations and many small autosave commits.
*   **Reason for Rejection**: Rejected by author: drafts, chats and settings on the server disk; AI proposals
    and discoveries as branches in `avalymia`.

#### Agents submit proposals to a Frontier endpoint

*   **Pros**: One inbox and one format for every proposal. No branches in the repo.
*   **Cons**: Every agent needs access to the author's server and a tool for it; agents in restricted
    networks cannot reach it.
*   **Reason for Rejection**: Rejected by author: agents push branches.

#### Agents keep pushing to `main`, reviewed afterwards

*   **Pros**: No change for the agents.
*   **Cons**: Unreviewed text is canon and in Hindsight before the author sees it, which contradicts goal G8.
*   **Reason for Rejection**: Rejected by author: agents push branches.

#### MapLibre GL

*   **Pros**: Fast, good touch handling, flat and globe views from the same data, drawing add-ons exist.
*   **Cons**: Knows only Mercator and globe. World images must be re-cut to Mercator, the poles are cut off
    in the flat view, and other projections stay a separate tool.
*   **Reason for Rejection**: Rejected by author: custom renderer.

#### Leaflet with a separate view-only globe

*   **Pros**: The shortest path to working flat maps, with a mature drawing plugin.
*   **Cons**: Two renderers to keep in agreement. No editing on the globe. Slows with thousands of markers.
*   **Reason for Rejection**: Rejected by author: custom renderer.

#### Interface and API as two deployments, or Next.js

*   **Pros**: Two deployments keep interface changes from restarting the data server. Next.js gives
    server-rendered pages that load fast on a phone.
*   **Cons**: Two deployments need cross-domain login and version matching. Next.js fits long Git, AI and
    tiling work poorly.
*   **Reason for Rejection**: Rejected by author: one container.

--------------------------------------------------------------------------------

## Non-Functional Requirements

### Security and privacy

*   The server holds a token that can push to canon, so the whole app is behind login. No page or API route
    is public except the login page, the GitHub webhook (signature-checked) and `/health` (no content).
*   Vault text is sent to OpenRouter models and to the self-hosted Hindsight bank, and nowhere else. The
    settings screen lists which models receive text.
*   Secrets are encrypted at rest and never reach the browser.
*   Text from the vault and from agent branches is treated as data, never as instructions, in every AI
    prompt.

### Performance

*   Server start, including the index build over 500 notes: under 5 seconds.
*   Entry page on a phone over 4G: under 2 seconds, with resized images.
*   Typing: no visible lag in a 50,000-word note (the largest file in the vault is the compiled book).
*   Search results while typing: under 100 ms.
*   Map frame rate target and tile sizes: set in the stage 4 design.

### Cost

*   AI spend is capped monthly. Field proposals use a small model. Image generation is the largest cost and
    is made on opening a discovery unless the author changes the setting.
*   Hindsight ingestion cost stays as today: one ingestion per published note, none for formatting-only
    changes, none for branches.

### Rollout and rollback

*   Stages 1 and 2 change nothing in the vault except adding `.frontier/`. Obsidian keeps working
    throughout.
*   The `id` batch commit and the `AGENTS.md` change come with stage 3 and are ordinary commits that can be
    reverted.
*   Rollback at any time: stop the container. The vault, with all published work, is intact in GitHub and
    opens in Obsidian. Unpublished drafts and chats are in the `/data/state` backup as plain files.

### Backup

*   Nightly copy of `/data/state`, `/data/assets/originals` and `/data/assets/generated` to a second
    location. A restore is tested once before stage 2 is called done.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

This plan covers stage 1 (foundation) and stage 2 (reader and editor). Stages 3 to 9 each get their own
design document under `docs/designs/` before they are built.

### Tooling decisions (mechanical)

*   Node 22, TypeScript in strict mode, npm workspaces.
*   Server: Fastify. Git through the `git` program, called from one module. YAML through the `yaml`
    package's document interface, which keeps untouched lines as they were. Image resizing with `sharp`.
    Password hashing with `argon2`.
*   Web: React 19 with Vite, React Router, CodeMirror 6, `unified`/`remark` for the read-only rendering,
    MiniSearch for full-text search (the index is built on the server and queried there).
*   Tests: Vitest for packages and server, Playwright for the browser at desktop and 375 px phone sizes.
*   Lint and format: ESLint and Prettier. Prettier is never run on vault files.

### Target Files to Create/Modify

Paths are relative to the `frontier` repository unless they start with `avalymia/`.

#### Repository root

1.  `package.json` (Create). Workspace list, shared scripts (`build`, `test`, `lint`, `dev`, `e2e`), Node
    version. Needed so one command builds and tests every package.
2.  `tsconfig.base.json` (Create). Strict compiler settings shared by all packages.
3.  `eslint.config.js`, `.prettierrc`, `.prettierignore` (Create). One style for the codebase; the ignore
    file excludes fixtures that copy vault text.
4.  `.gitignore`, `.dockerignore` (Create). Keep `node_modules`, builds, `/data` and env files out of Git
    and out of the image.
5.  `.env.example` (Create). Lists the environment variables with no values: `GITHUB_TOKEN`, `VAULT_REPO`,
    `WEBHOOK_SECRET`, `SETTINGS_KEY`, `SESSION_SECRET`, `DATA_DIR`, `PUBLIC_URL`.
6.  `Dockerfile` (Create). Two steps: build all workspaces; then a slim Node image with `git` installed, the
    server build, the web build, and `/data` declared as a volume. Runs as a non-root user.
7.  `README.md` (Modify). Replace the one-line file with: what Frontier is, how to run it locally against a
    vault checkout, how to deploy on Coolify, how to restore from backup.
8.  `concepts_brief.md` (Delete, after the design is saved). Its content is carried into the design.
9.  `design_draft.md` (Delete, after it is saved as `docs/designs/frontier.md`).
10. `docs/designs/frontier.md` (Create). This document, final.
11. `docs/designs/SITEMAP.md` (Create). Index of design documents, starting with this one, so later stage
    designs are registered in one place.
12. `.github/workflows/ci.yml` (Create). On every push: install, lint, type-check, unit tests, build,
    Playwright tests against the fixture vault. Needed so goals G2 and G4 are checked on every change.

#### `packages/schema` (shared types and validators)

13. `packages/schema/package.json`, `tsconfig.json` (Create). Package setup.
14. `packages/schema/src/api.ts` (Create). Types and validators for every API request and response in
    stages 1 and 2 (entries, drafts, publish, search, status, login). One definition used by server and
    web so they cannot drift.
15. `packages/schema/src/status.ts` (Create). The sync status shape: last fetch, last push, unpublished
    count, conflicts, index commit, failed push.
16. `packages/schema/src/index.ts` (Create). Exports.

#### `packages/vault` (parsing, links, rename; no server or browser code)

17. `packages/vault/package.json`, `tsconfig.json` (Create). Package setup.
18. `packages/vault/src/frontmatter.ts` (Create). Split a note into frontmatter and body without changing
    either; read keys; set or remove one key while leaving every other line, the key order, comments and
    line endings as they were. Serves goal G2.
19. `packages/vault/src/links.ts` (Create). Find every wikilink and embed in a note with its exact
    position: target, path part, heading part, display text, embed flag. Also standard Markdown image
    links with angle-bracket paths.
20. `packages/vault/src/resolve.ts` (Create). The resolution rules from the Technical Plan: path links,
    bare names against note names and aliases ignoring case and surrounding spaces, the `99 Appendices`
    tie-break, ambiguity, heading links, image embeds by bare name. Returns resolved, unresolved or
    ambiguous with candidates. Serves goal G4.
21. `packages/vault/src/rename.ts` (Create). Given a rename or move, produce the edited text of every note
    whose links must change, touching only the link characters. Handles folder notes and folder moves.
22. `packages/vault/src/paths.ts` (Create). Path rules: which files are entries, which folders are excluded
    (`.obsidian`, `.claude`, `.gemini`, `.frontier`), which are append-only (`99 Appendices`), entry type
    from the top-level folder.
23. `packages/vault/src/headings.ts` (Create). Extract headings for the outline and for heading links.
24. `packages/vault/src/index.ts` (Create). Exports.
25. `packages/vault/test/fixture-vault/**` (Create). A small made-up vault, about 20 notes, containing one
    of every case found in the real vault: aliased links, heading links, path links, case-only matches,
    padded links, unresolved links, two notes with one name, embeds, a CRLF file, a note with unknown
    frontmatter keys, a folder note, an appendix file. No real lore.
26. `packages/vault/test/frontmatter.test.ts` (Create). Round trip of every fixture note is byte-identical;
    setting one key changes only that key's lines; CRLF survives.
27. `packages/vault/test/links.test.ts`, `resolve.test.ts`, `rename.test.ts` (Create). One test per rule and
    per case in the fixture.
28. `packages/vault/test/real-vault.test.ts` (Create). Runs only when `VAULT_PATH` is set. Round-trips every
    note in the real vault and expects no change (G2). Resolves every link and compares with the baseline
    (G4).
29. `packages/vault/test/baseline/links.json` (Create). The resolved, unresolved and ambiguous link lists
    for the real vault at a recorded commit, generated by a script and reviewed by the author once.
30. `scripts/make-link-baseline.ts` (Create). Regenerates the baseline from a vault checkout and prints what
    changed, so a baseline update is a reviewed diff.

#### `apps/server`

31. `apps/server/package.json`, `tsconfig.json` (Create). Package setup.
32. `apps/server/src/main.ts` (Create). Starts Fastify, loads configuration, opens the working copy, builds
    the index, registers routes, serves the web build.
33. `apps/server/src/config.ts` (Create). Reads and validates environment variables; fails at start with a
    clear message if one is missing.
34. `apps/server/src/git/gateway.ts` (Create). The only module that runs Git: clone on first start, fetch,
    fast-forward, read a file at `main`, blob hash of a file, commit a set of file changes with a message,
    push, detect rejection. A lock makes operations run one at a time. Never passes `--force`.
35. `apps/server/src/git/webhook.ts` (Create). Route for GitHub push events: checks the signature, then
    asks the gateway to fetch and the index to update.
36. `apps/server/src/git/poll.ts` (Create). Timer that fetches every few minutes in case a webhook is missed.
37. `apps/server/src/state/files.ts` (Create). Safe file writing for `/data/state`: write to a temporary
    name, then rename. JSON read and write helpers.
38. `apps/server/src/state/drafts.ts` (Create). Create, read, update, delete and list drafts; each draft is
    a text file plus a record with path, base blob hash, kind (edit, create, delete, rename) and time.
39. `apps/server/src/state/settings.ts` (Create). Read and write `settings.json`; stage 1 holds only the
    password hash. Encryption helper for secrets added in later stages.
40. `apps/server/src/index/build.ts` (Create). Reads the working copy into memory: entries, aliases,
    headings, links with resolution, backlinks. Applies drafts on top so the author sees his unpublished
    state. Updates one file at a time on change.
41. `apps/server/src/index/search.ts` (Create). MiniSearch index over titles, aliases, headings and body;
    query function returning entries with a snippet.
42. `apps/server/src/publish/publish.ts` (Create). The Publish flow from the Technical Plan: fetch, compare
    base hashes, write files, one commit, push, one retry on rejection, mark conflicts.
43. `apps/server/src/publish/conflict.ts` (Create). Builds the data for the conflict screen: the draft, the
    base version and the current `main` version of a file.
44. `apps/server/src/images/serve.ts` (Create). Serves a vault image resized to a requested width, cached
    under `/data/assets/thumbs` by content hash and width; detects the real file type from content
    (`ezob-satellite.png` is a JPEG).
45. `apps/server/src/images/upload.ts` (Create). Accepts an image, stores it as a draft file creation under
    `99 Appendices/01 Images`, returns the embed text.
46. `apps/server/src/auth/password.ts` (Create). Hash and verify with argon2id.
47. `apps/server/src/auth/session.ts` (Create). Signed session cookie, login rate limit, a guard that
    rejects every route except login, webhook and health.
48. `apps/server/src/status/status.ts` (Create). Gathers the status facts and sends changes to browsers over
    server-sent events.
49. `apps/server/src/routes/auth.ts` (Create). Login, logout, current session.
50. `apps/server/src/routes/entries.ts` (Create). List the folder tree; read an entry (text, resolved links,
    backlinks, headings, state); quick-switcher lookup; hover preview.
51. `apps/server/src/routes/drafts.ts` (Create). Save a draft, discard a draft, create an entry, rename or
    move (returns the list of notes that will change), delete.
52. `apps/server/src/routes/publish.ts` (Create). List unpublished changes, publish selected ones with a
    message, read a conflict, resolve a conflict.
53. `apps/server/src/routes/search.ts` (Create). Full-text search.
54. `apps/server/src/routes/images.ts` (Create). Image serving and upload.
55. `apps/server/src/routes/status.ts` (Create). Status snapshot, the event stream, and `/health`.
56. `apps/server/src/cli/set-password.ts` (Create). Command to set the single account's password, run once
    in the container. There is no sign-up page.
57. `apps/server/src/cli/rebuild-index.ts` (Create). Command that rebuilds the index and prints counts, for
    diagnosis.
58. `apps/server/test/helpers/repo.ts` (Create). Makes a temporary Git remote and working copy from the
    fixture vault, so Git behaviour is tested without GitHub.
59. `apps/server/test/gateway.test.ts` (Create). Fetch, commit, push; a push after the remote moved is
    rejected and retried; no force push is ever issued.
60. `apps/server/test/publish.test.ts` (Create). One commit per Publish; no commit without Publish (G6); a
    file changed on the remote produces a conflict and is not published (G7); rename publishes all link
    rewrites in one commit.
61. `apps/server/test/drafts.test.ts` (Create). Drafts survive a restart; a crash during a write leaves the
    previous file intact; appendix files cannot be drafted.
62. `apps/server/test/index.test.ts` (Create). Index over the fixture matches expected links and backlinks;
    drafts overlay the index; deleting everything in memory and rebuilding gives the same result (G1).
63. `apps/server/test/auth.test.ts` (Create). Every route refuses without a session; rate limit works;
    webhook rejects a bad signature.

#### `apps/web`

64. `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html` (Create). Package setup.
65. `apps/web/src/main.tsx`, `src/App.tsx`, `src/routes.tsx` (Create). App start and routes: login, entry
    (read and edit), search, unpublished changes, conflict, status. Every view has a URL.
66. `apps/web/src/api/client.ts` (Create). Typed calls to the server using `packages/schema`.
67. `apps/web/src/api/events.ts` (Create). Subscribes to the status stream.
68. `apps/web/src/layout/Shell.tsx` (Create). Desktop layout: folder tree, main pane, right panel.
69. `apps/web/src/layout/PhoneBar.tsx` (Create). Bottom bar for phone: search, entries, unpublished, status.
    Map, inbox and chat buttons are added by their stages.
70. `apps/web/src/layout/StatusArea.tsx` (Create). Shows the status facts and failures (G12).
71. `apps/web/src/tree/FolderTree.tsx` (Create). The vault's folders and notes, with create, rename, move
    and delete.
72. `apps/web/src/reader/Reader.tsx` (Create). Rendered entry.
73. `apps/web/src/reader/render.ts` (Create). Markdown to elements with wikilinks, embeds, heading links and
    tables; unresolved links styled as such; ambiguous links marked.
74. `apps/web/src/reader/HoverPreview.tsx` (Create). Preview of a linked entry on hover or long-press.
75. `apps/web/src/reader/Backlinks.tsx`, `Outline.tsx` (Create). Right-panel lists.
76. `apps/web/src/editor/Editor.tsx` (Create). CodeMirror 6 on the note's text.
77. `apps/web/src/editor/livePreview.ts` (Create). Hides Markdown syntax away from the cursor line and
    shows images inline, as Obsidian's live preview does.
78. `apps/web/src/editor/wikilinks.ts` (Create). Link highlighting, click to follow, `[[` autocomplete over
    names, aliases and headings.
79. `apps/web/src/editor/tables.ts` (Create). Cell navigation and column alignment for Markdown tables.
80. `apps/web/src/editor/images.ts` (Create). Paste, drop and pick an image; calls upload; inserts the embed.
81. `apps/web/src/editor/PhoneToolbar.tsx` (Create). Buttons above the phone keyboard: link, heading, list,
    image, undo.
82. `apps/web/src/editor/Properties.tsx` (Create). Panel to view and edit frontmatter keys; edits go through
    the same one-key-at-a-time rule as the server.
83. `apps/web/src/drafts/buffer.ts` (Create). Saves each change to IndexedDB at once and to the server
    about a second later; resends when the connection returns (G6).
84. `apps/web/src/drafts/EntryState.tsx` (Create). The per-entry badge: published, unpublished, conflict,
    waiting to send.
85. `apps/web/src/publish/Unpublished.tsx` (Create). List of unpublished changes with differences, a message
    box and the Publish button.
86. `apps/web/src/publish/Conflict.tsx` (Create). Side-by-side view of the draft and the new `main` version,
    with the draft editable.
87. `apps/web/src/publish/RenameDialog.tsx` (Create). Shows which notes will change before a rename.
88. `apps/web/src/search/QuickSwitcher.tsx` (Create). Keyboard-opened jump to any entry by name or alias.
89. `apps/web/src/search/Search.tsx` (Create). Full-text search with snippets.
90. `apps/web/src/links/CreateFromLink.tsx` (Create). Dialog shown when an unresolved link is followed:
    suggests a folder, creates the draft entry.
91. `apps/web/src/auth/Login.tsx` (Create). Password form.
92. `apps/web/src/styles/tokens.css`, `styles/app.css` (Create). Colours, type and spacing for light and
    dark, sized for a 375 px screen first.
93. `apps/web/e2e/fixtures.ts` (Create). Starts the server against a temporary copy of the fixture vault.
94. `apps/web/e2e/write-publish.spec.ts` (Create). CUJ 1: edit, close the tab, reopen, publish; one commit.
95. `apps/web/e2e/links.spec.ts` (Create). CUJ 2 and autocomplete, hover preview, backlinks.
96. `apps/web/e2e/rename.spec.ts` (Create). CUJ 3.
97. `apps/web/e2e/conflict.spec.ts` (Create). CUJ 4.
98. `apps/web/e2e/offline.spec.ts` (Create). Connection dropped while typing; text is kept and sent later.
99. `apps/web/e2e/phone.spec.ts` (Create). The same flows at 375 px with touch.

#### Outside this repository

100. `avalymia/.frontier/README.md` (Create, in stage 2). One paragraph saying what the folder is and that
     Frontier owns it, so agents and the author's future self know not to hand-edit it. This is the only
     change to the vault in stages 1 and 2. It is a `.md` file inside a dot-folder; the Hindsight sync's
     handling of dot-folders is confirmed before this file is added, and it is renamed to `README.txt` if
     the sync would ingest it.
101. Coolify (configuration, not a file). One project: the container, a persistent volume at `/data`, the
     environment variables, the domain, the health check on `/health`, and a nightly backup of
     `/data/state` and `/data/assets/originals`.
102. GitHub (configuration, not a file). A fine-grained token for `avalymia` with contents read and write;
     a push webhook to Frontier.

### Order of work

1.  Root setup, `packages/schema`, `packages/vault` with the fixture vault and its tests.
2.  The link baseline against the real vault; the author reviews the ambiguous and unresolved lists once.
3.  Server: configuration, Git gateway, working files, index, search, login.
4.  Server: drafts and Publish with conflict handling.
5.  Web: shell, reader, folder tree, search, quick switcher. First deploy to Coolify, read-only.
6.  Web: editor, draft buffer, unpublished list, Publish, conflict screen, rename.
7.  Phone layout and toolbar, image upload and resizing.
8.  Backup and restore test. Stage 2 is done when the author has written and published from desktop and
    phone for a week without opening Obsidian for anything in the parity list.

### Verification Plan

*   **Compilation/Build**: `npm run build` builds every workspace; `docker build .` produces the image.
*   **Unit Tests**: `npm test` runs Vitest for `packages/vault`, `packages/schema` and `apps/server`.
*   **Real-vault tests**: `VAULT_PATH=<checkout> npm test -w packages/vault` runs the round-trip (G2) and
    link baseline (G4) tests against the actual vault. Run before each release and after any change to
    `packages/vault`.
*   **Static Analysis & Linting**: `npm run lint` (ESLint) and `tsc --noEmit` in every workspace.
*   **Test Coverage Requirement**: 90% of branches in `packages/vault` and in `apps/server/src/git` and
    `apps/server/src/publish`, the code that can damage canon. No fixed figure elsewhere.
*   **E2E/Integration**: `npm run e2e` runs Playwright at desktop and 375 px sizes with tracing off,
    covering CUJ 1 to 4 and the offline case.
*   **Goal checks for these stages**: G1 (index rebuild test), G2, G3 (open the vault in Obsidian after a
    week of use and confirm links resolve as before; manual), G4, G5 (one e2e test per parity item), G6,
    G7, G11 (phone spec plus a timed page load), G12 (each failure triggered in a test).

--------------------------------------------------------------------------------

*Drafted with EGM*
