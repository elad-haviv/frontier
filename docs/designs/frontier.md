# Frontier

*   **Author:** Elad Haviv
*   **Status:** Approved
*   **Date:** 2026-11-20

--------------------------------------------------------------------------------

## Overview

Frontier is a web app for one author. In it he writes, reads and explores Avalymia, a fantasy multiverse
kept as about 430 Markdown notes of lore, plus logs and appendices, in the `elad-haviv/avalymia` GitHub repository. It runs in desktop and
phone browsers and is hosted on the author's own server.

Frontier does six jobs in one place:

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

6.  **Export** the work to other formats: documents, styled web pages, presentations and map images.

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
| 1 | Foundation | Login, Git gateway with drafts and Publish, in-memory index, link resolution tested on the vault | G1, G2, G4, G6, G7, G12 (sync, index and backup failures) |
| 2 | Reader and editor | Reading and writing at Obsidian parity on desktop and phone | G3, G5, G11 |
| 3 | Review inbox | Agent proposal branches; the AI basics (provider connection, key, cost log, spending cap); Frontier's own field proposals; structured fields; the entry id mechanism; the sync changes and quarantine | G8, G16 |
| 4 | Maps | Flat and sphere maps, markers, paths, zones, layers, labels, marker sets, drill-down, measuring | G10 |
| 5 | Time | Calendar definitions, intervals, relations, timelines, overlap views, contradiction reports | G9 |
| 6 | Time-aware maps | Features appearing, disappearing and moving with the time slider | none new |
| 7 | More map views | Other projections; cylinder and schematic spaces, designed and built here; views of the space between worlds | none new |
| 8 | AI companion | Writing help, lore conversations, character chat, discovery with concept art | G12 (AI failures), G13, G14, G15 |
| 9 | Export | Markdown, docx, PDF, JSON, styled web pages, presentations, map renders | none; export has no goal by intent and is specified in its stage design |

## Terms used in this document

*   **Vault**: the folder of Markdown notes and images that holds Avalymia, opened today in Obsidian and
    mirrored to the GitHub repository `elad-haviv/avalymia`.
*   **Entry**: one Markdown note of lore in the vault. "Note" means any Markdown file, including logs.
*   **Canon**: what is on the `main` branch of the vault repository, except notes that are quarantined.
*   **Vault rules**: the rules in `AGENTS.md` at the root of the vault repository. The ones this design
    depends on: AI proposes and the author approves; `99 Appendices` is append-only; one logical change
    per commit; no force-push; lore is quoted from files, never from the bank.
*   **Agents**: AI programs, run by the author outside Frontier, that read and write the vault repository.
    Examples are his Hermes agent and cloud coding sessions.
*   **The bank**: a Hindsight memory bank named `worldbuilding`, running on the author's server. Hindsight
    is a self-hosted service that stores facts extracted from text and returns the ones related to a
    question, with the path of the note each came from. It is used to find related lore by meaning.
*   **The sync**: a separate agent, outside this repository, that runs on each push to `main` and feeds
    changed notes into the bank. The author owns its code.
*   **Coolify**: the self-hosted deployment platform on the author's server.
*   **Draft**: one unpublished change held by Frontier: new content for a file (text or an image), a
    deletion, or a rename. **Publish**: the action that turns drafts
    into one commit on `main`.
*   **Proposal**: a suggested change from AI or an agent, waiting for the author's decision.
*   **Quarantined**: said of a note changed on `main` by someone other than the author or Frontier, and
    held out of the bank until the author decides.
*   **Exploring session**: one sitting of wandering a map and generating discoveries.
*   **Pulse**: the setting's own universal unit of time (the Nexus Pulse), counted from Pulse Zero. It is
    lore, not something Frontier invents. **Era of Man (EM)**: the everyday calendar of the world Ezob.
*   **Ezob**: the main world, a sphere. **Derdama**: the underworld, a stack of cylinder-shaped layers.

Counts of files and links in this document were taken from the vault on 2026-11-20.

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
    the text, with no view of what changed.
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
    calendars, images) is a file in `elad-haviv/avalymia`. Check: delete Frontier's index and server state,
    rebuild from a fresh clone, and no published content is missing.
*   **G2. Frontier never damages a file.** Opening and saving a note without edits leaves it byte-for-byte
    unchanged, and an edit changes only the lines edited, including in files with Windows line endings. Check: an automated test opens and saves every note in the vault and expects an empty Git
    diff.
*   **G3. Obsidian keeps working on the same vault.** Frontier writes only syntax Obsidian reads, and stores
    its own data where Obsidian ignores it. Check: the vault opens in Obsidian with all links resolving as
    before.
*   **G4. Links resolve as in Obsidian, with one stated exception** (the `99 Appendices` tie-break,
    described under Link resolution). Check: a test runs Frontier's link resolver over the real vault and
    compares the result with a checked-in baseline. The author compares that baseline once with Obsidian:
    the full list of unresolved links, and a sample of 50 resolved links.
*   **G5. Writing is at Obsidian parity for the listed features**, on desktop and phone: live editing, `[[`
    autocomplete with aliases and headings, create an entry from an unresolved link, rename and move with
    link rewriting, quick switcher, full-text search, backlinks, outline, hover preview, table editing,
    image upload. Check: each item has an acceptance test.
*   **G6. Typed text is not lost, and no draft becomes canon by accident.** Drafts save automatically in
    the browser and on the server. Only an explicit Publish creates a commit. Check: closing the tab,
    locking the phone or losing the connection mid-sentence loses nothing; no commit appears without
    Publish. Loss of the server disk loses at most the 5 minutes since the last backup.
*   **G7. Concurrent writers never overwrite each other.** Obsidian and agents may push to `main` while
    Frontier is in use. Frontier pulls before it pushes, never force-pushes, never applies a merge the
    author has not confirmed, and shows a conflict screen when changes overlap. Check: a test pushes an
    overlapping change from outside and Frontier holds that draft back until the author resolves it.
*   **G8. No AI text is treated as canon without approval.** Frontier itself writes no AI output to `main`
    without the author accepting it. Text that an agent pushes to `main` against the rules is quarantined:
    it does not reach the bank or Frontier's AI answers until the author accepts it. Check: no code path
    writes AI output to a draft without a recorded acceptance; a test push by a non-allowed identity
    leaves the note out of the bank and out of AI answers. Limit: quarantine recognises an agent only if it
    pushes with its own GitHub identity; an agent that pushes under the author's own account cannot be told
    from him, and for such agents the branch rule in `AGENTS.md` is the only protection.
*   **G9. Time works without canon numbers.** An entry can hold exact, partial, vague and relative time
    references in any defined calendar. Timelines show order and overlap. Contradictions are reported, not
    fixed. Conversion between calendars appears only where the author has supplied an anchor and a rate.
    Check: a timeline renders from entries that have only relative references.
*   **G10. Maps link to the lore.** A map declares its coordinate space. Flat and sphere are required;
    cylinder and schematic are designed and built in stage 7. Markers, paths and zones link to entries and survive
    renames. Check: one working flat map and one working sphere map, each with a marker that opens its
    entry and an entry that lists the maps it appears on.
*   **G11. Usable on a phone.** Every screen can be operated at 375 px width with touch only, with no
    sideways scrolling, and images are served resized. Check: the browser tests for every journey run at
    375 px with touch; entry pages load under 2 seconds on a 4G connection.
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
    server as working material, and can be saved on request to `.frontier/chat-logs/` in the vault. They
    are not saved under `99 Appendices/04 AI Conversations`, because the sync ingests that folder and chat
    contains improvised lines.
*   **Unprompted generation.** AI does not invent lore in the background or fill gaps on its own. Discovery
    runs only while the author is exploring.
*   **Replacing Hindsight.** The memory bank and its sync agent stay as they are, apart from the changes to the
    sync listed under "Changes outside this repository". The bank holds canon only.
*   **Drawing base maps.** Map images are still made in outside tools and imported. Frontier draws markers,
    paths, zones and labels on top of them.
*   **Editing `99 Appendices`.** That folder is append-only by vault rule. Frontier shows it and can add new
    files to it, and cannot edit existing ones.

## Resolved decisions

No questions are open. These were raised during drafting and settled by the author.

*   **Concept art in discovery.** A discovery comes with generated concept art. The art is part of the
    proposal and is approved, replaced or dropped with it.
*   **Sync and formatting changes.** The sync skips a change that touches only frontmatter, whitespace or
    line endings, so adding an `id` or time fields does not re-ingest the note.
*   **Notes with the same name.** The folder structure carries meaning, so two notes with the same name are
    two different things. Frontier identifies an entry by its full path, and by `id` where it has one,
    never by name alone. The two cases today are a lore entry and a non-lore file:
    `04 Inhabitants/Archdemons/Yagon.md` and the older chat profile `99 Appendices/09 Agents/Yagon.md`;
    the live `Common Ezobian.md` and a copy in the recycle bin.
*   **Existing map file.** `99 Appendices/06 Interactive Maps/Main.json` is replaced by the map format
    defined here.
*   **Marker icons.** The Skyrim icon set already in the vault is the first marker set, and several sets
    can exist side by side.
*   **Export targets.** Markdown, docx, PDF and JSON, plus styled web pages, presentations and map renders
    (an image of a map as currently shown, with its markers, layers and chosen moment in time).
*   **Access to the bank.** Frontier connects to the bank itself. A settings screen holds the bank address,
    bank name and access key, with a "test connection" button, the number of results asked for per
    question and the time allowed per request. The same screen holds the AI provider key, model choices
    and the monthly spending cap.
*   **Discovered material and the bank.** Only canon is registered in the bank.

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
*   **Then**: If the two changes are in different parts of the note, Frontier shows the combined text with
    the agent's change marked and asks him to confirm. If they overlap, it holds the draft back, shows his
    version beside the version from `main` with the overlapping parts marked, and lets him merge by hand.
    It never applies a merge he has not confirmed and never overwrites.

### CUJ 5: Approve a proposed date

*   **Given**: The author publishes an entry containing "two centuries after the First Landing".
*   **When**: Frontier's AI proposes a time field: "after First Landing, about 200 years, Era of Man".
*   **Then**: The proposal appears as a chip on the entry, in the inbox, and on the timeline as an
    unconfirmed event in a distinct style, with the source sentence highlighted. (The chip and inbox
    work from stage 3; the timeline part from stage 5.) Publishing was not blocked. He accepts with one tap, the field is added to the entry's
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
    dates stay visible and are styled as undated. Markers dated in a calendar that has no conversion to
    the slider's calendar are styled as not placeable in time.

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
| Agents pushing to `main` | The sync quarantines any note changed by a push from someone other than the author or Frontier (see "Quarantine") | Unreviewed text can still sit on `main` until the author deals with it. Frontier and the agents each need their own GitHub identity. |
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
                                                        +-- webhook --> the sync (main only; quarantines
                                                                        notes pushed by anyone else)
