# Stage 5: chronicles, a workbench for shaping history

Status: Draft, 2026-11-21, revised after a design review and an implementation-readiness review.
Author: Elad Haviv. Parent: [Frontier](frontier.md). Source: the concept brief `concepts_brief.md` at
the top of this repository, which records the brainstorm, seven reviewers' findings and the
alternatives weighed.

## Overview

The parent design planned this stage as a reader of dates: parse the dates in entries, convert between
calendars, draw a timeline. The vault has no dates. The author kept time vague, then wrote human
history on Ezob, could not see how it fitted his other narratives, and deleted it: the arrival of
humans and the fading of Earth's memory felt "both too quick and at the same time too slow" beside the
Nirani arrival, with "many events over a great span in too many different places at once".

This stage gives him a place to shape history before it is written. He lays out spans in lanes, says
how they relate and roughly how long they last, and sees their order, their overlap and their lengths
beside each other and beside real-world cases. Calendars, the pulse count and the difference in time
between planes come later, as labels on a shape he is content with.

## Terms

*   **Chronicle**: one file holding one version of a history.
*   **Span**: something with a beginning and an end, such as a people's presence or a war.
*   **Event**: a span that is a single moment. It has a start and no length.
*   **Point**: the beginning or the end of a span. An event has one point.
*   **Lane**: a named row of spans, such as a place or a people.
*   **Relation**: one statement by the author about two spans, such as "A is after B".
*   **Rough number**: the author's words plus a lowest and a highest value, in years. "A few
    generations", 60 to 150. Decimals are allowed.
*   **Unit**: a word of the author's with a range, such as "generation: 20 to 35".
*   **Case**: a real-world example with a rough length and a source, used as a ruler.
*   **Clock**: whose time a number is counted in. One per plane.
*   **States of a relation**: *holds*; *does not fit* (red); *may not fit* (amber); *cannot tell yet*
    (grey); *contradicts* (it is part of a circle of statements); *broken* (it names a span that is
    gone); *not checked* (a kind this version does not know). Only relations are ever flagged, plus
    one thing about a span alone: *its own numbers disagree*.

## What this replaces and amends

| Where | Now reads |
| --- | --- |
| Parent, overview job 4 and stage 5 in the stage table | Shape history: chronicles with lanes, spans, relations and real-world cases |
| Parent, non-goal "Deciding canon" | Frontier does not decide canon. It may hold working numbers, which are not lore |
| Parent, CUJ 8 | Replaced by CUJ 14 below |
| Parent, CUJ 5, the timeline clause | Dropped from this stage. A later design brings entries' `time` items onto a chronicle |
| Parent, CUJ 9 | The time slider reads the main chronicle: for an entry, the span linked to it. One span per entry stands for its existence |
| Parent, "Time" section | Replaced by this document. No date parser, no solver |
| Parent, "Structured fields" | `when` stays the author's words and is never read as a number |
| Parent, "Where each kind of data lives" | New row: chronicles in `.frontier/chronicles/`; shipped cases in Frontier's code |
| Parent, rejected alternative "Time data on maps, or map data on entries" | Still rejected. An entry says what its text says; a chronicle says where the author placed it |
| Stage 3, "`begins` and `ends` ... Stage 5 uses them" | Not used by this stage |
| Stage 4, feature keys `from` and `until` | Left for the design of maps that change with time |

## What stage 5 delivers

| Part | The author can |
| --- | --- |
| 5a Order and comparison | Make a chronicle; add lanes, spans and events; say how they relate; give rough lengths with his own units; see them in order; lay a few spans beside real-world cases; see what does not fit; edit through a form on desktop and phone |
| 5b Scale | Place spans; see them to scale; accept an offered fix on a flag; shift several spans at once |
| 5c Two versions | Copy a chronicle; see two one above the other on the same scale, with what differs marked; mark one as the main one |
| 5d Entries | Link a span to an entry; open the entry from the span; see on an entry which chronicles it is on |

