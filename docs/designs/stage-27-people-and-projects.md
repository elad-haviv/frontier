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

### Openness is declared per route

Whether a route needs a session is declared on the route, never read from the address. Fastify
decodes the path before it matches, so `/%61pi/projects/x` reaches the handler of
`/api/projects/x`; a check on `request.url` would let it by without a session. So:

- The login check (`app.ts`) reads what the router matched (`request.routeOptions`): a matched route
  under `/api` is closed unless it says `config: PUBLIC` (`auth/openness.ts`). The open ones are
  `POST /api/login`, `GET /api/session`, `POST /api/github/webhook` (which checks the signature),
  `POST /api/passkeys/login/{options,verify}` and `GET /health`. A request under `/api` that matched
  no route is closed too (401 before the 404), and so is the `frontier-build` header and the
  single-page fallback decided on the decoded path (`isApiRequest`, `decodedPath`).
- The project guard takes the project from the router's `:project` parameter, not from the address,
  and throws `unauthenticated` when a project route has no person.
- `app.allRoutes` lists every registered route with its flag; `test/reviewFixes.test.ts` requests
  each one that is not open, plain and percent-encoded, without a session, and expects 401. A new
  route is covered the day it is added, and is closed unless it says otherwise.
- Nothing in the server may decide "is this the API" or "is this a project" from `request.url`.

### Settings that are per person

Models for each AI task, the prices a person entered, the look of their concept art,
propose-on-publish and the Keep going rules are the person's own ("Settings → You"), not the
server's: `PUT /api/settings/{ai,ai/prices,keep-going}` change the caller's settings only, and one
person's choice never reaches another. They are kept in `state/person-settings.json` by person id
(`PersonSettings` in the schema; changes are made one after another and the file is written whole
and renamed into place). A person with no entry has the defaults; the admin, who has none until
their first change, has what `settings.json` held before (so an existing server keeps its values
for the first account). Code inside a project's services asks `settings.current()`, which is the
person whose request is being served (nothing is read for a task that runs outside a request, which
has no keys either). The request and response shapes did not change. What is still server-wide and
writable is admin-only: the notice about deleted keys.

### Deleting a project

The order is: out of the store (no guard can find it), the registry marks the id gone (`open` refuses
it, so a request that already holds the record cannot bring the services back), the services close
(their state files, the thumbnail cache and the backup state stop writing, so nothing makes the
folder again), and only then the folder moves to `trash/`. A request in flight is answered, or told
`no_project`; a reconnecting event stream gets `no_project`.

### For the web half

