# Stage 5: a workbench for shaping history

- **Author:** Elad Haviv
- **Date:** 2026-11-21

## Overview

The parent design planned stage 5 as a reader of dates: parse the dates written in entries, convert
between calendars, draw a timeline. The vault has no dates to read. The author kept time vague on
purpose, then began writing human history on Ezob, could not see how it fitted the other narratives
he had in mind, and deleted it. His words: the arrival of humans and the fading of Earth's memory and
technology felt "both too quick and at the same time too slow" beside the Nirani arrival and the age
of the world, with "many events over a great span in too many different places at once". He ranks
being able to tell the order and overlap of events as most important.

So stage 5 becomes a place to shape history before it is written. The author lays out spans and
events in lanes, says how they relate and roughly how long they last, and sees them to scale beside
each other and beside real-world comparisons. The Ezob calendar, the pulse count and the difference
in time between planes are added later, on top of a shape he is content with.

Seven independent reviewers examined this concept. This brief merges their findings. They agreed on
most points; where they disagreed, both views are given.

## Analysis

### What the reviewers found in the vault

- No note has a `time`, `type` or `id` field. About 25 to 30 notes mention a duration at all, nearly
  all vaguely ("centuries ago"). `02 History & Lore` holds 7 notes.
- The lore states a few usable facts: the Era of Man "predates the NPS by millennia"; the Grand
  Canary was built "during the first century following the settlement of Ezob"; the Adyni vanished
  "centuries ago"; the Ezob year is about 360 days; a plane's drift is "imperceptibly slow".
- One inconsistency waits for the calendar work: 11 months of 30 days is 330 days, 30 short of the
  year, yet the nameless month is added only "approximately every three years".

The consequence all seven drew: a date parser, calendar files and a common axis would have nothing to
work on. What the author types into the workbench is the content. The screen for laying things out is
the product.

### The seven problems with the concept as first stated

**1. It did not say where the shape is kept, and both obvious answers fail.** (All seven; four called
it blocking.) Entries cannot hold it: a `time` item is two pieces of text, with no room for a lane, a
length or a link to another span, and a span would need a note before it could exist, which is the
order that failed him. Yet the parent design says "dates stay on entries only".

The agreed answer: the shape lives in a file of its own, a **chronicle**, built the way map files are
(one item per line, merged item by item across devices, saved through drafts and versions). A span
may point to an entry or to none. The entry's `time` field keeps a different job: it records what the
entry's text says, in the author's words. The two are different facts, so "one home per fact" still
holds. Nothing copies itself from one to the other.

**2. "Moving one span shows what else must move" was two different behaviours, and one is costly.**
(Six of seven.) Either the others move by themselves, or they stay and are marked. The reviewers
split on how far to go:

