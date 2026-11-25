# Chapter 3: Maps

A map in Frontier is a picture of your world with a layer of meaning drawn on top. You bring the
picture (a painted map, a satellite view, a diagram of the heavens). Frontier lets you pin your
entries onto it: a marker for a city, a path for a river or a road, a zone for a kingdom, a label
for a sea. Click a city on the map and you read its entry. Open an entry and you can see which
maps it appears on.

This chapter covers everything about maps: making one, finding your way around it, drawing on it,
sorting what you draw into layers, giving it a look, measuring it, watching it change through the
years, and the tools that look at your picture and draw for you (Find areas, Find paths, Suggest
biomes, Terrain, Explore).

You do not need to read it from start to finish. The first five parts are all most people need;
the rest are there when you want them.

## Contents

1. [The words used in this chapter](#1-the-words-used-in-this-chapter)
2. [The Maps page](#2-the-maps-page)
3. [Making a map](#3-making-a-map)
4. [Looking at a map](#4-looking-at-a-map)
5. [Editing a map: the basics](#5-editing-a-map-the-basics)
6. [Markers, paths, zones and labels](#6-markers-paths-zones-and-labels)
7. [The Edit feature panel](#7-the-edit-feature-panel)
8. [Linking a feature to an entry](#8-linking-a-feature-to-an-entry)
9. [Generating names and places with AI](#9-generating-names-and-places-with-ai)
10. [Changing shapes: corners, curves, snapping and joins](#10-changing-shapes-corners-curves-snapping-and-joins)
11. [Layers](#11-layers)
12. [Images on a map](#12-images-on-a-map)
13. [Groups and selecting several things](#13-groups-and-selecting-several-things)
14. [Styles and the legend](#14-styles-and-the-legend)
15. [Measuring and scale](#15-measuring-and-scale)
16. [Biomes](#16-biomes)
17. [Find areas: zones from your picture](#17-find-areas-zones-from-your-picture)
18. [Terrain: a height map for your world](#18-terrain-a-height-map-for-your-world)
19. [Find paths: rivers, routes and traced lines](#19-find-paths-rivers-routes-and-traced-lines)
20. [Suggest biomes](#20-suggest-biomes)
21. [Explore: places worth a look along your roads and rivers](#21-explore-places-worth-a-look-along-your-roads-and-rivers)
22. [Maps in time](#22-maps-in-time)
23. [Globes, other views, layers beneath and schematic maps](#23-globes-other-views-layers-beneath-and-schematic-maps)
24. [Keyboard shortcuts](#24-keyboard-shortcuts)
25. [Desktop and phone](#25-desktop-and-phone)
26. [Troubleshooting](#26-troubleshooting)

---

## 1. The words used in this chapter

| Word | What it means |
| --- | --- |
| **Map** | One map file: a picture (or several) plus everything you draw on it. Maps live in your library alongside your entries. |
| **Feature** | One thing drawn on the map. There are four kinds: a **marker**, a **path**, a **zone** and a **label**. |
| **Marker** | A single point: a city, a tower, a shrine. It can show an icon. |
| **Path** | A line of two or more points: a river, a road, a border, a coast. |
| **Zone** | A closed area of three or more points: a kingdom, a forest, a lake, a desert. |
| **Label** | Free words written on the map: the name of a sea, a mountain range, a region. It is not tied to an entry. |
| **Entry** | One of your Markdown notes. A feature can point at an entry; clicking the feature then shows the entry. |
| **Layer** | A named, coloured folder for features (Cities, Roads, Realms). Layers can be shown, hidden, locked and nested. |
| **Group** | Several features that together stand for one place, such as the three islands of a realm. |
| **Style** | A reusable look for paths and zones (a blue river, a dash-and-dot border). Styles belong to the whole library, not to one map. |
| **Biome** | What kind of ground a zone is: desert, taiga, wetland. A biome gives a zone a pattern and a meaning for travel and rivers. |
| **Height map** | A grey picture of the same land where brighter means higher. It helps Frontier draw believable rivers and routes. |
| **Chronicle** | A timeline of your world (see the chapter on chronicles). A map can follow a chronicle to show how the world changes through the years. |

You can look at a map without changing anything (this is called **viewing**), or press **Edit** to
change it (this is called **editing**). Many things in this chapter work in only one of the two,
and each section says which.

---

## 2. The Maps page

Open **Maps** from the left-hand navigation. The page lists every map in your library.

Each map is one line: its title (click it to open the map) and a short description in grey:

| What the grey line says | What it tells you |
| --- | --- |
| **globe**, **flat map** or **schematic map** | The kind of map (see [section 3](#3-making-a-map)). |
| **12 features** | How many markers, paths, zones and labels it holds. |
| **lies under Ezob** | This globe is a layer beneath another globe (see [section 23](#23-globes-other-views-layers-beneath-and-schematic-maps)). |
| **2 layers below** | Other globes lie beneath this one. |
| **not published yet** or **unpublished changes** | The map is new, or you have changed it since you last published. |

If a map file in your library is damaged or cannot be read, the page shows a notice under the list
saying which file it is and why it is not shown as a map. The rest of your maps are unaffected.

Below the list is the **New map** form (described next).

> **Tip.** Changes to a map are saved automatically as you work, as a draft, and then wait with
> your other unpublished changes until you publish them. Publishing is covered in the chapter on
> saving and publishing.

---

## 3. Making a map

### Make a new map

1. Open **Maps**.
2. In the **New map** form, type a **Title**.
3. Choose a **Kind** (see the table below).
4. Under **Image**, press **Choose an image…** and pick the picture the map is drawn over
   ([how the image dialog works](#the-image-dialog)).
5. Press **Make the map**.

The map opens at once, already in editing mode, so you can start drawing. The **Make the map**
button stays greyed out until you have both a title and an image.

### Which kind of map?

| Kind | Choose it for | What is special about it |
| --- | --- | --- |
| **Flat map: a region, a city** | A painted map of a continent, a kingdom, a town, a dungeon floor. | The picture is a plain rectangle. You can measure distances once you tell Frontier the scale. |
| **Schematic: a diagram, with no measuring** | A diagram where distance means nothing: the layers of the heavens, a family-tree-shaped cosmos, a subway map. | The same as a flat map, but with **no Measure tool** and no distances. Terrain is not offered on it, and Find paths needs a picture of its own to look at. |
| **Globe: an image that wraps a whole world** | A world map that covers the whole planet, edge to edge (an equirectangular picture, twice as wide as it is tall). | You can look at it as a turning ball, laid out flat, or in any of nine map projections. Positions are longitude and latitude. |

You can change a flat map into a schematic one later (and back) from the **This map** box in the
Layers tab while editing. You cannot change a flat map into a globe or the other way round, so
choose the kind that fits the picture.

### The image dialog

The same dialog opens whenever Frontier asks for a picture: when making a map, when adding another
image to a map, and when choosing a height map. It is titled **Choose an image** (or, for a height
map, **Choose a height map**).

At the top are four ways to bring a picture in:

| Button | What it does |
| --- | --- |
| **Upload…** | Pick a file from your device. |
| **Paste image** | Takes an image from your clipboard. (You can also just press Ctrl+V, or ⌘V on a Mac, while the dialog is open.) |
| **From a web address** | Paste the address of an image on the web (it starts with `https://`) and add it. Frontier fetches it for you. |

Below them is your library of images already in Frontier, with tabs for narrowing the list, a
**Find by name or entry** search box, and folders on the side. Click an image to select it, then
press **Choose**. An image you upload here is a new unpublished change, like any other.

Uploads and web addresses need a connection to the server. Choosing an image that is already in
your library works offline.

> **Tip.** Large pictures work best at around 4000 pixels on the long side or less. Frontier asks
> for a smaller version on narrow screens, so a big map still opens quickly on a phone.

### Delete a map

While viewing or editing, open the **⋯** menu (**More actions**) in the map bar and choose
**Delete map**. Frontier asks you to confirm. Deleting needs a connection. The map is removed from
your library the next time you publish a version. The picture it was drawn over stays in your
image library.

---

## 4. Looking at a map

When you open a map from the Maps page, you are **viewing** it. Nothing you do by clicking,
dragging or zooming can change the map, so it is safe to explore.

### The map bar

The bar across the top of a map holds:

| Control | What it does |
| --- | --- |
| **All maps** (arrow at far left) | Back to the Maps page. |
| **Title** | The map's name. While editing you can type a new one in the same place. |
| **Saved as a draft / Saving… / Unsent: kept on this device / Not saved** | (Editing only) Where your changes are. "Unsent" means you are offline; your work is safe on this device and goes up when the connection returns. |
| **View** (globes only) | A drop-down: **Globe**, **Flat**, or one of nine projections (see [section 23](#23-globes-other-views-layers-beneath-and-schematic-maps)). |
| **Turn** (projections only) | Opens the panel for turning the globe before it is flattened. |
| **▲ Up** and **▼ Down** | Step to the map this one lies under, or to a map lying beneath it. |
| **Explore** | (Viewing only, and only when AI is set up) Switches on points of interest along roads and rivers ([section 21](#21-explore-places-worth-a-look-along-your-roads-and-rivers)). |
| **Time** | (Only when you have at least one chronicle) Turns the time bar on or off ([section 22](#22-maps-in-time)). |
| **Layers** | Opens or closes the Layers tab in the side bar. |
| **Edit** / **Done** | Starts or stops editing. |
| **⋯ More actions** | Save a picture, copy a link, Terrain…, Delete map. |

### Moving around

| To | On a computer | On a phone or tablet |
| --- | --- | --- |
| **Pan** (slide the map) | Press and drag on empty map. Or hold Space and drag anywhere. Or drag with the middle mouse button. Or use the arrow keys. | Drag with one finger. |
| **Zoom in or out** | Scroll the mouse wheel (the map zooms around the pointer). Or press **+** / **-**. | Pinch with two fingers. |
| **Zoom with buttons** | The three buttons at the corner of the map: **Zoom in**, **Zoom out**, **Show the whole map**. | The same three buttons. |
| **See the whole map again** | Press **0**, or the **Show the whole map** button. | The same button. |
| **Turn a globe** | Drag sideways. On a flat view of a globe the picture repeats, so you never reach an edge. | Drag sideways. |

The arrow keys slide the map by a modest step; hold **Shift** with an arrow to slide further.
Keyboard keys act on the map only when the map has the focus: click the map once first, and keys
you type in a text box stay in the text box.

### What happens when you point at things

On a computer, moving the mouse over a feature lights it up with a faint halo and shows its name in
a small tag next to the pointer (features with no name say **Unnamed marker**, **Unnamed path**,
**Unnamed zone**). If you leave the pointer on a feature that is linked to an entry for about a
third of a second, the tag turns into a small card showing the start of the entry, plus the title
of the map of that place if it has one. Cards are not shown while editing, so they never cover
what you are working on. A zone with a biome also shows what the biome does to travel and rivers.

Phones have no hover, so nothing floats over the map there; tap a feature to read about it.

### Selecting a feature

Click (or tap) a feature to select it. It gets a stronger outline, and the side bar opens its
**Selected** tab, a card showing:

* The name, or **Unnamed**.
* A short note in grey if the map is being seen in time and the feature is faded or dashed
  ("Not yet: begins year 270.", "Perhaps: begins …", "Gone: ended …", "Undated: …"; see
  [section 22](#22-maps-in-time)).
* For a biome zone, the biome and what it means.
* The opening lines of its entry.
* **Open the entry**, and **Open the map of this place** when the feature has a detailed map of
  its own. If the entry or map cannot be found, the card says so ("Its entry could not be found.",
  "Its map is missing.").
* **Copy a link to this place** (a link that opens the map centred on this feature) and
  **Edit this feature** (starts editing with it already selected).

Press **Esc** or the **✕** to close the card and deselect.

If the feature belongs to a group, clicking any piece selects the whole group and its card lists
the members, each with its own entry link ([section 13](#13-groups-and-selecting-several-things)).

### The right-click menu

On a computer you can right-click the map. While viewing, the menu depends on what is under the
pointer.

On a feature:

* **Open the entry** (greyed with a reason if it has none)
* **Open the map of this place** (greyed if it has none)
* **Copy a link to this place**
* **Edit this feature**

On empty map:

* **Copy a link to this view**
* **Explore here** (only when AI is set up; switches on Explore and chooses the place you clicked)

Phones have no right-click menu. Holding Shift while you right-click gives you your browser's own
menu instead.

### Showing and hiding layers and images

Open the **Layers** tab (the **Layers** button in the bar, or press **L**). Each layer has an eye:
click it to hide or show the layer and everything in it. If the map has more than one image, each
has a tick-box to show or hide it. While you are only viewing, these choices are for your own
reading and are not written into the map. They are kept in the map's web address, so a copied link
reopens the map with the same layers hidden. To change how the map opens for everyone, use **Open
the map like this** while editing ([section 11](#11-layers)).

The tab also holds the **Legend** at the top ([section 14](#14-styles-and-the-legend)), and, if the
map is in time, a line saying how many features are there, perhaps there, or undated.

### Saving a picture of the map

Open **⋯ More actions** and choose one of:

* **Save a picture at screen size**
* **Save a picture at twice the size**
* **Save a picture at four times the size**

Frontier draws the map exactly as you see it (the layers you have shown, the year you are looking
at, and the biome legend if it is switched on) and downloads it as a PNG file named after the
map. If your device is too small to draw the larger sizes, it will tell you the picture could not
be made.

These items appear only while viewing. Selections, hover halos and editing marks are never in the
picture.

### Copying a link to a view

**⋯ More actions → Copy a link to this view** copies a web address that reopens the map exactly as
you see it now: the position and zoom, which layers and images are shown, the globe's projection
and angles, and (if time is on) the chronicle and year. Paste it into a note or send it to
yourself.

### Open a map that sits under or over another

If the bar shows **▲ Up** or **▼ Down**, this map belongs to a stack of related globes. **Down**
opens the map beneath at the same place, the same zoom, the same view and the same year; **Up**
returns. If there are several maps beneath, **▼ Down** is a drop-down list to choose from.

---

## 5. Editing a map: the basics

### Start and stop editing

* Press **Edit** in the map bar, or press **E** on the keyboard (with the map focused).
* Press **Done**, or **Ctrl+Enter** (⌘+Enter on a Mac), to stop editing. Done also sends any waiting
  changes to the server straight away.

You can also arrive in editing by choosing **Edit this feature** on a selected feature or in the
right-click menu.

Everything you change is saved automatically as a draft. The bar shows the state next to the
title. There is no Save button.

### The tool bar

While editing, a bar of tools appears under the map bar:

| Tool | Key | What it is for |
| --- | --- | --- |
| **Select** | V | Pick features and move them. This is the default. |
| **Marker** | M | Place markers. |
| **Path** | P | Draw rivers, roads and other lines. |
| **Zone** | Z | Draw kingdoms, lakes and other areas. |
| **Find areas** | F | Make zones from your picture ([section 17](#17-find-areas-zones-from-your-picture)). Needs a map image. |
| **Find paths** | D | Make rivers, routes and traced lines ([section 19](#19-find-paths-rivers-routes-and-traced-lines)). Flat maps only. |
| **Suggest biomes** | B | Propose biome zones ([section 20](#20-suggest-biomes)). Flat maps with a picture or height map. |
| **Label** | W | Write words on the map. |
| **Measure** | R | Measure a distance ([section 15](#15-measuring-and-scale)). Not on schematic maps. |
| **Place with AI** | G | Ask the AI to propose places ([section 9](#9-generating-names-and-places-with-ai)). Only when AI is set up. |

A tool that cannot be used right now is greyed out, and hovering shows why ("Find areas needs a map
image", "Find paths works on flat maps for now", and so on).

At the right of the tool bar:

| Control | What it does |
| --- | --- |
| **Snapping** (magnet) | Turns snapping on or off. Key **S**. Its tooltip says what it snaps to. |
| **Snap to** (small arrow beside the magnet) | Menu to choose what snapping snaps to: **Paths**, **Zones**, **Markers & labels**. |
| **Select several** | Phone: turns on "tap to pick several" ([section 13](#13-groups-and-selecting-several-things)). |
| **Undo** and **Redo** | Take back or redo the last change. |

### Undo and redo

**Ctrl+Z** (⌘Z on a Mac) undoes the last change; **Shift+Ctrl+Z** or **Ctrl+Y** redoes it. One
undo takes back one whole action: a drawn path, a dragged zone, a deleted group. You can undo as far
back as you have been working on the open map. Undo works while the map has the focus; inside a text
box it undoes your typing instead.

### The hint line

A line of instructions appears over the map for the tool you are using, and changes as you go. For
example, while drawing a path on a computer: "Click to add points · Double-click or Enter to finish
· Esc to cancel", and "Drawing into *Roads*" so you always know which layer the new feature will
land in. On a phone it says "Tap to add points. Tap the last point again to finish."

### Pressing Esc

**Esc** steps back one thing at a time, so you never lose more than you meant to:

1. closes the box you were marking for a focus;
2. cancels the path or zone you are drawing (the tool stays);
3. switches from another tool back to Select;
4. lets go of a picked corner;
5. lets go of several picked features;
6. steps out from inside a group to the group;
7. deselects the selected feature.

### The right-click menu while editing

On empty map:

* **Add a marker here**
* **Start a path here**
* **Start a zone here**

On a feature:

| Item | What it does |
| --- | --- |
| **Edit in the side bar** | Opens its Edit feature tab. |
| **Make it curved** / **Make it straight** | (Paths and zones) switches all its shapes. Key **C**. |
| **Branch a path from here** | (Paths) starts a new path that begins on this one at the spot you clicked ([section 10](#10-changing-shapes-corners-curves-snapping-and-joins)). |
| **Path style** / **Zone style** | A submenu listing your styles; choose one, or **None**. |
| **Move to layer** | A submenu of the map's layers. |
| **Bring forward** / **Send back** | Changes which of its kind is drawn on top, within its layer. |
| **Delete** | Removes the feature. |

On a corner of the selected path or zone:

* **Remove this point** (greyed out with the reason if the shape is already at its minimum: a path
  needs at least 2 points, a zone at least 3).

On the "+" between two corners:

* **Add a point here**

---

## 6. Markers, paths, zones and labels

### Place a marker

1. Press **Marker** in the tool bar (or **M**).
2. Click (or tap) where the marker goes.

The marker appears in the layer shown in the hint ("Drawing into Cities"). Its **Edit feature**
tab opens straight away so you can link it to an entry or name it. The Marker tool stays on, so you
can place a whole row of towns one after the other. Press **Esc** when you are done.

By default a marker is a plain dot in its layer's colour. To give it an icon, see
[the icon picker](#choosing-a-marker-icon).

### Draw a path

1. Press **Path** (or **P**).
2. Choose **Straight** or **Curved** in the hint line (or press **C**). Straight lines go from
   point to point; Curved draws a smooth line through the points. The choice is remembered on this
   device.
3. Click (or tap) to add points. A faint line follows your pointer from the last point, showing
   what the next click would make.
4. To finish, do one of: **double-click**; press **Enter**; press the **Finish path** button in the
   hint line; or click (tap) the last point again.

A path needs at least two points. **Finish path** and Enter do nothing, and the button says why, until
you have placed enough.

Made a mistake? Press **Delete** or **Backspace** while drawing to take back the last point. Press
**Esc** to cancel the whole path.

When the path is finished it is selected and the tool switches back to Select so you can adjust it
at once.

### Draw a zone

The Zone tool works exactly like the Path tool (**Z**), with these differences:

* A zone needs at least **three** points and is closed for you: the last point joins back to the
  first. The finish button says **Finish zone**.
* In the hint line there is a **biome picker**. Leave it on **No biome** for an ordinary zone. If
  you pick a biome, the new zone is made as a **biome zone**: it goes into a layer called
  **Biomes**, takes that biome's colour and pattern, and carries its meaning
  ([section 16](#16-biomes)).

### Write a label

1. Press **Label** (or **W**).
2. Click where the words should go.

A label starts with the word **Label** already selected in its **Words** box. Type over it. Like
markers, the Label tool stays on until you press **Esc**.

A label's own options (in the Edit feature tab) are:

| Option | What it does |
| --- | --- |
| **Words** | What the label says. It cannot be empty. |
| **Size** | 6 to 160. |
| **Colour** | Click the swatch and pick any colour. |
| **Turn** | Rotates the words, from -180 to 180 degrees. Handy for following a river or coast. |
| **Letter spacing** | Opens the letters out; good for long sea and region names. |

A label is just words. If you want a name on the map that is tied to an entry, give a marker, path
or zone an entry or a Label, or give a [group](#13-groups-and-selecting-several-things) a name.

### Choosing a marker icon

In a marker's Edit feature tab, under **Icon**:

* The first button, **A plain dot**, removes any icon.
* If the map lists more than one **Marker set**, a drop-down chooses which set's icons you see.
* Click an icon to use it. Hover to read its name.

The sets available come from the folders of icons in your library. A map only offers the sets it
lists.

---

## 7. The Edit feature panel

Select a feature while editing (with the Select tool, or straight after placing it with the
Marker, Label or other tools) and the **Edit feature** tab opens in the side bar. On a phone it is
the bottom sheet.

What you see depends on the kind of feature. Here are all the fields.

| Field | For | What it does |
| --- | --- | --- |
| **Entry** | all but labels (labels use **Words**) | The entry this feature stands for ([section 8](#8-linking-a-feature-to-an-entry)). |
| **Label** | markers, paths, zones | A name for the feature on the map, shown **instead of the entry's name**. Leave it empty to use the entry's title. |
| **Generate** | all (when AI is set up) | Proposes a name and description ([section 9](#9-generating-names-and-places-with-ai)). |
| **Layer** | all | Moves the feature to another layer. |
| **A map of this place** | all | Link another map: a city marker can open the map of that city. Choose it from the list; type to narrow it. |
| **Line: Straight / Curved** | paths and zones | Drawn as straight stretches or a smooth curve. Applies to all of its shapes. |
| **Path style** / **Zone style** | paths and zones | Choose one of your library's styles, or **None**. **Edit styles…** opens the Styles tab. If the chosen style has since been deleted, the field says **Style: deleted**. |
| **Biome** | zones | Choose what kind of ground this zone is ([section 16](#16-biomes)). |
| **Length** | paths | The length of the path, if the map has a scale (not shown on schematic maps). |
| **Show steepness** | paths with steep climbs | Chevrons (arrow marks) on the steep stretches, pointing uphill. Appears on routes made by Find paths. |
| **Icon** | markers | See [Choosing a marker icon](#choosing-a-marker-icon). |
| **Order** | all | **Bring forward** and **Send back** among features of the same kind in the same layer. |
| **Time** | all (when time is on) | Tie the feature to a span in a chronicle, and give it later shapes ([section 22](#22-maps-in-time)). |
| **Revolves** | markers on a flat map | Make a marker circle another one as the years pass ([section 23](#23-globes-other-views-layers-beneath-and-schematic-maps)). |
| **Group** | members of a group | Which group it belongs to ([section 13](#13-groups-and-selecting-several-things)). |
| **Remove this point** | a selected corner | Removes the picked corner of a path or zone. |
| **Delete** | all | Deletes the feature. |

The **✕** at the top closes the panel and deselects.

---

## 8. Linking a feature to an entry

Linking is what makes a map more than a drawing. A linked feature shows the entry's title as its
name, previews its text when hovered, opens the entry from the Selected card, and makes the entry
list the map under "appears on maps".

### Link to an entry that already exists

1. Select the feature while editing.
2. In **Entry**, open the list. Start typing the entry's title to narrow it.
3. Choose the entry. To undo the link, choose **None**.

The name that appears on the map is now the entry's title. If you want a different name just for
this map, type it in **Label**; the label wins over the entry's name.

If something stops the link (for example the entry is a protected file), the map shows a notice such
as "Not linked: …" with the reason, and the feature is left unlinked. The rest of your work is kept.

### Make a new entry from the map

If you type a name in the **Entry** box that no entry has, the list offers to make it. Choosing it
opens the **New entry** dialog, pre-filled with:

* **The name** you typed.
* **The folder** where entries like it already live on this map: the folder holding most of the
  entries linked to features of the same kind, or else any kind, or else the top of the library.
  You can change it.
* **The type** that the folder gives its entries.

Press **Make and link the entry**. The entry is created and linked in one step. It is saved like
any entry made in the editor, including while offline. If an entry already exists at that path,
Frontier links it instead of making a duplicate.

### A map of this place

Besides an entry, a feature can open another **map**. Use this for a world map whose cities each
open their own city map. Pick it in **A map of this place**. In viewing, the Selected card then
offers **Open the map of this place**. When time is on, the year and chronicle come with you.

---

## 9. Generating names and places with AI

These features appear only when an AI model has been set up in Settings. They send what is around
the spot (nearby entries and names) to the model, and read from your library so that proposals fit
your lore. Nothing is kept until you accept it.

### Generate a name and description for one feature

In the Edit feature tab of a marker, path or zone, the **Generate** box proposes **a name and
description**.

* **Surprise me** makes a proposal from the surroundings and your lore.
* **Describe it…** lets you say what you want ("A ruined watchtower held by smugglers"); then press
  **Propose**.

A preview appears with the proposed name, the look it chose (a style or an icon) and a description,
and a line **Grown from** naming the entries it used. Then:

* **Use this** puts the name into the feature's **Label** and applies the look.
* **Discard** throws the proposal away.

After you use a proposal on a feature that has no entry, a button offers **Make an entry for
"*name*"…**, which opens the New entry dialog with the description as the entry's first text.

### Place with AI

The **Place with AI** tool (**G**) fills an area with markers.

1. Press **Place with AI**.
2. Click once for a single spot, or click three or more points around an area. (Marked points are
   cleared with **Clear the spot**.)
3. A **Place with AI** tab opens. Optionally type **What to place** ("Fishing villages along the
   coast"), and choose **How many**, from 1 to 5.
4. Press **Propose**.

Each proposal appears on the map as a dashed pin with its name, and in the list with a description.
Click a pin or a name to see which is which. For each one choose:

* **Place**: puts a real marker there, with the proposed name and look, in the current layer.
* **Discard**: removes the proposal.

Proposals that you leave unplaced are only previews and vanish when you leave the tool. A placed
marker keeps the name and look but not the description; to give it a full entry, select it and use
**Generate** or the Entry box.

If the map is being seen at a particular year, proposals are written to fit that moment.

---

## 10. Changing shapes: corners, curves, snapping and joins

### Select and move

With the **Select** tool, click a feature to select it. Only the selected feature can be dragged:

| To | Do this |
| --- | --- |
| Move a marker or label | Press on it and drag. |
| Move a whole zone | Press inside the selected zone and drag. |
| Move one corner | Press on the corner (a small square) and drag. |
| Add a corner | Drag a **+** handle (one sits in the middle of each stretch). Or click the **+**, or right-click it and choose **Add a point here**. |
| Remove a corner | Click the corner to pick it, then press **Delete**, or press **Remove this point** in the panel, or right-click it and choose **Remove this point**. |

Pressing and dragging on unselected map always pans the map, so you can never move something by
accident. A path needs at least 2 points and a zone at least 3; below that Frontier says why it
will not remove one more.

Corners that are very close together on screen hide their **+** handles, so zoom in to reach them.
With a finger, handles are larger and appear only on longer stretches.

### Curves

By default paths and zones are straight from point to point. A **curved** path or zone is drawn as a
smooth line passing through its points. You choose:

* **Before drawing:** the **Straight / Curved** switch in the hint line.
* **For a finished feature:** the **Line** switch in its Edit feature tab, or press **C**, or use the
  right-click menu's **Make it curved** / **Make it straight**.

Curving a feature changes how it looks, not where its points are, so you can switch back and forth
without losing anything.

### Snapping

With snapping on, a point you place or drag **lands on a corner or an edge** of another path or zone
that is close to it on screen, so two borders can share exactly the same line and a road can end
exactly on a river. A coastline traced once as a zone can be snapped to afterwards.

* Turn snapping on or off with the magnet in the tool bar, or press **S**. It is on by default and
  remembered on your device.
* Choose **what** it snaps to with the **Snap to** menu: **Paths**, **Zones**, **Markers & labels**.
  All three are on at first.
* To place one point freely without turning snapping off, **hold Alt** while you click or drag.

### Joined paths

When snapping to paths is on and a new path starts or ends on another path, the two are **joined**:
a shared corner is put into the other path at that spot, and Frontier remembers that the new path
hangs from the old. After that:

* Moving the shared corner moves both paths.
* Moving or reshaping the other path keeps the joined end attached.
* Deleting the shared corner lets the join go.

Rivers never cross rivers: a new river that reaches a river already on the map stops on it, as a
tributary.

If you give a path a style that counts as **Road** (see [section 14](#14-styles-and-the-legend)), and
it crosses other roads, it gets a crossing corner on each road it meets, so Find paths and Explore
see a crossroads there.

### Branches

To start a new path off an existing one: right-click the path where you want the branch to leave,
and choose **Branch a path from here**. The Path tool starts with its first point on the nearest
spot of that path. Click the rest and finish; with snapping to paths on, the branch is joined to the
path.

### Order of drawing

Within a layer, features of one kind are drawn in the order they were made, later on top.
**Bring forward** and **Send back** (in the panel or the right-click menu) change that. Layers
themselves are drawn in the order of the Layers tab ([section 11](#11-layers)).

### Deleting

* Select the feature and press **Delete** or **Backspace**, or press the **Delete** button in its
  panel, or use the right-click menu.
* Deleting a feature in a **locked layer** is refused: "It is in a locked layer."
* Deleting a group deletes all its members.

Undo brings it all back.

---

## 11. Layers

Layers are how you keep a busy map tidy. Put towns in one, roads in another, realms in a third; then
hide, lock or recolour each as one.

Open the **Layers** tab with the **Layers** button in the map bar, or press **L**. The Layers list
is below the legend and (while editing) the **This map** box and the images.

### The layer tree

Layers are shown as a **tree**, like the layers panel in a drawing program. Each row is a layer,
with:

* A little arrow to open or close it (if it holds features or sublayers).
* A **colour swatch** (click it to change the colour while editing).
* Its **name** (double-click to rename while editing).
* A **number**: how many features it holds.
* An **eye** to hide or show it.
* While editing: a **lock**, a **Properties** gear, a **trash** can and a **⋯** menu.

Open a layer to see its features (and groups) listed under it. Click a feature in the list to
select it on the map and centre the map on it. Long lists show **Show N more** at the end when there are many features.

Rows are in **drawing order**: lower rows are drawn over higher ones.

If a layer is called **Biomes** and is first in the list, it shows a small note, **drawn under the
rest**: biome zones go there so they lie under your roads and towns.

### Which layer new features go into

While editing, the layer with the highlight is the **current layer**. New features land in it (the
hint line says "Drawing into …"). Click a layer's row to make it current.

### Layer actions

Right-click a layer row, or use its **⋯** menu:

| Action | What it does |
| --- | --- |
| **Add a sublayer** | Makes a layer inside this one. |
| **Rename** (F2) | Types a new name in place. |
| **Properties…** | A dialog: **Name**, **Colour**, **Inside** (which layer it sits in, or **Nothing: the top level**), **Shown when the map opens**, and **Locked**. |
| **Move up** / **Move down** | Changes drawing order among its neighbours. |
| **Move into…** | Puts this layer inside another one. |
| **Move to the top level** | Takes it out of its parent layer. |
| **Lock** / **Unlock** | A locked layer is shown but its features cannot be picked, dragged or deleted on the map. Sublayers inherit the lock. |
| **Delete *name*** | Removes the layer. |

You can also **drag** rows by their grip to reorder them, move them inside another layer, or drag a
feature to a different layer.

Pressing **Add a layer** (the **+** in the Layers heading) makes a new top-level layer.

When you delete a layer that holds features, Frontier asks what to do: **Move them to** another
layer, or **Delete them too**. Its sublayers stay, taking its place. A map always keeps at least
one layer, so the last layer cannot be deleted.

### Hiding and what is hidden

The eye hides a layer and **everything inside it**, including its sublayers and groups. A hidden
feature (its own eye) is also not drawn, not clickable and ignored by tools that look at drawn
features. A dimmed eye on a row means it is hidden because something above it is hidden.

### Open the map like this

At the bottom of the tab, while editing, **Open the map like this** records which layers and images
are shown right now as the way the map opens for everyone. Without it, your hiding and showing is
only for your visit and is kept in the web address.

### Keyboard in the tree

Click a row and use the arrow keys to move, **Right**/**Left** to open and close, **Home**/**End**
to jump, **Enter** or **Space** to pick, **F2** to rename, and **Shift** or **Ctrl/⌘** with a click to
pick several features.

---

## 12. Images on a map

A map can show more than one image. Typical uses: a political map, a satellite view and a
height-shaded version of the same land, laid over each other. They are drawn in order, a later one
over an earlier one.

In the Layers tab, **Images** lists them (the list is shown while editing, or while viewing a map
that has more than one).

* The **tick-box** shows or hides each image.
* While editing you can rename one (**Image name**), reorder with the arrows (**Move *name* up** /
  **Move *name* down**), and take one off the map (**⋯ → Take *name* off the map**: the file stays
  in your library; a map must keep at least one image).
* **Add an image…** opens the [image dialog](#the-image-dialog) to add another picture. It is added
  covering the whole map and shown.
* The **locate** button (**Place *name***) opens four boxes that say where the image sits:
  **Left, Top, Right, Bottom** on a flat map, or **West, South, East, North** on a globe (degrees).
  Use it for a picture of just part of the world. **The whole map** (or **The whole globe**) sets it
  back to covering everything. Frontier refuses numbers that make no sense (such as the west edge
  being east of the east edge) and says why.

A globe's image should not run across the 180-degree line; split such a picture into two.

---

## 13. Groups and selecting several things

A **group** is one place drawn as several shapes. A realm made of three islands is three zones; group
them and "Aldmere" becomes one thing you can name, link to an entry, style, move, hide and write on the
map.

Groups sit inside one layer, are never nested, and a feature can be in only one group.

### Make a group

On a computer:

1. With the Select tool, click one feature, then **Shift-click** (or **Ctrl/⌘-click**) the others. You
   can also do this in the Layers tab.
2. Press **Ctrl+G** (⌘G on a Mac), or press **Group** in the **N selected** tab.

On a phone:

1. Press **Select several** in the tool bar (or choose **Group with…** from a feature's Group
   field).
2. Tap each feature. A strip over the map counts them ("3 picked").
3. Press **Group**. **Cancel** drops the picks.

Grouping a feature that is in another layer moves them into one layer, and Frontier tells you which
were moved. If one of the picks is already a group, the others join it (the button reads **Add to
*name***).

### Working with a group

Click any piece and the whole group is selected: all members show the selection outline, a dashed box
surrounds them, and the **Edit group** tab opens. Drag any piece of a selected group to move the
whole group.

To work on one member:

* **Double-click** it, or press **Enter** with the group selected (goes to the first member), or click
  a name in the panel's **Members** list.
* Esc steps back out to the group (or click the crumb at the top of the member's panel).

The Edit group tab has:

| Field | What it does |
| --- | --- |
| **Name** | The group's name. Shown instead of the entry's name if both are set. |
| **Entry** | The entry the group stands for. |
| **Name on the map** | **Write the name on the map** writes it once across the group. **Placement** is **Automatic** (the middle of the largest piece) or **Where I put it** (drag the name on the map to place it yourself). Also **Size**, **Colour** (**From the zones**, or pick one), **Turn** and **Letter spacing**. The panel says whether the name is shown or hidden at this zoom: zoom in to show it. |
| **Zone style** | Gives all the group's zones one style at once. |
| **Layer** | Moves the group and all its members. |
| **Members** | The list; **Take *name* out of the group** removes one. A group left with one member dissolves. |
| **A map of this place** | A map opened from the whole group. |
| **When it exists** | (When time is on) Choose a span for the group. |
| **Locked** | Its members cannot be picked on the map. |
| **Ungroup** (Shift+Ctrl+G) | Dissolves the group; the features stay. |
| **Delete all *N*** | Deletes the group and every member. |

A member of a group has a **Group** field in its own panel: change its group, choose **None** to take it
out, or **Group with…** to start a new group with it.

In viewing, a group's card shows its name, its entry's opening, **Open the entry**, **Edit this group**
and its members.

### Selecting several without grouping

Pick several features the same way (Shift or Ctrl/⌘-click; or **Select several** on a phone). The side
bar shows **N selected**: the list, **Group** (or **Add to *name***), and **Delete *N***. You can also
pick several in the Layers tab.

---

## 14. Styles and the legend

A **style** is a saved look for a **path** or a **zone**: colour, thickness, dashes and (for zones)
how strongly the area is filled. A style is kept **once for the whole library**, so changing "River"
changes every river on every map. Without a style, a path or zone takes its layer's colour.

### The Styles tab

While editing, a **Styles** tab is available in the side bar (it appears beside **Layers**). It lists
**Path styles**, **Zone styles** and **Biomes** (see [section 16](#16-biomes)). A note at the top
reminds you: "Styles are kept for the whole library: a change shows on every map."

If the library has no styles yet, press **Add the usual styles**. Frontier adds a starter set:

| Starter style | For | Counts as |
| --- | --- | --- |
| **River** | Path | River |
| **Road** | Path | Road |
| **Border** | Path (dash and dot) | nothing |
| **Realm** | Zone | nothing |
| **Forest** | Zone | Forest |
| **Water** | Zone | Water |
| **Marsh** | Zone | Marsh |
| **Mountains** | Zone | Mountains |

### Make, change and delete a style

* **Add a path style** / **Add a zone style** makes a new one and opens its form.
* Each style has a sample line, its name, and a **⋯** menu: **Edit**, **Rename**, **Delete**.
* Deleting asks for no confirmation but offers **Undo** in the pop-up message. After the undo window,
  any feature that used it simply falls back to its layer's colour and its panel says **Style:
  deleted**.
* Every change is saved at once and every open map shows it.

The style form:

| Field | What it does |
| --- | --- |
| **Name** | At most 60 letters. Two styles of the same kind cannot share a name; the form tells you. |
| **Colour** | **The layer's colour** (the first swatch: the feature takes its layer's colour), one of eight named colours (Blue, Teal, Green, Gold, Brown, Red, Plum, Slate), or **A colour of its own** to pick any. |
| **Width** | From 0.5 to 12 pixels. |
| **Line** | **Solid**, **Dashed**, **Long dashes**, or **Dash and dot**. |
| **Fill** | (Zones) How strongly the area is tinted: 0 to 80 percent. |
| **Counts as** | What the style means to the tools that read the map: for paths, **River** or **Road**; for zones, **Water**, **Forest**, **Marsh**, **Mountains**, or **Nothing**. See below. |

### What "Counts as" does

"Counts as" teaches Frontier what your drawing means:

* **Find paths** reads it: a river is in a traveller's way, a road is quicker, forest slows, water blocks.
* **Terrain** and **Find paths** treat a zone that counts as Mountains, Water, Forest or Marsh as
  evidence of the lay of the land, which improves its guesses at once.
* **Explore** recognises roads and rivers by it.

A style you rename keeps its meaning; the starter styles count as shown in the table even if you never
open the form.

### Give a feature a style

Select a path or zone, then choose it in **Path style** / **Zone style** in the Edit feature tab, or
right-click and use the **Path style** / **Zone style** submenu.

### The legend

At the top of the Layers tab, **Legend** shows each style that is used by something drawn **right now**
(in layers you have shown, and, if time is on, present at the year shown), each with a sample drawn
exactly as on the map and its name. Styles that use the layer's colour say **in its layer's
colour**. If biome zones are drawn, a **Biomes** list follows (see
[section 16](#16-biomes)). The style legend is not drawn onto saved pictures; the biome legend can
be.

---

## 15. Measuring and scale

### Measure a distance

1. Press **Measure** (**R**). It is not offered on schematic maps.
2. Click two or more points along the route you want to measure.

The hint line shows the length as you go. On a flat map with a scale it is "123 km". Without a
scale it is "420 map units". On a globe it gives the distance (if you have set the radius), the angle
in degrees, and "% of the way round".

**Clear** wipes the measurement. Paths follow great circles on a globe, so a long measured line
curves the way a real route would.

The measuring line is only a measurement. It is not a feature and is not saved. Press **Esc** or choose
another tool to stop.

### Tell Frontier the size of your world

Frontier can only give distances in your units once it knows the size.

* **A flat map:** measure a line whose real length you know (the width of a lake, a day's march), then
  press **Set the scale from this line** and type its true length (in the map's unit, such as km). From
  then on every distance on the map, every path's **Length**, and Find paths' travel times follow
  from it.
* **A globe:** press **Set the radius** in the Measure hint, and type the world's radius ("The size
  of this world"). Leave it empty if you do not know it. You will still see angles.

### Where the size matters

Without a scale, Find paths still works, but lengths and times are not given; Explore cannot offer
"a day's travel" stops; and the Terrain dialog says that slopes are relative. Setting a scale makes
these tools more useful.

---

## 16. Biomes

A **biome** says what kind of ground a zone is. Draw a zone, give it the biome **Desert (sand)**, and
Frontier knows three more things beyond the colour: the zone gets a **pattern** (small drawn marks
such as dunes or trees) so readers see it is a desert; it **slows or stops** travellers differently
(Find paths reads it); and it changes what **rivers** do in it (they dry up in sand, spread out in
marsh). Explore also reads it, so what the AI invents there fits the ground.

### The built-in biomes

Fifteen built-in biomes, grouped as they appear in the picker:

| Group | Biomes |
| --- | --- |
| **Water** | Ocean / sea · Coast / beach |
| **Cold** | Ice / glacier · Tundra · Taiga / boreal forest |
| **Temperate** | Temperate forest · Grassland / steppe · Scrubland · Wetland / marsh |
| **Warm** | Rainforest / jungle · Savanna · Desert (sand) · Desert (rock) |
| **High** | Mountains / alpine · Volcanic / wasteland |

### Give a zone a biome

* **While drawing:** choose a biome in the picker in the Zone tool's hint line. New zones are made
  as biome zones in the **Biomes** layer (made for you, and placed first so it is drawn under
  everything else).
* **On an existing zone:** select it and open the **Biome** field in its Edit feature tab. It also
  has a tick-box **Draw its pattern** and shows what the biome means ("On foot 0.6× · horse 0.55× ·
  cart 0.35× · rivers lose water and can dry out") and the words Explore will use.
* **From Find areas** and **Suggest biomes**: both can make biome zones directly.

The **biome picker** is a drop-down list grouped as above. Type in **Find a biome** to narrow it. Each
row shows a small swatch with the pattern and, on the right, the cart speed. Choosing **No biome**
removes it. On a phone the list opens as a sheet at the bottom of the screen.

When a zone gets a biome and has no style, Frontier gives it the biome's usual style, adding that
style to your library the first time. The style supplies the colour and edge; the biome supplies the
pattern and the meaning. If a zone already has a style you chose, it keeps it.

### Your own biomes

In the **Styles** tab, the **Biomes** section lists the fifteen built-in biomes (**Built-in biomes**,
with each cart speed) and, under **Made by you**, any you have made. Press **New biome** to make
one, for example the Blightlands. Its form:

| Field | What it does |
| --- | --- |
| **Name** | Required, and unique. |
| **Behaves like** | Which built-in biome it starts from. |
| **Pattern** | One of sixteen drawn patterns, or **No pattern**. |
| **Colour of new zones** | The colour new zones of this biome get. |
| **Speed, times open ground (0: no way)** | **On foot**, **Horse**, **Cart**: a multiple of the speed on open ground, 0 to 3. Zero means no way through. |
| **Rivers** | What rivers do here: normal, dry out, spread into marsh, or start here ("wetter"). |
| **Explore reads** | A short phrase for Explore and the AI ("in the Blightlands"). |

Anything you leave alone follows the biome it is "like". **Reset to *biome*** puts everything back.
Delete a biome from its **⋯** menu; its zones keep their colour but lose its meaning, and an **Undo**
is offered.

**Add the usual biomes** (shown when some are missing) adds a zone style for every built-in biome so new
biome zones look right straight away.

### The biome legend and how biomes are shown

When biome zones are drawn, a **Biomes** card is shown at a corner of the map, listing each biome in
view with its colour and pattern (on a phone, the card starts folded; tap its heading to open it). The
Layers tab has the same **Biomes** list, plus three tick-boxes that apply to this device only:

| Option | What it does |
| --- | --- |
| **Patterns** | Draw the biome patterns over the zones. |
| **Soft edges** | Blur the edges of neighbouring biome fills into each other, like a painted map. Off at first. |
| **Legend on the map** | Show or hide the card on the map. When it is shown, saved pictures include it. |

Hovering a biome zone in viewing shows its biome and what it means for travel and rivers.

---

## 17. Find areas: zones from your picture

Tracing a coastline point by point is slow. **Find areas** reads your picture and finds regions of
similar colour. You point at one, click, and Frontier outlines it as a zone.

It works on any map with an image shown. It reads the picture on your own device and sends nothing
anywhere.

### Make a zone from an area

1. Press **Find areas** (**F**). A bar appears over the map.
2. Move the mouse over the map. The region under the pointer lights up, with a tag such as "+ Add this
   area".
3. **Click** to choose it. Click more areas to add more. Chosen areas are tinted.
4. The bar's status says what would be made ("3 areas → 1 zone · 214 points").
5. Press **Make zone** (or **Enter**). The zone is made in the current layer and selected.

The bar's controls:

| Control | What it does |
| --- | --- |
| **Add** / **Remove** switch | Whether plain clicks add or remove. Press **X** to switch. **Shift-click** always adds; **Alt-click** always removes. |
| **Clear** | Clears the choice (**Esc**). |
| **Add to selected zone** | With a zone selected, merges the chosen areas into it. The bar names it: **Add to "*name*"**. Needs a zone selected, not locked, and something chosen. |
| **Make zone** | Makes zones from the chosen areas. |
| **How alike** (strict … loose) | How different in colour two neighbouring places can be and still count as one area. Raise it ("loose") if an area breaks into specks; lower it ("strict") if two regions run together. |
| **Stop at lines** | Dark lines (borders, coasts, rivers) are walls an area will not cross. On at first. |
| **Ignore text & marks** | Letters, mountain symbols, trees and other small marks are looked past, so a region is not riddled with holes. On at first. If it is off and you click a letter, the tag says "Text or a mark". |
| **Points** (fewer … more) | How many points the outline has. Fewer is simpler to edit; more follows the picture more closely. |
| **New zone in** | The layer the zone goes into. |
| **Zone style** | A style for the new zones, or **The layer's look**. |
| **Biome picker** | Make the zones biome zones. They then go into the **Biomes** layer and the usual look of the biome is used. |

### Good to know

* If your choice is several separate pieces (two islands), you get one zone per piece, and the map says
  so: "Made 2 zones, one for each separate piece. Group them to name them as one." The made zones are
  picked so you can group them straight away ([section 13](#13-groups-and-selecting-several-things)).
* Small holes (a lake inside a continent) are filled; the status counts them ("2 holes filled").
* New outlines snap to the zones beside them when snapping is on, so neighbouring realms share exact borders.
* **Undo** (Ctrl+Z) takes back your last click while the tool is on, and then the changes to the map.
* If you click an area that is already chosen while in Add mode on a phone, Frontier says "Already
  chosen. Switch to Remove to take it away."
* The bar says **Find areas needs a map image** if no image is shown. Show an image in the Layers tab first.
* On a phone the options fold under an **Options** button.

---

## 18. Terrain: a height map for your world

Real rivers run downhill and real roads avoid cliffs. For Find paths, Suggest biomes and Relief to know
about hills and valleys, Frontier needs to know the heights. A **height map** is a grey picture of the
same land: **brighter is higher** (or the other way round, you choose).

Terrain is for **flat maps with a picture**. It is not offered on globes or on schematic maps.

### Without a height map

You do not have to have one. Frontier **guesses** the terrain from your picture: blue-grey areas are sea
and lakes, green areas forest, dense mountain drawings high ground. Zones and paths you have drawn in
styles that "count as" Water, Forest, Marsh, Mountains or River sharpen the guess at once. The guess is
good enough for routes and for tracing lines, but **rivers are rough**: they tend to run straight to
the nearest coast and miss real valleys. Tools that use terrain say so ("Terrain guessed from the
picture") and made paths carry a note.

### Open the Terrain dialog

Any of these opens it:

* **⋯ More actions → Terrain…** (while editing)
* In the Layers tab, the **Terrain** section: **Add a height map…**, **Build it…**, **Adjust…** or **Build
  again** (it changes with the state of your terrain)
* The **Terrain · *name*** chip over the map (while editing)
* The terrain button in the Find paths or Suggest biomes bar

### If you have no height map yet

The dialog offers three ways forward:

1. **Build one from the picture: Find hints.** Frontier looks at the painted map for what tells height
   (sea and coast, rivers and which way they flow, mountain symbols and where they are drawn largest,
   lakes and marsh), marks each as a **hint** you can accept, move or change, lets you draw your own,
   and then builds a height map that agrees with them. This all happens on your device and nothing
   changes on the map until you press **Use**. See [Building from hints](#building-a-height-map-from-hints).
2. **Or use a height map you have: Choose a height map…** Programs such as Wonderdraft, Azgaar's
   generator and Gaea can save one, as can most paint programs. Choose it in the image dialog.
3. **Until then, Find paths guesses.** The dialog lists what you have drawn that already counts as
   terrain ("2 zones count as Mountains").

### If you have a height map

After choosing one, the dialog shows your height map over the map, with a button row **Heights /
Relief / Contours** (how to draw it: as grey, as light and shade, or as lines of equal height), a
**Strength** slider, and **Show flooding** to see what the sea level covers. A **Coast match** badge
says how well the height map's shoreline agrees with your painted coast.

On a computer, the settings are listed together; on a phone they come as steps (**Image**, **Line
up**, **Sea**, **Heights**, **Check**) with **Back** and **Next**.

| Part | What it does |
| --- | --- |
| **Height map** | Shows the file name. **Replace…** picks another. **White is high** / **Black is high** says which way up it is. Frontier tells you if it looks upside down. |
| **Line it up** | Moves the height map to lie exactly over your picture. **Line up for me** slides and resizes it to fit the coast best. **Move by hand** lets you drag it (arrows move it, +/- resize it, 0 resets it); on a phone drag with a finger. **Match two points…** asks you to click a place on the height map and the same place on the picture, twice, far apart. **Put it back over the whole map** resets. **Exact position** has four number boxes: **Left, Top, Right, Bottom**. |
| **Sea level** | A slider (lower … higher). By default Frontier sets it so the height map's coast matches your picture's coast. The text shows what moving it would flood or leave dry. **Match the picture's coast** puts it back. |
| **Real heights and smoothing** | Tell Frontier what the black and white really are (for example black is 0 m and white is 4000 m, in **m** or **ft** or the map's own unit). Without them, heights are relative: fine for rivers, rough for travel times. Real heights plus a map scale make slopes and travel times real. **Smoothing** (None, Light, Medium, Strong, Very strong) removes noise. |
| **Check** | A list of checks with advice: how well it lines up, whether it looks upside down, how many tiny hollows or flat steps it has, how much of the map it covers. |

Press **Done** to use it (with an **Undo** in the pop-up message) or **Cancel**. **Remove terrain** takes it
off the map again; the image stays in your library.

### Show relief

Once a map has terrain, a small **Relief** button at the corner of the map (and a **Relief** tick-box in
the Terrain section of the Layers tab, or **H**) draws the terrain in use as soft light and shade, so
you can see what Frontier believes about your land. Relief is a view only and is remembered on this
device.

### Building a height map from hints

This is the part for a map with a painted picture and no height map. Press **Find hints** in the
Terrain dialog (or **Build again** / **Adjust…** if you built one before). A larger workspace opens with
your picture, a toolbar, and two tabs: **Hints** and **Build**.

**What a hint is.** A hint is one thing Frontier believes about the land: a sea, a coast, a lake, a river
(with the direction it flows), a highland, a ridge, a peak, a marsh, a road, and so on. Each found hint
has a confidence. Hints at 70% or more start **in use**; weaker ones **wait for you**. Hints that come
from your own drawn zones and paths (by what their styles count as) say **From your map** and move
with the feature.

**Reviewing hints.**

* Hints are drawn over the picture in their own marks: rivers with arrows downstream, ridges with teeth,
  peaks as triangles, and so on. Waiting hints are dashed and faint with a "?" tag.
* Click a hint on the map or in the list to select it. Drag it to move it, or drag one of its handles to
  move a point.
* The selected hint's panel says what it is, why Frontier thinks so, and gives controls: a **Height**
  slider, **From** / **To** for highlands, **Flows the other way**, **High side the other way**, how
  strongly it **Holds**, **Accept**, **Reject**, **Put back** and, for your own, **Delete**.
* The **Hints** tab summarises ("15 hints in use, 3 waiting for you"), and offers **Accept the likely
  ones**, **Next suggestion** (**N**), **Find again** (looks at the picture afresh; your own hints and
  changes stay), a list by kind with ✓ and ✕ for the whole kind, and a **Not used** note for things it
  noticed but cannot use (forests say nothing about height).

**Drawing your own hints.** The strip of tools: **Select** (V), **Peak** (P), **Hollow** (O), **Ridge** (R),
**Valley** (Y), **Cliff** (C), **Zone** (Z) with a choice of **Highland**, **Lowland**, **Plain** or **Marsh**,
and **Undo** / **Redo**. A peak or hollow is one click; a ridge, valley or cliff is clicked point by point
and finished with a click on the last point, a double-click or **Enter**; a zone is finished on its first
point, a double-click or **Enter**. **Esc** stops. The line above the toolbar says what the next click does.

**Seeing it.** **Picture / Heights / Relief / Contours** switch the view (keys 1 to 4; Heights, Relief
and Contours are available once you have built one), **Hints** (H) shows or hides the marks, and
**Strength** blends the heights over the picture.

**Building it.** Open the **Build** tab:

| Control | What it does |
| --- | --- |
| **Roughness** (smooth … rugged) | How bumpy the land is. |
| **Mountain sharpness** (rounded … jagged) | The shape of the mountains. |
| **Erosion** (none … old, worn land) | How worn down it is. |
| **Detail**: **Draft**, **Normal**, **Fine** | How finely it is built. Draft is quick, Fine is slow. |
| **Variation** + **Another one** (S) | The same hints with different natural detail. |
| **Carve rivers so they drain** | Cuts the rivers' valleys so water flows along them to the sea. |
| **Keep lakes as hollows** | Makes lakes into basins. |
| **Highest point** and **Unit** | Optional: the height of the highest peak, to make slopes and travel times real. |
| **Build height map** | Builds it. It reads **Up to date** when nothing has changed. |
| **Save as PNG** | Downloads the built height as a grey image you can open in a paint program. |

Checks list whether the coast lines up, whether rivers drain correctly, whether lakes hold water and
whether peaks reach their heights.

Press **Use this height map** to put it on the map; the map's Terrain section then says **generated**
and, if you later change the hints, **Hints changed since it was built** with a **Build again** button.
If you are offline the button reads **Keep the hints**: the hints are kept and you can build and use
them when you are back online.

---

## 19. Find paths: rivers, routes and traced lines

**Find paths** draws a line for you: a river that runs downhill to the sea, the quickest route
between two towns, or a painted line in your picture turned into a real path. Flat maps only.

It needs a map image shown, or a height map. On a schematic map with no picture it says **Find paths
needs a map image**. (A schematic diagram still works for **Trace** if you give it a picture.) It
reads the picture and the terrain on your device and sends nothing anywhere.

### The basic steps

1. Press **Find paths** (**D**). A bar appears.
2. Choose the **kind of path**: **River** (key **1**), **Route** (**2**) or **Trace** (**3**).
3. Click on the map as the hint says. What would be made is shown with marching dashes.
4. Press **Make path** (or **Enter**). The path is made in the current layer, selected, with its Edit
   feature tab open and its label ready to type over. The tool stays on, so you can make the next.

**Esc** clears what is proposed, then the selection; one more returns you to the Select tool. **Clear**
clears what is proposed too. **Ctrl+Z** takes back your last click, drag, make, add or group.

The bar's status line says what Frontier is doing ("Looking at the picture…", "Working out the
water…") and then describes the proposal. It also says whether the terrain is from your height map
("Terrain from the height map"), built from hints, or guessed from the picture.

### River

* **A click is: From its source / From its mouth** (key **X** switches). From its source: click where the
  river rises and it runs downhill to the sea, a lake, another river or the map's edge. From its
  mouth: click the coast where it comes out, and it is followed uphill along the branch that carries
  the most water.
* **Meander** (straight … winding): how much the river winds. It winds more on flat ground and hardly
  at all in the mountains.
* **Show likely rivers** shades every stream that drains enough land; click one to take it. **Above**
  (small … large, in square kilometres) sets how much land counts. After you make a river, it drops
  out of the likely list, so you can build a river system one click at a time.
* With snapping to paths on, a river that reaches a river already on the map ends **on** it, and the bar
  says "joins *River*".
* **How it ends in the basin.** If a river reaches a hollow with no way out, you choose what happens:
  **Lake drains** (the lake fills and the river carries on from the lowest rim), **Lake keeps the water**
  (the river ends at the shore), **Marsh** (it fans out into an inland delta of fading channels),
  **Sinks underground**, or **Dries out**. One is marked "usual", the best fit for how much land drains
  into it. **Make the lake too** / **Make the marsh too** also makes a zone for the water, in the
  current layer, beside the river.

### Route

* **Click the start, then the end.** Clicking near a marker snaps to it and names it. A third click
  adds a **stop** on the way. **Drag** a stop or an end to move it and the route follows.
  **Alt-click** removes a stop (a route always keeps its two ends).
* **Travelling: On foot, Horse, Cart, Ship.** Each has speeds (hover for the numbers: for example on
  foot, 4 km/h on open land, 2.8 in forest, 5 on a road). Ship is for water; on foot it is allowed to
  walk to the coast. A route that must cross sea offers the ship if there is no other way.
* **Which way: Fastest, Flattest, Avoid water.** Fastest is the least time. Flattest avoids climbing
  even when longer. Avoid water uses bridges only, no fords and no sea. Each button shows how much
  longer or "same" or "none" if no such way exists. Other ways also appear on the map as labelled ghosts;
  click one, or press **X**, to take it.
* **Steepest** (a percentage, remembered for each way of travelling): the steepest slope the traveller
  will take. A cart is limited to 12% at first, a horse to 20%, on foot to 35%. A climb steeper than that
  is routed around, winding in switchbacks.
* **Tunnel** (and **Longest tunnel**, 1 to 20 km): allow a tunnel through high ground where there is no
  way over. **Steps** (on foot only): allow short, very steep flights of steps. When a route has no way, the
  status offers **Allow a tunnel** and **Allow steps** right there, saying where the route is steepest
  ("No way by cart: Grey Pass is 19% at its steepest").
* The status gives the whole journey: the length, an estimate of time ("about 27 days by cart at 8 hours a
  day") if the map has a scale in km, miles, leagues, metres or feet, and tags for fords, bridges and
  where a ship is boarded. It lists the biomes it crosses and how they changed speed.
* A **height profile** under the options draws the heights along the way with steep parts in amber (12%
  and over) and red (20% and over), and a summary ("Climbs 1,240 m, highest 1,690 m, steepest 18%").
  **Show steepness** decides whether the made path carries chevrons on its steep stretches.
* **Roads already there.** Existing roads (paths in a Road style, or painted roads if **Follow drawn
  lines** is on) are quicker; existing rivers are in the way. If the route runs partly along a road,
  the main button becomes two: **Make new stretches** (only the parts off the road, each joined to the
  road at both ends) and **Make whole route** (one path, along the road too).
* **Branches.** Start or end a route on a made road, with snapping to paths on, and it leaves the road
  wherever is best; the bar says "branches from *King's Road*".

### Trace

* Point at a line painted in the picture (a river, a road, a coast, a border). It lights up with "Click
  to follow this river".
* **Click** and the whole line is followed through dashes, bridges and town rings to both ends. Click the
  same line a second time to stop the trace there: you get only the stretch between the two clicks.
  Click a different line and that one is followed instead.
* **Side branches** (tributaries, forks) appear as grey ghosts. Click one to add it. "Make 2 paths" makes
  each branch its own path ending exactly on the main one.
* A closed line (a coast, a lake shore) is followed all the way round.
* Trace does not use heights, so it works with no height map.
* The style is guessed from the line's colour (blue becomes **River**, red or brown **Road**) and you
  can change it in **Path style** before you press **Make path**.

### The options common to all three

| Option | What it does |
| --- | --- |
| **Height map** | (River and Route) Use your height map; off, the terrain is guessed. |
| **Show relief** (H) | Draw the terrain in use as light, shade and contour lines, so you can see why a path goes where it does. |
| **Follow drawn lines** | Painted rivers pull water and are in a traveller's way; painted roads are quick. |
| **Points** (fewer … more) | How many points the made path has. |
| **Straight / Curved** (C) | How the made path is drawn. |
| **New path in** | The layer the path is made in. |
| **Path style** | A style for the path, or **The layer's look**. |
| **Terrain from "*name*"** / **Guessing terrain from the picture** | A link into the Terrain dialog. |

### After you make a path

* **Make path** becomes **Make N paths** when a trace has branches.
* **Add to "*name*"**: with a path selected, joins the proposed path to it, end to end. Use it to extend
  a river upstream or to continue a road.
* **Continue "*name*"**: appears when the new path meets the end of a path of the same kind: the two
  become one path. **Make separate path** makes it its own path, joined at the shared end.
* **Group N paths** (Ctrl/⌘+G): appears after you have made two or more in a row. A river and its
  tributaries become one group, ready for a name.
* A made path's Edit tab carries a note: kind, length and terrain ("Fastest way by cart: about 27 days at 8
  hours a day, 1 bridge. Terrain from the height map.").

### Rivers feed Explore and Terrain

A path in a River style counts as a river for later routes; a Road style counts as a road. This is how
a river you made guides the next route.

---

## 20. Suggest biomes

**Suggest biomes** looks at the map's terrain and proposes biome zones for the places that have none:
ocean and coast, ice and tundra, forests, deserts, wetlands, mountains. It is a starting point, not a
survey. It works out a simple climate from the height map (or the guess from your picture), the
latitude and the wind. It knows nothing about ocean currents, seasons, monsoons or soil. Accept what
fits, skip or repaint the rest.

It is for flat maps with a picture or height map. On a globe it says **Suggest biomes works on flat
maps for now**. With neither a picture nor a height map it says **Suggest biomes needs terrain: add a
height map**.

### Use it

1. Press **Suggest biomes** (**B**).
2. Wait for **Working out the climate…**. Then dashed, tinted ghost areas appear, each with the biome's
   pattern.
3. Hover a ghost: the tag says what it is, how big, how it affects travel, and "Click to accept".
4. **Accept** the ones you like and **Skip** the ones you do not. Accepting makes a real zone with the
   biome, in the **Biomes** layer. Skipped ones go away (**Show them again (N)** brings them back).

You can also use the **Suggest** tab in the side bar, which lists the suggestions by biome, each with
its area, **Accept** and **Skip** buttons. Hovering a row lights it on the map.

### Accept or skip with the keyboard

| Key | What it does |
| --- | --- |
| **Enter** | Accept the suggestion under the pointer. |
| **Shift+Enter** | Accept all. |
| **Delete** or **Backspace** | Skip the suggestion under the pointer. |
| **1**, **2**, **3** | Switch the view: **Biomes**, **Temperature**, **Rainfall**. |

The buttons in the bar are **Skip all** (computer only), **List** (opens the Suggest tab) and **Accept
all**.

### The settings

These set the imaginary climate of your world. Change them and the suggestions are worked out again.

| Setting | What it does |
| --- | --- |
| **Wind from** | A dial of eight directions plus **No prevailing wind**. Wind carries rain over mountains; the far side of a range is dry. |
| **Latitude** | Where in the world the map's middle is (-80° to 80°). Colder away from the equator. |
| **N-S span** | How many degrees of latitude your map covers. |
| **Temperature** | A shift of -10 to +10 °C: a colder or warmer world. |
| **Wetness** | A rainfall multiplier from 0.4 to 2.5. |
| **Smallest zone** | Hide suggested areas smaller than this (in km²). |
| **Show: Biomes / Temperature / Rainfall** | See the working: a colour scale appears for temperature or rainfall. |

The terrain button in the bar says where the heights came from (**Height map "*name*"** or
**Terrain generated from the picture**) and opens the Terrain dialog. Your settings are saved with the
zones you accept.

---

## 21. Explore: places worth a look along your roads and rivers

**Explore** helps you find where something interesting would naturally be: a crossroads where an inn
belongs, a ford, a river mouth with a harbour, a pass in the mountains, a day's ride out of town. It is
a way of discovering places, not of looking at the map. Frontier finds the likely places for free from
your own paths; the AI is only asked when you choose to, and you see what it will be sent first.

Explore needs AI set up in Settings (the **Explore** button is not shown without it), and works while
**viewing** (not editing). It looks along the roads and rivers you have drawn, in styles that count
as Road or River ([section 14](#14-styles-and-the-legend)). The listing of points of interest works on
flat maps; on a globe you can still click any place to ask about it.

### Turn it on

Press **Explore** in the map bar, or press **X**. A bar appears at the top of the map with a status
("21 places worth a look along 3 roads and 5 rivers · found from the map's paths and heights, nothing
sent"), and the **Explore** tab opens in the side bar (on a phone use the **List** button).

If the map has no roads or rivers yet, the bar says so and you can still click any place.

### What it shows

Points of interest appear as dashed ghost pins. They are found by Frontier, with no AI:

| Spot | Where it comes from |
| --- | --- |
| **Crossroads** | Two roads cross. |
| **Junction** | A road branches off another. |
| **Bridge or ferry** and **Ford** | A road crosses a river. |
| **Confluence** | A tributary joins a river. |
| **Delta** | A river splits into arms. |
| **River mouth** | A river reaches the sea. |
| **Lake outlet** | A river leaves a lake. |
| **River bend** | The sharpest bend of a river. |
| **Pass** | The high point of a road across the mountains (needs heights). |
| **Spring** | The start of a river. |
| **Border crossing** | A road crosses a border. |
| **Road meets the sea** | A road reaches the coast where there is no marker: a landing or harbour. |
| **Day's travel** | Every eight hours along a road from each town, junction and crossroads. |

Rules that keep it tidy: a spot near an existing marker belongs to that marker and is not offered again;
spots very close together become one pin with several reasons. Hover or focus a pin to see why it is
there.

The bar's options:

* **Points of interest** (key **I**): show or hide the pins.
* The family chips, each with a count: **Crossroads**, **Bridges & fords**, **Waters**, **Passes &
  springs**, **Day's travel**, **Coasts & borders**. Click to show or hide a family.
* **A day's travel: On foot / Horse / Cart**: how far a day's stop is (needs the map's scale).

### Choose places to ask about

There are three ways in:

1. **Click a spot.** It is chosen. **Shift-click** adds or removes a spot from the choice.
2. **Click a road or river.** It is highlighted with a soft band and the Explore tab lists its spots in
   order from the start. **Choose all *N*** (key **A**) picks every spot along it (press again to
   clear). Press **Esc** to leave the road.
3. **Click anywhere else.** That place is chosen, described to the AI by what is near it.

The **Explore** tab lists the roads and rivers (with length and number of spots), the spots grouped by
family, **Found, waiting** (discoveries not yet kept) and **Kept on this map**.

Moving about with the keyboard: **[** and **]** go to the previous and next spot (along the chosen road if
there is one), **Space** adds or takes out the spot at the cursor, **Enter** asks, **Esc** closes a card,
then clears the choice, then leaves the road.

### Ask

At the foot of the Explore tab is a tray with your chosen places as chips you can remove. Open **What
Frontier sends** to read exactly what will be sent for each place: what is there, the roads and rivers
it is on, nearby towns, the ground, the realm and the moment (the year, if time is on). Names of
unlinked features are sent only as names; entries may be quoted.

Press **Ask what is there** (or **Ask about N places**; **Enter** also asks). It shows the cost ("One
call · about $0.02 · $3.12 of $10 spent this month"). Up to six places go in one call. Asking needs a
connection; choosing places works offline. If a monthly cost cap would be passed, or the cap is 0,
the button says so and the AI is not asked.

### What comes back

Each proposal appears as a **?** pin on the map. Click it to open a card showing:

* "Proposed *kind* · not in the lore", with a name and description;
* **Grown from:** quotes from your entries that the idea came from, each linking to its entry;
* any **conflicts** with your lore, in red;
* **Make concept art** (when art is available), then **Draw it again**;
* **Keep it as a new entry in** a folder you choose, then **Keep**; or **Discard**.

**Keep** makes a new entry and a marker at that spot. Both are new unpublished changes. A kept place is
a plain marker: it is not tied to the road. If several proposals were found, **‹** and **›** step between
them.

---

## 22. Maps in time

A map shows your world at no particular time until you give it one. A **chronicle** (a timeline of your
world) says when things begin and end; turn **Time** on and the map follows it: places appear, fade,
disappear and change shape as you slide through the years.

### Turn time on

The **Time** button appears in the map bar once you have at least one chronicle. Press it, or press
**T**. A **time bar** appears under the map:

| Control | What it does |
| --- | --- |
| **Chronicle** | Which chronicle the map follows. The **main** chronicle is the default; marked "(main)". |
| **Year** | Type a year. |
| **Open timeline ↗** | Opens the chronicle's timeline page at this year. |
| **Time off** | Turns time off. |
| **◂ Earlier** / **Later ▸** | Jump to the previous or next year at which something on this map changes. |
| **Year, by sweeping** | A slider across the chronicle's years. |
| Key | **there**, **perhaps**, **undated**: how features are drawn. |
| **Show everything** | (Editing only) Draws everything faintly, even what does not yet exist. |

The year and chronicle are kept in the map's address, so a link reopens the map at the same moment, and
they are carried when you open a map of a place or step Up or Down.

### What happens to features

How a feature follows time is decided by its **span** in the chosen chronicle:

* A feature **linked to an entry** follows the span that entry has in the chronicle.
* A feature with no entry (a border, a coastline) can be **tied** directly to a span.
* A feature with nothing says nothing: it is **timeless** and always drawn.

At the year shown:

| What the chronicle says | How it is drawn |
| --- | --- |
| **There** | Normally. |
| **Perhaps** (the dates are rough and the year falls in the uncertain part) | Faded to about half strength; still clickable. |
| **Not yet** / **Gone** | Not drawn and not clickable. |
| **Undated** (it follows a span with no numbers) | Dashed lines, a dashed ring on a marker; still clickable. |

The selected feature's card explains why ("Perhaps: begins …", "Not yet: begins …", "Gone: ended …",
"Undated: …"). The Layers tab says how many features are there, perhaps there and undated.

While you are editing, the feature you have selected is always drawn (faintly when it does not exist at
that year) so it never vanishes under your hand.

### Tie a feature to a span

In the Edit feature tab, the **Time** section says what decides the feature ("Follows *span*, the span of its
entry", "Tied to *span*", "Timeless: nothing says when this exists."). To tie it:

1. Open **Tie to a span** and choose a span from the chronicle (grouped by lane).
2. To undo it, press **Untie**.

A tie wins over the entry's span. If you open the feature through a different chronicle that does not
have the span, it shows as undated. If time is not on, the Time section says "Turn time on to see when
this exists" (or "Make a chronicle to say when this exists" if you have none).

### Give a feature a different shape in a later period

A border moves; a city grows. Under **Shapes**:

* **First shape** is the one the feature has always had.
* **Add a shape from…** choose a span: the feature gets a later shape that comes into force from that
  span's start. The new shape begins as a copy of the one on screen, and you edit it by dragging as usual.
* Each shape is listed as "From *span*, year *N*" with a **Remove** button. Click one to choose which you
  are editing; the panel says "Editing the shape from *span*".

Dragging a corner while time is on changes only the shape in force at that year. Moving across the year the
later shape starts swaps them.

### Make a marker revolve

For a schematic cosmos (or any flat map), a marker can circle another as years pass. In a marker's Edit
tab, under **Revolves**, choose **Revolves around** another marker and **Once every … years** (the period).
The marker turns around the centre as you slide through time; with **Nothing: it stays where it is**, it
stays put. Drag a revolving marker and it is dropped where your pointer is at the year shown.

---

## 23. Globes, other views, layers beneath and schematic maps

### Globes

A globe map's positions are longitude and latitude, and its picture wraps the world. Use the **View**
drop-down in the map bar:

| View | What it shows |
| --- | --- |
| **Globe** | A turning ball. Drag to turn it; zoom to come closer. North is always up. |
| **Flat** | The picture laid out flat (longitude across, latitude down). It repeats every 360 degrees so panning never reaches an edge. |
| **Mercator, Equirectangular, Robinson, Winkel Tripel, Mollweide, Natural Earth, Fahey, Two hemispheres** | The globe flattened the way an atlas would. |

Your markers, paths and zones follow the view (drawn along great circles on a ball). Measuring gives the
same distance in every view.

With a projection, a **Turn** button appears. It opens **Turn the globe**, with three sliders: **Turn
about the poles**, **Tilt** and **Turn about the middle**, each also a number box in degrees. **Upright**
puts the tilt back. **Focus on a region** lets you drag a box around a place to turn the globe to it and
zoom in on it; press **Esc** or **Cancel** to give up.

The view, projection, angles and zoom are all kept in the map's address, and **Copy a link to this
view** keeps them.

A globe cannot have a height map, so Terrain, Find paths and Suggest biomes need a flat map. Find areas
works on a globe's picture.

### Layers beneath: a world under a world

Some worlds are stacks: Ezob above, and beneath it the Labyrinth, and beneath that the Deep. A globe can
**lie under** another globe, sharing its longitude and latitude, so a place on the lower layer sits
directly under the spot above it.

To set it up, open the lower globe, edit it, and in the Layers tab's **This map** box, choose **Lies
under** and pick the globe above ("Nothing: it is a world of its own" removes the link). A globe cannot lie
under one that lies under it. Then **▲ Up** and **▼ Down** in the bar step between them, keeping the same
place, view and year.

The Maps page notes the stack: "lies under *Ezob*" and "2 layers below".

### Schematic maps

A schematic map is a flat map with measuring switched off, for diagrams where distance means nothing: the
Layered Heavens, a map of planes. There is no Measure tool and no length. To switch a flat map to schematic
and back, tick **Schematic: a diagram, with no measuring** in the **This map** box (Layers tab, while
editing), or choose **Schematic** when you make it. Markers on schematic maps can **revolve** around one
another through time ([section 22](#make-a-marker-revolve)), each opening its own map.

---

## 24. Keyboard shortcuts

Map keys work while the map (not a text box) has the focus. Click the map once to give it the focus. Press
**?** anywhere to see the full list of the keys on the screen you are on. On a Mac, read **Ctrl** as **⌘**.

### Anywhere on the map

| Key | What it does |
| --- | --- |
| **E** | Edit the map (while viewing). |
| **Ctrl+Enter** | Done editing (while editing). |
| **+** or **=** | Zoom in. |
| **-** | Zoom out. |
| **0** | Show the whole map. |
| **Arrow keys** | Slide the map. **Shift+arrow** slides further. |
| **L** | Show or hide the Layers tab. |
| **T** | Turn time on or off. |
| **H** | Show or hide the relief of the terrain (when the map has terrain, or Find paths is on). |
| **Esc** | Step back: focus box, drawing, tool, picked corner, picks, out of a group, selection. |
| **Space** (held) with a drag | Pans, whatever is under the pointer. |

### While editing

| Key | What it does |
| --- | --- |
| **V** | Select tool. |
| **M** | Marker tool. |
| **P** | Path tool. |
| **Z** | Zone tool. |
| **W** | Label tool. |
| **R** | Measure tool. |
| **G** | Place with AI. |
| **F** | Find areas. |
| **D** | Find paths. |
| **B** | Suggest biomes. |
| **S** | Snapping on or off. Hold **Alt** while placing a point to place it freely. |
| **C** | Straight or curved: for the path or zone you are about to draw, or for the selected one. |
| **Enter** | Finish the path or zone being drawn. With a group selected and the Select tool: go inside the group. |
| **Delete** / **Backspace** | Delete the picked corner or the selection. While drawing: take back the last point. |
| **Ctrl+Z** | Undo. |
| **Shift+Ctrl+Z** or **Ctrl+Y** | Redo. |
| **Ctrl+G** | Group the picked features, or add them to the picked group. |
| **Shift+Ctrl+G** | Ungroup. |
| **F2** | (In the Layers tree) rename the layer or group. |

### Find areas

| Key | What it does |
| --- | --- |
| **X** | Switch plain clicks between add and remove. |
| **Enter** | Make a zone of the chosen areas. |
| **Esc** | Clear the chosen areas, then the selection. |
| **Shift-click** / **Alt-click** | Always add / always remove. |

### Find paths

| Key | What it does |
| --- | --- |
| **1**, **2**, **3** | River, Route, Trace. |
| **X** | River: switch between from its source and from its mouth. Route: take the next way (Fastest / Flattest / Avoid water). |
| **Enter** | Make the path. |
| **Esc** | Clear what is proposed, then the selection. |
| **H** | Show or hide relief. |
| **C** | Straight or curved. |
| **Ctrl+G** | Group the paths just made. |

### Suggest biomes

| Key | What it does |
| --- | --- |
| **1**, **2**, **3** | Show the biomes, the temperature, the rainfall. |
| **Enter** | Accept the suggestion under the pointer. |
| **Shift+Enter** | Accept all. |
| **Delete** / **Backspace** | Skip the suggestion under the pointer. |

### Explore (while viewing)

| Key | What it does |
| --- | --- |
| **X** | Explore on or off. |
| **I** | Show or hide the points of interest. |
| **[** and **]** | The previous and next point of interest. |
| **Space** | Add or take out the spot at the cursor. |
| **A** | Choose every spot along the road or river (again: clear them). |
| **Enter** | Ask what is at the chosen places. |
| **Esc** | Close the card, then clear the choice, then leave the road. |

### In the Terrain hints workspace

| Key | What it does |
| --- | --- |
| **V**, **P**, **O**, **R**, **Y**, **C**, **Z** | Select, Peak, Hollow, Ridge, Valley, Cliff, Zone tools. |
| **N** | Next suggestion. |
| **A** | Accept the selected waiting hint. |
| **X**, **Delete** or **Backspace** | Reject the selected hint (or delete your own). |
| **H** | Show or hide the hints. |
| **1** to **4** | Picture, Heights, Relief, Contours. |
| **B** | Build the height map. |
| **S** | Another variation. |
| **+**, **-**, **0** | Zoom in, out, show it all. |
| **Ctrl+Z** / **Shift+Ctrl+Z** | Undo / redo. |

### Mouse and touch gestures

| Gesture | What it does |
| --- | --- |
| Click or tap a feature | Select it. |
| **Shift**-click or **Ctrl/⌘**-click | Add to the selection (pick several). |
| Double-click a member of a selected group | Go inside the group to that member. |
| Drag on empty map | Pan. |
| Drag a selected feature | Move it. |
| Drag a corner or **+** of the selected path or zone | Reshape it. |
| Wheel | Zoom about the pointer. |
| Pinch (touch) | Zoom. Two fingers also pan. |
| Hold **Alt** | Place a point freely, without snapping. |
| Right-click | The context menu (computer only). |

---

## 25. Desktop and phone

Maps work on both, with a few differences:

| | Computer | Phone |
| --- | --- | --- |
| **Side bar** | Tabs (**Layers**, **Selected** / **Edit feature**, **Styles**, **Explore**, **Suggest**, **Place with AI**, **N selected**, group) open beside the map. | The same tabs open as a **bottom sheet** over the foot of the map. The map moves to keep what you picked above it. |
| **Hover** | Names and entry previews follow the mouse. | There is none; tap a feature to read it in the sheet. |
| **Right-click menu** | Yes. Shift+right-click gives the browser's menu. | None. A long press that does not move is just a tap. |
| **Pick several** | **Shift** or **Ctrl/⌘**-click. | **Select several** in the tool bar, then tap. A strip shows the count with **Cancel** and **Group**. |
| **Drawing** | Click to add points; double-click, Enter or the button to finish. | Tap to add points; tap the last point again, or press **Finish path** / **Finish zone** in the hint line, to finish. |
| **Handles** | Small. | Larger, and hidden on very short stretches (zoom in). |
| **Tool options** (Find areas, Find paths, Suggest biomes, Explore) | Shown in the bar over the map. | Folded under an **Options** button. Shorter wording (a **Temp.** button, and so on). |
| **Terrain dialog** | All settings listed together. | Five steps: **Image**, **Line up**, **Sea**, **Heights**, **Check**. |
| **Biome picker** | A drop-down. | A sheet from the bottom. |
| **Biome legend card** | Open. | Starts folded. |
| **Keyboard shortcuts** | Everything above. | Need a keyboard; every action has a button as well. |

On a phone, **Done** and **⋯** stay on the first line of the map bar so the way out is always on screen.

Pinch and drag gestures are exclusive: a two-finger drag pans, a one-finger drag on a selected zone moves
it, and a one-finger drag on anything else pans. Try the moves on an unimportant feature first.

---

## 26. Troubleshooting

**I cannot make a map: the "Make the map" button is grey.**
It needs both a **Title** and an **Image**. Press **Choose an image…**.

**The map will not open: "Opening the map…" stays on screen, or a red message appears.**
Press **All maps** and try again. If your connection is down, a map you have opened before opens from the
copy kept on this device, with a note **Offline copy from …**. If the picture cannot be drawn on your
device, the page says so.

**I dragged and the map moved instead of the feature.**
Only the selected feature can be dragged, and the press must start on it (for a zone, inside it). Click it
first. Holding Space always pans.

**I cannot select or change a feature: "It is in a locked layer."**
The layer, or a layer above it, is locked. Unlock it (the lock in the Layers tab). A group can also be
**Locked**.

**A feature is gone.**
It may be in a hidden layer (check the eyes in the Layers tab) or hidden itself; or, if time is on, it may not
exist at the year shown (turn on **Show everything** while editing, or look at another year). Press Ctrl+Z if
you deleted it.

**A tool is greyed out.**
Hover it to read why. Common reasons: **Find areas needs a map image** (show an image in the Layers tab); **Find
paths works on flat maps for now**; **Find paths needs a map image or a height map**; **Suggest biomes needs
terrain**; and the Place with AI tool and Explore need AI set up. Measure is missing because the map is
schematic.

**"Finish path" does nothing.**
A path needs 2 points and a zone 3. The button's tooltip says so.

**I cannot remove a corner.**
A path keeps at least 2 and a zone at least 3 points. Delete the whole feature instead.

**My points will not go where I click: they jump.**
Snapping is pulling them onto a nearby border. Hold **Alt** while you click, or turn snapping off with **S**
or narrow it with **Snap to**.

**Find areas outlines are full of holes or splintered.**
Turn on **Ignore text & marks**, slide **How alike** towards **loose**, or turn **Stop at lines** off if a
broken border is breaking the area up. If two regions run together, slide it towards **strict**.

**Find areas says "That is text or a mark."**
Turn on **Ignore text & marks**.

**Find paths says "That is water. Click on land, where the river rises."**
A river must start on land. Click the land, or use **From its mouth** and click the coast.

**Find paths says "Too short to be a river: click further from the water."**
Click a bit further inland.

**Find paths gives a river that runs straight to the nearest coast.**
It is guessing the terrain from your picture. Build or add a height map in Terrain, or draw zones in styles that
count as Mountains.

**Find paths says "No way by cart …"**
The route needs a climb steeper than the cart's limit. Raise **Steepest**, switch to a horse or foot, or press
**Allow a tunnel** / **Allow steps**.

**Find paths does not know travel times.**
The map has no scale. Measure a line of known length and **Set the scale from this line**.

**Find paths treats my painted river or road as ordinary ground.**
Turn on **Follow drawn lines**. For paths you drew yourself, give them a style whose **Counts as** is River or
Road.

**Suggest biomes proposes nothing: "Every place here has a biome."**
Every place already lies inside a biome zone. Delete a zone, or skip to repaint.

**Explore shows no points of interest.**
It needs at least one road or river: paths in a style that counts as Road or River. Check **Points of interest** is on and
the families are not all hidden.

**Explore's Ask button is grey.**
Hover it. It needs at least one chosen place, a connection, and room under the monthly AI cost cap.

**The year I typed does nothing in Time.**
The chronicle has no years placed on its timeline yet ("Nothing in this chronicle is placed in years yet."). Give
its spans dates in the chronicle first.

**"Not saved" or "Unsent: kept on this device" appears next to the title.**
You are offline or the server refused a change. Your work is safe on the device and goes up when the connection
returns. Press **Done** once you are back online to send it at once.

**Two devices changed the same map.**
When you open it or save, Frontier merges the changes by item (a feature added on one device and a different one on
the other both survive), and says "Changes from another device were merged in." If the same feature was changed
on both, this device's version is kept.

**A style, biome or layer I deleted: can I get it back?**
Styles and biomes show an **Undo** in the pop-up message right after you delete. Layers and features come back with
**Ctrl+Z**.

---

## Tips

* Make **layers first**: Realms, Cities, Roads, Water, Notes. Then set the current layer before you draw.
* Use **Lock** on a layer of finished borders so you cannot nudge them while you work on the cities.
* Make your **styles first** (**Add the usual styles**), and tick **Counts as**: every tool that reads the map will then understand
  it.
* Use **Find areas** for coastlines and kingdoms, then **Add to selected zone** to fix a missed corner.
* Give a **height map** or build one from **hints** if you want believable rivers and routes. It is a one-time job
  that every later tool uses.
* Draw a river with **Find paths**, then group it with its tributaries (**Group N paths**) and give the group a name and an
  entry.
* Make a **new entry from the map** while you are placing towns; you can write it up later.
* **Copy a link to this view** to bookmark a particular framing of a map in a note.
* Turn **Time** on and **Show everything** while editing to find features that are not tied to any span.
* Use **Save a picture at four times the size** for a print-quality PNG of the map as you see it.
