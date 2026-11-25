# Stage 25: keep going

Approved by Elad on 2026-11-25, with all four recommendations. Mockup:
https://claude.ai/artifact/P2A3dozNeo55Xu3L1iBHqb (desktop and phone, interactive). The numbers in
brackets are the idea numbers used in the mockup.

## 1. What's wrong today

- The home page redirects to the README, so every session starts cold.
- The quick switcher opens empty.
- Nothing says which entries are thin, which links point nowhere, or what was read or edited last.
- An entry ends in a plain list of backlinks, so finishing an entry is a dead end.
- Publish ends quietly.

## 2. The design

One new page (Home), one new strip at the foot of an entry ("From here"), recents in the switcher,
and small controls: back to last, random entry, resume position, next and previous in the folder,
pins, folder stub counts, a nudge after Publish. Everything except [13] and [14] is computed from
the index and costs nothing.

### Home [1]

Replaces the redirect to the README (the README stays an ordinary entry). Desktop: two columns.
Phone: one column, the queue's filters scroll sideways, and the dice is a round button above the
bottom of the screen.

- **Pick up where you left off** [1][5]: the newest unpublished draft with "Continue editing", and
  the last entry read.
- **What to work on next**: one list with four filters, each row with its reason.
  - *Needs love* [6]: see the rules below.
  - *Wanted* [7]: names that are linked but have no entry, with the number of entries that mention
    them and a likely folder (the folder most of the mentioning entries are in). "Write it" opens
    New entry with the name and folder filled in.
  - *Orphans* [9]: entries nothing links to.
  - *Dead ends* [9]: entries that link to nothing.
- **Random entry** [4]: a dice with four kinds: any, a stub, in this folder (on Home: the folder of
  the last entry read), untouched for 6 months.
- **A question to answer** [14], AI: one question drawn from a thin entry, with "Answer it" (opens
  the editor on that entry) and "Another question". Hidden when no AI model is chosen. The question
  is made on request and kept for the day; it is never made without a click the first time.
- **Working on** [18]: pinned entries.
- **Recently** [2]: the last entries read or edited on this device.
- **This week** [15]: entries touched, words added and missing links filled in the last 7 days,
  with one bar per day. No goal and no streak.
