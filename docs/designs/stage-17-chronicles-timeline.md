# Chronicles: a timeline you can drag

Status: Approved on 2026-11-24 as proposed, with every recommendation in "Decisions for you": ties
move what is tied to them, rules only check; the Order view is dropped and Compare, units, groups,
copying and another version underneath are in the ⋯ menu; the phone uses the same horizontal
timeline plus a List view; the interface says Event, Group, Tie and Rule while the file keeps its
names; data changes are additive only. "As built" notes are at the end.

Mockup: `chronicles-mockup.html` (kept with the design notes, not in the repo). It was interactive: drag a
bar to move it, drag its ends to stretch it, drag the blue map-year line, and switch Years / Decades /
Centuries / Millennia.

Based on the stage 5 and 6 designs, `packages/schema/src/chronicles.ts`, `packages/time`, the chronicle
page and components (`ChroniclePage.tsx`, `components/chronicle/*`), the map time bar, and the running app.
For that I made a chronicle with the stage 5 example (First Landing, Earth memory fades, Nirani presence, a
kingdom, a war, a treaty), looked at every tab on desktop and phone, and turned time on in the sample map.

## 1. What's wrong today

1. **Five tabs, five pictures of one history.** Order, Scale, Compare, Does not fit, and Lanes and units.
   You have to know that "Order" is not to scale (bar widths mean nothing), that "Scale" is the real
   timeline, and that "Compare" is about real-world cases.
2. **What you say doesn't put anything on the timeline.** I said "Earth memory fades *starts with* First
   Landing" and "lasts 3–5 generations". On Scale it is still under "Not placed: a length, but no start or
   end", and its form says "cannot tell yet: to check this, give Earth memory fades a start". Statements
   only *check*; only numbers *place*. Two systems that look like one.
3. **Adding is a dialog, then a long form.** "+ Span" asks for a name only. Then a side sheet has: Name,
   Lane, "This is a single moment", How it relates, Start (Not given / Count years from here (year 0) / A
   year / Open), End (the same), Length (Not given / In years / In a unit) with Lowest and Highest boxes,
   "Work a start or end out from another span", Entry and Note. That is a lot to learn before one bar
   appears.
4. **Nothing can be dragged.** You can't move or stretch a bar. Moving several things is a separate "Shift
   several spans" form where you type a number of years.
5. **The words are a workbench's, not a writer's.** Span, event, lane, unit, relation, origin, "rough
   number", "Open: older than shown", "does not fit / may not fit / cannot tell yet", clocks.
6. **Rough dates are hard to read.** A rough end is a colour fade. You can't tell where it starts or stops,
   or what the range is, without opening the form.
7. **The link to maps is invisible.** "Make this the main chronicle" is under "More". Nothing on the chronicle
   shows the year the map is showing, which bars drive map features, or a way to jump to the map.