Part 5a is built first and tried by the author before 5b is started: it is the first test of whether
order plus comparison answers his trouble. Later, each with its own short design: dragging; entries'
`time` items on a chronicle; proposals for missing lengths; starting points for the Ezob calendar and
the pulse count; a time ratio per plane; maps that change with time (stage 6).

### CUJ 14: Find out what is too quick and what is too slow

*   **Given**: A new chronicle.
*   **When**: On his phone the author adds lanes Humans and Nirani; adds the event "First Landing" and
    the spans "Earth memory fades", "Earth technology is lost" and "Nirani presence"; says the fading
    starts with the landing, the loss of technology is during the fading, and the Nirani presence is
    longer than the fading; defines "generation" as 20 to 35 years; gives the fading "3 to 5
    generations" and the Nirani presence "about 400 years"; and opens Compare with the fading and two
    cases.
*   **Then**: The order view draws the fading starting at the landing with the loss of technology
    inside it, and shows the Nirani lane as not yet related to the Humans lane. Compare shows the
    fading, 60 to 175 years, beside the two cases, each with its range and source. "Nirani presence is
    longer than Earth memory fades" holds. He changes the fading to "15 to 30 generations"; the same
    statement turns amber and says which range decides it. Nothing else changed.

### CUJ 15: Try another version

*   **Given**: A chronicle with placed spans.
*   **When**: He copies it, selects the Humans lane's spans in the copy and shifts them 500 years
    earlier, then opens "Compare with…" and picks the original.
*   **Then**: Both are drawn on one ruler, aligned on the span both count from. The shifted spans are
    marked as different. Each chronicle lists its own flags.

Stage 5 is done when both work on the deployed app with his own history.

## Non-goals

*   Reading a date out of free text.
*   Moving any span because another moved. Decided by the author: the others stay and show where they
    no longer fit. Shifting a selection is the author moving several spans himself.
*   Conversion between calendars, the pulse count, plane ratios. The file allows for them; nothing reads
    them.
*   Treating a working number as lore. Nothing in a chronicle is written into a note's text.
*   Cases that flag or validate.
*   A compressed time scale.
*   Zooming out to the age of the world. Ezob is ancient; recorded history is thousands to tens of
    thousands of years. The workbench covers a generation to about 100,000 years. An older beginning
    is an open start.
*   AI. No model is called anywhere in this stage.
*   Entries' `time` items, their ids and a tray of unplaced statements. The vault has none today.

## The chronicle file

`.frontier/chronicles/<id>.json`. Written through drafts and saved as versions, like a map: one item
per line, the same bytes for the same content, unknown keys kept. Every id, of the chronicle and of
each lane, span, relation, unit and case, is 8 random characters; the short ids below are for reading.

```json
{
  "version": 1,
  "id": "c4h7x2ab",
  "title": "Ezob, humans arrive early",
  "main": false,
  "clock": "ezob",
  "origin": "s1",
  "lanes": [
    { "id": "l1", "name": "Humans", "color": "#9a3b1f", "clock": "ezob" }
  ],
  "units": [
    { "id": "u1", "name": "generation", "low": 20, "high": 35 }
  ],
  "spans": [
    { "id": "s1", "lane": "l1", "name": "First Landing", "point": true, "start": { "words": "", "low": 0, "high": 0 }, "end": null, "length": null, "entry": null, "note": "" },
    { "id": "s2", "lane": "l1", "name": "Earth memory fades", "point": false, "start": null, "end": null, "length": { "words": "3 to 5 generations", "low": 60, "high": 175, "clock": "ezob", "unit": "u1", "count": [3, 5] }, "entry": null, "note": "" },
    { "id": "s3", "lane": "l1", "name": "The Adyni", "point": false, "start": "open", "end": null, "length": null, "entry": null, "note": "" }
  ],
  "relations": [
    { "id": "r1", "a": "s2", "kind": "starts_with", "b": "s1" }
  ],
  "compare": {
    "spans": ["s2"],
    "cases": [
      { "id": "k1", "name": "…", "low": 300, "high": 500, "from": "…", "to": "…", "source": "…", "caveat": "…", "shipped": "norse-greenland" }
    ]
  }
}
```

