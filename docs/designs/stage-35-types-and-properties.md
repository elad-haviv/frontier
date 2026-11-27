# Stage 35: types that give their entries properties

- **Author:** Elad Haviv
- **Status:** Approved on 2026-11-27 ("go ahead and implement it"), with every recommendation in
  "Decisions". "As built" notes are at the end.
- **Parents:** [Stage 3, fields](stage-3-review-and-ai-basics.md), [stage 18, settings](stage-18-settings.md),
  [stage 27, talk with a character](stage-27-talk-with-a-character.md), [stage 31, people and projects](stage-31-people-and-projects.md)
- **Mockup:** https://claude.ai/artifact/DeSuNRe5TKSgWeqaFN5ZKn (Settings: a type, and an entry
  beside what a reader sees and what is written to the file; desktop and phone). The first round, a
  page that only edited the two lists, is its version 1.

## What was wrong

1. **Settings › Types and dates was a block of YAML you could only copy.** To change anything you
   had to create a hidden file, `.frontier/schema.yaml`, outside Frontier. In a project Frontier
   keeps itself there was no way to do that at all.
2. **It could show a mapping that was not in use.** Since the folder file, a folder's type comes
   from the tree's folder settings and the YAML's folder lists are ignored.
3. **The built-in list carried Avalymia's folder names**, so a new project showed "03 Gazetteer
   (Places & Locations)" too.
4. **It spoke in file terms** (`what`, `begins: true`, `{}`) and gave no usage: not how many
   entries have a type, nor that an entry carries a word the list lacks.
5. **A type did almost nothing.** It was a word on the entry, a default for a folder, a list the AI
   chose from, and one thing fixed in the code: "Talk with …" appeared only on entries that wrote
   `type: person` or `type: deity`. A person who had the type only from their folder got no link.

## The idea

A type is a template. It says which properties its entries have, may give some of them a value,
and names the dates its entries usually have. An entry of the type shows those properties as
fields, empty until filled, and can still add properties of its own. Entries already had such
properties (text, number, date, checkbox, list, link to an entry), added one at a time; the type
now decides which are there from the start.

Some properties mean something to Frontier. The first is `chattable`: when it is on, readers can
talk with the entry as a character. The type gives it, and one entry can switch it off, or on.

## Where things are

- **Settings › This project › Types and dates.** The list of types (name, entries, its
  properties), and beside it one type's page: its folders, its properties, its usual dates. Below,
  the names for dates, each a Start, an End or a Moment. At the top, a notice for each word entries
  carry that is on neither list, with "Add …". Owners change; writers and readers read.
- **An entry's Properties panel.** "As a person": the type's properties as fields. A value the type
  gives shows as "from the type" until the entry sets its own; "Back to the type's" undoes that.
  Then "This entry's own", each with "Give to every person" for an owner. The type's usual dates
  are offered as rows ready to fill.
- **An entry's page.** The type's properties that have a value, the type's own value included,
  then the entry's own. `chattable` is not shown; it decides whether "Talk with …" is there.
- **Phone:** the type list, then a type's page with a way back; a property is two lines. The same
  happens on a desktop when the page is narrow (the library pane open).
- **Keyboard:** Enter adds; a rename is a field, Enter keeps it and Escape leaves it; Start / End /
  Moment is a radio group moved with the arrow keys.
- **Empty states:** a type with no properties, no folder or no usual dates says so; an unused type
  says "unused"; with every type deleted the list explains itself and offers the usual nine back.

## Kinds of property

Text, number, date, checkbox, list of text, one of a few choices, and four links: to an entry, a
map, a chronicle, a tree. Every link is chosen by typing part of a name.

- A link to an entry can say which type it points at ("species links to a people"); those entries
  are listed first, the rest stay reachable.
- A link to a map or a chronicle can point inside it: after the map, a place on it; after the
  chronicle, an event. The link then opens there. A timeline is a chronicle's drawing, so there is
  one kind, "Link to a chronicle".
- A property is for a link the author chooses, such as a city's own street map. What Frontier works
  out by itself ("On chronicles: …", "On maps: …", from markers and events that point at the entry)
  stays as it was.

