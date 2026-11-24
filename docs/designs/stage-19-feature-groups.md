# Feature groups: one place drawn as several shapes

- **For:** the owner's answer to Find areas' decision 1 ("zones with several pieces and holes"):
  "Maybe possibly add grouping of features? And labelling the group could be nice."
- **Status:** approved; built in release 19b (see "Approved decisions" at the end)
- **Mockup:** `ux/feature-groups-mockup.html`. It is a working page: a small flat map with three
  island zones (Calder, Skerra, Wyn) and a marker (Port Aldis). Shift-click the islands, press
  Ctrl/⌘+G (or Group), type a name, and try the rest: click, double-click, Esc, drag the group, drag
  its name, the right-click menu, the Layers tree (drag a feature onto a group), Ungroup, Done (viewing).
  The strip at the top switches the lake between the recommended hole and "Filled", and opens a
  Phone view. Screenshots: `ux/groups-shots/` (desktop 1–15, phone p1–p5).
- **Read for this:** stage 4, 6, 13 map designs; `packages/schema/src/maps.ts`; `LayerTree.tsx`;
  `FeatureEditor.tsx` and `LabelFields.tsx`; `MapPage.tsx`; the approved Find areas proposal.

## What's wrong today

- **A place made of several shapes is several unrelated features.** A realm of three islands is three
  zones. Each needs its own entry link, its own style and its own name; there is no way to select,
  move, hide or restyle "Aldmere" as one, and Explore treats a point on Skerra as unrelated to Calder.
- **Nothing writes a zone's name on the map.** Stage 13 left zone names to the hover tooltip; the
  Label tool (W) now writes free words, but a label is not tied to the zone it names: move the realm
  and its name stays behind.
- **The map selects one feature at a time.** `selected` in `MapPage.tsx` is one id. The Layers tree can
  already pick several (Shift/Ctrl-click) but only to drag them to another layer.
- **A lake inside a country cannot be shown.** A zone is one ring of `points`, so the realm's tint
  covers the lake and a tap on the water is "in Calder".

## What a group is

**A group is a named set of features in one layer that stand for one place**: the islands of a realm,
the pieces of a mountain range, the stretches of a road, a city's walls and its gate marker. It has
(all optional except its members):

| Part | What it does |
| --- | --- |
| **Members** | Two or more features of the same layer, of any kinds (zones, paths, markers, labels). A feature is in at most one group. |
| **Name** | Shown in the tree, the side bar, the hover tooltip and on the map. Like a feature's label, it is shown instead of the entry's title when both are set. |
| **Entry** | The entry the group stands for (the realm "Aldmere"). Members may still link their own entries (the island "Skerra"). |
| **A map of this place** | As a feature's `child`: the realm's detailed map, opened from the group. |
| **Its name on the map** | Written once for the whole group, placed automatically or by hand (below). |
| **Span** | When the group exists, as a feature's span (stage 6). |
| **Locked** | Its members cannot be picked on the map, as a locked layer's. |

**Groups and layers do different jobs.** A layer is how the author files the map (Places, Routes,
Realms, or one layer per realm with sublayers) and sets draw order and colour. A group is **one thing
drawn as several shapes**. That is why a group sits inside one layer, like a folder of features in the
Layers tree, rather than cutting across layers (decision 1). Someone who wants "everything about
Aldmere" (islands, capital, roads) to hide as one already has a tool for it: a layer named Aldmere with
sublayers. Inside it, the islands are a group.

**No groups inside groups** in this version. Grouping two groups merges them into one; a group of
groups can come later without a change to the file (a `parent` on a group, as layers have).

## On the map

### Selection, hover and going inside

The model is the one drawing programs use (Figma, Illustrator, Affinity), because the owner already
knows it:

