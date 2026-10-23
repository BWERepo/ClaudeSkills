---
name: BWE-OCA-QUEUE-TODAY
description: Lists the work-queue items of the One Click Answers project (Z:\Backup\websites\OneClickAnswers\docs\QUEUE.md) that were ADDED or IMPLEMENTED TODAY, with the item number, a short description and where each stands (queued, in progress, built in code, on staging, on production), plus the deploy and e2e switches. Use when the user says "what was done today", "what was added today", "today's work", "show today's queue", or invokes /BWE-OCA-QUEUE-TODAY, in the context of the One Click Answers project.
---

# BWE-OCA-QUEUE-TODAY

> **Where it runs (local or cloud):** `Z:\Backup\websites\OneClickAnswers` below is the owner's local Windows checkout and is optional. In any other checkout (a cloud Claude Code project, Linux or macOS) use the repository root, the folder that holds `CLAUDE.md`; nothing in this skill needs the `Z:` drive. See docs/CLAUDE-PROJECT-MIGRATION.md.

Show the queue items that were ADDED to the queue today or IMPLEMENTED today (the system's current date, shown in the session context as "Today's date"). An item can be both (added and built the same day).

## Do
1. Work in `Z:\Backup\websites\OneClickAnswers`. Take today's date from the session context (format YYYY-MM-DD). If you cannot find it, run `date +%F`.
2. Grep `docs/QUEUE.md` for the item headings (lines matching `^## `). A heading carries its status in the trailing parentheses.
   - **Added today:** the heading names today's date as the date of the owner prompt or request (for example "owner prompt 2026-10-03", "owner request 2026-10-03"), or `git log --since=midnight -p -- docs/QUEUE.md` shows the heading was added today.
   - **Implemented today:** the heading says BUILT, DONE, PARTLY BUILT or built-in-code AND names today's date.
   Do not read the whole file.
3. Headings whose date is missing or older need a quick second look, because a status can lag the work: run `git log --since=midnight --oneline` (and `git status --short` for work not yet committed) and map any commit message or changed file that names a queue item ("Queue item 62", "item 57") to that item. Also include items added or built earlier in THIS conversation today even if the heading has no date yet (say "(heading not dated)"). If you only know it from the conversation, say so.
4. Reply with ONE table, in numeric order:
   | # | Description | Added / done today | Where it stands |
   - **#**: the item number exactly as in the file.
   - **Description**: the title reduced to a plain-English line of about 12 words or fewer (no dates, no "owner request" wording).
   - **Added / done today**: one of **Added**, **Implemented**, or **Added and implemented**.
   - **Where it stands**: one of **Queued, not started**, **In progress** (partly built; say what is left in a few words), **Built in code, not deployed**, **Built, on staging vX** (when the heading names a version), **Built, on production**, **Parked**, **Deleted**. Use the heading's words; never promote an item beyond what it says.
5. If nothing was added or implemented today, say "No queue items were added or implemented today."
6. Under the table: **Deploy: ENABLED/DISABLED** (`.deploy-disabled` exists = disabled) and **E2E: ENABLED/DISABLED** (`.e2e-disabled` exists = disabled). End with one line: how many items were added today, how many were implemented today, and how many of the implemented ones are still uncommitted or undeployed (use `git status --short` to tell whether the work is committed).

## Do not
- Do not edit any file, build, deploy, commit or run tests, and do not paste item bodies.
- Do not invent items, dates or statuses; if a heading is unclear, say so in the last column.