## Decisions

1. **The type's values are not copied into entries.** An entry reads them from its type, so
   switching `chattable` off on "person" changes every person at once and files stay short. The
   cost: in Obsidian, outside Frontier, a person does not show `chattable: true` unless the entry
   wrote it.
2. **Properties Frontier understands are ordinary properties with a fixed name**, marked "Frontier
   uses this", starting with `chattable` only. Person and deity have it on to begin with, so
   nothing changes until the owner changes it.
3. **Dates per type.** A type names its usual dates; the list of names with Start, End or Moment
   stays one list for the project.
4. **Links know what they point at**, and "one of a few choices" is a kind.
5. **Links to maps, chronicles and trees** are written by id (`map/h7c3n1qe`, with `#place` or
   `#event` for a spot), so renaming a map breaks nothing and Frontier shows the name. In Obsidian
   it reads as a code.
6. **Frontier keeps all of it in its own file**, `.frontier/types.json`, a library item file like
   folders and trees: saved through the unsaved changes, merged type by type. An existing
   `schema.yaml` is read once as the starting point and then left alone.
7. **Rename reaches into entries; delete does not.** Renaming a type, a type's property or a date
   name rewrites every entry (and folder) that writes the word, and says how many first. Deleting
   leaves entries alone: a word they wrote stays and is listed at the top of the page.
8. **Folders are editable on the type**, writing the same folder file the tree writes.

## The file

```json
{
  "version": 1,
  "types": [
    {"name":"person","props":[{"key":"species","kind":"link","to":"people"},{"key":"chattable","kind":"checkbox","value":true}],"dates":["born","died"]}
  ],
  "what": [{"name":"born","begins":true},{"name":"died","ends":true},{"name":"happened"}]
}
```

One type to a line. A property has `key`, `kind`, and where it applies `to` (a type, for a link),
`options` (for a choice) and `value` (what every entry gets). An entry's frontmatter holds only
what the entry itself sets.

## As built

- `packages/schema/src/entryTypes.ts`: the file, `SYSTEM_PROPS`, `isChattable`, `givenProps`, the
  renames within the file. `packages/vault/src/properties.ts`: the kinds `map`, `chronicle`, `tree`
  and `thingOf` / `thingValue`.
- Server: `types/store.ts` (the file as a library file, usage counts, renames into entries),
  `GET /schema` now carries the file, the counts and the stray words; `POST /types/rename`
  (owner; `dryRun` counts); `PUT /library-files/types` is the owner's; an entry's `fields` carry
  `props` and `chattable`; `GET /switcher?type=` lists entries of a type first.
- Web: `pages/settings/Types.tsx`, `components/ThingCombobox.tsx`, and the type's part of
  `CustomProperties.tsx`, `Properties.tsx` and `Fields.tsx`.
- **Until the first change there is no file.** The lists read as the schema file's names, or the
  built-in ones, with person and deity chattable. The folder file starts as before.
- **Counts are of saved entries**, not of unsaved changes; a rename counts what it will change in
  the author's view.
- **A type's rename asks twice** when it reaches entries or folders: the first press says "3
  entries and 1 folder will say …", the second does it. Entries that cannot be changed at that
  moment (read-only, or waiting to be compared) keep the old word and show in the notice.
- **Changing a property's kind does not convert what entries already wrote**; the field then shows
  the old value as the new kind reads it.
- **Field proposals already read stay as they were.** The AI's answer for an entry is kept until
  the entry's text changes, so a type added later is not proposed for an entry read before it.
- **Two owners changing the date names at once:** types merge one by one, the date names do not;
  the later save's list of names wins.

### Not built in this stage

- "Show them" on a stray word's notice (the entries that carry it).
- Reordering types, properties and date names; colours or icons per type.
- The AI proposing values for a type's properties from the prose.
- Filtering or colouring the graph by type or property; a table of a type's entries.
- Keep going's "No type" still looks only at a type the entry wrote, not at its folder's.
- The page still needs a connection, for the counts.
