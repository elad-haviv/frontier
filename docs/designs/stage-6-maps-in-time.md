# Stage 6: maps in time

Status: Draft, 2026-11-21. Author: Elad Haviv. Parents: [Frontier](frontier.md),
[stage 4, maps](stage-4-maps.md), [stage 5, chronicles](stage-5-chronicles.md).

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

Where this document and the parent's CUJ 9 differ, this one is the newer statement.

## Terms

*   **Chronicle, span, event, point, rough number**: as in stage 5.
*   **Feature**: a marker, a path or a zone on a map, as in stage 4.
*   **The feature's span**: the one span of the chosen chronicle that says when the feature exists.
*   **Presence**: what the chronicle says about a feature at one year: *not yet*, *perhaps*, *there*,
    *gone*, or *undated*.
*   **Shape**: a marker's position, or a path's or zone's points.
*   **Later shape**: another shape of the same feature, in force from the start of a span.
*   **Timeless**: a feature the chosen chronicle says nothing about. It is always shown, as today.

## What stage 6 delivers

| Part | The author can |
| --- | --- |
| 6a The slider | Turn time on for a map; pick the chronicle; move through its years; see features appear, fade and go; see which are undated; keep the year in the address |
| 6b A feature's span | Tie a feature that has no entry to a span; see, on any feature, which span decides and why |
| 6c Later shapes | Give a feature another shape from a span's start on; edit the shape that is on screen; remove a later shape |

### CUJ 16: Watch a border move

*   **Given**: The main chronicle has the spans "The kingdom" (from year 0, no end given) and "The
    war" (its start given as 270 to 290, its end as 300), and an event "The treaty" at year 300. A map
    has a zone "Kingdom" tied to "The kingdom", a marker linked to the entry of a fort whose span is
    "The war", and a coastline path tied to nothing.
*   **When**: The author turns time on, drags the slider from year 0 to 350, stops at year 310,
    selects the zone, adds a later shape from "The treaty" and drags two of its corners.
*   **Then**: At year 0 the zone and the coastline are drawn and the fort is not. Between 270 and 290
    the fort is drawn faded; from 290 to 300 it is drawn in full; after 300 it is gone. The coastline
    never changes. After he adds the later shape, the zone has its first shape up to year 300 and
    the new one from then on; dragging the slider across 300 swaps them, and the corners he dragged
    moved only the later shape. The address holds the year, and opening it again shows the same
    moment.

Stage 6 is done when this works on the deployed app with one of his own maps.

## Non-goals

*   Moving smoothly between two shapes. A shape is replaced at one moment.
*   Playing time like a film.
*   Images that change with time. A later design can give an image a span in the same way.
*   Planes whose time runs differently. The slider's years are the chronicle's.
*   Dates typed on a feature. Every time on a map comes from a chronicle, so there is one place to
    change it.
*   Entries' `time` items. As in stage 5, nothing reads them.

## How a feature finds its span

For the chronicle chosen on the map:

1.  If the feature has `span`, that span, if the chronicle holds one with that id.
2.  Otherwise, if the feature has `entry`, the first span in the file whose `entry` is that id (stage
    5: "one span per entry stands for its existence").
3.  Otherwise it has none.

A feature with no span is **timeless** when it has neither `span` nor a linked span, and **undated**
when it names a span the chronicle does not hold. A copy of a chronicle keeps its span ids, so a
feature tied to a span follows that span through every version made by copying.

## Presence

Worked out by `packages/time` from the span's point ranges (stage 5, "The range of a point"). For a
year `y`, a span with start range `S` and end range `E`:

| Condition | Presence |
| --- | --- |
| The span has neither a start nor an end | undated |
| `S` is known and `y < S.lo` | not yet |
| `S` is known and `S.lo ≤ y < S.hi` | perhaps |
| `E` is known and `E.lo < y ≤ E.hi` | perhaps |
| `E` is known and `y > E.hi` | gone |
| Otherwise | there |

*   The rows are tested in this order. An unknown start counts as "already begun"; an unknown end as
    "still going on". An open start or end is never reached, so the feature is *there* on that side.
*   **An event** has one point. A feature whose span is an event is *not yet* before its range,
    *perhaps* inside it, and *there* from then on: the site of a battle stays a site.
*   A span whose own numbers disagree (its end before its start) is *undated*.

| Presence | Drawn | Can be tapped |
| --- | --- | --- |
| there, timeless | as today | yes |
| perhaps | at 45% strength | yes |
| undated | as today, with a dashed outline (a marker gets a dashed ring) | yes |
| not yet, gone | not drawn | no |

While editing, a switch "Show everything" draws *not yet* and *gone* features at 25% strength so they
can be selected and changed without moving the slider.

## Later shapes

A feature may hold `shapes`, a list of later shapes:

```json
{ "id": "f1", "kind": "zone", "layer": "l1", "entry": null, "label": "Kingdom", "child": null,
  "span": "s2", "points": [[0,0],[10,0],[10,10]],
  "shapes": [ { "id": "h1", "from": "s7", "points": [[0,0],[14,0],[14,12]] } ] }
```

*   `from` names a span. The later shape is in force from that span's start: from `S.lo` of that
    span. A marker's later shape holds `at`; a path's or zone's holds `points`.