*   **Year 0 and `origin`.** `start` and `end` are rough numbers of years from year 0, on the
    chronicle's clock; they may be negative. `origin` names the span whose start is year 0, or is null
    while nothing is placed. The first span given a start becomes the origin. "Count from this span
    instead" is an action of the author's that rewrites every stored start and end by one amount. A
    later calendar is then one statement: "the origin is year 1 EM".
*   **A span stores what the author gave** of `start`, `end` and `length`. The missing one is worked
    out: `end = start + length` (lows added, highs added), `start = end − length`, `length = end −
    start`. If all three are given and the given length lies outside what the other two allow, the
    span shows "its own numbers disagree".
*   **Open ends.** `start: "open"` means older than the workbench shows; `end: "open"` means still going
    on. An open end is drawn as a broken edge. A span with an open end has no length.
*   **An event** has `point: true`, a `start` or none, and no `end` or `length`. Its two points are one.
*   **`length.clock`** is written on every length when it is saved: the lane's clock at that moment.
    Moving the span to another lane, or changing a lane's clock, changes no stored length. Starts and
    ends are always on the chronicle's clock. In stage 5 every clock runs alike and nothing reads these
    keys; a later ratio per plane then changes no stored number.
*   **Units.** A length may record `unit` and `count`, a lowest and highest number of that unit. `low`
    and `high` are still what is used. If the unit's range is changed later, each length that used it
    shows "written with generation as 20 to 35; now 25 to 40" with one tap to recalculate. Nothing
    recalculates by itself.
*   **`words`** is free text and is never read by the code.
*   **Relations** are items of their own. `a` and `b` are span ids. `kind` is one of `after`, `before`,
    `during`, `starts_with`, `ends_with`, `overlaps`, `longer_than`, `shorter_than`. `before` is `after`
    with `a` and `b` exchanged, and `shorter_than` is `longer_than` exchanged. A kind the code does not
    know is kept and is *not checked*.
*   **`compare`** remembers which spans and cases the author last laid side by side. A shipped case is
    copied into the file when picked, so a later correction to Frontier's list does not change what a
    chronicle showed; `shipped` names where it came from. The author's own cases have no `shipped`.
*   **`main`**: at most one chronicle has it true. "Make this the main chronicle" is one call that
    saves this one with `main: true` and drafts `main: false` into any other that had it.
*   **`entry`** is an entry's id or null (part 5d).
*   **Valid** means: this form, version 1, unique ids, at least one lane, every span in a lane that
    exists. A relation naming a missing span, a circle of relations, and a `unit` or `origin` that
    names something missing are all valid and are shown as such: a merge can produce any of them, and
    the chronicle must still open. A new chronicle has one lane, "Main", `clock: "ezob"`, `main: false`.
    The last lane cannot be deleted.

### Shared with maps

Maps brought a text form with one item per line and a merge by item id. Chronicles need the same.

*   `packages/schema/src/itemFile.ts` holds `serialiseItemFile(value, topKeys, itemKeys)` and
    `mergeItemLists(base, mine, theirs)`, lifted from `maps.ts`, which is rewritten on top of them and
    writes the same bytes. The existing map tests run unchanged.
*   `apps/server/src/publish/publish.ts` gets a short list of file kinds in place of its tests on
    `mapIdOf`. Each kind says: is this path mine; merge these three texts; which entry ids does this
    text name (so a file and the draft that writes an id it names are saved together). Maps keep their
    conflict name `map_changed_on_both`; chronicles add `chronicle_changed_on_both`.
*   A chronicle merge takes lanes, units, spans and relations by id; `title`, `clock`, `origin`, `main`
    and `compare` as single values, mine kept on a clash. If no lane survives, mine's lanes are kept. A
    span left in a missing lane moves to the first lane.
