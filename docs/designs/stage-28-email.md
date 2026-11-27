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