```

One persistent disk is mounted at `/data`. It holds the Git working copy of `avalymia`, a folder of
working files and derived assets. There is no database. Losing the disk does not lose canon; what it can
lose is covered under "Risks and mitigations".

### Where each kind of data lives

| Data | Home | In Hindsight |
| --- | --- | --- |
| Entries (Markdown, frontmatter fields) | `avalymia` repo, existing folders | Yes, on push to `main`, unless quarantined |
| Calendars, maps, marker set manifests, art styles, character profiles, field schema | `avalymia` repo, `.frontier/` | No (not ingested) |
| Saved chat logs (on request) | `avalymia` repo, `.frontier/chat-logs/` | No (not ingested) |
| Images, including map images | `avalymia` repo | No |
| Index: links, backlinks, search text, parsed fields | Server memory, rebuilt from the repo at start | No |
| Drafts, Frontier's AI proposals, discoveries, chats, cost log, AI result cache, settings | Files in `/data/state` | No |
| Agent proposals | Branches `proposal/...` in the `avalymia` repo | No (not `main`) |
| Tiles, thumbnails | `/data/assets`, regenerated from the repo | No |
| Generated concept art, until approved | `/data/assets/generated` | No |

`.frontier/` is a dot-folder, so Obsidian does not show it. The sync must not ingest it; this is confirmed
against the sync before the folder is first used.

Map images are stored in the repository like the existing images, so goal G1 covers them. Whether large
ones use Git LFS is decided in the stage 4 design, when the real sizes are known.

### Git gateway

One module owns every Git operation. Nothing else touches the working copy, and the working copy always
equals the last fetched `main`: Frontier never makes a local commit in it.

*   **Identity.** Frontier pushes as its own GitHub App, installed on the `avalymia` repository only and
    created in stage 1. Its credential is held in server environment variables. A token of the author's
    own account is not used, because Frontier's pushes would then be indistinguishable from his. This is
    the one statement of Frontier's identity; other sections refer to it.
*   **Fetch.** A GitHub webhook on the `avalymia` repo calls Frontier on every push. Frontier fetches,
    moves its working copy forward to the new `main`, and reindexes the changed files. A timer also
    fetches every 5 minutes in case a webhook is missed.
*   **Drafts are not commits.** A draft is held in `/data/state/drafts` as the file's content plus a
    record: an id, a revision number, the file path, the Git blob hash of the version it was based on, and
    the kind (edit, create, delete). A draft of a new image is the image file itself. A rename or move is
    stored as an intent (old path, new path), not as edited copies of the linking notes.
*   **Text form.** The editor, the browser buffer and the draft file hold text with line endings
    normalised, together with a record of the file's original line-ending style. Merging is done on
    normalised text. The original line endings are restored once, when Publish builds the commit.
*   **Publish.** The author selects drafts (all by default) and writes a message. Then:
    1.  Frontier fetches.
    2.  Each draft is classified. If the file on `main` still has the draft's base hash, the draft is
        ready. If the file changed on `main`, Frontier runs a three-way merge of base, draft and `main`;
        a clean result is shown to the author with the incoming changes marked. When he confirms, the
        merged text becomes the draft's content and the version on `main` becomes its base, as when he
        resolves a conflict. If the changes overlap, or the draft deletes a file that changed, the draft is in
        conflict.
    3.  Each rename intent is turned into link rewrites against the fetched `main`. If the list of notes
        to change differs from what the author was shown, it is shown again.
    4.  Ready and confirmed drafts are published as one commit. Drafts in conflict are held back and the
        rest go ahead.
*   **Groups.** Drafts that depend on each other are published together or not at all: a rename with its
    link rewrites, including any draft of a note that the rename also rewrites; the files of one accepted
    proposal; an entry's new `id` with the map or profile that refers to it.
*   **Crash safety.** The commit is built without changing the working copy, and drafts live outside it,
    so the working copy can always be thrown away. At start and after every fetch Frontier resets the
    working copy to the fetched `main`, then clears finished work: a draft whose content equals the file
    on `main` has been published and is removed; so is a delete draft whose file is gone, and a rename
    intent whose new path exists and whose old path is gone. This recovers from a stop at any point of a Publish without a separate record.
*   **Rejected push.** If the push is rejected because `main` moved meanwhile, Publish stops and the drafts
    stay unpublished. The author is told that `main` changed and presses Publish again, which fetches and
    asks for any new confirmations. There is no automatic retry, because a retry could apply a merge the
    author has not seen. Frontier never force-pushes and never rewrites history.
*   **Conflict.** The interface shows the author's version beside the version from `main`, with the
    overlapping parts marked. He edits his draft into the result and confirms, which resets its base hash.
*   **Commit identity.** Commits carry the author's name as author. Commits that include approved AI
    content add a trailer naming the model and the proposal.

### Vault service

*   **Parsing.** Entries are read as text. Frontmatter is parsed with a YAML library that keeps the original
    document, so changing one key is meant to rewrite only that key's lines; the real-vault test checks
    this on every note that has frontmatter. Unknown keys, key order and comments are preserved. The body
    is never re-serialised: the editor edits the text itself.
*   **Line endings.** About 20 notes use Windows line endings and none mixes the two kinds (counted on
    2026-11-20). One function in `packages/vault` restores a file's original line endings when a commit
    is built; every publish goes through it, so the real-vault test covers it. A file that mixes the two
    kinds is opened read-only in Frontier and listed for the author to fix.
*   **Link resolution.** One ordered rule:
    1.  A link with a path resolves to that path. The details (a trailing `.md`, letter case, files that
        are not notes, relative image paths) are in the implementation plan under "Rules settled here".
    2.  A bare name is matched against note file names, ignoring case and surrounding spaces. One match:
        it resolves there.
    3.  Several matches, exactly one of them outside `99 Appendices`: it resolves to that one. This is
        Frontier's stated exception to Obsidian (goal G4).
    4.  Several matches otherwise: the link is ambiguous. Frontier shows the candidates and the author
        picks; the link is then rewritten with its path. Frontier does not guess which one Obsidian would
        choose.

    Aliases are not link targets; autocomplete offers them and writes `[[Note|Alias]]`. This assumes
    Obsidian does the same, which is checked once in stage 1.
    When several notes share a name, autocomplete writes the link with its path. Heading links resolve to
    a heading in the target, or in the same note when no target is given. Image embeds resolve by bare
    file name; the 12 image names that exist more than once, ignoring letter case, are shown as ambiguous and listed for the
    author to rename, so that Frontier and Obsidian cannot show different images.
*   **Rename and move.** Renaming rewrites every link that pointed to the old name or path, in one commit.
    Folder notes (a note named after its folder, 73 today) move with their folder. Files under
    `99 Appendices` are never rewritten: a link from one of them to a renamed or moved entry stays as
    written and becomes unresolved, as it would in Obsidian. These links are listed for the author.
    Following them to the renamed entry is left to the stage 3 design.
*   **Deleting.** A deleted entry is removed in the commit and remains in Git history. Frontier does not
    use the vault's recycle bin folder.
*   **Entry identity.** An entry is identified by its path. It also gets an `id` in frontmatter, a short
    random string that never changes, when a map feature or a profile that refers to it is accepted.
    Pending proposals refer to entries by path and do not cause an `id` to be written. Stage 3 builds the
    mechanism; the first ids are written in stage 4. There is no batch commit adding ids to every note.
    When the index is built, entries that share an `id` (a note duplicated in Obsidian) are listed for the
    author, and references to an `id` that no entry carries are shown as broken.
*   **Append-only guard.** Existing files under `99 Appendices` cannot be drafted. New files can be added;
    a new image whose name already exists gets a number added to its name.

### Index and working files

*   **Index.** Held in server memory and built at start by reading the working copy. It has two layers.
    The published layer is built from `main`: entries, links, aliases, headings, parsed fields, time
    intervals and relations, map features by entry, and a full-text search index. The draft layer holds
    the same for the author's drafts and pending rename intents. Nothing in the index is saved to disk.
    The target for a full build at 500 notes is under 5 seconds. The index is stale when it was built from
    a commit older than the fetched `main`; this is shown in the status area.
*   **Who reads which layer.** The author's own reading, search, backlinks, autocomplete and timeline read
    published plus drafts, with draft-only results marked. Lore conversations, character chat, discovery
    and contradiction checks read the published layer only, without quarantined notes.
*   **Working files** in `/data/state`, all JSON, Markdown or uploaded images:
    *   `drafts/`: unpublished content and its record.
    *   `proposals/`: Frontier's own AI proposals, and the list of rejected proposals with the hash of the
        sentence each was based on.
    *   `discoveries/`: one file per exploring session.
    *   `chats/`: one file per conversation or character session.
    *   `ai-log/`: one line per AI call with tokens and cost, a file per month, written by appending.
    *   `ai-cache/`: field-proposal results by content hash.
    *   `settings.json`: model choices, spending cap, bank address, the password hash, and the AI and
        bank keys encrypted with a key from an environment variable. Secrets are never sent to the browser.
    *   Files other than the log are written by writing a temporary file and renaming it, so a crash
        cannot leave half a file. One server process is the only writer.
*   **Draft revisions.** The server accepts a save only when it carries the revision number the server
    holds, and then increases it. A save carrying an older revision, such as a phone reconnecting after
    the desktop has moved on, is kept as a second version; both are shown for the author to merge, as in
    a Publish conflict. The browser keeps its copy of a draft only until the server confirms it holds that
    revision. Protection after that is the backup.
*   **Backup.** The server process copies `/data/state` and `/data/assets/generated` to an S3-compatible
    storage bucket, named in an environment variable, within 5 minutes of any change and in full every
    night, and records the time of the last successful copy. The key that encrypts the secrets in
    settings is kept in Coolify's environment and in the author's password manager; a restore needs it.
    This is the one statement of the backup schedule; other sections refer to it.

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
*   **Images**: the server returns resized versions by requested width and caches them on disk. An original
    (the largest today is 9 MB) is sent only when the author opens it at full size.
*   **Phone layout**: a bottom bar with search, entries, unpublished changes and status in stages 1 and 2;
    maps, inbox and chat are added by their stages, and status then moves into a menu. A toolbar above the
    keyboard has link, heading, list, image and undo buttons.

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

### Quarantine

`main` is not protected in GitHub: Obsidian pushes to it directly, and whether GitHub offers a rule with
an exception for the author on this private repository has not been confirmed. The stage 3 design checks
this once, since such a rule would stop the breach at its source. Until then an agent can push to `main`
against the vault rules. This section is the one statement of how that is handled.

*   **One owner.** The sync decides quarantine. It already receives GitHub's notification of every push,
    which names the account that pushed; Git itself does not record this. The allowed accounts are the
    author's, Frontier's App and the sync's own. A note changed by a push from any other account is
    quarantined by the sync: it is not ingested, even when a later allowed push touches the same note.
*   **The list.** The sync writes `.frontier/quarantine.json` in the vault and pushes it, only when the
    list changes, so ordinary pushes cause no extra commit. The file holds the quarantined notes, each
    with the commit that caused it. The sync ignores its own pushes.
*   **Frontier's side.** Frontier reads that file. It marks the listed notes as "arrived unreviewed", and
    its AI features leave them out. Frontier never works out who pushed.
*   **Gap.** Between an agent's push and the sync's list arriving, usually seconds, Frontier can read the
    new text as canon. The stage 3 design decides whether to close this gap and how.
*   **Release.** The author accepts the change or reverts it in Frontier. Frontier records the decision in
    `.frontier/review-state.json` and publishes it. When the sync sees that file change in a push by
    Frontier, it removes the note from quarantine and ingests it. Frontier never writes to the bank.
*   **Order of events for an agent push to `main`:** GitHub notifies the sync and Frontier; the sync
    quarantines the changed notes and pushes the updated list; Frontier fetches and shows them; the author
    decides; Frontier publishes the decision; the sync ingests or drops.
*   **Limit.** Quarantine recognises an agent only by the account it pushes with. The Hermes agents can be
    given their own account. An agent that pushes under the author's own GitHub authorisation, as cloud
    coding sessions may, looks like the author and is not quarantined. For those the only protection is
    the rule in `AGENTS.md` to push `proposal/` branches. Which agents fall in which group is established
    in the stage 3 design.
*   Until the author decides, the text is on `main` and visible to Obsidian and to other agents.

File formats, and what the sync does when it misses a notification, are settled in the stage 3 design. The sync changes are listed under "Changes outside this
repository".

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

A relation inside a `when` refers to another entry by wikilink, as in the example. It is resolved like any
other link, and a rename in Frontier rewrites it, in frontmatter as in the body. A rename made in Obsidian
or by an agent may not rewrite it:
Obsidian is not known to update a link that is part of a sentence inside a nested list. Such a relation
then shows as unresolved, in the same list as other unresolved links, and the author picks the new target.
The stage 3 design tests Obsidian's behaviour; if these breaks prove frequent it may add automatic repair
or move the target into a key of its own. Obsidian's properties panel is
also not known to edit nested lists such as `time`; in Obsidian these are edited in source view. Map
features and profiles, which are not Markdown, refer to entries by `id`.

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
    at the Skyrim icons already in `99 Appendices/07 Icons/Skyrim`. A map selects the sets it uses. Those
    icons belong to a commercial game, so an export meant for the public needs a different set selected.
*   **Renderer.** Frontier draws its own maps with the mesh method.
    *   The server cuts each source image into a pyramid of tiles in the image's own projection.
    *   In the browser, each visible tile is drawn in WebGL as a small grid of triangles. The corners of
        the grid are positions in the map's space, turned into screen positions by the current
        projection. Choosing which tiles and which level to draw is ordinary visibility testing.
    *   Sphere images are converted once, at import, to equirectangular tiles, so tile corners are plain
        longitude and latitude. The cost is one resampling of the image.
    *   For the sphere, projection uses the `d3-geo` and `d3-geo-projection` libraries: the first has the
        globe view, equirectangular, Mercator and Natural Earth; the second has Robinson, Mollweide,
        Winkel Tripel and Fahey. Drawing tiles needs only the forward direction. Taps, drawing tools and
        measuring need the reverse direction for single points, which both libraries provide. No new
        projection maths is written. Flat space needs none.
    *   Grid cells behind the globe or across the map's seam are dropped or split before drawing, since
        projecting bare corners does not clip them.
    *   Markers, lines, zones and labels are projected with `d3-geo` and drawn on a canvas above.
        `d3-geo` already draws great-circle lines and cuts shapes at the edge of the globe and at the
        map's seam.
    *   Small libraries without an interface of their own are used for touch gestures and for finding
        which feature was tapped. Pan, zoom, rotate, drawing and measuring tools are built in Frontier
        and work in space coordinates, so they behave the same in every projection.
*   **What is reused from `map-reprojector`.** The choice of `d3-geo`, the list of projections the author
    uses, and the idea of rotating the globe before projecting. Its code is not carried over: it redraws
    every pixel on the processor, assumes a full-globe image, and its interface is tied to mouse and
    keyboard.
*   **Known difficulties**, to be settled in the stage 4 design before any drawing tool is built: visible
    seams where a projection splits the map; the speed and accuracy of the reverse direction in projections
    that compute it by iteration; how dense the triangle grid must be near the poles and the
    globe's edge; a frame-rate target on a mid-range phone, with lower-resolution tiles while moving as
    the fallback.
*   **Order of building**: flat space with markers; then sphere in equirectangular and globe views; then
    paths, zones, layers and measuring; then other projections; then cylinder and schematic spaces.
*   **Fallback.** If phone performance or the volume of work blocks later stages, flat and globe views
    ship alone and the rest is deferred.

### AI service

*   **Provider.** All model calls go through one interface to OpenRouter, with model names per task
    (extraction, conversation, character, discovery, image) set in the settings screen. Every call is
    appended to the cost log with tokens and cost. The hard spending limit is set on the OpenRouter key
    itself. Frontier's own monthly cap stops calls earlier, with a message that states the cap, the amount
    spent and where to change it. The provider connection, key, cost log and cap are built in stage 3.
*   **Hindsight.** A client for the `worldbuilding` bank, configured in settings (address, bank name, key,
    test button). Frontier only reads from the bank; the bank is fed by the sync from `main`.
*   **Grounding.** For lore questions and contradiction checks: recall from the bank, then read the actual
    files for the entries recalled, then answer from the file text. Recall from the bank is combined with a search of
    Frontier's own index by time, alias and entry type, because confirmed dates and aliases reach the bank
    late. A bank result that names a path which no longer exists is dropped. Grounding
    reads published text only, never drafts. Claims cite entries, which the interface shows as links. This follows the vault rule that lore is never quoted from the bank.
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
    embedded in the new entry, in the same Publish. Image calls count toward the cap and are estimated to
    be the largest part of discovery cost.
*   **Art styles.** The author defines named styles in a settings screen; they are files in
    `.frontier/art-styles/`. What a style contains, how defaults are chosen and when art is generated are
    settled in the stage 8 design. The intent recorded here: a style description added to every prompt,
    a default per kind of discovery, a choice of style when generating, and a setting for whether art is
    made for every discovery, only on opening one, or never.
*   Stage 8 gets its own design, including prompts, context limits and the marking of improvised lines.

### Login and security

*   One account. Password stored as an argon2id hash; a signed session cookie that is HTTP-only, secure
    and same-site, so no session store is needed. Login attempts are rate-limited. A passkey is added in
    stage 3, before Frontier holds AI keys.
*   The GitHub App credential, AI key and bank key stay on the server.
*   Webhook calls from GitHub are verified by their signature.
*   **Untrusted text.** Everything rendered from Markdown is treated as untrusted: vault notes, agent
    branches and AI output. Rendered output is sanitised: no script, no event-handler attributes, no
    embedded frames, and links limited to web and vault addresses. The app sends a content security policy
    that forbids inline script and scripts from other origins. This matters because the session that
    displays an agent's proposal can publish to canon and spend the AI budget.

### Seeing failures

*   A status area shows: unpublished drafts, last fetch and push, a failed push, the commit the index was
    built from and whether it is stale, agent branches waiting, quarantined notes, entries with a
    duplicate `id` and references to an `id` no entry has, files with mixed line endings (read-only), links from
    appendix files to renamed entries, last backup, AI spend this month, and whether the bank can be
    reached.
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

1.  `avalymia/AGENTS.md` and the Synchronization section of `avalymia/README.md`: agents push to
    `proposal/<agent>/<topic>` branches, never to `main`, and push with their own GitHub identity; they
    leave `.frontier/` alone and keep an entry's `id`; the "Automation in place" section describes the
    new sync rules.
2.  The sync, three changes: skip changes that touch only frontmatter, whitespace or line endings;
    quarantine notes pushed by anyone other than the author or Frontier and publish the list; release and
    ingest a note when Frontier's review-state file says so. It must also ignore the rest of `.frontier/`.
3.  `avalymia`: the `.frontier/` folder. It first appears in stage 1 with the link baseline; its other
    contents arrive from stage 3.
4.  GitHub: a webhook from `avalymia` to Frontier; Frontier's GitHub App; a separate identity and token
    for outside agents.
5.  `99 Appendices/06 Interactive Maps/Main.json` is removed when the first map file exists. The
    append-only guard forbids this in Frontier, so the author removes it by hand, once.

## Risks and mitigations

| Risk | Impact | Mitigation | Stage |
| --- | --- | --- | --- |
| The server disk is lost | Unpublished work since the last backup is gone: drafts, pending proposals, discoveries, chats, cost log, settings. Canon is not affected. | Backup within 5 minutes of a change and nightly; a restore is tested before stage 2 is done. | 1 |
| No database, no query language | Each new kind of question about the data needs a function written for it; start-up indexing grows with the vault. | Index functions live in tested packages. Revisit the index if a build passes 5 seconds or the vault passes about 5,000 entries. | 1 |
| An agent pushes to `main` | Unreviewed text is on `main`, visible in Obsidian and to other agents. | Quarantine keeps it out of the bank and out of Frontier's AI answers until the author decides. | 3 |
| An agent pushes under the author's own account | Quarantine cannot see it; its text is treated as the author's. | The `AGENTS.md` rule to push `proposal/` branches; separate identities wherever the agent allows one. | 3 |
| Gap before the quarantine list arrives | For some seconds after an agent's push to `main`, Frontier's AI features may read the new text as canon. | Accepted for now; the stage 3 design decides whether to close it. | 3 |
| Goal G8 depends on the sync | The sync is code outside this repository; if its changes are not made, quarantine does not exist. | The sync changes are a stage 3 deliverable, with a test push before stage 3 is called done. | 3 |
| The sync skips frontmatter-only changes | Confirmed dates and new aliases reach the bank only when the entry's text next changes; renames leave old paths in the bank. | Frontier's answers combine bank recall with its own index and drop results whose path is gone. | 3, 8 |
| Obsidian may not rewrite links inside time fields | A time relation points at an old name after a rename made outside Frontier. | It shows as unresolved and the author picks the target; tested in the stage 3 design, which may add automatic repair. | 3 |
| Custom map renderer | Seams where a projection splits the map; slow panning on phones; the largest stage of work. | Settle seams, grid density and a frame-rate target in the stage 4 design; fallback to flat and globe views only. | 4 |
| One password guards an account that can push to canon | A guessed or stolen password allows publishing and AI spending. | Rate-limited login from stage 1; passkey in stage 3; the AI spending limit on the provider key bounds the cost. | 1, 3 |
| Image tiling and backup run in the API process | A large import could slow the app while it runs. | Both run one job at a time at low priority; whether tiling needs its own process is decided in the stage 4 design. | 1, 4 |
| AI cost | Spending grows with conversations, discovery and images. | First estimate: under 10 US dollars a month for field proposals and conversations, more with heavy image use; not priced against live rates. A cap in Frontier and a hard limit on the provider key. | 3, 8 |
| Untrusted text from agents | Script in a proposal could act with the author's session. | Sanitised rendering and a content security policy. | 1 |

## Alternatives Considered

### Product

#### Hosted worldbuilding tools (World Anvil, LegendKeeper, Kanka)

*   **Pros**: Maps, timelines and wikis exist today with no build effort.
*   **Cons**: Data lives in the vendor's storage. No overlap across calendars, no time dilation, no approval flow for AI, no link to the bank.
*   **Reason for Rejection**: They cannot keep Markdown in Git as canon, which the sync, Obsidian and the agents all depend on.

#### Staying on Obsidian with plugins

*   **Pros**: No new app. The Leaflet, timeline and calendar plugins cover simple cases.
*   **Cons**: No overlap across calendars, no maps that change with time, no review inbox. The installed Leaflet plugin holds no markers after years of availability.
*   **Reason for Rejection**: The two things the author most needs, overlap across calendars and maps tied to time, have no plugin.

#### Frontier as a reading companion first, editor later

*   **Pros**: The first release would deliver a timeline or a map and skip the hardest part, an editor fit to replace Obsidian.
*   **Cons**: Two tools in daily use for longer. Writing, the daily activity, stays outside the app.
*   **Reason for Rejection**: The author wants one place for all work on the world; a companion leaves the split between tools in place. The cost is recorded in the decisions table.

### Data

#### Canon in Frontier's own database

*   **Pros**: Fast queries, structured fields without frontmatter, no Git handling.
*   **Cons**: Breaks the sync to the bank, Obsidian access, Git history and the agents' workflow.
*   **Reason for Rejection**: Every other tool the author uses reads the Markdown files; moving canon would cut all of them off.

#### Working state in Postgres or SQLite

*   **Pros**: A query language, transactions, built-in full-text search.
*   **Cons**: Postgres is a second service to run and back up. SQLite ties data to one file and one process.
*   **Reason for Rejection**: At 500 notes the whole vault is indexed in memory in seconds, so a database adds something to run without adding a capability the design needs.

#### Frontier's own proposals and discoveries as Git branches

*   **Pros**: Pending work has a copy off the server and can be browsed on GitHub.
*   **Cons**: A full copy of an entry on a branch goes stale when `main` changes and can overwrite newer canon when accepted. Every explore tap becomes a push. Invented material sits in the canon repository.
*   **Reason for Rejection**: Staleness: a proposal must apply to the entry as it is when accepted, which small operation files on the server do and branch snapshots do not.

#### Working files in a second private repository

*   **Pros**: History and an off-server copy with no backup job.
*   **Cons**: A second set of Git operations and a commit for every autosave.
*   **Reason for Rejection**: Autosave would create thousands of commits; a storage bucket gives the off-server copy without them.

#### Time data on maps, or map data on entries

*   **Pros**: Everything about a place in one file.
*   **Cons**: Entries fill with coordinates and styling. The same time facts are kept twice and drift apart.
*   **Reason for Rejection**: Each fact needs one home: dates on entries, positions on maps.

#### Mandatory conversion between calendars

*   **Pros**: One shared axis for every event and simple timeline arithmetic.
*   **Cons**: Needs pulse rates, anchors and leap rules that the lore does not define.
*   **Reason for Rejection**: It would force canon numbers to be invented before any date could be stored.

#### Character profiles in `99 Appendices/09 Agents`

*   **Pros**: Readable in Obsidian, beside the existing `Yagon.md`.
*   **Cons**: The folder is append-only, so a profile could not be revised. The sync would ingest invented voice and mannerisms as lore.
*   **Reason for Rejection**: A profile must be revisable and must stay out of the bank; neither holds in that folder.

### Writing and publishing

#### Each autosave is a commit

*   **Pros**: No draft storage; every change is in Git.
*   **Cons**: Floods history, breaks the vault rule of one logical change per commit, and makes the sync ingest half-written text.
*   **Reason for Rejection**: Each commit on `main` triggers a paid ingestion into the bank and becomes canon at once.

#### A block-style editor (TipTap, BlockNote, Milkdown)

*   **Pros**: A formatted writing surface with less editor code to write.
*   **Cons**: These convert Markdown to their own model and write it back in their own style, changing lines the author did not touch.
*   **Reason for Rejection**: It breaks goal G2 and causes needless re-ingestion.

### Agents

#### Agents submit proposals to a Frontier endpoint

*   **Pros**: One inbox and one format for every proposal; no branches in the repository.
*   **Cons**: Every agent needs network access to the author's server and a tool for it.
*   **Reason for Rejection**: Agents in restricted networks, such as cloud coding sessions, can reach GitHub but not the author's server.

#### Agents keep pushing to `main`, reviewed afterwards

*   **Pros**: No change for the agents.
*   **Cons**: Unreviewed text is canon and in the bank before the author sees it.
*   **Reason for Rejection**: It contradicts goal G8.

#### Blocking agents from `main` with a GitHub rule

*   **Pros**: The breach becomes impossible.
*   **Cons**: Depends on a GitHub feature whose availability for this private repository was not confirmed.
*   **Reason for Rejection**: The quarantine in the sync needs no GitHub feature and keeps the bank clean either way. A rule can be added later.

### Maps

#### MapLibre GL

*   **Pros**: WebGL speed, built-in touch gestures, flat and globe views from the same data.
*   **Cons**: Knows only Mercator and globe. World images must be re-cut to Mercator, the poles are cut off in the flat view, and other projections stay a separate tool.
*   **Reason for Rejection**: The author wants to work, not only export, in other projections and on the whole sphere including the poles.

#### Leaflet with a separate view-only globe

*   **Pros**: The shortest path to working flat maps; a drawing plugin exists.
*   **Cons**: Two renderers to keep in agreement, and no editing on the globe.
*   **Reason for Rejection**: Editing on the globe is required.

#### Custom renderer with a per-pixel shader

*   **Pros**: No seams, and each screen pixel is computed exactly.
*   **Cons**: New shader maths for every projection, none for projections without a closed formula, and an unsolved problem of reading many tiles in one shader.
*   **Reason for Rejection**: The mesh method gets every projection from existing libraries with no new projection maths.

#### Embedding the `map-reprojector` app

*   **Pros**: Reprojection available at once.
*   **Cons**: It redraws every pixel on the processor, assumes a full-globe image, has no touch input and no tests.
*   **Reason for Rejection**: Nothing in it beyond its choice of libraries carries over to a phone-first, editable map.

### Deployment

#### Interface and API as two deployments

*   **Pros**: Interface changes never restart the server holding the data.
*   **Cons**: Cross-domain login cookies, which phone browsers restrict, and two versions to keep compatible.
*   **Reason for Rejection**: A restart costs seconds and loses nothing, because drafts are on disk and in the browser.

#### Next.js

*   **Pros**: Server-rendered pages load fast on a phone.
*   **Cons**: Long-running Git operations, AI streaming and image tiling fit its request model poorly and would need a second process.
*   **Reason for Rejection**: The app is mostly interactive tools that gain little from server rendering.

--------------------------------------------------------------------------------

## Non-Functional Requirements

### Security and privacy

*   The server holds a token that can push to canon, so the whole app is behind login. No page or API route
    is public except the login page, the GitHub webhook (signature-checked) and `/health`, which returns
    times and a commit hash and no vault content.
    Rendering rules for untrusted text are under "Login and security".
*   Vault text is sent to OpenRouter models and to the self-hosted Hindsight bank, and nowhere else. The
    settings screen lists which models receive text.
*   Secrets are encrypted at rest and never reach the browser.
*   Text from the vault and from agent branches is treated as data, never as instructions, in every AI
    prompt.

### Performance

*   Server start, including the index build over 500 notes: under 5 seconds.
*   Entry page on a phone over 4G: under 2 seconds, with resized images.
*   Typing: under 50 ms from keystroke to screen in a 50,000-word note (the largest file in the vault is
    the compiled book).
*   Search results while typing: under 100 ms of server time.
*   Map frame rate target and tile sizes: set in the stage 4 design.

### Cost

*   AI spend is capped monthly. Field proposals use a small model. Image generation is the largest cost and
    is made on opening a discovery unless the author changes the setting.
*   Hindsight ingestion cost stays as today: one ingestion per published note, none for formatting-only
    changes, none for branches.

### Rollout and rollback

*   In stages 1 and 2 Frontier writes to the vault only what the author publishes: his own edits, renames
    and uploaded images. The one exception is the link baseline, `.frontier/baseline/links.json`, which the author commits in
    stage 1. The rest of `.frontier/` arrives in stage 3. Obsidian keeps working throughout.
*   Entry ids, the `AGENTS.md` change and the sync changes come with stage 3. The vault changes
    are ordinary commits that can be reverted.
*   Rollback at any time: stop the container. The vault, with all published work, is intact in GitHub and
    opens in Obsidian. Unpublished drafts and chats are in the backup as readable files.

### Backup

*   As stated under "Index and working files". A restore is tested once before stage 2 is called done.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

This plan covers stage 1 (foundation) and stage 2 (reader and editor). Stages 3 to 9 each get their own
design document under `docs/designs/` before they are built.

### What each stage delivers

Each stage is a set of journeys that work from end to end. Every file below is marked S1 or S2.

*   **Stage 1 (S1):** log in; see the folder tree; create and delete an entry; read an entry as rendered
    text with its images; edit an entry as source text with drafts saved; see unpublished changes;
    Publish, including confirming a merge and resolving a conflict; see the status area and the attention
    list. The interface works and is unstyled. Rename and move work on the server and are tested there;
    their screen comes in stage 2.
*   **Stage 2 (S2):** everything else at Obsidian parity: live preview, link autocomplete, hover preview,
    backlinks and outline panels, quick switcher, search, table editing, properties panel, image upload
    and sizing, rename and move, create-from-link, the ambiguous-link picker, the phone layout and
    toolbar, and styling.
*   **Stage 1 is done when** its goal checks pass (see Verification Plan) and the author has published one
    real edit to the vault from the deployed app. **Stage 2 is done when** the author has written and
    published from desktop and phone for a week without opening Obsidian for anything in the parity list.

### Dependencies

Versions are pinned in `package-lock.json` at the time of the first install.

| Workspace | Library | Used for |
| --- | --- | --- |
| all | `typescript`, `eslint`, `prettier`, `vitest`, `@vitest/coverage-v8` | Language, lint, format, unit tests, coverage |
| `packages/schema` | `zod` | Types and validation shared by server and web |
| `packages/vault` | `yaml` | Reading frontmatter and editing one key |
| `apps/server` | `fastify`, `@fastify/static`, `@fastify/secure-session`, `@fastify/rate-limit` | API, serving the web build, signed session cookie, login limit |
| `apps/server` | `argon2`, `sharp`, `file-type`, `fastify-raw-body` | Password hash, image resizing, image type detection, the unparsed webhook body for its signature check |
| `apps/server` (S2) | `minisearch` | Full-text search; the snippet is cut by `search.ts` |
| `apps/server` | `@octokit/auth-app`, `@aws-sdk/client-s3` | GitHub App tokens, backup bucket |
| `apps/server` (S2) | `@fastify/multipart` | Image upload |
| `apps/web` | `react`, `react-dom`, `react-router`, `vite` | Interface and build |
| `apps/web` | `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-sanitize`, `rehype-react`, `unist-util-visit` | Rendering Markdown, tables, sanitising; wikilinks and embeds are turned into links by Frontier's own remark plugin |
| `apps/web` | `codemirror`, `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/lang-markdown`, `@codemirror/autocomplete`, `@lezer/markdown` | Editor and live preview |
| `apps/web` | `idb`, `diff` | Browser draft store, showing differences |
| `apps/web` | `@playwright/test` | Browser tests |

Git is used through the `git` program, not a library. The server sends vault text to the browser as it
is; rendering, sanitising and showing differences all happen in the web app, so those libraries are not
needed on the server. Node 22, TypeScript strict mode, npm workspaces.
Prettier is never run on vault files or on fixture files that copy vault forms.

### Settings and environment variables

| Variable | Meaning | From stage |
| --- | --- | --- |
| `PUBLIC_URL` | The app's address | S1 |
| `DATA_DIR` | The data disk, `/data` | S1 |
| `VAULT_REPO` | `elad-haviv/avalymia` | S1 |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID` | Frontier's GitHub App | S1 |
| `WEBHOOK_SECRET` | Checks GitHub's webhook signature | S1 |
| `SESSION_KEY` | 32 random bytes, base64, for the session cookie | S1 |
| `COMMIT_AUTHOR_NAME`, `COMMIT_AUTHOR_EMAIL` | The author's name and email on commits | S1 |
| `COMMIT_BOT_NAME`, `COMMIT_BOT_EMAIL` | The App's bot name and its GitHub no-reply address, used as committer | S1 |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`, `BACKUP_S3_PATH_STYLE` | Backup bucket | S1 |
| `VAULT_REMOTE_URL` | Optional. A Git address used in place of GitHub, for tests and local runs; the three App variables and `WEBHOOK_SECRET` are then not required | S1 |
| `BACKUP_LOCAL_DIR` | Optional. A folder used in place of the bucket, for tests and local runs; the bucket variables are then not required | S1 |

