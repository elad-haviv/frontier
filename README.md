# Frontier

A web app for one author to write, read and explore Avalymia, a fantasy multiverse kept as Markdown
notes in the `elad-haviv/avalymia` repository. The Markdown files stay the source of truth; Frontier is
a way of working on them.

The full design is in [docs/designs/frontier.md](docs/designs/frontier.md). What is next, and the place for new ideas, is [docs/BACKLOG.md](docs/BACKLOG.md).

## Status

Stage 1 of nine is in progress. What exists so far:

| Part                                                                                                           | State                                                                    |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/vault`: reading notes, frontmatter, line endings, links, link resolution, rename planning            | Built and tested                                                         |
| `packages/schema`: types and validation shared by server and web                                               | Built and tested                                                         |
| `apps/server`: configuration, Git gateway, in-memory index, login, status, webhook, timer fetch, image serving | Built and tested                                                         |
| `apps/server`: drafts, two-call Publish with merge and conflicts, renames, crash recovery                      | Built and tested                                                         |
| `apps/web`: login, folder tree, entry reader, status page                                                      | Built                                                                    |
| `apps/web`: source editor with autosave, new and delete, unpublished list, Publish, merge and conflict screens | Built; checked by a scripted browser run, not yet a committed test suite |
| Backup and restore; the browser test suite; rename screen; image upload; search; live preview                  | Not started                                                              |

The app can now write to its vault: drafts are saved on the server and Publish makes one commit.

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
