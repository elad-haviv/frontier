# Stage 6: maps in time

Status: Draft, 2026-11-21, revised after a design review and an implementation-readiness review.
Author: Elad Haviv. Parents: [Frontier](frontier.md), [stage 4, maps](stage-4-maps.md),
[stage 5, chronicles](stage-5-chronicles.md).

## Overview

A map shows a world at no particular time. A chronicle says when things begin and end. This stage
joins them: a map gets a time slider that reads a chronicle, and its markers, paths and zones appear,
fade, disappear and change shape as the slider moves.

The author decided three things on 2026-11-21:

1.  **What decides when a feature exists.** A feature linked to an entry follows that entry's span in
    the chronicle. A feature with no entry, such as a border, can be tied to a span directly.
2.  **How much changes.** Features appear and disappear, and a feature can also have a different
    shape or position in different periods.
3.  **Which chronicle.** The main chronicle by default, with a menu to see the map through another.

Where this document and the parent's CUJ 9 differ, this one is the newer statement. Stage 4 kept the
feature keys `from` and `until` for this stage; they are not used. A feature's time is its `span`.

## Terms

*   **Chronicle, span, event, point, rough number**: as in stage 5.
*   **Feature**: a marker, a path or a zone on a map, as in stage 4.
*   **The feature's span**: the one span of the chosen chronicle that says when the feature exists.
*   **Presence**: what the chronicle says about a feature at one year: *not yet*, *perhaps*, *there*,
    *gone*, or *undated*.
*   **Shape**: a marker's position, or a path's or zone's points.
*   **First shape**: the shape the feature has had since stage 4, in its `at` or `points`.
*   **Later shape**: another shape of the same feature, in force from the start of a span.
*   **Timeless**: a feature the chosen chronicle says nothing about. It is always shown, as today.

## What stage 6 delivers

| Part | The author can |
| --- | --- |
| 6a The slider | Turn time on for a map; pick the chronicle; move through its years; see features appear, fade and go; see which are undated; keep the year in the address |
| 6b A feature's span | Tie a feature to a span; see, on any feature, which span decides and why |
| 6c Later shapes | Give a feature another shape from a span's start on; choose which shape to edit; remove a later shape |

### CUJ 16: Watch a border move

*   **Given**: The main chronicle has the spans "The kingdom" (from year 0, no end given) and "The
    war" (its start given as 270 to 290, its end as 300), and an event "The treaty" at year 300. A map
    has a zone "Kingdom" tied to "The kingdom", a marker linked to the entry of a fort whose span is
    "The war", and a coastline path tied to nothing.
*   **When**: The author turns time on, steps through the years from 0 to 300, selects the zone, adds
    a later shape from "The treaty" and drags two of its corners.
*   **Then**: At year 0 the zone and the coastline are drawn and the fort is not. Between 270 and 290
    the fort is drawn faded; from 290 to 300 it is drawn in full; after 300 it is gone. The coastline
    never changes. After he adds the later shape, the zone has its first shape up to year 300 and
    the new one from then on; moving across 300 swaps them, and the corners he dragged moved only
    the later shape. The address holds the year, and opening it again shows the same moment.

Stage 6 is done when this works on the deployed app with one of his own maps.

## Non-goals

*   Moving smoothly between two shapes. A shape is replaced at one moment.
*   Playing time like a film.
*   Images that change with time. A later design can give an image a span in the same way.
*   Planes whose time runs differently. The slider's years are the chronicle's.
*   Dates typed on a feature. Every time on a map comes from a chronicle, so there is one place to
    change it.
*   Entries' `time` items. As in stage 5, nothing reads them.
*   Saving a map and a chronicle together. A map may be saved as a version while the chronicle it was
    tied through is still a draft; its features are then undated in the saved chronicle until that
    is saved too.

## How a feature finds its span

For the chronicle chosen on the map, exactly one of five outcomes:

| The feature has | In the chosen chronicle | Outcome | Counted as |
| --- | --- | --- | --- |
| `span` | a span with that id | **tied**: that span | follows time |
| `span` | no span with that id | **tie missing**: undated. The entry is not looked at | undated |
| no `span`, an `entry` | at least one span whose `entry` is that id | **by entry**: the first such span in the file | follows time |
| no `span`, an `entry` | no span for that entry | **no span**: drawn as today | no span |
| neither | | **timeless**: drawn as today | timeless |