- `GET /images?branch=` (an inbox branch's image, not yet published) needs a writer; without
  `branch` it is reader-level.
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

## 8. How it was built: 27b web

Built on 2026-11-27, after the server half. Every page of a project is under `/p/<slug>/...`, every
call for a project under `/api/p/<slug>/...`, and what the device keeps for a library is kept per
project.

### Addresses

- **One helper puts the project in front.** `project.ts` keeps which project the app has open
  (`currentProject`, set once by the project's route before anything under it draws) and the
  function `inProject(to)`: `/e/Notes.md` becomes `/p/avalymia/e/Notes.md`, and `/` the project's
  Home. An address that already names a project, or belongs to none (`/projects`, `/login`,
  `/join/...`), is left alone. `appUrl` is the same for a plain string (an `href`), `withoutProject`
  takes it off, `movedInto` puts an old address into a project.
- **Pages write addresses as if there were one library.** `nav.tsx` is the only place the router's
  `Link`, `NavLink`, `Navigate`, `useNavigate` and `useLocation` are used (`nav.test.ts` fails if a
  file reaches for the router's own, or writes an app address into an `href`, `location.assign` or
  `window.open`, or builds `/e/` or `/edit/` by hand). Its versions prefix a destination with
  the open project and give `useLocation` a pathname without it, so every pattern the pages and the
  shell already match on (`/e/*`, `/edit/*`, `/map/:id`) is as it was. `entryUrl`, `editUrl`,
  `mapUrl` and the rest in `api.ts` stay project-relative.
- **Old addresses redirect** (`OldAddress` in `App.tsx`): any address that is not `/p/...`,
  `/projects`, `/settings/...` or `/login` goes to the same page in the person's last-used project
  (from `GET /api/projects`, `last`), else their first, keeping the rest of the path, the query and
  the hash. `/` opens the last-used project; with none remembered it opens the one project there
  is, or All projects when there are several or none. `/settings/library/*` (the old project
  sections) goes into the project as well. The list is kept on the device, so this works offline.
- **A renamed address.** `ProjectScope` asks the server for the project's record
  (`GET /api/p/<slug>/project`) whenever it opens; when the record's address differs from the
  one in the bar (`movedFrom`), the bar is replaced with the new address, keeping the rest.
- **Open project, and no leak.** `ProjectScope` (`components/ProjectScope.tsx`) finds the project
  (the list, or the server for an address the list does not know), opens it in a layout effect,
  and draws the shell under `key={project id}`: another project is a whole new tree, so no page
  state, no hook and no tree of the last one is left. What lives in memory beside the React tree
  lets go on `onProjectChange`: the pins, the link completion's names, the hover previews, the
  image finder's answers, the local graph's picture, the graph for the visit (a late answer of the
  old project is dropped), the library-file clients, and the recents. Tested in
  `projectSwitch.test.ts`; the browser test opens an entry in one project, switches, and finds
  nothing of it in the tree, the pins, Home or the quick switcher.

### Calls

- **One place makes a project's address**: `projectUrl(path, slug)` in `api.ts`. The `api` object
  is the server's own calls (session, login, `/api/me`, `/api/settings...`, `/api/ai/...`,
  `/api/projects...`: unprefixed) plus `projectCalls(slug)`, in which every call is written with
  the path the server's route has inside a project (`/entries?path=...`). `api` uses the open
  project; `apiFor(slug)` is the same for a named project, which is how a queued save is sent to
  the project it was made in. With no project open a project call fails with `no_project` and asks
  nothing. The server's unprefixed aliases are never used by the web app: `api.projects.test.ts`
  fails if `api.ts` writes an unprefixed project address (a scan of the source) or any call, with
  dummy arguments, asks for one (every `api` call is made against a stubbed `fetch`).
- Images (`imageUrl`, `mapImageUrl`, `branchImageUrl`, `discoveryArtUrl`), the zip of the library
  and `downloadExport` go through `projectUrl`. The status stream and the status probe are the
  open project's (`Connection.projectChanged`); outside a project the probe asks `/api/me`.
- The service worker answers `/api/p/<slug>/images` (and no other `/api/` address); the stored
  image of one project is never answered for another (`sw/routes.ts`).

### Device state, per project

- **The save queue** (`sync/queue.ts`): one `Queue` for each project, each over a database of its
  own (the first project's is the device's own `frontier`, so nothing moves; the others are
  `frontier-p-<project id>`), with its own Web Lock and broadcast channel. `queue`, as the pages
  see it, is the `QueueHub`: it forwards to the open project's queue. A queue that is not open
  goes on sending what it holds to its own project (the address is read from the list when the
  call is made) and is let go once it has nothing left; at start the queues of projects that were
  left with changes are started. The device's id and name are shared by all of them.
- **The device copy** (`offline/device.ts`): one `DeviceCopy` for each project over that project's
  database, behind one `DeviceHub` that answers each read from the copy of the project its
  address names; only the open project has a keeper. A late answer is announced only while its
  project is open. Removing a project's copy removes only its images from the shared Cache
  Storage cache. The device marks a project as on this device (`frontier.onDevice`) when its compact
  index is first kept.
- **Which project owns what an earlier build kept**: the first project in the list, decided once
  and kept in the device's `meta` (`legacyProject`). The `frontier` database, its queue and its
  copy are that project's; the keys the browser's own storage held unfiled (`frontier.keepGoing.v1`,
  `frontier.maps.recent`, `frontier.discovery.ready`, `frontier.explore.*`, `frontier.chronicle.*`,
  and the per-person `pendingProposals` and `folderRun`) are moved to `<key>:<project id>` once
  (`fileUnfiled`, `projectStorage.ts`), before any page reads. From then on everything of a library
  is read and written under the project's id (`projectKey`; `personStorage` files under person and
  project): recents and reading positions, the maps opened lately, the explore filters, the
  chronicle's offers and folded spans, the graph's view, the proposals waiting after a save, a
  folder run's leftovers. The folded folders of the tree are in the shell's memory, which is new for
  each project. Device settings that are not a library's (bar widths, the map's curve, snapping)
  are not filed.
- **Log out** clears every project's queue, copy and database, the list and the marks, as before.

### The screens

- **Switcher** (`components/shell/ProjectMenu.tsx`): the project's letter mark (eight colour tokens,
  `--project-0..7`, 4.5:1 or more with white text in both themes) and name at the head of the left
  bar, in place of the wordmark; the rail shows the letter with a tooltip; the phone's drawer has
  the same button. It is the app's `Menu`, so arrows, Enter, Escape and typing a name's first
  letters work. Each row shows the role, the entries, a mark when the project is on this device,
  how many changes wait in it when it is not the open one, and a check on the open one. Then
  All projects (`g p`) and New project (only when `canCreate`). Search says "Search <project>"; the
  foot says "<Role> here". The left bar's "Unpublished" is "Your unsaved changes" ("Your
  unpublished changes" for a library on GitHub), and the page's title with it; its address is
  unchanged. `g p` is in the keys registry and so in the "?" sheet.