8. **On the phone**, time runs top to bottom (the map's slider runs left to right). There are thin coloured
   strips for the other lanes, the tab row runs off the screen ("S…"), and the toolbar plus tabs take a
   quarter of the height.

The underlying ideas are good: rough ranges, open ends, rules that flag what doesn't fit, linking to
entries, maps following the main chronicle. They're just spread over too many places.

## 2. The design

**One screen: a timeline.** Rows on the left, bars on a real ruler on the right, like MS Project. The
differences from MS Project: you only ever say *when* (no resources or percent done), rough dates are drawn
as soft ends, and nothing moves on its own unless you tied it.

### Fewer, plainer words

| Today | Proposed | Notes |
| --- | --- | --- |
| Chronicle | Chronicle | Kept (you know it; the page is "a chronicle shown as a timeline") |
| Span / Event | **Event** | One word. An event either *lasts a while* (a bar) or is *a single moment* (a diamond) |
| Lane | **Group** | A folding header row, like a summary task |
| Origin, year 0 | "Year 0 = First Landing · change" | One line in the toolbar |
| Relation | **Tie** (places) or **Rule** (checks) | See below |
| Unit | Unit | Only in one dialog, and as a word you can type: "3-5 generations" |
| Does not fit / may not fit / cannot tell yet | **Doesn't fit** (red) | Amber and grey only appear inside an event's details |
| Compare | Compare lengths with real history… | In the ⋯ menu |

### The screen (desktop)

* **Header:** ← back, the title, **★ Main · maps use this** (or **Make main** on other chronicles), the save
  state, **⚠ 1 doesn't fit** (only when something is red; it opens a list with fixes), **🗺 Open map at 200**,
  and **⋯**.
* **Toolbar:** **+ Add (N)** · zoom **Years | Decades | Centuries | Millennia** · **Fit (F)** · Undo ·
  Redo · "Year 0 = First Landing · change" · **Timeline | List**.
* **Left, the list (340 px):** each group's header (fold ▾/▸, colour, name, overall span), then one row per
  event: diamond or square, name, ⚠ when red, and **When** in short form ("270–290 → 300", "open → 380–450",
  "No dates yet"). The last row of each group is "+ Add to Humans". Click a row to select it; double-click
  the When cell to type.
* **Right, the chart:** a two-level ruler (labels and minor ticks follow the zoom), one row per list row,
  and a thin summary bar on each group's row.
* **The blue line** is the year the maps show. More in "Maps", below.
* **Details panel (300 px, right):** appears when something is selected. Name, group, "lasts a while /
  a single moment", **Starts / Ends / Lasts**, **Must fit** (rules), **Entry**, **On maps**, **Note**,
  Duplicate, Delete.

### How a bar is drawn

* **Solid** where the event is surely going on (from the latest possible start to the earliest possible
  end).
* **Soft ends:** hatched and fading from the earliest to the latest possible year, with a small tick under
  each bound. Hovering an end says it in words: "starts some time from 270 to 290".
* **Open start:** runs off the left edge with ‹. **Still going:** runs off the right edge with ›.
* **A moment** is a diamond; a rough moment gets whiskers from its earliest to its latest year.
* **Tied** events show ⛓ and a thin dotted line to what they're tied to.
* **📖** means linked to an entry; **🗺** means something on a map follows it.
* **Red outline:** breaks a rule.
* **No dates yet:** a dashed box in its row saying "No dates yet · drag onto the timeline" (or "· 60–175
  years · drag to place" when only its length is known). Drag it onto the chart to place it.

### Saying when

Every date box takes the same short forms, and the parser turns them into the numbers stored today:

| Type | Means |
| --- | --- |
| `300` | exactly 300 |
| `270-290`, `about 280`, `280 ±10` | some time from 270 to 290 |
| `-50`, `50 before` | 50 years before year 0 |
| `open` | Starts: older than anything shown. Ends: still going |
| `3-5 generations` (in Lasts) | 60 to 175 years, using your unit |
| `with First Landing` | **tied**: starts (or ends) when First Landing does |
| `10 after The war`, `20-40 before The kingdom` | **tied** with an offset (to the other's end for "after", its start for "before") |

Fill in any two of **Starts / Ends / Lasts**; the third is worked out and shown in grey italics ("10 to 30
years (worked out)"). Typing all three when they disagree marks the field: "These three don't agree", the
same check as today's "its own numbers disagree". The words you typed are kept in `words`, as today.

### Ties and rules (replacing "relations")

* **A tie places an event.** "Earth memory fades starts *with First Landing*" puts its start at First
  Landing's start, and keeps it there when First Landing moves. With "lasts 3–5 generations" it's now drawn
  from 0 to 60–175. Ties are the only thing that moves an event you didn't touch, and you can always see
  them (⛓ and the dotted line). **Untie** turns the current numbers into plain ones.
* **A rule only checks:** during, before, after, overlaps, longer than, shorter than. These are today's
  relations, with today's checks and sentences. They're listed under **Must fit** with ✓, ⚠ or ?; only ⚠
  (doesn't fit) is shown outside the details panel. Each ⚠ offers today's fixes as buttons ("End The
  kingdom at 270", "Move The war", "Remove the rule").
* A tie that would go in a circle is refused as you type it ("First Landing is already tied to this").

### Main flows

**Start a chronicle.** Chronicles → **New chronicle** → title → an empty timeline. It says "Lay out a
history. Add the events you know, rough dates are fine. Year 0 is whatever you place first." with **+ Add the
first event** and "or add from entries…".

**Add an event.**
* **+ Add** (or N, or "+ Add to Humans") opens one small form: **Name or entry** (typing suggests entries;
  picking one links it), **Starts**, **Ends** (both optional), **Group**, "A single moment", **Add**.
* Desktop shortcuts: drag across an empty part of a row to draw a bar there; double-click to drop a
  moment.
* Phone: the round **+** opens the same form as a sheet.

**Place or change dates.**
* Drag the middle of a bar to move it; drag an end to change just that end. Moves snap to 1, 5, 10 or 100
  years depending on the zoom, and a label shows "The war: 280–300 → 310 (+10 yrs)".
* Or type in the When cell or the details panel.
* Dragging a bar with a soft end moves the whole range. How rough an end is (its width) only changes by
  typing.
* Shift-click several bars (or a group header) and drag them together. This replaces the "Shift several
  spans" form.

**Link to an entry.** In the details panel, **Link to an entry…** (the picker maps use). The bar gets 📖.
Clicking the name opens the entry. The entry's page keeps its "On chronicles" list, now saying "The war,
270–290 → 300". Adding by entry name (above) links in one step.

**Fix what doesn't fit.** The **⚠ 1 doesn't fit** pill opens a short list. "Show both" selects the two bars
and scrolls to them; each fix is one click and can be undone.

**Groups.** Click a group header's name to rename it; its ⋯ has Colour, Move up/down and Delete (it asks,
and moves the events to the group above, as today). Fold with ▾. Drag a row onto another group to move it
there. There's no separate "Lanes and units" screen; units are one dialog in ⋯.

**Versions.** In ⋯: **Copy, to try another version** (as today) and **Show another version underneath…**,
which draws the other chronicle's bars as grey ghosts in the same rows, matched by id, with differences
outlined. This is today's "Compare with…", moved here.

**Compare lengths with real history** (today's Compare tab) opens as a dialog from ⋯, unchanged inside.

### Zoom and grouping

* Four zoom levels: **Years** (about 7 px a year), **Decades**, **Centuries** and **Millennia** (for "an
  older beginning"; the workbench still stops at about 100,000 years). Keys 1–4. Ctrl+wheel or pinch zooms
  smoothly between them. **Fit** shows everything placed.
* Changing zoom keeps the selected event, or else the map year, in the centre.
* Grouping is by group only, with fold and unfold. A "Group by entry folder" option could come later; it is
  not in this proposal.

### The main chronicle and maps

* The header says **★ Main · maps use this**, or offers **Make main** on any other chronicle (today this is
  under More).
* **The blue line** on the timeline is the year the maps show. Drag it (or press Y on a selected event) to
  set it. **🗺 Open map at 200** opens the map at that year with this chronicle; if several maps exist, it's
  a short menu of them.
* The map's time bar gains **Open timeline ↗**, which opens this page with the line at the slider's year.
  The year still travels in the address (`?t=`), as stage 6 has it.
* A bar that a map feature follows shows 🗺. The details panel lists "On maps: Sample world · 1 marker
  follows this", which opens the map at the event's start.
* How maps decide what to show (stage 6's presence table) does not change. Tied ends are stored as plain
  numbers too (see "Data model"), so maps read exactly what they read today.

### List view

**Timeline | List.** The list is every event in order of start, under headings by century ("Before year 0",
"Year 0 to 99", …). The map year is a marker between them, and "No dates yet" comes last. It's the best way
to read a chronicle on a phone, and an accessible alternative to the chart.

### Phone (390 px, installed app)

* The **same horizontal timeline**, so it reads like the desktop one and like the map slider. Names sit on
  or beside the bars, and a name whose bar starts off-screen sticks to the left edge. Group headers are full
  rows that fold. There's no list column.
* Header: back, title, **⚠ n**, **⋯**. One tool row: zoom chips (Yrs / Decades / Cent. / Mill.) and the
  Timeline / List switch. A round **+** sits at the bottom right.
* **Tap** a bar: select it and open a **bottom sheet** with Starts / Ends / Lasts, its red rule if any, and
  its entry. Swipe the sheet up for the rest (group, note, rules, Delete). The chart scrolls so the
  selected bar stays above the sheet.
* **Press and hold, then drag** a bar to move it (with a short haptic buzz). Plain swipes always pan, so
  nothing moves by accident. The selected bar shows end handles (44 px touch area) to stretch it.
* **Pinch** zooms; the chips jump to a level.
* Bars are 26–30 px tall and rows 44 px.

### Keyboard (desktop)

| Key | Action |
| --- | --- |
| ↑ ↓ | Select the row above or below |
| ← → | Move the selected event by one zoom step; Shift for ten |
| Alt+← → / Alt+Shift+← → | Move only its end / only its start |
| Enter / D | Edit its name / its dates |
| N | Add an event below |
| Space on a group header | Fold or unfold |
| 1–4, F, + − | Zoom level, fit, zoom in/out |
| Y | Put the map year at the selected event's start |
| Delete | Delete the event (undoable) |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo (as today) |
| Esc | Deselect and close the panel |

The chart is a grid (`role="grid"`) whose rows match the list rows. Every bar is a button with a label like
"The war, starts 270 to 290, ends 300, doesn't fit one rule".

### Empty and edge states

* **No chronicles:** "No chronicles yet. A chronicle lays out when things happen, roughly, and lets maps
  change with time." **New chronicle**.
* **A new chronicle:** as in "Start a chronicle", above.
* **Nothing has dates yet:** the chart says "Nothing is placed in years yet. Type a date in any row, or drag
  a dashed box onto the timeline." The ruler shows 0 to 100.
* **Offline:** editing works and is queued, as today. Copy, Make main and Delete say they need a
  connection.
* **Its entry was removed:** the bar keeps its name; 📖 becomes "entry removed", as today.

## 3. Data model: what changes, and how existing chronicles carry over

Small, additive changes. **No file version bump. Every existing chronicle opens and looks right on day one.**

| Change | In the file | Carry-over |
| --- | --- | --- |
| **Ties** | A span may carry `startFrom` and/or `endFrom`: `{ "span": "<id>", "edge": "start" \| "end", "plus": { "low": n, "high": n } }`. The span's ordinary `start`/`end` keep the **resolved** numbers, rewritten by the app whenever the anchor moves (and after a merge). | Old files have none, so nothing changes. Because the resolved numbers are stored too, maps, `spanPoints`, `presenceAt` and any older cached app see plain numbers. Spans already pass through unknown keys (`ChronicleSpan` is `.passthrough()`). |
| **Relations** | Unchanged in the file. In the UI they're **rules**. | Kept as they are. On opening, a span that has no start but has a `starts_with`, `ends_with` or `after` relation to a placed span gets a one-time banner: "3 events can be placed from what you said. Place them". One click turns each into a tie (the relation is kept as well, and now holds). Nothing happens without that click. |
| **Lanes → groups** | Unchanged (`lanes`, with name, colour and clock). | UI rename only. Folded groups are remembered on the device, not in the file. |
| **Row order** | The order of `spans` in the file, within each lane, is the row order. Dragging rows reorders the array. | Existing order is used as is. |
| **Units, cases, `compare`, `origin`, `main`, `clock`, `words`** | Unchanged. | Same behaviour; units feed the "3-5 generations" parser. |
| **Map year** | Not in the chronicle file. The map keeps `?t=`; the timeline remembers the last map year per chronicle in `localStorage`. | Nothing to migrate. |

Server: `GET /api/chronicles/:id` gains `onMaps: { [spanId]: [{ map, title, features }] }`, worked out from
the map files (by feature `span`, or by `entry` → first span with that entry, as stage 6 decides). No new
routes and no changes to saving, merging or publishing. `mergeChronicles` is unchanged; the client re-resolves
ties after a merge and saves again if a number moved.

**What is removed:** the Order view (an event with no numbers now appears as "No dates yet" in its row, so
order without numbers has no separate screen), the Does-not-fit tab, the Lanes-and-units tab, and the
"Shift several spans" form. The order logic in `packages/time/src/order.ts` stays, for checks and the "can
be placed" banner.

## 4. Decisions for you

1. **Should ties move things, like MS Project's links?** Stage 5 decided that nothing moves because something
   else moved.
   *Recommendation: yes, but only ties you make on purpose* ("with First Landing", "10 after The war"),
   always shown with ⛓ and undoable. Every other statement stays a rule that only checks and flags. Without
   ties, the main complaint ("I said it, nothing appears") stays.
2. **Drop the Order view, and move Compare into the ⋯ menu?**
   *Recommendation: yes.* One picture of the history. Events without dates still have a visible place (their
   row, with a dashed "No dates yet" box). Compare is kept, one menu away.
3. **On the phone, a horizontal timeline (as desktop and the map slider) or keep today's top-to-bottom one?**
   *Recommendation: horizontal,* with press-and-hold to drag and the List view for reading. One mental
   picture across devices.
4. **New words: Event (lasts a while / a single moment), Group, Tie, Rule, instead of Span, Event, Lane,
   Relation?**
   *Recommendation: yes,* in the UI only. The file keeps its names, so nothing migrates.

## 5. Build plan (one engineer, about 3½–4 weeks)

Each step ships on its own behind the existing page, and the e2e tests move with it.

| # | Step | Where | Size |
| --- | --- | --- | --- |
| 1 | **Date-text parser:** "270-290", "about 280", "280 ±10", "-50"/"50 before", "open", "3-5 generations", "with X", "10 after X" → `Rough`, `"open"` or a tie; plus a formatter back to short text. | `packages/time/src/parse.ts` (new), tests | 2 d |
| 2 | **Ties:** `startFrom`/`endFrom` in the schema (optional, passthrough-safe); `resolveTies(chronicle)` returns the chronicle with resolved numbers, in dependency order, refusing circles; the client calls it after every change and merge. The "can be placed" banner from existing relations. | `packages/schema/src/chronicles.ts`, `packages/time/src/ties.ts` (new), `useItemFile` call site in `ChroniclePage.tsx` | 3 d |
| 3 | **Timeline view, read-only:** list + chart sharing rows, two-level ruler (reuse `rulerStep`/`scaleBounds` and `scaleLayout.ts`), solid core and soft ends with bound ticks, open ends, moments with whiskers, group headers with summary bars and folding, "No dates yet" boxes, zoom presets, Fit, Ctrl+wheel/pinch. Replaces `OrderView`, `ScaleView` and `LaneCanvas` on the page. | `components/chronicle/Timeline.tsx`, `timelineLayout.ts` (new); `ChroniclePage.tsx` | 5 d |
| 4 | **Direct editing:** pointer drag (move, resize, snap by zoom, multi-select with Shift), drawing a bar on an empty row, double-click for a moment, dragging a "No dates yet" box into place, row drag between groups, keyboard nudges, live label while dragging. All through `file.change`, so undo/redo and saving already work. | `Timeline.tsx`, `keys.ts` (`chronicle.*` keys) | 4 d |
| 5 | **Details panel and Add form:** rewrite `SpanForm` as a short panel (Starts/Ends/Lasts with the parser and worked-out third, Must fit with today's sentences and offered fixes from `offer.ts`, Entry, On maps, Note). Add form with the entry combobox (`EntryCombobox.tsx`). Phone bottom sheet. | `components/chronicle/Details.tsx`, `AddEvent.tsx` (replace `SpanForm.tsx`, `ShiftForm.tsx`) | 3 d |
| 6 | **Header and menus:** ⚠ pill and popover (from `Flags.tsx`), Main pill / Make main, ⋯ menu (rename, groups, units dialog from `Lists.tsx`, Compare dialog from `CompareView.tsx`, copy, show another version underneath as ghost rows, delete). Remove the tabs. | `ChroniclePage.tsx`, `Flags.tsx`, `Lists.tsx`, `CompareView.tsx` | 2 d |
| 7 | **Maps bridge:** the map-year line (drag, Y, localStorage), "Open map at…" menu, 🗺 marks and "On maps" (server `onMaps` field), "Open timeline ↗" on the map time bar. | `routes/chronicles.ts` + `chronicles/store.ts` (read the map files), `api.ts`, `components/MapTime.tsx` | 2 d |
| 8 | **Phone and List view:** sticky labels, press-and-hold drag, handles, sheet keeping the selection in sight, chips; List view by century. | `Timeline.tsx`, `ListView.tsx` (new), CSS | 3 d |
| 9 | **Tests and cleanup:** rewrite `e2e/chronicle.spec.ts` (CUJ 14 and 15 through the new UI, desktop and 375 px, no sideways scroll); keep `mapstime.spec.ts` passing unchanged; unit tests for the parser and ties. Delete `OrderView`, `orderLayout`, `ScaleView`, `LaneCanvas` and `ShiftForm`. Update the stage 5 doc with an amendment. | e2e, `packages/time/test` | 2–3 d |

Risks: dragging on touch next to page scrolling (mitigated by press-and-hold); a long chronicle (hundreds of
rows) needs row virtualisation later, not now; ties resolved on the client mean two devices editing at once
could disagree until the next save (the re-resolve after merge covers it).

## As built (17b, 2026-11-24)

* "About N" reaches one step of N's last non-zero digit: about 280 is 270–290, about 4000 is
  3000–5000; a number ending in another digit reaches 5 either way. Lengths also take decades,
  centuries and millennia. "-50 to -30" is written with "to", so a minus is not read as a dash.
* Dragging a tied point keeps the tie and changes its years ("10 after The war" becomes "20 after").
  Stretching an end whose other end came from a length stores both ends and lets the length go.
* A tie whose years run from before to after ("-5 to 5") is shown as "the end of X -5 to 5", which
  the parser does not read back; type it again to change it.
* The map year starts at `?t=`, else the last one on this device, else 0. It moves by dragging its
  flag in the ruler (the line itself lets clicks through to the bars) or with Y.
* A group's ⋯ has Next colour (the palette in turn) rather than a colour picker. Rows move between
  groups by dragging them in the list on a desktop, or with Group in the details anywhere.
* The phone sheet unfolds with its handle (a tap, not a swipe). Undo, Redo, Fit, Make main and the
  map links are in ⋯ on a phone.
* The ⚠ list's "Show both" selects both events; fixes are today's offers ("Move The war").
* Old chronicle classes in `styles.css` that nothing uses now are left for a later tidy-up; the page's
  own styles are in `ChroniclePage.css` and `Timeline.css`, loaded with the page.
