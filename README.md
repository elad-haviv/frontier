# Frontier

A web app for one author to write, read and explore Avalymia, a fantasy multiverse kept as Markdown
notes in the `elad-haviv/avalymia` repository. The Markdown files stay the source of truth; Frontier is
a way of working on them.

The full design is in [docs/designs/frontier.md](docs/designs/frontier.md). What is next, and the place for new ideas, is [docs/BACKLOG.md](docs/BACKLOG.md).

## Status

Stage 1 of nine is in progress. What exists so far:

| Part                                                                                                                                         | State                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/vault`: reading notes, frontmatter, line endings, links, link resolution, rename planning                                          | Built and tested                                                                 |
| `packages/schema`: types and validation shared by server and web                                                                             | Built and tested                                                                 |
| `apps/server`: configuration, Git gateway, in-memory index, login, status, webhook, timer fetch, image serving                               | Built and tested                                                                 |
| `apps/server`: drafts, two-call Publish with merge and conflicts, renames, crash recovery                                                    | Built and tested                                                                 |
| `apps/server`: backup of working files and a restore command                                                                                 | Built and tested; the S3 path has not run against a real bucket                  |
| `apps/web`: login, folder tree, entry reader, image lightbox, status page, quick switcher                                                    | Built; covered by browser tests                                                  |
| `apps/web`: source editor with autosave and link autocomplete, new, delete and rename, unpublished list, Publish, merge and conflict screens | Built; covered by browser tests                                                  |
| Full-text search, outline, hover preview, editing toolbar                                                                                    | Built; covered by browser tests                                                  |
| Live preview; image upload; table editing; properties panel                                                                                  | Built; image sizing and table row tools still to do                              |
| Stage 3: inbox for agent branches; type and date fields; AI provider and field proposals; quarantine; passkey login                          | Built; the AI needs each person's own key, and quarantine needs the sync changed |
| Stage 4: maps (flat maps and globes, markers, paths, zones, layers, measuring)                                                               | Built; to be tried on the real images                                            |
| Own library: Frontier keeps the knowledge base itself, with versions, import and export                                                      | Built; the preview still shows the sample                                        |
| Stage 11a: icons, tooltips, menus, one keys registry; a save queue on the device, saves that say what they started from                      | Built; covered by tests. 11b (the shell) and 11c (folder tree) to come           |
| Stage 25: Home with a work queue, From here, pins, random entry, back to last, resume position, recents in the switcher                      | Built; covered by tests                                                          |
| Stages 26 and 28: the library as a menu item and full-drawer panel on the phone, and as a pane beside the sidebar on desktop                 | Built; covered by tests                                                          |
| Stage 29: generating pictures for entries from the image dialog, in the art style from Settings                                              | Built; covered by tests                                                          |
| Stage 30: Trees: relations on entries; family trees, descent, pantheons and hierarchies; an entry's Relations tab                            | Built; covered by tests                                                          |
| Stage 33: the AI proposes relations from the prose, decided in the inbox, in trees and in an entry's Relations tab                           | Built; covered by tests                                                          |
| Stage 34: the World Wizard: a world built from its star down, made into maps and first entries                                               | Built; covered by tests                                                          |

The app writes to its vault: drafts are saved on the server and Publish makes one commit.

A preview on made-up sample content runs with `FRONTIER_SAMPLE_VAULT=1`; see the Dockerfile.

## Projects

A project is a library with its own members (stage 31b). A server holds any number of them, each with its own repository, working copy, drafts, comments, maps, backup and timers, opened the first time it is used. The library a server had before projects becomes the first project, named by `FRONTIER_PROJECT_NAME` (default "Avalymia", "Sample" for the sample), with its files where they were: `library.git`, `vault`, `state` and `assets` under `DATA_DIR`. A project made since lives in `DATA_DIR/projects/<id>/` with the same four inside it, and is always an own library. Every project route is `/api/p/<slug>/...`, and each route says in one table (`apps/server/src/projects/roles.ts`) which role it needs: reader, writer or owner. Accounts, sign-in, AI settings and `/api/projects` stay server-wide. A deleted project's folder is moved to `DATA_DIR/trash/`, not removed. Each project is backed up under its own prefix (`projects/<id>/`) in the bucket; the first project keeps the old keys, and the server's own files (accounts, settings, the project list) are with it. `npm run restore -w apps/server` restores everything; `-- --project <address>` restores one project. The design is [docs/designs/stage-31-people-and-projects.md](docs/designs/stage-31-people-and-projects.md).

### People, invitations and Google sign-on

An owner invites people from a project's Members page (stage 31c): a link for one project and one
role, for one person, usable once and for seven days. With mail set up (below) the owner can have
Frontier email it; without, the owner sends the link. Only a hash of the code is stored (`DATA_DIR/state/invites.json`, in the backup), so a link
cannot be read back later. The person opens `/join/<code>` and joins with an email and a password,
a passkey on their device, or Google. An account is only ever made from an invitation.

In the app (stage 31c, web): Settings › This project › Members lists everyone with their role; an
owner changes a role, removes a person and makes invite links there, and anyone can leave. A reader
sees the library as it was last saved and has no control that changes anything, but can still Ask and
talk with characters with their own AI key; a writer has everything but the owner's settings. The
pages for this are `/p/<project>/settings/members`, `/join/<code>` (open to someone not logged in),
and `/settings/account` (Signing in), where Google is linked and unlinked.

Comments between people (stage 31e): on an entry's page everyone, a reader too, can comment on a
selected passage or on the whole entry, reply, and edit or delete their own; the thread's author, a
writer or an owner resolves it, and an owner can delete anyone's. Comments carry the writer's name and
show up live for the others reading the entry. They are always on saved text. A comment for the AI
stays private to the writer who made it.

Two people in one project (stage 31d, web): each has their own unsaved changes, and the app says so
("Your unsaved changes"). An entry shows "Last version by <name>", and every saved version in its
history carries its author. A writer sees a quiet notice, and a dot in the tree, when someone else
has unsaved changes to an entry (never what they wrote), and who else is reading it. Whoever saves
second sees the compare screen, in an own library and on GitHub alike: the other person's version
with who and when, their own, and Keep mine, Keep theirs or the merged text. If someone saves again
while a person is comparing, they are told and compare again; text is never dropped.

"Continue with Google" is off unless the server has a client id and secret. To set it up:

1. In the Google Cloud console, under APIs & Services, make an OAuth client of type "Web
   application" (and the consent screen, if none exists: the scopes are `openid`, `email` and
   `profile`).
2. Add the authorized redirect URI `PUBLIC_URL/api/auth/google/callback`, spelled exactly as
   `PUBLIC_URL` is (for example `https://frontier.example.com/api/auth/google/callback`). Google
   refuses any other address.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the server and restart it. Both or neither.

