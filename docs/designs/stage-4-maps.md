# Stage 4: maps

Status: Draft, 2026-11-21, revised after an implementation-readiness review. Author: Elad Haviv. Parent: [Frontier](frontier.md).

## Overview

Stage 4 adds maps: standalone objects that refer to entries. The author opens a map of a flat place
or of a globe, pans and zooms it, and taps a marker to read its entry. He places markers, draws paths and
zones, sorts them into layers, measures, and steps from a zone into the more detailed map of that place.

This document fixes what the parent design left to stage 4: the map file, how images are drawn, the
frame-rate target, and the order of building. Where the two differ, this document is the newer statement.

## What stage 4 delivers

| Part | The author can | Depends on the author |
| --- | --- | --- |
| 4a Map files | Create a map from an image of the vault; see the list of maps; publish maps like notes | No |
| 4b Viewer | Open a flat map or a globe; pan and zoom; turn the globe; switch a globe between globe and flat view | No |
| 4c Markers | Place a marker, give it an icon and an entry; tap one to preview and open its entry; see "appears on maps" on an entry | No |
| 4d Paths, zones, layers | Draw and edit paths and zones; show, hide and style layers; link a feature to a child map and step into it | No |
| 4e Measuring | Measure along a line; set a globe's radius or a flat map's scale | The sizes, when the lore has them |

Stage 4 is done when CUJ 7 and CUJ 10 of the parent design work on the deployed app with the real vault,
on a desktop and on a phone, and the first real map is published.

## Non-goals

*   Time. Features carry no dates and maps have no time slider; that is stage 6. The file form leaves
    room for it (see "Features").
*   Projections other than the globe view and the plain flat view of a globe; cylinder and schematic
    spaces. They are stage 7. Derdama and the cosmological map are flat maps until then.
*   Tiled images. See "Images".
*   Exporting or printing a map. That is stage 9.

## Decisions settled here

### Images are drawn whole, not as tiles

The parent design cuts every image into a pyramid of tiles. The vault's map images do not need it: the
largest is 2944 by 1440 pixels (measured 2026-11-21). So in stage 4:

*   An image is one WebGL 2 texture with mipmaps, so it does not shimmer when shown small.
*   The image server gains the sizes 2560 and 4096. For these two the number bounds the longer side,
    whichever it is, and nothing is enlarged. The browser asks for 4096, or for 2560 when the screen is
    narrower than 700 pixels or the device's largest texture is smaller than 4096.
*   An image larger than 4096 pixels on its longer side is shown at 4096 with a note saying so. Tiles
    are built when the author has such an image and wants its detail; the drawing below does not change
    when they arrive, because a tile is only a smaller rectangle of the same kind.
*   No tiling job runs on the server, so the parent design's question of a separate tiling process does
    not arise yet. Git LFS is not needed at these sizes.

### Two views of a globe, both without seams

A globe is always north-up. Its view is the position facing the viewer (or at the centre) and a size;
there is no free rotation about the line of sight.

*   **Globe view.** Orthographic, through `d3-geo`.
*   **Flat view.** Longitude across, latitude down, with no library: a position is a multiplication and
    an offset. The picture repeats every 360 degrees and is drawn as many times as the screen needs; the
    centre longitude wraps, so panning east or west never reaches an edge and nothing crosses a seam.
*   The projections that do have seams are stage 7, and their seam handling is designed there.

### The image grid follows the zoom

In the flat view of a globe and on a flat map an image is one rectangle, drawn exactly. In the globe view
it is a grid of cells whose corners are projected and whose insides are stretched linearly, which is only
an approximation of the curve. A fixed grid would let the picture drift from the markers by many pixels
when zoomed in. So the grid is rebuilt for each frame over the part of the globe that is on screen:

*   The cell size in radians is `1.3 / sqrt(k)`, `k` being the globe's radius in pixels, never more than
    6 degrees. That keeps the picture within half a pixel of the true projection at every zoom.
*   Only cells inside the visible range of longitude and latitude are built. The count stays in the low
    thousands at every zoom.
*   A cell with every corner on the far side is dropped. A cell that straddles the edge keeps its hidden
    corners, moved onto the edge of the disc, so the globe's outline is smooth.

### Frame rate