Fixed values: a session lasts 30 days. Login allows 5 attempts per 15 minutes per network address. The
session cookie is HTTP-only, secure, same-site `lax`. The content security policy is
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`.
The timer fetch runs every 5 minutes. A missing required variable stops the server at start with a message
naming the variable. Fastify runs with `trustProxy` on, because Coolify's proxy sits in front of it; the
login limit and the secure cookie depend on that.

### Git operations

All run in `apps/server/src/git/gateway.ts`, one at a time under a lock. An operation that waits more than
60 seconds for the lock fails with the error code `git_busy`.

*   **Authentication.** `@octokit/auth-app` supplies an installation token and renews it itself. For each
    `git` call that talks to GitHub the token is passed through the environment variables
    `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=http.https://github.com/.extraheader` and
    `GIT_CONFIG_VALUE_0=Authorization: Basic <base64 of "x-access-token:TOKEN">`. It is never put on a
    command line, written to disk or stored in Git's configuration. With `VAULT_REMOTE_URL` set, no token
    is used.
*   **Clone.** On first start: `git clone https://github.com/<VAULT_REPO>.git /data/vault`, or the address
    in `VAULT_REMOTE_URL`.
*   **Fetch.** `git fetch origin main`, then `git reset --hard origin/main` and `git clean -fd` in the
    working copy. The working copy holds no local changes, so nothing is lost. The files to reindex come
    from `git diff --name-status -z <previous commit> origin/main`.
