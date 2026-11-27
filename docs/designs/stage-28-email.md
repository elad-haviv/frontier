# Stage 28: Email

Approved by Elad on 2026-11-27, with all four recommended decisions (section "Decisions") and the
"Smaller points I assumed". Mockup: https://claude.ai/artifact/B7Mb9TUNWMr9NErdQXYqMp (eight screens,
desktop and phone). Frontier can now send mail from noreply@haviv.pro. Three uses: confirm an address
on join, email the invite, and forgot password.

Added at approval: when a Google-verified person has the same address as an unconfirmed account, the
Google person wins and the unconfirmed account is asked to add another address.

## What is wrong today

- An owner makes an invite link and must carry it to the person by hand.
- The address someone types when joining by password or passkey is never checked. It may be a typo or someone else's.
- A forgotten password cannot be recovered. There is no way back in except an owner's help.
- Nothing tells a person, or the owner, whether an address is real.

## The design

**Invite (screen 1).** The invite dialog gains an optional field, "Send it to". With an address, the button reads "Send the invite"; without, "Make the link", as now. Either way the link is shown to copy afterwards. The dialog says: "The link works once and for 7 days. Anyone who opens it can join with it, whoever you send it to." Invitations waiting shows "Sent to <address>" with **Resend** and **Cancel it**. Resend makes a new link, cancels the earlier one and emails it, because Frontier keeps only a fingerprint of each link and cannot send the same one twice.

**Joining (screen 2).** The person gets in at once. A quiet banner on every page says "Confirm your email: we sent a link to <address>" with **Resend** and **Change address**. It has no close button and disappears when the link is opened. If the invitation was emailed to an address and the person joins with that same address, it counts as confirmed: no banner, no second email. The join page fills in the emailed address and says so. Google addresses are already verified.

**Confirmation page (screen 3).** One short message and one button: confirmed ("Open Avalymia", or "Log in" when logged out), link expired or used ("Log in", then a new link can be sent), already confirmed.

**Members (screen 4).** Owners see a dashed "Unconfirmed" tag beside an address. Nobody else sees addresses, so nobody else sees it. Confirmed and Google people show nothing.

**Signing in (screen 5).** Settings, You, Signing in gets an Email address block: Confirmed, Confirmed by Google, or Unconfirmed with Resend link. **Change address** asks for the new address and the current password. The old address stays in force until the new one is confirmed, and the old address is emailed that a change was asked for and when it completes. The change can be cancelled.

**Forgot password (screen 6).** Login gets a "Forgot password?" link, then one field, then "If that address has an account, we sent a link" for every address. The link works once for 30 minutes and opens a page for a new password (12 or more characters, with a live count). Success says other devices were logged out, and the person logs in again. An expired or used link says so and offers a new one. A person with only a passkey or Google gets the same answer on screen, and an email that says how they log in instead of a reset link. An unknown address gets no email.

**The emails (screen 7).** Five plain, short, text-first emails: invite, confirm address, reset password, reset with no password, address changed (sent to the old address). Each has one button, the plain link under it, "Sent by Frontier (noreply@haviv.pro)", and what to do if you did not ask: ignore it, nothing happens. No images or tracking.

**Mail off (screen 8).** With no relay configured everything falls back to today. The invite dialog has no field and says the server cannot send email; no banner and no marks; Change address applies at once; no Forgot password link. If the relay fails while on, the action still succeeds and says what was not sent (the invite link is still shown).

## Phone and desktop

Everything is one column of short text, so it works at both widths. On the phone the invite dialog is a bottom sheet, the banner is one short block above the page, and the emails are single-column. The reset and confirmation pages are the same centred card on both.

## Empty and error states

- No invitations waiting: "No invitations waiting."
- A badly formed address in the invite field, the change form or Forgot password: "That doesn't look like an email address." Nothing is sent.
- Send failed (invite): the link is still shown, with "We made the link but could not send the email". Resend retries.
- Expired or used confirm and reset links each have their own page with a way to ask again.
- Too many requests (a few per address per hour): "Try again in a few minutes", the same wording for every address.
- Reset password shorter than 12 characters: the button stays disabled and the count says how many more are needed.

