# Stage 23: the Maps page

- **Author:** Elad Haviv
- **Status:** Built
- **Date:** 2026-11-25
- **Parents:** [Stage 13, maps](stage-13-maps.md), [stage 7, more map views](stage-7-more-map-views.md),
  [stage 22, space maps](stage-22-space-maps.md)

---

## Overview

The Maps page was a plain list of titles with a grey line of facts, and the form that makes a map
below it. With a few maps that was enough; with dozens it hides everything: there was no picture of a
map, no search, no order, and the form sat below the fold. This stage makes the page a library: a
card with a picture for each map, search and filters that appear as the library grows, and a New map
dialog in place of the form. It was approved from an interactive mockup.

## What the owner decided

1. **New map is a dialog**, opened by a button at the top (a round + on a phone) or by `n`. The page
   is always the library, never a form.
2. **One map is one card.** There is no grouping and no splitting. A map that has maps lying under
   it (Ezob, with Derdama's layers) is drawn as a **deck**, with one or two sheets behind its card.
   That is only how the card looks: every layer is still a card of its own, and a map's ordinary
   layers (the Layers tab) are not shown here at all.
3. **Grid up to about 40 maps, a list above**, remembered per device.
4. **All of the mockup**, not a first version.

## The page

- **Header.** "Maps", the number of maps (or "5 of 23 maps" while searching or filtering, said to
  screen readers as it changes), the Grid and List buttons, and New map.
- **Cards.** A picture, the kind as a badge, the title in the serif, "12 features · edited 3 days
  ago", where the map sits among the others ("lies under Ezob", "2 layers below"), and its state as a
  dot and words: hollow for "Not published yet", solid for "Unpublished changes", nothing for a
  published map. The whole card opens the map. A ⋯ button (the second tab stop) has Open, Edit,
  Layers stacked (globes in a stack), Rename… and Delete…; Delete names what the map holds and that
  the maps under it stay. Rename and Delete wait for a connection.
- **Pictures.** A globe or flat map shows its first visible image (a globe's in a ball, shaded like
  one). A star map shows its stars and routes seen from above, and a system model its orbits, drawn
  from the map's own data. A map with nothing to draw yet shows its kind's small drawing.
- **Deck.** One sheet behind a map with one map under it, two behind one with more.
- **It grows with the library.** Under 5 maps: cards and a dashed New map tile. 5 or more: the view
  buttons. 12 or more: search and sort. 30 or more: kind chips (with counts), Needs publishing, and a
  Recently opened strip. 8 or more with Sort by Kind: group headers by kind. While a search or filter
  is in use its controls stay, so it can be undone.
- **Search** matches every word typed, in any order, against the title, the kind ("star map"), and
  the titles of the maps a layer lies under, so "Ezob" finds Derdama's layers. Matched letters are
  marked. `/` goes to the search, Esc clears it, ArrowDown goes to the first card.
- **Sort:** Recently edited (when the server says), Name, Kind.
- **List.** A row for each map with a thumbnail, title, kind, features and state, under a sticky
  header; on a phone the facts go under the title.
- **Keyboard.** The arrows move between cards and rows, Enter opens, `n` makes a map, `/` finds.
  Both are in the "?" sheet under "List of maps".
- **Empty, loading, no result, problems.** No maps: the four kinds drawn, "No maps yet" and Make the
  first map. Loading: skeleton cards. No result: "No map is called “x”." with Clear search and Show
  all kinds. Maps that could not be read are one notice above the list, not rows among the cards.
- **Phone.** Search is sticky under the top bar with the chips scrolling sideways; two cards across;
  the ⋯ button at the foot of the card; New map is a round +.

## The New map dialog

The four kinds as cards with a small drawing each (the two that need no image on dark, marked New),
a title, and what the kind needs: a Schematic checkbox for a flat map, the unit for a star map
(light-years or parsecs), an image for a globe or flat map. Enter makes the map.

## Server

`GET /api/maps` gives each map two more fields:

- `edited`: when it last changed, from its draft's last save, or else from the time its file was
  last written in the vault.
- `preview`: `{ kind: "image", path }`, or `{ kind: "stars", dots, lines }` (at most 60 stars, on a
  0 to 1 square, with routes as pairs of stars), or `{ kind: "system", star, rings }` (up to five
  planets' orbits), or null when there is nothing to draw.

Everything else (search, filters, sorting, decks, Recently opened, the view) is on the device. The
maps opened last are kept in the browser's local storage, not on the server.

## Left out

Pinning, tags or folders, Duplicate and bulk actions were named as later work in the proposal and are
not built; the mockup did not include them. The list is not windowed: cards and rows are drawn only
when near the screen (`content-visibility`) and pictures load as they come into view, which has been
enough for hundreds of maps.