*   `apps/web/src/hooks/useItemFile.ts` is written for the chronicle page: load, change, save after a
    pause, merge on a stale save, undo and redo. Its contract is
    `useItemFile({ load, save, merge })`, where `save(value, revision)` answers `{ value, revision }`.
    The map page keeps its own loop, which also carries its queue of entry links, until part 5a has
    been tried; moving it onto the hook is a separate change with no change in behaviour.
*   The server store for chronicles is its own small class modelled on `MapStore`. A shared store is
    not lifted out: the two differ in everything but reading a folder.

## What is worked out, and never stored

All of this is computed from the file each time, in a new package `packages/time` with no dependency
on the server or the browser.

### The range of a point

Every point has a range `[lo, hi]` in years, or none. A span's start is its `start`, or `end − length`
when those two are given. Its end is its `end`, or `start + length`. An open start is `−∞`; an open end
is `+∞`. An event's end is its start.

### Order

The order view needs no numbers. It orders points, not spans.

1.  **Ties.** `starts_with` makes the two starts one point; `ends_with` the two ends.
2.  **Steps.** Each span's start comes before its end. `A after B` puts B's end before A's start, or
    at it. `A during B` puts B's start before or at A's start, and A's end before or at B's end. `A
    overlaps B` puts A's start before B's end and B's start before A's end. Two points with ranges that
    do not overlap give a step from the earlier to the later; ranges that overlap give none.
    `longer_than` gives none.
3.  **Circles.** If stated relations alone form a circle, every relation in it is *contradicts*, and
    for drawing the relation with the greatest id in the circle is left out, again and again until none
    is left. A step from numbers that disagrees with a stated relation is dropped from the order; the
    relation is still checked by its numbers and comes out *does not fit*.
4.  **Groups.** Spans joined by any chain of ties and steps form a group. Spans in different groups
    have no stated order between them.
5.  **Rank.** Within a group each point's rank is the length of the longest chain of steps leading to
    it. A span is drawn from its start's rank to its end's rank; an event is a mark at its rank.
6.  **Not ordered.** A span in a group of its own (no relation that orders it and no placed number)
    is listed under its lane as "not ordered yet".

The view draws each group as its own block with a gap and the words "not related to the others yet"
between blocks, so it never suggests an order the author did not state. Equal rank inside a group
means only "no order stated between these".

### Checks

A relation is tested on numbers the author gave, independently of the order above. For two points `p`
and `q`, "p at or after q" **holds** when `p.lo ≥ q.hi`, **does not fit** when `p.hi < q.lo`, and
otherwise **may not fit**.

| Kind | Test | Notes |
| --- | --- | --- |
| `A after B` | A.start at or after B.end | If B's end is unknown but `A.start.hi < B.start.lo`, it already does not fit |
| `A during B` | A.start at or after B.start, and B.end at or after A.end | Holds when both hold; does not fit when either does not fit, or when both lengths are known and `A.length.lo > B.length.hi` |
| `A starts_with B` | the two start ranges overlap | Holds or does not fit; never amber |
| `A ends_with B` | the two end ranges overlap | Holds or does not fit; never amber |
| `A overlaps B` | B.end after A.start, and A.end after B.start | Holds when `A.start.hi < B.end.lo` and `B.start.hi < A.end.lo`; does not fit when `A.start.lo ≥ B.end.hi` or `B.start.lo ≥ A.end.hi`. With an event, "overlaps" means the event falls within the span, ends included |
| `A longer_than B` | A.length greater than B.length | Holds when `A.length.lo > B.length.hi`; does not fit when `A.length.hi < B.length.lo`. An event's length is 0. A span with an open end has no length |

When a number the test needs is missing, the relation is **cannot tell yet**, and says which number.
`before` and `shorter_than` are tested as their opposites.

**Sentences.** Every flag names both spans and the author's statement.

