# Frontier

A web app for one author to write, read and explore Avalymia, a fantasy multiverse kept as Markdown
notes in the `elad-haviv/avalymia` repository. The Markdown files stay the source of truth; Frontier is
a way of working on them.

The full design is in [docs/designs/frontier.md](docs/designs/frontier.md). What is next, and the place for new ideas, is [docs/BACKLOG.md](docs/BACKLOG.md).

## Status

Stage 1 of nine is in progress. What exists so far:

| Part                                                                                                                                         | State                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/vault`: reading notes, frontmatter, line endings, links, link resolution, rename planning                                          | Built and tested                                                             |
| `packages/schema`: types and validation shared by server and web                                                                             | Built and tested                                                             |
| `apps/server`: configuration, Git gateway, in-memory index, login, status, webhook, timer fetch, image serving                               | Built and tested                                                             |
| `apps/server`: drafts, two-call Publish with merge and conflicts, renames, crash recovery                                                    | Built and tested                                                             |
| `apps/server`: backup of working files and a restore command                                                                                 | Built and tested; the S3 path has not run against a real bucket              |
| `apps/web`: login, folder tree, entry reader, image lightbox, status page, quick switcher                                                    | Built; covered by browser tests                                              |
| `apps/web`: source editor with autosave and link autocomplete, new, delete and rename, unpublished list, Publish, merge and conflict screens | Built; covered by browser tests                                              |
| Full-text search, outline, hover preview, editing toolbar                                                                                    | Built; covered by browser tests                                              |
| Live preview; image upload; table editing; properties panel                                                                                  | Built; image sizing and table row tools still to do                          |
| Stage 3: inbox for agent branches; type and date fields; AI provider, cap and field proposals; quarantine; passkey login                     | Built; the AI needs an OpenRouter key, and quarantine needs the sync changed |
| Stage 4: maps (flat maps and globes, markers, paths, zones, layers, measuring)                                                               | Built; to be tried on the real images                                        |
| Own library: Frontier keeps the knowledge base itself, with versions, import and export                                                      | Built; the preview still shows the sample                                    |
| Stage 11a: icons, tooltips, menus, one keys registry; a save queue on the device, saves that say what they started from                      | Built; covered by tests. 11b (the shell) and 11c (folder tree) to come       |
| Stage 25: Home with a work queue, From here, pins, random entry, back to last, resume position, recents in the switcher                      | Built; covered by tests                                                      |
| Stages 26 and 28: the library as a menu item and full-drawer panel on the phone, and as a pane beside the sidebar on desktop                 | Built; covered by tests                                                      |
| Stage 29: generating pictures for entries from the image dialog, in the art style from Settings                                              | Built; covered by tests                                                      |
| Stage 30: Trees: relations on entries; family trees, descent, pantheons and hierarchies; an entry's Relations tab                            | Built; covered by tests                                                      |
| Stage 31: the AI proposes relations from the prose, decided in the inbox, in trees and in an entry's Relations tab                           | Built; covered by tests                                                      |

The app writes to its vault: drafts are saved on the server and Publish makes one commit.

A preview on made-up sample content runs with `FRONTIER_SAMPLE_VAULT=1`; see the Dockerfile.

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
npm run set-password -w apps/server   # once
npm start -w apps/server
```

`.env.example` lists every variable, including the ones for GitHub and the bucket.

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
