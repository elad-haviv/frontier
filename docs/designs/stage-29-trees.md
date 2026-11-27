# Stage 29: Trees, how entries relate

- **Author:** Elad Haviv
- **Status:** Approved on 2026-11-27, with every recommendation in "Decisions", D as revised after
  the design review.
- **Mockup:** https://claude.ai/artifact/QXCVQRVztbNLkwSf3RgosR (desktop and phone, interactive: a
  family, a line of descent, a pantheon and a chain of command; the entry's Relations tab; the
  empty Trees page and the New tree dialog). It was revised once after an independent design
  review, whose changes are listed at the end of the proposal tab.

## What's wrong today

1. **Frontier cannot say how two entries relate.** A link from Wren to Corin is only a link. That
   Corin is Wren's father lives in the prose, so nothing can draw it, check it or ask about it.
2. **The Graph shows that things are connected, not how.** Every link looks the same and the layout
   is a force simulation, so a family or a line of descent becomes a cloud of dots.
3. **Families, descent, pantheons and ranks are one problem:** labelled relations that build a
   hierarchy, sometimes with pairs (partners, consorts) and cross-links (rivals). One tool should
   cover them.

## Relations are written on the entries

An entry lists its relations in its frontmatter, beside its dates:

```yaml
relations:
  - what: parent
    who: "[[Corin Vane]]"
  - what: partner
    who: "[[Garrow Pike]]"
    when: "from 288"
  - what: child
    who: "[[Nessa Pike]]"
    with: "[[Garrow Pike]]"
```

- **A fact is written once, on either entry.** `child: Nessa` on Wren is the same fact as
  `parent: Wren` on Nessa. Frontier reads both ways and merges them; two entries that disagree
  (one says a partnership ended, the other not) show under ⚠ doesn't fit.
- **Frontier writes only to the entry you are adding to** (the selected card, or the entry whose
  Relations tab is open) and says so: "Saved on Wren Vane's entry: child [[Nessa Pike]], with
  [[Garrow Pike]]". No other file changes behind your back. A name with no entry yet always sits
  on that side, as a stub link, drawn as a dashed card with "Write the entry".
- Optional keys: `with` (the other parent), `how` (adopted, ended) and `when` (married 265,
  served until 300), kept as text like the `when` of a date.
- Links inside `who` and `with` are indexed, appear in backlinks and are rewritten by a rename, as
  the links in `time` are.
- Written in Frontier's standard form like `time`: `what`, `who`, then `with`, `how`, `when`, each
  in double quotes where it is text; other keys of an item are kept. While an entry's
  `relations` cannot be read, Frontier does not write it and lists it under "fields that cannot be
  read".

## Kinds of relation

A list in the schema, like the `what` names of dates. Each kind says its word both ways, its shape,
and other words it accepts:

| Kind | Other way round | Shape | Also accepts |
| --- | --- | --- | --- |
| parent | child | above and below; drawn as a family | mother, father / son, daughter |
| partner | (same) | a couple, side by side | wife, husband, consort, spouse |
| descends from | gave rise to | above and below | |
| serves | served by | above and below | reports to, vassal of |
| rival | (same) | a line drawn over a tree | enemy |

Other words keep "mother" and "parent" as one kind. Typing a new word in "+ Add a relation" offers
to make it a kind there: above and below, or the same both ways. An unknown word found in a file is
kept and marked, as an unknown `type` is.

## A tree is a saved view

It holds its name, the kind that builds it, where it starts, descendants or ancestors, its
direction, how many generations show, what is drawn over it and what is folded. Two trees that show
Wren can never disagree about her.

## The screens

- **Trees** (a place after Chronicles, `g t`), like the Maps page: a card per tree with a picture
  of its shape, its kind, its size and where it starts; a dashed New tree tile; `n` makes one.
- **New tree** is a dialog: four kinds (Family tree, Descent, Hierarchy, Something else), a name,
  and where it starts.
- **A tree:** the header has its name, its kind and **Descendants of Aldric Vane | Ancestors of
  Tamsin Vane** (a pedigree up from the selected person). One tool row: + Add, Find, Fit,
  **2 gen. / 3 gen. / All**, what is drawn over it (rivals), Down or Right. Then the drawing and
  the details panel.
  - **Opens readable:** centred on the start or the last selection, names about 13 px or larger;
    Fit (F) shows all. Generations fold what is deeper (▸ says how many). Find searches folded
    parts too and unfolds the way to a match.
  - **Couples:** in a family, partners are part of the drawing, not an option. Side by side with a
    ⚭ ring (with a tooltip and screen-reader text). Children hang from the couple they belong to
    by a smooth curve. "ended" under the ring of an ended partnership; an adopted child's line is
    grey and dashed and the card says "adopted"; red dashes are only rivals.
  - **In-laws** carry a small MARRIED IN tag; their own parents show as "↑ 2 more".
  - **Someone who appears twice** (cousins who marry) is drawn once, at the lower place, with a
    linked copy at the other.
  - **Dates on cards** come from the born and died dates the entries already have; † for the
    dead; children in order of birth.
  - **Adding:** the + around the selected card adds above, below or beside. The picker leaves out
    whatever would make a loop. For a child, "With:" picks the other parent.
  - **How are they related?** C or Shift-click, then pick the second: "Pell Holt is Maren Vane's
    sibling's grandchild", with the path highlighted.
  - **Checks** are warnings: a child born when a parent was under 14 or after a parent died; two
    entries that disagree. "It's right" silences one.