*   A span id belongs to one chronicle and its copies. Seen through an unrelated chronicle, a tied
    feature is *tie missing*. That is intended: the tie was made in another history.
*   The layer panel gains one line while time is on, counting the features of shown layers in the
    four groups of the last column. A feature that follows time but whose span has no numbers is
    counted as undated.

## Presence

`presenceAt(points, isEvent, year)` in `packages/time` returns `"not_yet"`, `"perhaps"`, `"there"`,
`"gone"` or `"undated"`. It reads the span's worked-out ranges (`spanPoints`): `S` for the start and
`E` for the end. A range is **missing** when it is null. An open start is the range `−∞`, an open
end `+∞`; they are not missing, and no year reaches them. Tested in this order:

| # | Condition | Presence |
| --- | --- | --- |
| 1 | An event with `S` missing | undated |
| 2 | An event: `y < S.lo` / `S.lo ≤ y < S.hi` / otherwise | not yet / perhaps / there |
| 3 | `S` and `E` both missing | undated |
| 4 | Both present and `E.hi < S.lo` | undated |
| 5 | `S` present and `y < S.lo` | not yet |
| 6 | `E` present and `y > E.hi` | gone |
| 7 | `S` present and `y < S.hi` | perhaps |
| 8 | `E` present and `y > E.lo` | perhaps |
| 9 | Otherwise | there |

*   An event has one point, and `E` is not read for it: what it stands for is *there* from its moment
    on. The site of a battle stays a site.
*   A missing start counts as "already begun" and a missing end as "still going on".
*   A stored length that disagrees with a stored start and end does not make the span undated here;
    only an end that lies wholly before the start does (row 4).

| Presence | Drawn | Can be tapped |
| --- | --- | --- |
| there; timeless; no span | as today | yes |
| perhaps | everything of the feature at 45% opacity | yes |
| undated | as today, with dashes: a path and a zone's edge are dashed, a marker gets a dashed ring outside the selection ring | yes |
| not yet, gone | not drawn | no |

*   **The selected feature is always drawn while editing**, at 25% opacity when it is *not yet* or
    *gone*, so a feature never vanishes under the author's hand when he ties it or moves the slider.
*   While editing, a switch "Show everything" in the time bar draws every *not yet* and *gone* feature
    at 25% opacity, and they can be tapped.
*   The reader's feature card and the editor say why: "Perhaps: begins between year 270 and 290",
    "Not yet: begins year 270 to 290", "Gone: ended year 300", "Undated: The war has no numbers".

## Later shapes

A feature may hold `shapes`, a list of later shapes:

```json
{ "id": "f1", "kind": "zone", "layer": "l1", "points": [[0,0],[10,0],[10,10]], "entry": null,
  "label": "Kingdom", "child": null, "span": "s2",
  "shapes": [ { "id": "h1", "from": "s7", "points": [[0,0],[14,0],[14,12]] } ] }
```

*   `from` names a span. The later shape is in force from `S.lo` of that span. That is the earliest
    the change may have happened, the same year at which a feature starts to be drawn as *perhaps*.
*   **Usable** means: the chosen chronicle holds the span; its `S` is present and `S.lo` is a finite
    number (an open start is not usable); and the shape fits the feature's kind: `at` for a marker,
    at least 2 `points` for a path, at least 3 for a zone. A later shape that is not usable is never
    in force. It is kept in the file and listed in the editor as "not placed in time" or "broken",
    where it can be removed. It never makes the map unreadable.
*   **Which shape is in force at year `y`:** among the usable later shapes with `S.lo ≤ y`, the one
    with the greatest `S.lo`; if two are equal, the later in the list. If none, the first shape.
*   The editor does not offer a span that already starts one of the feature's later shapes, nor a
    span that is not usable.
*   Later shapes change where a feature is, not whether it exists. Presence still comes from the
    feature's span. A feature with later shapes is counted with those that follow time.
*   With time off, the first shape is drawn and edited, as today.

### Which shape is edited

*   The editor lists the feature's shapes: "First shape", then each later shape by its span's name
    and year, with the one on screen marked.
*   Choosing a shape in the list **pins** it: it is drawn and edited for that feature whatever the
    slider's year, and the editor says "Editing the shape from The treaty". Adding a later shape
    copies the shape on screen and pins the new one, so the next drag always goes to it.
*   Without a pin, dragging changes the shape in force at the slider's year.
*   The pin ends when another feature is selected, the selection is cleared, or the slider moves.
*   The picked corner is forgotten whenever the shape on screen changes, since shapes may have
    different numbers of corners.
