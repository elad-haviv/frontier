# Frontier's own library

Status: Draft, 2026-11-21. Author: Elad Haviv. Parent: [Frontier](frontier.md).

## Overview

The parent design made the GitHub repository the one true copy of Avalymia, with Frontier as one of
several writers. Connecting that repository proved to be the obstacle, and sharing it made Frontier
rigid. This design changes the method: Frontier keeps its own knowledge base and is its only writer.
Notes and media come in by import and go out by export.

The author decided three things on 2026-11-21: the knowledge base stays as files; single notes and
media can be imported; and there is a form of version control.

Where this document and the parent differ, this one is the newer statement.

## What changes for the author

| Before | Now |
| --- | --- |
| Frontier needs a GitHub repository, with a token or an App | Frontier starts with a library of its own and needs no account anywhere |
| Writing in Obsidian and in Frontier, kept in step through GitHub | Writing in Frontier. Obsidian reads an exported copy |
| "Publish" sends changes to GitHub and may meet changes made elsewhere | "Save a version" records the changes in the library. Nothing else writes to it, so nothing can clash |
| History is GitHub's | Each entry has its history in Frontier, and any earlier version can be brought back |
| Agents push branches to the repository | Agents read an exported copy. How they propose changes is decided again later (see "What waits") |

## The library

*   **Still files.** The library is a folder of Markdown notes, images and Frontier's own files (maps,
    schema), exactly as the vault was. Nothing about notes, links, fields or maps changes.
*   **Still a repository, now Frontier's own.** The library lives in `/data/library.git` on Frontier's
    disk. Everything already built for reading, drafts and saving works against it unchanged: a draft is
    still a draft, and saving a version is the commit the Publish step made. This is how the sample
    library on the preview has worked all along.
*   **Three ways to run**, chosen by the settings given at start:
    *   **Own library**, the default: no `VAULT_REPO` and no `VAULT_REMOTE_URL`. An empty library with one
        welcome note is made on first start.
    *   **GitHub**, as the parent design describes, when `VAULT_REPO` is set. Nothing is removed; this
        way simply stops being the plan.
    *   **Sample**, for trying things, with `FRONTIER_SAMPLE_VAULT=1`.
*   **Hidden in an own library:** the timer that fetched from GitHub, the agent branches in the inbox,
    and quarantine. They have nothing to do there.
*   **The disk now matters.** The library is the only copy until it is exported or backed up. The backup
    copies the library together with the working files, and the status page says plainly when no backup
    outside the server's own disk is set up.

## Versions

*   **Saving a version.** Unsaved changes are listed as before. "Save a version" records the chosen ones
    with a line saying what changed. Because Frontier is the only writer, the step that asked for a
    merge to be confirmed never appears.
*   **History of an entry.** An entry page has "History": every version that touched it, newest first,
    each with its date, its line of description and what it changed.
*   **Bringing a version back.** "Restore this version" puts that text into a draft of the entry. Nothing
    is lost: the restore is itself saved as a new version, and the versions in between stay in the
    history.
*   **History of the library.** One page lists the versions of the whole library with the files each
    changed.
*   Renaming keeps an entry's history: the history follows the file across its names.

## Import

*   **Notes and media.** On the Import page the author picks one or more files and a folder. A Markdown
    file becomes a new note there; an image goes to the image folder. Each arrives as an unsaved change,
    to be read and then saved as a version like anything typed in Frontier.
    *   A note whose name exists in that folder is not overwritten silently: the author chooses, per
        file, to replace the existing note (it shows as a change to it, with the difference) or to keep
        both under a numbered name.
    *   An image whose name exists anywhere gets a numbered name, as uploads do, because links to images
        go by name.
    *   Other kinds of file are refused with the reason.
*   **A whole vault.** For the first move from Obsidian, and at any time after: the author uploads a zip
    of a vault. Its files are added to the library and saved as one version named by the author. Files
    that exist are replaced; nothing is deleted. A single top folder in the zip, as GitHub's downloads
    have, is removed. `.git` is left out.
*   Limits: 25 MB a file for single files, 1 GB for a vault zip.

## Export

*   **A zip of the library**, as it stands at the last saved version: the same folders and files, ready
    to open in Obsidian. One button.
*   **Later:** a mirror that pushes each saved version to a GitHub repository, one way, for the memory
    bank and the agents. It needs the same token that proved hard to set up, so it is not part of this
    change. The exported zip can be pushed by hand meanwhile.

## What waits

*   **The memory bank.** It was fed from GitHub's `main`. It will be fed from the mirror, or directly by
    Frontier, when stage 8 needs it.
*   **Agents' proposals.** The inbox for agent branches needs a repository agents can push to. With the
    mirror it can return; without it, agents hand their proposals over as files to import.
*   **The parent design's goals about GitHub** (one commit per Publish as the author, never a forced
    push, CUJ 4 and CUJ 6) describe the GitHub way and are not goals of an own library.

## API

| Method and path | Body | Response |
| --- | --- | --- |
| `POST /api/import` | multipart: `folder`, `existing` (`ask`, `replace` or `both`), files | `{ imported: [{ name, path, kind }], clashes: [{ name, path }], refused: [{ name, reason }] }`; with `ask`, clashing notes are listed and not imported |
| `POST /api/import/vault` | multipart: `message`, one zip | `{ files, commit }` |
| `GET /api/export/library.zip` | none | the zip |
| `GET /api/history?path=` | none | `{ versions: [{ commit, at, message, paths }] }`, newest first, at most 100; without `path`, the library's |
| `GET /api/history/version?path=&commit=` | none | `{ text, before }`: the note at that version and just before it |

The status snapshot gains `library`: `own`, `github` or `sample`, and `backupOutside`: whether a backup
outside the server's disk is set up.

## Files

| File | What |
| --- | --- |
| `apps/server/src/library.ts`, `config.ts`, `main.ts` | Choosing the way to run; making the own library; no timer in an own library |
| `apps/server/src/git/gateway.ts` | History of a path and of the library; a file at a version; adding a folder of files as one version; the zip |
| `apps/server/src/routes/{import,history}.ts` | The routes above |
| `apps/server/src/app.ts`, `status/status.ts`, `backup/backup.ts` | The library in the backup; `library` and `backupOutside` in the status |
| `apps/web/src/pages/{Import,History,LibraryHistory}.tsx` | The new pages |
| `apps/web/src/pages/{Entry,Unpublished,Inbox,Status}.tsx`, `components/Shell.tsx` | "History" on an entry; the wording of saving a version; nothing about agents or quarantine in an own library |

## Risks

| Risk | Effect | Answer |
| --- | --- | --- |
| The server's disk is lost | The library is lost | Backup of the library to a storage bucket; the status page warns while there is none; export is one button |
| A vault zip overwrites notes changed in Frontier since | The newer text is replaced | Nothing is deleted from the history: the earlier text is one "Restore" away; the page says how many existing files a zip will replace before it is saved |
| The deployment has no lasting disk | Every restart begins an empty library | Said on the status page; the deployment guide requires a volume on `/data` |

## Verification

*   **Server:** starting with no repository settings gives an own library with a welcome note; a draft
    saved as a version; history of an entry across a rename; a version's text and the text before it;
    restoring through a draft; importing a note, an image, a clash each way, a refused file; a vault zip
    with a top folder, replacing and adding and never deleting; the export zip holding the saved files;
    the library in the backup.
*   **Browser:** import a note and an image, save a version, open the history, restore the first
    version; export; the wording of an own library.
