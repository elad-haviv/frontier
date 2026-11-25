# Stage 24b: Consult, a saved history

- **Status:** Approved by the author (2026-11-25), all four recommendations accepted.
- **Mockup:** shared in the session (`consult-history-mockup.html`).

 Follows [stage 24](stage-24-consult.md); this reverses its decision 5 ("findings are temporary").

## 1. What's wrong today
Results live in the open editor page only. Leave the page, or even close the tab, and the review is gone, as is what you decided about each finding. Applied and dismissed findings vanish from the list, so you cannot see later what was suggested or what you did.

## 2. The design
**Every consultation is saved, per entry, on the server.** The Consult tab opens on your latest review, with each finding's state, until you press Consult again.

- **States kept per finding:** Open, Applied (with the words it replaced and the words it put), Comment added, Dismissed.
- **Dismissed findings stay** in a folded "Dismissed (n)" group with **Restore**, instead of disappearing.
- **History:** a "History (n)" button beside the latest review opens a list of the entry's reviews, newest first: date, what was read (My changes, Whole entry, Selected passage), the summary line and a chip for how each finding ended. Open one to read it, with "Consult again with these settings" and "Delete this review". "Clear history" deletes all, after a confirmation.
- **Older reviews** find each passage again by its words. If the text has changed they say "Passage changed" and cannot be shown in the text, but can still be read. Apply is only offered on a finding whose passage is found and which is still open.
- **Ask more** questions and replies are kept with the finding.
- **Where it lives:** `/data/state/consults.json`, beside the comments: not in the library, not published, not in any export. It follows the entry when it is renamed or moved and goes when the entry is deleted.
- **Limits:** the last 20 reviews per entry; the oldest is dropped when a new one is saved. Offline, history opens from the device's last read; a new consultation still needs a connection.
- **Phone:** the same list in the existing sheet; rows are at least 44 px.

## 3. Decisions for you
1. **Server or this browser only?** *Recommendation: server*, so it follows you between phone and desktop, as comments do. Browser storage would lose it on a new device.
2. **How many to keep?** *Recommendation: 20 per entry*, with delete for one or all.
3. **Should dismissed findings stay visible?** *Recommendation: yes*, folded, with Restore.
4. **Store the entry's text with each review?** *Recommendation: no.* Only the findings, summary, verdicts, replies, and for applied ones the words before and after. This keeps the file small and keeps old text out of a second place.

## 4. Build plan (about 1.5 days)
| # | Where | What |
| --- | --- | --- |
| 1 | `apps/server/src/consults/store.ts` (new) | `ConsultStore` like `CommentStore`: one JSON file, a queue for writes, list/get/save/update-finding/delete/clear, cap of 20, follows renames and deletes. |
| 2 | `routes/writing.ts` | `review` saves its result and returns its id; `GET /api/write/reviews?path=`, `GET /api/write/reviews/:id`, `PATCH` a finding's state or reply, `DELETE` one or all. |
| 3 | `consult/ConsultPanel.tsx` | Load the latest review on open; show states and the folded Dismissed group; History list and a past review's view; save each state change. |
| 4 | Tests | Server: save, cap of 20, rename, delete, state change. Web e2e: leave and come back, apply then reopen, dismiss and restore, delete. |

## 5. As built (2026-11-25)

- **Server:** `apps/server/src/consults/store.ts` (`ConsultStore`, `/data/state/consults.json`, last 20 per entry, follows renames); `POST /api/write/review` now saves and returns the review with its id; `GET /api/write/reviews?path=`, `PATCH /api/write/reviews/:id/findings/:finding`, `DELETE /api/write/reviews/:id` and `DELETE /api/write/reviews?path=`. Tests in `apps/server/test/review.test.ts`.
- **Web:** `ConsultPanel.tsx` reads the saved reviews when the tab opens and shows the latest; History, a past review, Restore, delete and Clear history as in the mockup. Tests in `apps/web/e2e/consult.spec.ts`.
- **Differences from the mockup:** "Edited since this review" shows only when the text changed during this visit, since the entry's text is not stored with a review (decision 4). A review of an entry that is later deleted stays in the file, out of sight, until the history of an entry with that path is cleared; it is not removed with the entry.