| Action | Desktop | Phone |
| --- | --- | --- |
| Select the group | Click any member | Tap any member |
| Pick several (to group them, or to delete) | Shift-click, or Ctrl/⌘-click, on the map or in Layers | **Select several** (new button in the tool bar), then tap; or "Group with…" in the sheet |
| Go inside to one member | Double-click it, or **Enter** with the group selected (first member) | Tap it again while its group is selected |
| Another member, once inside | Click it | Tap it |
| Back out to the group | **Esc**, or the "← Aldmere" crumb in the side bar | The crumb |
| Deselect | Esc again, or click empty map | Tap empty map |

- **Selected group:** every member gets the selection outline (`--map-select`) at 75% strength, a
  dashed box surrounds them all, and a small tag on the box says "Group · Aldmere". Its name on the map
  gets a dotted frame (it can be dragged).
- **Inside a group:** the member has the full selection look; the dashed box stays, faint, with the
  tag "Inside Aldmere", so it is always clear that a click elsewhere in the group stays inside it. A
  click outside the group leaves it.
- **Hover** lights the whole group at half strength (the existing hover look) and the tooltip says
  "Aldmere · Skerra" (group, then member). In viewing, the floating preview is the group's entry.
- **Viewing** (not editing): a click selects the group, and the Selected tab is the group's card: name,
  entry opening, "Open the entry", "Edit this group". There is no going inside while viewing; the
  member's own entry, if any, is in the group card's member list.

### Moving, styling, hiding as one

- **Move:** with the group selected, dragging inside any of its zones moves every member (the existing
  zone drag, G10 of stage 13, extended to the group). A name placed by hand moves with it. One undo step.
- **Style:** the group's tab has **Zone style** (and **Path style** when it has paths) for all its
  zones at once; it shows "Mixed" until one is chosen. Straight/Curved (C) applies to all its paths and
  zones. **Layer** moves the group and all members.
- **Hide and lock:** the group's row in Layers has an eye and a lock, as layer rows do. Hiding is
  per session, like the layer and feature eyes today (`hidden` gains group ids). Lock is saved
  (`locked` on the group).
- **Delete** (Delete key, menu, side bar "Delete all 3") removes the group and its members in one undo
  step, with Undo in the toast, as for any delete.
- **Order:** the group does not change draw order. Its zones still lie under paths and markers of the
  layer, so a marker in a group is never hidden under its own realm.

### The group's name on the map

The owner's "labelling the group". It is drawn by the same code as a label (`drawLabel` in
`overlay.ts`: Georgia 600 with a paper halo), above everything, like labels.

- **Words:** the group's name, else its entry's title, in capitals with letter spacing (cartographic
  convention for realms). Off with **Write the name on the map** in the side bar.
