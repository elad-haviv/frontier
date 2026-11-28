# Frontier backlog

One place for what is being built, what is waiting, and ideas. The design in
[designs/frontier.md](designs/frontier.md) says how things work; this file says what is next.

## How ideas are handled

- **Any idea goes into "Ideas inbox" first**, in your words, with the date. Adding one never changes
  what is being built right now.
- **When a stage's design is written, the inbox is read** and each idea that fits is moved into that
  stage, turned down with a reason, or left for a later stage.
- **An idea jumps the queue only when you say so.** Then it moves to "Now", and whatever it displaces
  is named here.

## Ideas inbox

- 2026-11-21 (built in stage 10): **AI co-editing, in the editor.** Highlight text and add a comment for me or the AI
  to work on; ask the AI to change the length or style of a selection; consult the AI about a
  passage without leaving the editor.
  - Probably stage 8 (AI companion), with the AI basics from stage 3 as a prerequisite.
  - Open: where comments are stored, since they are not lore (a file in `.frontier/`, or with the
    draft on the server); whether a comment can stay on published text or only on a draft.
  - Fits the existing rule: an AI change to a selection is a proposal shown as a difference, which
    you accept or reject before it enters the draft.

<!-- Format:
- 2026-11-21: The idea, as said. (Notes: which stage it probably belongs to, open questions.)
-->

- 2026-11-21: **Gallery.** Built: a page of every image by folder, with those used in entries
  shown first, the others and the icons behind tabs, a search by name or entry, each image opening
  large and linking to its entries. Open: whether maps' images should count as used.

## Left from stage 2

- [x] Live preview in the editor (hide Markdown marks away from the cursor)
- [x] Image upload (toolbar, paste, drop); Tab between table cells; properties panel (other names, tags)
- [x] Image sizing in the editor (drag the image edge); adding and removing table rows and columns

## Waiting on Elad

- [ ] Say whether the preview should become your own library now, and how the real vault comes in:
      loaded by Claude from the repository, or uploaded by you as a zip
- [ ] Review the link baseline on the `claude/vibrant-gates-ovwcp2` branch of `avalymia`
      (`.frontier/baseline/links.json`) and compare it with Obsidian's unresolved links
- [ ] Check in Obsidian whether a bare `[[Alias]]` link resolves
- [ ] A storage bucket for backups and a persistent disk on the Coolify app
- [x] Change the preview password once the real vault is connected
- [ ] Add a passkey and switch the password off
- [ ] Read the stage 3 design and answer its four questions: an OpenRouter key and model; which
      GitHub account the Hermes agents push with; whether a rule can protect `main`; whether Obsidian
      rewrites links inside a `when` field
- [ ] Have the sync on the Hermes box changed for quarantine (the changes will be written in
      `docs/sync-changes.md`)

## Done: stages 25 to 28 (2026-11-26)

- [x] 25 Keep going: Home with the work queue (needs love, wanted, orphans, dead ends), a "From here"
      strip on an entry (missing links, unlinked mentions with Link it and Undo, thin neighbours, related,
      AI "What's missing"), pins, random entry, back to last, resume position, recents in the switcher,
      what to do next after Publish, a week line and "on this day". Design:
      [stage 25](designs/stage-25-keep-going.md)
- [x] 26 The library on the phone: a Library row in the drawer that opens a full-drawer panel with a
      back button. [Design](designs/stage-26-phone-library.md)
- [x] 27 Talk with a character, rethought (another session; [design](designs/stage-27-talk-with-a-character.md))
- [x] 28 The library on desktop: a pane beside the sidebar with a close button, `g l` to toggle it.
      [Design](designs/stage-28-library-pane.md)
- Known: with the pane docked, comment bubbles in the editor's margin need a wider window (the comments
  stay in the Comments panel); the editor could start with the pane closed if that matters more.
- Known: the folded library state is kept in session memory only (`ShellStore.openFolders`), not on disk.

## Done: stage 29 (2026-11-27)

- [x] 29 Pictures for entries: a Generate tab in the image dialog (and "Generate an image…", Ctrl+Alt+I)
      that makes one picture at a time from the selection or the entry's opening, in the art style from
      Settings, and inserts the chosen one as an unpublished image. Tries are kept for 7 days.
      [Design](designs/stage-29-entry-pictures.md)

