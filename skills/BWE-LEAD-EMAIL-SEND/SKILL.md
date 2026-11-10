---
name: BWE-LEAD-EMAIL-SEND
description: "Sends a batch of blind (cold outreach) lead emails from the Business Web Express backoffice: signs in, opens Cards > Blind Lead Email, picks a category, stages the first N unsent prospects, sets Send from, and sends only after the owner confirms. Defaults: General Dentistry, 10 rows, alvin@businesswebexpress.net. Use when the user says \"send blind lead emails\", \"send the lead emails\", \"email the dentists\", or invokes /BWE-LEAD-EMAIL-SEND."
---

# BWE-LEAD-EMAIL-SEND

Drives the BWE backoffice in a browser to send one batch of Blind Lead Emails. Sending email to prospects cannot be undone, so this skill always stops for the owner's explicit OK right before it sends.

## Questions and defaults (always do this first)
Before opening the browser, ask the owner for the three values, offering the default for each so one word ("ok", "defaults") accepts it. Ask all three together in one message, for example:

> Which category (default General Dentistry), how many emails (default 10), and send from which mailbox (default alvin@businesswebexpress.net)?

| Parameter | Default |
|---|---|
| Category | `General Dentistry` |
| Row count | `10` |
| Send from | `alvin@businesswebexpress.net` |

Rules:
- Any value the owner already gave in the request (for example `/BWE-LEAD-EMAIL-SEND category=Plumbers count=20 from=alvin@businesswebexpress.net`) is used as given: do not ask for it again; ask only for the ones missing.
- An answer of "ok", "defaults", "same", or no answer to a value means use its default. Read the chosen values back in one line before starting.
- Substitute the chosen values everywhere below: the category and count wherever steps and the step 14 summary say "category", "count" or "N", and the Send from value in steps 12, 14 and 15. Do not hard-code the defaults in later steps.
- Validate before using: the category must be one of the category pills on the card, the count a positive whole number, and Send from a mailbox in the Send from list. If one is not valid, say so and ask again; do not guess a close match.
- If fewer than `count` unsent rows with an email exist in the category, tell the owner how many there are and ask whether to send that many instead.

## Credentials: never handle them
- Never ask for, type, store, log or write down the 6-digit code or any password, in chat, in files or in memory.
- The owner signs in themselves. The code is saved in their browser or password manager. Use the browser's saved-credential autofill if it offers it; if the code is not filled in, ask the owner to enter it and click sign in, then continue once they say they are in.
- Use a real browser the owner can see (Claude in Chrome, or computer use on their machine). Do not use a headless browser.

## Steps
Labels below are the real ones in the BWE admin (`LeadEmailManage.tsx`, `admin.tsx`).

1. Go to `https://businesswebexpress.com/owner` (the Backoffice Sign In page). Production, not staging.
2. Sign in with the email `owner@businesswebexpress.com`. The owner supplies the saved 6-digit code (see above). Wait until signed in.
3. Click **Admin dashboard**.
4. Click the **Cards** tab.
5. Click the **Blind Lead Email** card.
6. Select the category (the chosen category) from the category pills. The card's Subject and body load from the category; do not edit them.
7. Expand **Prospect tracker** (collapsed by default; click its title).
8. Scroll down the grid and tick the **Staged** checkbox on `count` rows whose **Date email sent** is empty. Only stage rows that have an email address and no sent date, one row at a time, and stay in the same category. (The footer's "Stage next N emails" control does the same job and is an acceptable shortcut, but verify the result as in step 9.)
9. Verify the staging: use the Staged header filter ("Show only staged rows") or count the ticks. There must be exactly `count` staged rows, every one with a blank Date email sent and the right category. If the count is wrong or a row already has a sent date, fix it before continuing (the **Clear staged** button unstages everything).
10. Close the **Prospect tracker** (click its title again).
11. Expand **Compose** (click its title).
12. Set **Send from** to the Send from parameter (the chosen mailbox). If that mailbox is not in the list, stop and tell the owner; do not pick another.
13. Uncheck **Rotate through all N mailboxes**. Confirm **Test send** is unchecked.
14. **Stop and confirm with the owner.** Show this summary and wait for an explicit yes in chat:
    - Category, Send from address (read back from the page), number of staged rows, and their email addresses (or the first and last few).
    - "Rotate" is off and "Test send" is off.
    - Subject line.
    - That this sends real email and cannot be undone.
    Do not click **Send N staged emails** (the button's label changes from "Send email" once rows are staged) without that yes. Approval for a previous batch does not carry over.
15. After the yes, click the send button. The page shows a native confirm dialog (it names the Send from address and the count, and says it cannot be undone). Browser automation cannot reliably click native dialogs and must not dismiss one blindly: tell the owner to read it and click OK themselves, or if the tools can see it, check that its Send from line and count match what the owner approved before accepting.
16. Wait until all emails are sent. The page shows "Sending email #N of M…", about 15 seconds apart, so 10 emails take roughly 2.5 minutes. Check progress periodically; do not click anything else on the card meanwhile.
17. When it finishes, read the end-of-run summary and report: how many were sent, how many failed (with each address and error), and whether the sent rows now show a Date email sent. Successful rows are dated and unstaged; failed rows stay staged for a retry.

## Failures
- **`535` / `BadCredentials` (SMTP authentication failed) for a mailbox:** that mailbox's Cloudflare secret `LEAD_EMAIL_SMTP_PASSWORD_<KEY>` needs a new Gmail app password (`<KEY>` is the mailbox key; the card's Manage mailboxes dialog shows the wrangler command). Tell the owner this and stop. Do not retry in a loop, do not switch mailboxes on your own, and do not ask for the password in chat; the owner sets the secret. The emails stay staged, so after the secret is fixed the owner can ask to resend.
- **Any other per-address failure:** the batch continues; report the failures at the end and leave them staged. Do not retry automatically. Offer one retry only after telling the owner the reason.
- **Sign-in fails, code rejected, or the owner is not available:** stop and say so; never try codes.
- **A label is missing or the layout differs from the steps:** stop and describe what is on screen; do not guess at another control.

## Do not
- Do not send without the step 14 confirmation, and do not change the Subject, body, From name or Cc.
- Do not use Test send or the Test email destination unless the owner asks for a test.
- Do not deploy, edit code, or change mailboxes, categories or prospects other than staging and the send.
- Do not store the code or any password anywhere.
