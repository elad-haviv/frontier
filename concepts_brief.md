# Frontier

* **Author:** Elad Haviv
* **Date:** 2026-11-20
* **Status:** Draft after first Goldfish review. Open decisions are listed at the end.

## Overview

Frontier is a custom web app, for one author, on desktop and phone. In it he writes, reads and explores
Avalymia, a fantasy multiverse he has built over 10 to 15 years. It may replace Obsidian as his daily tool.

The lore lives today as an Obsidian vault mirrored to the `elad-haviv/avalymia` GitHub repository: about 500
Markdown files, 1,650 wikilinks and 284 images. Every push to `main` triggers an agent that copies changed
notes into a Hindsight memory bank used for semantic recall.

Frontier adds what Obsidian does not give him:

* structured time on entries, across several calendars, with vague dates and relative order;
* maps as standalone objects whose markers link to entries, including drill-down, time-aware views, a globe
  and reprojection;
* AI help that proposes changes for him to approve, never changing canon on its own;
* export to several formats.

The Markdown files in the `avalymia` repository stay the source of truth.

## Analysis

Seven reviewers examined the concept and the vault with no knowledge of the earlier conversation. All seven
completed. Their findings are merged below, most serious first.

### 1. How saving reaches Git is undefined, and it decides everything else (raised by 6 of 7)

Three kinds of writer push to `main`: Obsidian through obsidian-git, AI agents, and now Frontier. The vault
history shows 48 of 55 commits were made by agents and 3 by the author. `AGENTS.md` forbids force-push,
requires `git pull --ff-only`, says to stop when branches diverge, and asks for one logical change per commit.
Every push to `main` also triggers a Hindsight ingestion that calls a language model for each changed note.

If each autosave became a commit, history would fill with noise, half-written drafts would be ingested as
canon, and ingestion cost would grow with every keystroke pause.

Proposed resolution:

* Drafts save automatically on the server and survive a closed tab or a locked phone. They are not commits.
* A separate "Publish" action turns the pending changes into one commit with a message, then pushes.
* The server keeps one Git working copy and is the only path by which Frontier writes. It pulls before it
  pushes. If the branches have diverged it stops and shows a plain-language conflict screen. It never
  merges silently.
* Every entry shows its state: saved, unpublished, or in conflict. The app shows the last pull and push.
* AI proposals never reach `main` until approved.

### 2. Two sources of truth: files and a database (raised by 5 of 7)

The concept says files are canon, and also assumes a Fastify and Postgres back end. Anything stored only in
a database (maps, calendars, approvals, ordering between events) would make the repository incomplete, would
be invisible to the Hindsight sync, and would be lost if the author returned to Obsidian.

Proposed resolution:

* Everything the author creates is a text file in the repository. Entries stay Obsidian-legal Markdown with
  plain YAML frontmatter. Maps and calendars are JSON or YAML files in a folder Obsidian and the Hindsight
  sync both ignore.
* The database is a disposable index (links, backlinks, search, parsed dates) rebuilt from the repository.
  "Delete the index, rebuild, nothing lost" is a release test. At this size SQLite or an in-memory index may
  be enough; Postgres is needed only if server-side drafts and pending proposals are kept there.
* Entries get a stable `id` in frontmatter before maps are built, so maps and timelines refer to ids and
  survive renames.
* Frontier must leave a file byte-for-byte unchanged when it opens and saves it without edits. The test:
  open and save every note, expect no diff. This rules out editors that re-serialise Markdown.
* Stopping use of Frontier then costs nothing: Obsidian opens the same vault.

### 3. Stage 1 rebuilds what Obsidian already does and delivers none of the new value

A Markdown editor with wikilinks, backlinks, search and phone support is the hardest part to make good
enough to leave Obsidian, and it is the part Obsidian already covers. The reasons for a custom tool (time,
maps, AI proposals) all sit in later stages.

The strongest counter-proposal: build Frontier first as a companion over the same repository. It renders
entries read-only and adds the first thing Obsidian cannot do (a timeline or a map). Obsidian remains the
editor until Frontier's editor is good enough to switch.

A related observation: since agents write most of the lore, a view for reviewing and approving proposed
changes on a phone may matter more than matching Obsidian's editor.

This conflicts with the author's stated first priority (write and view as in Obsidian). It is an open
decision.

### 4. "As good as Obsidian" has no acceptance list

The vault depends on specific Obsidian behaviour that must be copied exactly or links will break:

* 166 links with display text, 13 heading links, 64 links written with a path, about 15 that resolve only
  when case is ignored, and 3 with stray spaces;
