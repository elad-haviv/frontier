# Frontier

A web app for one author to write, read and explore Avalymia, a fantasy multiverse kept as Markdown
notes in the `elad-haviv/avalymia` repository. The Markdown files stay the source of truth; Frontier is
a way of working on them.

The full design is in [docs/designs/frontier.md](docs/designs/frontier.md).

## Status

Stage 1 of nine is in progress. What exists so far:

| Part                                                                                                | State            |
| --------------------------------------------------------------------------------------------------- | ---------------- |
| `packages/vault`: reading notes, frontmatter, line endings, links, link resolution, rename planning | Built and tested |
| `packages/schema`: types and validation shared by server and web                                    | Built and tested |
| `apps/server`: Git gateway, drafts, Publish, index, login, backup                                   | Not started      |
| `apps/web`: reader, editor, Publish screens                                                         | Not started      |

Nothing in this repository can write to the vault yet.

## Working on it

Needs Node 22.

```sh
npm install
npm test          # unit tests in every workspace, with coverage thresholds
npm run typecheck
npm run lint
npm run build
```

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
apps/server       (planned) Fastify API, Git gateway, index, static file serving
apps/web          (planned) React app: reader, editor, Publish
docs/designs      The design, and later one design per stage
```