- The simple view: each span is placed by a rough number or by one link ("starts about N after X
  ends"). Moving X moves what hangs from it. Every other statement ("overlaps", "before", "longer
  than") is a check that turns red and moves nothing. Every red mark names the statement it breaks.
- The fuller view: a real solver over ranges, with each span either pinned by the author or free;
  free spans follow, pinned ones raise a flag, and the result is previewed before it is kept.

Both agree on three rules. Only what the author stated is stored, never the positions drawn. A
comparison of two lengths ("longer than the Niran presence") is checked, not used to move things.
A change is a trial until he keeps it.

**3. "In his own words" and "to one scale" pull against each other.** (Five of seven.) "A few
generations" has no width until someone decides what a generation is. If the app decides silently,
the picture looks exact and he judges it on a number he never chose. Agreed answer: each length keeps
his words and a range, lowest to highest, which he confirms. A small table he owns says what the
words mean ("a generation: 20 to 35 years"), per people where it differs. A range is drawn with soft
ends. A span with no length is drawn in a visibly different way and takes part in no checks. These
are working numbers, not lore.

**4. One scale cannot show the age of the world and a few generations together.** (Six of seven.) On
a straight scale the short spans vanish. A compressed scale would make them visible and make the
comparison of lengths false, which is the comparison he needs. Agreed: the scale is always straight
within a view, with zoom and an overview strip; a span too short to draw becomes a mark labelled "not
to scale". Two reviewers went further and proposed **two instruments on the same data**:

- an **order view**, laid out by sequence only, with no ruler, which needs no numbers at all and
  works on a phone;
- a **comparison strip**: pick two to four spans and see them as bars from a common start, beside
  the real-world comparisons.

The to-scale picture then appears for whatever has a length. This also gives a first slice that is
useful before any number exists.

**5. Dragging on a phone will not work.** (All seven.) A narrow span edge under a finger, on a canvas
that also pans and zooms. Agreed: a form is the main way to edit everywhere (tap a span; change its
words, its length, what it comes after). Dragging is a desktop convenience that writes the same
things. On the phone, time runs down the page with one to three lanes.

**6. The real-world comparisons are the part most likely to mislead.** (All seven.) "How long until a
people forgets where it came from" has no single answer; the known cases range widely and several are
disputed. Produced by AI on request they would be confident, unsourced and different each time, and
he would size his history against them. Agreed: a short list prepared and checked by hand, about 15
to 25, each with a range, a named source and a caveat. They are rulers to lay beside a span. They
never raise a flag. He can add his own, and any span he has settled can serve as a ruler too.
Candidates named by reviewers, all to be verified before use: the loss of writing in Greece after the
Bronze Age collapse; the loss of wheel-made pottery in Britain after Rome; Norse Greenland from
settlement to abandonment; the Roma forgetting their Indian origin; Latin becoming the Romance
languages; claims of oral memory lasting thousands of years (disputed).

His complaint, "too quick and too slow at once", is one span judged against two comparisons that
disagree. The comparison strip should show exactly that.

**7. Time on other planes must be allowed for from the first file, though not built.** (Six of
seven.) If the first chronicle stores a bare number of "years", then adding "a month in Derdama costs
half a year on Ezob" later means reinterpreting every number already entered. Agreed: from the first
version each lane names its plane, each length names whose clock it is counted on, and the file names
one reference clock. Every ratio is 1 until he gives one. The calendar and the pulse count then
arrive as ways of labelling the same line: the lore already defines both starting points as events
(year 1 EM is the first permanent settlement; Pulse Zero is the first pulse-counting network), so
each is one event on the chronicle named as a starting point.

One reviewer argued for leaving travel between planes out of this stage altogether: it is a sum at
the scale of months between two places, a different job from shaping millennia, and may want its own
small view.

### Smaller findings

- **Events on an entry have no identity.** A `time` item is known only by its wording. The chronicle
  and, later, maps that change with time both need to point at one. Give each item a short id,
  written only when something first refers to it. This costs nothing today because nothing reads
  these items yet.
- **The AI field proposals built in stage 3 stay as they are**, for what an entry's text states.
  Their rule is "invent nothing". Helping to invent a number is the opposite job and must look
  different: it proposes a range for one missing length, shows which of his statements and which
  comparisons it reasoned from, and he decides. Two reviewers would leave it out until he has used
  the workbench and still wants it.
- **A chronicle is invisible outside Frontier.** It is not a note, so lore chat and outside agents
  cannot see it. When a shape is settled it needs a way into the notes. This is partly moot while
  the memory bank is set aside, but it will return.
- **Merging two devices' changes can make a contradiction** that neither device made (one says A
  before B, the other B before A). A contradiction must therefore be an ordinary state that the
  view marks, never a file that fails to open.
- **Map code is written for maps by name.** A second kind of file needs the shared parts lifted out
  first (the merge, the text form, the save loop, the conflict handling), or stage 5 copies them.
- **The parent design needs an explicit list of what this replaces**: its Time section, CUJ 8,
  CUJ 9, part of CUJ 5, the "dates on entries only" rule, and the statement that Frontier "does not
  invent" numbers, which becomes "may propose; only the author decides".
- **Words.** "Layer" already means a map layer; the later additions need another word. "Span",
  "event", "lane", "chronicle", "comparison" and "does not fit" each need one definition. "Does not
  fit" can only mean "breaks something the author stated".

## Goals vs. Non-Goals

**In-scope goals, first slice**

- One chronicle file: lanes; spans and single events, each with a name, a lane, an optional link to
  an entry, its length as the author's words plus a range, and how it relates to others (after,
  before, during, starts with, ends with, with an optional rough gap).
- An order view that needs no numbers, and a comparison strip for a few chosen spans.
- A to-scale drawing, straight scale, with zoom, for whatever has a length.
- Editing through a form on every device.
- A list of what does not fit, each naming the statements in conflict.
- A short checked list of real-world comparisons.
- Every length and lane recording whose clock it is on, with all ratios 1.

**Test for the first slice:** the author lays out the human arrival on Ezob, the fading of Earth's
memory and technology, the Nirani arrival and the age of the world, and can say which span is too
quick or too slow, and whether the deleted history can be rewritten.

**In scope, later slices**

- Moving a span by dragging on desktop. Nothing else moves.
- Two chronicles shown one above the other on the same scale; copying a chronicle.
- Linking spans to entries and their events; a tray of statements from entries not yet placed.
- The author's own units and comparisons.
- Proposals for missing lengths.
- Starting points for the Ezob calendar and the pulse count; a time ratio per plane.

**Out-of-scope non-goals**

- Reading dates out of free text.
- A general solver that rearranges many spans by itself.
- Compulsory conversion between calendars.
- Treating working numbers as lore.
- Comparisons that validate or flag anything.
- A compressed time scale.
- Maps that change with time (stage 6).
- Agents changing chronicles.