## Done: stages 30 to 32 (2026-11-27)

- [x] 30 Trees: relations on entries, family trees, descent, pantheons and hierarchies.
      [Design](designs/stage-30-trees.md)
- [x] 31 People and projects: accounts, projects, members and roles, authors, comments between
      people, AI keys on the device (31a to 31f). [Design](designs/stage-31-people-and-projects.md);
      what is left: [follow-ups](designs/stage-31-32-follow-ups.md)
- [x] 32 Email: invitations, address confirmation, forgot password.
      [Design](designs/stage-32-email.md)

## Now: stage 34, the World Wizard

[Design](designs/stage-34-world-wizard.md), approved 2026-11-27.

- [x] Release 1: the world in six parts (basics, land and sea, plates and their drift, heights,
      climate, biomes) on a globe or flat, and Make it: a globe map with its height map and biome
      zones. From New project ("Start with") and from Maps ("New world…").
- [x] Release 2: the star system as the first part (it sets the year, the months and the warmth),
      rivers, and Make it also makes a system model and an entry on the sky and the calendar
- [x] Release 3: life and lore (places found on the world; with the AI, names and first entries
      for them, the sapient species and the life; entries with markers and homelands), and the
      World brief
- [x] Every AI feature is told whose world it writes about: the name and the rules come from the
      project's World brief (an entry of type `world-brief`), not from the code
- [ ] Give Avalymia a World brief of its own, with its rules under a Rules heading; until then it
      keeps the one rule about the Nirani that the code has always carried
- [x] Plates turn about a point on the globe and carry their own crust, so drift is whole at the
      poles
- Known: a world in progress is kept on the device only; no lakes.

## Now: stages 11 to 15, the interface and offline work

Design: [stage 11](designs/stage-11-foundations-shell-tree.md), approved after a five-stage review.
Stages 12 (entries and editor), 13 (maps), 14 (graph) and 15 (offline) each get their own design.

- [x] 11a-1 Fixes and shared pieces: icons, tooltips, menus, the combobox, one keys registry, New
      entry with a folder, the phone map header, contrast
- [x] 11a-2 Saving and connection: one save queue on the device, saves that say what they started
      from, one kept copy per device on the server, one connection signal, loading and failure shown
- [ ] 11b The shell: left and right side bars, the phone drawer and bottom sheet
- [ ] 11c The folder tree: the folder file, drag and drop, folder icons, colours and default types

The author's list, as it came in through the ideas inbox:

