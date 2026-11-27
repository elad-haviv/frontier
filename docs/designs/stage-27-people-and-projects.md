# Stage 27: people and projects

Approved by Elad on 2026-11-26, with his own answers to the seven decisions (section 3). Mockup:
https://claude.ai/artifact/Kn5Cb4nFvL8Z5AzU8qS6n5 (five screens, desktop and phone; the first three
are live).

## 1. What's wrong today

- **One person.** The server knows a single user, "author", with one password and one set of
  passkeys (`routes/auth.ts`, `routes/passkeys.ts`, `state/settings.ts`).
- **One library.** Every address, draft, pin, comment, setting and working file assumes there is
  only one (`/data/library.git`, `/data/vault`, `/data/state`).
- **No names.** A saved version does not say who saved it; comments are "for me" or "for the AI".
  There is no way to let someone read without letting them write.
- **AI keys live on the server**, encrypted in settings or given in the environment, and one
  monthly cap covers everything.

## 2. The design

### Words

- A **project** is what the library is today: entries, maps, chronicles, images, saved versions,
  types and dates, backups, and now members. A person can belong to several.
- A **person** has an account: a name, an email, and one or more ways to sign in.
- A **member** is a person in a project, with a role: **Owner**, **Writer** or **Reader**.

### Roles

| | Owner | Writer | Reader |
| --- | --- | --- | --- |
| Read, search, graph, maps, chronicles, export | yes | yes | yes |
| Comment on a passage, reply | yes | yes | yes |
| Ask, talk to characters (with their own AI key) | yes | yes | yes |
| Write entries, maps and chronicles; save versions; import; writing help | yes | yes | no |
| Mark a comment done | yes | yes | only their own |
| Members, invite links, project settings, backups, deleting the project | yes | no | no |

A project always has at least one owner: the last owner's role cannot be changed and they cannot
be removed or leave. Removing a member keeps what they wrote, under their name.

### Switching projects (mockup screen 1)

- The project's name, with a coloured letter, replaces the word FRONTIER at the head of the left
  bar. It is a menu button: your projects with your role and the entry count, a check on the open
  one, then **All projects** and **New project**. In the collapsed rail it is the letter alone. On
  the phone it is the same button at the head of the drawer, and the list opens in place.
- Search says "Search <project>".
- The foot of the left bar shows you: avatar, name, "Owner here". Its "⋯" is today's app menu with
  your name and email at the top; owners also get **Members**.
- "Unpublished" becomes **Your unsaved changes**, since each person now has their own.
- A reader has no New entry, Edit, unsaved changes or Inbox, and sees one line: "You can read and
  comment here. You cannot change the text."
- Keys: `g p` opens All projects. The switcher is an ordinary menu (arrows, Enter, Esc, type to
  jump).

### All projects (screen 2)

- `/projects`, outside any project: the wordmark, your avatar, and a card for each project (name,
  one-line description, entries and maps, members' avatars, your role, the last saved version and
  who saved it).
- After logging in, Frontier opens the project you last used; with none remembered and more than
  one project, it opens this page.
- **New project**: name, address (filled in from the name, editable, must be free), and what to
  start with: an empty library, a vault zip, or the sample. The creator is its owner. For now only
  the server's first account (Elad) can create projects.
- Empty state, for an account that belongs to no project: "You're not in a project yet. Ask an
  owner for an invite link."

### Members (screen 3)

Settings → This project → Members, for owners; writers and readers see the list without the
controls.

- Each member: avatar, name, email, when last active, role (a select), remove (asks first, in the
  row).
- **Invite someone**: choose the role, press **Make an invite link**. The link is shown once with
  Copy. It is for one person and one role, works once, and stops working after 7 days. Frontier
  sends no mail; the owner sends the link however they like.
- **Invitations waiting**: each unused link with its role, who made it and the time left, and
  **Cancel it**.
- A short key under the invite box says what each role can do.

### Joining and logging in (screen 4)

- `/join/<code>` says who invited you, to which project, and as what. Someone new gives their name
  and joins with **Google**, **a passkey on this device** (fingerprint icon), or an email and
  password. Someone with an account logs in and joins. A used, cancelled or expired link says so
  and names the owner to ask.