*   **Which shape is drawn at year `y`:** among the later shapes whose span has a known start with
    `S.lo ≤ y`, the one with the greatest `S.lo`; if two are equal, the later in the list. If none
    qualifies, the feature's own shape.
*   A later shape whose span is missing from the chosen chronicle, or has no start, is never in
    force. The feature editor lists it as "not placed in time".
*   Later shapes change where a feature is, not whether it exists. Presence still comes from the
    feature's span.
*   **Editing follows the screen.** Dragging a marker or a corner changes the shape that is drawn at
    the slider's year: a later shape if one is in force, otherwise the feature's own. The editor says
    which: "Editing the shape from The treaty".
*   Adding a later shape copies the shape on screen, so the author starts from what he sees.
*   With time off, the feature's own shape is drawn and edited, as today.
*   Measuring a path's length and a zone's area use the shape on screen.

## The slider

*   A **Time** button on the map's bar turns the slider on. It is offered when at least one chronicle
    exists. With time off, a map behaves exactly as in stage 4.
*   The slider is a bar under the map: the chronicle's name (a menu of all chronicles, the main one
    first), the year, a range control, and buttons to step one mark earlier or later. On a phone it
    takes the place of the tool row while it is open.
*   **Its range** is the earliest and latest year any placed point of the chronicle may be, as on the
    stage 5 scale view, widened by 5% at each end. A chronicle with nothing placed has no range: the
    bar says so and every feature with a span is undated.
*   **Its step** is the scale view's ruler step for a ruler 200 marks long, and never less than one
    year. The year can also be typed.
*   **The address** gains `t=<year>` and, when the chronicle is not the main one, `c=<id>`. A map
    opened with `t` starts with time on.
*   The chronicle is read when the map opens and when the menu changes. A chronicle draft counts, as
    everywhere: the map shows what the author is working on.
*   The layer panel gains one line while time is on: how many features follow time, how many are
    undated, and how many are timeless.

## The feature editor

A new part, "Time", under the entry link:

*   **Which span decides.** One of: "Follows *Mira's years*, the span of its entry in *Ezob, humans
    arrive early*" with a link to that span; "Tied to *Old kingdom*"; "Its entry has no span in this
    chronicle" with a link to the chronicle; or "Timeless".
*   **Tie to a span.** A menu of the chosen chronicle's spans, by lane. Choosing one writes `span`.
    "Untie" removes it. A feature with an entry can also be tied; `span` then wins, and the editor
    says so.
*   **Later shapes.** A list: each names its span, says whether it is in force now, and can be removed.
    "Add a shape from…" takes a span and copies the shape on screen.
*   The part is shown while time is on. With time off it is one line: "Turn time on to see when this
    exists."

## Files and API

No new route. The map page reads `GET /api/chronicles` and `GET /api/chronicles/:id`, which exist.

| File | What |
| --- | --- |
| `packages/schema/src/maps.ts` | `span` and `shapes` on a feature; a later shape's form; both kept by the text form and the merge (a feature is merged as one item, as today) |
| `packages/time/src/presence.ts` | `presenceAt(points, isEvent, year)` and the tests of the table above |
| `apps/web/src/map/time.ts` | A feature's span; the shape in force; the features as drawn at a year; writing a shape back to the right place |
| `apps/web/src/map/overlay.ts` | Strength and dashed outline per feature; nothing drawn or tappable when not present |
| `apps/web/src/components/TimeBar.tsx` | The slider |
| `apps/web/src/components/MapPanels.tsx` | The "Time" part of the feature editor; the line in the layer panel |
| `apps/web/src/pages/MapPage.tsx`, `map/viewUrl.ts` | Time on and off; the chronicle; `t` and `c` in the address; edits going to the shape on screen |

`MapFile` stays at version 1: `span` and `shapes` are optional, and an older Frontier keeps them
untouched because unknown keys are kept.

## Risks

| Risk | Effect | Answer |
| --- | --- | --- |
| The author edits a shape without noticing which one | The wrong period's border changes | The editor names the shape being edited; undo covers it |
| Most features link to entries with no span | Time on changes almost nothing, and it is unclear why | The layer panel's counts; the editor says "its entry has no span in this chronicle" with a link |
| A span is deleted from the chronicle | Features tied to it lose their time | They become undated, drawn dashed, and stay selectable; nothing is removed from the map |
| The chronicle and the map are edited in two tabs | The map shows old years | The chronicle is read again when the map's tab gets the focus |
| "Perhaps" is mistaken for a fault | Faded features look broken | The slider bar has a three-word key: there, perhaps, undated |

## Verification

*   **Time package:** every row of the presence table, for a span and for an event; open ends;
    numbers that disagree.
*   **Schema:** a map with `span` and `shapes` written and read back the same; an older map unchanged;
    the merge keeping a feature's later shapes.
*   **Web, unit:** a feature's span by `span`, by entry, missing and none; the shape in force before,
    between and after two later shapes, with equal starts, and with a span that has no start; writing
    a dragged shape to the feature or to the later shape in force.
*   **Browser:** CUJ 16 on a phone and a desktop: features appearing, fading and going as the year is
    typed; a later shape added, edited and swapped by the slider; the year kept in the address; time
    off leaving the map as before.

## Questions for the author

None blocks the build.

1.  Should an event's feature stay after the event, as designed, or show only around its moment?
2.  Should images be able to change with time next, for a world whose coasts differ by era?