| State | Sentence |
| --- | --- |
| does not fit, `after` | "A begins before B has ended; you said A is after B." |
| does not fit, `during` | "A is not inside B; you said A is during B." (or "A is longer than B; …") |
| does not fit, `starts_with` / `ends_with` | "A and B do not begin (end) together; you said they do." |
| does not fit, `overlaps` | "A and B do not overlap; you said they do." |
| does not fit, `longer_than` | "A is shorter than B; you said it is longer." |
| may not fit | "A is after B only if …" then the one range that decides it, chosen as the widest range among the points tested: "…Earth memory fades is nearer 60 years than 175." When no single range decides, "…your ranges are narrower." |
| cannot tell yet | "To check this, give A a start." (the first missing number) |
| contradicts | "These statements go in a circle: …" listing them |
| broken | "This names a span that was removed." |

The list **What does not fit** shows red first, then *contradicts* and *broken*, then amber collapsed
under a count, then grey collapsed under a count.

### Offered starts

Nothing moves by itself. The form offers a number, and the author accepts or ignores it, when he adds a
relation to a span with no start, and on every red flag (one button per span: "Move A", "Move B").

| Kind | Offered for A | Needs |
| --- | --- | --- |
| `A after B` | start = B's end range | B's end |
| `A before B` | end = B's start range; start = that minus A's length when A has one | B's start |
| `A during B` | start from B.start.lo to B.end.hi − A.length.hi (or to B.end.hi) | B's start and end |
| `A starts_with B` | start = B's start range | B's start |
| `A ends_with B` | end = B's end range | B's end |
| `A overlaps B` | start from B.start.lo to B.end.hi | B's start and end |
| `longer_than`, `shorter_than` | nothing | |

For "Move B" the table is read with the two exchanged. If what is needed is missing, nothing is
offered.

## Views

One page per chronicle, `/chronicle/:id`.

*   **Order** (5a). Lanes as rows; groups as blocks left to right; no ruler; the label "order only, not
    to scale". Every bar's width comes from ranks, never from a length.
*   **Compare** (5a). Up to four spans and up to four cases, each a bar from a common start, its range
    as a fade from `low` to `high`, with its name, words and range in years. A case shows what starts
    and stops its clock, its source and its caveat under the bar. The scale is straight and fits the
    longest bar.
*   **What does not fit** (5a). The list above.
*   **Scale** (5b). Lanes as rows with a straight ruler in years counted from the origin. A span with
    a start and an end is a bar, each end fading across its range. A span with only a length is drawn
    at that length in a row under its lane, labelled "not placed". A span with a start and nothing else
    is a tick with a broken edge to the right. An event is a diamond. A bar narrower than 3 pixels is a
    tick marked "not to scale"; an event is never so marked. The page opens fitted to everything
    placed. Zoom by buttons, wheel and pinch.

**Editing** is by form. Selecting a span opens:

*   name, lane, "this is a single moment";
*   start and end, each given either as years from the origin or as "N years after/before the
    start/end of [span]", which is turned into years once and kept as the words;
*   length, given as years or as a count of a unit;
*   open start, open end;
*   note; its relations, with add and remove; delete.

Lanes and units have their own lists: add, rename, recolour, reorder, delete. Deleting a lane with spans
asks, and moves them to the lane above. **Shift** (5b): the author selects spans, or a whole lane, and
moves their starts and ends by a number of years. Every change is saved as a draft about a second later
and can be undone and redone. Chronicles appear among unsaved changes and are saved as versions.

### On a phone

Below 34 rem wide:

*   **Order and Scale** run down the page: time from top to bottom. One lane is expanded, as a column of
    bars with each name beside its bar. Every other lane is a thin strip, 12 pixels wide, showing only
    where its spans lie, so overlap across all lanes stays visible. Tapping a strip expands that lane.
*   "Not ordered yet" and "not placed" spans are listed under the view.
*   Every span, tick and diamond has a tap area at least 44 pixels high.
*   Zoom is by buttons only; a pinch scrolls nothing and zooms nothing.
*   **The form** is a sheet over the lower half of the screen. The view above it stays live and scrolls
    to keep the selected span in sight.
*   **Compare** is a list of bars and needs no change.
*   **Two versions** (5c) show the expanded lane of each side by side.

## Two versions (5c)