- Logging in: **Use a passkey** (fingerprint icon), **Continue with Google**, or email and
  password. "No account? You need an invite link from a project's owner."
- Single sign-on only says who someone is. A Google account with no Frontier account and no invite
  link gets nothing.
- Settings → You → Signing in lists the ways this account signs in (Google, passkeys, password),
  each added or removed there; the last one cannot be removed.

### Who did what (screen 1)

- An entry says "Last version by <name>, <when>" beside History; each version in an entry's
  history and the library's history carries its author.
- The top line of an entry shows the avatars of members reading it now.
- **Two writers, one entry.** Each writer has their own unsaved changes; saved versions are
  shared. While someone else has unsaved changes on the entry you are editing, a notice names
  them. Whoever saves second sees the compare screen Frontier already has (built for the GitHub
  way) before anything is kept.

### Comments between people (screen 1)

- **Comment** is on the entry page for every role, not only in the editor. Select a passage (or
  tap a paragraph on the phone) and write.
- A comment shows under its highlighted passage with the writer's avatar, name, role and time, and
  **Reply**. Owners and writers have **Done**; a reader can remove their own.
- Comments "for the AI" stay as they are, for owners and writers, and are private to the person
  who wrote them.
- The left bar counts comments opened since you last looked.

### Your own AI keys (screen 5)

- Each person brings their own AI key. A key is kept **only in the browser on that device**.
  The server never saves one: the browser sends the key with each AI request, the server uses it
  for that one call and forgets it. It is never written to disk, a log, a backup or an error
  report. Keys in the server's environment (`OPENROUTER_API_KEY` and the rest) stop being read.