Google only says who someone is. It never makes an account by itself: a Google account that has no
Frontier account and no invitation gets "no account" and nothing else, and an account is never
linked to Google by matching emails: a person links it themselves in Settings, soon after logging
in. The ID token's signature, issuer, audience, expiry and nonce are checked, the email must be
verified, and the flow uses PKCE and a state bound to the browser.

### Mail (optional)

Frontier can send five short emails (stage 32): an invitation, "confirm your address", a password
reset, an explanation for an account with no password, and a notice to the old address when an
address is changed. Mail is on only when both `SMTP_HOST` and `MAIL_FROM` are set. With neither,
every email feature is hidden and the app behaves as it did before: the owner passes invitation
links on by hand, an address is taken as typed, there is no "Forgot password", and a forgotten
password is put right by running the set-password command on the server.

| Variable                     | Meaning                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_HOST`                  | The relay's host name.                                                                                                                                                                                                                                                                                                      |
| `SMTP_PORT`                  | Default 587, or 465 when `SMTP_SECURE=tls`.                                                                                                                                                                                                                                                                                 |
| `MAIL_FROM`                  | `Frontier <noreply@haviv.pro>`.                                                                                                                                                                                                                                                                                             |
| `SMTP_USER`, `SMTP_PASSWORD` | Only if the relay asks for a login. Both or neither. With a login `SMTP_SECURE` defaults to `required`, and `starttls` or `none` stop the server at start.                                                                                                                                                                  |
| `SMTP_SECURE`                | `starttls` (default without a login): encrypt when the relay offers it, and do not check its certificate, which suits a private relay on the same network. `required` (default with a login): STARTTLS or fail, certificate checked. `tls`: TLS from the first byte (port 465), certificate checked. `none`: never encrypt. |

Links in emails are built from `PUBLIC_URL`, never from the request. Codes are 192 random bits, kept
only as hashes, used once; a confirm link lasts 24 hours, a reset link 30 minutes. A mail that cannot
be sent never fails the action that asked for it; the app says what was not sent. Neither the
messages, their links nor their codes are written to the log.

#### Sending mail through a relay on Coolify

Run an SMTP relay as its own service in Coolify (for example a Postfix or msmtp relay that forwards
to the real mail provider), and:

1. Put the relay and Frontier on the same Docker network (in Coolify, give both the same
   destination, or attach the relay to Frontier's network). Frontier reaches it by the service name,
   so `SMTP_HOST` is that name. Do not publish the relay's port on the internet.
2. Set `SMTP_HOST=<relay service name>`, `MAIL_FROM=Frontier <noreply@haviv.pro>` and leave
   `SMTP_PORT=587` and `SMTP_SECURE=starttls`. A relay on the private network that accepts
   submission without a login needs no `SMTP_USER`.
3. Publish SPF and DKIM records for the sending domain (`haviv.pro`): SPF lists the server or provider
   that sends for it, and DKIM is the provider's public key as a DNS TXT record. Without them, mail
   from `noreply@haviv.pro` is likely to land in spam or be refused. A DMARC record is recommended.
4. Restart Frontier. `GET /api/session` then says `mail: true`, and the app shows the email screens:
   the optional "Send it to" address on the invite box, the "Confirm your email" banner, the
   unconfirmed mark in Members (owners), the email address block in Settings, Signing in, "Forgot
   password?" on the login page, and the pages the links in emails open: `/confirm/<code>`,
   `/reset/<code>` and `/forgot-password`.

## Working on it

Needs Node 22.

```sh
npm install
npm test          # unit tests in every workspace, with coverage thresholds
npm run typecheck
npm run lint
npm run build
npm run e2e       # browser tests; build first
```

### Running the server locally

The server runs without GitHub or a storage bucket when given a local Git address and a backup folder:

```sh
npm run build
export PUBLIC_URL=http://localhost:3000 DATA_DIR=/tmp/frontier-data \
  VAULT_REMOTE_URL=/path/to/a/bare/clone.git BACKUP_LOCAL_DIR=/tmp/frontier-bucket \
  SESSION_KEY=$(openssl rand -base64 32) \
  COMMIT_AUTHOR_NAME="Your Name" COMMIT_AUTHOR_EMAIL=you@example.com \
  COMMIT_BOT_NAME=frontier COMMIT_BOT_EMAIL=frontier@example.com