- **Placement, automatic (default):** the **visual centre of the largest zone**, the point inside it
  farthest from every edge and hole (polylabel's method), and clear of markers: no marker may sit under
  the name's box. When no zone holds 40% of the group's area (an archipelago of equal islands), the
  middle of the whole group, which is where a mapmaker writes an archipelago's name, across the sea.
  A group with no zones (a road in stretches) is named above the middle of its box.
- **Placement, by hand:** drag the name on the map while the group is selected. It then stays where it
  was put, relative to the map, and moves with the group. **Automatic** in the side bar, or "Put the name
  back in the middle" in the menu, undoes it.
- **Look:** size, letter spacing, turn and colour, as a label's (the `LabelFields` controls, reused).
  The colour defaults to **from the zone style**: a darker shade of the style colour of the group's
  zones, so a purple realm has a deep purple name and a restyle changes both. "Ink" and any colour can be
  chosen instead.
- **Zoom:** the size is in screen pixels, as labels are. The name is written while the group is at least
  60% as wide on screen as the name itself, so zooming far out keeps big realms named and drops small
  groups' names instead of covering the map in text. The side bar says "Shown at this zoom" or "Hidden
  at this zoom: zoom in".
- **In time:** with time on, only members present at the year count: the name follows the largest piece
  that exists then; faint (perhaps) when the group is perhaps there.
- **Saved picture:** drawn exactly as on screen (the saved-picture rule of stage 13).

## In the Layers tree

The group is a row inside its layer, at the place of its first member, with its members nested under
it, like a folder (mockup screenshot 4):

```
▾ ● Realms                3  👁
   ▾ ⧉ Aldmere            3  🔓 👁
        ⬠ Calder
        ⬠ Skerra
        ⬠ Wyn
▾ ● Places                1  👁
     ⌖ Port Aldis
```

- The group icon is Lucide `Group`, in the selection colour so a group reads apart from a sublayer.
  Its count is its members.
- **Click** the group row selects the group; click a member row goes straight inside to it.
- **Drag** a feature row onto a group row to add it (it moves into the group's layer if needed); onto a
  layer row to take it out. Drag a group row onto a layer to move the whole group. The existing drop
  look (dashed "drop into") is reused.
- **Context menu and "⋯"** on a group row: Rename (F2), Ungroup, Go inside, Hide, Lock, Delete with its
  members.
- Shift/Ctrl-click in the tree already picks several; **Ctrl/⌘+G** now groups them.

## The side bar

- **Edit group** (tab named so, Lucide `Group` icon): Name; Entry (the entry combobox); *Name on the
  map* (switch, shown-at-this-zoom note, Automatic | Where I put it, size, spacing, turn, colour);
  Zone style "for its 3 zones"; Layer; Members (each opens the member, × takes it out); A map of this
  place; the time part (span), as the feature editor has; **Ungroup** (⇧⌘G) and **Delete all n**.
- **Edit feature** for a member: a crumb "← Aldmere › Skerra" at the top (Esc does the same); a
  **Group** select (None, the groups of its layer, "New group with this…"); the Layer field notes
  "moving it takes it out of the group"; "Take out of Aldmere".
- **Several picked** (tab "3 selected"): the list with each one's layer, **Group** (⌘G) or **Add to
  Aldmere** when one of them is a group, **Delete n**. When they are in different layers it says which
  will move: "A group keeps to one layer. Grouping moves Port Aldis into Realms." The same Group button
  also floats over the map in a small strip ("3 picked · Cancel · Group").

## Making and unmaking groups

- **Group (Ctrl/⌘+G)** with two or more picked: makes a group in the layer of the first one picked (or
  of the group among them), moves the others into that layer, selects the new group and opens Edit group
  with the Name field selected to type. If one of the picked is a group, the rest join it ("Add to
  Aldmere"). If two or more groups are picked, they merge into one new group.
- **Ungroup (Shift+Ctrl/⌘+G)**: the members stay where they are, in the layer, and stay picked so they can
  be regrouped. The group's name, entry and look go with it; the toast offers Undo.
- **Take out** (×, menu, drag to the layer): a group left with one member is dissolved, its last member
  left plain, since a group of one is just a feature.
- **Moving a member to another layer** (its Layer field) takes it out of the group, with a toast.
- **Find areas** (approved): **Make zone** with chosen areas that form several pieces makes one zone per
  piece and **groups them automatically**, and the new group opens with its name ready to type
  (decision 4). **Add to ‹selected›**: on a group, the new pieces join it; on a single zone, the zone and
  the pieces become a group, and the zone's entry link and label move up to the group (it now names the
  whole place), the zone keeping its own style. One undo step each.
- **Undo** covers every one of these as one step, through the map's history.

### On a phone (the installed app on the iPhone)

- **Select several** is a new button at the right of the tool bar, before undo (Lucide `BoxSelect` or
  `LayoutGrid`). It turns taps into picks: a strip above the tools says "3 picked · tap
  more" with **Cancel** and **Group**. The sheet stays closed meanwhile so the map is free to tap.
  The Edit feature sheet's **Group with…** starts the same mode with that feature picked.
- A tap selects the group and opens the sheet on Edit group; **a second tap on a member goes inside**,
  as there is no double-click. The crumb comes back out.
- The tree's rows are the 2.75rem phone rows; the eye and lock always show on a phone.
- Pinch and two-finger pan are unchanged; dragging a selected group with one finger moves it, as zone
  drag does today.

### Empty and edge states

- **Group with fewer than two picked:** the key does nothing but say "Pick two or more to group
  (Shift-click)"; the button and menu item are disabled with that reason.
- **A group with no name and no entry** is called "Group" in the tree; nothing is written on the map,
  and the side bar says "Give the group a name or an entry to write it".
- **Every member hidden:** the group row shows hidden; its name is not written.
- **A locked group:** clicks on its members pass through to the map (pan); it can still be selected
  from the tree, as a locked layer's features can.
- **A file from another device names a group that is gone, or a member in another layer** (offline
  merge): the feature is read as not in a group; nothing is refused (below).

### Keys (map scope, editing unless noted)

| Id | Keys | Label |
| --- | --- | --- |
| `map.group` | `Mod-g` | Group, or add to the picked group |
| `map.ungroup` | `Shift-Mod-g` | Ungroup |
| `map.enter` | `Enter` | Go inside the selected group (only when a group is selected; `map.finish` keeps Enter while drawing) |

Ctrl+G and ⌘G are the browsers' "find next"; the map takes them only while the focus is on the map
frame or the tree, as the registry's rules already do for Delete and arrows. **Esc** gains a step in
`map.cancel`: after the picked point and before the selection, "inside a group: back to the group".
Shift-click and Ctrl/⌘-click on the map are new (no Alt, keeping the rule for AltGr keyboards).

## Lakes inside a country: a choice for the owner

Groups don't express a hole: a group is pieces added together, never one taken away. Three ways to
show the Mere of Calder inside Calder (the mockup's top strip switches between the first two):

- **(a) Holes in a zone (recommended).** A zone gets an optional `holes` list of rings, cut out of its
  fill (even-odd). The lake's painted water shows through clean; a tap on the lake is not "in Calder";
  Explore says the lake is beside Calder, not in it. Find areas makes holes by itself (it already finds
  them), and by hand: **Cut a hole** in the zone's Edit feature tab draws a ring with the Zone tool's
  clicks; each hole's corners are edited like the outline's; **Fill the holes** removes them. If the lake
  has its own entry, a lake zone can sit exactly in the hole (Find areas makes it with one click).
  Cost: about 1.5 days (fill, hit test, handles, snapping to hole edges, the globe, Explore, later
  shapes). Older app versions keep the field and draw the lake filled.
- **(b) Filled: no change.** The lake is part of the zone, which is how a country's territory usually
  works: the lake belongs to Calder. The tint lies over the painted water; Explore at the lake says "in
  Calder". Free, and good for small lakes; it looks wrong for a large inland sea.
- **(c) A water zone drawn over it.** Not recommended: zones are translucent tints over the painted map,
  so a "lake" zone tints the water again rather than clearing the realm's tint, and making it opaque
  hides the painting.

## Other parts of Frontier

- **Explore and Place with AI** (`apps/server/src/ai/discover.ts`): "the zones it lies in" becomes "the
  zones and groups it lies in". A point inside any member zone is inside the group, and the group's entry
  is listed as the place it lies in, with the member's own entry as well if it has one. With holes (a),
  `isInside` leaves out a point in a hole. Place with AI's proposals can say "in Aldmere".
- **The AI companion's map context** lists a group once, with its members, instead of three loose zones.
- **Entries:** a group linked to an entry counts wherever a linked feature counts (the entry's places on
  maps, the hover preview). "Copy a link to this place" with a group gives `f=<group id>`, and opening it
  fits the view to the group's box.
- **Time (stage 6):** a group may have a span; a member is drawn only while both it and its group are
  present (an island that sinks in a later age keeps its own span). Later shapes stay per member; moving a
  group at a later year moves each member's shape on screen (G11 of stage 13).
- **Offline and merging:** membership is written on each feature (`group`, like `layer`), not as a list
  on the group, so two devices adding different islands to Aldmere merge without a clash, and renaming
  the group on one device while moving an island on the other doesn't clash either. Groups merge item
  by item like layers. After a merge, a member whose group the other side removed, or that the other
  side moved to another layer, is read as not in a group, and a group left with no members is dropped
  on the next save. A group whose layer the other side removed falls back with its members to the
  same layer, as features already do.

## The data model (additive; map file stays version 1)

In `packages/schema/src/maps.ts`:

```ts
export const MapGroup = z
  .object({
    id: ItemId,
    /** The layer it is in; its members are features of this layer. */
    layer: ItemId,
    /** The name; shown instead of the entry's title. */
    label: z.string().nullable(),
    entry: z.string().nullable(),
    child: z.string().nullable().optional(),
    span: ItemId.nullish(),
    /** The name on the map: left out, written; false, not written. */
    write: z.literal(false).optional(),
    /** Where the name is written; left out, placed automatically. */
    at: Pair.optional(),
    // The name's look, as a label's; left out, the defaults; color left out: from the zone style.
    size: z.number().min(6).max(160).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    rotate: z.number().min(-360).max(360).optional(),
    spacing: z.number().min(-0.2).max(2).optional(),
    locked: z.boolean().optional(),
  })
  .passthrough();

// MapFile: groups: z.array(MapGroup).optional()  (left out when there are none)
// featureBase: group: ItemId.nullish()            (left out when in no group)
// zone, and LaterShape: holes: z.array(z.array(Pair).min(3)).optional()   (decision 2a only)
```

- **Order and bytes:** `TOP` gains `"groups"` after `"features"`; `ITEM_KEYS.groups` is written in the
  order above; `"group"` and `"holes"` go at the end of `ITEM_KEYS.features` ("fields added later go at
  the end"). `orderFeature` leaves out a null `group` and an empty `holes`, so every existing file keeps
  its bytes.
- **Soundness, without refusing a file:** `superRefine` checks only that two groups don't share an id.
  `repairGroups(map)` (like `repairLayers`) is applied after reading and after a merge: a feature's
  `group` that names no group, or a group in another layer, is cleared; a group with no members is
  dropped; a group in a missing layer goes to the same fallback layer as features.
- **Merge:** `mergeMaps` adds `mergeItemLists(base.groups, mine.groups, theirs.groups)`, with clashes
  reported as for the other lists, then `repairGroups`.
- **Older app versions** read the new fields through `passthrough` and write them back unchanged; they
  draw holes as filled and draw no group names. Nothing breaks, and the owner's devices update with the app.

## Decisions for the owner

1. **Where a group lives.**
   **(a, recommended) Inside one layer**, as a folder of its features in the Layers tree. The tree stays
   one tree, hiding and locking a group is plain, and draw order is unchanged. Grouping features from two
   layers moves them into one (the side bar says so first). "Everything about Aldmere across kinds" stays
   the job of a layer with sublayers.
   (b) Across layers, like a tag. A realm could hold its islands (Realms layer), its capital (Places)
   and its roads (Routes) at once. But the tree can't nest a feature under two parents, so groups would
   be a second list beside the layers, with badges on member rows; hiding a group and hiding a layer
   would overlap; and "move the group to a layer" has no meaning.
2. **Lakes inside a country.** **(a, recommended) Holes in a zone**, about 1.5 days; or **(b) leave lakes
   filled** (no change, the lake counts as the country's). See the section above; (c) is not advised.
3. **What a click picks.**
   **(a, recommended) The group**; double-click, Enter or a second tap goes inside; Esc comes back out.
   This is the drawing-program habit, and it makes moving, restyling and naming the realm one click.
   (b) The member, with the group reached from its crumb or the tree. Fewer surprises for single islands
   but every whole-realm action takes two steps, and the group's name can't simply be dragged.
4. **Find areas with several pieces.**
   **(a, recommended) One zone per piece, grouped automatically**, named and linked once. This replaces
   the approved proposal's decision 1 (multi-piece zones) with the owner's grouping; holes stay with
   decision 2 here.
   (b) Separate zones, ungrouped; the owner groups them with ⌘G afterwards.

Smaller points settled here (say if any should change): no groups in groups for now; a group of one
dissolves; the name's colour follows the zone style; the name hides when the group is narrower than 60%
of it on screen; groups don't change draw order.

## Build plan (one engineer, about 8–9 days with holes; 7 without)

1. **Schema (1 day).** `MapGroup`, `group` on features, `holes` on zones and later shapes; `orderGroup`,
   `serialiseMap`, `parseMap`, `mergeMaps`, `repairGroups`; group-aware `removeLayer` and `moveFeatures`
   in `map/layerRows.ts`. Unit tests: an old file keeps its bytes; merges (two devices add different
   members; one renames while the other moves a member; one removes the group; one moves a member to
   another layer); repair cases.
2. **Selection (1.5 days).** `selected: string | null` becomes a selection (ids plus `inside`) in
   `MapPage.tsx`; `pick` in `map/gesture.ts` returns the top item (group or member) by the rules above;
   Shift/Ctrl-click toggles; double-click and second tap go inside; `map.group`, `map.ungroup`,
   `map.enter` in `keys.ts` and `useMapKeys.ts`, and the new Esc step; zone drag moves the selection;
   delete and undo for groups; the overlay draws the group's selection (member outlines and the dashed box
   with its tag) and the group hover.
3. **Layers tree (1 day).** `Row` gains `"group"` in `layerRows.ts`; group rows with eye and lock;
   drop into a group, drag a group to a layer; tree menu items; Ctrl/⌘+G on the tree's picked rows.
4. **Side bar (1 day).** `GroupEditor` (reusing `EntryCombobox`, `LabelFields` plus Placement and the
   zoom note, the style combobox for all zones); the several-picked panel and the strip over the map;
   `FeatureEditor` gains the crumb, the Group field and "Take out"; `FeatureCard` shows a group while
   viewing.
5. **The name on the map (1 day).** `groupLabelAt` in `map/` (visual centre of the largest piece by
   polylabel, marker clearance, the archipelago rule), the zoom rule, dragging the name, presence in
   time, the saved picture.
6. **Holes, if decision 2 is (a) (1.5 days).** Even-odd fill and hit test in `overlay.ts` and
   `gesture.ts`; hole rings' handles; Cut a hole (the Zone tool in a "hole" mode) and Fill the holes;
   snapping to hole edges; the globe fill; `isInside` in `discover.ts`.
7. **Find areas (0.5 day, when it is built).** Make zone with several pieces makes the zones and their
   group; Add to on a zone or a group.
8. **Phone (0.5 day).** Select several in the tool bar, the strip, the second tap, `useSheetFloor` keeping
   the selection above the sheet.
9. **Browser tests (1 day).** Desktop: Shift-click three zones, ⌘G, type a name, the tree shows the group
   with three members, the name is drawn, click selects the group, double-click goes inside, Esc comes out,
   drag moves all three, Ungroup and undo. Phone: Select several, tap three, Group, second tap goes
   inside. Viewing: the group card. Explore at a member reports the group's entry.
10. **Docs.** `docs/designs/stage-<n>-feature-groups.md` from this proposal once approved; amend the Find
    areas design's decision 1.

## Approved decisions

The owner approved the design with these answers; where they differ from the text above, they win.

1. **Where a group lives: inside one layer** (a, as recommended), as a folder row in the Layers
   tree. No groups inside groups in this version.
2. **Lakes: left filled** (b). Zones get no `holes`; everything about holes above (the `holes`
   field, Cut a hole, Fill the holes, the even-odd fill and hit test, `isInside` leaving out holes)
   is not built. A lake inside a country counts as the country's.
3. **What a click picks: the group** (a, as recommended). Double-click, Enter or a second tap on the
   phone goes inside to the member; Esc comes back out.
4. **Find areas with several pieces makes separate zones, not grouped** (b). The owner groups them
   afterwards with Ctrl/⌘+G. Find areas is built separately and does not make or join groups.
