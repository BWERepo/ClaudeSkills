---
name: BWEWorkQueueNotStarted
description: Lists only the work-queue items of the One Click Answers project (Z:\Backup\websites\OneClickAnswers\docs\QUEUE.md) that have NOT been started, with the item number and a short description, plus the deploy and e2e switches. Use when the user says "what has not started", "show not started", "open queue items", or invokes /BWEWorkQueueNotStarted, in the context of the One Click Answers project.
---

# BWEWorkQueueNotStarted

> **Where it runs (local or cloud):** `Z:\Backup\websites\OneClickAnswers` below is the owner's local Windows checkout and is optional. In any other checkout (a cloud Claude Code project, Linux or macOS) use the repository root, the folder that holds `CLAUDE.md`; nothing in this skill needs the `Z:` drive. See docs/CLAUDE-PROJECT-MIGRATION.md.

Show only the queue items that are still waiting to be started.

## Do
1. Work in `Z:\Backup\websites\OneClickAnswers`. Grep `docs/QUEUE.md` for the item headings (lines matching `^## `). The status is in the heading's trailing parentheses. An item is NOT STARTED when its heading says "queued, NOT started" or "NOT started" (or says "queued" with no BUILT/DONE/SKIPPED/IN PROGRESS wording). Skip every item whose heading says BUILT, DONE, SKIPPED, rejected or in progress. Do not read the whole file.
2. Do NOT trust an old label blindly: a status can lag the code (the project notes record items marked "NOT started" that were already built, and items whose commits only added the queue entry). For each candidate, make ONE quick check (a Grep or `git log --oneline -3 -- <main file named in the item>`) that the work is really absent. If the code shows it exists, leave it out and add a one-line note "label looks stale: item N appears built". Also leave out an item an agent or Claude is working on right now (check the conversation and `ListAgents`) and say so in a note.
3. Reply with ONE table, in numeric order:
   | # | Description | Waiting on |
   - **#**: the item number exactly as in the file.
   - **Description**: the title reduced to a plain-English line of about 12 words or fewer (no dates, no "owner request" wording).
   - **Waiting on**: "ready to start", or the owner decision or earlier item it depends on, taken from the item text (for example "needs the AI engine, item 52" or "owner questions open"). Do not invent dependencies.
4. If nothing is waiting, say "Every queue item has been started."
5. Under the table report the two switches by checking whether the files exist in the project root: **Deploy: ENABLED/DISABLED** (`.deploy-disabled` exists = disabled) and **E2E: ENABLED/DISABLED** (`.e2e-disabled` exists = disabled). End with one line: how many items are not started.

## Do not
- Do not edit any file, build, deploy or run tests, and do not paste item bodies.
- Do not invent items or statuses.