*   **Read.** `git show <commit>:<path>` for a file at a commit; `git rev-parse <commit>:<path>` for its
    blob hash.
*   **Commit without touching the working copy.** With `GIT_INDEX_FILE` set to a temporary file:
    `git read-tree origin/main`; for each changed file, its bytes piped to
    `git hash-object -w --no-filters --stdin`, then
    `git update-index --add --cacheinfo 100644,<blob>,<path>`; for each deletion and for the old path of
    a rename, `git update-index --force-remove -- <path>`; `git write-tree`; `git commit-tree` with
    `origin/main` as parent, the author from `COMMIT_AUTHOR_NAME` and `COMMIT_AUTHOR_EMAIL`, and the
    committer from `COMMIT_BOT_NAME` and `COMMIT_BOT_EMAIL`.
*   **Push.** `git push --porcelain origin <commit>:refs/heads/main`. Never `--force`,
    `--force-with-lease` or a `+` before the reference. A line marked `! [rejected]` is reported as
    `main_moved`. Any other failure, such as the network or authentication, is reported as `push_failed`.
*   **Three-way merge of one text file.** The draft, the base and the `main` version are written to
    temporary files with line endings normalised and passed, in that order, to
    `git merge-file -p --diff3 <draft> <base> <main>`. Exit code 0 is a clean merge. Exit codes 1 to 127
    mean overlapping changes, and the draft is in conflict. Any other exit is an error, reported as
    `merge_failed`; the draft is left as it was.