30 frames a second while dragging on a mid-range phone, 60 on a desktop. If a phone falls below it, the
cell size is doubled while a finger is down and restored when it lifts.

## 4a Map files

### Where maps live

A map is a JSON file in the vault, `.frontier/maps/<id>.json`, where `<id>` is 8 characters like an entry
id. Maps are written through drafts and Publish like notes: a map the author is drawing is a draft, shown
in Unpublished changes, and reaches `main` only when he publishes. The draft rules that apply to notes
apply here, with these differences:

*   **Who writes them.** Only the map routes make and change map drafts; they call the draft store
    themselves. The note routes go on refusing anything that is not a note: the save, resolve and
    merge-versions routes refuse a map draft, and the tree, the quick switcher and search list notes
    only.
*   **Merging by item, not by line.** One function, `mergeMaps(base, mine, theirs)`, merges two versions
    of a map that started from the same one. Features, layers and images are matched by id: an item
    added, changed or removed on one side only is taken from that side; the title, space and marker
    sets likewise. An item changed on both sides differently is a **clash**.
*   **Two devices.** The browser keeps the last map the server confirmed. When a save is answered
    `stale_revision`, the browser fetches the server's map, merges with that function, saves again, and
    says how many items clashed; in a clash this device's version is kept. No second version is stored
    for a map, and the author never merges JSON by hand.
*   **Publish.** When a map changed on `main` since its draft began, Publish merges with the same
    function in place of the line merge. Without a clash the result is shown for confirmation like any
    merge. With one it is a conflict of a new kind, `map_changed_on_both`, and the author chooses his
    version or the vault's for the whole map.
*   **A draft that is gone.** A map draft equal to `main` is cleared like any draft. A save for a map
    with no draft simply starts a new one, so the open page and its undo history carry on.
*   **In Unpublished changes** a map shows the difference against the vault's file, and its link opens
    the map page.
*   Agents do not change `.frontier/`; the inbox already refuses such files.

### The file

```json
{
  "version": 1,
  "id": "m8k2x0aa",
  "title": "Ezob",
  "space": { "kind": "sphere", "radius": null, "unit": "km" },
  "images": [
    { "id": "i1", "name": "Political", "path": "99 Appendices/01 Images/ezob-map.png", "extent": [-180, -90, 180, 90], "visible": true }
  ],
  "markerSets": ["Skyrim"],
  "layers": [
    { "id": "l1", "name": "Cities", "visible": true, "color": "#9a3b1f" }
  ],
  "features": [
    { "id": "f1", "kind": "marker", "layer": "l1", "at": [12.5, 44.1], "entry": "k3f9x2ab", "label": null, "icon": { "set": "Skyrim", "name": "Fort" }, "child": null },
    { "id": "f2", "kind": "path", "layer": "l1", "points": [[12.5, 44.1], [20, 40]], "entry": null, "label": "The Salt Road", "child": null },
    { "id": "f3", "kind": "zone", "layer": "l1", "points": [[0, 0], [10, 0], [10, 10]], "entry": "p2m4q8zz", "label": null, "child": "c7d1e5ff" }
  ]
}
```

*   **The text.** Two-space indentation, keys in the order shown, and each image, layer and feature on
    one line, so that a difference reads item by item. The same map always gives the same bytes. Keys
    Frontier does not know are kept where they are.
*   **Ids** of maps, images, layers and features are 8 random characters; the short ones above are for
    reading. Items are kept in the order they were added, and that is the order they are drawn in.
*   **Space.** `sphere`: positions are `[longitude, latitude]` in degrees; `radius` is null until the
    author gives one. `flat`: positions are `[x, y]`, y downwards, in a frame of `width` by `height`
    that is fixed when the map is made, from the pixel size of its first image; the space also holds
    `scale` (units per position unit, null until given) and its `unit`.
*   **Images.** `extent` is `[west, south, east, north]` on a sphere and `[left, top, right, bottom]` on
    a flat map. A new sphere image starts as the whole globe; the author can change the extent for an
    image that covers a part. Several images are alternatives (political, satellite, height); the viewer
    shows the visible ones in order, a later one over an earlier one. A new image on a flat map starts
    as the whole frame. An extent must have a width and a height; on a sphere it lies within -180 to
    180 and -90 to 90 with west less than east, so an image does not run across the 180th meridian.