- Custom OpenAI-compatible endpoints are no longer offered (a client-chosen address would receive
  people's keys), the first-use explanation is a dialog, and spending is per person.
- Settings → This device → **AI keys**: each provider with its state on this device, Test, Add a
  key, Remove from this device. The notice at the top says: your keys stay in this browser; the
  server never saves them and other members never see them; you pay your provider directly; on
  another phone or computer add the key again, and clearing this browser's data removes it.
- People are told in three places: on the invitation ("Frontier's AI help runs on your own AI key,
  which you add after joining. It stays on your device."), on the AI keys section, and the first
  time someone without a key reaches an AI feature, which shows the explanation and the field to
  add one in place, then carries on with what they asked.
- Settings → You: **AI models** (which model you use for each task, kept with your account, no
  secret in it) and **Your AI spending** (your own log and total; there is no project cap).
- What changes: AI work happens only while someone has Frontier open. The question of the day and
  field proposals after saving a version are made by the browser of whoever is there, with their
  key, not by the server on its own.

### Settings, regrouped (screen 3)

| Group | Sections |
| --- | --- |
| This project (owners change, others read) | Members, General (name, address, description, delete), Types and dates, Backups and export |
| You | Profile, Signing in, AI models, Your AI spending, Keep going |
| This device | AI keys, Offline copy |

### What belongs where

| The project | You | This device |
| --- | --- | --- |
| Entries, maps, chronicles, images, graph | Name, email, ways to sign in | AI keys |
| Saved versions, each with its author | Your unsaved changes | The offline copy, per project |
| Types and dates; comments between people | Pins, recents and Keep going, per project | Bar widths, folded folders |
| Members and invitations; backups, import, export | Lore conversations; AI models; your spending log | |

### Moving over

- Today's library becomes the project **Avalymia**, with Elad as its owner. Today's password and
  passkeys become his account; he gives it an email at the first login.
- Addresses gain the project: `/p/<project>/entry/...`. Old addresses redirect into Avalymia.
- Keys stored on the server are deleted after one notice telling him to add them on his devices.

### Offline

The offline copy is kept per project. The switcher marks projects that are on this device; opening
one that is not, with no connection, says so. AI keys are on the device already, but AI calls
still need a connection.

## 3. Decisions (as approved)

- **A.** People join by an invite link made by an owner: one project, one role, one use, 7 days.
- **B.** Three roles: Owner, Writer, Reader. Readers can comment.
- **C.** Each writer has their own unsaved changes; the second to save sees the compare screen.
- **D.** Each person brings their own AI key, kept on their device only, and Frontier tells them.
- **E.** Single sign-on with Google, beside passkeys (with a fingerprint icon) and the password.
- **F.** The key travels with each AI request; the server uses it for that call and never saves it.
- **G.** Readers may use Ask and talk to characters, with their own key.

## 4. Building it, in order

Each part is released on its own and leaves the app working for one person.

| Part | What | Main places |
| --- | --- | --- |
| 27a | Accounts: a people store, sessions that carry a person, email and password, passkeys per person, the move from "author" | `apps/server/src/auth`, `routes/{auth,passkeys}.ts`, `state/settings.ts`, `pages/Login.tsx`, `settings/Account.tsx` |
| 27b | Projects: a project store, one set of services per project under `/data/projects/<id>/`, `/p/<project>/` addresses and `/api/p/<project>/`, redirects, the switcher, All projects, New project, backup and offline copy per project | `app.ts`, `main.ts`, `config.ts`, every route file, `App.tsx`, `api.ts`, `components/shell`, `offline/` |
| 27c | Members, roles and invite links; role checks on every route; the reader's shell; `/join/<code>`; Google sign-on | new `members/`, `routes/`, `settings/Members.tsx`, `pages/Join.tsx` |
| 27d | Authors on versions; unsaved changes per person; the "has unsaved changes" notice and who is reading; the compare screen in an own library | `state/drafts.ts`, `publish/`, `git/gateway.ts`, `pages/{Entry,History,Versions,Unpublished,Conflict}.tsx` |
| 27e | Comments between people, on the entry page, with replies | `comments/`, `components/CommentsPanel.tsx`, `pages/Entry.tsx` |
| 27f | AI keys on the device: the key sent with each request, no key storage or environment keys on the server, models and spending per person, the three notices, AI work done only with someone present | `ai/`, `state/secrets.ts`, `routes/settings.ts`, `settings/{Providers,Models,Spending}.tsx`, `keepGoing/` |

27f does not depend on the others and can be built first if wanted.

## 5. Risks

| Risk | Answer |
| --- | --- |
| A route misses its role check and a reader can write | One check where the project's routes are registered, by method and path, with a test that walks every route as each role |
| One project's data shows in another | Services are made per project and reached only through the address; no service holds a path outside its project's folder; a test with two projects |
| A key reaches a log or a backup | The key travels in a request header that is stripped from logs and errors; a test that greps the data folder and the log for a known key after every kind of AI call |
| The move from one author loses the way in | The move keeps the password and passkeys working unchanged and runs once, with the old settings file kept beside the new |
| Google sign-on lets a stranger in | An account is only ever made from an invite link; a Google identity with no account is refused |

## 6. Verification

- **Server:** the move from one author; two people and two projects kept apart; every route as
  each role; an invite link used, used twice, cancelled, expired; the last owner; versions with
  authors; two writers saving the same entry; comments by a reader; an AI call with the key in the
  request and nothing of it on disk.
- **Browser:** log in each of the three ways; switch projects on desktop and phone; create a
  project; invite, join and change a role; the reader's shell; comment and reply; add a key on one
  device and see it absent on another; the first-use notice on Ask.

## 7. How it was built: 27b server

For the web half. Built on 2026-11-27; the web app was not changed, and still works through the
old unprefixed addresses (see "The legacy alias").

### Shape

- **A project store**, `state/projects.json` (`apps/server/src/projects/store.ts`, schemas in
  `packages/schema/src/projects.ts`). A record: `id` (10 characters), `slug`, `previousSlugs`
  (`{ slug, until }`, an old address works for 90 days), `name`, `description`, `colour`
  (0 to 7, an index into the app's list for the letter mark), `createdAt`, `kind` (`own`,
  `github`, `sample`), `layout` (`legacy` or `folder`), `iconFolder`, and `members`
  (`{ personId, role, addedAt }`). Reserved addresses: `new api join settings projects login logout
  p health assets icons admin help`.
- **One set of services per project** (`projects/services.ts`, `buildServices`), opened on first use
  by the registry (`projects/registry.ts`) and kept; `close` stops the nightly backup and the timer
  fetch. Server-wide, on `Server` (`server.ts`): people, login limiter, the project store, settings
  (AI models, Keep going rules), the AI provider, spending log and model list, the image fetcher,
  the stored-keys notice.
- **Where files live.** The first project is the library the server had: `layout: "legacy"`, files
  where they were (`DATA_DIR/library.git`, `vault`, `state`, `assets`). Nothing moves on upgrade;
  only `state/projects.json` is new. A new project is `DATA_DIR/projects/<id>/{library.git, vault,
  state, assets}` and is always an own library. `projects/layout.ts` lists which files in
  `DATA_DIR/state` are the server's (`people.json`, `settings.json`, `projects.json`, `ai-log/`) and
  which the first project's.
- **The guard** (`projects/guard.ts`): after the login check, for `/api/p/<slug>/...` it finds the
  project (the current slug, or an old one not run out), checks the person is a member, checks the
  role against the table, opens the services and puts `request.project = { record, role, services,
  movedFrom }`. A slug that does not exist and a project the person is not in give the same answer,
  403 `no_project`. A route under a project that the table does not know is refused (403
  `not_allowed`), and a route cannot be registered without an entry.
- **The role table**, `apps/server/src/projects/roles.ts` (`ROUTE_ROLES`, keyed by `METHOD /path`
  after `/api`). Routes are written once against one `Services` and registered by
  `projects/facade.ts`, which gives each route its `/api/p/:project` address, its old unprefixed
  address, and runs the handler for the request's project (`projects/context.ts`).
  `test/projectRoles.test.ts` walks every route as owner, writer and reader.
- **Per person, per project** (kept in the project's `state/`, keyed by person id): pins
  (`pins.json`; no longer an unsaved change in the library, the old `.frontier/pins.json` is read as
  the first account's until they change their pins), lore conversations (`conversations/<person>/`),
  the question of the day (`question/<person>.json`). What a server from before projects had in
  `conversations/*.json` and `question.json` belongs to the first account and is read from there; no
  file is moved at start. **Per project, not per person yet**: drafts (27d), comments (27e), consults
  and field proposals. **Server-wide**: chosen AI models and prices, Keep going rules, spending log,
  the last-used project (`Person.lastProject`).
- **Backup.** The first project keeps the old keys (`latest/state`, `latest/library`,
  `latest/generated`, `nightly/<date>/...`), and the server's own files are in `state/`. A new
  project goes under `projects/<id>/` (`latest/`, `nightly/`) with its own manifest and its own
  `state/backup.json`. `npm run restore -w apps/server [-- <night>] [-- --project <address>]`
  (`backup/restoreProjects.ts`). A bare repository is mended after a restore (the backup holds
  files, not empty folders). The status's `backupOutside` and last backup time are per project.

### The API

Server-wide, unprefixed (unchanged unless said):

| Method and path | Body | Response |
| --- | --- | --- |
| `POST /api/login`, `POST /api/logout`, `/api/passkeys/*`, `PUT /api/me/password`, `PUT /api/settings/password-off` | as before | as before |
| `GET /api/session` | none | as before, and `lastProject`: the address of the project last used, or null |
| `GET /api/me`, `PUT /api/me` | as before | `MeResponse`, and `lastProject` as above |
| `GET /api/settings`, `PUT /api/settings/ai`, `/ai/prices`, `POST /api/settings/ai/test`, `PUT /api/settings/keep-going`, `POST /api/ai/keys/:kind/check`, `GET /api/ai/models`, `GET /api/ai/log`, `DELETE /api/notices/keys-removed` | as before | as before (per person; nothing in them is a project's) |
| `GET /api/projects` | none | `ProjectsResponse`: `{ projects: [{ id, slug, name, description, colour, kind, role, entries, maps, members: [{ id, name }], lastVersion: { at, by } or null }], last, canCreate }`. Opens each project (counts are null when one cannot be opened) |
| `POST /api/projects` | `{ name, slug, description?, start: "empty" or "sample" }`; the first account only, else 403 `not_allowed` | 201 `ProjectResponse`; 409 `slug_taken` for a used or reserved address, 400 for a bad shape. An empty library has one `Welcome.md`. A vault zip is brought in next with `POST /api/p/<slug>/import/vault` (multipart: `message`, one zip), which the creator, as owner, may do |
| `GET /api/projects/slug-free?slug=` | none | `{ free, reason }` |
| `PUT /api/projects/last` | `{ slug }` | `{ ok }`; 403 `no_project` when the person is not in it. Call it when a project is opened |
| `GET /health` | none | health of the first project's library |
| `POST /api/github/webhook` | GitHub's push | syncs the first project (the one on the configured repository) |

Under `/api/p/:project/` (the address is the slug, or a previous slug), each with the role the table
gives; the paths after the prefix are exactly the old `/api/...` paths: `/entries`, `/tree`,
`/schema`, `/images`, `/images/find`, `/images/from-url`, `/gallery`, `/graph`, `/search`,
`/preview`, `/switcher`, `/drafts...`, `/unpublished`, `/publish/plan`, `/publish/confirm`,
`/renames...`, `/library-files/:name...`, `/folders/...`, `/maps...`, `/marker-sets`,
`/chronicles...`, `/lore...`, `/characters/...`, `/keep-going/...`, `/pins`, `/write/...`,
`/comments...`, `/proposals/...`, `/quarantine...`, `/inbox...`, `/export/...`, `/import`,
`/import/vault`, `/history`, `/history/version`, and the project's own:

| Method and path | Role | Body | Response |
| --- | --- | --- | --- |
| `GET /api/p/:project/project` | reader | none | `ProjectResponse`: `{ id, slug, movedFrom, name, description, colour, kind, createdAt, role, members: [{ id, name, role }], deletable }`. `movedFrom` is the old address used; the app moves to `slug` |
| `PUT /api/p/:project/project` | owner | `{ name?, slug?, description?, colour? }` | `ProjectResponse`; 409 `slug_taken`. The old address keeps working for 90 days |
| `DELETE /api/p/:project/project` | owner | `{ name }`, the project's name | `{ ok }`; the folder is moved to `DATA_DIR/trash/<id>-<time>`. 400 when the name is wrong, 409 `project_not_deletable` for the first project (its files are the old layout) and for the last project |
| `GET /api/p/:project/status` | reader | none | `StatusSnapshot` (the project's library, index, inbox, backup; `notices.keysRemoved` for the first account only) |
| `GET /api/p/:project/status/events` | reader | none | the same as server-sent events |
| `GET /api/p/:project/attention` | reader | none | as `GET /api/attention` |

Errors added (`packages/schema/src/errors.ts`): `no_project` 403 (unknown project and non-member
alike), `role_too_low` 403, `slug_taken` 409, `project_not_deletable` 409. Images and every other GET
that goes in an `<img>` are under the prefix too.

### The legacy alias

Every project route also answers at its old unprefixed address (`GET /api/entries`), for devices
still on the previous web build, on the person's last-used project (`PUT /api/projects/last`), or
their first. It is the second registration in `projects/facade.ts`; to remove it, delete that loop
and `aliases` in `projects/guard.ts`. The project's own routes have no alias. The keep-going
settings route, `PUT /api/settings/keep-going`, moved to the server-wide settings.

### For the web half

- Routes that a reader may not call answer 403 `role_too_low`; until 27c every reachable account in
  a project is an owner, but the first account can already be given a different role by editing the
  store (tests do).
- Comments are writer-only until 27e, and `GET /unpublished`, the draft routes and the inbox are
  writer-only: a reader's shell must not call them. `GET /entries` still returns the project's
  unsaved text of an entry to a reader; 27d makes unsaved changes per person.
- Pins are no longer part of the library: they are not an unsaved change and are not in
  `/library-files/pins` (that file is kept, and is only the old pins of a server from before
  projects).
- A person who is in no project gets 403 `no_project` from every project route and an empty list
  from `GET /api/projects`.