* 77 image embeds by bare file name, plus 8 standard Markdown images;
* at least 2 note names that exist twice (`Yagon.md`, `Common Ezobian.md`), which makes links to them
  ambiguous;
* 30 or more link targets with no note yet, used as stubs to be written later;
* rename rewrites every link to the renamed note (`alwaysUpdateLinks` is on).

The specification must list parity items: live editing, `[[` autocomplete with aliases and headings, create
an entry by clicking an unresolved link, rename and move with link rewriting in one commit, quick switcher,
full-text search, outline, hover preview, table editing, image upload to a defined folder. It must also name
what is dropped. Plugin syntax is unused in the vault (no leaflet, tasks, mind-map, callouts or tags), so
none of it needs rendering.

Link resolution should be written as rules and tested against the real vault with a checked-in baseline.

### 5. There is almost no time data to extract

Numbered dates appear about ten times in the whole vault, most of them in appendices. Relative phrases such
as "two centuries after" appear about eleven times. An AI pass that proposes time fields will mostly produce
low-confidence guesses, and reviewing hundreds of them is a chore the author will stop doing.

Proposed resolution:

* Design time fields for manual and relative entry first. AI extraction is a helper, not the source.
* Extraction runs on publish, or on request, never on each autosave. Proposals quote the source sentence.
* Approval never blocks saving prose. Each field can be accepted, edited or rejected; "no time reference" is
  a valid answer that is remembered; rejected proposals are not offered again unless the sentence changes.
* No mass backfill. An alternative worth adopting: unconfirmed proposals live in the index and appear in
  views marked as unconfirmed; the author confirms them where he meets them (one tap on a timeline), and
  only confirmed facts are written to frontmatter.
* `99 Appendices` is append-only and is excluded.
* Adding frontmatter to hundreds of notes re-ingests the whole Hindsight bank. Either the sync learns to
  ignore frontmatter, or one planned full re-ingest is accepted.

### 6. The time model: intervals and constraints

The lore gives no numbers. The Ezob calendar adds a nameless month "approximately every three years" and the
year is "about 360 days", so exact day arithmetic is undefined. Pulse rate differs per plane and drifts over
time, so a conversion is a curve.

Reviewers converged on this model:

* Each date keeps its original text and is stored as an interval, earliest to latest, in its own calendar.
  Year-level or era-level precision is allowed.
* Relative statements ("before X", "during Y") are links between events. They narrow intervals. A cycle or
  an impossible combination is reported as a contradiction for the author to resolve, which matches the
  vault rule "flag, never silently fix".
* The Nexus Pulse count is the optional common axis. A calendar connects to it only when the author gives an
  anchor and a rate. Time dilation is a table of rates per plane over time. Converted values are shown as
  ranges and labelled as derived.
* Calendar definitions are files, each linked to its lore note. Leap rules may be "unspecified" or an
  author-declared list of leap years.
* Build ordering and overlap first. Conversion comes later and needs no change to stored dates.

The price: a constraint solver is harder to debug than date arithmetic, and uncertain ranges need careful
display.

### 7. Maps: one model cannot assume one geometry

Ezob is a sphere of undecided size. Derdama is a stack of cylinders. The cosmological map is a diagram.
Existing map images are close to, but not exactly, the 2:1 shape a full-globe image needs (2944 by 1440),
and continent maps have no placement on the globe.

Proposed resolution:

* A map is an image plus a declared coordinate space: sphere (longitude and latitude, radius may be empty),
  cylinder, flat, or schematic. Markers, paths and zones are stored in that space, not in pixels.
* Measuring is a capability of the space. On Ezob it shows relative units until a radius is decided. The
  cosmological map never measures.
* Drill-down is a link from a marker or zone to another map, not a shared coordinate system.
* Each map records the extent and projection of its source image.
* Time-aware maps hold no time data of their own. A marker has an entry reference and a position; when it is
  visible comes from the entry's time interval.
* Use an existing map library and drawing tools rather than writing a map engine. From `map-reprojector`
  reuse only the projection maths (`projections.ts`, `reprojection.worker.ts`, `pixelMapper.ts`); its
  interface is tied to mouse and keyboard and has no touch support.
* A map file format already exists at `99 Appendices/06 Interactive Maps/Main.json`, with empty arrays.
  Decide whether to adopt or replace it.
* Before designing layers and styling, place ten real markers to test the need: the Obsidian Leaflet plugin
  was installed and never used.

### 8. Images and repository size