*   **Copy** makes a new chronicle from what the author sees, with a new id, the title "Copy of …",
    `main: false`, and the same ids for its lanes, spans, relations and units.
*   **Compare with…** applies to the Scale view. The second chronicle is drawn under the first,
    read-only, on the same ruler. The two are aligned on their origins when both origins are the same
    span, otherwise on a span the author picks that both hold. Lanes and spans are matched by id, then
    by name. A span whose start, end, length or relations differ between the two is outlined, and a
    span present in only one is hatched.

## Cases

*   Frontier ships a short list in `packages/time/src/cases.ts`: 6 to 8 for part 5a. Each has an id, a
    name, `low` and `high` in years, what starts its clock and what stops it, a source with the place in
    it (page, section or address) and a short quotation that supports the figure, a caveat, and the
    date it was checked.
*   The spread in such figures comes mostly from what one counts as the beginning and the end. So each
    case states both, and a case with two defensible readings is two cases.
*   The list answers the author's two questions first: how long until a people forgets where it came
    from, and how long until a skill or technology is lost. At least two cases are of memory or skill
    **kept** for a long time, so the list does not lean toward "short". A human generation is one case.
*   Every figure is looked up in a published source when the list is written. A case that cannot be
    sourced is left out. No case is produced by a model.
*   **The author accepts the list case by case before it ships.** It is shown to him as a table with
    the sources. This is part of 5a's done criterion.
*   Cases are in Earth years and about humans. The Compare view says so, and that an Ezob year of about
    360 days is close enough at this precision.
*   They appear in Compare only, never in a check. Any span with a length can also be picked as a
    ruler, and the author can add cases of his own.

## Entries (5d)

*   A span can be linked to an entry with the picker maps use. An entry without an id gets one through
    `ensureId`, as a draft saved together with the chronicle.
*   A linked span shows the entry's title when it has no name of its own, and opens the entry.
*   The single-entry answer (`EntryResponse`) gains `chronicles: [{ id, title, span }]`, and the entry
    page lists them.
*   One span per entry stands for the entry's existence in a chronicle. A second span linked to the
    same entry is allowed and shows a note saying which one maps will use: the first in the file.
*   A span whose entry is gone shows "its entry was removed" and keeps its name.

