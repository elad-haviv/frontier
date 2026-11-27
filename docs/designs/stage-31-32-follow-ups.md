# Stages 27 and 28: follow-ups

Things the reviews of stages 27 (people and projects) and 28 (email) found and that were left on
purpose, and things to do when the server is deployed. Nothing here blocks use. The high and medium
findings of every review were fixed; these are the low ones and the accepted risks.

## Before the first deploy with other people

- **Mail.** Frontier must share a Docker network with the mail relay, and needs `SMTP_HOST` and
  `MAIL_FROM` (see the README). The haviv.pro domain needs its SPF and DKIM records published, or mail
  may land in spam. Mail was tested against a stand-in relay only, never the real one.
- **Google sign-on** is off until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. It was tested
  against a stand-in provider only.
- **The proxy's address.** The rate limits count by the address the proxy reports (`trustProxy` is
  on). If the proxy passes a client's own `X-Forwarded-For` through, the limits can be dodged.
- **Old server-side AI keys** are deleted on upgrade, with a notice to revoke them at the provider.
- **Every existing account starts with an unconfirmed address.** With mail on, each person sees
  "Confirm your email" until they press "Send a link" and open it.
- **Old comments** stay visible to writers and owners only until someone shares them. A comment the
  first owner wrote may be marked this way too; sharing it is one click.

## Accepted, and written down so nobody is surprised

- An address typed when joining by password or passkey is unconfirmed until its link is opened; an
  owner sees the "Unconfirmed" mark. Nothing is locked for it.
- A removed writer's request that was already running finishes its own write.
- A Google account whose address was verified long ago keeps `email_verified` for that address. It
  can take an address only from an account that let its own confirm link lapse.
- The compare screen asks before leaving with typed text, except for the browser's Back button.
- A push stopped by the 90-second timeout may still have reached the remote; the next fetch shows it.
- The open-comments badge counts open threads. There is no per-person "unread" count.
- Comments cannot be written or read offline.
- A device still running the app from before stage 27c opens `/join/<code>` as a not-found page until
  it takes the update.

## Low findings left for later

Accounts, joining and Google:
- Body-less state-changing requests rely on `SameSite=Lax` plus the `Sec-Fetch-Site` check; browsers
  that send neither header are not covered.
- The invite code can be told from the log only if the parameter name is percent-encoded.
- After a login on the join page whose accepting then fails for a reason other than a dead link, the
  page reloads and the reason is not shown.

Projects and the device:
- With IndexedDB unavailable, stranded changes and per-person lookup do not survive a reload.
- The confirm dialog for deleting a project with unsent changes has no browser test.

Unsaved changes, authors and presence:
- The "compared version" remembered for the old resolve request is in memory only; after a restart
  the person plans again.
- Members removed before former members were recorded show Git's name on their old versions.
- A person's waiting delete of an entry is dropped when someone else's saved rename moves it.
- Presence of a page left open after a logout in another tab keeps its heartbeat until the page is
  closed or reloaded.
- `GET /entries` can answer "no such draft" for a moment right after a keep-theirs resolve.

Email:
- A change of address set while mail was off is "set by the account itself": if mail is switched on
  later, that address gets no reset link until it is confirmed.
- The "address has been changed" notice is not counted against the old address's mail allowance
  (the "is being changed" notice is).
- Implicit TLS and a real STARTTLS upgrade were not tested against a real relay.

Tests:
- `graph/layout.test.ts` ("gives the same positions for the same input") times out under heavy
  machine load and passes alone.
- `keepgoing.spec.ts` "after Publish … goes away after ten seconds" and `reader.spec.ts` "outline"
  have each failed once under load and passed alone.
- `keepgoing.spec.ts` "p twice quickly makes one change" failed once in the last full run (478 passed).
  It passes when run one at a time (9 of 9) and fails now and then when the phone and desktop
  copies run together: both act as the same person on the same pin.
- Running one email spec several times in parallel collides on member names; a single run is fine.

## Choices made while building that the owner may want to change

- Only the admin can create projects.
- The custom OpenAI-compatible AI provider was removed with the move to device keys.
- AI keys stay on the device per person at logout; they are not wiped.
- A departed member's unsaved changes are kept for 30 days and come back if they rejoin.
- A clean merge still shows the compare screen when someone else saved first; the merged text is
  offered ready-made.
- Comment limits: 2000 characters, 300 open shared comments per entry, 200 open per person per
  project, 100 replies, 40 writes a minute.
- Mail limits per hour: 6 mails per recipient, 5 resends per account, 3 forgot-password requests per
  address, 10 per network address, 20 emailed invitations per person.