## Alternatives Weighed

| Alternative                                                                                                | Outcome                                          | Reason                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The original plan: calendars, a date parser and a common axis first                                        | Rejected as the start                            | The vault has no dates to parse, and it does not touch the stated trouble. Its calendar and axis return later as labels on the chronicle's line.                  |
| A plain list of spans with numbers in one unit                                                             | Kept as the core of the data, not as the feature | A list does not show overlap across places, which the author ranks first.                                                                                         |
| Spans kept only in entries' `time` fields                                                                  | Rejected                                         | Needs a note for every span, has no home for lanes or ranges, and one move would redraft many notes.                                                              |
| Chronicle files only, with the `time` field dropped                                                        | Rejected                                         | Throws away the stage 3 work and the tie from a placement to the sentence that supports it.                                                                       |
| Both, with separate jobs: the entry says what the text says, the chronicle says where the author placed it | Kept                                             | Two different facts, each with one home.                                                                                                                          |
| A general constraint solver                                                                                | Rejected for the first slices                    | It cannot easily say why something fails; length comparisons do not fit the simple kind. The file form must not rule it out.                                      |
| Placement by one link, with dependents following when it moves                                             | Rejected by the author                           | He wants the others to stay put and show where they no longer fit. Every statement is a check.                                                                    |
| One scaled timeline as the only view                                                                       | Rejected                                         | Needs a position and a length for everything before anything shows. An order view and a comparison strip work from the first minute.                              |
| A compressed (logarithmic) time scale                                                                      | Rejected                                         | Makes the comparison of lengths false.                                                                                                                            |
| Comparisons produced by AI on request                                                                      | Rejected as the source                           | Unsourced and unrepeatable. AI may suggest candidates for the checked list.                                                                                       |
| The chronicle as a Markdown note, one span per line                                                        | Open                                             | Easy to type on a phone and visible to Obsidian, lore chat and agents. Costs: every edit rewrites text, typing errors break it, and nothing built works this way. |
| A spreadsheet or an outside timeline tool                                                                  | Rejected as the product                          | No tie to entries or maps. Useful for a one-hour trial before building.                                                                                           |

## Key Decisions & Staging for Next Steps

**Settled by the review, unless the author objects**

1.  The shape lives in chronicle files of its own; entries keep what their text says.
2.  Only what the author states is stored. Positions are worked out each time.
3.  Each length is his words plus a range he confirms; working numbers are not lore.
4.  A form is the main editor; dragging is for desktop, later.
5.  The scale is straight, with zoom; there is an order view that needs no numbers.
6.  Real-world comparisons are a short, sourced, hand-checked list, and are only ever rulers.
7.  Every length and lane names its clock from the first version.
8.  No date parser, no calendar, no pulse, no plane ratios and no AI in the first slice.

**Decided by the author on 2026-11-21**

9.  **Moving a span moves nothing else.** The others stay where they are and show where they no
    longer fit. So there is no solver and no chain of dependents: every statement about how spans
    relate is a check. This removes the costliest part of the concept, and the "dragging with
    dependents following" slice with it.
10. **Two versions of a history can sit side by side.** A chronicle can be copied, and two chronicles
    can be shown one above the other on the same scale. One chronicle is marked as the main one, for
    maps and AI later.
11. **No trial on paper first.** The kinds of statement are therefore chosen now and kept few: after,
    before, during, starts with, ends with, overlaps, longer than, shorter than. Adding a kind later
    must not need a change to files already written.
12. **Ezob is ancient; recorded history runs to thousands or tens of thousands of years.** The
    workbench is built for spans from a generation to tens of thousands of years. The age of the world
    is shown as "ancient, not to scale" and is not something to zoom out to.

**For the author to decide**

These can be settled in the design or as the work goes; none blocks the first slice.

3.  **Spans with no note.** May a span stay on the chronicle for good without a note behind it?
4.  **Years.** When you say "a thousand years", is it always Ezob years? Is the Ezob year (about 360
    days) close enough to an Earth year to compare with real history directly?
5.  **Generations.** How long is a generation, and living memory, for the Nirani and other long-lived
    peoples? Should human comparisons apply to them at all?
6.  **The phone.** Do you shape history there, or only read and correct?
7.  **Comparisons.** Would you trust a short sourced list we prepare? Which kinds matter most:
    forgetting an origin, losing a technology, a language changing, others?
8.  **First things placed.** What are the first four or five spans you would lay out?
9.  **Planes.** Is "a month in Derdama, half a year here" part of the trouble you hit with Ezob's
    history, or only of later travel stories? May it wait?
10. **Reaching the lore.** Once a shape is settled, should it be written into the notes, and by whom:
    you, by hand, or a step in Frontier?