### Stored form of working files

```text
/data/state/
  drafts/<draftId>/record.json      the draft's record
  drafts/<draftId>/content          text with normalised line endings, or image bytes
  drafts/<draftId>/record.v2.json   present only when another device saved an older revision
  drafts/<draftId>/content.v2
  drafts/renames/<intentId>.json    { id, from, to, createdAt }
  settings.json                     { passwordHash }
  backup.json                       { lastSuccessAt, lastError }
```

A draft record:

```json
{
  "id": "k3f9x2ab7qpd",
  "revision": 4,
  "path": "03 Gazetteer (Places & Locations)/Planes of Existence/Ezob/Ezob.md",
  "kind": "edit",
  "baseBlob": "9c1e0f...",
  "lineEnding": "lf",
  "binary": false,
  "updatedAt": "2026-11-20T18:04:11Z"
}
```

`kind` is `edit`, `create` or `delete`. `baseBlob` is empty for `create`; the content of a `delete` draft
is empty. `lineEnding` is `lf` or `crlf`.

*   **Ids** are 12 random characters from lower-case letters and digits, made by the browser, so a draft
    started with no connection already has its key. Rename intent and plan ids are made by the server.
*   **One draft per path.** If a save arrives with a new id for a path that already has a draft, the
    server treats it as an older revision of the existing draft.
*   **Revisions** start at 0. A save carries the revision the client last saw. If it equals the stored
    revision, the content is replaced and the revision increases by 1. If it is lower, the server writes
    the content as `content.v2`, keeps the stored content, and answers `stale_revision` with the id of
    the stored draft. The browser then fetches both versions and shows them; the author produces one text
    by hand, which is saved through `merge-versions`, and the `.v2` files are removed.

The browser store (IndexedDB, through `idb`) has one table, `drafts`, keyed by draft id:
`{ id, path, kind, text, revision, sent }`. A row is removed once the server confirms that revision.

### API

JSON in and out, under `/api`. Every route except `POST /api/login`, `POST /api/github/webhook` and
`GET /health` needs a session. An error is `{ "error": { "code": "...", "message": "..." } }`. Codes:
`unauthenticated` (401), `rate_limited` (429), `not_found` (404), `append_only` (403), `read_only_file`
(403, mixed line endings), `stale_revision` (409), `main_moved` (409), `plan_expired` (410), `git_busy`
(503), `push_failed` (502), `merge_failed` (500), `invalid` (400).

Shapes not shown in the table are fixed in `packages/schema` as follows. `GET /api/tree`:
`{ folders: [{ path, folders, notes: [{ path, title, state }] }] }`. `state` is `published`,
`unpublished`, `conflict` or `quarantined` (from stage 3). In `GET /api/entries`, `links` is
`[{ raw, from, to, kind, target?, candidates? }]` with `kind` one of `resolved`, `unresolved`,
`ambiguous`, `outside`, `image`; `backlinks` is `[{ path, title, line }]`; `headings` is
`[{ level, text, line }]`; `draft` is `{ id, revision, kind }` or null. `GET /api/attention`:
`{ ambiguousLinks, duplicateImages, mixedEndings, brokenAppendixLinks, nearFolderNotes }`, each a list of
paths with the detail needed to show it. Status events are server-sent events named `status`, whose data
is the whole snapshot. The webhook route reads the unparsed body to check GitHub's signature.