*   Undo and redo go back to the year at which the change was made, so what changes is on screen.

## The time bar

*   A **Time** button on the map's bar turns time on. It is offered when at least one chronicle
    exists. With time off, a map behaves exactly as in stage 4. If the list of chronicles cannot be
    read, the button is not offered and nothing else changes.
*   The bar is a row of its own under the map, on every screen size: the chronicle (a menu, the main
    one first), the year as a number that can be typed, a range control, two buttons "earlier" and
    "later", and, while editing, "Show everything". It replaces nothing: the tools stay.
*   **Which chronicle:** the one named by `c` in the address if it can be read; otherwise the main
    one; otherwise the first in the list, and the bar says "no chronicle is marked as the main one".
    A `c` that cannot be read gives a notice and falls back the same way.
*   **Range.** From `scaleBounds` of the chronicle (stage 5): `lo` and `hi`. With `step =
    rulerStep((hi − lo) / 200)`, at least 1, the range runs from `floor(lo / step) × step − step` to
    `ceil(hi / step) × step + step`, so both ends are round and a little beyond what is placed. When
    `lo = hi` the width counts as 1. When nothing with a finite year is placed there is no range: the
    bar says "nothing in this chronicle is placed in years yet", shows no control, and features are
    drawn by the table at year 0.
*   **The year** starts at `hi`, the latest year the chronicle knows, unless the address gives `t`.
    Years are whole numbers; a typed or given year is rounded and clamped to the range.
*   **Earlier and later** jump to the nearest year at which something on this map changes: the `lo`
    and `hi` of the start and end of every span a feature of this map follows, the year after each
    end's `hi`, and the `S.lo` of every usable later shape. This reaches every change however long
    the chronicle is; the range control is for sweeping.
*   **A key** at the end of the bar: a full swatch "there", a faded one "perhaps", a dashed one
    "undated".
*   **The address** gains `t=<year>` while time is on and `c=<id>` when the chronicle is not the
    default. Both are written by the same effect that writes `v`, `hide`, `img` and `edit`. A map
    opened with `t` starts with time on. A link from a zone into a more detailed map carries `t` and
    `c`.
*   **Reading the chronicle:** when the map opens with time on, when time is turned on, when the menu
    changes, and when the tab gets the focus again. A chronicle draft counts, as everywhere.

## The feature editor

A new part, "Time", under the entry link, shown while time is on. With time off it is one line: "Turn
time on to see when this exists."

*   **Which span decides**, one of:
    *   "Tied to *Old kingdom*." with a link to the span (`/chronicle/<id>?span=<span>`) and "Untie".
    *   "Tied to a span that is not in *this chronicle's title*." and "Untie".
    *   "Follows *Mira's years*, the span of its entry." with the link.
    *   "Its entry has no span in *this chronicle's title*." with a link to the chronicle.
    *   "Timeless: nothing says when this exists."
    A span with no name is shown by its entry's title, from the `entries` of the chronicle's answer.
*   **Tie to a span.** A menu of the chosen chronicle's spans, by lane. Choosing one writes `span`. A
    feature with an entry can also be tied; `span` then wins and the editor says so. If the feature
    is already tied to a span the chosen chronicle does not hold, the editor asks first: "This
    replaces a tie made through another chronicle."
*   **Shapes**, as described above, with "Add a shape from…" and a remove button on each later shape.

## The map file

*   `span`: a span id. Absent means not tied; `null` is read as absent. "Untie" removes the key.
*   `shapes`: a list of `{ id, from, at | points }`. An empty list is read as absent; removing the
    last later shape removes the key. A later shape's `id` is 8 random characters and serves only the
    editor's list.
*   **Key order.** A feature is written `id, kind, layer, at, points, entry, label, icon, child, span,
    shapes`, and a later shape `id, from, at, points`. `orderFeature` in `packages/schema` puts any
    feature into this order. `serialiseMap` and `mergeMaps` apply it to every feature first, so the
    same map gives the same bytes however it was built in the browser, and the merge does not see a
    difference where only the order of keys differs.
*   Validation stays lenient: `at` and `points` of a later shape are optional in the form, and
    usability is decided when the map is drawn. Ids of later shapes need not be unique for the map to
    open; the editor never writes a duplicate.
*   `MapFile` stays at version 1. A map without the new keys is written byte for byte as before. An
    older Frontier keeps the keys' values, since unknown keys are kept.