- 2026-11-22: **Interface overhaul and offline work** (the author's list, kept whole; taken
  through EGM brainstorm as stages 11 to 15; the fresh UX review is in `ux-review/expert-review.md`).
  - General: a UX/UI expert review; icons across the app; folders editable like entries (add, nest,
    move, reorder, rename, style, delete), with an icon and a default type per folder, drag and drop,
    quick buttons beside the name and a context menu; a clearer "new entry" control; a graph screen as
    in Obsidian (done in stage 14: the screen in 14a, an entry's Graph tab in 14b); drop the top bar and put everything in a collapsible side bar with a menu at the
    bottom; clearer loading signs on a bad connection.
  - Entries: a sticky breadcrumb of headings while scrolling, with a button for a table of contents
    pane on the right; a toggle for full width; rename inline with a pencil, move with a combobox that
    suggests folders; history and export in a right side bar, history with an expand button.
  - Editor: properties in a right side bar; a clearer toolbar with icons, styled tooltips and perhaps
    a status bar naming the hovered tool; an image gallery dialog (browse, upload or drop, paste,
    URL saved to the server, search); a style picker (headings and so on); bullet and numbered lists;
    indenting with Tab (Tab does not work now); code blocks and quotes; underline and strikethrough
    if Markdown allows; a context menu; comment in the toolbar and in the context menu.
  - Maps: the same gallery when choosing a map image; a collapsible right side bar that shows the open
    panel (layers and so on); the entry field for markers as the same combobox, editable in the side
    bar; "map of this place" as a combobox, not a plain select; a viewing mode next to editing, with
    tooltips and floating entry previews on hover; a context menu and keyboard shortcuts; while drawing
    a path, a line to the cursor; straight or curved paths; kinds of path (river, road, border, ...)
    with control over each; tooltips everywhere; a hover highlight on objects; a + at the middle of
    each segment of a path or zone to add a point; drag a whole zone by holding inside it.
  - System: work offline and sync the differences when the network returns.

## Now: stage 3

Design: [stage 3](designs/stage-3-review-and-ai-basics.md), a draft the author has not read yet.

- [x] 3a Inbox for agent branches: list, accept, reject, grouped publish, commit trailer
- [x] 3b Fields and ids: reader block, properties panel rows, schema, attention entries, lookup by id,
      `ensureId`
- [x] 3c AI basics: provider, cost log and cap, settings page, field proposals, folder run
- [x] 3d Quarantine, Frontier's side: list, accept, revert, grouped publish, settling. It shows
      nothing until the sync is changed (see `docs/sync-changes.md`)
- [x] 3e Passkey login, with the option to switch the password off

## Now: Frontier's own library

Decided by Elad on 2026-11-21: the knowledge base lives in Frontier, as files, with its own version
history; notes and media are imported; the library is exported as a vault. Design:
[own library](designs/own-library.md).

- [x] A library of Frontier's own when no repository is named; no account needed anywhere
- [x] Versions: history of an entry and of the library, restore
- [x] Import of notes and images, with a choice on a name clash; import of a whole vault from a zip
- [x] Export of the library as a zip
- [x] Switch the preview from the sample to an own library, on a disk that lasts (2026-11-21: volume
      on `/data`, new password)
- [x] Bring the real vault in (2026-11-21: from GitHub `main`, in four parts because Cloudflare
      refuses uploads over about 100 MB)
- [ ] Later: a one-way mirror to GitHub for the memory bank and the agents. **Deferred by Elad on
      2026-11-21: leave the Hindsight bank for now.** Until it is picked up again, nothing written in
      Frontier reaches the `worldbuilding` bank, so the bank holds the vault as of the import.
- [ ] Backups to a storage bucket. **Elad, 2026-11-21: fine for now without one.** The library is
      only on the server's disk; the export zip is the off-server copy.

## Now: stage 5, chronicles

Design: [stage 5](designs/stage-5-chronicles.md), from the brainstorm in `concepts_brief.md`. Revised
after two independent reviews.

- [x] 5a Order and comparison: the chronicle file, lanes, spans, relations, units, the order view,
      Compare, what does not fit, the form, the phone layout
- [x] 5a The list of real-world cases, each sourced, accepted by Elad case by case (three accepted)
- [ ] Elad tries 5a with his own history before anything more is built
- [x] 5b Scale, offered fixes, shifting a selection (built before the trial, at Elad's word)
- [x] 5c Two versions side by side
- [x] 5d Links to entries (not yet: a linked span with no name showing its entry's title)

## Now: stage 10, comments and more export formats

Design: [stage 10](designs/stage-10-comments-and-formats.md). Elad, 2026-11-21: comments on a
passage, and the export formats stage 9 left out.

- [x] Comments on a passage in the editor, for Elad or for the AI; highlighted; "Work on it" shows
      the AI's rewrite as a difference; kept on the server, not in the library; they follow renames
- [x] Exports as Markdown files, JSON and slides (.pptx)
- [x] Fixes after an independent review (2026-11-22)
- [x] Phone fit (2026-11-22): the editor's actions in two rows with Done beside the title; every
      toolbar button on screen; the map's title readable beside its controls; the top bar gives
      the name's room to Inbox and Unpublished
- [ ] Elad tries comments while editing, and a slide export

## Now: stage 9, export

Design: [stage 9](designs/stage-9-export.md). Elad, 2026-11-21: web pages, Word, PDF and map
pictures; links to entries left out are marked as not shared.

- [x] Web pages: a zip of linked pages in Frontier's look, images included
- [x] Word and PDF: pandoc, and Typst for the PDF; the server image moved to Debian Trixie for a
      pandoc that writes Typst
- [x] Map pictures at one, two or four times the screen, made in the browser
- [ ] Elad exports a folder of his own and reads it

## Now: stage 8, the AI companion

Design: [stage 8](designs/stage-8-ai-companion.md). Elad, 2026-11-21: lore chat first; the lore
from Frontier's own library, not the Hindsight bank; what is kept becomes an unsaved change.

- [x] 8a Lore conversations: answers from the library, each paragraph with checked quotes;
      "not in the lore"; additions drafted, chosen and kept as drafts
- [ ] Elad sets models for conversations and for concept art in Settings and tries them
- [x] 8b Writing help in the editor: rewrite a passage, ask the lore about it (comments on a
      passage wait)
- [x] 8c Character chat: a profile from the entries, approved and kept in the library; lines
      checked, improvised ones marked; a line added to the entry as a draft
- [x] 8d Discovery on a map: proposals from what is near, checked; concept art when asked;
      kept as a new entry with a marker

## Now: stage 7, more map views

Design: [stage 7](designs/stage-7-more-map-views.md), revised after an implementation-readiness
review.

- [x] 7a Projections as in map-reprojector: eight of them, turned on three axes, focus on a region
- [x] 7b Layers beneath a globe, sharing its places: Up and Down
- [x] 7c Schematic maps: no measuring; worlds revolving as the years move
- [ ] Elad tries Derdama's layers and the Layered Heavens with his own images
- [ ] Open: whether the lower layers ever stop lining up with Ezob; which way worlds revolve

## Now: stage 6, maps in time

Design: [stage 6](designs/stage-6-maps-in-time.md), revised after two independent reviews.

- [x] 6a The time bar: a chronicle, a year, features appearing, fading and going
- [x] 6b A feature tied to a span; the editor saying which span decides
- [x] 6c Later shapes: added from a span, pinned for editing, swapped by the year
- [ ] Elad tries it on one of his own maps
- [ ] Open: an event's feature staying after the event; images that change with time; marking
      features whose entry has no span

## Now: stage 4, maps

Design: [stage 4](designs/stage-4-maps.md), a draft the author has not read yet.

- [x] 4a Map files: form, merging by item, drafts and Publish, marker sets
- [x] 4b Viewer: flat maps and globes in WebGL, pan and zoom, globe and flat view, the place kept
      in the address
- [x] 4c Markers with entries and icons; "On maps" on an entry
- [x] 4d Paths, zones, layers, child maps, undo
- [x] 4e Measuring; a globe's radius and a flat map's scale
- [x] Adding a second image to a map and setting an image's extent; reordering features; a zone
      that contains a pole in the flat view
- [ ] Try it on the real vault's images and on a real phone (frame rate)

## Later stages

Each gets a short design of its own before it is built.


## Done

- Design reviewed and approved (2026-11-20)
- Vault package: notes, frontmatter, line endings, links, link resolution, rename planning
- Server: Git gateway, index, login, status, image serving
- Drafts, two-call Publish with merge and conflicts, renames, crash recovery
- Reader: folder tree, entries with links, embeds and backlinks, status page
- Editor: autosave, new and delete, unpublished list, Publish, merge and conflict screens
- Sample preview at frontier.haviv.pro
- Lightbox for images in an entry: large view, next and previous, full-size zoom, swipe, keyboard
  (from the ideas inbox, moved up on 2026-11-21 at Elad's request; it displaced nothing)
- A link to a missing image shows as a missing link, not a broken picture
- Link autocomplete after `[[`, over names and aliases; an alias is written as `[[Entry|Alias]]`
- Browser test suite in the repo: 23 tests at phone and desktop size, run in CI
- Backup of working files to a folder or S3-compatible bucket, a few minutes after a change and
  nightly; restore command. The bucket path has not run against a real bucket yet.
- Rename and move screen
- Quick switcher: jump to an entry by name or alias (the magnifier, or Ctrl+K)
- Full-text search in the same box as the switcher, with the words around each match
- Outline of an entry's headings; preview of a linked entry on hover (mouse only)
- Editing toolbar for link, heading, list, bold, italic, undo and redo
- A GitHub personal access token works in place of a GitHub App (`GITHUB_TOKEN`); the webhook is
  optional
