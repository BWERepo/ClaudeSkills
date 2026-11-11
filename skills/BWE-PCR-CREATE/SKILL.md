---
name: BWE-PCR-CREATE
description: "Creates one Program Change Request (PCR) for a customer in the Business Web Express backoffice: reads the customer site's current version live from its footer, opens the customer's Program change requests (PCRs) card, fills the New change request form with the owner's own wording, and submits only after the owner confirms. Defaults: customer For The Table, version = the live version of forthetable.businesswebexpress.com. Use when the user says \"create a PCR\", \"add a change request\", \"new PCR for For The Table\", or invokes /BWE-PCR-CREATE."
---

# BWE-PCR-CREATE

Drives the BWE backoffice in the Claude desktop app's built-in (in-app) browser to add one PCR (a row in `software_change_requests`) for a customer. Adding a PCR is visible in the customer's PCR list and numbering, so this skill always stops for the owner's explicit OK right before it adds.

## Questions and defaults (always do this first)
Ask **one question at a time**. Send a single short question, wait for the owner's answer, then ask the next. Never list several questions in one message. Offer the default where there is one so one word ("ok", "default") accepts it. Ask in this order, skipping any value the owner already gave in the request:

1. **Customer:** "Which customer? (default: For The Table)"
2. **Website version:** read the live version first (see below), then ask "Which website version? (default: <the version you read>, from <URL>)".
3. **Subject:** "What is the subject (the PCR title)?" No default.
4. **Description:** "What is the description of the change?" No default.
5. **Optional extras, one at a time:** Page (for example /about), Needed by, Priority (default Medium), Requested by (default Admin), Status (default New). Ask each as its own question, and accept "skip" or "none" to stop asking the remaining extras and use their defaults. If the owner already mentioned an extra, use it without asking.

| Parameter | Default |
|---|---|
| Customer | `For The Table` |
| Website version | the version shown live in the customer site's footer (see below) |
| Subject (the PCR **Title** field) | **asked every time, from the owner.** Never invented. Only if the owner says to leave it blank does the backoffice derive it from the description |
| Description | **required, from the owner. Never invent or embellish it.** |
| Page, Needed by, Requested by, Priority, Status | optional; defaults Requested by `Admin`, Priority `Medium`, Status `New`. Ask only if the owner mentioned them |

Rules:
- Values already given in the request are used as given; ask only for what is missing. The subject and description can never default: if the owner has not given them, ask.
- Never write, rewrite or "improve" the description or title. Type exactly what the owner supplied (fixing nothing silently). Do not invent pages, dates, priorities or resolution comments.
- Read the final values back in one line before starting.

## Reading the current version live
Do this before question 2 so the default can be shown. It needs the browser, so open the in-app browser first (see Browser below).
The customer's site footer ends with `Website by <business> businesswebexpress.com — v<version>` (stamped by each deploy).
- For The Table: open `https://forthetable.businesswebexpress.com` in the built-in browser (use `get_page_text` on the footer), scroll to the footer, read the `v…` text, and use the number without the `v` (for example `v1.4.2` becomes `1.4.2`).
- Another customer: ask the owner for that customer's site URL, or the version itself. Do not guess a domain.
- If the owner gave a version, use it instead and skip the lookup. If the footer shows no version, say so and ask; do not make one up. Mention which version you read and from which URL.

## Credentials: never handle them
- Never ask for, type, store, log or write down the 6-digit code or any password, in chat, in files or in memory.
- The owner signs in themselves. The built-in browser keeps its own persistent profile, so the owner may already be signed in; check first. Otherwise use saved-credential autofill if offered, or ask the owner to enter the code in the browser pane and say when they are in. Never sign out or touch other accounts.

## Browser: use the in-app browser
- Use the Claude desktop app's built-in browser (tools `mcp__Claude_Browser__*`, or `mcp__remote-devices__Claude_Browser__*` when the session runs in the cloud). Load them all with one ToolSearch on that prefix; if only `enable__mcp__remote-devices__Claude_Browser` is present, call it first. Invoke the `built-in-browser` skill if available.
- Before asking the owner to do anything in the pane (sign in, confirm), call `tabs_context` to check the pane is displayed. If hidden, ask them to press Ctrl+Shift+B (Cmd+Shift+B on Mac) in the desktop app. If a site is refused, call `request_access` if present, otherwise tell the owner.
- Prefer `get_page_text`, `read_page` and `find` over screenshots. Do not use Chrome or other browsers unless the in-app browser is unavailable, and then say so and ask first.

## Steps
Labels are the real ones in the BWE admin (`SoftwareChangeRequestsManage.tsx`).

1. Read the live version (above).
2. Go to `https://businesswebexpress.com/owner` (production backoffice) and sign in as `owner@businesswebexpress.com`; the owner supplies the code. Wait until signed in.
3. Click **Admin dashboard**, then find the customer in the customers list and open them (search by name; the exact customer must match, otherwise stop and ask).
4. Open the **Program change requests (PCRs)** card (use **Search cards by name** if needed). Note the current **Total reported** count.
5. Expand **New change request** (collapsed by default). The PCR number is assigned automatically.
6. Fill in: **Title** (the subject), **Page** (if given), the description box (placeholder "Describe the change…"), **Needed by** (if given), **Website version** (the version above), **Requested by**, **Priority**, **Status**. Leave **Resolution Comments** and attachments empty unless the owner supplied them.
7. **Stop and confirm with the owner.** Show: customer name (read back from the page), subject (title), page, full description, website version and where it came from, Requested by, Priority, Status, Needed by. Wait for an explicit yes in chat. Approval for a previous PCR does not carry over.
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