- **On this day** [17]: entries first written, or last changed, on this date a month, six months or
  a year ago (from the library's history).
- **Folders** [16]: each top folder with "n of m are stubs" and a bar.

### Needs love: the rules (decision A)

Fixed rules, each shown as the reason on the row. Each rule can be switched off in Settings. Rows
are ranked by the number of entries that link to the entry, then by the number of rules it trips.

| Rule | Trips when |
| --- | --- |
| Stub | Under 80 words of body text and linked from 3 or more entries |
| Empty headings | A heading with no text before the next heading of the same or higher level |
| No type | The entry has no type field |
| No picture | The entry has no image (only for entries with 150 words or more) |
| Open comments | The entry has unresolved comments |
| To-do marks | The body contains `TODO`, `TBD` or `??` |

A "stub" elsewhere in this design (the dice, folder counts, the switcher tag) means under 80 words.
The README, and files in `.frontier/` or an appendix folder, are never listed.

### An entry

- **Back to last** [3]: a chip "‹ Last: Name" in the sticky heading line, and Alt+←. On the phone, a
  back arrow in the top bar. "Last" is the entry viewed before this one, kept on the device.
- **Resume position** [5]: reopening an entry scrolls to where reading stopped and says so in a thin
  line with "Start from the top". Only when the stop was more than one screen down and less than 30
  days ago. The editor reopens with the cursor where it was.
- **Pin** [18]: a pin button in the sticky line, and `p`.
- **From here** [11], in place of the plain backlinks footer (the backlinks stay, as one line that
  opens to the full list):
  - *Missing from this entry* [7]: this entry's links that have no entry, each with the number of
    entries that mention it and "Write".
  - *Named here, not linked* [8]: entries whose text contains this entry's name or one of its other
    names without linking it, each with the sentence and "Link it".
  - *Close by, and thin* [6]: linked entries, either direction, that trip a needs-love rule.
  - *Related*: entries that share the most links with this one and are not linked directly.
  - *What's missing* [13], AI: a button. It reads the entry and its neighbours and proposes up to
    five entries the text implies, with a reason each, and two open questions. "Draft this entry"
    goes through the existing draft-entry flow. Hidden when no AI model is chosen.
- **Next and previous in the folder** [10]: two links at the foot, in the folder tree's order, and
  Alt+↑ / Alt+↓.

On the phone the "From here" groups stack in one column.

### Link it (decision D)

"Link it" changes another entry's text: the first unlinked mention becomes a link. The change is
saved as an ordinary unpublished draft of that entry, with Undo in the toast. Nothing is published
until Publish. A mention inside a code block, a link, a heading or the frontmatter is never
offered.

### Quick switcher [2]

Opened empty it shows: "Back to last: Name", "Random entry", then the last 8 entries read or edited.
Typing replaces the list with the search there is now. A stub carries a small "stub" tag in the
results.

### After Publish [12]

In place of the quiet end: "Published." with up to three next steps from what was just published:
a stub one of the entries links to, a missing link in one of them, and a random entry untouched for
6 months. It goes away after 10 seconds or on the first key press.

### Left bar

"Random entry" under New entry; "Home"; a "Working on" list of pins above the folders [18]; each top
folder shows its stub count [16]. In the rail (collapsed) the dice and Home are icons.

### Keys

| Key | Does |
| --- | --- |
| Ctrl+K | Search, with recents when empty (as now) |
| g h | Home |
| g r | Random entry |
| Alt+← | Back to the last entry |
| Alt+↑ / Alt+↓ | Previous / next entry in the folder |
| p | Pin or unpin the open entry (reader only) |

Where one of these clashes with the keys registry, the registry's existing key wins and the nearest
free key is used and written here.

As built: `g h` and `g r` are two presses in a row (the second within 1.5 seconds, never in a text
field, never with Ctrl or Alt). The map's editing tools use `g` (Place with AI), `r` and `h` on their
own, so while a map is being edited `g` is the map's and the two keys do not run there; elsewhere
nothing clashes, and no key had to change.

## 3. Where things are kept

- **Pins** (decision B): in the library, in `.frontier/pins.json`, so they follow the author between
  devices. Saved at once, like the folders file; not part of a draft.
- **Recents, the last entry, reading positions and cursor positions**: on the device only.
- **The week's numbers and "on this day"**: computed from the library's history; nothing new is
  stored.
- **The day's question**: kept on the server with the day it was made.

## 4. Empty states

- New library: Home shows "Write your first entry" and New entry, and nothing else.
- Nothing needs love: "Every entry has a type, a picture and some text. Pick a random one to reread."
- No recents: the switcher shows only the random row.
- Offline: Home shows pins and recents from the device copy; the queue says it needs a connection.
- No AI model: the two AI pieces are not shown.

## 5. Progress (decision C)

Only the quiet weekly line. No goals, no streaks.

## 6. Interfaces

Everything the pages need from below the UI. Types are in `@frontier/schema`
(`packages/schema/src/keepGoing.ts`, `keepGoingSettings.ts`); the client calls are on `api` in
`apps/web/src/api.ts`. All routes need the session. Errors are the usual `{ error: { code, message } }`.

### Numbers and words

- A **stub** is an entry with fewer than `STUB_WORDS` (80) words of body text: `isStub(words)`.
  Body text is the text after the frontmatter without headings, comments and embedded pictures; a
  link counts as the words it shows (`bodyWords` in `@frontier/vault`).
- `words` is on `GraphNode` (every node, drafts included), on `TreeNote` and on the results of
  `GET /api/search` and `GET /api/switcher` (published entries only; absent otherwise). The device's
  compact index (`/api/graph`) has it, so the offline switcher can tag stubs from `GraphNode.words`.
- The README, files outside notes, `.frontier/` and `99 Appendices` are never listed by any
  queue list, random pick, folder count or question.
- The queue, From here and the random dice read the **published** index; a draft does not change them
  (an entry that is only a draft has an empty From here). The week and "on this day" read the library's
  saved versions.

### Endpoints

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/keep-going/queue` | none | `QueueResponse` |
| `GET /api/keep-going/week` | `?tz=` minutes east of UTC, default 0 | `WeekResponse` |
| `GET /api/keep-going/from-here` | `?path=` | `FromHereResponse` (404 when no such entry) |
| `POST /api/keep-going/link-it` | `LinkItRequest` `{ path, target }` | `LinkItResponse` |
| `POST /api/keep-going/link-it/undo` | `LinkItUndo` `{ token }` (the `undo` of the answer, as it was) | `{ ok: true }` |
| `GET /api/keep-going/random` | `?kind=any\|stub\|folder\|old&folder=&not=` (`RandomQuery`) | `RandomResponse` (`entry` null when nothing fits) |
| `POST /api/keep-going/after-publish` | `AfterPublishRequest` `{ paths }` | `AfterPublishResponse` (0 to 3 steps) |
| `POST /api/keep-going/whats-missing` | `WhatsMissingRequest` `{ path }` | `WhatsMissingResponse` (AI) |
| `GET /api/keep-going/question` | `?tz=` | `QuestionResponse`; never makes one (AI) |
| `POST /api/keep-going/question` | `MakeQuestionRequest` `{ another?, tz? }` | `QuestionResponse`, `question` always set (AI) |
| `GET /api/pins` | none | `PinsResponse` |
| `POST /api/pins` | `PinRequest` `{ path }` | `PinsResponse` |
| `DELETE /api/pins` | `?path=` | `PinsResponse` |
| `PUT /api/pins` | `PinOrderRequest` `{ paths }` | `PinsResponse` |
| `PUT /api/settings/keep-going` | `KeepGoingSettingsRequest` | `KeepGoingSettings` |

Client (`api.`): `keepGoingQueue()`, `keepGoingWeek(tz?)`, `fromHere(path)`, `linkIt(path, target)`,
`undoLinkIt(undo)`, `randomEntry(query?)`, `afterPublish(paths)`, `whatsMissing(path, signal?)`,
`todaysQuestion(tz?)`, `makeQuestion(another?, signal?)`, `pins()`, `pin(path)`, `unpin(path)`,
`reorderPins(paths)`, `setKeepGoingSettings(change)`. `tz` defaults to the browser's own offset. The
AI calls take an `AbortSignal`; aborting stops the provider call.

What each answer holds:

- **Queue.** Lists carry `total` and at most `QUEUE_ROWS` (200) `rows`. `needsLove` rows are
  `NeedsLoveRow` (an `EntryRow` plus `reasons: { rule, text }[]`, the text being the words for the
  row, such as "Stub: 42 words, linked from 5 entries"), ranked by `linkedFrom` then by number of
  reasons. `wanted` rows are `WantedRow` `{ name, mentions, folder, examples }`, most mentioned
  first; `folder` is the folder most mentioning entries are in, null when none. `orphans` (nothing
  links to them, most links out first) and `deadEnds` (link to nothing, most linked first) are
  `EntryRow`s. `folders` are `FolderStubs` `{ folder, entries, stubs }` for each top folder, in the
  tree's order. `rules` is the needs-love rules in force. "Write it" opens New entry with `name` and
  `folder`.
- **Week.** `week.days` is always 7 days, oldest first, the last being today in the reader's zone.
  `entriesTouched` counts entries saved in a version in those days; `wordsAdded` is the words added
  net of words taken, per file and version; `linksFilled` is entries *written* this week that some
  older entry already linked to. `onThisDay` has up to 4 rows for each of a month, six months and a
  year ago (`span`), written ("first written that day") before changed. A renamed or moved entry
  keeps its age: the library's history is read with rename detection, a rename that changes no words
  is neither a save nor a new entry (it does not touch the entry, fill a link or end its
  "untouched" time), and one that also changes words is a save but not a new entry. When the
  history is longer than the 5000 commits read, an entry whose first appearance in them is not its
  being added has no known "written" day and is only ever listed as changed.
- **From here.** `missing` (this entry's links with no entry, with library-wide `mentions`),
  `unlinked` (up to `MENTION_LIMIT` = 20 other entries that name this entry's title or an alias
  without linking; one each, with `sentence` and `at` = [from, to) of the name inside it; `unlinkedMore`
  when there are more), `thin` (up to 10 linked neighbours that trip a rule, `direction` says which
  way), `related` (up to 6, most shared links, not directly linked), `previous` and `next` (same
  folder, tree order, null at the ends). Never offered as a mention: code, existing links, headings,
  comments, web addresses and email, footnotes, reference links and definitions, setext headings,
  indented code, frontmatter, entries that already link here, appendices, the README. A
  title that the library also writes in lower case in three or more entries ("Water") is matched
  only in its own capital; any other name matches in any letter case.
- **Link it.** Turns the first unlinked mention of `target` in `path` into `[[Title]]`, or
  `[[Title|words as written]]` when the words differ (an alias, other letter case; `\|` on any line that has a table's own `|`, with or without a pipe
  at its start),
  or the path form when another entry shares the title. It is saved as an ordinary unpublished draft
  of `path`, on top of the author's own draft when there is one, with a new revision, so a device that
  started from older text gets `stale_revision` on its next save as for any server change. The link
  is made on the entry's text as it is when it is saved, so an editor save that lands meanwhile is
  kept. Refused:
  404 when the mention is gone or an entry is missing, 403 `not_allowed` for append-only or read-only
  entries and entries with texts to merge. `before` and `after` are the sentence either side. Keep
  `undo` and send it to `link-it/undo` as it is: it is a `{ token }` and nothing else is read from
  the request. The server keeps what it stands for (the draft, its revision and the text before) for
  15 minutes, and the newest 200 only. Undo removes the draft when the entry had none, or puts the
  draft's earlier text back; refused with 403 `not_allowed` when the draft has changed since (the
  toast should then say to undo in the editor), 404 when the draft is gone or the token is unknown,
  used already or older than 15 minutes (the message says so; treat it as "undo in the editor").
- **Random.** Picks on the server. `old` is untouched for 6 months (`OLD_MONTHS`), by the library's
  history. `folder` needs `folder` (400 without) and includes sub-folders. `not` is never picked.
- **After Publish.** `steps`, in this order and each only when there is one: `stub` (a stub a
  published entry links to, most linked first, with the entry it was found from), `missing` (a link in
  a published entry with no entry, most mentioned first), `old` (a random entry untouched for 6
  months, not one just published). Send the paths from the publish plan; entries not there are
  ignored.
- **What's missing.** At most 5 `proposals` `{ name, reason, folder }` (names that are entries, drafts
  or neighbours are removed; `folder` is a folder that exists, else the entry's own, else null) and 2
  `questions`. Nothing is saved. "Draft this entry" goes through `api.draftEntry(said)`
  (`POST /api/lore/draft`) with the name and reason in `said`. It reads the entry as the author sees
  it (draft first) and up to 8 linked entries; an entry held in quarantine is not sent.
- **Question of the day.** `DayQuestion` `{ day, path, title, question, model, madeAt }`, kept in
  `/data/state/question.json`. `day` is the reader's day (`tz`); `GET` gives today's or null. `POST`
  without `another` returns today's kept question without calling the model; with `another` it makes a
  new one from a different thin entry and replaces it. "Answer it" opens the editor at `path`.
- **AI errors** (409 `ai_off`, 402 `ai_cap_reached`, 502 `ai_failed` and `ai_bad_answer`, `ai_stopped`,
  403 `not_allowed`) are the same as for lore conversations; `href` on the failure says where in
  Settings it is put right.
- **Is an AI model chosen?** `status.ai.conversation` (boolean, in `GET /api/status` and its events;
  optional in the type, absent from an older server). Both AI pieces need it; show them only when it
  is true. (`status.ai.on` is the separate flag for proposing fields.)

### Pins and settings

- `.frontier/pins.json` is a library item file (`LIBRARY_FILES`, name `pins`), like the folder file:
  saved at once on the server by the routes above, so every device sees it, and part of the next
  Publish like the folder file is (it shows among the unpublished changes as "Pins").
  Format, one pin to a line, in the order shown:

  ```json
  {
    "version": 1,
    "pins": [
      {"path":"01 Places/Harbor/Harbor.md"},
      {"path":"02 People/Mira.md"}
    ]
  }
  ```

  At most `MAX_PINS` (30), each path an existing `.md` entry, each once. `PinsResponse.pins` is
  `{ path, title, words }[]` with pins whose entry no longer exists left out (and dropped from the file
  at the next change). A saved rename of an entry or its folder rewrites the pins in the same version.
  The generic `GET/PUT /api/library-files/pins` also exists. `GET /api/pins` is kept on the device and
  answered from it offline; the other keep-going reads are not.
- Settings: `GET /api/settings` has `keepGoing: { needsLove: { stub, emptyHeadings, noType,
  noPicture, openComments, todoMarks } }`, all booleans, all `true` by default, stored in
  `/data/state/settings.json`. `PUT /api/settings/keep-going` takes any of them. `NEEDS_LOVE_RULES`
  and `NEEDS_LOVE_LABELS` (schema) give the order and the words for the Settings page.
- Rules, as built: **stub** under 80 words and linked from 3 or more entries; **empty headings** a
  heading with no text before the next heading of the same or a higher level (text under a sub-heading
  counts); **no type** no `type` field of its own (a folder's type does not count); **no picture** no
  image linked or embedded, only from 150 words (`PICTURE_WORDS`); **open comments** the entry has
  comments; **to-do marks** `TODO`, `TBD` or `??` in the body outside code.

### Device module: `apps/web/src/keepGoing/recents.ts`

Device only (one `localStorage` key, `frontier.keepGoing.v1`); nothing goes to the server. Separate
from the offline copy's "recent items", which keep entry bodies, not what was read or where.

- `recents` (the shared instance, a `Recents`), `useRecents(): RecentsSnapshot` (`{ recents, current,
  previous }`, re-renders on change), `useLastEntry(open: string | null): { path, title } | null`.
- `recents.viewed(path, title, kind = "read")`: call when an entry (or its editor, with `"edited"`)
  is shown. The entry shown before becomes the last one. `recents.touch(path, title, kind)` only
  puts it first in the list (use for "edited" on a save).
- `recents.lastBefore(open)` / `lastEntry(snapshot, open)`: "‹ Last: Name" and Alt+←. From the open
  entry it is the one before; from anywhere else (Home, switcher) it is the entry that was open.
- Recent list: `RecentEntry { path, title, kind: "read" | "edited", at }`, newest first, each entry
  once, at most `MAX_RECENTS` (30). The switcher shows the first 8.
- Reading position: `recents.setScroll(path, y)` (pixels from the top; written 400 ms later),
  `recents.resumeAt(path, viewportHeight): number | null` (only when `y` is more than one screen
  down and less than 30 days old: `shouldResume`), `recents.clearScroll(path)` for "Start from the
  top". Cursor: `recents.setCursor(path, offset)`, `recents.cursorAt(path): number | null`.
- `recents.renamed(from, to, title)`, `recents.forget(path)`, `recents.flush()` (written on
  `pagehide` already), `recents.subscribe(fn)` and `recents.snapshot()` for other stores. Positions
  are kept for the newest `MAX_POSITIONS` (200) entries.

### For tests and the sample vault

- The sample vault (`FRONTIER_SAMPLE_VAULT=1`) now has, besides the fixture (dated a year ago): a
  stub linked three times with a to-do mark and an empty heading (`01 Places/Salt Flats`), an orphan
  of 150+ words with no picture and an unlinked mention of Harbor (`01 Places/Salt Road`), an
  unlinked mention of Mira (`03 Things/Brine Works`), a dead end (`03 Things/Salt Crystal`), a second
  orphan (`02 People/Ruun`), wanted names mentioned three times each (`The Sunken Gate`, `Tide
  Singers`), and versions dated six months, a month, three days and one day ago, so "this week" and
  "on this day" show something. The fixture's own entries are unchanged.
- The e2e AI stand-in (`apps/web/e2e/server.mjs`) answers both AI calls: What's missing proposes
  "<Title> Keeper" (in the entry's folder) and "<Title> Festival" with two questions; the question
  of the day is "What does <thin entry> smell like?".