## Keyboard

Enter sends the invite, the banner's change form, Forgot password and the reset form. Escape closes the invite dialog (not after the link has been made, so it is not lost; Done closes it). The first field of each form takes focus when it opens. Role choices are a radio group. Show the password is a checkbox. The banner status ("Sent again") is announced politely.

## Decisions (as approved: the recommendation in each)

1. **Must a new person confirm before getting in?**
   - **Recommended: get in at once, confirm later.** The invite already proved an owner wants them; a spam folder or typo must not strand them.
   - Must confirm before entering: safer on paper, but blocks invited people.

2. **What may an unconfirmed address not do?**
   - **Recommended: nothing is locked.** It never blocks a Google-verified person with the same address (the verified one wins; the unconfirmed account is asked to add another address). Reset links are still sent to it, and opening one confirms it.
   - No reset links to unconfirmed addresses: a mistyped address then has no way back.
   - Read-only after 7 days: punishes slow or filtered mail.

3. **How long do links last?**
   - **Recommended: confirm 24 hours, reset 30 minutes, invite 7 days (unchanged).** All work once; expiry is cheap because new ones are one click away.
   - Confirm 7 days: fewer expired links, old emails stay usable longer.
   - Reset 1 hour: more forgiving, doubles the window.

4. **Is an emailed invite tied to that address?**
   - **Recommended: no, it works for whoever opens it**, like a copied link; the dialog says so. Joining with the same address counts as confirmed.
   - Yes, only that address: blocks forwarding, but also people with a different address or Google account.

## Smaller points I assumed

- Resend of an invite makes a new link and cancels the old one.
- Passkey-only and Google-only accounts get an explanatory email, not a reset link.
- After a reset the person logs in again; they are not logged in automatically.
- Mail per address is rate limited; the on-screen answer does not change.
- Reset and password changes end other sessions, as today.

## How it was built: server

Built on 2026-11-27 on `stage-28-email-server`; `apps/web/src` was not changed. Everything that existed
keeps its shape, with the additions below. Mail is on only when `SMTP_HOST` and `MAIL_FROM` are both
set (see `README.md`, "Mail (optional)"); with neither, every route below that sends mail answers
`409 mail_off` (or is told apart by `mail: false` in `GET /api/session`) and everything else is as
it was.

### Config

| Variable | Meaning |
| --- | --- |
| `SMTP_HOST`, `MAIL_FROM` | Both or neither (one alone stops the server at start). `MAIL_FROM` is `Frontier <noreply@haviv.pro>` or a bare address; anything that could end a header line is refused. |
| `SMTP_PORT` | Default 587. |
| `SMTP_USER`, `SMTP_PASSWORD` | Both or neither. |
| `SMTP_SECURE` | `starttls` (default, opportunistic: encrypts when the relay offers it, certificate not checked, for a private relay on the same Docker network), `required` (STARTTLS or fail, certificate checked), `tls` (implicit TLS, certificate checked), `none`. |
| `MAIL_TEST_TRANSPORT=memory` | Tests only: messages are kept in the process. Refused when `NODE_ENV=production` (like `GOOGLE_ISSUER`). It is the only thing that registers `GET/DELETE /api/test/mail`. |

Timeouts: 10 s to connect and to be greeted, 20 s for a whole send. Links in emails are
`PUBLIC_URL` + `/confirm/<code>`, `/reset/<code>`, `/join/<code>`, `/login` or `/`, never from the
request's Host. The log never holds a message, a link or a code: a failed send is logged as the SMTP
error code only, and `/confirm/<code>`, `/reset/<code>` and their `/api` forms are written `:code`
like `/join/<code>`.

### On disk