## API

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /api/chronicles` | none | `{ chronicles: [{ id, title, main, spans, state }], problems }` |
| `GET /api/chronicles/:id` | none | `{ chronicle, revision, state, entries }`; `entries` maps an id to `{ path, title }` |
| `POST /api/chronicles` | `{ title }` or `{ copyOf }` | `{ id }` |
| `PUT /api/chronicles/:id` | `{ chronicle, revision, link? }`, `link` being `[{ span, path }]` (5d) | `{ chronicle, revision, unlinked }` or `stale_revision` |
| `POST /api/chronicles/:id/main` | none | `{ ok }`; drafts the change into every chronicle it touches |
| `POST /api/chronicles/:id/resolve` | `{ keep }`, `mine` or `theirs` | `{ ok }` |
| `DELETE /api/chronicles/:id` | none | `{ ok }` |

## Files

| File | What | Part |
| --- | --- | --- |
| `packages/schema/src/itemFile.ts`, `maps.ts` | The shared text form and list merge; maps on top of them | 5a |
| `packages/schema/src/chronicles.ts`, `api.ts` | The chronicle's form, text and merge; the new conflict name and shapes | 5a |
| `packages/time/src/{rough,points,order,checks,sentences,offer,cases}.ts` | Rough numbers, point ranges, order, checks, sentences, offered starts, the case list | 5a, 5b |
| `apps/server/src/chronicles/store.ts`, `routes/chronicles.ts`, `app.ts` | The store and routes; the service, its refresh after a fetch, its problems in the status | 5a |
| `apps/server/src/publish/publish.ts`, `routes/drafts.ts` | File kinds; the note routes refusing a chronicle draft | 5a |
| `apps/web/src/hooks/useItemFile.ts`, `api.ts`, `App.tsx`, `components/Shell.tsx` | The save, merge and undo loop; calls; the route and menu entry | 5a |
| `apps/web/src/pages/{Chronicles,ChroniclePage}.tsx`, `components/chronicle/{OrderView,orderLayout,CompareView,Flags,SpanForm,Lists,model}.tsx` | Pages and views | 5a |
| `apps/web/src/pages/Unpublished.tsx` | A chronicle among unsaved changes, its link, and its conflict settled by keeping one | 5a |
| `apps/web/src/components/chronicle/{ScaleView,ShiftForm,TwoVersions}.tsx` | Scale, shift, two versions | 5b, 5c |
| `apps/server/src/routes/entries.ts`, `apps/web/src/pages/Entry.tsx` | Chronicles per entry | 5d |

No new dependency. The order and compare views are drawn with positioned HTML elements, so every
span is a button; the scale view (5b) is drawn in SVG. The shipped cases are part of the web bundle,
read from `packages/time/src/cases.ts`; there is no route for them.

## Risks

| Risk | Effect | Answer |
| --- | --- | --- |
| Order plus comparison does not answer his trouble | The stage misses its point | 5a is tried by the author before anything else is built; it is the smallest thing that tests the idea |
| A case is wrong or over-trusted | He sizes his history against it | Each states what starts and stops its clock, quotes its source, and is accepted by the author; cases never enter a check |
| A working number is taken for lore | Invented dates leak into the world | Chronicles are not notes; nothing writes a number into a note; the page calls them working numbers |
| Amber swamps the list | The one real contradiction is buried | Ties are never amber; amber and grey are collapsed under a count; a test asserts how many ambers CUJ 14 gives |
| Retyping after a change is slow | The tool is "too slow" at its one job | Starts given relative to another span; an offered fix on every red flag; shift for a selection |
| Two devices state opposite things | A circle, or a relation to a deleted span | Both are ordinary states the views mark; the file always opens |
| Lifting the shared parts breaks maps | Maps stop saving or merging | Only the text form, the list merge and the publish kinds are lifted; the map tests run unchanged first |
| The chronicle is invisible to lore chat and agents | They contradict it | Accepted while the memory bank is set aside |

## Verification

*   **Schema:** the same bytes for the same content; unknown keys and unknown relation kinds kept; the
    merge for an item added, changed and removed on each side; no lane surviving; a span in a deleted
    lane; a length keeping its clock when its span changes lane; the map tests unchanged.
*   **Time package:** point ranges from each pair of start, end and length, open ends, and "its own
    numbers disagree"; order for a chain, a tie, `during`, `overlaps`, two unrelated groups, a span not
    ordered, overlapping and disjoint number ranges, a circle, and a number that contradicts a
    relation; every kind in every state, events included; each sentence; each offered start and each
    case where nothing is offered; CUJ 14's ranges giving the stated outcomes and exactly one amber
    after the change; every shipped case having both clock ends, a source, a quotation and
    `low` ≤ `high`.
*   **Server:** make, copy, save and delete a chronicle through drafts; a stale save; changes on both
    sides merged at save, and a clash settled each way; make main clearing the other; the note routes
    refusing a chronicle draft; maps still passing. For 5d: a link writing an id and the two saved
    together; chronicles per entry.
*   **Browser:** CUJ 14 at 375 pixels wide and on a desktop, with no sideways scroll on the phone;
    undo; a relation to a deleted span shown as broken; for 5b an offered fix accepted and a shift;
    CUJ 15; the form sheet leaving the selected span in sight.

## Questions for the author

None blocks 5a.

1.  **The cases.** He accepts the list case by case before it ships; which kinds matter beyond
    forgetting an origin and losing a skill.
2.  **Generations.** How long is a generation, and living memory, for the Nirani and other long-lived
    peoples. He sets these himself in the units list.
3.  **Reaching the lore.** Once a shape is settled, how it gets into the notes.
4.  **Planes.** Whether "a month in Derdama, half a year here" is needed soon, or waits for a story.