*   **Merging.** A feature is still merged as one item. Two devices changing different later shapes
    of the same feature is a clash, and mine is kept. See Risks.

## How the page uses it

`apps/web/src/map/time.ts` holds everything that knows about time, as pure functions:

*   `readTime(chronicle)` works out once per chronicle: each span's points, the range, the step.
*   `spanFor(feature, time)` gives one of the five outcomes above.
*   `resolve(map, time, year, options)` returns the features as they are to be drawn: each with its
    shape already put into `at` or `points`, plus its presence, opacity and whether it is dashed;
    features that are not drawn are left out. `options` carries the selected feature, the pin, and
    "show everything".
*   `writeShape(feature, shapeId | null, shape)` writes a dragged shape to the first shape or to a
    later one, in the file's key order.
*   `changeYears(map, time)` lists the years "earlier" and "later" jump between.

The page passes the resolved features to `drawOverlay` and uses them for every read of a shape: both
tap tests, the start of a drag, the corner handles, removing a corner, the editor's corner count, and
centring on `f=`. Writes go through `writeShape`. Neither the overlay nor the pointer code learns
about `shapes`.

## Files

| File | What |
| --- | --- |
| `packages/schema/src/maps.ts` | `span`, `shapes`, `LaterShape`, `orderFeature`; the order applied in `serialiseMap` and `mergeMaps` |
| `packages/time/src/presence.ts`, `index.ts` | `presenceAt` and its export |
| `apps/web/src/map/time.ts` | The functions above |
| `apps/web/src/map/overlay.ts` | Opacity and dashes per feature, from the resolved list |
| `apps/web/src/components/TimeBar.tsx` | The time bar |
| `apps/web/src/components/MapPanels.tsx` | The "Time" part of the feature editor; the line in the layer panel; the reason on the feature card |
| `apps/web/src/pages/MapPage.tsx` | Time on and off; the chronicle; `t` and `c`; the pin; undo with its year; all reads of a shape through the resolved list |

No new route and no new dependency. `scaleBounds` and `rulerStep` are imported from
`components/chronicle/scaleLayout.ts`.

## Risks

| Risk | Effect | Answer |
| --- | --- | --- |
| The author edits a shape without noticing which one | The wrong period's border changes | The editor names the shape being edited; a chosen or new shape is pinned; undo returns to the year of the change |
| Most features link to entries with no span | Time on changes almost nothing, and it is unclear why | The layer panel's four counts; the editor says "its entry has no span in this chronicle" |
| A span is deleted from the chronicle | Features tied to it lose their time | They become undated, drawn dashed, and stay selectable; nothing is removed from the map |
| A tie is replaced while looking through another chronicle | The tie for the main history is lost | The editor asks first; undo |
| The chronicle and the map are edited in two tabs | The map shows old years | The chronicle is read again when the map's tab gets the focus |
| Two devices change different shapes of one feature | One device's change to that feature is dropped at the merge | Accepted for now; the unsaved-changes page names the clash, as for any feature |
| "Perhaps" is mistaken for a fault | Faded features look broken | The key in the time bar; the reason on the feature card |

## Verification

*   **Time package:** every row of the presence table for a span and an event; each boundary year;
    start only, end only; an end worked out from a length; open ends; gone inside a rough start; a
    length that disagrees.
*   **Schema:** `span` and `shapes` written and read back; the same bytes whatever order the keys
    were added in, at both levels; `span: null` and `shapes: []`; a later shape with too few points
    still opening; a map without the keys unchanged; a merge after a save round trip with no false
    clash; a merge where two sides change different later shapes, clashing with mine kept.
*   **Web, unit:** each of the five outcomes; two spans for one entry; the shape in force before,
    between and after two later shapes, with equal starts, from an event, from an open start and
    from a span with no start; the pin; writing a shape to the first shape and to a later one;
    removing a corner from a later shape; the range and step for nothing placed, one moment and a
    long chronicle; the years "earlier" and "later" visit; the four counts.
*   **Browser:** CUJ 16 on a phone and a desktop: features appearing, fading and going; a later shape
    added, edited and swapped; the year kept in the address; undo of a drag on a later shape; time
    off leaving the map as before.

## Questions for the author

None blocks the build.

1.  Should an event's feature stay after the event, as designed, or show only around its moment?
2.  Should images be able to change with time next, for a world whose coasts differ by era?
3.  Should a feature whose entry has no span be marked on the map, or only counted, as designed?