The repository is about 410 MB, of which Git history is 198 MB. Images reach 9 MB each. 182 of 284 images are
icons taken from commercial games. Only 77 images are referenced by any note.

Proposed resolution: serve resized images and map tiles generated on the server; decide before the map stage
whether large map images go to Git LFS or to storage outside Git with a checked-in manifest.

### 9. Phone use, navigation and failures

* Phone: keep a local draft buffer so a dropped connection loses nothing; define the bottom navigation, a
  button for inserting links, and touch gestures for maps.
* Navigation: an entry should show which maps and timelines it appears on, derived from the index. Every
  view has a URL. One search covers entries, maps and events.
* Login is required even for one user, because the server holds a token that can push to canon.
* Failures must be visible: unpushed commits, failed pushes, a stale index, failed AI calls. Add a health
  check and a command to rebuild the index.
* AI spend: a first extraction pass over the vault is estimated at a few dollars at most. Use a dedicated
  key with a spending limit, cache by content hash, and log the cost of each call.

### 10. Scope

Globe and space views, movement animation, varying time dilation and six export formats are each large.
Keep them as a named backlog and make sure the data model does not block them. For export, Pandoc converts
Markdown to docx and PDF and the book project already uses it.

### Existing tools considered

World Anvil, LegendKeeper and Kanka keep data in their own hosted storage, which breaks "Markdown in Git is
canon". Obsidian plugins cover basic maps and single-calendar timelines, but not overlap across calendars or
time-aware maps. Quartz and Foam are read-only publishing or tied to VS Code. A custom build is defensible
for time and maps specifically.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * One author reads, writes and explores the vault on desktop and phone.
  * Markdown files in the `avalymia` repository remain canon and remain usable in Obsidian.
  * Structured time on entries, with vague dates, relative order, several calendars and optional conversion.
  * Standalone maps with markers linked to entries, across sphere, cylinder, flat and schematic spaces.
  * AI proposes; the author approves.
  * Export, starting with what Pandoc gives for free.
* **Out-of-Scope Non-Goals:**
  * Collaborators, public readers, or accounts beyond the author.
  * Writing with no connection on a phone, beyond a local draft buffer (assumed, to be confirmed).
  * Rendering Obsidian plugin syntax, the graph view, canvas, tasks and mind maps.
  * Mass AI backfill of fields across the vault.
  * Deciding canon numbers (pulse rates, Ezob's radius). The tool works without them.

## Alternatives Weighed

* **Hosted worldbuilding tools (World Anvil, LegendKeeper, Kanka).** Rejected by author: he wants a custom
  tool, and they do not keep Markdown in Git as canon.
* **Staying on Obsidian with plugins.** Rejected by author: plugins do not cover cross-calendar overlap or
  time-aware maps.
* **Frontier keeps canon in its own database.** Rejected by author: GitHub stays the source of truth.
* **Time data stored on maps, or map data stored on entries.** Rejected by author: maps are standalone and
  refer to entries; entries carry time.
* **Mandatory conversion between calendars with fixed canon numbers.** Rejected by author: dates stay in
  their own calendar and convert only on request, where numbers exist.
* **Each autosave is a commit.** Rejected in review: floods history and the Hindsight bank.
* **A block-style WYSIWYG editor.** Rejected in review: such editors rewrite Markdown files they open.
* **Embedding the `map-reprojector` app as it is.** Rejected in review: only its projection maths is
  reusable.
* **Frontier as a read-only companion first, editor later.** Not decided. See open decisions.

## Key Decisions & Staging for Next Steps

Decided:

1. Canon is the Markdown in `elad-haviv/avalymia`. Single user.
2. AI proposes, the author approves.
3. Maps are standalone and link to entries. Entries carry time references.
4. Dates stay in their own calendar; conversion is optional.
5. A specification and a staged production plan are written before building.

Proposed by review, awaiting the author:

1. Drafts autosave on the server; an explicit Publish makes one commit.
2. All authored data is files in the repository; any database is a rebuildable index.
3. Stable `id` in frontmatter for every entry.
4. Time stored as intervals plus relative links, with contradiction reporting.
5. Each map declares its coordinate space.

Open decisions:

1. Does the first stage include the editor, or is it a reading companion with one new capability while
   Obsidian remains the editor?
2. Is Obsidian retired at a cutover date, or kept in parallel as a fallback and for offline writing?
3. Do confirmed fields go into frontmatter, and may the Hindsight sync be changed to ignore frontmatter?
4. Where do large map images live: Git LFS, or storage outside Git?
5. Hosting on Coolify with AI through OpenRouter, and "phone needs a connection": assumed, not confirmed.