*   **Layers** group the features and carry a colour. Every feature belongs to one layer.
*   **`visible`** on an image or a layer is how the map opens. Showing and hiding while reading is kept
    in the address and never changes the file; the layer list in editing mode has "Open the map like
    this", which writes the current choice into the file.
*   **Features.** A marker has one position, a path two or more, a zone three or more. `entry` is an
    entry's `id` or null. `label` overrides the entry's title. `icon` names a marker set and an icon in
    it; without one a marker is a plain dot in its layer's colour. `child` is the id of another map.
    A feature may later carry `from` and `until`, the names of two events of its entry; stage 4 keeps
    these keys when it finds them and does not read them.
*   **Linking an entry.** The browser names the entry by path. The server checks the save's revision
    first, then gets the entry's id with `ensureId`, which writes one into a draft of the entry when it
    has none. If that is refused (an appendix file, unreadable properties, an entry marked for
    deletion), the save succeeds with that feature left unlinked and the reason in the answer.
*   **Ids that are not published yet.** The server looks an id up in the published entries and then in
    the drafts' frontmatter, so a just-linked entry opens from its marker, and the entry lists the map,
    before anything is published.
*   **Publishing together.** When a plan holds a map whose features name an id that no published entry
    has, the draft that writes that id joins the map's group, so a map never reaches `main` pointing at
    an id that is not there. The other edits in that entry's draft wait with it; that is accepted.
*   **Leftover ids.** Unlinking or undoing does not take the id back out of the entry. An id on an
    entry is harmless, and its draft is in Unpublished changes to publish or discard.
*   **Valid** means: the form above, version 1, unique ids, and every feature in a layer that exists.
    A `child` that names no map is allowed and shows as a broken link. A file that is not valid, or has
    another version, is listed on the status page and is not shown as a map.
*   `99 Appendices/06 Interactive Maps/Main.json`, from the author's earlier map tool, is not read. The
    parent design leaves its removal to the author, by hand.

### Marker sets

A marker set is a folder of images. Every folder directly under the icon folder is a set, named after
the folder; the icon folder is `99 Appendices/07 Icons` and can be changed with `ICON_FOLDER`. The vault
has three today: Skyrim (60 icons), ESO (53) and KingdomCome (71). An icon's name is its file name
without the extension, and that is what the file stores; for reading, a `SR-mapicon-` prefix and a
doubled `.png` are left out and underscores become spaces. A map
lists the sets it uses, and the icon picker offers those; managing sets is choosing which ones a map
lists. The parent design's manifest files are not needed for this and are left out.

The Skyrim, ESO and Kingdom Come icons belong to commercial games. They are fine for the author's own
use; stage 9 must select another set for anything published.

## 4b Viewer

*   **Images** are drawn in WebGL, as described under "Decisions settled here". Features are drawn on a
    2D canvas above.
*   **The view** is the only thing that knows about projection. It has two functions, position to screen
    and screen to position. Three views exist: flat map, globe view, flat view of a globe. Tools use the
    two functions and so work the same in every view.
*   **Lines and zones on a globe** follow great circles, as measuring does. Each stretch is cut into
    steps of at most 3 degrees whose longitudes run on without a jump at the 180th meridian.
    *   In the globe view they are drawn with `d3-geo`'s path drawing, which cuts them at the edge of
        the disc.
    *   In the flat view the stepped line is drawn through the view at each repeat of the picture, as
        are markers.
    *   The inside of a zone in the flat view is not the closed outline: a zone across the edge of
        the picture is two pieces, and a zone that contains a pole reaches up to the pole's line
        across the whole width. One function, `zoneOnPlate`, gives the pieces to fill, cut where the
        picture repeats; the outline is still drawn as the stepped line. As in the globe view, the
        inside is the smaller of the two parts the outline divides the globe into. A tap finds a
        zone by these pieces.
*   **Gestures.** A drag pans: the view moves by the distance dragged, on and off the globe's disc
    alike. Two fingers or the wheel zoom about the point under them; the globe zooms about its centre.
    Buttons zoom and reset. A press that moves less than 6 pixels (10 on touch) is a tap. No gesture
    library is used.