npm run set-password -w apps/server   # once: asks for the first account's name, email and password
npm start -w apps/server
```

Logging in takes an email and a password. A server that has no account yet makes the first one (the
admin) from `FRONTIER_INITIAL_PASSWORD`, with `FRONTIER_INITIAL_EMAIL` and `FRONTIER_INITIAL_NAME`,
or from the set-password command. A server from before accounts turns its one password and its
passkeys into the first account at the next start, leaving the old settings file as it was. The
accounts are kept in `/data/state/people.json`, which the backup includes. To set another
account's password: `npm run set-password -w apps/server -- someone@example.com`.

`.env.example` lists every variable, including the ones for GitHub and the bucket.

AI help needs no key on the server, and the server reads none from its environment. Each person
adds their own key in the app, under Settings › AI keys; it stays in that browser and travels with
each AI request in the `frontier-ai-keys` header, and the server never writes it to disk, a log,
a backup or an error. Keys that an earlier version stored in the settings file are deleted at
start, and the app tells the server's owner once. **Those keys are still in the backups for up to
14 days, so revoke each of them with its provider and make new ones for your devices.** The same goes
for any `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` or
`XAI_API_KEY` set in the server's environment: they are not read, so revoke them and remove them.
AI work therefore happens only while someone has Frontier open.

### Checks against the real vault

`packages/vault` has tests that run against a checkout of the vault. They confirm that reading and
saving a note never changes a byte it should not, and that links resolve as recorded in the baseline.

```sh
VAULT_PATH=/path/to/avalymia npm test -w packages/vault
```

The link baseline lists how every link in the vault resolves. It lives in the vault, at
`.frontier/baseline/links.json`. To create or refresh it:

```sh
npm run baseline -w packages/vault -- /path/to/avalymia
```

The script prints what changed since the previous baseline and writes the file. Review it and commit it
to the vault yourself.

## Layout

```text
packages/vault    Markdown and frontmatter parsing, link resolution, rename (no server or browser code)
packages/schema   Shared types and validators for the API and for stored files
apps/server       Fastify API, Git gateway, index; drafts and Publish still to come
apps/web          React app: reader today; editor and Publish still to come
docs/designs      The design, and later one design per stage
```