- **Relations tab on every entry:** the entry in the middle with parents, partners, siblings and
  children (grouped by partner), then the rows as written in this entry with + Add a relation,
  and the trees it is in.

## Phone and desktop

The phone opens a tree on **One at a time**: one person with parents, partners, siblings and
children as large buttons; a tap moves to that person. It is the same view as the Relations tab.
**Tree** is one tap away, centred on the person you were on at a readable size, with pan and pinch;
tapping a card opens a sheet. The choice is remembered per device. On desktop the details panel is
on the right, as on the chronicle.

## Empty states

- No trees: a small drawing, what a tree is, New tree, and a family already written ("Make a tree
  from Aldric Vane · 19 people already related"), pointing also to the Relations tab.
- A new tree whose start has no relations: one card and how to add above, beside and below.
- A relation to an entry that is gone: a stub, listed with the other unresolved links.

## Keyboard and screen readers

Arrow keys move along the tree (up to a parent, down to a child, sideways along the row); Enter
opens the entry, A adds, C compares, F fits, / finds, + and − zoom, Esc clears. A focused card is
read out in full ("Wren Vane, born 268, child of Corin Vane and Ilsa Thorne, 2 partners, 2
children"). One at a time is the list version of the tree. All of it is in the "?" sheet.

## Decisions (as approved)

- **A.** Relations are written on the entries, either way round, merged when read, written only to
  the entry being added to.
- **B.** Kinds are a list (built in, plus the schema file's), with other words, made inline.
- **C.** Neutral family words now ("sibling's child", "parent's sibling", cousin); an optional field
  for aunt, nephew, grandmother is a later follow-up.
- **D.** The phone opens a tree on One at a time, remembered per device. (First proposed the other
  way; changed after the review showed the whole tree is too small to read or tap on a phone.)

## Left for later

Labelled relation lines on the Graph; an hourglass view; twins and succession; export as an image;
trees against the chronicle's years; AI proposing relations from the prose (first of these).

## As built

- **Where things are kept.**
  - Relations are the `relations:` list on each entry, read and written by `readRelations` and
    `setRelations` (`packages/vault/src/relations.ts`) in the standard form described above.
  - The trees are one library item file, `.frontier/trees.json`, with one tree per line. It is the
    fifth entry in the table of library files (`TREES` in `packages/schema/src/relations.ts`), so
    saving through the device's queue, merging tree by tree, offline sends and following renames
    all come from the table, not new code.
  - The same file holds the kinds the author makes (`kinds`) and the checks marked "It's right"
    (`fine`, as `check|entry|other entry`).
  - The built-in kinds are in `BUILT_IN_KINDS`. The schema file is not read for kinds, since
    Frontier does not write the schema file (stage 3).
- **The server.**
  - `GET /api/relations` reads every entry, drafts included, and merges a fact written on both
    sides into one fact with two sources (`apps/server/src/relations/collect.ts`).
  - It says when the sources disagree on `how` or `when`, or when only one gives a `how`.
  - A name with no entry is the key `?Name`. Words that are not a kind are listed under `unknown`.
  - Years for the cards come from the first number in the entry's `born` and `died` dates, or its
    beginning and ending dates.
  - `POST /api/relations` adds one item to one entry through the entry changer (into its draft).
    With `create` it also makes the new entry in that entry's folder.
  - `POST /api/relations/remove` takes an item off, only if it is still the one shown.
  - An entry whose `relations` cannot be read is not written to. It is listed under "fields that
    cannot be read".
- **The browser.**
  - `apps/web/src/trees/model.ts` holds the layout, kinship words, checks and read-out text, all
    pure functions with tests.
  - The drawing is SVG (`components/trees/TreeDrawing.tsx`): it pans by drag, zooms by wheel or
    pinch, and has arrow keys and a live region for screen readers. It opens at no less than real
    size divided by 1.08, centred on the last selection kept on the device.
  - Generations start at All.
  - The phone opens on One at a time; the choice is kept on the device (`frontier.trees.phoneView`).
- **Entries.** A Relations button sits in the entry's top row and a Relations tab in the right bar.
  The tab has the rows as written, + Add a relation with "+ A new kind…" (asks for the word and
  its other way round), and a remove button on each row.
- **Keys.**
  - Everywhere: `g t` goes to Trees.
  - On the Trees page: `n` makes a tree.
  - In a tree: `/`, `a`, `c`, `f`, `=` and `-`.
  - Arrows, Enter and Esc belong to the drawing while it has the focus.
- **Not built yet.**
  - Someone who appears twice is drawn once, where the tree first reaches them; the linked copy
    is not drawn.
  - "↑ 2 more" names the parents not drawn but does not open them.
  - `how` and `when` of an existing relation are changed in the text, not in a form.
  - The tree needs a connection to read the relations. The trees file itself is kept on the
    device like the other library files.
