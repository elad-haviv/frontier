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
architecture and the homes of the data for all nine build stages listed below. Its detailed implementation
plan covers stages 1 and 2 down to individual files. Each later stage gets its own short design document
before it is built, written against the architecture fixed here. The reason: a file-by-file plan for
stages 3 to 9 written now would be wrong by the time those stages start, because stages 1 and 2 will
change what is known. Where this document describes features of stages 3 to 9, it records what the author
asked for and what the architecture must not block; the stage designs settle the details.

| Stage | Name | Delivers | Goals closed |
| --- | --- | --- | --- |
| 1 | Foundation | Login, Git gateway with drafts and Publish, in-memory index, link resolution tested on the vault | G1, G2, G4, G6, G7, G12 |
| 2 | Reader and editor | Reading and writing at Obsidian parity on desktop and phone | G3, G5, G11 |
| 3 | Review inbox | Agent proposal branches, Frontier's own field proposals, structured fields, entry ids, the Hindsight sync changes | G8 |
| 4 | Maps | Flat and sphere maps, markers, paths, zones, layers, labels, marker sets, drill-down, measuring | G10 |
| 5 | Time | Calendar definitions, intervals, relations, timelines, overlap views, contradiction reports | G9 |
| 6 | Time-aware maps | Features appearing, disappearing and moving with the time slider | (extends G9, G10) |
| 7 | More map views | Other projections, cylinder and schematic spaces, space views | (extends G10) |
| 8 | AI companion | Writing help, lore conversations, character chat, discovery with concept art | G13, G14, G15, G16 |
| 9 | Export | Markdown, docx, PDF, JSON, styled web pages, presentations, map renders | none |

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
    unchanged, and an edit changes only the lines edited, including in files with Windows line endings. Check: an automated test opens and saves every note in the vault and expects an empty Git
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
*   **G10. Maps link to the lore.** A map declares its coordinate space. Flat and sphere are required;
    cylinder and schematic follow in stage 7. Markers, paths and zones link to entries and survive
    renames. Check: one working flat map and one working sphere map, each with a marker that opens its
    entry and an entry that lists the maps it appears on.
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
    repository, in `.frontier/profiles/`, and can be revised at any time. Check: a character asked about an event after their time of speaking, or outside their
    knowledge, does not answer as if they knew it.
*   **G15. Discovery produces proposals, never canon.** While the author wanders a map, AI generates
    places, characters, creatures and items that fit the surrounding canon. Each discovery is checked
    against the bank for contradictions, shown with what it was based on, and kept on the Frontier
    server, outside the repository and outside Hindsight, until approved. Approved discoveries become entries, and markers
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
    become canon one confirmation at a time. The author may ask for proposals for a whole folder; they
    stay proposals until he confirms each one.
*   **Deciding canon.** Frontier does not need, and does not invent, pulse rates, calendar anchors, leap
    rules or the radius of Ezob. It works with whatever the author has defined.
*   **Chat as canon.** What a character or the AI says in a conversation is not lore. Nothing said in chat
    enters canon unless the author turns it into a proposal and approves it. Conversations are kept on the
    server as working material, and can be saved on request as a session log under `99 Appendices`, which
    is where AI session logs already live.
*   **Unprompted generation.** AI does not invent lore in the background or fill gaps on its own. Discovery
    runs only while the author is exploring.