*   **Finding what was tapped** is done on the screen, within 22 pixels of a marker and 11 of a line;
    a marker wins over a line and a line over a zone.
*   **The address** holds the view and what is shown: `?v=g,12.5,44.1,270` (the view's kind, centre and
    size), `hide=` with layer ids and `img=` with image ids, when they differ from how the map opens.
    It is replaced as the view moves, not added to the history, so Back from an entry returns to the map
    in one step, at the same place. A link to a map can point at a spot.
*   **Labels** are drawn for markers, later features first, where they do not overlap one already drawn.
*   **Without WebGL 2** the page says that maps need it. No second renderer is kept.

## 4c to 4e Tools

The map page has a reading mode and an editing mode. Reading mode is the default.

*   **Reading.** Tapping a feature opens a small card: its label or entry title, the first lines of the
    entry, a link to the entry, and "Open the map of this place" when it has a child map. The image and
    layer switches are available here too.
*   **Editing** shows a toolbar: select, marker, path, zone, measure, and the layer list.
    *   Select: tap a feature to select it; drag a selected marker, or a point of a selected path or
        zone, to move it; a selected point has Remove. Dragging anything else pans.
    *   Marker: tap the map, then choose an entry by name (the quick switcher's search) or type a label,
        and an icon.
    *   Path and zone: each tap adds a point; Done, or a tap on the last point, finishes. A zone is
        closed from its last point to its first.
    *   Every feature can be moved to another layer, relabelled, linked to an entry or a child map, and
        deleted.
    *   Layers can be added, renamed, recoloured, reordered and deleted. Deleting a layer with features
        asks first and moves them to the layer above.
    *   Images are in the same list while editing: an image of the vault can be added, renamed, moved
        up and down, placed by typing the four numbers of its extent (taken as soon as they make an
        extent; "The whole globe" or "The whole map" puts it back), and taken off the map, which asks
        first. A map keeps at least one image.
    *   A feature can be brought forward or sent back. Layers are drawn in their order, and within a
        layer zones lie under paths and paths under markers, so a feature passes only the features
        of its own kind in its own layer: it changes places in the file with the nearest of them.
        A later marker is drawn above an earlier one and is the one a tap finds.
    *   Undo and redo cover every change since the map was opened.
*   **Saving** follows the editor: each change is saved as a draft about a second later, with the states
    saved, saving and offline. A change from another device is merged as described under "Where maps
    live".
*   **Measure.** Tap points; the total is shown as it grows. On a sphere it is an angle and a fraction of
    the circumference, along great circles, and a distance once the map has a radius. On a flat map it
    is position units, and a distance once the map has a scale. The scale can be set by measuring a line
    and typing its real length.
*   **Appears on maps.** An entry page lists the maps, drafts included, whose features carry its id,
    each a link that opens the map centred on the feature.
*   **Child maps** are links for stepping between maps. A map may be reached from several others, and a
    loop is allowed. Deleting a map that others name leaves broken links, which their pages show.

## API

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /api/maps` | none | `{ maps: [{ id, title, space, features, state }], problems: [{ path, message }] }`; `features` is a count; `state` is `published`, `unpublished` or `new`; drafts are included |
| `GET /api/maps/:id` | none | `{ map, revision, state, entries: { <id>: { path, title } }, children: { <id>: title } }`; `revision` is 0 without a draft |
| `POST /api/maps` | `{ title, kind, image }`, `kind` being `sphere` or `flat` and `image` the vault path of an image, published or uploaded and not yet published | `{ id }`; makes a draft; a flat map's frame is the image's pixel size |
| `PUT /api/maps/:id` | `{ map, revision, link? }`, `link` being `[{ feature, path }]` for entries to be linked by path | `{ revision, map, unlinked: [{ feature, reason }] }`, or `stale_revision` |
| `POST /api/maps/:id/resolve` | `{ keep }`, `mine` or `theirs` | `{ ok }`; for a `map_changed_on_both` conflict |
| `DELETE /api/maps/:id` | none | `{ ok }`; a `delete` draft, or the discard of an unpublished map |
| `GET /api/marker-sets` | none | `{ sets: [{ name, icons: [{ name, path }] }] }` |

Errors use the existing codes: `not_found` for an unknown map, `invalid` for a map that is not valid
or an image that cannot be read, `stale_revision`, `not_allowed`.

`GET /api/entries` gains `maps: [{ id, title, feature }]`, drafts included. `GET /api/images` accepts
the sizes 2560 and 4096 and serves icons from the icon folder. The status page lists map files that
cannot be read.

## Files

| File | What |
| --- | --- |
| `packages/schema/src/maps.ts`, `api.ts` | The map file's form, its text form, `mergeMaps`, the shapes above, the image sizes, the new conflict kind |
| `packages/geo/src/{space,view,measure,mesh,hit,zone}.ts` | Positions, the three views, distances and stepped lines, the grid of an image for a view, finding the feature under a point, the inside of a zone on a globe laid flat |
| `apps/server/src/maps/store.ts` | Reading maps from the vault and from drafts, writing a map as a draft, the one-feature-per-line form, marker sets |
| `apps/server/src/routes/maps.ts` | The routes above |
| `apps/server/src/images/serve.ts`, `publish/publish.ts`, `index/build.ts` | The new sizes; merging maps by item and the map-and-id groups; ids in drafts |
| `apps/server/src/routes/{drafts,entries,search}.ts` | Refusing map drafts in the note routes; the vault's text of a map for the difference; notes only in the tree and switcher; maps per entry |
| `apps/web/src/map/{renderer,overlay,gestures,tools,history}.ts` | WebGL drawing, the feature canvas, pointer handling, the tools, undo |
| `apps/web/src/pages/{Maps,MapPage}.tsx`, `components/{FeatureCard,LayerList,IconPicker}.tsx` | The pages and panels |
| `apps/web/src/pages/{Entry,Unpublished}.tsx`, `components/Shell.tsx` | "Appears on maps"; a map among the unpublished changes and its conflict; Maps in the bar |

New packages: `d3-geo`. `d3-geo-projection` waits for stage 7.

## Risks

| Risk | Effect | Answer |
| --- | --- | --- |
| The globe is slow on a phone | Dragging stutters | Double the cell size while a finger is down |
| Two devices change the same feature | One change is lost | The saving device's version is kept and the page says how many items clashed |
| A map and the vault's copy both changed the same feature | They cannot be merged | A conflict; the author keeps his map or the vault's |
| An image does not cover what its extent says | Markers sit in the wrong place after the extent is corrected | Positions are in the map's space, not the image's, so correcting the extent moves the image under the markers |
| A large image arrives | It is shown reduced | Said on the page; tiles are built then |

## Verification

*   **Geo package:** unit tests for each view's two functions being inverses of each other, visibility on
    the globe, great-circle distances against known values, flat distances, stepped lines across the
    180th meridian, the grid staying within half a pixel of the true projection at several zooms, and
    finding a feature under a point.
*   **Schema package:** the text form giving the same bytes for the same map and keeping unknown keys;
    `mergeMaps` for an item added, changed and removed on each side, and each kind of clash.
*   **Server:** creating, saving and deleting a map through drafts; a save with no draft; the stale
    revision; a map changed on `main` merged by item at Publish, and a clash held as a conflict resolved
    each way; linking by path writing an id, the refusals, the lookup of an unpublished id, and the map
    and the id published together; maps per entry; marker sets from the folder; a file that cannot be
    read; the note routes refusing a map draft.
*   **Browser:** CUJ 7 on a flat map and on a globe, with the view restored after Back; placing a marker
    with an entry and an icon; drawing a path and a zone; hiding a layer; a child map; CUJ 10 before and
    after a radius is set; the page at phone width with touch gestures.

## Questions for the author

None of these blocks the work.

1.  **Which image is which map?** The work assumes `ezob-map.png` is the whole globe of Ezob, with
    `ezob-satellite.png` and `ezob-heightmap.png` as alternatives of the same extent, and that the
    continent maps (Solahrin, Gavyris, Istandir) are flat maps of their own, reached from zones on the
    globe. The author creates the real maps himself in the app; this only affects the examples.
2.  **Do the continent images line up with the globe?** If they are cut from the globe image, they could
    be placed on the globe by their extent instead of being separate flat maps.
