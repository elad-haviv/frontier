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

Written by the build, below.