*   **Replacing Hindsight.** The memory bank and its sync agent stay as they are, apart from two changes
    to the sync: it skips formatting-only changes, and it ingests a commit on `main` only when it was
    pushed by the author or by Frontier. The bank holds canon only.
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
    this repository; changing it is a task in stage 3. After the stage 5 review the author added a second
    change: the sync ingests a commit on `main` only when it was pushed by him or by Frontier.
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
    proposals, drafts and chats are never sent to it. A discovery stays in Frontier's working files on the server
    until the author approves or rejects it; it reaches the bank only by becoming a published entry.

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
    accepts, edits or rejects each file. Accepted files become drafts. When he presses Publish they land on
    `main` as one commit.

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
| Build order | The editor comes in the first usable release (stages 1 and 2) | The main pain, following places and events, is not addressed until stages 4 and 5. |
| Working state | Files only, no database: an in-memory index; drafts, proposals, discoveries, chats and settings as files on the server disk | Every query is hand-built on the in-memory index. Pending work exists only on the server and depends on backup. |
| Agent proposals | Outside agents push `proposal/` branches; Frontier lists them and the author approves | `AGENTS.md` and each agent's instructions must change. |
| Agents pushing to `main` | The Hindsight sync ingests a commit on `main` only if it was pushed by the author or by Frontier | Unreviewed text can still sit on `main` until the author deals with it. Agents need their own GitHub identity for the check to work. |
| Map drawing | Custom renderer, mesh method, using the `d3-geo` library for projection | The map stage is the largest in the project. Seams at map edges and phone performance need tuning. |
| Character profiles | Files in `.frontier/profiles/` | Profiles are read and edited only in Frontier. |
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
                                               |  (in memory)      /data/state  (working files) |
                                               |                   /data/assets (tiles, thumbs) |
                                               |  AI service ----> OpenRouter                   |
                                               |              \--> Hindsight `worldbuilding`    |
                                               +------------------------|-----------------------+
                                                                        | push main / fetch
   Obsidian (obsidian-git) ---- push main ----> GitHub: elad-haviv/avalymia <---- agents push proposal/ branches
                                                        |
                                                        +-- webhook --> Frontier (fetch, reindex)
                                                        +-- webhook --> Hindsight sync (main only,
                                                                        commits by author or Frontier)