- `state/people.json` (an account, all optional and defaulted, so old files read as before):
  `emailConfirmedAt`, `emailConfirmedBy` (`google`, `link`, `invite`, `reset`), `emailCode`
  (`{ codeHash, address, createdAt, expiresAt, mail: queued|sent|failed }`, the confirm link, for
  the account's address or for the pending one), `emailPending` (`{ address, requestedAt }`),
  `resetCode` (`{ codeHash, createdAt, expiresAt }`) and `emailDisplaced`. Only SHA-256 hashes of
  codes are kept. Every confirm and reset use runs inside the people store's serialized change
  (`PeopleStore.mutate`), so a code is used by exactly one request and what it changes is written
  with it.
- `state/invites.json` (an invitation): `email` (where it was emailed) and `mail` (`sent` or
  `failed`).
- Codes: 192 random bits as 32 URL-safe characters, looked up by comparing every account's stored
  hash in constant time without stopping at a match. One live confirm link and one live reset link
  per account: a new one replaces the old.

### Routes

Errors are the usual `{ error: { code, message } }`. New codes: `link_invalid` 410 (a confirm or reset
link that is unknown, malformed, used, expired, replaced or no longer applies, all answered alike),
`mail_off` 409, `already_confirmed` 409, `use_change_address` 409.

**Invitations (owner, under `/api/p/:project/`)**

| Request | Response |
| --- | --- |
| `POST /invites` `{ role, email? }` | 201 `CreateInviteResponse`: as before plus `sentTo` (the address or null) and `mail` (`sent`, `failed`, or null with no address). The link is always given, once. 400 `invalid` for an address that is not a plain address; 409 `mail_off` with an address and no relay (nothing is made); 429 when the address has had 6 mails this hour. A relay failure is not an error: `mail: "failed"` |
| `GET /invites` | each row also has `sentTo` and `mail` (null without an address) |
| `POST /invites/:id/resend` (owner) | 201 `CreateInviteResponse` for a new link (same role and address, made by the person asking, 7 days), the old one cancelled in the same change, and the mail sent. 409 `mail_off`; 400 `invalid` when the link was not emailed; 404 `not_found`; 410 `invite_used`/`invite_cancelled`/`invite_expired`; 429 |
| `GET /members` | each row has `unconfirmed`: owners get true/false (always false with mail off); everyone else null |

`GET /api/join/:code` (`JoinInfo`) also has `email`: the address the invitation was emailed to, or
null. Anyone holding the link sees it; the page fills it in and says so. Joining with exactly that
address (any case) sets the address confirmed (`emailConfirmedBy: "invite"`) and sends no mail.

**Joining.** Unchanged requests. After a password or passkey join with an address that is not
confirmed and mail is on, a confirm link is sent after the answer (it never delays or fails the
join, and when the address has used its allowance nothing is made and the banner shows no "sent").
A Google join is confirmed by Google.

**Me**

| Request | Response |
| --- | --- |
| `GET /api/session` | adds `mail: boolean` and, for a logged-in person, `person.emailInfo` |
| `GET /api/me`, `PUT /api/me` | add `emailInfo` (below) |
| `PUT /api/me` `{ name, email }` | The same address (any case) only changes the name. A different address on an account with an address, with mail on: 409 `use_change_address`. The first address of an account with none, and any change with mail off, apply at once as before (confirmation reset; with mail on a confirm link is sent) |
| `POST /api/me/email` `{ email, password? }` | Change address. Needs the current password when the account has a working one (400 `invalid` if wrong; counts against login's allowance), otherwise a login in the last 5 minutes (403 `recent_login_needed`). 400 `invalid` for the same or a badly formed address; 409 `email_taken`. Mail on and an address now: `{ ok, applied: false, mail: "sent"\|"failed" }`, the old address stays in force until the new one's link is opened, a confirm link goes to the new address and an "address is being changed" mail (the new address masked) to the old one. Mail off, or an account with no address yet: `{ ok, applied: true, mail: "off"\|"sent"\|"failed" }`, applied at once (with mail on the new address is unconfirmed and gets a link) |
| `DELETE /api/me/email/pending` | `{ ok }`; the change and its link are gone. 404 `not_found` when none waits |
| `POST /api/me/email/resend` | `{ ok, applied: false, mail }`: a new confirm link (to the pending address while a change waits), the old one dead. 409 `mail_off`; 409 `already_confirmed`; 400 `invalid` with no address; 429 (5 an hour per account, and the address's 6 an hour) |
| `POST /api/confirm/:code` (public) | `{ ok, status: "confirmed"\|"already_confirmed"\|"changed", you }`. `you` is whether the person who opened it is logged in as that account. 410 `link_invalid`. Never starts or changes a session. For `changed` the old address gets a "has been changed" mail. **The page calls this when it loads**, not a GET, so a mail program that fetches the link does not use it up |
| `POST /api/forgot-password` `{ email }` (public) | `{ ok: true }` for every well-formed address, answered before anything is looked up (the lookup, the code and the mail are done after the answer). 400 `invalid` only for a badly formed address; 409 `mail_off`; 429 after 3 requests an hour for one address (counted whether or not it has an account) or 10 an hour from one network address |
| `GET /api/reset/:code` (public) | `{ ok: true }` when the link works; 410 `link_invalid` |
| `POST /api/reset/:code` `{ password }` (public) | 12 to 500 characters (400 `invalid`, the link not used). `{ ok: true }`: password set, address confirmed (`emailConfirmedBy: "reset"` if it was not), every session of that account ended (the browser's too), nobody logged in. 410 `link_invalid` |

The public routes also draw on the join allowance (30 per 15 minutes per address). The CSRF check of
stage 27c applies to every new POST/DELETE.

`emailInfo` (`EmailInfo`): `mailOn`; `status` (`none`, `unconfirmed`, `confirmed`); `confirmedBy`;
`confirmedAt`; `sent` (`{ at, ok }` for the latest confirm mail of the current address, `ok` null while
it is on its way, or null if none was made); `pending` (`{ address, requestedAt, sent }` or null);
`needsAddress`.

### What the emails say

Invite, confirm, reset, "about your password" (an account with no working password) and "address
is being changed / has been changed" (to the old address), worded as in the mockup, plain text first,
simple HTML with one button and the plain link, no images, nothing remote. Names, project names and
addresses are escaped in the HTML; subjects lose control characters and are cut at 150; an address
must be one plain `local@domain` (no comma, angle bracket, quote or control character) or nothing is
sent. The explanatory mail says how the account does log in (Google, a passkey, or that the
password is switched off) and never contains a reset link.

### Decisions where the proposal was silent

- **Existing accounts, the admin included, migrate as unconfirmed**, with no mail sent at start. With
  mail on they see the banner like anyone, with `sent: null`, so the web can word it "Send a link" rather
  than "we sent". The admin is not treated differently: an install that turns mail on asks its first
  account to confirm too, and the first reset or Resend does it.
- **A reset sets the password only for an account whose password works** (the only account a link is
  sent to). A password the person switched off is never switched back on by a reset, nor by any link:
  such an account gets the explanatory email. If it is switched off after a link was sent, the link
  dies.
- **Reset and confirm links are separate per account and single**: a newer one replaces an older one;
  changing the password, changing the address or a Google displacement kills the reset link.
- **Google and an unconfirmed address.** The Google person wins (a new, confirmed account) only if
  mail is on and the other account: has no Google link, has at least one passkey (so it still has a
  way in that needs no address), is not the server's first account, and has an address nobody
  confirmed. Then its address is cleared in the same write that makes the new account, its confirm,
  change and reset links die, `emailDisplaced` is set (`emailInfo.needsAddress`, `status: "none"`,
  `needsProfile: true`), and it keeps its sessions and passkeys. Otherwise it is `account_exists`
  as today (an account whose only way in is email and password would be shut out; the admin is never
  touched; a confirmed address is protected). A joining that fails after the swap puts the other
  account's address back. A displaced account is not "the account with no email" of stage 27c's
  blank-email login, so that rule is not broken or stolen; it is not offered `emailless`.
- **`PUT /api/me` cannot swap an address with mail on** (`use_change_address`), or the confirmation
  could be skipped; the web's profile form must send the current address or use Change address.
- **Change address says `email_taken`** to someone who proved the password. The public routes never
  reveal an account.
- **A link opened by the wrong person.** Confirm and reset change only the account the code belongs
  to and never start, end or alter the opener's session (a reset ends all sessions of the account it
  resets, which may include the opener's if it is the same person).
- **Rate limits** (one clock, an hour, all answering 429 `rate_limited` "Too many requests. Try again
  in a few minutes."): 6 mails per recipient address (invites, resends, confirm links), 5 resends per
  account, 3 forgot-password requests per address and 10 per network address.
- **Known and accepted (decision 4).** Because an emailed invitation still works for whoever opens
  it, someone who forwards or leaks it can join with the invited address typed in and have it
  counted as confirmed without owning the mailbox. The real owner of the address can still reset
  and take that account over (a reset confirms it), and a Google person with that address is turned
  away with `account_exists` if it is confirmed.

### Notes for the web half

- Read `mail` in `GET /api/session` before drawing anything about email; with `false` show no invite
  field (the dialog says the server cannot send email), no banner, no marks, no "Forgot password?",
  and Change address applies at once (`applied: true`).
- Invite dialog: send `email` with the role. Show the link from the answer whatever `mail` is; on
  `failed` say "We made the link but could not send the email". Waiting list: `sentTo` and `mail`;
  Resend is `POST /invites/:id/resend` and returns a new link like create does (show it once).
- Banner: from `person.emailInfo` (session) or `emailInfo` (me). Show it when `mailOn` and
  `status === "unconfirmed"`. `sent: null` means nothing was sent yet ("Send a link"); `sent.ok === false`
  means it failed. While `pending` is set the banner is about the new address. `needsAddress` is the
  displaced account: ask for an address (Settings, Profile, or Change address). `status: "none"` also
  covers the account from before emails were asked for.
- Settings, Signing in: Confirmed / Confirmed by Google (`confirmedBy: "google"`) / Unconfirmed with
  Resend (`POST /api/me/email/resend`) and Change address (`POST /api/me/email` with the new address
  and the current password; on `recent_login_needed` ask to log in again). Cancel is
  `DELETE /api/me/email/pending`. The profile form must not send a different address with mail on
  (`use_change_address`).
- `/confirm/<code>` page: call `POST /api/confirm/<code>` on load. `status` `confirmed`/`changed`:
  button "Open Avalymia" when `you`, else "Log in". `already_confirmed`: its own text. 410
  `link_invalid`: expired or used, "Log in", where a new link can be sent.
- `/reset/<code>` page: `GET /api/reset/<code>` on load (410 `link_invalid` shows the expired page);
  submit `POST /api/reset/<code>` with `password` (disable the button under 12 characters). On success
  say other devices were logged out and send the person to `/login`; nobody is logged in.
- `/login`: "Forgot password?" only when `mail`. The form posts to `POST /api/forgot-password`; always
  show "If that address has an account, we sent a link" on 200; 429 shows "Try again in a few
  minutes"; 400 shows "That doesn't look like an email address."
- Members: `unconfirmed` (owners only) gets the dashed tag.
- Join page: `JoinInfo.email` pre-fills the address and says it was the one the invitation went to.
- New codes to handle: `link_invalid`, `mail_off`, `already_confirmed`, `use_change_address`,
  `rate_limited` (new wording).
- For browser tests: `E2E_MAIL=1` makes `apps/web/e2e/server.mjs` keep mail in memory; read it at
  `GET /api/test/mail` (`{ messages: [{ to, subject, text, html }] }`) and clear it with
  `DELETE /api/test/mail`. Mail stays off by default, so existing specs are unaffected.
