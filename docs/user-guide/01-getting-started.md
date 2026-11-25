# 1. Getting started

This chapter is your first tour of Frontier. It explains what Frontier is and the words it uses, how to
sign in, how the screen is laid out on a computer and on a phone, and how to find your way around the
library. It also covers the everyday housekeeping: saving, working without a connection, the Settings
pages, and the screens where you review, save and import your work.

If you only read one section, read [The words Frontier uses](#the-words-frontier-uses) and
[Saving and the signals that tell you how it is going](#saving-and-the-signals-that-tell-you-how-it-is-going).

---

## Contents

1. [What Frontier is](#what-frontier-is)
2. [The words Frontier uses](#the-words-frontier-uses)
3. [Signing in](#signing-in)
4. [The screen: side bars, rail and panels](#the-screen-side-bars-rail-and-panels)
5. [The Home page](#the-home-page)
6. [The folder tree](#the-folder-tree)
7. [Finding things: the quick switcher and full-text search](#finding-things-the-quick-switcher-and-full-text-search)
8. [Keyboard shortcuts](#keyboard-shortcuts)
9. [Saving and the signals that tell you how it is going](#saving-and-the-signals-that-tell-you-how-it-is-going)
10. [The Status page](#the-status-page)
11. [Installing Frontier as an app](#installing-frontier-as-an-app)
12. [Updates, toasts and problem messages](#updates-toasts-and-problem-messages)
13. [Working offline](#working-offline)
14. [Settings](#settings)
15. [Reviewing and saving your changes: the Unpublished list](#reviewing-and-saving-your-changes-the-unpublished-list)
16. [When a file changed in two places: Conflict and Two texts to compare](#when-a-file-changed-in-two-places)
17. [The Inbox](#the-inbox)
18. [Import](#import)
19. [History of the library](#history-of-the-library)
20. [Troubleshooting](#troubleshooting)

---

## What Frontier is

Frontier is a web app for one author. You use it to **write**, **read** and **explore** a fantasy
worldbuilding library: a collection of notes about your world (places, people, peoples, histories,
languages, anything you write about), plus the maps and timelines that go with them.

A few things are worth knowing from the start:

- **Your notes are plain Markdown files.** Markdown is a simple way of writing formatting in text
  (`# Heading`, `**bold**`, `[[Link]]`). Nothing is locked inside Frontier: the library can be
  exported at any time as ordinary files that open in other programs, such as Obsidian.
- **It is built around links.** Writing `[[Name]]` in a note links it to another note. Frontier shows
  you what links to what, in each entry's Graph panel and on the Graph page.
- **It works on a computer, a tablet and a phone**, and you can keep working when the connection drops.
- **It is for one person.** There are no accounts to manage and nobody else edits your library.

The main places you can go, shown in the side bar, are:

| Place | What it is for |
| --- | --- |
| **Library** (the folder tree) | Reading and organising your entries |
| **Maps** | Flat maps and globes, with markers, paths and zones |
| **Chronicles** | Timelines of events |
| **Graph** | A picture of how your entries link to each other |
| **Gallery** | Every image in the library |
| **Ask** | Asking questions of your lore, with an AI (needs a provider, see [Settings](#settings)) |

Other chapters of this guide cover each of these in depth. This chapter covers the frame around them.

---

## The words Frontier uses

| Word | What it means |
| --- | --- |
| **Entry** | One note: a single page in your library, such as a character, a city or a god. An entry is one Markdown file. |
| **Folder** | A group of entries, like a folder on your computer. Folders can sit inside other folders. A folder can have an icon, a colour, and a default type for the entries made in it. |
| **Library** | Everything: all your entries, images, maps and chronicles. Older parts of the app, and the program's own notes, also call it **the vault**. They mean the same thing. |
| **Own library** | Frontier keeps your library itself, on its own server, and is the only thing that writes to it. This is the normal setup. You bring existing notes in with [Import](#import) and take copies out with Export. |
| **Shared library** (GitHub) | A different setup, used when the library lives in a GitHub repository that other tools also write to. You may not use this. See the next table for how the wording differs. |
| **Draft** | Your changes to an entry (or a map, or a chronicle) that are saved on the server as you type but are not yet part of the library's official history. You can keep working on a draft for as long as you like. |
| **Type** | A label an entry carries in its properties, such as *character* or *place*. Folders can give new entries a default type. |
| **Properties** | The fields at the top of an entry (type, other names, tags, dates). They are edited in the Properties panel of the editor. |
| **Alias** | Another name an entry is known by. The quick switcher finds an entry by its aliases too. |
| **Side bar** | The panel on the left (the folder tree and the main places) or the panels on the right (outline, history and so on). |
| **Rail** | The left side bar folded down to a narrow strip of icons. |

### Saving: two vocabularies, one idea

Your drafts have to be turned into something official from time to time. What that is called depends on
how your library is set up.

| | Own library (the usual setup) | Shared library (GitHub) |
| --- | --- | --- |
| Changes waiting to be recorded | **Unsaved** changes | **Unpublished** changes |
| The action | **Save a version** | **Publish** |
| The review button | **Review and save** | **Review and publish** |
| Busy button text | "Saving…" | "Publishing…" |
| What it makes | A new **version** in the library's history, with a line saying what changed | One commit on the GitHub repository |
| Can it clash with someone else's changes? | No: Frontier is the only writer | Yes: you may have to merge or resolve |

Frontier picks the right words for you. This guide says "save a version (or publish)" where it matters,
and uses the own-library words by default. The side bar item is called **Unsaved** or **Unpublished**
accordingly, and the page that lists the changes is the [Unpublished list](#reviewing-and-saving-your-changes-the-unpublished-list)
in both cases (the address is `/unpublished`).

> **Tip.** A *draft* and a *saved version* are different things. Typing in the editor saves your text
> as a **draft** automatically (about a second after you stop). The draft is safe on the server, but it
> does not appear in the library's history until you **save a version** (or **publish**).

---

## Signing in

Open Frontier's address in your browser. You see the sign-in card with the title **Frontier** and the
line "The atlas of Avalymia."

### With the password

1. Type your password in the **Password** box.
2. Press **Log in** (or press Enter).

If the password is wrong, a message appears under the box. Try again.

### With a passkey

A **passkey** lets you sign in with your device's fingerprint, face or screen lock instead of typing a
password. If a passkey has been set up, a **Use a passkey** button appears on the card.

1. Press **Use a passkey**.
2. Your device asks you to confirm (fingerprint, face, PIN, or a security key).

If the password has been switched off (see [Signing in under Settings](#signing-in-settings)), only the
passkey button is shown.

> **Tip.** Set up a passkey on each device you use. It is faster than typing a password and cannot be
> guessed. Do this from **Settings, Signing in**.

### Staying signed in

- A sign-in lasts **30 days**. Each time you open Frontier while signed in, the 30 days start again
  from that visit.
- If you open Frontier with no connection and you were signed in recently, it opens anyway (see
  [Working offline](#working-offline)).
- If your session ends while you are working, a **Log in again** window opens over the page. It says
  "Your session has ended. Nothing you changed is lost: what is not sent yet stays on this device and
  goes as soon as you are back in." Type the password (or use a passkey) and carry on. If you press
  **Not now**, the window closes; the **Signed out** mark in the side bar (see below) has a **Log in**
  button to open it again.

### Logging out

Open the app menu (the **⋯** at the bottom of the side bar) and choose **Log out**. Logging out needs a
connection, because only the server can end your session; the item is greyed out while you are offline.

If some changes have not reached the server yet, Frontier warns you first: "3 changes are not sent yet
… logging out removes them from it. Log out all the same?" Choose **Log out and lose them** only if you
are sure. Logging out also removes Frontier's offline copy from that device, which makes it a good
habit on a borrowed computer. Other open Frontier tabs in the same browser sign out too.

---

## The screen: side bars, rail and panels

Frontier's screen has three parts on a computer:

```
+----------------+------------------------------+------------------+
|  Left side bar |        The page             |  Right side bar  |
|  (library,     |   (an entry, a map, a       |  (panels: outline|
|   places,      |    chronicle, settings…)    |   history, etc.) |
|   app menu)    |                              |                  |
+----------------+------------------------------+------------------+
```

### The left side bar

From the top down:

1. **Frontier**: the name. Press it to go to the Home page.
2. **Fold the side bar** button (a small panel icon). It folds the bar to the rail.
3. **Search**: opens the quick switcher (see [Finding things](#finding-things-the-quick-switcher-and-full-text-search)).
   It shows the shortcut beside it.
4. **New entry**: opens the New entry window (see [Making a new entry](#making-a-new-entry)).
5. **The places**: Maps, Chronicles, Graph, Gallery, Ask. The page you are on is highlighted.
6. **Library**: the folder tree (see [The folder tree](#the-folder-tree)). It has two small buttons
   beside its heading: **New entry** and **New folder**. The tree is the part that scrolls.
7. **The footer**, which holds what is waiting for you and the state of the connection:
   - **Unsaved** (or **Unpublished**): your drafts waiting to be recorded, with a count badge. Press it
     to open the [Unpublished list](#reviewing-and-saving-your-changes-the-unpublished-list).
   - **Inbox**: proposals waiting for a decision, with a count badge. See [The Inbox](#the-inbox).
   - **Compare**: appears (in an attention colour) only when there are texts from other devices to
     compare. See [Two texts to compare](#two-texts-to-compare) later in this chapter.
   - The **connection mark** (Connected, Not connected, or Signed out) and, when something is waiting
     to be sent, the **Unsent** count. See [Saving and the signals](#saving-and-the-signals-that-tell-you-how-it-is-going).
   - The **app menu** (**⋯**).

You can drag the thin edge between the side bar and the page to make the side bar wider or narrower.
The width is remembered on that device.

### The app menu

The **⋯** button at the foot of the side bar opens the menu for looking after your library. It holds the
pages you use less often than the places above:

| Item | Where it goes |
| --- | --- |
| **Import** | Bring notes, images or a whole vault in. See [Import](#import) |
| **Export** | Take the library or an entry out as files. (Covered in the chapter on exporting.) |
| **History of the library** | The list of saved versions of the whole library. See [History of the library](#history-of-the-library) |
| **Settings** | The Settings pages. See [Settings](#settings) |
| **Status** | The Status page. See [The Status page](#the-status-page) |
| **Keyboard shortcuts** | Opens the shortcut sheet. See [Keyboard shortcuts](#keyboard-shortcuts) |
| **Log out** | Ends your session (needs a connection) |

### The rail

Press the **Fold the side bar** button (or the shortcut **Ctrl+\\**) and the left side bar shrinks to a
narrow strip of icons: the rail. It keeps everything except the folder tree:

- **Unfold the side bar** (at the top)
- **Search**, **New entry**
- **Start** (the Home page), then Maps, Chronicles, Graph, Gallery, Ask
- Unsaved/Unpublished, Inbox and (when needed) Compare, each with its count
- the connection mark, the Unsent count, and the app menu

Hover over an icon to see its name. Press **Unfold the side bar** (or **Ctrl+\\** again) to bring the
folder tree back.

Frontier remembers, **for each kind of screen**, whether the bar is folded. The kinds are: reading and
other ordinary pages, the editor, a map, a chronicle, and the graph. Maps, chronicles and the graph
start with the rail, because they need the room; other screens start with the full bar.

### The right side bar and its panels

Many pages have extra tools that open beside the page, on the right, as **panels**. Each panel is a tab
at the top of the right side bar. Which panels you get depends on the page:

| Page | Panels |
| --- | --- |
| Reading an entry | Comments (when the entry has some), Outline, History, Export, Graph |
| Editing an entry | Properties, Comments, Outline |
| A map | Styles, Place with AI, Layers, Explore, and the panel for what you have selected |
| The Graph page | Entries, Filters |

How to use the right side bar:

- **Open a panel** with the matching button on the page (for example the **Outline** button on an
  entry, or the **Filters** button on the Graph).
- **Switch panels** by pressing a tab. With the keyboard, use the **left** and **right** arrow keys
  between tabs, and **Home** and **End** for the first and last tab.
- **Hide the panels** with the button at the top right of the bar.
- **Resize** by dragging the thin edge between the page and the bar. Frontier remembers the width per
  kind of screen.
- A **badge** on a tab, such as the number of open comments, tells you something is inside.
- Frontier remembers which tab you last had open on each kind of screen and whether the bar was open.

### On a phone

On a narrow screen (under about 770 pixels wide, so also a small window on a computer), the layout
changes so that the page gets the whole width:

| On a computer | On a phone |
| --- | --- |
| Left side bar beside the page | A **drawer** that slides over the page. Open it with the **menu button** (three lines) at the top left; it has the same content as the left side bar, with a **Close the side bar** button. |
| Rail | Not used |
| Right side bar beside the page | A **bottom sheet** that rises from the bottom of the screen. It has the same tabs. The **Hide the panel** button (a down arrow) closes it. It stops above any bar the page keeps at its foot, such as the editor toolbar or the map tools, and does not cover the whole page, so a map stays visible while you edit a feature. |
| Header with the page's own buttons | One slim **top line**: the menu button, the page's title, and the page's main action (such as Edit or Done). **Search** stays on the line. |
| Connection mark always in the side bar | Appears on the top line **only when something needs you**: no connection, unsent changes, or texts to compare |
| Folder tree rows dragged with the mouse | Folder rows are taller. **Dragging is switched off** on touch screens; use **Move to…** instead (see [The folder tree](#the-folder-tree)). The row buttons are always visible. |

A small dot on the menu button tells you something is waiting (unsaved changes or the Inbox).
While the drawer is open the page behind it is dimmed and cannot be used; press the dimmed area, or
**Close the side bar**, to go back. A new page closes the drawer on its own.

---

## The Home page

The Home page is the first thing you see after signing in, and the page the **Frontier** name and the
**Start** icon (in the rail) lead to.

Frontier opens your library's **README** entry if there is one. If there is no README, it opens the
first entry it finds. A brand-new own library has one welcome note, so that is what you will see first.
If the library has no entries at all, you will see "The vault has no notes yet." Press **New entry** to
begin.

> **Tip.** To choose what Home shows, name an entry `README` at the top of your library and write
> whatever you want to see on arrival: a table of contents, a to-do list, a map link.

---

## The folder tree

The **Library** section of the left side bar is a tree of your folders and entries. Folders come first
and then the entries inside them. A folder is shown with its icon, a small arrow to open or close it,
and its name. Entries are listed under their folder by name.

- **Open or close** a folder by pressing its arrow or its name.
- **Open an entry** by pressing its name.
- The entry you are reading is highlighted, and the folders above it open by themselves so you can see
  where it is.
- An entry with a draft that has not been saved as a version is shown in a different style, and so is a
  folder with such changes.
- A folder shows a small label: **empty** if nothing is inside it, or **moved** if it has been moved and
  the move is not saved yet.
- A note named like its folder (for example `Aldoria.md` inside the `Aldoria` folder) is treated as the
  folder's **own page**. It does not appear as a separate row. Pressing the folder's name opens it.

### Making a new entry

There are several ways to start a new entry. All open the **New entry** window:

- Press **New entry** in the side bar (or in the rail). The new entry starts in the folder of the entry
  you are looking at.
- Press the small **New entry** icon beside the **Library** heading. It starts at the top of the library.
- Hover over a folder row and press the **+** button (**New entry here**), or right-click it and choose
  **New entry here**. It starts in that folder.

In the window:

1. Type the **Name** of the entry.
2. Check the **Folder**. It starts as the one you came from. Type a few letters of another folder's name
   to find it, or choose **Top of the library**. If no folder matches, you can type a new name and
   choose **New folder "…"** to make one on the spot.
3. Press **Make the entry**.

The editor opens on a blank page. If the folder (or a folder above it) has a default type, the new entry
is given that type automatically.

Names must be safe for a file name. Frontier tells you if something is not allowed (for example a name
with a slash or a colon).

### Making a new folder

- Press the **New folder** icon beside the **Library** heading to make one at the top, or
- Choose **New subfolder** from a folder's menu to make one inside it.

Type the **Name** and press **Make the folder**. A new folder is empty until you put something in it.

### Moving things around

**By dragging (computer with a mouse or trackpad):**

- Drag a **folder** onto another folder to put it inside, or drop it between two folders to place it
  there. A line shows where it will land. Hold a folder over a closed folder for a moment and it opens,
  so you can drop it deeper.
- Drag an **entry** onto a folder to move it there.
- **Reordering:** folders can be put in any order by dragging them up or down among their neighbours.
  Entries are always listed alphabetically; you cannot reorder them.

**With the keyboard or a touch screen:** choose **Move to…** from the folder's menu, then type to find
the folder it should go into and press **Move**. (On a phone or tablet, where dragging is switched off,
this is how you move a folder.)

What happens when you move something:

- **A move of an entry, or of a folder that holds entries, is a change to be saved.** Links to the moved
  entries in other entries are rewritten when you save a version (or publish). A message appears:
  "Moved *Name*; links in 3 other entries will be updated when you save a version", with an **Undo**
  button for a few seconds.
- **A moved empty folder** only changes your folder settings and takes effect immediately, with Undo.
- You cannot move a folder into itself, or onto a name that already exists there.
- Moving needs a connection when entries are involved. While offline you can still move empty folders.
- A folder that has a move waiting to be saved cannot be moved again, renamed, deleted or given new
  settings until you save the version ("Save a version first").
- If an entry has changes still on their way to the server, wait a moment ("Wait until your changes are
  sent") and try again.

### The folder menu (and right-click)

Every folder row has the same actions in three places: a **⋯** (More) button on the row, a
**right-click** (a long press on touch screens), and the **menu key** on the keyboard (or
**Shift+F10**) when the row is selected.

| Action | What it does |
| --- | --- |
| **New entry here** | Opens the New entry window for this folder |
| **New subfolder** | Asks for a name and makes a folder inside this one |
| **Rename** | Turns the name into a text box. Type, then press **Enter**; **Esc** cancels. (Also **F2** on a selected row, or double-click the name.) |
| **Icon, colour and type…** | Opens the folder's style settings (below) |
| **Move to…** | Pick the folder it goes into |
| **Set type "…" on the entries here without one** | Shown only if the folder has a type. Gives that type to every entry in the folder that has none yet. Reports "Set the type on N entries, as unsaved changes." |
| **Delete…** | Deletes the folder and everything in it, after a confirmation |

Some actions are greyed out with a short reason beside them when they cannot be used, such as "Save a
version first", or "Not connected" for actions that need the server.

**Deleting a folder.** Frontier first counts what is inside and asks: "Delete *Name* and its 12
entries?" (or "Delete the empty folder *Name*?"). The entries are *marked for deletion* and only go
when you save a version. Until then, **Discard** on the Unpublished list takes them back.

**Renaming a folder** that holds entries is a change to be saved, and rewrites links to those entries,
just like moving it.

### Folder settings: icon, colour and type

Choose **Icon, colour and type…** from a folder's menu. A small window opens beside the folder. Every
choice is saved as soon as you make it; press **Esc** or click elsewhere to close it.

- **Icon.** Pick one of about 60 pictures (a folder, books, a castle, a ship, a crown, mountains, a
  skull, a dragon-friendly selection of animals, a feather and many more), or **No icon** for the plain
  folder.
- **Colour.** Choose one of eight colours: **ember, sea, moss, gold, plum, slate, rose, teal**, or **No
  colour**. The same colour is used for the folder's entries in the Graph. Each colour has a light and a
  dark version so that it reads well in both themes.
- **Type of new entries.** A drop-down of the entry types your library knows. Entries made in this
  folder get that type in their properties. The first option reads **No type**, or **From the folder
  above (type)** if a folder above this one has a type, which then applies here too. A type set on a
  folder applies to its subfolders unless they set their own.

> **Tip.** Colour and icon your top-level folders (Places, People, Histories…). You will find your way
> around a long tree much faster, and the Graph is coloured by folder.

### Keyboard in the tree

Click a row, or tab into the tree, then:

| Keys | What they do |
| --- | --- |
| **↑ / ↓** | Move between rows |
| **→ / ←** | Open or close a folder |
| **Enter** | Open the entry (or the folder's own page), or open/close a folder |
| **F2** | Rename the folder |
| **Menu key** or **Shift+F10** | Open the folder's menu |

---

## Finding things: the quick switcher and full-text search

The **quick switcher** is the fastest way to go to any entry, and it is also Frontier's full-text
search.

**Open it** with **Ctrl+K** (**⌘K** on a Mac) from anywhere, even while typing in a note, or press
**Search** in the side bar (or the magnifying glass on a phone's top line).

**Type** a few letters. After a fraction of a second, a list appears:

1. **Matches by name.** Entries whose name, or one of whose aliases, contains what you typed. When the
   match is an alias, the alias is shown large, with the entry's real title and folder in small print
   beside it. The folder path is shown as `Folder › Subfolder`.
2. **In the text.** From **two letters** on, Frontier also searches the **words inside every entry**
   and lists matches below, under the label **In the text**, each with a snippet of the surrounding
   words. Entries already listed by name are not listed twice.

Then:

| Key | What it does |
| --- | --- |
| **↓ / ↑** | Move through the results |
| **Enter** | Open the chosen result |
| **Esc** | Close the switcher |

Or simply click a result.

What you might see instead of results:

- "**Nothing found.**" Nothing matched. Try fewer letters.
- "**Full-text search needs a connection.**" You are offline: only name and alias matches work, from the
  copy of the library's index kept on your device.
- A message "**Can't reach Frontier. Check the connection, then try again.**" with **Retry**.

> **Tip.** The switcher is also the way to open an entry quickly by typing part of its alias. Give your
> entries aliases in their properties and you can reach them by any of their names.

---

## Keyboard shortcuts

Open the sheet of shortcuts at any time with **?** (a question mark), or choose **Keyboard shortcuts**
from the app menu. The sheet shows the shortcuts of the screen you are on, plus the ones that work
everywhere. It always matches what the keys really do.

In this guide, **Ctrl** means **⌘ (Cmd)** on a Mac. The sheet shows the right key for your computer. Plain
letter keys (such as **e** or **n**) do nothing while you are typing in a text box, so typing in a note
is never interrupted.

### Everywhere

| Keys | Action |
| --- | --- |
| **Ctrl+K** | Go to an entry (the quick switcher). Works even while typing. |
| **?** | Show keyboard shortcuts (not while typing in a text field) |
| **Ctrl+\\** | Fold or unfold the side bar (on a phone: open or close the drawer) |
| **↓ / ↑**, **Enter** | In the switcher: move through results, open the chosen one |

### In the editor

These work while you are writing an entry.

| Keys | Action |
| --- | --- |
| **Ctrl+B** | Bold |
| **Ctrl+I** | Italic |
| **Ctrl+U** | Underline |
| **Ctrl+Shift+X** | Strikethrough |
| **Ctrl+Shift+7** | Numbered list |
| **Ctrl+Shift+8** | Bullet list |
| **Ctrl+Shift+1** to **6** | Heading 1 to 6 |
| **Ctrl+Shift+0** | Plain paragraph |
| **Ctrl+S** | Save now (otherwise it saves about a second after you stop typing) |
| **Ctrl+Enter** | Done (leave the editor) |
| **Ctrl+J** | Writing help on the selection or paragraph |
| **Tab** | Indent. In a list, put the item under the one above. |
| **Shift+Tab** | Indent less |
| **Ctrl+Z** | Undo |
| **Ctrl+Shift+Z** or **Ctrl+Y** | Redo |
| **Esc, then Tab** | Leave the text and move to the next control (so the keyboard is never trapped in the editor) |
| **Enter** (in the Properties panel) | Keep what was typed in a property |

### In a table (inside the editor)

| Keys | Action |
| --- | --- |
| **Tab** | Next cell |
| **Shift+Tab** | Previous cell |
| **Ctrl+Enter** | Add a row below |
| **Ctrl+Shift+Enter** | Add a column to the right |
| **Ctrl+Shift+Backspace** | Delete this row |
| **Ctrl+Alt+Backspace** | Delete this column |

### On a map

Some map keys act only while **viewing**, some only while **editing**, and the sheet says which.

| Keys | Action |
| --- | --- |
| **e** | Edit the map (viewing) |
| **Ctrl+Enter** | Done editing |
| **v** | Select tool |
| **m** | Marker tool |
| **p** | Path tool |
| **z** | Zone tool |
| **r** | Measure tool |
| **w** | Label tool |
| **g** | Place with AI |
| **f** | Find areas tool |
| **x** | Find areas: clicks add or remove (Alt-click removes, Shift-click adds) |
| **Enter** | Find areas: make a zone of the chosen areas |
| **Esc** | Find areas: clear the chosen areas, then the selection |
| **d** | Find paths tool |
| **1 / 2 / 3** | Find paths: a river / a route / trace a painted line |
| **x** | Find paths: a river from its source or its mouth; a route's next way |
| **Enter** | Find paths: make the path |
| **Esc** | Find paths: clear what is proposed, then the selection |
| **b** | Suggest biomes tool |
| **1 / 2 / 3** | Suggest biomes: show the biomes / the temperature / the rainfall |
| **Enter** | Suggest biomes: accept the suggestion under the pointer |
| **Shift+Enter** | Suggest biomes: accept all |
| **Delete** or **Backspace** | Suggest biomes: skip the suggestion under the pointer |
| **x** | Explore: points of interest along roads and rivers, on or off (viewing) |
| **i** | Explore: show or hide the points of interest (viewing) |
| **]** / **[** | Explore: the next / previous point of interest (viewing) |
| **Space** | Explore: add or take out the point of interest at the cursor (viewing) |
| **a** | Explore: choose every spot along the path; again to clear (viewing) |
| **Enter** | Explore: ask what is at the places chosen (viewing) |
| **Esc** | Explore: close the card, then clear the choice, then leave the path (viewing) |
| **h** | Show or hide the relief of the terrain |
| **s** | Snap to other paths and zones, on or off (hold **Alt** to place freely) |
| **Ctrl+Z** | Undo (editing) |
| **Ctrl+Shift+Z** or **Ctrl+Y** | Redo (editing) |
| **Delete** or **Backspace** | Delete the picked point or the selection; while drawing, take back the last point (editing) |
| **Esc** | Stop, one step at a time: the focus box, the drawing, the tool, the point, the picks, back out of a group, the selection |
| **=** or **+** | Zoom in |
| **-** | Zoom out |
| **0** | Show the whole map |
| **Arrow keys** | Move the map |
| **Shift+arrow keys** | Move the map further |
| **l** | Show or hide the Layers tab |
| **t** | Turn time on or off |
| **Enter** | Finish the path or zone (editing) |
| **Ctrl+G** | Group the picked features, or add them to the picked group (editing) |
| **Ctrl+Shift+G** | Ungroup (editing) |
| **Enter** | Go inside the selected group; **Esc** comes back out (editing) |
| **c** | Straight or curved, while drawing or for the selected path or zone (editing) |
| **Enter** (in the Turn panel) | Turn the map to the typed angle |

### On the Graph

| Keys | Action |
| --- | --- |
| **/** | Find an entry in the graph |
| **Enter** | Open the selected entry |
| **Esc** | Clear the selection |
| **0** | Fit the graph |
| **=** | Zoom in |
| **-** | Zoom out |

### On a chronicle (timeline)

| Keys | Action |
| --- | --- |
| **Ctrl+Z** / **Ctrl+Shift+Z** | Undo / redo |
| **↑ / ↓** | Select the event above / below |
| **← / →** | Move the selected event earlier / later |
| **Shift+← / →** | Move it ten steps earlier / later |
| **Alt+← / →** | Move only its **end** earlier / later |
| **Alt+Shift+← / →** | Move only its **start** earlier / later |
| **Enter** | Edit its name |
| **d** | Edit its dates |
| **n** | Add an event |
| **Space** | Fold or unfold a group |
| **1 / 2 / 3 / 4** | Zoom to years / decades / centuries / millennia |
| **f** | Fit everything |
| **+** or **=** | Zoom in |
| **-** | Zoom out |
| **y** | Put the map year at the selected event's start |
| **Delete** or **Backspace** | Delete the selected event |
| **Esc** | Deselect and close the details |

### In windows, menus and lists

These work wherever a window, menu or list is open.

| Keys | Action |
| --- | --- |
| **Esc** | Cancel a question, close a menu, a list or the image viewer |
| **Enter** | Answer a question with its main button |
| **↓ / ↑** | Move through a menu or a list |
| **Enter** or **Space** | Choose the item in a menu or a list |
| **← / →** (image viewer) | Previous / next image |

---

## Saving and the signals that tell you how it is going

You rarely have to think about saving: **Frontier saves as you work**. But it is good to know what the
signals mean, especially when your connection is poor.

### How saving works

1. As you type in the editor (or change a map or a chronicle), your change goes into a **queue on your
   device**. About a second after you stop, Frontier sends it to the server, where it becomes your
   **draft**.
2. If the server cannot be reached, the change simply **waits on your device** and is sent when the
   connection returns. Nothing is lost, even if you close the tab (the queue is kept in the browser).
3. When you are happy with a body of work, you **save a version** (or **publish**) from the
   [Unpublished list](#reviewing-and-saving-your-changes-the-unpublished-list).

### The save status line

The editor (and the map and chronicle pages) shows one short line saying where your latest changes are:

| What it says | What it means |
| --- | --- |
| **Saved as a draft** | The server has your change. |
| **Saving…** | On its way. |
| **Unsent: kept on this device** | The server could not be reached or you are signed out. Your change is safe on this device and will go automatically. |
| **Not saved** | The server refused the change. The reason is shown. Look at the **Unsent** list (below) for Retry. |
| **Two texts to compare** | The entry was changed on two devices. See [Two texts to compare](#two-texts-to-compare) later in this chapter. |

On an entry page, a note under the title also says where you stand: "**Not saved yet**" (or "Not
published yet") for a rename or move; "**Not sent yet: this text is on this device and goes to the
server when it can**"; "**A new entry, not published yet**"; "**You are reading your unpublished
draft**" with a **Review and save** (or **Review and publish**) link; and "**Marked for deletion**".

### The connection mark

The connection mark lives in the footer of the side bar (and on a phone's top line when something is
wrong). It is the one honest answer to "can Frontier reach the server?".

| Mark | Meaning | What you can do |
| --- | --- | --- |
| **Connected** (cloud icon) | All is well. | Nothing. |
| **Not connected** (crossed cloud), maybe with "· 2 changes waiting" | Frontier cannot reach the server. | Keep working on what is on your device. Press **Retry** to try again now; it also retries by itself. |
| **Signed out** (alert icon) | Your session ended. | Press **Log in** to open the Log in again window. |

In the rail the mark is an icon only; hover over it for the words.

### The Unsent list

When changes are waiting on your device, an **Unsent** button with a count appears beside the
connection mark. Press it to see the list titled **Not sent yet**. For each file it shows the name (a
link to the editor, map or chronicle), how long ago the change was made, and any error. For changes that
the server refused, two buttons appear:

- **Retry**: send it again.
- **Discard**: throw away that unsent change. A confirmation says it exists only on this device and
  that what the server holds stays as it is.

Hover over the button to see whether the changes are kept on this device ("Changes kept on this
device, not sent yet") or not ("Changes are not kept on this device"). The second case happens only if
the browser does not allow storage; then the changes are lost if you close the page.

### The Compare signal

If you edit the same entry on two devices (say a phone on the train and a laptop at home), the second
device to send may have started from older text. Frontier never merges prose behind your back. Instead
it **keeps both texts** and shows a **Compare** item in the side bar (and "Two texts to compare" as the
save status). See [Two texts to compare](#two-texts-to-compare) below for how to resolve it.

---

## The Status page

Choose **Status** in the app menu. It is the page to open when something seems off.

At the top it lists facts about your library: when it was **last fetched** from its source, the commit
the search index was **built from** (with "out of date" if the index is behind), the **last publish**,
the **last backup** (with any backup error), and the number of **unpublished changes**.

If your library is Frontier's own and is only backed up on the same disk, a banner warns you to set up
a storage bucket for backups and to **Export the library** now and then (a link is provided). This is
a matter for whoever runs your server; the advice for you is to export copies now and then.

Under **Needs your attention** are lists of things that may need a look. Each shows "None." when all is
well, and a count when not:

| List | What it means |
| --- | --- |
| **Texts from other devices to compare** | Entries with a kept second text. Each links to the compare screen. |
| **Links that match more than one file** | A `[[link]]` that could point to two entries. Rename one, or write the link more exactly. |
| **Image names used more than once** | Two images share a name, which makes links to them ambiguous. |
| **Unresolved links in append-only files** | Links in files Frontier will not edit that point at nothing. |
| **Files that mix two kinds of line endings (read-only)** | Technical: such files are shown but cannot be edited. |
| **Fields that cannot be read** | An entry's properties contain something Frontier cannot understand. The entry is listed with the problem. |
| **The same id in two entries** | Two entries claim the same identifier. |
| **Notes that almost share their folder's name** | A note named nearly like its folder (such as a spelling difference), which would otherwise be the folder's own page. |

---

## Installing Frontier as an app

Frontier can be installed so that it opens in its own window, has its own icon, and keeps a copy of
your recent work for offline use.

There is no install button inside Frontier; use your browser's own:

- **Chrome or Edge on a computer:** open the browser menu, or look for the install icon at the right of
  the address bar, and choose **Install Frontier**.
- **Android (Chrome):** open the menu and choose **Install app** or **Add to Home screen**.
- **iPhone or iPad (Safari):** press **Share**, then **Add to Home Screen**.

> **Important for iPhone and iPad.** Safari clears a website's stored data after about a week of not
> using it, **unless the site is on the Home Screen**. For Frontier's offline copy to last, you must
> add it to the Home Screen. The first time Frontier stores something for offline use in plain Safari,
> a card appears explaining this (and **Dismiss** hides it). The Home Screen app has **its own
> storage**, so before you switch, send any waiting changes from Safari, then **log in once in the
> Home Screen app**.

You can reread the same advice at any time under **Settings, Offline copy**.

---

## Updates, toasts and problem messages

### The update bar

When a new version of Frontier is available, a bar appears above the page: **A new version of Frontier
is ready**, with **Reload** and **Later** buttons.

- Frontier **never reloads by itself**, so it never interrupts your writing.
- It shows the bar only when nothing is being sent and you are not in the middle of typing in an editor.
- **Reload** takes the new version in every open Frontier tab at once. **Later** hides the bar for now.
- Moving between pages makes Frontier look for a new version (at most once a minute).

Two other messages can appear after an update:

- **Close or reload your other Frontier tabs to finish updating** (a banner): another tab still runs the
  old version.
- **Frontier was updated in another tab. Reload this tab.** (a full-page notice with a **Reload**
  button): this tab let go of the stored data so the other could update. Press **Reload**.

### Toasts

A **toast** is a small message that slides in at the bottom of the screen and goes away by itself
after about 4 seconds, or about 8 seconds if it has a button (such as **Undo**). Press **Dismiss** (the
small ×) to close it sooner. Toasts confirm what just happened ("Moved the folder *Places*.") or give a
short reason something did not work. Screen readers announce them.

Toasts with **Undo** are your safety net for moves. If you miss one, a move can be undone from the
Unpublished list (**Cancel rename**).

### Problem messages

When something cannot be shown or done, Frontier writes a **Problem** line in the place the content would
be: an alert icon, the reason in plain words, and a **Retry** button when trying again might help.
Some problems also say **Open Settings** and link to the place where you can fix it (for example, a
missing AI key). Press **Retry** once your connection is back.

---

## Working offline

Frontier is built to keep working when the connection drops: on a train, on a plane, or when the signal
is poor.

### What works with no connection

- **Opening Frontier.** If you were signed in within the last 30 days, Frontier opens without the
  server, with the Not connected mark, and checks your session when it can.
- **The whole folder tree, the quick switcher by name and alias, `[[` link suggestions and the Graph.**
  They run from a compact index of every entry kept on your device.
- **Reading and editing recent work.** Your device keeps the full text of the **last 30 entries, 5 maps
  and 5 chronicles** you opened, with their images. Open them, read them and edit them as usual.
- **Making new entries** in any folder.
- **Editing maps and chronicles** that are on the device, and changing folder icons, colours, types
  and order, and map styles.

Everything you change offline waits in the queue and is sent, in order, when the connection returns.

A page read from the device says so: **Offline copy from 14:05** (or "yesterday, 18:40", or a date).
When the connection returns, the page reads the server's copy again.

### What needs a connection

These are marked or greyed out while you are offline, usually with "Not connected" as the reason:

- Renaming or moving entries, moving or deleting folders that hold entries
- Creating, copying or deleting maps and chronicles
- Uploading, pasting or dropping images; importing from a web address
- AI features, comments, an entry's history
- Full-text search (the "In the text" results)
- Export, Import, the Inbox, **Save a version / Publish**, most Settings pages, hover previews
- Logging out

### An entry that is not on the device

If you open an entry that is not among your recent ones while offline, Frontier says "**{name} is not
on this device. It opens when you are connected.**" It still shows the folder it lives in and the entries
it links to and that link to it, as links you can follow. When the connection comes back, the entry
opens by itself.

### Keeping the offline copy

The copy is kept up to date in the background while you are online. Frontier also asks the browser to
keep it. You can see its size and remove it under **Settings, Offline copy** (see below). Logging out
removes it.

> **Tip.** Before a journey, open the entries, maps and chronicles you want to work on. The device keeps
> the last 30 entries, 5 maps and 5 chronicles *opened*, so opening them is how you choose what comes
> with you.

---

## Settings

Choose **Settings** in the app menu. Settings is divided into sections in four groups.

- **On a computer**, a list of sections is shown at the left of the Settings page. Settings opens at
  the first section that needs attention (for example Providers, if no AI key works yet).
- **On a phone**, Settings is a list. Each row shows a one-line state such as "Connected: OpenRouter",
  "$1.20 of $10", or "2 passkeys". Press a row to open that section, and **‹ Settings** to go back.
- Each section has its own address, so the browser's Back button works.
- **Offline**, only **Offline copy** works. The banner says "No connection: only Offline copy works
  now." The other sections open by themselves when the connection returns.

| Group | Section | What it holds |
| --- | --- | --- |
| AI | **Providers** | Connect the services that run the AI |
| AI | **Models** | Choose one model for each AI task |
| AI | **Spending** | Monthly cap and a record of every AI call |
| AI | **Propose for a folder** | Have the AI propose fields for a whole folder of entries |
| Library | **Types and dates** | The list of entry types and date names |
| Library | **Backups and export** | The last backup, and links to Export and Import |
| This device | **Offline copy** | What this device keeps for offline use |
| Account | **Signing in** | Passkeys, the password switch, and Log out |

The AI settings only matter if you want to use Frontier's AI features (Ask, writing help, proposing
fields, concept art). The rest of Frontier works without them.

### Providers

A **provider** is a service that runs AI models. You connect one with a key you get from that service.
Keys stay on your server; Frontier only ever shows the last few characters.

If no providers are connected yet, the page says **Connect a provider** and offers a list. Press a
provider to open its key box.

| Provider | Notes |
| --- | --- |
| **OpenRouter** | One key for models from many makers |
| **Anthropic** | Claude, directly (keys at console.anthropic.com) |
| **OpenAI** | GPT and image models (platform.openai.com) |
| **Google AI Studio** | Gemini (aistudio.google.com) |
| **xAI** | Grok (console.x.ai) |
| **Mistral** | Mistral's models (console.mistral.ai) |
| **DeepSeek** | DeepSeek's models (platform.deepseek.com) |
| **Groq** | Fast open models (console.groq.com) |
| **Other, OpenAI-compatible** | Any server that speaks OpenAI's chat format, such as one running on your own machine. You give its **Address** (starting with https://) and a **Name**. |

To connect one:

1. Press the provider.
2. Paste the key into the box. The eye button (**Show the key** / **Hide the key**) shows what you typed.
   Frontier warns you if the key does not start the way that provider's keys usually do.
3. Press **Check and save**. Frontier asks the provider to list its models (which is free) to prove the
   key works. Only a working key is stored.
4. If the provider cannot be reached, a **Save anyway** button lets you store the key unchecked.

If a key is refused, the message says why; fix it with **Replace key**.

Each connected provider shows a status: **Connected**, **Key refused**, **No key**, **Switched off**, or
"The stored key can't be read. Enter it again." It also shows when it was last checked, whether it
**reports what each call costs** or whether costs are **estimated from prices**, and which tasks use it.

Buttons on a provider's row: **Check again**, **Replace key** (or **Add key**), **Switch off** / **Switch
on**, and **Remove**. Removing a provider that a task uses turns that task off until you choose another
model; Frontier tells you which.

If a banner says the server cannot store keys, the person who runs your server must set it up; that is
outside this guide.

### Models

Frontier uses three AI **tasks**, each with its own model:

| Task | What it does |
| --- | --- |
| **Proposing fields** | Reads an entry and suggests dates and types for the Inbox |
| **Lore conversations** | Ask, writing help, talking to characters, exploring a map, and comments |
| **Concept art** | Pictures for discoveries, made when you ask |

For each task you see its chosen model, with its provider, size of memory (context) and price per
million words-worth ("in" and "out"). A choice is saved the moment you make it, and a toast offers
**Undo**.

- If a task is **Off** and a provider is connected, you see **Use *name*, recommended** and **Choose a
  model**.
- **Change** (or pressing the model) opens the **model picker**: a search box ("Search models"), filter
  chips (**Fits this task**, **Reads images**, and one chip per provider), and a **Sort** drop-down
  (**Recommended**, **Price**, **Name**). The search forgives a missing letter and matches name, id and
  provider. Models are grouped by provider and the details of the highlighted model show beside the
  list (or under an **ⓘ** on a phone, where the picker is a full-height sheet). Use **↑ / ↓** to move,
  **Enter** to pick, **Esc** to close without changing anything.
- If a model's price is not known, Frontier asks you to enter it so spending can be counted.
- **Try it** sends a tiny test request to the chosen model and shows the result and its cost. For
  concept art it asks first, because a picture costs a few cents.
- **Turn off** switches the task off.
- Warnings appear if the model is no longer listed by its provider, or its provider is switched off or
  refused its key, with a link to fix it.

Two extra options live with the tasks:

- **Style of concept art** (under Concept art): text, up to 600 characters, added to every picture's
  description.
- **Propose fields for the entries of each publish** (under Proposing fields): when ticked, each time
  you save a version (or publish), the AI reads the entries in it and sends proposals to the Inbox.

### Spending

- A line such as "**$1.20 of a $10 cap · November**" with a meter. Click into the dollar figure to change
  the **monthly cap**; it saves when you leave the box or press Enter. The cap resets on the 1st of the
  next month. If you set it below what has been spent, a warning says AI stops until next month.
- **By provider:** a table of calls, cost, and **how we know** (reported by the provider, or estimated).
- **Calls:** a log of every AI call for the month, with when, what for, model, tokens and cost. Use the
  **‹ month** and **month ›** buttons to go back and forward, and **Failed only** to see only the calls
  that failed.
- The cap is Frontier's own. For a hard limit, also set one with each provider (links are provided).

When Frontier stops an AI call because the cap is reached, the message links straight here with the cap
box ready to change.

### Propose for a folder

Reads every published entry in a folder, one at a time, and puts what it finds in the
[Inbox](#the-inbox). **Nothing is written to an entry until you accept it there.**

1. Choose the **Folder** (or **The whole library**).
2. Press **Estimate** to see how many entries and about what it will cost. Entries read before cost
   nothing again.
3. Press **Start**. Progress is shown ("Running: 14 of 120 entries read…"). **Cancel** stops it.
4. When it finishes, **Open the inbox**.

It needs a model for **Proposing fields** (the page links you to choose one if there is none).

### Types and dates

Shows the list of **entry types** and the names Frontier knows for dates (such as "founded", "died"),
as a count, with **Show the list** to read it. If Frontier is using its built-in list, you can **Copy**
it; to change it, a file named `.frontier/schema.yaml` is saved in the library with your own list. If
that file has a mistake, the problem is shown here.

### Backups and export

Shows the **last backup** time, and the warning about backing up only to the server's own disk, if it
applies. It links to:

- **Export the library**: as Markdown files, a web page or a PDF.
- **Download the whole library**: a zip of the vault.
- **Import**: notes and pictures into the library.

### Offline copy

Works without a connection. It explains that Frontier keeps the entries, maps and chronicles you opened
last on this device so they open with no connection, shows the **Space used** (for example "41 MB"), and
has one button:

- **Remove everything on this device**: after a confirmation ("Remove the copies of entries, maps and
  chronicles on this device? Changes not sent yet stay."), deletes the offline copy. It is rebuilt as you
  open things again.

On an iPhone in Safari it also shows the Home Screen advice (see [Installing](#installing-frontier-as-an-app)).
If the browser does not allow Frontier to keep anything on the device, it says so.

### Signing in (Settings)

- **Passkeys.** A list of your passkeys with the date each was added and a **Remove** button (with a
  confirmation).
- **Add a passkey on this device.** Type a name for it, such as "Phone", then press **Add a passkey**.
  Your device asks you to confirm. Without a name Frontier asks you to "Give the passkey a name first".
  After adding one, Frontier suggests you log out and try it before you switch the password off.
- **Switch the password off.** This tick box appears once you have at least one passkey. With it ticked,
  the password no longer logs in. You can only switch it off while signed in *with a passkey*, which is
  why it says "(log in with a passkey first)" otherwise. Tick it again to bring the password back. If
  you are ever locked out, the person who runs your server can switch the password back on with the
  server's set-password command.
- **This session: Log out.**

> **Tip.** Keep the password switched on until you have added a passkey on every device you use and
> tested it.

---

## Reviewing and saving your changes: the Unpublished list

Choose **Unsaved** (or **Unpublished**) in the side bar. This is where drafts become part of the
library's history.

The page is titled **Unsaved changes** (or **Unpublished changes**) and begins with a reminder of what
happens: in an own library, "Drafts are kept as you type. Saving a version records them in the library's
history, with a line saying what changed." If nothing is waiting, it says "Nothing is waiting.
Everything you wrote is saved."

### What is listed

Each item has a tick box (all are ticked at first) and a coloured tag:

| Tag | Meaning |
| --- | --- |
| **New** | An entry (or image, map, chronicle) that did not exist before |
| **Edited** | An existing one that you changed |
| **Deleted** | One marked for deletion |
| **Renamed** | An entry or folder renamed or moved, shown as `old name → new name` with how many other entries' links will be rewritten |
| **Review decision** | An Accept or Revert you chose in the Inbox that waits to go out with this version |

For each draft you can:

- Press **Show changes** to see a difference view: the old text against the new, line by line.
- Press **Keep editing** to open it in the editor (or **Open the map** / **Open the chronicle**).
- Press **Discard** to throw the draft away (after a confirmation: "The text you wrote is thrown
  away.").
- For a rename: **Cancel rename** puts things back.

If a draft holds text the AI wrote in a lore conversation, a note asks you to read it before saving.

Untick anything you do not want in this version; it stays a draft for later.

### Saving a version (own library)

1. Press **Review N changes**.
2. Frontier shows **What will be saved**: the files that are **Ready**, any **Renames**, and so on.
3. Type **What changed, in a line**, for example "Add the Saltmother entry". This is required, up to 200
   characters. It is what you will read in the history.
4. Press **Save a version**. A banner confirms "Saved as a new version."
5. **Back** returns to the list without saving.

### Publishing (shared library)

The steps are the same with the words Publish and **Review before publishing**, and the banner reads
"Published as commit *abc1234567*." Because other people or tools may have changed the vault since you
began, the review has extra parts:

- **Ready**: will go as they are.
- **Changed in the vault too: confirm the combined text.** Someone else changed the same file in a
  *different* place from you. Frontier shows what the file would become with both changes, compared with
  what is in the vault now. **Tick a file to publish it** after you have read it.
- **Held back.** Files where your change and the vault's collide. Each says why in plain words:

  | Message | What happened |
  | --- | --- |
  | You and someone else changed the same lines. | A real text clash. Press **Resolve**. |
  | A file with this name was added to the vault meanwhile. | A new entry's name was taken. |
  | This file was deleted from the vault meanwhile. | You edited something that no longer exists. |
  | This file was changed in the vault after you chose to delete it. | |
  | This image was changed in both places. | |
  | This map / chronicle / the map styles / the biomes were changed here and in the vault in the same places. Keep one of the two. | Press **Keep my map** (or chronicle, or styles) or **Take the vault's**. |
  | This rename cannot be carried out. | The reason is shown. |

  The rest can still be published now, while the held-back files wait.

If the vault moves again while you review, Frontier says so and **nothing is published**; review again.

---

## When a file changed in two places

There are two different screens for this, and it helps to keep them apart.

### Resolve (a shared library only)

Pressing **Resolve** on a held-back file opens the **Resolve** page. It is for the case where you and
someone else changed the same lines.

1. At the top you see **In the vault now, compared with your version**: a line-by-line difference.
2. Below is **Your version** in an editor. Edit it until it is the text you want, taking what you need
   from the vault's version. Frontier does not merge anything for you.
3. Helpful buttons: **Start from the vault's** replaces your editor text with the vault's, and **Discard
   mine** throws away your version (after a confirmation; what is in the vault stays as it is).
4. Press **Save as resolved**. This does not publish; it marks your text as building on the vault's, and
   returns you to the list, from which you review and publish again.

If the page says "Open this from the review of your unpublished changes", you came to it directly;
go to the Unpublished list and press **Resolve** there.

### Two texts to compare

This one happens in **both** kinds of library. It appears when you edited the same entry on more than one
device and an older device sent its text later. Nothing was lost: Frontier keeps each device's text beside
your draft. You are told by a **Compare** item in the side bar, by a **Two texts to compare** line on the
entry's editor, and by the Status page.

Open it from **Compare** (or from the Status page). The page is titled **Two texts to compare** (or "3
texts to compare" if more than two devices are involved), and explains the situation.

1. If there are several kept texts, pick one by the buttons at the top (each is labelled with the device,
   "This device", "Another device", or its name, and the time).
2. Read the difference: **The text from *device*, compared with the draft**.
3. Choose:
   - **Keep this one** keeps the other device's text.
   - **Keep the draft** keeps what you have on the server.
   - **Or combine them by hand**: edit the text in the box, then press **Keep this text**.
4. Keeping one clears all the kept texts and returns you to the Unpublished list.

### Changed in both places (maps, chronicles and folder settings)

For a map, a chronicle, or a library file such as folder settings or map styles, Frontier compares item
by item (a marker, a span of time, a folder's colour), and merges changes that touched *different* items
by itself. When the same item was changed on two devices, your side stays and the other side is kept.
The **Changed in both places** page shows, for each such item, a small table with the two versions
side by side (your current one and the server's copy at a time). It is read-only: if you prefer the
other version, change the item by hand on the map or chronicle's own page, then press **Dismiss**.

---

## The Inbox

The **Inbox** (in the side bar, with a count badge) is where things *other than you* propose changes to
your library wait for your decision. Nothing in it changes your library until you accept it, and
accepting makes it an unsaved (unpublished) change of yours, which you still review and save as usual.

The Inbox page begins "What agents and Frontier's own AI propose waits here." If nothing is waiting, it
says "Nothing is waiting for you." It can hold three kinds of thing.

### Proposed fields

When the AI reads an entry for its dates and type (see [Propose for a folder](#propose-for-a-folder) and
the Models option **Propose fields for the entries of each publish**), the proposals appear under the
entry's name. For each one you see its kind (**Date** or **Type**), the value, and for dates the
**sentence it came from**, quoted. Choose:

- **Accept**: adds the field to the entry as an unsaved change.
- **Edit**: lets you correct the value (**What happened** and **When** for a date, **Type** for a type)
  before accepting. Press **Done editing** when finished.
- **Reject**: discards the proposal.
- **Dismiss**: shown instead, with "No longer applies: this sentence is not in the entry any more."

### Agent branches (shared library)

If your library is shared through GitHub and a helper (an agent, a script, another tool) pushed its
suggestions to a branch, each branch appears with the list of commit lines and its files, each tagged
**New**, **Changed** or **Removed**. For each file:

- **Show changes** opens the difference (or an image preview for a picture).
- **Accept** takes the file as an unpublished change of yours.
- **Accept and edit** takes it and opens it in the editor at once.
- **Reject** discards it.
- A file that Frontier cannot accept (for example a type it will not take) says "Can only be rejected"
  with the reason.

You can also **Reject all that is left** on a branch, or **Remove the branch** once every file is
decided. Deciding the last file removes the branch from GitHub; a rejected file is then gone.
Branches that are empty, share no history with the vault, or change more than 200 files can only be
rejected as a whole; the page explains which applies.

### Arrived unreviewed (shared library)

Notes pushed straight to the vault by someone other than you appear under **Arrived unreviewed**, with
who pushed them. They stay out of the AI's memory bank until you **Accept** or **Revert** them. Your
decision becomes a **Review decision** line in the Unpublished list and goes out with your next
publish. If a file cannot be put back, only **Accept** is offered ("Can only be accepted").

> **Own library.** The agent-branch and arrived-unreviewed parts do not apply to an own library, because
> nothing but Frontier writes to it. There you will only see proposed fields.

---

## Import

Choose **Import** in the app menu to bring existing work into your library. There are two parts on the
page.

### Notes and images

For a handful of files.

1. Under **Files**, press the file chooser and select one or more files: Markdown notes (`.md`) and
   images.
2. Under **Folder for the notes**, type the folder the notes should go in (start typing to see your
   folders), or leave it empty for the top of the library. Images go with the other images.
3. Press **Import N files**.

The files arrive as **unsaved (or unpublished) changes** for you to read first. The result lists what was
imported (each note links to its entry) with a **Review and save** link, and:

- **Notes that already exist** in that folder are not overwritten silently. You are told which, and you
  choose for them: **Replace with the imported text** (the existing note shows as a change, with the
  difference), or **Keep both** (the new one gets a numbered name).
- **Not imported**: files Frontier refused, each with the reason. Other kinds of file are refused. A
  single file may be up to 25 MB.
- An image whose name already exists gets a numbered name, because links to images go by name.

### A whole vault

For the first move from Obsidian, or to bring in a big batch.

1. Under **Zip**, choose a zip file of an Obsidian vault, or of a repository downloaded from GitHub.
2. Under **What this version is, in a line**, write a description, such as "Import a vault".
3. Press **Import the vault**.

Its files are added to the library and saved **as one version** straight away: "N files were added or
replaced, as one saved version." Files that exist are replaced; **nothing is deleted**, and what was
replaced stays in each entry's history. A single top folder in the zip (as GitHub's downloads have) is
removed, and `.git` is left out. A vault zip may be up to 1 GB. A link takes you to the versions.

> **Tip.** You can always get your work out again: **Export** (in the app menu) gives the whole library
> as a zip that opens in Obsidian.

---

## History of the library

Choose **History of the library** in the app menu. The page is titled **Versions** and lists "the last
hundred saved versions of the library", newest first. Each shows when it was saved, the line you wrote
about it, and how many files it changed. Press the count to see the files; each Markdown file links to
that entry's own history, where you can read earlier text and bring a version back. A link on the page
exports the whole library as a zip.

This is the place to see what you did last Tuesday. Because every saved version has your one-line
description, a clear line when you save makes this page useful.

An entry's own **History** panel (on its page) lists only the versions that touched that entry, and has
**Restore this version**, which puts that older text into a new draft; the restore is itself saved as a
new version, so nothing is lost.

> **Do not confuse the two "version" pages.** *History of the library* (this page, titled Versions) is a
> list of saved versions. *Two texts to compare* is the page for resolving an entry that changed on two
> devices.

---

## Troubleshooting

**I cannot sign in.**
Check the password for typos and the Caps Lock key. If a passkey was set up and the password switched off,
use **Use a passkey**. If you are locked out of both, the person who runs your server can switch the
password back on.

**The mark says "Not connected".**
Check your internet connection and press **Retry**. Keep working: changes wait on your device (the
**Unsent** count shows how many) and are sent when you are back. If it never recovers but other sites
work, tell whoever runs the server.

**The mark says "Signed out".**
Your session ended. Press **Log in** (or the dialog that opened) and sign in again. Nothing is lost.

**An Unsent change says "needs attention".**
The server refused it. Open **Unsent**, read the reason, and press **Retry**. If it still fails, copy the
text you need and press **Discard**.

**"Save a version first" or "Wait until your changes are sent".**
You tried to move, rename or delete something that still has a change waiting. Save a version (or wait
for the Unsent count to clear) and try again.

**I deleted something by mistake.**
If you have not saved a version since, open **Unsaved** and press **Discard** on the deletion (or, for a
folder's entries, discard them). After a version has been saved, open the entry's **History** and
**Restore this version**.

**The quick switcher does not find text.**
Searching inside entries needs two letters and a connection. By name and alias it works offline.

**An entry says "not on this device".**
You are offline and have not opened it recently. Reconnect; it will open by itself.

**Something looks wrong with my links or fields.**
Open **Status** and look under **Needs your attention**.

**The page looks out of date after an update.**
Press **Reload** on the update bar, or reload the tab. If the notice says another tab is holding up the
update, close or reload your other Frontier tabs.

**I use an iPhone and my offline copy disappeared.**
Safari clears unused sites' data after about a week. Add Frontier to the Home Screen (see
[Installing](#installing-frontier-as-an-app)).

**Dragging does not work on my tablet.**
Dragging is switched off on touch screens. Use **Move to…** from the folder's **⋯** menu.