```

One persistent disk is mounted at `/data`. It holds the Git working copy of `avalymia`, a folder of
working files and derived assets. There is no database. Losing the disk loses whatever unpublished work
was created since the last backup: drafts, pending proposals, discoveries, chats, the cost log and
settings. It does not lose canon.

### Where each kind of data lives

| Data | Home | In Hindsight |
| --- | --- | --- |
| Entries (Markdown, frontmatter fields) | `avalymia` repo, existing folders | Yes, on push to `main` |
| Calendars, maps, marker set manifests, art styles, character profiles, field schema | `avalymia` repo, `.frontier/` | No (not ingested) |
| Saved chat logs (on request) | `avalymia` repo, `99 Appendices/04 AI Conversations/` | As today |
| Images, including map images | `avalymia` repo | No |
| Index: links, backlinks, search text, parsed fields | Server memory, rebuilt from the repo at start | No |
| Drafts, Frontier's AI proposals, discoveries, chats, cost log, AI result cache, settings | Files in `/data/state` | No |
| Agent proposals | Branches `proposal/...` in the `avalymia` repo | No (not `main`) |
| Tiles, thumbnails | `/data/assets`, regenerated from the repo | No |
| Generated concept art, until approved | `/data/assets/generated` | No |

`.frontier/` is a dot-folder, so Obsidian does not show it. The Hindsight sync must not ingest it; this is
confirmed against the sync agent before the folder is first used.

Map images are stored in the repository like the existing images, so goal G1 holds without exception.
Whether large ones use Git LFS is decided in the stage 4 design, when the real sizes are known.

### Git gateway

One module owns every Git operation. Nothing else touches the working copy.

*   **Fetch.** A GitHub webhook on the `avalymia` repo calls Frontier on every push. Frontier fetches,
    fast-forwards its copy of `main` when it has no local commits, and reindexes the changed files. A timer
    fetches every few minutes in case a webhook is missed.
*   **Drafts are not commits.** A draft is a pair of files in `/data/state/drafts`: the full text, and a
    small record with the file path and the Git blob hash of the version it was based on. Creations and
    deletions are drafts too. A rename or move is stored as an intent (old path, new path), not as edited
    copies of the linking notes.
*   **Publish.** The author selects drafts (all by default) and writes a message. Frontier fetches, then
    handles each draft:
    *   If the file on `main` still has the draft's base hash, the draft is ready.
    *   If the file changed on `main`, Frontier runs a three-way merge of base, draft and `main`. When the
        merge is clean, the merged text is shown to the author with the incoming changes marked, and is
        used only after he confirms it. Nothing is merged unseen.
    *   If the merge has overlapping changes, the draft is in conflict (see below).
    *   A rename intent is turned into link rewrites now, against the fetched `main`. If the list of notes
        to change differs from what the author was shown, it is shown again.
    Ready and confirmed drafts are written and published as one commit. Drafts in conflict are held back
    and the rest go ahead, except a rename and its link rewrites, which are published together or not at
    all. If the push is rejected because `main` moved meanwhile, Frontier repeats once from the fetch. It
    never force-pushes and never rewrites history.
*   **Conflict.** The interface shows the author's version beside the version from `main`, with the
    overlapping parts marked. He edits his draft into the result and confirms, which resets its base hash.
*   **Credential.** A fine-grained GitHub token limited to the `avalymia` repo, held in a server
    environment variable. Frontier pushes under its own identity so the Hindsight sync can recognise it.
*   **Commit identity.** Commits carry the author's name as author. Commits that include approved AI
    content add a trailer naming the model and the proposal.

### Vault service

*   **Parsing.** Entries are read as text. Frontmatter is parsed with a YAML library that keeps the original
    document, so changing one key rewrites only that key's lines. Unknown keys, key order and comments are
    preserved. The body is never re-serialised: the editor edits the text itself.
*   **Line endings.** 18 files use Windows line endings. The editor works on normalised text internally, so
    each file's line ending is detected when it is opened and restored when it is saved. A file with mixed
    endings is saved through a map of changed ranges, so untouched lines keep their bytes, and is listed
    for the author. Goal G2 is tested through the editor in the browser, not only through the parsing
    package.
*   **Link resolution.** Rules, in order: a link with a path resolves to that path; a bare name matches a
    note name or a declared alias, ignoring case and surrounding spaces; among several matches, the one
    outside `99 Appendices` wins when it is the only one outside; otherwise the link is ambiguous. Heading
    links resolve to a heading in the target, or in the same note when no target is given. Image embeds
    resolve by bare file name across the vault; the 11 duplicated image names resolve to the nearest folder
    and are listed for the author. The tie-break is Frontier's rule, not Obsidian's, and is the one
    intended difference. The resolver runs over the real vault in a test with a checked-in baseline, which
    the author compares once with Obsidian's own list of unresolved links (goal G4).
*   **Rename and move.** Renaming rewrites every link that pointed to the old name or path, in one commit.
    Folder notes (a note named after its folder, 77 today) move with their folder. Files under
    `99 Appendices` are never rewritten: when one of them links to the renamed entry, the old name is added
    to the entry's `aliases`, so the old link still resolves.
*   **Entry identity.** An entry gets an `id` in frontmatter, a short random string that never changes, at
    the moment something first refers to it: a map feature, a profile, a proposal, a time relation. This
    starts in stage 3. There is no batch commit adding ids to every note. When the index is built, entries
    that share an `id` (a note duplicated in Obsidian) are listed for the author, and references to an
    `id` that no entry carries are shown as broken.
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
    *   `proposals/`: Frontier's own AI proposals, and the list of rejected proposals with the hash of the
        sentence each was based on.
    *   `discoveries/`: one file per exploring session.
    *   `chats/`: one file per conversation or character session.
    *   `ai-log/`: one line per AI call with tokens and cost, a file per month.
    *   `ai-cache/`: field-proposal results by content hash.
    *   `settings.json`: model choices, spending cap, Hindsight address, the password hash, and the AI and
        Hindsight keys encrypted with a key from an environment variable. Secrets are never sent to the
        browser.
*   Files are written by writing a temporary file and renaming it, so a crash cannot leave half a file.
    One server process is the only writer.
*   **Backup.** `/data/state` and `/data/assets/generated` are copied to a second location within a few
    minutes of any change, and in full every night. The status area shows the time of the last backup.
    The browser also keeps its own copy of each draft until that draft is published, and sends it again if
    the server no longer has it. Together these bring the worst-case loss of typed text down from a day to
    minutes.
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

1.  **Agent branches.** Only branches whose name starts with `proposal/` are listed. A proposal shows the
    branch name, the commit messages, and each changed file as a readable difference against the commit
    where the branch left `main`, so later changes on `main` are not shown as reversals. The author
    accepts, edits or rejects per file. An accepted file becomes a draft whose base is that fork point,
    so Publish merges it with current `main` by the rules above. The branch is deleted when every file is
    decided. `AGENTS.md` changes to: agents push to `proposal/<agent>/<topic>` and never to `main`.
2.  **Frontier's own AI.** Field proposals, drafted entries, profile proposals and lines sent from chat are
    files in `/data/state/proposals`. A proposal is a short list of operations, not a copy of the entry:
    set this field, insert this text after that sentence, create this file. Each operation records the
    source text it was based on and the model used. Operations are applied to the entry as it is when the
    author accepts. If the place an operation refers to is gone, the proposal is shown as "no longer
    applies".
3.  **Discoveries.** Files in `/data/state/discoveries`, one per exploring session, each discovery with its
    position, the canon it drew on and the result of the contradiction check. A discovery is accepted as
    a "create this entry" operation, with a marker where relevant.

Accepting any proposal produces drafts. Nothing reaches `main` except through Publish. This is the single
code path that goal G8 tests.

**Agents that push to `main` anyway.** `main` is not protected in GitHub, because Obsidian pushes to it
directly. The guard is in the Hindsight sync: it ingests a commit on `main` only when it was pushed by the
author's account or by Frontier's. Anything else is left out of the bank. Frontier lists such a commit as
"arrived unreviewed"; the author accepts it, which tells the sync to ingest it, or reverts it. For this to
work, outside agents must push with their own GitHub identity and not with the author's token. Until the
author deals with it, the text is on `main` and visible to Obsidian and to other agents.

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

A schema file, `.frontier/schema.yaml`, lists field names, the allowed `what` values per entry type, which
`what` values begin and end an entry's existence, and a version number. Changes to the schema are
scripted, reviewed commits.

**Accepted limit.** Because the Hindsight sync skips changes that touch only frontmatter, confirmed dates
and new aliases do not reach the bank until the entry's text next changes. Frontier's answers are not
affected, since it reads the files, but recall from the bank by date will lag.

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
    (pulses per unit). Only calendars with both can be placed on one axis; a conversion gives a range and
    is labelled derived. Calendars without them are shown in their own lane, ordered by relations. Rates
    that change over time, for time dilation, are left to the stage 5 design; the stored form does not
    block them.
*   **Views**: timeline with lanes by place, culture or entry type, each event drawn as wide as its
    interval; an overlap view for a chosen span; a list of contradictions.
*   **Unconfirmed proposals in views.** Timelines and time-aware maps also show time fields that AI has
    proposed and the author has not yet decided, read from `/data/state/proposals` and kept apart from
    confirmed fields. They are drawn in a distinct style (outlined, not filled, with a marker) and can be
    hidden with one switch. They never narrow confirmed intervals and never appear in the list of canon
    contradictions. Each proposal is checked on its own: if accepting it would contradict confirmed
    fields, the proposal says so. Tapping one shows the source sentence with confirm, edit and reject.
    Confirming writes the field into a draft of the entry. Lore conversations, character chat and
    discovery read confirmed fields only.

### Maps

*   **Map files** are JSON in `.frontier/maps/`, one per map, with a format version. A map has: a title; a
    coordinate space; one or more source images with their extent and projection; layers; features; and
    links to child maps.
*   **Coordinate spaces.** Two are committed to in this document: `flat` (x and y in the image's own units,
    with an optional scale) and `sphere` (longitude and latitude, radius optional). Two more are intended
    and designed in stage 4: `cylinder` (angle, height and layer number, for Derdama) and `schematic` (x
    and y with no measuring, for the cosmological map). Each space supplies its own distance and area
    functions, or none. Until they exist, Derdama and the cosmological map can be shown as flat maps.
*   **Features** are GeoJSON points, lines and polygons in the map's space. A feature may carry an entry
    `id`, a marker set and icon, a style, a label, and a link to a child map. It carries no dates. By
    default it is visible for as long as its entry exists, from the entry's beginning event to its ending
    event as marked in the schema. A feature may instead name two events on its entry to bound its
    visibility, so one realm can have several border shapes, each valid between different events. A path
    may list several positions with entry events, which gives movement. Dates stay on entries only. A
    feature that names an event the entry no longer has is shown as unbound.
*   **Marker sets** are folders of icons with a manifest in `.frontier/marker-sets/`. The first set points
    at the Skyrim icons already in `99 Appendices/07 Icons/Skyrim`. A map selects the sets it uses.
*   **Renderer.** Frontier draws its own maps with the mesh method.
    *   The server cuts each source image into a pyramid of tiles in the image's own projection.
    *   In the browser, each visible tile is drawn in WebGL as a small grid of triangles. The corners of
        the grid are positions in the map's space, turned into screen positions by the current
        projection. Choosing which tiles and which level to draw is ordinary visibility testing.
    *   For the sphere, projection uses the `d3-geo` library, which covers the globe view,
        equirectangular, Mercator, Robinson, Mollweide, Winkel Tripel and others. Only the forward
        direction is needed for drawing, and `d3-geo` has it for all of them. No new projection maths is
        written. Flat space needs none.
    *   Markers, lines, zones and labels are projected with `d3-geo` and drawn on a canvas above. It
        already draws great-circle lines and cuts shapes at the edge of the globe and at the map's seam.
    *   Small libraries without an interface of their own are used for touch gestures and for finding
        which feature was tapped. Pan, zoom, rotate, drawing and measuring tools are built in Frontier
        and work in space coordinates, so they behave the same in every projection.
*   **What is reused from `map-reprojector`.** The choice of `d3-geo`, the list of projections the author
    uses, and the idea of rotating the globe before projecting. Its code is not carried over: it redraws
    every pixel on the processor, assumes a full-globe image, and its interface is tied to mouse and
    keyboard.
*   **Known difficulties**, to be settled in the stage 4 design before any drawing tool is built: visible
    seams where a projection splits the map; how dense the triangle grid must be near the poles and the
    globe's edge; a frame-rate target on a mid-range phone, with lower-resolution tiles while moving as
    the fallback.
*   **Order of building**: flat space with markers; then sphere in equirectangular and globe views; then
    paths, zones, layers and measuring; then other projections; then cylinder and schematic spaces.
*   **Risk accepted.** If phone performance or the volume of work blocks later stages, the fallback is to
    ship flat and globe views only and defer the rest.

### AI service

*   **Provider.** All model calls go through one interface to OpenRouter, with model names per task
    (extraction, conversation, character, discovery, image) set in the settings screen. Every call is
    appended to the cost log with tokens and cost. The hard spending limit is set on the OpenRouter key
    itself; Frontier's own monthly cap stops calls earlier with a clear message and drives the display.
*   **Hindsight.** A client for the `worldbuilding` bank, configured in settings (address, bank name, key,
    test button). Frontier only reads from the bank. It never writes to it; the bank is fed by the existing
    sync from `main`.
*   **Grounding.** For lore questions and contradiction checks: recall from the bank, then read the actual
    files for the entries recalled, then answer from the file text. Claims cite entries, which the
    interface shows as links. This follows the vault rule that lore is never quoted from the bank.
*   **Field proposals.** Run on Publish for the changed entries, or on request for one entry or one
    folder. A folder run shows a cost estimate first and stops at the monthly cap. Its results are
    proposals like any other and stay unconfirmed until the author decides each one, so it is not the
    bulk write that the non-goals rule out. Results are cached on disk by content hash. `99 Appendices`
    and `.frontier/` are excluded.
*   **Character chat.** A profile is a file in `.frontier/profiles/`, linked to the character's entry by
    `id`. It holds voice, knowledge, beliefs, what the character does not know, and the moment the
    character speaks from. The existing `99 Appendices/09 Agents/Yagon.md` stays untouched as a historical
    file; its content is the starting text for Yagon's new profile. The system prompt is built from the
    approved profile and the character's entries; entries and events dated after the moment of speaking
    are left out of the context.
*   **Discovery.** Input: the tapped position, nearby features and their entries, the region's cultures,
    the selected moment. Output: structured candidates (kind, name, description, position, the entries it
    drew on). Each candidate is checked against the bank and files before it is shown.
*   **Concept art.** A discovery gets one generated image, made through the same provider interface with
    an image model chosen in settings, in one of the author's predefined art styles. Unapproved art is
    kept in `/data/assets/generated`. On approval the image is added to `99 Appendices/01 Images` and
    embedded in the new entry, in the same Publish. Image calls count toward the cap and are expected to
    be the largest part of discovery cost.
*   **Art styles.** The author defines named styles in a settings screen; they are files in
    `.frontier/art-styles/`. What a style contains, how defaults are chosen and when art is generated are
    settled in the stage 8 design. The intent recorded here: a style description added to every prompt,
    a default per kind of discovery, a choice of style when generating, and a setting for whether art is
    made for every discovery, only on opening one, or never.
*   Stage 8 gets its own design, including prompts, context limits and the marking of improvised lines.

### Login and security

*   One account. Password stored as an argon2id hash; a signed session cookie that is HTTP-only, secure
    and same-site, so no session store is needed. Login attempts are rate-limited. Passkeys can be added
    later.
*   The GitHub token, AI key and Hindsight key stay on the server.
*   Webhook calls from GitHub are verified by their signature.

### Seeing failures

*   A status area shows: unpublished drafts, last fetch and push, a failed push, index built from which
    commit, agent branches waiting, commits that arrived unreviewed, entries with a duplicate or missing
    `id`, files with mixed line endings, last backup, AI spend this month, and Hindsight reachability.
*   The server pushes status changes to the browser over server-sent events.
*   `/health` reports the same facts for Coolify's health check.

### Export

Stage 9 gets its own design. The intent: Markdown, docx, PDF and JSON; styled web pages; presentations;
and map renders produced by the same renderer at a chosen size, moment and projection. Pandoc is the
expected tool for docx and PDF.

### Code layout

A single repository, `elad-haviv/frontier`, with workspaces:

```text
apps/server      Fastify API, Git gateway, index, AI service, static file serving
apps/web         React app: reader, editor, inbox, maps, timeline, chat
packages/vault   Markdown and frontmatter parsing, link resolution, rename (used by server and web)
packages/time    Calendar definitions, date parsing, intervals, relation solver (stage 5)
packages/geo     Coordinate spaces, measuring, tile and mesh maths on top of d3-geo (stage 4)
packages/schema  Shared types and validators for API and file formats
```

`packages/vault`, `packages/time` and `packages/geo` have no dependency on the server or the browser, so
they are tested against the real vault on their own.

### Changes outside this repository

1.  `avalymia/AGENTS.md`: agents push to `proposal/<agent>/<topic>` branches, never to `main`, and push
    with their own GitHub identity.
2.  Hindsight sync agent, two changes: skip changes that touch only frontmatter, whitespace or line
    endings; and ingest a commit on `main` only when it was pushed by the author or by Frontier, or has
    been marked reviewed by Frontier. It must also ignore `.frontier/`.
3.  `avalymia`: add the `.frontier/` folder.
4.  GitHub: a webhook from `avalymia` to Frontier; a fine-grained token for Frontier; a separate identity
    and token for outside agents.
5.  `99 Appendices/06 Interactive Maps/Main.json` is removed when the first map file exists. This is the
    one edit to an appendix file, approved by the author.

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
*   **Reason for Rejection**: Rejected in Goldfish review. A later review found that its projection maths
    comes from the `d3-geo` library, so Frontier uses that library directly and carries over none of the
    app's code.

### From drafting

#### Working state in Postgres or SQLite

*   **Pros**: A query language, transactions, built-in full-text search. Postgres matches the author's
    other apps.
*   **Cons**: Postgres is a second service to run and back up. SQLite ties data to one file and one
    process. Both hold pending proposals only on the server.
*   **Reason for Rejection**: Rejected by author: he first chose SQLite, then changed to files only.

#### Frontier's own proposals and discoveries in Git

*   **Pros**: Pending work has a copy off the server. As visible branches it can be browsed on GitHub; as
    hidden references it stays out of sight of other agents.
*   **Cons**: A full copy of an entry on a branch goes stale as soon as `main` changes and can overwrite
    newer canon when accepted. Every explore tap becomes a push. Invented material sits in the canon repo.
    Hidden references cannot be browsed on GitHub.
*   **Reason for Rejection**: Rejected by author. He first chose visible branches; after the stage 5 review
    showed the staleness problem he chose files on the server, with backup within minutes.

#### Working files in a second private repository

*   **Pros**: History and an off-server copy with no backup job.
*   **Cons**: A second set of Git operations and many small autosave commits.
*   **Reason for Rejection**: Rejected by author: working files stay on the server disk.

#### Character profiles in `99 Appendices/09 Agents`

*   **Pros**: Readable in Obsidian, beside the existing `Yagon.md`.
*   **Cons**: The folder is append-only by vault rule, so a profile could not be revised without changing
    the rule or piling up versioned files. Hindsight would ingest invented voice and mannerisms as lore.
*   **Reason for Rejection**: Rejected by author: profiles live in `.frontier/profiles/`.

#### Blocking agents from `main` with a GitHub rule, or only detecting them afterwards

*   **Pros**: A rule makes the breach impossible. Detection afterwards needs no setup.
*   **Cons**: The rule may need a paid GitHub plan on a private repository. Detection afterwards leaves
    unreviewed text in Hindsight.
*   **Reason for Rejection**: Rejected by author: the Hindsight sync checks who pushed.

#### Custom renderer with a per-pixel shader

*   **Pros**: The sharpest image and no seams.
*   **Cons**: New shader maths for every projection, none for projections without a closed formula, and an
    unsolved problem of reading many tiles in one shader.
*   **Reason for Rejection**: Rejected by author after the stage 5 review: mesh method with `d3-geo`.

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

*   In stages 1 and 2 Frontier adds `.frontier/` and otherwise writes to the vault only what the author
    publishes: his own edits, renames and uploaded images. Obsidian keeps working throughout.
*   Entry ids, the `AGENTS.md` change and the Hindsight sync changes come with stage 3. The vault changes
    are ordinary commits that can be reverted.
*   Rollback at any time: stop the container. The vault, with all published work, is intact in GitHub and
    opens in Obsidian. Unpublished drafts and chats are in the `/data/state` backup as plain files.

### Backup

*   `/data/state` and `/data/assets/generated` are copied to a second location within minutes of a change
    and in full every night. A restore is tested once before stage 2 is called done.

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
8.  `zoom_out_report.md` and the other review reports in the repository root (Delete, when the review
    ends). They are working files of the design review.
9.  `docs/designs/frontier.md` (Modify). Set the status to Approved when the review ends.
10. `docs/designs/SITEMAP.md` (Modify). Register each later stage design as it is written.
11. `scripts/backup.sh` (Create). Copies `/data/state` and `/data/assets/generated` to the backup location;
    run by a file-change watcher with a few minutes' delay and once nightly.
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
    push, detect rejection, find the commit where a branch left `main`, and run a three-way merge of three
    versions of one file. A lock makes operations run one at a time. Never passes `--force`.
35. `apps/server/src/git/webhook.ts` (Create). Route for GitHub push events: checks the signature, then
    asks the gateway to fetch and the index to update.
36. `apps/server/src/git/poll.ts` (Create). Timer that fetches every few minutes in case a webhook is missed.
37. `apps/server/src/state/files.ts` (Create). Safe file writing for `/data/state`: write to a temporary
    name, then rename. JSON read and write helpers.
38. `apps/server/src/state/drafts.ts` (Create). Create, read, update, delete and list drafts; each draft is
    a text file plus a record with path, base blob hash, kind (edit, create, delete) and time. A rename or
    move is stored as an intent with the old and new path.
39. `apps/server/src/state/settings.ts` (Create). Read and write `settings.json`; stage 1 holds only the
    password hash. Encryption helper for secrets added in later stages.
40. `apps/server/src/index/build.ts` (Create). Reads the working copy into memory: entries, aliases,
    headings, links with resolution, backlinks. Applies drafts on top so the author sees his unpublished
    state. Updates one file at a time on change.
41. `apps/server/src/index/search.ts` (Create). MiniSearch index over titles, aliases, headings and body;
    query function returning entries with a snippet.
42. `apps/server/src/publish/publish.ts` (Create). The Publish flow from the Technical Plan: fetch; compare
    base hashes; three-way merge where a file changed, returning clean merges for the author to confirm;
    turn rename intents into link rewrites against the fetched `main`; hold back conflicted drafts; keep
    a rename and its rewrites together; write files, one commit, push, one retry on rejection.
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
    file changed on the remote in the same place produces a conflict and is held back while other drafts
    publish (G7); a change elsewhere in the file gives a clean merge that waits for confirmation; rename publishes all link
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
    about a second later; resends when the connection returns; keeps each draft until it is published and
    sends it again if the server no longer has it (G6).
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
99a. `apps/web/e2e/line-endings.spec.ts` (Create). One keystroke in the fixture file with Windows line
    endings gives a one-line difference after Publish; the same for the file with mixed endings (G2).
99b. `apps/web/src/editor/lineEndings.ts` (Create). Detects a file's line ending on open and restores it on
    save; for mixed endings, writes back only the changed ranges.
99c. `apps/web/src/publish/MergeConfirm.tsx` (Create). Shows a clean three-way merge with the incoming
    changes marked, for the author to confirm before it is published.

#### Outside this repository

100. `avalymia/.frontier/README.md` (Create, in stage 2). One paragraph saying what the folder is and that
     Frontier owns it, so agents and the author's future self know not to hand-edit it. This is the only
     change to the vault in stages 1 and 2. It is a `.md` file inside a dot-folder; the Hindsight sync's
     handling of dot-folders is confirmed before this file is added, and it is renamed to `README.txt` if
     the sync would ingest it.
101. Coolify (configuration, not a file). One project: the container, a persistent volume at `/data`, the
     environment variables, the domain, the health check on `/health`, and a backup location for
     `/data/state` and `/data/assets/generated`.
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