| Method and path | Body | Response | Stage |
| --- | --- | --- | --- |
| `POST /api/login` | `{ password }` | `{ ok }`, sets the cookie | S1 |
| `POST /api/logout` | none | `{ ok }` | S1 |
| `GET /api/session` | none | `{ loggedIn }` | S1 |
| `GET /api/tree` | none | folders and notes with each note's state | S1 |
| `GET /api/entries?path=` | none | `{ path, text, lineEnding, readOnly, state, links, backlinks, headings, draft }` | S1 |
| `PUT /api/drafts` | `{ id, path, kind, text, revision }` | `{ id, revision }`, or `stale_revision` with `{ id }` of the stored draft | S1 |
| `GET /api/drafts/:id/versions` | none | `{ current: { text, revision }, other: { text } }` | S1 |
| `DELETE /api/drafts/:id` | none | `{ ok }` | S1 |
| `POST /api/drafts/:id/merge-versions` | `{ text }` | `{ id, revision }` | S1 |
| `GET /api/unpublished` | none | `{ drafts: [{ id, path, kind, text, mainText }], renames: [{ id, from, to, affected }] }`; the browser shows the differences | S1 |
| `POST /api/publish/plan` | `{ draftIds, renameIds }` | the plan (below) | S1 |
| `POST /api/publish/confirm` | `{ planId, confirmedMergeIds, message }` | `{ commit }` or `main_moved`, `plan_expired` | S1 |
| `POST /api/drafts/:id/resolve` | `{ text }` | `{ id, revision }`; sets the draft's base to current `main` | S1 |
| `GET /api/images?path=&w=&draft=` | none | the image in its own format; `w` is 320, 640, 1280 or absent for the original; never enlarged; `path` must lie inside the vault; with `draft`, the unpublished image of that draft | S1 |
| `GET /api/status` | none | the status snapshot | S1 |
| `GET /api/status/events` | none | server-sent events with status changes | S1 |
| `GET /api/attention` | none | lists: ambiguous links, duplicated image names, mixed-ending files, appendix links broken by a rename | S1 |
| `POST /api/github/webhook` | GitHub's push event | `{ ok }` | S1 |
| `GET /health` | none | `{ ok, indexCommit, lastFetchAt, lastBackupAt }` | S1 |
| `POST /api/renames` | `{ from, to }` | `{ id, affected: [paths] }` | S1 server, S2 screen |
| `DELETE /api/renames/:id` | none | `{ ok }` | S1 server, S2 screen |
| `GET /api/search?q=&appendices=` | none | `{ results: [{ path, title, snippet, draftOnly }] }`; `appendices=1` includes `99 Appendices` | S2 |
| `GET /api/switcher?q=` | none | `{ results: [{ path, title, alias? }] }` | S2 |
| `GET /api/preview?path=` | none | `{ path, text }`, the first 600 characters of the body as Markdown | S2 |
| `POST /api/images` | multipart file | `{ path, embed }`; creates a draft | S2 |

**Publish in two calls.** `POST /api/publish/plan` fetches, classifies each selected draft and returns:

```json
{
  "planId": "p7d2k1m9x0aa",
  "mainCommit": "4e1b...",
  "ready": ["draftId"],
  "merges": [{ "id": "m1", "draftId": "...", "path": "...", "mergedText": "...", "mainText": "...", "baseText": "..." }],
  "conflicts": [{ "draftId": "...", "path": "...", "mine": "...", "theirs": "...", "base": "..." }],
  "renames": [{ "id": "...", "from": "...", "to": "...", "affected": ["paths"] }],
  "groups": [["draftId", "renameId"]]
}
```

The server keeps a plan in memory for 15 minutes and nothing else between the two calls.
`POST /api/publish/confirm` is refused with `main_moved` when `main` is no longer at `mainCommit`, and with
`plan_expired` after 15 minutes; the browser then asks for a new plan. Otherwise the server publishes the
ready drafts, the merges named in `confirmedMergeIds` and the renames, leaving out any group that contains
a conflict or an unconfirmed merge, as one commit. For each confirmed merge it first writes the merged
text into the draft and sets the draft's base to the `main` version, and only then builds the commit.
After the push it fetches, which resets the working copy and clears the published drafts. "Equals `main`"
is judged on the bytes after line endings are restored.

**Classification, all cases.** For a text file: unchanged on `main`, ready; changed on `main`, three-way
merge, giving a merge to confirm or a conflict. A `create` draft whose path now exists on `main` is a
conflict. An `edit` draft whose file is gone from `main` is a conflict; the author chooses to recreate the
file or discard the draft. A `delete` draft whose file changed on `main` is a conflict. An image changed
both in a draft and on `main` is a conflict; the author chooses one.

**Renames and drafts.** `POST /api/renames` takes a note or a folder; a folder is one intent. Until
Publish, a draft of a renamed note keeps its old path in storage, and the tree and index show the note
under its new path. At Publish the draft's content is written at the new path. Link rewrites are applied
to the draft text of a linking note when it has a draft, and to its `main` text otherwise, and that note
joins the rename's group.

### Rules settled here

*   **Link resolution, rule 1 in full.** A link with a path: a trailing `.md` is ignored; letter case is
    ignored, and if two files then match the link is ambiguous; a path to a file that is not a note, or
    inside an excluded folder, is shown as a reference to an outside file and not as a missing entry. A
    standard Markdown image with a relative path resolves against the folder of the note containing it.
*   **What is not a link, and one more link form.** A wikilink inside inline code or a code block is text,
    not a link, as in Obsidian; 68 such cases exist in appendix files. A standard Markdown link to a note,
    such as `[Core Themes & Tone](00%20Overview/Core%20Themes%20%26%20Tone.md)` in the vault's README, is
    a link: its address is URL-decoded, resolved against the containing note's folder, and rewritten on
    rename.
*   **Folder note.** A note whose file name equals its folder's name. 73 exist. A folder move takes its
    folder note with it; a rename of the folder renames the folder note. Five notes look like folder notes
    under a slightly different name (`Orphans/The Orphans.md`, `Ru'una/Ru'una (Moon).md`,
    `Ataemmia/Ataemia.md`, `Scorched Realm/The Scorched Realm.md`, `Derdaman Sun/The Derdaman Sun.md`);
    they are ordinary notes and appear once in the attention list.
*   **Image names** are compared ignoring letter case, across the whole vault. 12 names exist more than
    once. An uploaded image whose name exists anywhere gets ` 2`, ` 3` and so on before the extension.
*   **Image size.** Obsidian's form: `![[name.png|300]]`, the number being a width in pixels. The parser
    reads it; the reader applies it; in stage 2 the author sets it by dragging the image's edge.
*   **Excluded folders:** `.git`, `.obsidian`, `.claude`, `.gemini`, `.frontier`. They are not indexed.
*   **Append-only:** everything under `99 Appendices`. `paths.ts` answers whether a path may be edited;
    `drafts.ts` refuses a draft for an existing file there with `append_only`. `99 Appendices/03 Recycle
    Bin` is an appendix folder like the others and is left out of autocomplete, the quick switcher and
    search unless the author asks to include appendices.
*   **Create from a link** suggests the folder of the note that contains the link.
*   **Malformed frontmatter:** the note opens as plain text with a warning, and its fields are not indexed.
*   **Adding or removing a note** re-resolves every link whose target is that name.
*   **Frontmatter edits.** `frontmatter.ts` uses `yaml` to read. To write one key it uses the package's
    document interface. If the real-vault test shows any other line changing, the function is changed to
    replace the key's own lines in the text directly; the test stays the same.
*   **Search:** title and aliases weigh 3, headings 2, body 1; a snippet is 160 characters around the
    first match. These are starting values.
*   **Backup:** every write to `/data/state` sets a "changed" mark; a copy to `latest/` in the bucket runs
    5 minutes after the first unsaved change and mirrors deletions, so a restore does not bring back
    published drafts. At 03:00 server time a full copy goes to `nightly/<date>/`,
    and nights older than 14 days are removed. Backup and image resizing share one queue that runs a
    single job at a time.
*   **Link baseline location.** The baseline lists real note titles, so it is kept in the vault
    repository at `.frontier/baseline/links.json`, with the vault commit it was made from recorded inside
    it. Its shape is `{ vaultCommit, resolved: [{ note, link, target }], unresolved: [{ note, link }],
    ambiguous: [{ note, link, candidates }], outside: [{ note, link }] }`. This is the one file in
    `.frontier/` before stage 3. The author commits it by hand after
    reviewing it. The test compares its result with the file. When the checkout is at
    another commit than `vaultCommit`, it prints the differences and passes, and says the baseline needs
    regenerating; at the same commit any difference fails.
*   **Obsidian attachment folder.** Obsidian has none set, so images pasted there land in the vault root.
    Frontier uploads to `99 Appendices/01 Images`. Setting Obsidian's attachment folder to match is
    recommended and is the author's change to make.

### Fixture vault

`packages/vault/test/fixture-vault/`, made-up content only:

| File | Case it covers |
| --- | --- |
| `README.md`, `AGENTS.md` | Notes at the vault root |
| `01 Places/Harbor/Harbor.md` | Folder note; frontmatter with `aliases`; target of most links |
| `01 Places/Harbor/Old Quay.md` | Bare link, aliased link `[[Harbor|the port]]`, heading link `[[Harbor#History]]`, heading link with display text `[[Harbor#History|its past]]`, same-note heading link `[[#Tides]]`, padded link `[[ Harbor]]`, case-only match `[[harbor]]`, a wikilink inside inline code and one inside a code block, a standard Markdown link `[Harbor](../Harbor/Harbor.md)` with URL-encoded spaces |
| `01 Places/Marsh/The Marsh.md` | Near-miss folder note |
| `01 Places/Unwritten.md` | Unresolved links, one of them repeated |
| `02 People/Mira.md` | Path link, path link ending in `.md`, path link with wrong letter case, link to a file in an excluded folder, link to a file that is not a note |
| `02 People/Twin.md`, `03 Things/Twin.md` | Two lore notes with one name (ambiguous) |
| `02 People/Shade.md`, `99 Appendices/Agents/Shade.md` | Same name inside and outside appendices (tie-break) |
| `03 Things/Lantern.md` | Windows line endings with frontmatter |
| `03 Things/Rope.md` | Windows line endings without frontmatter |
| `03 Things/Knot.md` | Mixed line endings (opens read-only) |
| `03 Things/Ledger.md` | A table; unknown frontmatter keys, a comment and unusual key order |
| `03 Things/Broken.md` | Malformed frontmatter |
| `03 Things/Long.md` | 50,000 words, for the typing target |
| `03 Things/Gallery.md` | Embeds `![[lamp.png]]`, `![[lamp.png|200]]`, a duplicated image name, and `![x](<../99 Appendices/Images/map one.png>)` |
| `99 Appendices/Images/lamp.png`, `99 Appendices/Icons/Lamp.png` | Duplicated image name differing in case |
| `99 Appendices/Images/photo.png` | A JPEG named `.png` |
| `99 Appendices/Images/map one.png` | Image with a space in its name |
| `99 Appendices/Logs/Session.md` | Append-only file linking to `Harbor` by bare name and by path |
| `99 Appendices/Recycle Bin/Harbor.md` | Recycle-bin copy of a live note |
| `.obsidian/app.json`, `.frontier/baseline/links.json`, `notes.json` | Excluded folders; a file that is not a note |

A script, `packages/vault/scripts/make-big-fixture.ts`, copies the fixture to 500 notes for timing tests,
into `packages/vault/test/.big-fixture/`, which is not committed.

### Target Files to Create/Modify

Paths are relative to the `frontier` repository.

