# Administration: running the server

This chapter is for the person who runs Frontier's server: installing it, giving it a password,
keeping it backed up and fixing it when something goes wrong. If you only write in Frontier, you
do not need it.

You do not need to be a programmer. You do need to be comfortable with three things: pasting values
into a form on your hosting service (this chapter uses Coolify as the example), opening a
terminal on the server, and copying a command.

**In this chapter**

- [What you are running](#what-you-are-running)
- [Before you start](#before-you-start)
- [Environment variables](#environment-variables)
- [Deploy with Docker or Coolify](#deploy-with-docker-or-coolify)
- [Set the password](#set-the-password)
- [Passkeys](#passkeys)
- [Own library, GitHub library or sample](#own-library-github-library-or-sample)
- [Sample preview mode](#sample-preview-mode)
- [Backups](#backups)
- [Restore from a backup](#restore-from-a-backup)
- [Using GitHub: the webhook and the timer fetch](#using-github-the-webhook-and-the-timer-fetch)
- [Rate limiting and sessions](#rate-limiting-and-sessions)
- [What is in the data folder](#what-is-in-the-data-folder)
- [Upgrading](#upgrading)
- [Troubleshooting](#troubleshooting)

---

## What you are running

Frontier is one program in one container. It serves the web app, keeps your library (the Markdown
notes, images and maps), keeps your drafts and settings, and makes backups. There is one account: you.
There is no sign-up page.

Everything that matters lives in one folder, the **data folder** (`/data` inside the container). That
folder must sit on a disk that survives restarts. If it does not, every restart starts an empty
library.

The container listens on port **3000**. Put a web address with HTTPS in front of it (Coolify does
this for you).

## Before you start

You need:

| You need | Why |
| --- | --- |
| A server that runs Docker, such as one managed by Coolify | Frontier ships as a Docker image |
| A web address for Frontier, with HTTPS | Passkeys and secure login cookies need it |
| A **persistent volume** mounted at `/data` | Your library and settings live there |
| Optional: an S3-compatible storage bucket | Backups that survive losing the server's disk |
| Optional: a GitHub repository, with a token or a GitHub App | Only if you want to share a library through GitHub |

**Tip:** With only a web address, a session key and a disk, Frontier runs a library of its own and
needs no account anywhere. This is the simplest setup and the one this chapter assumes unless it
says otherwise.

## Environment variables

Settings are given as environment variables. In Coolify you add them under the application's
**Environment Variables**. A missing or malformed required variable stops the server at start with a
message that names it, for example `Frontier cannot start. Missing environment variable: PUBLIC_URL`.

### Required in every setup

| Variable | What to give it |
| --- | --- |
| `PUBLIC_URL` | The full public address, such as `https://frontier.example.com`. Must start with `https://` (or `http://` for local trials). Passkeys are tied to its host name, so choose it once. |
| `SESSION_KEY` | 32 random bytes in base64. Create one with `openssl rand -base64 32`. It signs the login cookie. Changing it logs you out. |

### Strongly recommended

| Variable | What to give it |
| --- | --- |
| `DATA_DIR` | The folder on the persistent disk. Default `/data`, which the Docker image already uses. |
| `SECRETS_KEY` | 32 random bytes in base64 (`openssl rand -base64 32`). It encrypts the AI provider keys you enter on the Providers settings page. **Keep a copy**: without it a stored key cannot be read and you must enter it again. Without `SECRETS_KEY`, you cannot store keys on the settings page at all. |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` | A storage bucket for backups (see [Backups](#backups)). All five are required together. |

### Optional

| Variable | What it does |
| --- | --- |
| `BACKUP_S3_PATH_STYLE` | `true` by default. Set to `false` for services that need address-style bucket names. |
| `OPENROUTER_API_KEY` | An OpenRouter key from the environment, used when none is stored on the settings page. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `XAI_API_KEY` | The same, for the other providers. A key stored on the settings page takes precedence. |
| `OPENROUTER_BASE_URL`, `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `GEMINI_BASE_URL`, `XAI_BASE_URL` | Replace a provider's usual address, for example to go through a proxy. Leave out normally. |
| `FRONTIER_INITIAL_PASSWORD` | A first password, used only while no password is stored. See [Set the password](#set-the-password). |
| `COMMIT_AUTHOR_NAME`, `COMMIT_AUTHOR_EMAIL` | The name and email recorded on the versions you save. For an own library they default to `Author` and `author@frontier.invalid`. |
| `COMMIT_BOT_NAME`, `COMMIT_BOT_EMAIL` | The name and email recorded as the committer. Default `frontier` and `frontier@frontier.invalid` for an own library. |
| `UPLOAD_FOLDER` | The library folder new images are put in. Default `99 Appendices/01 Images`. |
| `ICON_FOLDER` | The library folder whose subfolders are map marker sets. Default `99 Appendices/07 Icons`. |
| `FRONTIER_SERVICE_WORKER` | Set to `off` to make every browser remove Frontier's offline helper at its next visit. Unsent changes stay. Remove the variable to switch back. Use only if an old copy of the app is stuck in browsers. |
| `PORT` | The port to listen on. Default `3000`. |

### Only when sharing a library through GitHub

| Variable | What to give it |
| --- | --- |
| `VAULT_REPO` | The repository as `owner/name`. Setting this switches Frontier to the GitHub way of running. |
| `GITHUB_TOKEN` | A fine-grained personal access token for that repository, with read and write access to **Contents**. Frontier's pushes then show as yours. |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID` | Instead of a token: Frontier's own GitHub App, installed on the vault repository only. Give **one** way, token or App, not both. In the private key, write line breaks as `\n`. |
| `WEBHOOK_SECRET` | Optional. Checks the signature on GitHub's push webhook. See [Using GitHub](#using-github-the-webhook-and-the-timer-fetch). |
| `COMMIT_AUTHOR_NAME`, `COMMIT_AUTHOR_EMAIL`, `COMMIT_BOT_NAME`, `COMMIT_BOT_EMAIL` | Required in this mode. |
| `BACKUP_S3_*` | Required in this mode, unless `BACKUP_LOCAL_DIR` is set. |

### For trials and tests

| Variable | What it does |
| --- | --- |
| `FRONTIER_SAMPLE_VAULT` | `1` runs the made-up sample library. See [Sample preview mode](#sample-preview-mode). |
| `VAULT_REMOTE_URL` | A Git address or folder used in place of GitHub. When set, the GitHub variables are not needed. |
| `BACKUP_LOCAL_DIR` | A folder used in place of the bucket. When set, the `BACKUP_S3_*` variables are not needed. |

You do not set `FRONTIER_LIBRARY` yourself: Frontier chooses it from the variables above.

### Making the two keys

Run this twice, once for `SESSION_KEY` and once for `SECRETS_KEY`, and use different values:

```
openssl rand -base64 32
```

Each must decode to exactly 32 bytes; anything else stops the server with a message saying so. Store
both in your password manager.

## Deploy with Docker or Coolify

The repository's Dockerfile builds the app in one stage and runs it in a small second stage. The
finished image contains Node 22, Git, `pandoc` (used for Word and PDF exports) and the compiled
app. It runs as the unprivileged user `node`, listens on port 3000, and checks its own health every
30 seconds at `/health`.

### On Coolify

1. Create a new **Application** from the Frontier repository, with the build method **Dockerfile**.
2. Set the exposed port to **3000** and give it your domain. Coolify's proxy provides HTTPS.
3. Under **Storages**, add a **persistent volume** and mount it at `/data`.
4. Under **Environment Variables**, add `PUBLIC_URL`, `SESSION_KEY` and `SECRETS_KEY`, plus the
   backup bucket variables if you have a bucket. Optionally add `FRONTIER_INITIAL_PASSWORD`.
5. Set the health check path to `/health`.
6. Deploy.
7. Open your address. If you set `FRONTIER_INITIAL_PASSWORD`, log in with it. Otherwise
   [set the password](#set-the-password) first.

On the first start with no repository settings, Frontier creates its own library in
`/data/library.git` with one welcome note.

### With plain Docker

```
docker build -t frontier .
docker run -d --name frontier -p 3000:3000 \
  -v frontier-data:/data \
  -e PUBLIC_URL=https://frontier.example.com \
  -e SESSION_KEY=... -e SECRETS_KEY=... \
  frontier
```

Put a reverse proxy with HTTPS in front of port 3000. Frontier trusts the proxy's forwarded address
headers, so login rate limiting sees each visitor's real address.

### Checking that it runs

Open `https://your-address/health`. It answers with a short report: whether the library index is
built (`ok`), the commit it was built from, and the times of the last fetch and last backup.
`ok: true` and status 200 mean healthy. Status 503 means the library index is not built yet or could
not be built.

## Set the password

Frontier has one account. Its password is set on the server, not in the browser. It must be at least
12 characters.

**Option A: give a first password in the environment.** Set `FRONTIER_INITIAL_PASSWORD` and deploy.
It is stored the first time the server starts with no password set, and ignored after that. Remove
the variable afterwards so the password does not sit in your settings.

**Option B: run the set-password command.** Open a terminal in the running container (in Coolify:
the application's **Terminal**) and run:

```
node apps/server/dist/cli/set-password.js
```

It asks, `New password (at least 12 characters):`, and reads what you type from standard input, so the
password is not saved in the shell history. It answers `Password set.` and tells you where it stored
it. The new password works at once, without a restart.

From a checkout of the code with its dependencies installed, the equivalent is
`npm run set-password -w apps/server`, run with `DATA_DIR` set to the same data folder.

Set-password also **switches the password back on** if you had switched it off after adding a
passkey. This is the way back in if you lose your passkey device. Everything else in the settings is
left as it was.

> **Note:** The `npm run ...` forms use a tool that the production Docker image leaves out to keep it
> small. Inside the container, use the `node apps/server/dist/cli/...` forms shown here.

## Passkeys

A passkey lets you log in with your device's fingerprint, face or screen lock. You add one in the app
(**Settings, Signing in, Add a passkey**) while logged in. What the administrator needs to know:

- Passkeys need `PUBLIC_URL` to be the real address people use, with HTTPS. A passkey belongs to the
  host name in `PUBLIC_URL`. If you move Frontier to a new domain, old passkeys stop working; log in
  with the password and add them again.
- The server stores only the public half of each passkey. It cannot log in as you.
- Once a passkey works, **Switch the password off** in the same page removes password login. That
  option is offered only after you have logged in with a passkey, to prove the passkey works.
- Frontier will not let you remove your last passkey while the password is off.
- **Lost the device?** Run the set-password command above. It switches the password on again.

## Own library, GitHub library or sample

Frontier chooses how to keep your notes from the variables you give:

| Mode | When | What it means |
| --- | --- | --- |
| **Own library** (default) | No `VAULT_REPO` and no `VAULT_REMOTE_URL` | The library is a Git repository kept in `/data/library.git` on Frontier's disk. Frontier is the only writer. No account anywhere. The library is included in backups. You bring notes in with Import and take them out with Export. |
| **GitHub** | `VAULT_REPO` is set | The library is a GitHub repository that others (for example, an editor on your computer) may also write to. Frontier fetches changes and pushes your saved versions. |
| **Sample** | `FRONTIER_SAMPLE_VAULT=1` | A made-up library for trying things. Nothing outside the container is read or written. |

In an own library, parts of the app that only make sense with GitHub are hidden: the timer fetch,
the inbox for agent branches and quarantine.

**Important in an own library:** the library exists only on the server's disk until it is backed up
or exported. The **Status** page shows a warning when the backup goes only to the same disk. Set up
a storage bucket, and export the library now and then (**Settings, Backups and export, Download the
whole library**).

## Sample preview mode

Sample mode is for previews and demos. Set `FRONTIER_SAMPLE_VAULT=1`. On start Frontier builds a
small Git repository from the bundled sample library inside the data folder
(`sample-remote.git`) and uses it as its home, with a sample map and a sample proposal branch in the
inbox. Defaults are filled in for you, so you only need `PUBLIC_URL`, `SESSION_KEY`, and a password
(for example `FRONTIER_INITIAL_PASSWORD`):

| Filled in automatically | Value |
| --- | --- |
| Backup folder | `/data/bucket` (on the same disk) |
| Icon folder | `99 Appendices/Icons` |
| Commit author | `Sample Author` |

Do not use sample mode for your real library. To go back to a real library, remove the variable; give
it a clean data folder if you do not want the sample's files around.

## Backups

Frontier backs up the data that cannot be rebuilt from anywhere else.

| What | Where in the data folder |
| --- | --- |
| Settings, drafts, comments, conversations, the AI log and other working files | `state/` |
| Pictures made by the AI | `assets/generated/` |
| The library itself, **in own-library mode only** | `library.git/` |

In GitHub mode the library is already safe on GitHub, so it is not copied.

Two kinds of copy are made:

- **Latest.** A few minutes (5) after any change, Frontier brings a mirror up to date, including
  deletions.
- **Nightly.** At **03:00 server time**, a full dated copy is written. The last **14** nights are kept;
  older ones are removed.

Where the copies go:

- **A storage bucket** (any S3-compatible service) when you give the five `BACKUP_S3_*` variables.
  This is what you want: it survives losing the server.
- **A folder on the server's disk** when you set `BACKUP_LOCAL_DIR`, and, in own-library mode with
  no bucket, automatically `/data/backup`. This protects against mistakes, not against losing the
  disk.

You can see the result on the **Status** page and under **Settings, Backups and export**: the time of
the last backup, and in red the last error if the most recent attempt failed.

> **Note:** The bucket connection has not yet been tried against every storage service. If it fails
> on yours, the error shown on the Status page is the message to search for. Check the endpoint,
> region, keys, and whether the service needs `BACKUP_S3_PATH_STYLE=false`.

## Restore from a backup

Use this to fill a new, empty server after losing the old one.

1. Deploy Frontier with the **same** `SESSION_KEY`, `SECRETS_KEY` and backup variables as before
   (the same bucket), and a new empty volume on `/data`. Do not log in or change anything yet.
2. **Stop** the application. The restore must run while the server is stopped.
3. In a terminal with the same environment and data folder, run:

```
node apps/server/dist/cli/restore.js
```

   to restore the latest copy, or name a night:

```
node apps/server/dist/cli/restore.js 2026-11-20
```

   (From a checkout: `npm run restore -w apps/server` or `npm run restore -w apps/server -- 2026-11-20`.)

4. It prints `Restored N files from latest/ into /data.` (or the night). Start the application again.

Good to know:

- Restore refuses to write into a folder that already holds files, so it cannot overwrite work. If it
  says a folder "is not empty", restore into a fresh volume.
- If there is nothing to restore it says `There is no backup under "latest/".` and `Nothing was
  restored.`
- `SECRETS_KEY` is not in the backup. Without it the stored AI provider keys cannot be read; you
  would enter them again.
- **Own library:** as built, the restore command fills the working files (`state` and `generated`)
  only. The copy of the library itself is in the bucket under `latest/library/` (or
  `nightly/<date>/library/`). Copy those files back into `/data/library.git` by hand with your
  bucket's tools before starting the server, or import a library export (a zip you downloaded
  earlier) on the Import page.

## Using GitHub: the webhook and the timer fetch

This section applies only when `VAULT_REPO` is set.

Frontier needs to learn when someone else changes the repository. Two things do it, and you can use
either or both:

- **The timer fetch.** Every **5 minutes** Frontier fetches the repository and rebuilds its index if
  `main` moved. It needs nothing from you. It is the only mechanism if you give no webhook secret.
- **The webhook.** For changes to show up at once, add a webhook to the GitHub repository:

| Setting in GitHub | Value |
| --- | --- |
| Payload URL | `https://your-address/api/github/webhook` |
| Content type | `application/json` |
| Secret | The same text you gave as `WEBHOOK_SECRET` |
| Events | Just the push event |

Frontier checks the signature on each delivery. A delivery with a wrong signature is refused (401); if
`WEBHOOK_SECRET` is not set, the address answers "not found". Only pushes to `main` trigger a fetch.

In an own library none of this applies: Frontier is the only writer, and no timer runs.

**GitHub token or App?** The token is the simple way: your commits show as you. A GitHub App gives
Frontier its own identity and can be limited to the one repository. Give one or the other.

## Rate limiting and sessions

- **Login attempts:** 5 per 15 minutes for each network address, counted together for password and
  passkey attempts. After that, login answers "Too many attempts. Wait 15 minutes and try again."
  The count lives in memory, so restarting the application clears it.
- **Pictures from a web address:** at most 10 a minute.
- **Sessions:** a login lasts 30 days. The cookie is marked secure when `PUBLIC_URL` starts with
  `https://`.
- **Upload size:** 25 MB per file.
- The app sends strict content security headers. Frontier cannot be shown inside another site's
  frame.

## What is in the data folder

Everything lives under `DATA_DIR` (default `/data`):

| Item | What it is | Can it be rebuilt? |
| --- | --- | --- |
| `library.git/` | Own-library mode: the library's Git repository | **No.** Back it up. |
| `vault/` | The working copy of the library | Yes, from the library or GitHub |
| `state/` | Working files, see below | **No.** Back it up. |
| `assets/generated/` | Pictures made by the AI | **No.** Back it up. |
| `assets/` (other) | Other files derived from the library | Yes |
| `backup/` | Local backup copies (own library without a bucket) | n/a |
| `bucket/` | Local backup copies in sample mode | n/a |
| `sample-remote.git/` | Sample mode's library | n/a |

Inside `state/`:

| File or folder | What it holds |
| --- | --- |
| `settings.json` | The password hash, passkeys, AI providers (keys encrypted), models, monthly cap, and other settings |
| `drafts/` | Unsaved changes to entries, including texts kept from other devices |
| `comments.json` | Comments on entries |
| `conversations/` | Saved lore conversations |
| `discoveries/` | Discovery cards |
| `proposals/` | The AI's proposed changes waiting in the inbox |
| `ai-log/` | The record of every AI call and its cost |
| `inbox/`, `quarantine/` | Agent-branch and quarantine bookkeeping (GitHub mode) |
| `backup.json` | When the last backup ran and its last error |

**Never edit these files by hand while the server runs.**

## Upgrading

1. Make sure the last backup on the Status page is recent.
2. In Coolify, press **Deploy** (or pull the new code and rebuild the image). The `/data` volume is
   kept, so your library, settings and drafts carry over.
3. Open Frontier. People with it open see **A new version of Frontier is ready** with **Reload** and
   **Later**. The new version takes over only when they press Reload, in every open tab at once, and
   not while changes are being sent.

Keep the same `SESSION_KEY` and `SECRETS_KEY` so nobody is logged out and stored keys stay readable.
If something goes wrong, Coolify can roll back to the previous image; the data folder is unaffected.

## Troubleshooting

| What you see | Likely cause and fix |
| --- | --- |
| `Frontier cannot start. Missing environment variable: ...` | A required variable is empty. The message names it. In GitHub mode that includes the commit and backup variables. |
| `SESSION_KEY must be 32 bytes in base64` (or `SECRETS_KEY ...`) | The value is not 32 bytes. Generate it with `openssl rand -base64 32`. |
| `PUBLIC_URL must be a full address` | Include `https://`, for example `https://frontier.example.com`. |
| Everything is empty after a restart | `/data` is not on a persistent volume. Add the volume, then restore from a backup. |
| Login says "No password has been set yet. Run the set-password command on the server." | See [Set the password](#set-the-password). |
| Login says "Logging in with the password is switched off. Use a passkey." | Log in with a passkey, or run set-password to switch the password on again. |
| "Too many attempts. Wait 15 minutes and try again." | Rate limit. Wait, or restart the application to clear the count. |
| Passkey button fails, or "The passkey could not be checked" | `PUBLIC_URL` must match the address in the browser exactly, with HTTPS. After a domain change, add the passkey again. |
| Settings, Providers says "A key cannot be stored here: the server has no SECRETS_KEY" | Set `SECRETS_KEY`, or give the provider key as an environment variable such as `OPENROUTER_API_KEY`. |
| Provider says "The stored key can't be read. Enter it again." | `SECRETS_KEY` changed or was lost. Enter the key again. |
| Status shows a backup error | Read the message: bucket address, region, name, keys or path style. Fix the variable and redeploy; the next change or the nightly run tries again. |
| Status warns the library "is backed up only to that same disk" | Own library with no bucket. Add the `BACKUP_S3_*` variables, and export the library now and then. |
| "Another Git operation is still running. Try again shortly." | Frontier handles one Git job at a time; wait a minute. If it stays, restart. |
| Changes from GitHub do not appear | The timer runs every 5 minutes. Check the webhook's Recent Deliveries in GitHub; a 401 means the secret does not match `WEBHOOK_SECRET`. |
| Saving fails on GitHub ("push failed") | The token lost access, expired, or lacks write access to Contents; or the App is not installed on the repository. |
| Word or PDF export fails | The image needs `pandoc`; it is included in the Docker image. A plain `node` install needs it added. |
| `/health` answers 503 | The library index is not built: check the logs for clone or sync errors. |
| An old version of the app sticks in a browser | Set `FRONTIER_SERVICE_WORKER=off`, redeploy, ask the browser to reload, then remove the variable. |

**Where are the logs?** The container's standard output. In Coolify, the application's **Logs**
tab. Cookies, authorization headers and keys sent to the provider pages are kept out of the log. A failed AI call is
written there too.