- **All projects** (`/projects`, `pages/projects/AllProjects.tsx`), in `OutsideShell`: the wordmark
  and the account menu (All projects, Settings, Keyboard shortcuts, Log out); a card for each
  project and, for those who can make one, a dashed New project card. "You're not in a project yet.
  Ask an owner for an invite link." when there is none.
- **New project** (`?new=1` on All projects, so it can be linked to and reached from the switcher):
  name, address (from the name until edited, checked as it is typed, shown in full), what to start
  with. A zip is sent to the new project after it is made, with progress; if that fails the
  dialog says the project exists and offers the zip again, or to open it empty.

### Settings

- **Group "This project · <name>"** (General, Types and dates, Backups and export), "You" (Profile,
  Signing in, AI models, Your AI spending, Propose for a folder, Keep going) and "This device" (AI
  keys, Offline copy). Keep going moved to "You" since its settings are the person's (they were
  moved server-wide in the server half).
- **Where the sections live**: the project's at `/p/<slug>/settings/general`, `.../types`,
  `.../backups`. The personal sections open at both `/settings/<section>`, with no project, which
  shows only "You" and "This device" and is reached from the account menu of All projects, and at
  `/p/<slug>/settings/<section>`, which shows all three groups. Old addresses (`/settings/library/types`,
  `.../backups`, `.../keep-going`) go to where the sections are now.
- **General**: name, address and description, changed by owners and read by everyone else; a
  changed address says the old one works for 90 days before it is saved; the people of the project
  (name and role, read-only: Members is part 27c). Delete this project asks for the project's name
  typed; it is disabled, with the server's words, for the first project (whose files are the old
  layout) and for the last one.
- **Offline copy** lists each project that holds a copy on this device, with the space it takes
  and a way to remove it.

### Not done, and decisions

- No Members section (27c). Roles are read from the project's record and shown; nothing yet hides
  a control from a writer or a reader beyond General's.
- Reading a project that was never opened on this device with no connection says so on a page of
  its own, with All projects and the projects that are on this device. A project is "on this device"
  once its compact index has been kept.
- The e2e specs open pages through one helper (`at`, `helpers.ts`); their direct calls to the
  server in the page (`fetch("/api/maps")`) still use the unprefixed aliases, which reach the
  project used last. `projects.spec.ts` makes the first project the one used last again after each test.

## 9. How it was built: 27c server

For the web half. Built on 2026-11-27; `apps/web/src` was not changed. Everything that existed keeps
its shape. New: members, roles that now matter, invitation links, joining, Google sign-on, and what
`/api/me` and `/api/session` say about ways to sign in.

### Roles, as they are now

`projects/roles.ts` is still the one table. Changes against 27b:

- **Readers get the saved view.** A reader's request runs inside `asSavedView` (`projects/view.ts`,
  set by the facade for every handler): the draft store answers "no drafts, no renames, nothing
  kept" for it, so `GET /entries` returns the last saved text with `draft: null` and
  `state: "published"` (an entry that exists only as someone's draft is 404), and the tree, graph,
  switcher, image finder, maps, chronicles and library files show saved content only. `GET /status`
  and the status stream give a reader zero for `unpublished`, `conflicts`, `drafts`,
  `serverDraftChanges`, the inbox and `attention.keptCopies`; `GET /attention` has no `versions`;
  `POST /export/preview` has `unsaved: []`; a quarantined note shows as published. The role is read
  live on the stream, so a demotion shows on the next event.
- **Moved from reader to writer** (a reader's shell must not call them): `POST /lore/:id/turns/:n/addition`
  and `.../addition/preview` (drafting text into an entry), `GET /maps/:id/discoveries` and
  `GET /maps/:id/discoveries/:d/art` (what AI proposed and nobody has kept). Ask, characters, pins,
  Keep going's question, search, export and every read stay reader.
- **Comments stay writer-only until 27e.** Project creation stays admin-only.
- **New routes** (owner unless said): `GET /members` reader, `PUT /members/:id`, `DELETE /members/:id`,
  `POST /members/leave` reader, `GET /invites`, `POST /invites`, `DELETE /invites/:id`. None has an
  old unprefixed alias.

Removing a person, or changing their role, closes every connection they have open in that project
(`projects/live.ts`), so the status stream ends and the app reconnects and is told `no_project` or
sees its new role. A request that has already passed the guard may still finish its own work.

### Members (under `/api/p/:project/`)

| Method and path | Role | Body | Response |
| --- | --- | --- | --- |
| `GET /members` | reader | none | `MembersResponse`: `{ members: [{ id, name, email, role, addedAt, lastActiveAt, you }], canManage }`. `email` is `null` unless the caller is an owner. `lastActiveAt` is null for someone who has not used the project since this was added; it is kept to within 5 minutes |
| `PUT /members/:id` | owner | `{ role }` (`owner`, `writer`, `reader`) | `{ ok: true }`; 404 `not_found` (not a member); 409 `last_owner` |
| `DELETE /members/:id` | owner | none | `{ ok: true }`; what the person wrote stays, under their name; 409 `last_owner` |
| `POST /members/leave` | reader | none | `{ ok: true }` for the caller; 409 `last_owner` |

`:id` is the person's id. The rule that a project keeps an owner is checked in the project store's
serialized change, on the members as they are at that moment.

### Invitations (owner)

| Method and path | Body | Response |
| --- | --- | --- |
| `POST /invites` | `{ role }` | 201 `CreateInviteResponse`: `{ id, code, path: "/join/<code>", url, role, expiresAt }`. **The only time the code is given** (`cache-control: no-store`). 400 for any other role |
| `GET /invites` | none | `InvitesResponse`: `{ invites: [{ id, role, createdBy: { id, name }, createdAt, expiresAt, secondsLeft }] }`: only links that can still be used, soonest to run out first, never the code |
| `DELETE /invites/:id` | none | `{ ok: true }`; dead at once. 404 `not_found` (not this project's); 410 `invite_used` for one that was used |

A link: 192 random bits as 32 URL-safe characters, stored only as a SHA-256 (`state/invites.json`),
one project, one role (`owner`, `writer` or `reader`), one use, 7 days by the server's clock. Dead
records are kept 30 days so the page can say why a link is dead.

### Joining (public unless said; each counts against a per-address allowance of 30 per 15 minutes, apart from login's, answering 429 `rate_limited`)

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /api/join/:code` | none | `JoinInfo`: `{ project: { name, colour, entries, maps, people }, inviter: { name }, role, google, alreadyMember }`. `google` is whether to show the Google button; `alreadyMember` is true when the caller is logged in and in the project |
| `POST /api/join/:code` | `{ name, email, password }` (password 12 to 500 characters) | `JoinedResponse` `{ ok, project, role }` and a session (a password login); `project` is the slug: open `/p/<project>` |
| `POST /api/join/:code/passkey/options` | `{ name, email? }` | WebAuthn registration options (`userVerification: required`). The challenge, the invitation and the name are kept in the signed session for 5 minutes |
| `POST /api/join/:code/passkey/verify` | `{ response, passkeyName? }` (the browser's registration response) | `JoinedResponse` and a session (method `passkey`). The challenge is single use and is bound to this link |
| `POST /api/join/:code/accept` | none; logged in | `JoinedResponse`. 409 `already_member` (with `error.project`, the slug) and the link is **not** used up. 401 when logged out |
| `GET /api/auth/google/start?invite=&returnTo=&link=1` | see below | 302 to Google |
| `GET /api/auth/google/callback` | Google's `code` and `state` | 302 to a page of the app |

Errors for a link (all carry the typed `code`; the first three also carry `error.inviter`, the name
of the person who made the link, so the page can say whom to ask):

| Code | Status | Meaning |
| --- | --- | --- |
| `invite_used` | 410 | Already used |
| `invite_cancelled` | 410 | Cancelled, or its project was deleted |
| `invite_expired` | 410 | Older than 7 days |
| `invite_unknown` | 404 | No such link; a malformed code gets the same answer, with no name |
| `already_member` | 409 | Only from `accept`; `error.project` is the slug |
| `account_exists` | 409 | The email has an account: the page says "You may already have an account: log in to join" and shows the login form with the link kept (log in, then `POST /api/join/:code/accept`). Nothing says whose account it is |
| `last_owner` | 409 | Members routes |

The body cannot choose a role, a project or `admin`: they come from the link alone, and unknown body
fields are ignored. Two uses at once: exactly one succeeds, the rest get `invite_used`. The server
logs no invitation code (addresses are written `/api/join/:code`, and `invite`, `code`, `state` and
`returnTo` queries are blanked).

### Google sign-on

Off unless `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set; `GET /api/session` says
`google: true|false`, and `GET /api/join/:code` repeats it as `google`. Authorization code flow with
PKCE (S256), a `state` and a `nonce`, kept in the browser's signed, encrypted session cookie for 10
minutes and spent once on the server too. The redirect address is exactly
`PUBLIC_URL/api/auth/google/callback`. The ID token's signature (RS256, against Google's keys read
from the discovery document and cached), `iss`, `aud`, `exp`, `nonce` and `email_verified: true` are
checked. Libraries: `jose` (new dependency). `GOOGLE_ISSUER` points it at a stand-in provider in
tests (refused in production).

`GET /api/auth/google/start` takes `invite=<code>` (joining), `link=1` (linking from Settings; needs a
session that logged in within 5 minutes, else it redirects to
`/settings/you/signing-in?problem=recent_login_needed`) and `returnTo=<path>` (a path in the app: one
leading slash, no host, no backslash, not `/api`; anything else is dropped and the person lands on
`/`). Every answer is a redirect; the web app words the `problem` parameter:

| Where | `problem` | When |
| --- | --- | --- |
| `/login` | `google_no_account` | Google knows who they are but there is no Frontier account and no invitation (never an account made, never linked by email) |
| `/login` | `google_denied`, `google_failed`, `google_unverified`, `google_expired`, `google_off` | The person said no; any failure to check the token or reach Google; an email Google has not verified; the state is wrong, used or older than 10 minutes; Google sign-on is off |
| `/join/<code>` | the same, and `account_exists` | The same, for a trip that started on an invitation; `account_exists` is an account with that email that is not linked to this Google identity: log in and use "accept". The page's own `GET /api/join/:code` says when the link is dead |
| `/settings/you/signing-in` | `google_taken`, `google_already_linked`, `recent_login_needed` | Linking from Settings: that Google account belongs to another person; this account has one; the login is older than 5 minutes |

What a good trip does, in this order: the Google subject is linked to an account: log in (landing on
`returnTo` or `/`; with an invitation, join that project as that account, and a person already in it
just goes there with the link left unused). Else with a valid unused invitation (checked again at
the callback, used only on success): make the account from Google's name and verified email, join,
log in, land on `/p/<slug>`. Else with `link=1`: add the identity to the logged-in account. Else
`google_no_account`. The session's method is `google`.

| Method and path | Body | Response |
| --- | --- | --- |
| `DELETE /api/me/google` | none | `{ ok }`. Ends the other sessions; 403 `not_allowed` when it is the last way to sign in (a password that works, a passkey or Google must remain); 404 when none is linked |

### Ways to sign in

`GET /api/me` (`MeResponse`) gains `signingIn`: `{ password: { set, off }, passkeys: [{ id, name,
addedAt }], google: { email, addedAt } | null, googleAvailable }`, and `method` may be `google`.
The old `passkeys`, `passwordSet` and `passwordOff` stay. The kept `signIn` block of
`GET /api/settings` is unchanged except that its `method` may be `google`. "The last way cannot be
removed" now counts Google (`waysIn`); removing or linking a Google account ends the other sessions
like any other credential change (and linking asks for a recent login). Switching the password off
needs a session that came by a passkey or Google. A person who came by Google has no password until
they set one (`PUT /api/me/password`, which asks for a recent login when there is none).

### A person in no project

Everything copes: `GET /api/session` and `GET /api/me` answer with `lastProject: null`,
`GET /api/projects` is `{ projects: [], last: null, canCreate }`, every project address and every old
unprefixed alias answers 403 `no_project`, `PUT /api/projects/last` too, and settings, models, the
profile and logging out work. Accepting an invitation puts them back in a project. The server's
first account who leaves is not made an owner again (that only happens to a project with no owner).

### Decisions where the brief was silent

- Joining by password or Google logs the person in as a new account even when someone else is logged
  in on that browser; the app should send a logged-in person to "accept" instead (`alreadyMember`
  and the session tell it).
- `account_exists` reveals that an email has an account to someone who holds a working link; it is
  the price of letting the page say "log in to join". It is not said for an unknown or dead link.
- A person who has Google linked and arrives on an invitation through Google joins as that account.
- A passkey join may give an email (optional); an account made by passkey or Google has no password.
- Invitations survive the deletion of a project only as dead records (`invite_cancelled`).
- The allowance for the public join and Google routes is 6 times login's (30 per 15 minutes), counted
  apart from login so a visit to the join page does not use up a login.
- Not done in 27c server: unlinking another provider (there is none), an email to the invited person
  (decision A: Frontier sends no mail), and a list of someone's other sessions.
