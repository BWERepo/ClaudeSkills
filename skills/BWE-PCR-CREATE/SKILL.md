---
name: BWE-PCR-CREATE
description: "Creates one Program Change Request (PCR) for a customer in the Business Web Express backoffice: reads the customer site's current version live from its footer, opens the customer's Program change requests (PCRs) card, fills the New change request form with the owner's own wording, and submits only after the owner confirms. Defaults: customer For The Table, version = the live version of forthetable.businesswebexpress.com. Use when the user says \"create a PCR\", \"add a change request\", \"new PCR for For The Table\", or invokes /BWE-PCR-CREATE."
---

# BWE-PCR-CREATE

Drives the BWE backoffice in a browser to add one PCR (a row in `software_change_requests`) for a customer. Adding a PCR is visible in the customer's PCR list and numbering, so this skill always stops for the owner's explicit OK right before it adds.

## Questions and defaults (always do this first)
Ask for everything in one message, offering the default for each so one word accepts it:

> Which customer (default For The Table), what is the change (title and description in your words), and which website version (default: read live from the site)?

| Parameter | Default |
|---|---|
| Customer | `For The Table` |
| Website version | the version shown live in the customer site's footer (see below) |
| Title | optional; blank means the backoffice derives it from the description |
| Description | **required, from the owner. Never invent or embellish it.** |
| Page, Needed by, Requested by, Priority, Status | optional; defaults Requested by `Admin`, Priority `Medium`, Status `New`. Ask only if the owner mentioned them |

Rules:
- Values already given in the request are used as given; ask only for what is missing. The description can never default: if the owner has not given one, ask.
- Never write, rewrite or "improve" the description or title. Type exactly what the owner supplied (fixing nothing silently). Do not invent pages, dates, priorities or resolution comments.
- Read the final values back in one line before starting.

## Reading the current version live
The customer's site footer ends with `Website by <business> businesswebexpress.com — v<version>` (stamped by each deploy).
- For The Table: open `https://forthetable.businesswebexpress.com` in the browser, scroll to the footer, read the `v…` text, and use the number without the `v` (for example `v1.4.2` becomes `1.4.2`).
- Another customer: ask the owner for that customer's site URL, or the version itself. Do not guess a domain.
- If the owner gave a version, use it instead and skip the lookup. If the footer shows no version, say so and ask; do not make one up. Mention which version you read and from which URL.

## Credentials: never handle them
- Never ask for, type, store, log or write down the 6-digit code or any password, in chat, in files or in memory.
- The owner signs in themselves; use the browser's saved-credential autofill if offered, otherwise ask the owner to enter the code and say when they are in.
- Use a real browser the owner can see (Claude in Chrome, or computer use). Not a headless browser.

## Steps
Labels are the real ones in the BWE admin (`SoftwareChangeRequestsManage.tsx`).

1. Read the live version (above).
2. Go to `https://businesswebexpress.com/owner` (production backoffice) and sign in as `owner@businesswebexpress.com`; the owner supplies the code. Wait until signed in.
3. Click **Admin dashboard**, then find the customer in the customers list and open them (search by name; the exact customer must match, otherwise stop and ask).
4. Open the **Program change requests (PCRs)** card (use **Search cards by name** if needed). Note the current **Total reported** count.
5. Expand **New change request** (collapsed by default). The PCR number is assigned automatically.
6. Fill in: **Title** (if given), **Page** (if given), the description box (placeholder "Describe the change…"), **Needed by** (if given), **Website version** (the version above), **Requested by**, **Priority**, **Status**. Leave **Resolution Comments** and attachments empty unless the owner supplied them.
7. **Stop and confirm with the owner.** Show: customer name (read back from the page), title, page, full description, website version and where it came from, Requested by, Priority, Status, Needed by. Wait for an explicit yes in chat. Approval for a previous PCR does not carry over.
8. After the yes, click **Add**. Wait for the button to stop showing "Adding…".
9. Verify: **Total reported** went up by one and the new row appears in the list with its PCR number, title and status. Report the PCR number, and the link if the row offers one. If anything differs, report it exactly; do not retry adding (that would create a duplicate).

## Failures
- **Sign-in fails, code rejected, or the owner is not available:** stop and say so; never try codes.
- **Customer not found, card missing, or a label differs from the steps:** stop and describe what is on screen; do not guess another control.
- **Error after clicking Add:** show the error, check the list for a row before suggesting any retry, and never add twice without the owner's say-so.

## Do not
- Do not click **Add** without the step 7 confirmation.
- Do not edit or delete existing PCRs, change statuses, email PCR lists, deploy, or edit code.
- Do not use staging unless the owner asks for it.
- Do not store the code or any password anywhere.