#### Repository root

1.  `package.json` (Create, S1). Workspaces; scripts `build`, `test`, `typecheck`, `lint`, `dev`, `e2e`;
    Node version.
2.  `package-lock.json` (Create, S1). Pins every dependency.
3.  `tsconfig.base.json` (Create, S1). Strict compiler settings shared by all workspaces.
4.  `eslint.config.js`, `.prettierrc`, `.prettierignore` (Create, S1). One style; the ignore file excludes
    the fixture vault.
5.  `.gitignore`, `.dockerignore` (Create, S1). Keep `node_modules`, builds, `/data` and env files out.
6.  `.env.example` (Create, S1). The variables in the table above, without values.
7.  `Dockerfile` (Create, S1). First part builds all workspaces; second part is a Node 22 image with `git`
    installed, the server build and the web build, `/data` declared as a volume, run as a non-root user.
8.  `README.md` (Modify, S1). It holds only the project name today. Replace with: what Frontier is, how
    to run it against a vault checkout, how to create the GitHub App, how to deploy on Coolify, how to
    restore from backup.
9.  `.github/workflows/ci.yml` (Create, S1). On every push: install, lint, type-check, unit tests with
    coverage thresholds, build, browser tests against the fixture vault. The real-vault tests are run by
    hand before each release, because the vault is a separate private repository.
10. `playwright.config.ts` (Create, S1). Two projects, desktop and a 375 px touch phone; tracing off, to
    keep runs fast; starts the server against a temporary copy of the fixture vault.

#### `packages/schema`

11. `packages/schema/package.json`, `packages/schema/tsconfig.json`, `packages/schema/vitest.config.ts`
    (Create, S1).
12. `packages/schema/src/api.ts` (Create, S1). A `zod` schema and type for every request and response in
    the API table. A mismatch between server and web fails type-check.
13. `packages/schema/src/errors.ts` (Create, S1). The error codes and their HTTP status.
14. `packages/schema/src/state.ts` (Create, S1). Schemas for the draft record, rename intent, settings and
    backup files.
15. `packages/schema/src/status.ts` (Create, S1). The status snapshot: last fetch, last push, failed push,
    unpublished count, conflicts, index commit and whether it is stale, last backup and its error, counts
    for the attention list.
16. `packages/schema/src/index.ts` (Create, S1). Exports.
17. `packages/schema/test/schemas.test.ts` (Create, S1). Each schema accepts its worked example from this
    document and rejects a record with a missing field.

#### `packages/vault`

18. `packages/vault/package.json`, `packages/vault/tsconfig.json`, `packages/vault/vitest.config.ts`
    (Create, S1). Coverage threshold: 90% of branches.
19. `packages/vault/src/frontmatter.ts` (Create, S1). Splits a note into frontmatter and body without
    changing either; reads keys; sets or removes one key; reports malformed frontmatter.
20. `packages/vault/src/lineEndings.ts` (Create, S1). Reports a text's line-ending kind (`lf`, `crlf`,
    `mixed`); normalises for editing; restores the original kind when a commit is built.
21. `packages/vault/src/links.ts` (Create, S1). Finds every wikilink and embed with its exact position:
    target, path part, heading part, display text, size part, embed flag; also standard Markdown images
    and links to notes, with angle-bracket, relative and URL-encoded paths. Skips inline code and code
    blocks.
22. `packages/vault/src/resolve.ts` (Create, S1). The four-step resolution rule with rule 1 in full, image
    resolution, and the result kinds: resolved, unresolved, ambiguous with candidates, outside file.
23. `packages/vault/src/rename.ts` (Create, S1). Given a rename or move and the current notes, returns the
    edited text of every note whose links must change, touching only the link characters; skips files
    under `99 Appendices` and returns them as "left unresolved"; handles folder notes.
24. `packages/vault/src/paths.ts` (Create, S1). Which files are notes, which folders are excluded, which
    paths are append-only, entry type from the top-level folder, folder-note detection, next free image
    name.
25. `packages/vault/src/headings.ts`, `packages/vault/test/headings.test.ts` (Create, S1). Headings for the
    outline and heading links, with their test.
26. `packages/vault/src/index.ts` (Create, S1). Exports.
27. `packages/vault/test/fixture-vault/**` (Create, S1). The files in the fixture table.
28. `packages/vault/test/frontmatter.test.ts` (Create, S1). Splitting and joining every fixture note is
    byte-identical; setting one key changes only that key's lines; malformed frontmatter is reported.
29. `packages/vault/test/lineEndings.test.ts` (Create, S1). Each kind is detected; normalise then restore
    is byte-identical; a one-character edit to the Windows-ending fixture gives a one-line difference.
30. `packages/vault/test/links.test.ts`, `packages/vault/test/resolve.test.ts`,
    `packages/vault/test/rename.test.ts`, `packages/vault/test/paths.test.ts` (Create, S1). One test per
    rule and per row of the fixture table.
31. `packages/vault/test/real-vault.test.ts` (Create, S1). Runs only when `VAULT_PATH` is set. For every
    note: split and join is byte-identical; a one-character edit gives a one-line difference; setting a
    key on a note with frontmatter changes only that key's lines (G2). Resolves every link and compares
    with the baseline in the vault (G4).
32. `packages/vault/scripts/make-link-baseline.ts` (Create, S1). Writes the baseline for a vault checkout
    and prints what changed from the previous one. Run with `npm run baseline -w packages/vault`.
33. `packages/vault/scripts/make-big-fixture.ts` (Create, S1). Builds the 500-note fixture.

#### `apps/server`

34. `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts` (Create, S1).
    Coverage threshold: 90% of branches in `src/git` and `src/publish`.
35. `apps/server/src/main.ts` (Create, S1). Starts Fastify, loads configuration, clones or opens the
    working copy, fetches, clears finished drafts, builds the index, registers routes, sets the content
    security policy header, serves the web build.
36. `apps/server/src/config.ts` (Create, S1). Reads and validates the variables.
37. `apps/server/src/git/gateway.ts` (Create, S1). The operations under "Git operations".
38. `apps/server/src/git/appAuth.ts` (Create, S1). Installation token from the GitHub App, with renewal.
39. `apps/server/src/git/webhook.ts` (Create, S1). Checks the signature, then fetches and reindexes.
40. `apps/server/src/git/poll.ts` (Create, S1). The 5-minute timer fetch.
41. `apps/server/src/state/files.ts` (Create, S1). Write-then-rename file writing; JSON helpers; sets the
    "changed" mark for backup.
42. `apps/server/src/state/drafts.ts` (Create, S1). Drafts and rename intents in the stored form above:
    save with revision check, second version, merge versions, discard, list; refuses append-only and
    read-only paths; after a fetch removes drafts equal to `main`, delete drafts whose file is gone and
    rename intents already carried out.
43. `apps/server/src/state/settings.ts` (Create, S1). Reads and writes `settings.json`.
44. `apps/server/src/state/backup.ts` (Create, S1). The backup rule above; writes `backup.json`.
45. `apps/server/src/state/queue.ts` (Create, S1). Runs background jobs one at a time (backup, resizing).
46. `apps/server/src/index/build.ts` (Create, S1). The published layer from the working copy and the draft
    layer from drafts and rename intents, kept apart; updates per file; re-resolves links when a note is
    added or removed.
47. `apps/server/src/index/attention.ts` (Create, S1). Builds the attention lists.
48. `apps/server/src/index/search.ts` (Create, S2). MiniSearch over the published layer plus drafts, with
    the weights above.
49. `apps/server/src/publish/plan.ts` (Create, S1). Builds a publish plan: classification, three-way
    merges, rename rewrites, groups; keeps plans for 15 minutes.
50. `apps/server/src/publish/confirm.ts` (Create, S1). Checks the plan against `main`, restores line
    endings, builds the commit, pushes, fetches.
51. `apps/server/src/images/serve.ts` (Create, S1). Serves a vault image at a requested width, cached
    under `/data/assets/thumbs` by content hash and width; detects the real type with `file-type`.
52. `apps/server/src/images/upload.ts` (Create, S2). Accepts an image, picks a free name, creates a draft.
53. `apps/server/src/auth/password.ts`, `apps/server/src/auth/session.ts` (Create, S1). Argon2id hash and
    check; session cookie; login limit; the guard on every other route.
54. `apps/server/src/status/status.ts` (Create, S1). Gathers the snapshot; sends changes as server-sent
    events.
55. `apps/server/src/routes/auth.ts`, `routes/entries.ts` (also `/api/tree`), `routes/drafts.ts`,
    `routes/publish.ts`, `routes/images.ts`, `routes/status.ts` (also `/health`), `routes/attention.ts`,
    `routes/renames.ts`, `routes/webhook.ts` under `apps/server/src/` (Create, S1). The S1 rows of the
    API table.
56. `apps/server/src/routes/search.ts` (also `/api/switcher`), `apps/server/src/routes/preview.ts`,
    `apps/server/src/routes/upload.ts` (Create, S2). The S2 rows of the API table.
57. `apps/server/src/cli/set-password.ts` (Create, S1). Sets the single account's password. There is no
    sign-up page.
58. `apps/server/src/cli/restore.ts` (Create, S1). Fills an empty `/data/state` from `latest/` or a named
    night in the bucket.
59. `apps/server/test/helpers/repo.ts` (Create, S1). A temporary Git remote and working copy made from the
    fixture vault, so Git behaviour is tested without GitHub.
60. `apps/server/test/helpers/bucket.ts` (Create, S1). A local folder standing in for the bucket.
61. `apps/server/test/gateway.test.ts` (Create, S1). Fetch resets the working copy; a commit is built with
    the working copy unchanged; a deletion and a rename's old path are absent from the commit; a push
    after the remote moved returns `main_moved` and a push to an unreachable remote returns `push_failed`;
    the test fails if any `git` call contains `--force`, `--force-with-lease` or a `+` reference; a merge
    tool error is `merge_failed`, not a conflict; the lock times out with `git_busy`.
62. `apps/server/test/publish.test.ts` (Create, S1). One commit per confirm; no commit without confirm
    (G6); an overlapping change is a conflict and is held back while other drafts publish (G7); a change
    elsewhere in the file is a merge that is published only when confirmed; a rename publishes all link
    rewrites in one commit and leaves appendix files alone; a plan against an older `main` is refused; a
    delete of a changed file, a create over an existing path, an edit of a file gone from `main` and an
    image changed on both sides are conflicts; a draft of a renamed note is published at the new path;
    Windows line endings survive.
63. `apps/server/test/drafts.test.ts` (Create, S1). Drafts survive a restart; a stop during a write leaves
    the previous file intact; append-only and read-only paths are refused; an older revision becomes a
    second version; a draft equal to `main` is removed after a fetch.
64. `apps/server/test/recovery.test.ts` (Create, S1). A server stopped after the commit is built, after
    the push, and before the fetch each comes back with the working copy equal to `main` and no published
    draft left, including a draft published through a confirmed merge and a delete draft.
65. `apps/server/test/index.test.ts` (Create, S1). Links and backlinks over the fixture match the fixture
    table; the draft layer is separate; a server started on a fresh clone with an empty `/data/state`
    shows every published entry (G1); the 500-note fixture indexes in under 5 seconds.
66. `apps/server/test/backup.test.ts` (Create, S1). A change reaches the stand-in bucket within the
    5-minute delay (with the clock advanced by the test); `restore` gives back the same drafts.
67. `apps/server/test/status.test.ts` (Create, S1). A failed push, a stale index, a failed backup and a
    mixed-ending file each appear in the snapshot (G12).
68. `apps/server/test/auth.test.ts` (Create, S1). Every route refuses without a session; the sixth login
    attempt in 15 minutes is refused; the webhook rejects a bad signature and a valid push triggers a
    fetch and reindex.
69. `apps/server/test/images.test.ts`, `apps/server/test/poll.test.ts`,
    `apps/server/test/routes.test.ts` (Create, S1). Resizing and type detection, including the JPEG named
    `.png`; the timer fetch picks up a push that sent no webhook; each S1 route returns the shape in
    `packages/schema`.
70. `apps/server/test/search.test.ts` (Create, S2). Results and snippets on the fixture; a query on the
    500-note fixture returns in under 100 ms; appendix notes are left out unless asked for.

#### `apps/web`

71. `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`,
    `apps/web/vitest.config.ts`, `apps/web/index.html` (Create, S1).
72. `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/routes.tsx` (Create, S1). Routes: login,
    entry (read, edit), unpublished, conflict, status, attention; search is added in S2. Every view has a
    URL.
73. `apps/web/src/api/client.ts`, `apps/web/src/api/events.ts` (Create, S1). Typed calls using
    `packages/schema`; the status stream.
74. `apps/web/src/layout/Shell.tsx`, `apps/web/src/layout/StatusArea.tsx` (Create, S1). Folder tree, main
    pane, right panel; the status facts and failures.
75. `apps/web/src/layout/Attention.tsx` (Create, S1). The attention lists.
76. `apps/web/src/tree/FolderTree.tsx` (Create, S1). Folders and notes with create and delete; rename and
    move are added in S2.
77. `apps/web/src/reader/Reader.tsx`, `apps/web/src/reader/render.ts`,
    `apps/web/src/reader/wikilinkPlugin.ts` (Create, S1). The plugin walks the parsed Markdown with
    `unist-util-visit` and turns `[[...]]` and `![[...]]` in text into link and image nodes, using the
    resolution the server sent. Rendered entry:
    wikilinks, embeds with size, heading links, tables; unresolved, ambiguous and outside-file links each
    styled differently and labelled in a tooltip.
78. `apps/web/src/reader/sanitize.ts`, `apps/web/src/reader/sanitize.test.ts` (Create, S1). Raw HTML in
    Markdown is not rendered; the `rehype-sanitize` schema allows no script, event-handler attributes or
    frames and limits links to web and vault addresses. Tests cover each case.
79. `apps/web/src/editor/Editor.tsx` (Create, S1). CodeMirror 6 on the normalised text, source view.
80. `apps/web/src/drafts/buffer.ts`, `apps/web/src/drafts/EntryState.tsx` (Create, S1). Writes each change
    to the browser store in the same tick as the keystroke and sends it to the server after 1 second
    without typing; resends when the connection returns; removes a row once the server confirms that
    revision. The badge: published, unpublished, conflict, waiting to send.
81. `apps/web/src/drafts/Versions.tsx` (Create, S1). Two versions of one draft, for the author to merge.
82. `apps/web/src/publish/Unpublished.tsx`, `apps/web/src/publish/MergeConfirm.tsx`,
    `apps/web/src/publish/Conflict.tsx` (Create, S1). The list with differences, message box and Publish
    button; a clean merge with the incoming change marked; the two versions side by side with the draft
    editable.
83. `apps/web/src/auth/Login.tsx` (Create, S1). Password form.
84. `apps/web/src/styles/tokens.css`, `apps/web/src/styles/app.css` (Create, S1; completed in S2). Layout
    in S1; colours, type and spacing for light and dark, sized for 375 px first, in S2.
85. `apps/web/src/reader/HoverPreview.tsx`, `apps/web/src/reader/Backlinks.tsx`,
    `apps/web/src/reader/Outline.tsx` (Create, S2).
86. `apps/web/src/editor/livePreview.ts` (Create, S2). Hides Markdown syntax away from the cursor line and
    shows images inline.
87. `apps/web/src/editor/wikilinks.ts` (Create, S2). Link highlighting, click to follow, `[[` autocomplete
    over names, aliases (written as `[[Note|Alias]]`) and headings; writes a path when names collide.
88. `apps/web/src/editor/tables.ts`, `apps/web/src/editor/images.ts`,
    `apps/web/src/editor/Properties.tsx`, `apps/web/src/editor/PhoneToolbar.tsx` (Create, S2). Table cell
    navigation; image paste, drop, pick and drag-to-size; frontmatter panel; buttons above the phone
    keyboard for link, heading, list, image and undo.
89. `apps/web/src/publish/RenameDialog.tsx`, `apps/web/src/links/CreateFromLink.tsx`,
    `apps/web/src/links/AmbiguousLink.tsx` (Create, S2). Rename with the list of notes that will change;
    create an entry from an unresolved link; pick the target of an ambiguous link, which rewrites it with
    its path.
90. `apps/web/src/search/QuickSwitcher.tsx`, `apps/web/src/search/Search.tsx` (Create, S2).
91. `apps/web/src/layout/PhoneBar.tsx` (Create, S2). Bottom bar: search, entries, unpublished, status.
92. `apps/web/e2e/fixtures.ts` (Create, S1). Shared setup for the browser tests.
93. `apps/web/e2e/write-publish.spec.ts` (Create, S1). CUJ 1: edit, close the tab, reopen, publish; one
    commit.
94. `apps/web/e2e/conflict.spec.ts` (Create, S1). CUJ 4: a merge to confirm, and an overlap to resolve.
95. `apps/web/e2e/offline.spec.ts` (Create, S1). The connection drops while typing; the text is kept and
    sent later.
96. `apps/web/e2e/two-devices.spec.ts` (Create, S1). Two browser contexts: a draft published from one does
    not reappear on the other; an older revision produces two versions (G6).
97. `apps/web/e2e/line-endings.spec.ts` (Create, S1). One keystroke in the Windows-ending fixture note
    gives a one-line difference after Publish; the mixed-ending note opens read-only (G2).
98. `apps/web/e2e/links.spec.ts`, `apps/web/e2e/rename.spec.ts` (Create, S2). CUJ 2 and CUJ 3; autocomplete,
    hover preview, backlinks, the ambiguous-link picker.
99. `apps/web/e2e/parity.spec.ts` (Create, S2). One check for each remaining parity item of goal G5: live
    preview, full-text search, table editing, image upload and sizing, quick switcher, outline, move,
    properties panel.
100. `apps/web/e2e/phone.spec.ts` (Create, S2). CUJ 1 to 4 at 375 px with touch, and no page scrolls
     sideways.
101. `apps/web/e2e/timing.spec.ts` (Create, S2). An entry page with images loads in under 2 seconds with
     the network limited to 9 Mbit/s and 170 ms delay at 375 px (G11); a keystroke in the 50,000-word
     fixture note reaches the screen in under 50 ms.

### Work outside the files above

*   **GitHub.** The author creates Frontier's GitHub App in stage 1, installs it on `avalymia` only with
    permission to read and write contents, and adds a push webhook from `avalymia` to Frontier.
*   **Coolify.** One project: the container, a persistent volume at `/data`, the variables, the domain,
    the health check on `/health`, and an S3-compatible bucket for backup.
*   **Vault.** In stage 1 the author commits `.frontier/baseline/links.json` after reviewing it.
*   **Backup against a real bucket** is tried once by hand at the first deploy, since the automated test
    uses a folder.
*   **Design index.** `docs/designs/SITEMAP.md` gains a row for each later stage design.

### Order of work

Stage 1:

1.  Root setup, `packages/schema`, `packages/vault` with the fixture vault and its tests.
2.  The link baseline against the real vault. The author reviews the ambiguous and unresolved lists,
    compares with Obsidian (goal G4), checks whether a bare alias resolves there, and commits the baseline.
3.  The GitHub App. Server: configuration, Git gateway, working files, index without search, login. A
    first deploy of this skeleton to Coolify, so the App, the webhook and the disk are tested on the real
    server before the rest is built.
4.  Server: drafts, publish plan and confirm, crash recovery, image serving, backup and restore.
5.  Web, S1 files: login, status area, attention list, folder tree, reader, source editor with draft
    buffer, unpublished list, Publish, merge and conflict screens.

Stage 2:

6.  Search, quick switcher, reader panels, live preview, link autocomplete, hover preview.
7.  Rename dialog, create-from-link, ambiguous-link picker, table editing, properties panel, image upload
    and sizing.
8.  Phone layout and toolbar; styling.

### Verification Plan

*   **Compilation/Build**: `npm run build` builds every workspace; `docker build .` produces the image.
*   **Unit Tests**: `npm test` runs Vitest in every workspace.
*   **Real-vault tests**: `VAULT_PATH=<checkout> npm test -w packages/vault`. Run before each release and
    after any change to `packages/vault`.
*   **Static Analysis & Linting**: `npm run lint` and `npm run typecheck`.
*   **Test Coverage Requirement**: 90% of branches in `packages/vault`, `apps/server/src/git` and
    `apps/server/src/publish`, set as Vitest thresholds so CI fails below them. No figure elsewhere.
*   **E2E/Integration**: `npm run e2e` runs every file under `apps/web/e2e` in the desktop and phone
    projects.
*   **Goal checks, stage 1**: G1 (item 65), G2 (items 28, 29, 31, 97), G4 (items 30, 31, and the author's
    comparison with Obsidian), G6 (items 62, 63, 93, 95, 96; locking a real phone is checked by hand),
    G7 (items 62, 94), the stage 1 part of G12 (item 67).
*   **Goal checks, stage 2**: G3 (by hand: open the vault in Obsidian after a week of use and confirm
    links resolve as before), G5 (items 98, 99), G11 (items 100, 101), search time (item 70).

--------------------------------------------------------------------------------

*Drafted with EGM*
